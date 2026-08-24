# CryptographyTube — Community Hunt (coop) backend

A tiny **socket.io** server that powers the **Team / Community Hunt** panel on the
`/bitcoin-puzzle/<N>/random` pages. It speaks the exact protocol the site's puzzle
engine expects, so the panel shows **live, server-coordinated** data (keys scanned,
active hunters, team speed, keys remaining, %) instead of zeros.

Why this exists: GitHub Pages is static and can't run a WebSocket server, and the
reference backend (`privatekeyfinder.io`) blocks other domains' origins. So the live
site needs **its own** coop backend — this one. Host it anywhere that runs Node +
WebSockets, then point the site at it (one line, see step 3).

---

## What it serves

- `path: /ws` (Engine.IO v4), CORS open to all origins (public read-only telemetry).
- On `puzzle:watch {puzzle:N}` → acks a snapshot and joins that puzzle's room.
- Every ~1s → emits `puzzle:progress` (per puzzle) and `speed:total` (global).
- `GET /health` → `{ ok, clients, puzzles }` for host health checks.

**Real vs modeled (honest):** `hunters`/`clients` are the *actual* live visitor
counts and progress advances with *real* elapsed time; each browser's keys/s is
*modeled* (150k–260k/s) because the engine never reports its true hashrate to the
server — the reference backend does the same. `SEED_HOURS` (default `0`) optionally
gives a fresh deploy a head-start so it doesn't start at literally zero.

---

## 1. Run locally

```bash
cd coop-server
npm install
npm start            # -> [coop] listening on :3000  path=/ws
```

Quick check: open <http://127.0.0.1:3000/health> → `{"ok":true,...}`.

## 2. Deploy (pick one free host)

All three support WebSockets. **Render** is the simplest (this repo already has
`render.yaml`):

- **Render** — New ➕ → *Blueprint* → select this repo → it reads `render.yaml`
  (`rootDir: coop-server`). You get a URL like `https://cryptographytube-coop.onrender.com`.
  (Free instances sleep after ~15 min idle and wake on the next visit.)
- **Railway** — New Project → Deploy from repo → set **Root Directory** = `coop-server`,
  Start = `npm start`.
- **Fly.io** — `cd coop-server && fly launch` (Node detected) → `fly deploy`.

Set `SEED_HOURS` (e.g. `72`) in the host's env vars if you want the panel to look
established from day one; leave `0` for pure real growth.

## 3. Point the site at your server

Edit **one line** — the `BACKEND` constant in [`../_apply_coop_backend.py`](../_apply_coop_backend.py):

```python
BACKEND = 'https://YOUR-COOP-URL'      # e.g. https://cryptographytube-coop.onrender.com
```

Then run it from the repo root (rewrites `apiSocketUrl` on all 160 puzzle pages,
idempotent) and redeploy the site:

```bash
python _apply_coop_backend.py
git add -u bitcoin-puzzle/ && git commit -m "coop: point Community Hunt at own backend" && git push usg main
```

Do **not** include a trailing slash or the `/ws` path in the URL — the engine adds
`path:'/ws'` itself. Verify the origin is allowed (this server allows all).

---

## Notes

- Puzzle `N` keyspace = `2^(N-1)`; snapshot big-ints are sent as strings, `pct` is a
  fraction the UI multiplies by 100.
- State is in-memory (resets on restart/redeploy). Fine for live telemetry; add a
  datastore later if you want progress to persist across restarts.
- The site's [`assets/js/coop-fallback.js`](../assets/js/coop-fallback.js) still
  transparently fails over to the page's own origin if this server is ever
  unreachable, so the page never hangs and Solo modes always work.
