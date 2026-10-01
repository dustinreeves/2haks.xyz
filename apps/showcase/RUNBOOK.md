# Showcase runbook

**URL:** https://projects.2haks.xyz
**Folder:** `/opt/apps/showcase` (a Git repo on the server)
**What it does:** shows a card for every app on 2haks.xyz. The cards live in `projects.json`.

## How it fits together

```
Browser ─► Caddy (host, systemd) ─┬─ /api/* ─► showcase-api  127.0.0.1:8002 → container :8000  (FastAPI)
                                  └─ /*     ─► showcase-web  127.0.0.1:8001 → container :8080  (nginx, static files)
```

- Caddy runs on the host, not in Docker, so it reaches the containers through ports that only the server itself can use (`127.0.0.1`).
- Both containers are also on the shared external `web-proxy` network.
- The API can only read `projects.json`. It re-reads the file when it changes, so new cards show up without a restart.
- If someone saves a broken `projects.json`, the API keeps showing the last good version and `/api/health` reports `degraded`.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8001 | 8080 |
| api | 8002 | 8000 |

New apps should use the next free ports. Check with `ss -ltn`.

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api container | `PROJECTS_FILE` | `/data/projects.json` | Set in `docker-compose.yml`. The app folder is mounted read-only at `/data`. |
| CLI | `SHOWCASE_API` | `https://projects.2haks.xyz` | API the CLI reads from |
| CLI | `SHOWCASE_FILE` | `<repo>/projects.json` | File the CLI edits |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/showcase
docker compose up -d --build     # build images and start (or update after a code change)
docker compose ps                # status + health
docker compose restart           # restart both
docker compose down              # stop and remove containers
```

Editing `projects.json` does **not** need a rebuild or restart. Changing files under `api/` or `web/` does need `docker compose up -d --build`.

## Health checks

```bash
curl -fsS https://projects.2haks.xyz/api/health   # {"status":"ok","projects":N}
curl -fsS http://127.0.0.1:8002/api/health         # API without Caddy
curl -fsS http://127.0.0.1:8001/healthz            # web without Caddy
docker compose ps                                  # both should say (healthy)
```

`/api/health` returns `ok` (200), `degraded` (200, serving the last good copy, with `detail`) or `error` (503, nothing to serve).

## Logs

```bash
docker compose logs -f api       # API requests and projects.json problems
docker compose logs -f web       # nginx access log
journalctl -u caddy -f           # Caddy (HTTPS certificates, proxy errors)
```

Docker keeps at most 3 × 10 MB of logs per container.

## Managing cards (CLI)

`/usr/local/bin/showcase` is a symlink to `cli/showcase`. It needs only Python 3, no extra packages.

```bash
showcase list                       # from the live API
showcase show showcase
showcase --local list               # read projects.json directly (works even if the API is down)
showcase validate                   # check projects.json
showcase add                        # asks questions, checks the answers, then saves
showcase add --no-input --slug my-app --name "My App" --author Tripp \
  --description "What it does." --api-example "curl https://my-app.2haks.xyz/api/health"
```

Then commit: `git add projects.json && git commit -m "Add my-app card"`.

A card has `slug`, `name`, `launch_date` (YYYY-MM-DD), `url` (https), `description` (≤300 chars), `author` (`Dustin` | `Tripp` | `Co-authored`) and `examples` (`{"api": [...], "cli": [...]}`; a list may be empty).

## Tests

```bash
cd /opt/apps/showcase/api && python3 -m unittest discover -s tests
```

## Caddy

The site block is kept in `deploy/Caddyfile.snippet` and was appended to `/etc/caddy/Caddyfile`. To change it:

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
sudoedit /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && sudo caddy reload --config /etc/caddy/Caddyfile
```

## Permissions

Everything belongs to group `2haks` and is group-writable:

```bash
sudo chgrp -R 2haks /opt/apps/showcase && sudo chmod -R g+rw /opt/apps/showcase
```
