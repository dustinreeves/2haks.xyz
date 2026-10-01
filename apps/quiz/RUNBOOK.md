# Portal Quiz runbook

**URL:** https://quiz.2haks.xyz
**Folder:** `/opt/apps/quiz` (a Git repo on the server)
**What it does:** a 3D quiz game. You walk through one of four portals (A-D) to answer. Scores go on a leaderboard.

## How it fits together

```
Browser ─► Caddy (host, systemd) ─┬─ /api/* ─► quiz-api  127.0.0.1:8202 → container :8000  (FastAPI + SQLite)
                                  └─ /*     ─► quiz-web  127.0.0.1:8201 → container :8080  (nginx, static files + Three.js)
```

- Questions live in `content/questions.json` (mounted read-only). The API re-reads it when it changes. If the file breaks, the API keeps the last good copy and `/api/health` says `degraded`.
- Games and the leaderboard live in `data/quiz.db` (SQLite). `data/` is owned by uid 10001 (the container user) and is not in Git.
- The server keeps the right answers. The browser only sees questions and learns "right/wrong", so it can't cheat by reading network traffic.
- Unfinished games are deleted after 2 hours.
- Three.js 0.170.0 is vendored at `web/public/vendor/three-0.170.0.module.min.js` (the CSP only allows scripts from our own site).

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8201 | 8080 |
| api | 8202 | 8000 |

Registered in `/opt/apps/PORTS.md`.

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api container | `QUESTIONS_FILE` | `/content/questions.json` | Set in `docker-compose.yml` |
| api container | `QUIZ_DB` | `/var/lib/quiz/quiz.db` | SQLite file (host: `data/quiz.db`) |
| CLI | `QUIZ_API` | `https://quiz.2haks.xyz` | API the CLI talks to |
| CLI | `QUIZ_QUESTIONS` | `<repo>/content/questions.json` | File the CLI edits |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/quiz
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # status + health
docker compose restart           # restart both
docker compose down              # stop (the database in data/ is kept)
```

Editing `content/questions.json` does **not** need a rebuild. Changing `api/` or `web/` does.

First-time setup only (already done): `sudo install -d -o 10001 -g 2haks -m 2775 data`.

## Health checks

```bash
curl -fsS https://quiz.2haks.xyz/api/health   # {"status":"ok","questions":N}
curl -fsS http://127.0.0.1:8202/api/health     # API without Caddy
curl -fsS http://127.0.0.1:8201/healthz        # web without Caddy
docker compose ps                              # both should say (healthy)
```

## Logs

```bash
docker compose logs -f api       # API requests and errors
docker compose logs -f web       # nginx access log
journalctl -u caddy -f           # Caddy (TLS, proxy errors)
```

Logs rotate at 10 MB × 3 files per container.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | ok / degraded / error |
| GET | `/api/categories` | categories with question counts |
| GET | `/api/questions?category=` | all questions, **without** answers |
| POST | `/api/games` `{"category": null}` | start a game: 10 random questions, choices shuffled |
| POST | `/api/games/{id}/answer` `{"round": 0, "choice": 2}` | right/wrong, points, score |
| POST | `/api/games/{id}/finish` `{"name": "Tripp"}` | put a finished game on the leaderboard |
| GET | `/api/leaderboard?limit=10` | top scores |
| GET | `/api/docs` | interactive docs |

Scoring: right on the first try = 100 + speed bonus (50, minus 2.5 per second). After 1 wrong try = 50, after 2 = 25, after 3 = 0.
Names: 1-12 letters/numbers/space/-/_, with a small bad-word filter.

## CLI

Installed as `/usr/local/bin/quiz` (a symlink to `cli/quiz`, standard library only).

```bash
quiz play                       # play in the terminal
quiz leaderboard
quiz categories
quiz questions --answers        # from the file, * marks the right answer
quiz validate                   # check content/questions.json
quiz add --category Space --question "What colour is Mars?" \
  --choice Red --choice Blue --choice Green --choice White --answer A
```

After `quiz add`, commit it: `git add content/questions.json && git commit -m "Add question"`.

## Tests

```bash
cd /opt/apps/quiz
docker run --rm -v "$PWD":/app:ro -w /app/api -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim \
  sh -c "pip install -q -r requirements.txt -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

## Resetting the leaderboard

```bash
docker compose stop api
sudo mkdir -p data-backups && sudo cp -a data/quiz.db "data-backups/quiz-$(date +%Y%m%d-%H%M%S).db"
sudo rm data/quiz.db data/quiz.db-wal data/quiz.db-shm 2>/dev/null   # a fresh, empty database is made on start
docker compose start api
```
