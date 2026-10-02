# Pod Pile runbook

**URL:** https://podcasts.2haks.xyz
**Folder:** `/opt/apps/podcasts` (a Git repo on the server)
**What it does:** a podcast player for the biggest shows. It lists Apple's top-100 charts
(overall and by genre), lets you search every podcast, opens each show's RSS feed, and plays
episodes in the browser.

**No audio is stored or proxied here.** The `<audio>` element streams each episode straight
from the creator's own host (the enclosure URL in their feed), so downloads, ads and stats
stay with the creator. The server only fetches and caches *text*: Apple's chart and lookup
JSON, and each show's RSS feed.

## How it fits together

```
Browser ─► Caddy (host) ─┬─ /api/* ─► podcasts-api 127.0.0.1:8502 → :8000  (FastAPI + SQLite cache)
                         └─ /*     ─► podcasts-web 127.0.0.1:8501 → :8080  (nginx, static page)
Browser ─► creator's audio host (mp3/m4a), directly
podcasts-api ─► itunes.apple.com (charts, lookup, search) and each show's RSS feed
```

- `api/app/apple.py` reads Apple's free, keyless endpoints:
  `itunes.apple.com/us/rss/toppodcasts/limit=100[/genre=N]/json` (chart),
  `itunes.apple.com/lookup?id=…` (feed URL, artwork, explicit flag) and `itunes.apple.com/search`.
- `api/app/feeds.py` parses RSS with `defusedxml` (no entity tricks), keeps up to the newest
  300 audio episodes, and turns show notes into **plain text**. The page builds everything
  with DOM calls (never `innerHTML`) and only makes `http(s)` links clickable.
- `api/app/fetch.py` does every outbound GET: public addresses only (checked on every
  redirect, so a feed can't point us at localhost or the cloud metadata address), IPv4 only,
  a 30MB/30s cap, and 6 fetches at a time.
- Cache (`data/cache.db`): chart 6h, lookups 24h, feeds 30 min (refreshed with
  `If-None-Match`/`If-Modified-Since`), search 6h. If a creator's server is down, the last
  copy is served and the page says so. About 3000 rows at most; nothing about visitors.
- **Warmer:** a background thread refreshes the overall top-100 chart and its feeds every
  10 minutes, one feed every 2 seconds, so popular shows open instantly. It logs
  `warmer: refreshed N feeds`.
- Rate limit (in memory only): 120 upstream fetches per visitor per 10 minutes, 1500 in total.
  Cache hits are free.
- Follows, the "Up next" queue, play positions and speed are kept in the visitor's browser
  (`localStorage`), never on the server.
- "Hide explicit shows" is on by default (Apple's explicit flag), because kids use this site.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8501 | 8080 |
| api | 8502 | 8000 |

## Environment variables

| Where | Name | Default | Meaning |
|---|---|---|---|
| api | `PODPILE_DB` | `/var/lib/podpile/cache.db` | `data/` on the host, owned by uid 10001 |
| CLI | `PODPILE_API` | `https://podcasts.2haks.xyz` | API the CLI reads from |

No secrets are needed.

## Build and start / stop

```bash
cd /opt/apps/podcasts
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # both should say (healthy)
docker compose down              # stop
```

`data/` must stay owned by uid 10001 (the API container's user). Don't `chown -R` it to a person.
If it's ever recreated: `sudo install -d -o 10001 -g 2haks -m 2775 data`.
Deleting `data/cache.db` (while stopped) is safe: it's only a cache.

## Health checks and logs

```bash
curl -fsS https://podcasts.2haks.xyz/api/health   # {"status":"ok","cached":N}
curl -fsS http://127.0.0.1:8502/api/health
curl -fsS http://127.0.0.1:8501/healthz
docker compose logs -f api                         # includes "warmer:" lines
docker compose logs -f web
```

## Tests

```bash
docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$PWD":/src -w /src/api python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q -p no:cacheprovider"
```

## CLI

`/usr/local/bin/podpile` is a symlink to `cli/podpile` (Python 3 only, no packages).

```bash
podpile top                      # top 25 overall
podpile top --genre comedy -n 10
podpile genres
podpile search history
podpile show 1200361736          # a show and its newest episodes
podpile play 1200361736 | xargs mpv   # newest episode's audio link
```

## When a show won't load

- `404 Apple doesn't list an RSS feed`: some shows (e.g. Apple/Spotify exclusives) have no public feed. Nothing to do.
- `502 Couldn't load that: …`: the creator's feed host refused or timed out. It usually fixes itself; a cached copy is used when there is one.
- An episode won't play: the creator's audio host refused it (some block certain countries or need a login). The page shows a message; there's no server-side fix, by design.
