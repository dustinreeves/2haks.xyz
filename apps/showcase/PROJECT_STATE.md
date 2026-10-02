# PROJECT_STATE: showcase

**Last worked on by:** Tripp (with Claude), 2026-10-02

## Progress
- [x] API (FastAPI, read-only): `/api/health`, `/api/projects`, `/api/projects/{slug}`, docs at `/api/docs`
- [x] Web frontend (static HTML/CSS/JS in nginx-unprivileged), separate from the API
- [x] CLI `showcase` (list / show / validate / add), using the same validation code as the API (`api/app/cards.py`)
- [x] docker-compose with both services on `web-proxy`, ports on 127.0.0.1 only, hardened containers
- [x] Caddy site block for projects.2haks.xyz (see `deploy/Caddyfile.snippet`)
- [x] First card: the showcase itself (Co-authored)
- [x] RUNBOOK.md, unit tests for card validation
- [x] 2026-10-02: `showcase edit <slug>` and `showcase remove <slug>` (confirm by typing the slug, or `--yes`), with tests in `api/tests/test_cli.py`
- [x] 2026-10-02: checked that all 10 live app subdomains have a valid card

## Next steps
- API tests with FastAPI's TestClient (needs `httpx`; currently only `cards.py` is unit-tested)
- Add a card for each new app as it launches

## Known bugs
- None known.

## Notes for the other session (Dustin's Claude)
- **Caddy is on the host, so it can't reach containers by name over `web-proxy`.** Apps publish on `127.0.0.1:<port>` and Caddy proxies to that. Showcase uses 8001 (web) and 8002 (api); please pick the next free ports for new apps. Never publish on 0.0.0.0, because Docker's published ports skip UFW.
- The default `:80` block in the Caddyfile was left alone. The showcase block was appended after it.
- The API container mounts the whole app folder read-only at `/data` (not just `projects.json`), because a single-file bind mount would stay on the old copy after a rename-replace (CLI saves, `git checkout`).
- The repo uses `core.sharedRepository=group`. Files were created by user `tripp`, so Git may say "dubious ownership" for dustin. Fix just for dustin: `git config --global --add safe.directory /opt/apps/showcase`.
- Still to do: Dustin should confirm the server's SSH host key fingerprint with Tripp (`SHA256:VvnLe/uUpSjomKmuNJu/cgjvvUBBGtWlcWoxYI6+Lo8`).
- **Dustin's session, 2026-10-01 ~23:18:** while deploying Pixel, it replaced the whole Caddyfile and dropped the projects.2haks.xyz block for about 10 minutes. The block is restored exactly as it was, and the Caddyfile header now says to append, never replace. Sorry! The Pixel card was added with `showcase add`.
- `/opt/apps/PORTS.md` now lists every port in use (8001, 8002, 8101). Please add a row there for each new app.
- Host key fingerprint confirmed from Dustin's machine: it matches.

- 2026-10-02: radius and sdwan cards (and their apps) left 2haks and live on a separate private site; the old radius/sdwan.2haks.xyz addresses just redirect. Nothing to do.
