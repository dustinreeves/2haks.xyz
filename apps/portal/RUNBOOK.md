# Portal Fan Lab runbook

**URL:** https://portal.2haks.xyz
**Folder:** `/opt/apps/portal` (a Git repo on the server)
**What it does:** an unofficial Portal fan game. Solve test chambers with a portal gun. Fastest full runs go on a leaderboard. Runs on **Fire Raze**, Tripp's small 3D engine (`web/public/fireraze/`).

## How it fits together

```
Browser ─► Caddy (host, systemd) ─┬─ /api/* ─► portal-api  127.0.0.1:8302 → container :8000  (FastAPI + SQLite)
                                  └─ /*     ─► portal-web  127.0.0.1:8301 → container :8080  (nginx, static files)
```

- **Levels** are JSON files in `content/levels/` (mounted read-only). The API re-reads them when they change. A broken file keeps the last good set and `/api/health` says `degraded`.
- **Runs and the leaderboard** live in `data/portal.db` (SQLite, owned by uid 10001, not in Git). The server keeps the clock: a run must finish chambers in order, each taking at least 3 s.
- **Fire Raze engine** (browser, ES modules, Three.js 0.170.0 vendored):
  - `collide.js`: box/ray maths
  - `physics.js`: box bodies, gravity, sliding collisions
  - `portals.js`: see-through portals (render-to-texture + oblique clipping), teleporting with momentum
  - `world.js`: builds a chamber from a level file (walls, doors, buttons, cubes, goo, fizzlers, exit, signs)
  - `lighting.js`: ACES tone mapping, image-based light, soft-shadow ceiling spot lights
  - `textures.js`: textures drawn in code (the white tile is Tripp's design)
- `web/public/game.js` is the game on top: controls, gun, GLaDOS subtitles (our own text), Jim, menus.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8301 | 8080 |
| api | 8302 | 8000 |

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api container | `LEVELS_DIR` | `/content/levels` | Level files |
| api container | `PORTAL_DB` | `/var/lib/portal/portal.db` | SQLite file (host: `data/portal.db`) |
| CLI | `PORTALFAN_API` | `https://portal.2haks.xyz` | API the CLI talks to |
| CLI | `PORTALFAN_LEVELS` | `<repo>/content/levels` | Folder `portalfan validate` checks |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/portal
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # status + health
docker compose restart
docker compose down              # stop (data/ is kept)
```

Editing `content/levels/*.json` needs no rebuild. Changing `api/` or `web/` does.
The uvicorn keep-alive (130 s) is longer than Caddy's on purpose; see the comment in `api/Dockerfile`.

## Health checks

```bash
curl -fsS https://portal.2haks.xyz/api/health   # {"status":"ok","levels":5}
curl -fsS http://127.0.0.1:8302/api/health
curl -fsS http://127.0.0.1:8301/healthz
docker compose ps
```

## Logs

```bash
docker compose logs -f api
docker compose logs -f web
journalctl -u caddy -f
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | ok / degraded / error |
| GET | `/api/levels` | chamber list (id, order, name) |
| GET | `/api/levels/{id}` | full chamber file |
| POST | `/api/runs` | start a run → `{run_id, levels}` |
| POST | `/api/runs/{id}/complete` `{"level": "01-through-the-wall"}` | finish the next chamber (server-timed) |
| POST | `/api/runs/{id}/finish` `{"name": "Tripp"}` | put a finished run on the leaderboard |
| GET | `/api/leaderboard?limit=10` | fastest full runs |
| GET | `/api/docs` | interactive docs |

## CLI

`/usr/local/bin/portalfan` → `cli/portalfan` (standard library only).

```bash
portalfan levels
portalfan show 04-fling
portalfan leaderboard
portalfan validate        # run before committing a new or edited level
```

## Making a new chamber

1. Copy a file in `content/levels/`, name it `NN-short-name.json`, and set the same `id` and a new `order`.
2. Boxes are `{"min": [x, y, z], "max": [x, y, z], "type": "white" | "metal" | "glass"}` (metres, y is up). Only `white` holds portals.
3. Optional: `doors` (+ `buttons` that open them), `cubes`, `goo`, `fizzlers`, `fixed_portals` (only with `"gun": "blue"`).
4. `portalfan validate`, then play it at `https://portal.2haks.xyz/?dev`.

## Developer mode

Open `https://portal.2haks.xyz/?dev`: no mouse lock needed, and the browser console has `fireraze`
(`fireraze.player`, `fireraze.shoot("blue")`, `fireraze.step(2)` to run 2 s of game time, `fireraze.world`).

## Tests

```bash
cd /opt/apps/portal
docker run --rm -v "$PWD":/app:ro -w /app/api -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim \
  sh -c "pip install -q -r requirements.txt -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

## Resetting the leaderboard

```bash
docker compose stop api
sudo mkdir -p data-backups && sudo cp -a data/portal.db "data-backups/portal-$(date +%Y%m%d-%H%M%S).db"
sudo rm data/portal.db data/portal.db-wal data/portal.db-shm 2>/dev/null
docker compose start api
```
