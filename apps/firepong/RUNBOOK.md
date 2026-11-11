# Fire Pong runbook

**URL:** https://firepong.2haks.xyz
**Folder:** `/opt/apps/firepong` (a Git repo on the server)
**What it does:** Pong with power-ups, on Tripp's Fire Raze engine. Play the computer (easy / normal / hard) or share a keyboard. Wins against the computer go on a leaderboard.

## How it fits together

```
Browser ─► Caddy (host, systemd) ─┬─ /api/* ─► firepong-api  127.0.0.1:8902 → container :8000  (FastAPI + SQLite)
                                  └─ /*     ─► firepong-web  127.0.0.1:8901 → container :8080  (nginx, static files)
```

- **The match is played in the browser.** `web/public/pong.js` holds all the rules and has no graphics code (so it can be run on its own). `web/public/game.js` draws it with Three.js and the Fire Raze modules, plays sounds and handles menus and input.
- **Power-ups are data.** Each file in `content/powerups/` (mounted read-only into the API) describes one. The game fetches them from `/api/powerups` when the page loads. The API re-reads the folder when a file changes; a broken file keeps the last good set and `/api/health` says `degraded`.
- **Leaderboard** lives in `data/firepong.db` (SQLite, owned by uid 10001, not in Git).
- **Fire Raze modules used:** `lighting.js`, `postfx.js` (bloom and tone mapping; ambient occlusion is switched off here) and `gamepad.js`, copied from `/opt/apps/portal/web/public/fireraze/` along with the vendored Three.js in `web/public/vendor/`. They are copies, so an engine fix in portal does not reach this app by itself.
- **The server can't watch a match.** It only checks that a submitted win makes sense (7 points to 0-6, 15 s to 1 h, nickname 1-12 characters) and allows 20 submissions a minute. The leaderboard therefore trusts the browser. Fine for a fun game; not for prizes.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8901 | 8080 |
| api | 8902 | 8000 |

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api container | `POWERUPS_DIR` | `/content/powerups` | Power-up files |
| api container | `FIREPONG_DB` | `/var/lib/firepong/firepong.db` | SQLite file (host: `data/firepong.db`) |
| CLI | `FIREPONG_API` | `https://firepong.2haks.xyz` | API the CLI talks to |
| CLI | `FIREPONG_POWERUPS` | `<repo>/content/powerups` | Folder `firepong validate` checks |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/firepong
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # status + health
docker compose restart
docker compose down              # stop (data/ is kept)
```

Editing `content/powerups/*.json` needs no rebuild. Changing `api/` or `web/` does.
The server has about 1 GB of RAM: build one app at a time.
The uvicorn keep-alive (130 s) is longer than Caddy's on purpose; see the comment in `api/Dockerfile`.

## Health checks

```bash
curl -fsS https://firepong.2haks.xyz/api/health   # {"status":"ok","powerups":8}
curl -fsS http://127.0.0.1:8902/api/health
curl -fsS http://127.0.0.1:8901/healthz
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
| GET | `/api/powerups` | all power-ups |
| GET | `/api/powerups/{id}` | one power-up |
| POST | `/api/matches` | save a win: `{"name","difficulty","player_score":7,"ai_score":0-6,"seconds","powerups"}` → `{id, rank}` |
| GET | `/api/leaderboard?limit=10` | best wins: harder computer first, then bigger margin, then faster |
| GET | `/api/docs` | interactive docs |

## CLI

`/usr/local/bin/firepong` → `cli/firepong` (standard library only).

```bash
firepong powerups
firepong show portals
firepong leaderboard
firepong validate        # run before committing a new or edited power-up
```

## Making a new power-up

1. Copy a file in `content/powerups/`. The file name must match its `id` (lowercase letters, digits, `_`).
2. Fields: `name` (≤24 characters), `description` (≤120), `effect`, `color` (`#rrggbb`), `duration` (seconds, 0-30), `weight` (1-10, how often it appears), `amount` (what the effect uses, see below).
3. `effect` is one of the ones the game can play: `big_paddle` (amount = size multiplier), `tiny_foe` (multiplier for the other paddle), `slow_mo` (ball speed multiplier), `fireball` (ball speed multiplier), `multiball` (extra balls), `shield` (lasts `duration` or until it blocks one goal), `magnet` (catches, `duration` = how long it stays active), `portals`.
4. A brand-new kind of effect needs code: add it to `KNOWN_EFFECTS` in `api/app/powerups.py` and to `applyPowerup` in `web/public/pong.js`.
5. `firepong validate`, then reload the game page.

## Developer mode

Open `https://firepong.2haks.xyz/?dev`. The browser console has `firepong`:
`firepong.start("ai", {level: "hard", powerups: true})`, `firepong.step(5)` (run 5 s of game time without waiting),
`firepong.spawn("portals")`, `firepong.game` (the whole game state).

## Tests

```bash
cd /opt/apps/firepong
docker run --rm -v "$PWD":/app:ro -w /app/api -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim \
  sh -c "pip install -q -r requirements.txt -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

The game rules (`pong.js`) have no automated test file yet. They were checked in the browser (see PROJECT_STATE.md).

## Resetting the leaderboard

```bash
docker compose stop api
sudo mkdir -p data-backups && sudo cp -a data/firepong.db "data-backups/firepong-$(date +%Y%m%d-%H%M%S).db"
sudo rm data/firepong.db data/firepong.db-wal data/firepong.db-shm 2>/dev/null
docker compose start api
```

## Tilt (gravity)

Everybody can tilt the board (keys, controller right stick, or on-screen buttons; see Controls), up to 7 degrees; the ball rolls downhill (`applyGravity` in `pong.js`, numbers in the `TILT` constant: gravity 7 m/s², energy drains 0.4/s and refills 0.22/s, locked until 30% after running dry).
- Each player has an energy meter (TILT bar under the score) so nobody can hold the board tilted for ever. When two players tilt at once their tilts add up.
- The computer tilts too on normal (50% strength) and hard (90%): while the ball heads for you, it leans the board so the ball drifts away from your paddle. Easy never tilts.
- The ball is kept between 3 m/s and 1.25 x the top speed, and can never roll straight up and down (it keeps at least a 0.2 forward share).
- All tilt state is in `game.tilt`, `game.meter` and `game.tiltLocked`; `step()` reads `input.tilt = [[x, z], [x, z]]` (-1..1 per player).

## Controls

- **Play the computer:** W / S move. ← ↑ ↓ → (or A / D left-right, Q / E up-down) tilt the board. Space (or Enter) lets go of a magnet-caught ball.
- **Two players:** every player has their own paddle and tilt keys, and their own TILT meter.
  Player 1: W / S move, A / D / Q / E tilt, Space lets go. Player 2: I / K move, J / L / U / O (or the arrows) tilt, Enter lets go.
  Tilt directions are the same for everybody (right = towards the right goal), and the tilts of both players add up.
- **Touch or mouse:** press and drag on the table to move your paddle. On touch screens (`pointer: coarse`) on-screen ▲ ◀ ▶ ▼ buttons tilt the board: one pad bottom-right against the computer, two pads (left = Player 1, right = Player 2) in two-player mode. In two-player mode the left half of the screen drags Player 1's paddle and the right half Player 2's.
- **Controller:** left stick or D-pad moves, right stick tilts, ✕ / R1 / R2 lets go of the magnet, Options pauses.
- **P / Esc** pause, **M** sound on/off.
