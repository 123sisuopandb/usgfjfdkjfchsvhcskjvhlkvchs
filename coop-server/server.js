/*
 * CryptographyTube — Community Hunt (coop) backend
 * ---------------------------------------------------------------------------
 * A tiny socket.io server that speaks the EXACT protocol the site's puzzle
 * engine (app.obf.js -> FoundWallets.connectSocket()) expects, so the
 * "Team / Community Hunt" panel on /bitcoin-puzzle/<N>/random fills with LIVE,
 * server-coordinated data instead of zeros.
 *
 * Protocol (reverse-engineered from the reference backend, verified frame-by-frame):
 *   client -> server:  io(URL, { path:'/ws' })            // Engine.IO v4
 *                      emit 'puzzle:watch' { puzzle:N }    // with an ack callback
 *   server -> client:  ack(snapshot)                       // reply to puzzle:watch
 *                      emit 'puzzle:progress' snapshot      // per-puzzle, ~1/s
 *                      emit 'speed:total' { speed, clients } // global, ~1/s
 *
 *   snapshot = {
 *     puzzle:      N,
 *     coveredKeys: "<bigint string>",   // keys scanned by the community  -> #commKeys
 *     cellsDone:   "<bigint string>",   // coveredKeys / 2^18 (chunk cells)
 *     remaining:   "<bigint string>",   // totalKeys - coveredKeys        -> #commRemaining
 *     totalKeys:   "<bigint string>",   // 2^(N-1) = the puzzle's keyspace
 *     pct:         <number fraction>,   // coveredKeys/totalKeys (UI x100) -> #commPct
 *     teamSpeed:   <number keys/s>,     // sum of watchers' rates          -> #commSpeed
 *     hunters:     <number>             // live watchers on this puzzle    -> #commHunters
 *   }
 *
 * What is REAL vs MODELED (honest):
 *   - hunters / clients  = the ACTUAL number of connected visitors (fully real).
 *   - progression        = real wall-clock time * teamSpeed (real elapsed work).
 *   - per-client keys/s  = MODELED (150k-260k/s), because the engine never reports
 *                          each browser's true hashrate to the server (it only sends
 *                          {puzzle}). The reference backend does the same thing.
 *   - SEED_HOURS         = optional head-start so a fresh deploy doesn't start at 0.
 *                          Default 0 (pure real growth from launch).
 *
 * CORS is wide-open (origin '*') on purpose: this is public, read-only puzzle
 * telemetry, and the site is served from a different origin (cryptographytube.com)
 * than wherever you host this — so the browser must be allowed to connect.
 *
 * Run:    npm install && npm start          (listens on $PORT, default 3000)
 * Deploy: see README.md (Render / Railway / Fly / any Node host).
 */
'use strict';

const http = require('http');
const { Server } = require('socket.io');

const PORT        = Number(process.env.PORT || 3000);
const SOCKET_PATH = process.env.SOCKET_PATH || '/ws';
const SEED_HOURS  = Number(process.env.SEED_HOURS || 0);   // optional head-start
const CELL        = 262144n;                               // 2^18 keys per "cell"
const MIN_RATE    = 150000;                                // modeled per-client keys/s
const MAX_RATE    = 260000;

// puzzle N's keyspace size = 2^(N-1)  (verified: N=71 -> 1180591620717411303424 = 2^70)
function totalKeysFor(n) { return 2n ** BigInt(n - 1); }
function clientRate()    { return MIN_RATE + Math.floor(Math.random() * (MAX_RATE - MIN_RATE)); }

// -------- state --------
const puzzles  = new Map();  // n -> { covered: BigInt, total: BigInt }
const watchers = new Map();  // n -> Set<socket.id>
const rate     = new Map();  // socket.id -> modeled keys/s

function puz(n) {
  if (!puzzles.has(n)) {
    const total = totalKeysFor(n);
    // Optional head-start: pretend one average hunter has been running SEED_HOURS.
    let covered = 0n;
    if (SEED_HOURS > 0) {
      covered = BigInt(Math.floor(((MIN_RATE + MAX_RATE) / 2) * SEED_HOURS * 3600));
      if (covered > total) covered = total;
    }
    puzzles.set(n, { covered, total });
  }
  return puzzles.get(n);
}

function teamSpeedFor(n) {
  let s = 0;
  const set = watchers.get(n);
  if (set) for (const id of set) s += rate.get(id) || 0;
  return s;
}

function snapshot(n) {
  const p = puz(n);
  const remaining = p.total > p.covered ? p.total - p.covered : 0n;
  const pct = p.total > 0n ? Number(p.covered) / Number(p.total) : 0;  // fraction; UI x100
  return {
    puzzle: n,
    coveredKeys: p.covered.toString(),
    cellsDone: (p.covered / CELL).toString(),
    remaining: remaining.toString(),
    totalKeys: p.total.toString(),
    pct,
    teamSpeed: teamSpeedFor(n),
    hunters: (watchers.get(n) || new Set()).size,
  };
}

// -------- http (health check) --------
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: rate.size, puzzles: puzzles.size }));
    return;
  }
  res.writeHead(404); res.end();
});

// -------- socket.io --------
const io = new Server(server, {
  path: SOCKET_PATH,
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // websocket + polling both enabled (socket.io default) so every host/origin works
});

io.on('connection', (socket) => {
  rate.set(socket.id, clientRate());

  socket.on('puzzle:watch', (data, cb) => {
    const n = Number(data && data.puzzle);
    if (!(n >= 1 && n <= 160)) { if (typeof cb === 'function') cb(null); return; }
    // move the socket to exactly one puzzle room
    const prev = socket.data.puzzle;
    if (prev && watchers.has(prev)) { watchers.get(prev).delete(socket.id); socket.leave('puzzle:' + prev); }
    socket.data.puzzle = n;
    if (!watchers.has(n)) watchers.set(n, new Set());
    watchers.get(n).add(socket.id);
    socket.join('puzzle:' + n);
    if (typeof cb === 'function') cb(snapshot(n));   // 430[...] ack
  });

  socket.on('disconnect', () => {
    const n = socket.data.puzzle;
    if (n && watchers.has(n)) watchers.get(n).delete(socket.id);
    rate.delete(socket.id);
  });
});

// -------- tick: advance progress + broadcast (~1/s) --------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;

  for (const [n, set] of watchers) {
    if (!set || set.size === 0) continue;
    const ts = teamSpeedFor(n);
    const p = puz(n);
    p.covered += BigInt(Math.floor(ts * dt));
    if (p.covered > p.total) p.covered = p.total;
    io.to('puzzle:' + n).emit('puzzle:progress', snapshot(n));
  }

  let speed = 0;
  for (const r of rate.values()) speed += r;
  io.emit('speed:total', { speed, clients: rate.size });
}, 1000);

server.listen(PORT, () => {
  console.log(`[coop] listening on :${PORT}  path=${SOCKET_PATH}  seedHours=${SEED_HOURS}`);
});
