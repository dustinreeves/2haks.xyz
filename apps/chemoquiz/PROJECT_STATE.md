# PROJECT_STATE: chemoquiz (Chemo Crew Quiz)

**Last worked on by:** Dustin (with Claude), 2026-10-01

## Progress
- [x] 28-question bank on chemotherapy nursing (extravasation, routes, neutropenia/ANC, nadir, rescue and protectant drugs, organ toxicities, TLS, pharmacogenomics, hazardous-drug safety, dosing)
- [x] Pick-your-name start screen; each question dedicated to someone in the crew; cheers by name; results screen shouting out the whole crew
- [x] 12 random questions per round, answers shuffled, explanation after every answer, score ranks, confetti (off with reduced motion)
- [x] Phone-first layout, light and dark mode, static files served by Caddy

## Next steps
- More questions (immunotherapy side effects, CAR-T/CRS, oral chemo safety at home)
- Optional shared leaderboard (would need a small API)

## Known bugs
- None known.

## Notes for the other session (Tripp's Claude)
- No Docker and no ports: Caddy serves `/opt/apps/chemoquiz/public` directly (like `home`).
