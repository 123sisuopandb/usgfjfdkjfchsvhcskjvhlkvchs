/* ============================================================================
 * CryptographyTube · Range Scan (additive · all chains)
 * ----------------------------------------------------------------------------
 * Scans the visible 60-key table page-by-page across a Start–End private-key
 * range. Instead of building its own table, it DRIVES THE NATIVE ENGINE so the
 * result is byte-for-byte identical to /private-keys/<chain> and just as fast.
 * It is chain-agnostic: Bitcoin renders two variants per row (compressed /
 * uncompressed, each with balance / received / tx pills); every other chain
 * (EVM, Solana, XRP, Tron, TON, Sui, LTC, DOGE, BCH, Zcash) renders one address
 * per row with a single balance value and a row-level "used" marker. Hit
 * detection below handles both shapes.
 *
 *   for each page:
 *     1. CGT_ENGINE.renderKeys(startKey)   → native skeleton with this page's 60 hex keys
 *     2. CGT.generateKeys()                → native enhance: WIFs + (c)/(u) addresses +
 *                                            the FAST batched balance check (BalanceChecker)
 *     3. read the native DOM               → any key showing balance / received / tx is a hit
 *     4. hits → auto-download page-<n>.txt
 *
 * Because it reuses the engine's own render + balance path, the table looks and
 * behaves exactly like the normal page (no "different page", no slow re-check).
 *
 * It ALSO fixes the key-link 404: the inline skeleton emits ../key.html?k=<hex>
 * (which 404s from a clean URL); generateKeys later rewrites those to /key/<hex>,
 * but a click in that window would still 404 — so we both rewrite the hrefs in
 * place and install a capture-phase click net for the whole page.
 *
 * Reuses only stable globals: window.CGT (engine instance), window.CGT_ENGINE
 * (renderKeys / updateNavButtons / updatePageInfo), window.CGT_CONFIG.
 * ========================================================================== */
(function () {
    'use strict';

    // secp256k1 order-1 — a valid private-key ceiling. secp chains (BTC, ETH/EVM,
    // LTC, DOGE, BCH, Zcash, Tron) use exactly this range; the ed25519 chains
    // (Solana, TON, Sui) accept any 32-byte scalar, so this ceiling covers all but
    // a negligible tail of their space — acceptable, and it keeps paging uniform.
    var MAX_KEY = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140');
    var MIN_KEY = BigInt(1);
    var ONE     = BigInt(1);
    var PAGE    = BigInt(60);   // keys per page (matches the engine's KEYS_PER_PAGE)
    var DELAY   = 800;          // ms between pages on an auto-scan (gentle on the balance API)
    var GEN_TIMEOUT = 25000;    // ms cap on one page's native render+balance before moving on

    var running = false;
    var scanned = 0, hits = 0;
    var rangeStart = MIN_KEY, rangeEnd = MAX_KEY, seqStart = MIN_KEY;
    var pagesTotal = null, pagesDone = BigInt(0);   // full-coverage progress (no repeat / no miss)

    // ---- tiny helpers ----
    function $(id) { return document.getElementById(id); }
    function toHex64(n) { return n.toString(16).padStart(64, '0'); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function isAuto() { return !!($('rangeAuto') && $('rangeAuto').checked); }
    function isRandom() { return !!($('rangeRandom') && $('rangeRandom').checked); }
    function clamp(n) { return n < MIN_KEY ? MIN_KEY : (n > MAX_KEY ? MAX_KEY : n); }
    function alignPage(k) { return ((k - MIN_KEY) / PAGE) * PAGE + MIN_KEY; }
    function pageIndexOf(startKey) { return (startKey - MIN_KEY) / PAGE + ONE; }

    function cfg()     { return window.CGT_CONFIG || {}; }
    function baseUrl() { return cfg().baseUrl || ''; }
    function eng()     { return window.CGT_ENGINE || null; }
    function engine()  { return window.CGT || null; }   // the obf engine instance
    function addrType() { return (window.CGT_CONFIG && window.CGT_CONFIG.type) || 'legacy'; }
    function chainInfo() { return cfg().chainInfo || null; }
    // Human-readable chain label for logs / the saved .txt, e.g. "Ethereum (ETH)".
    function chainLabel() {
        var ci = chainInfo();
        if (ci && ci.name) return ci.name + (ci.symbol ? ' (' + ci.symbol + ')' : '');
        var c = cfg().chain || 'bitcoin';
        return c.charAt(0).toUpperCase() + c.slice(1);
    }
    // Clean textContent (icons are <img alt=""> so this is just the number/string).
    function cellText(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

    function resolveCU() {
        if (window.CryptoUtils) return window.CryptoUtils;
        try { if (typeof CryptoUtils !== 'undefined') return CryptoUtils; } catch (e) {}
        return null;
    }
    function libsReady() {
        return !!(resolveCU() && window.NobleHashes && window.NobleCurves && window.ethers);
    }

    // Absolute key-detail URL — mirrors the engine's keyLink (baseUrl + "/key/" +
    // hex), which serve.py and _redirects map to key.html. Using the pretty
    // /key/<hex> form (NOT ../key.html?k=) avoids the trailing-slash 404 on clean
    // URLs (…/range-puzzle/bitcoin/ made ../ resolve to /range-puzzle/key.html).
    function keyUrl(v) { return (baseUrl() || '') + '/key/' + v; }

    // Accept a key as plain DECIMAL (no 0x needed) or as hex.
    function parseKey(str) {
        if (str == null) return null;
        str = String(str).trim().replace(/[\s,_]/g, '');
        if (str === '') return null;
        try {
            if (/^0x/i.test(str))      return BigInt(str);
            if (/[a-f]/i.test(str))    return BigInt('0x' + str);
            if (!/^[0-9]+$/.test(str)) return null;
            if (str.length === 64)     return BigInt('0x' + str);
            return BigInt(str);
        } catch (e) { return null; }
    }

    // Uniform-ish random BigInt in [lo, hi] inclusive.
    function randInRange(lo, hi) {
        var span = hi - lo + ONE;
        var rb = new Uint8Array(32);
        crypto.getRandomValues(rb);
        var r = BigInt('0x' + Array.from(rb).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''));
        return lo + (r % span);
    }

    // ------------------------------------------------------------------------
    // 404 FIX — the inline skeleton renders private-key links as ../key.html?k=,
    // which 404s from a clean URL. generateKeys() rewrites them to /key/<hex>,
    // but (a) there's a window before that runs and (b) it's belt-and-suspenders
    // to guarantee it everywhere. rewriteKeyLinks() fixes the hrefs in place; the
    // capture-phase click net (installed in init) catches any that slip through.
    // ------------------------------------------------------------------------
    function keyFromHref(href) {
        var m = String(href || '').match(/[?&]k=([^&#]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }
    function rewriteKeyLinks(root) {
        var scope = root || document;
        var bad;
        try { bad = scope.querySelectorAll('a[href*="key.html?k="]'); }
        catch (e) { return; }
        for (var i = 0; i < bad.length; i++) {
            var a = bad[i];
            var val = keyFromHref(a.getAttribute('href')) || (a.textContent || '').trim();
            if (val) a.setAttribute('href', keyUrl(val));
        }
    }

    // ---- UI ----
    function log(msg) {
        var el = $('rangeScanLog'); if (!el) return;
        var line = document.createElement('div');
        line.textContent = msg;
        el.insertBefore(line, el.firstChild);
        while (el.childNodes.length > 60) el.removeChild(el.lastChild);
    }
    function setState(txt, cls) {
        var el = $('rangeScanState'); if (!el) return;
        el.textContent = txt; el.className = cls || '';
    }
    function refresh(current, pageIdx) {
        if ($('rangeScanCount')) $('rangeScanCount').textContent = scanned.toLocaleString();
        if ($('rangeScanHits'))  $('rangeScanHits').textContent  = hits;
        if ($('rangeScanCurrent')) {
            var s = '';
            if (pageIdx != null) s += 'page #' + pageIdx.toString();
            if (pagesTotal != null) {
                s += (pagesTotal <= BigInt(1000000))
                    ? '  (' + pagesDone.toString() + '/' + pagesTotal.toString() + ')'
                    : '  (#' + pagesDone.toString() + ')';
            }
            if (current != null) s += '  0x' + toHex64(current);
            if (s) $('rangeScanCurrent').textContent = s;
        }
    }

    function downloadTxt(name, text) {
        try {
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
        } catch (e) { log('Download error: ' + e.message); }
    }

    // ---- read the native DOM for funded / used keys on the current page ----
    // After generateKeys(), each .key-row has, lined up by index across columns:
    //   .col-key      .private-key (hex)  +  N× .key-wif ( .wif-value )       [WIF absent on EVM/Solana/…]
    //   .col-address  N× .address-item ( .address-link/.address-text ; "(c)/(u)" prefix on BTC )
    //   .col-balance  N× .balance-info ( .bal[.has-balance] ; plus .tx[.has-tx]/.recv[.has-recv] on BTC )
    // Bitcoin legacy shows N=2 variants (compressed + uncompressed); every other
    // chain shows N=1. Non-BTC chains have no tx/recv pills and mark a used-but-
    // empty address with a row-level .was-active — handled by the row-level fallback.
    function scanDom() {
        var out = { count: 0, hits: [] };
        var container = $('keysContainer');
        if (!container) return out;
        var rows = container.querySelectorAll('.key-row');
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (row.style.display === 'none') continue;
            var pk = row.querySelector('.private-key');
            if (!pk) continue;
            var hex = (pk.textContent || '').trim();

            var addrItems = row.querySelectorAll('.col-address .address-item');
            var balInfos  = row.querySelectorAll('.col-balance .balance-info');
            var wifBlocks = row.querySelectorAll('.col-key .key-wif');

            // Variants on this row: BTC legacy = 2, every other chain = 1.
            var n = Math.max(balInfos.length, addrItems.length, 1);
            out.count += n;

            // Single-address chains (EVM / Solana / XRP / …) may attach the activity
            // class to the row or .col-balance rather than the inner .bal pill, and
            // flag "used but empty" with .was-active. When N === 1 the whole row maps
            // to that one address, so a row-wide check is safe (and can't over-report).
            var rowFunded = n === 1 && (row.classList.contains('has-balance') ||
                                        !!row.querySelector('.has-balance'));
            var rowUsed   = n === 1 && (row.classList.contains('was-active') ||
                                        !!row.querySelector('.was-active, .has-tx, .has-recv'));

            for (var j = 0; j < n; j++) {
                var bi     = balInfos[j] || null;
                var balEl  = bi ? bi.querySelector('.bal')  : null;
                var txEl   = bi ? bi.querySelector('.tx')   : null;   // Bitcoin-only pills
                var recvEl = bi ? bi.querySelector('.recv') : null;

                var funded = rowFunded || !!(
                    (balEl && balEl.classList.contains('has-balance')) ||
                    (bi && (bi.classList.contains('has-balance') || bi.querySelector('.has-balance'))));
                var used = rowUsed || !!(
                    (txEl   && txEl.classList.contains('has-tx')) ||
                    (recvEl && recvEl.classList.contains('has-recv')) ||
                    (bi && bi.querySelector('.has-tx, .has-recv')));
                if (!funded && !used) continue;   // no activity → not a hit

                var ai   = addrItems[j] || null;
                var link = ai ? ai.querySelector('.address-link, .address-text') : null;
                var addr = link ? cellText(link) : cellText(ai);
                var tag  = '';
                var tm   = ai ? cellText(ai).match(/\(([cu])\)/) : null;
                if (tm) tag = tm[1];
                var wif  = '';
                if (wifBlocks[j]) {
                    var wv = wifBlocks[j].querySelector('.wif-value');
                    wif = wv ? cellText(wv) : cellText(wifBlocks[j]);
                }

                // Balance / received / tx. BTC shows three pills; other chains show a
                // single .bal value (fall back to the whole cell) with no recv/tx split.
                var bal, tx, recv;
                if (balEl)   { bal = cellText(balEl); tx = txEl ? cellText(txEl) : ''; recv = recvEl ? cellText(recvEl) : ''; }
                else if (bi) { bal = cellText(bi);    tx = '';                          recv = ''; }
                else         { bal = cellText(row.querySelector('.col-balance')); tx = ''; recv = ''; }

                out.hits.push({
                    hex: hex, tag: tag, addr: addr, wif: wif, funded: funded,
                    bal: bal || '0', tx: tx, recv: recv
                });
            }
        }
        return out;
    }

    // ---- save all hits found on a page, named by page number ----
    function savePageHits(pageIdx, startKey, pageHits) {
        var lines = [
            '=== CryptographyTube · Range Scan — ACTIVITY FOUND ===',
            'Chain:                ' + chainLabel(),
            'Address type:         ' + addrType(),
            'Page number:          ' + pageIdx.toString(),
            'Page start key (dec): ' + startKey.toString(),
            'Page start key (hex): 0x' + toHex64(startKey),
            'Addresses with data:  ' + pageHits.length,
            '======================================================',
            ''
        ];
        pageHits.forEach(function (h, i) {
            var label = h.tag === 'u' ? 'uncompressed' : (h.tag === 'c' ? 'compressed' : '');
            lines.push('[' + (i + 1) + ']' + (label ? '  (' + label + ')' : '') + (h.funded ? '  ★ FUNDED' : ''));
            lines.push('Private key (hex):  ' + h.hex);
            if (h.wif)  lines.push('WIF:                ' + h.wif);
            lines.push('Address:            ' + h.addr);
            lines.push('Balance:            ' + h.bal);
            if (h.recv) lines.push('Received:           ' + h.recv);   // Bitcoin only
            if (h.tx)   lines.push('TX count:           ' + h.tx);      // Bitcoin only
            lines.push('');
        });
        downloadTxt('page-' + pageIdx.toString() + '.txt', lines.join('\r\n'));

        // Surface on the page too (backup manual download links).
        var box = $('rangeScanFound'), list = $('rangeScanFoundList');
        if (box && list) {
            box.style.display = '';
            var head = document.createElement('div');
            head.className = 'rs-found-item';
            var strong = document.createElement('b');
            strong.textContent = 'Page #' + pageIdx.toString() + ' — ' + pageHits.length + ' address(es) with activity';
            head.appendChild(strong);
            head.appendChild(document.createElement('br'));
            pageHits.forEach(function (h) {
                var code = document.createElement('code');
                var tg = h.tag ? '(' + h.tag + ') ' : '';
                var extra = ' · bal ' + h.bal;
                if (h.recv) extra += ' · recv ' + h.recv;
                if (h.tx)   extra += ' · tx ' + h.tx;
                code.textContent = tg + h.addr + '  ·' + extra;
                head.appendChild(code);
                head.appendChild(document.createElement('br'));
            });
            var dl = document.createElement('a');
            dl.href = '#'; dl.className = 'rs-found-dl'; dl.textContent = '↓ Download page-' + pageIdx.toString() + '.txt';
            dl.addEventListener('click', function (ev) { ev.preventDefault(); savePageHits(pageIdx, startKey, pageHits); });
            head.appendChild(dl);
            list.insertBefore(head, list.firstChild);
        }
        log('💰 Page #' + pageIdx.toString() + ' — ' + pageHits.length + ' address(es) with activity → page-' + pageIdx.toString() + '.txt');
    }

    // ---- scan a single page by DRIVING THE NATIVE ENGINE ----
    async function scanPage(startKey) {
        var pageIdx = pageIndexOf(startKey);
        refresh(startKey, pageIdx);

        var e = eng();
        // 1. Native skeleton for this page (populates the 60 .private-key hexes the
        //    engine reads in step 2), then sync the nav / page-info displays.
        if (e && typeof e.renderKeys === 'function') { try { e.renderKeys(startKey); } catch (x) {} }
        if (e && typeof e.updateNavButtons === 'function') { try { e.updateNavButtons(startKey); } catch (x) {} }
        if (e && typeof e.updatePageInfo   === 'function') { try { e.updatePageInfo(startKey);   } catch (x) {} }
        rewriteKeyLinks();   // fix skeleton ../key.html?k= links right away
        if (!running) return;

        // 2. Native enhance: WIFs + (c)/(u) addresses + the fast batched balance
        //    check. Cap the wait so a hung balance provider can't freeze the scan.
        var cgt = engine();
        if (cgt && typeof cgt.generateKeys === 'function') {
            try { await Promise.race([cgt.generateKeys(), sleep(GEN_TIMEOUT)]); }
            catch (x) { log('render error: ' + ((x && x.message) || x)); }
        }
        rewriteKeyLinks();   // generateKeys already sets /key/ links; make sure of it
        if (!running) return;

        // 3. Read the native DOM for funded / used keys.
        var res = scanDom();
        scanned += res.count;
        if (res.hits.length) {
            hits += res.hits.length;
            savePageHits(pageIdx, startKey, res.hits);
        }
        refresh(startKey, pageIdx);
    }

    function stop(reason) {
        running = false;
        if ($('btn-range-start')) $('btn-range-start').style.display = '';
        if ($('btn-range-stop'))  $('btn-range-stop').style.display  = 'none';
        setState(reason || 'Stopped', 'rs-idle');
    }

    // Build a page-index generator over [0, total). Yields each local page index
    // exactly once (no repeat, no miss) then null.
    //   - sequential: 0,1,2,...        - random: full-period LCG permutation
    function buildSequence(auto, random, total) {
        if (!auto) {                                   // single page
            var one = random ? randInRange(BigInt(0), total - ONE) : BigInt(0);
            var used = false;
            return function () { if (used) return null; used = true; return one; };
        }
        if (!random) {                                 // sequential full coverage
            var i = BigInt(0);
            return function () { if (i >= total) return null; var v = i; i += ONE; return v; };
        }
        // random full coverage via a full-period LCG over m = 2^k >= total
        var m = ONE; while (m < total) m <<= ONE;
        var a = ((BigInt('6364136223846793005') % m) & ~BigInt(3)) | ONE;
        var c = randInRange(BigInt(0), m - ONE) | ONE;
        var x = randInRange(BigInt(0), m - ONE);
        var produced = BigInt(0);
        return function () {
            if (produced >= total) return null;
            while (x >= total) { x = (a * x + c) % m; }
            var v = x;
            x = (a * x + c) % m;
            produced += ONE;
            return v;
        };
    }

    async function start() {
        if (running) return;

        var s = parseKey($('rangeStart') ? $('rangeStart').value : '');
        var eRaw = $('rangeEnd') ? $('rangeEnd').value.trim() : '';
        var e = eRaw === '' ? MAX_KEY : parseKey(eRaw);
        if (s == null) { log('⚠ Invalid Start key.'); return; }
        if (e == null) { log('⚠ Invalid End key.'); return; }
        s = clamp(s); e = clamp(e);
        if (s > e) { var t = s; s = e; e = t; }
        rangeStart = s; rangeEnd = e;

        // Page-align the range and count the pages it spans; every page that
        // overlaps [start,end] is covered exactly once (no repeat, no miss).
        seqStart = alignPage(rangeStart);
        var alignedEnd = alignPage(rangeEnd);
        pagesTotal = (alignedEnd - seqStart) / PAGE + ONE;   // >= 1
        pagesDone = BigInt(0);
        scanned = 0; hits = 0;

        if (!libsReady()) {
            setState('Loading crypto…', 'rs-run');
            var waited = 0;
            while (!libsReady() && waited < 20000) { await sleep(250); waited += 250; }
            if (!libsReady()) { log('⚠ Crypto libraries not ready — try again in a moment.'); setState('Idle', 'rs-idle'); return; }
        }

        // Capture the mode ONCE so the traversal stays fixed for the whole run.
        var auto = isAuto();
        var random = isRandom();
        var nextIdx = buildSequence(auto, random, pagesTotal);

        running = true;
        if ($('btn-range-start')) $('btn-range-start').style.display = 'none';
        if ($('btn-range-stop'))  $('btn-range-stop').style.display  = '';
        setState('Scanning…', 'rs-run');
        log('▶ ' + (random ? 'Random' : 'Sequential') +
            (auto ? (' · full range, no repeat (' + pagesTotal.toString() + ' page' + (pagesTotal === ONE ? '' : 's') + ')') : ' · single page') +
            '   ' + rangeStart.toString() + ' → ' + rangeEnd.toString() + '   [' + chainLabel() + ']');

        while (running) {
            var idx = nextIdx();
            if (idx === null) {
                log('✔ Complete — every page covered once. ' + scanned.toLocaleString() + ' address(es), ' + hits + ' hit(s).');
                stop('Done — full range covered'); break;
            }
            var startKey = seqStart + idx * PAGE;
            await scanPage(startKey);
            pagesDone += ONE;
            if (!running) break;
            if (!auto) { log('✔ Single page done — ' + scanned.toLocaleString() + ' address(es), ' + hits + ' hit(s).'); stop('Done (single page)'); break; }
            await sleep(DELAY);
        }
    }

    function init() {
        // 404 net — install ONCE for the whole page (covers the initial load and
        // normal navigation, not just scanning). Capture phase so we beat the
        // browser's own navigation on the broken ../key.html?k= links.
        if (!document.__rsKeyFix) {
            document.__rsKeyFix = true;
            document.addEventListener('click', function (ev) {
                var a = ev.target && ev.target.closest ? ev.target.closest('a[href*="key.html?k="]') : null;
                if (!a) return;
                var val = keyFromHref(a.getAttribute('href')) || (a.textContent || '').trim();
                if (!val) return;
                ev.preventDefault();
                window.location.href = keyUrl(val);
            }, true);
            try { rewriteKeyLinks(); } catch (e) {}
            // once more after the engine's first render settles
            setTimeout(function () { try { rewriteKeyLinks(); } catch (e) {} }, 1500);
        }

        var sb = $('btn-range-start'), st = $('btn-range-stop');
        if (!sb || !st) return;                          // scan panel not on this page
        sb.addEventListener('click', function () { start(); });
        st.addEventListener('click', function () {
            log('■ Stopped — ' + scanned.toLocaleString() + ' scanned, ' + hits + ' hit(s).');
            stop('Stopped');
        });
        // Prefill Start with the current page's first key as a plain DECIMAL.
        try {
            var cur = eng() && eng().startKey != null ? BigInt(eng().startKey) : MIN_KEY;
            if ($('rangeStart') && !$('rangeStart').value) $('rangeStart').value = cur.toString();
        } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
