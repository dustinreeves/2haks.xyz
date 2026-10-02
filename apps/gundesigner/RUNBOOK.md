# Gun Designer runbook

**URL:** https://gundesigner.2haks.xyz
**Folder:** `/opt/apps/gundesigner` (a Git repo on the server)
**What it does:** pick a base gun, bolt on parts (barrels, muzzles, grips, stocks, sights,
magazines, underbarrel gadgets), paint it, and view it in 3D. Designs can be saved to a
public gallery with a share code.

## How it fits together

```
Browser ─► Caddy (host) ─┬─ /api/* ─► gundesigner-api 127.0.0.1:8402 → :8000  (FastAPI + SQLite)
                         └─ /*     ─► gundesigner-web 127.0.0.1:8401 → :8080  (nginx, static files + Three.js)
```

- **`content/parts.json` is the whole catalog**: every base gun and part, built from simple
  shapes (boxes, cylinders, spheres, rings), plus stats, finishes and attachment points.
  The 3D page draws straight from it (via `/api/parts`), and the API checks saved designs
  against it. The API re-reads the file when it changes, so **adding a part needs no
  rebuild**: edit the file, run `gundesigner validate`, reload the page.
  If an edit breaks the file, the API keeps the last good copy and `/api/health` says `degraded`.
- The stat and name rules live in two places: `api/app/catalog.py` and
  `web/public/js/rules.js`. Keep them in step (the tests check the names).
- Names are generated from the parts ("Golden Quacking Longboi"). Users can't type any
  text, so the public gallery has nothing to moderate.
- Saving is limited to 30 new designs per visitor per hour (kept in memory only, no IPs
  are stored) and 20,000 designs in total. Saving the same design twice gives back the same code.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8401 | 8080 |
| api | 8402 | 8000 |

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api | `PARTS_FILE` | `/content/parts.json` | `content/` is mounted read-only |
| api | `GUNDESIGNER_DB` | `/var/lib/gundesigner/designs.db` | `data/` on the host, owned by uid 10001 |
| CLI | `GUNDESIGNER_API` | `https://gundesigner.2haks.xyz` | API the CLI reads from |
| CLI | `GUNDESIGNER_PARTS` | `<repo>/content/parts.json` | File `validate` checks |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/gundesigner
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # both should say (healthy)
docker compose down              # stop
```

Changing files under `api/` or `web/` needs `docker compose up -d --build`.
Editing `content/parts.json` doesn't.

`data/` must stay owned by uid 10001 (the API container's user). Don't `chown -R` it to a person.
If it's ever recreated: `sudo install -d -o 10001 -g 2haks -m 2775 data`.

## Health checks and logs

```bash
curl -fsS https://gundesigner.2haks.xyz/api/health   # {"status":"ok","bases":5,"parts":40,"designs":N}
curl -fsS http://127.0.0.1:8402/api/health
curl -fsS http://127.0.0.1:8401/healthz
docker compose logs -f api
docker compose logs -f web
```

## Tests

```bash
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/src -w /src/api python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

## CLI

`/usr/local/bin/gundesigner` is a symlink to `cli/gundesigner` (Python 3 only, no packages).

```bash
gundesigner list                 # newest saved designs
gundesigner show 7kq2mx          # one design with stat bars
gundesigner parts                # the catalog
gundesigner validate             # check content/parts.json after editing it
```

## Adding a part

1. Add an entry to `parts` in `content/parts.json`: `id`, `slot`, `name`, optional `nick`
   (used in generated names), `stats`, `classes` (`pistol` / `long`), `mounts` (if other
   parts attach to it, like a barrel's `muzzle`), and `shapes`. The `_help` note at the top
   of the file explains the shape keys. +x points out of the muzzle, +y is up.
2. `gundesigner validate`, then reload the page.
3. Commit. Saved designs keep working as long as you don't remove or rename part ids.

## Backups

```bash
sqlite3 data/designs.db ".backup data-backups/designs-$(date +%F).db"   # or just copy data/ while stopped
```
