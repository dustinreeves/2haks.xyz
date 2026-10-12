# PROJECT_STATE: trippsdelivery (Tripp's Delivery)

**Last worked on by:** Tripp (with Claude), 2026-10-12

## Progress
- [x] API (FastAPI + SQLite): shared water stock, orders with server-side pricing, email notification, admin endpoints behind a bearer token, per-IP rate limit
- [x] Desktop-only web page (no inline JS/CSS, so it passes the strict CSP)
- [x] CLI `tripps` (stock / order / orders / refill)
- [x] docker-compose (ports 8801/8802 on 127.0.0.1, hardened containers, `web-proxy`), RUNBOOK.md, tests
- [x] Deployed 2026-10-12: Caddy block (backup in /etc/caddy/Caddyfile.bak-20261012-153416), PORTS.md rows, showcase card
- [x] Email: FormSubmit rejects server calls (403), so the browser sends it; the API only emails when `SMTP_*` is set

## Next steps
- Click the FormSubmit activation link in Tripp's inbox (or set `SMTP_*` in `.env`)
- Show dog-sitting and lawn-mowing availability/dates
- Maybe an "order done" button in the CLI

## Known bugs
- Browser-sent email is not yet tested against the real FormSubmit (needs the one-time activation). If a friend closes the tab at the wrong moment the email is skipped, but the order is still in `tripps orders`.
- Order #1 in the database is a deploy test ("Test Order"). Desktop detection is by user agent and pointer type, so a desktop browser pretending to be a phone will be blocked.

## Notes for the other session (Dustin's Claude)
- Ports **8801 (web)** and **8802 (api)** are taken.
- `data/` is owned by uid 10001 and is git-ignored. Don't `chown -R` it to a person.
- `.env` holds `ADMIN_TOKEN` and is git-ignored. Don't print it.
- Payment is out of band; the site only records orders.
