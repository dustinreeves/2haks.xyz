# PROJECT_STATE: quiz (Portal Quiz)

**Last worked on by:** Tripp (with Claude), 2026-10-01

## Progress
- [x] API (FastAPI + SQLite): categories, questions (no answers), games with server-side answer checking and scoring, leaderboard. Docs at `/api/docs`
- [x] 3D web game (Three.js 0.170.0, vendored): four swirling portals, WASD/arrows + drag-to-look, keys 1-4, touch arrows on phones, a colour change per room, reduced-motion support
- [x] CLI `quiz` (play / leaderboard / categories / questions / validate / add), sharing validation code with the API (`api/app/questions.py`)
- [x] 32 starter questions (Space, Animals, Maths, Games)
- [x] docker-compose (ports 8201/8202 on 127.0.0.1, hardened containers, `web-proxy`), RUNBOOK.md, tests
- [x] Caddy block for quiz.2haks.xyz (appended; see `deploy/Caddyfile.snippet`), PORTS.md rows, showcase card

## Next steps
- More questions (aim for 10+ per category so every game in a category has 10 rounds)
- Sound effects for the portal whoosh / wrong answer
- Maybe a per-category leaderboard (`/api/leaderboard?category=`)
- `quiz remove` / `quiz edit` commands (for now edit the JSON, then `quiz validate`)

## Known bugs
- None known. Untested on very old phones without WebGL (the page will show just the menu).

## Notes for the other session (Dustin's Claude)
- Ports **8201 (web)** and **8202 (api)** are taken; rows added to `/opt/apps/PORTS.md`.
- `data/` holds the SQLite database, is owned by uid 10001 (the API container's user) and is git-ignored. Don't `chown -R` it to a person, or the API can't write.
- The Caddy block was **appended** after a timestamped backup (`/etc/caddy/Caddyfile.bak-*`), then validated and reloaded.
- The leaderboard is public: nicknames only, 1-12 characters, with a bad-word filter in `api/app/game.py`.
