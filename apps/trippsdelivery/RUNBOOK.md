# Tripp's Delivery runbook

**URL:** https://trippsdelivery.2haks.xyz
**Folder:** `/opt/apps/trippsdelivery` (a Git repo on the server)
**What it does:** an order page for friends. They type their name and pick water ($2 each, shared stock), dog sitting ($95 for 2 days) or lawn mowing ($39). The order is saved, the water stock goes down, and Tripp gets an email. Desktop computers only (phones and tablets see a "use a computer" message). Payment happens outside the site.

`web/public/water.png` is Brookshire's own product photo of their purified drinking water (24-count, 16.9 oz), from https://www.brookshires.com/product/brookshires-purified-drinking-water-id-00092825092742. It belongs to Brookshire's; we only show it next to the water item.

## How it fits together

```
Browser ─► Caddy (host, systemd) ─┬─ /api/* ─► trippsdelivery-api  127.0.0.1:8802 → container :8000  (FastAPI + SQLite)
                                  └─ /*     ─► trippsdelivery-web  127.0.0.1:8801 → container :8080  (nginx, static files)
```

- Prices are fixed in `api/app/store.py` (`PRICES`). The server works out the total, so the browser can't change it.
- Stock and orders live in `data/delivery.db` (SQLite). `data/` is owned by uid 10001 (the container user) and is not in Git.
- Water is taken out of stock and the order saved in one transaction, so two friends can't buy the last bottle twice.
- Email: if `SMTP_HOST` is set the API sends through SMTP. Otherwise the API answers `emailed: false` and the **browser** sends the email through FormSubmit (`web/public/app.js`, allowed by `connect-src` in `web/nginx.conf`). FormSubmit returns 403 to requests from servers, so it can't be called from the API. A failed email never loses the order. `tripps orders` shows `NOT emailed` whenever the API itself didn't send it, which is every order until SMTP is set up.
- Each address may place 10 orders per hour.

## Ports

| Service | Host (127.0.0.1 only) | Container |
|---|---|---|
| web | 8801 | 8080 |
| api | 8802 | 8000 |

Registered in `/opt/apps/PORTS.md`.

## Environment variables

Set in `/opt/apps/trippsdelivery/.env` (not in Git; mode 660, group `2haks`).

| Name | Default | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | none | Needed for `GET /api/orders` and `PUT /api/stock`. Empty switches admin off |
| `NOTIFY_TO` | `trippreeves@gmail.com` | Where order emails go |
| `SMTP_HOST` | unset | Set to have the API send email itself (then the browser fallback is skipped) |
| `SMTP_PORT` | `587` | STARTTLS port |
| `SMTP_USER`, `SMTP_PASSWORD` | unset | SMTP login (required with `SMTP_HOST`) |
| `SMTP_FROM` | `SMTP_USER` | From address |
| `TRIPPS_DB` | `/var/lib/trippsdelivery/delivery.db` | Set in `docker-compose.yml` |

CLI: `TRIPPS_API` (default the live site), `TRIPPS_TOKEN` (admin token; falls back to `ADMIN_TOKEN` in `.env`).

## Build and start / stop

```bash
cd /opt/apps/trippsdelivery
docker compose up -d --build     # build and start (or update after a code change)
docker compose ps                # status + health
docker compose restart           # restart both
docker compose down              # stop (the database in data/ is kept)
```

First-time setup only: `sudo install -d -o 10001 -g 2haks -m 2775 data`, then create `.env` with `ADMIN_TOKEN=$(openssl rand -hex 24)`.

## FormSubmit activation (one time)

The first order email sent from a browser makes FormSubmit send an "Activate" link to trippreeves@gmail.com. Click it once. Until then orders are still saved (see `tripps orders`). The address is hard-coded in `web/public/app.js` and is visible to anyone who views the page source.

## Health checks

```bash
curl -fsS https://trippsdelivery.2haks.xyz/api/health   # {"status":"ok","water":N}
curl -fsS http://127.0.0.1:8802/api/health               # API without Caddy
curl -fsS http://127.0.0.1:8801/healthz                  # web without Caddy
docker compose ps                                        # both should say (healthy)
```

## Logs

```bash
docker compose logs -f api
docker compose logs -f web
sudo journalctl -u caddy -f
```

## CLI

```bash
cli/tripps stock
cli/tripps order "Sam" -w 3 -d 1
cli/tripps orders -n 10
cli/tripps refill 24
```

## API

`GET /api/stock`, `POST /api/orders` `{name, water, dog, lawn}`, `GET /api/orders` (admin), `PUT /api/stock` `{water}` (admin). Docs at `/api/docs`.

## Tests

```bash
cd api && pip install -r requirements-dev.txt && python -m pytest
```
