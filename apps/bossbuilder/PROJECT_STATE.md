# PROJECT_STATE: Boss Builder

**Last worked on by:** Tripp (with Claude), 2026-10-01

## Progress
- [x] Level editor: blocks, spikes, lava, slimes, bats, cannons, hero door, flag, boss spot; undo; trap-point budget; horizontal scroll
- [x] Fairness check: a level can't start (or be shared) unless a perfect hero could reach the flag. 👣 Show route draws that route.
- [x] Hero AI: plans with a navigation graph built from the real physics (`nav.js`), then replays the moves. Rookies, Knights and Champions differ in aim, choices, patience and bravery (jumping at or over dangers).
- [x] Bosses you control: Slime King (ground pound), Fire Golem (fireballs), Shadow Dragon (flies, shadow breath). Heroes damage the boss by stomping it. Touch squish has a recovery time.
- [x] 🤖 Auto boss for touch screens (deliberately weaker than a good player); on-screen buttons on touch devices
- [x] Coins: 5 per hero stopped. Shop with unlocks (lava, bat, cannon, 2 bosses) and upgrades (trap points, health, speed, quick attack)
- [x] Waves get bigger and smarter; heroes arrive in packs of 4. Win a wave by stopping more than half.
- [x] Level sharing API (FastAPI + SQLite): codes, generated names (no user text), rate limit, size limit, total cap, dedupe
- [x] CLI `bossbuilder` (health, list, show as text art, get, validate)
- [x] Tests: 10 API/rules tests (`api/tests`), 10 game-logic tests in the browser (`web/tests`)

## Next steps
- Playtest and tune balance (numbers are in `web/public/js/rules.js` and the top of `boss.js`/`world.js`)
- Sound effects and music
- More traps (moving platforms, saw blades, crumbling blocks); these need the nav graph to handle moving things
- A "test play" button that lets you run your own level as a hero
- Show a shared level's preview picture in the Share list

## Known bugs / limits
- Progress lives only in this browser's localStorage. Clearing site data resets coins and unlocks; there's no account or cloud save.
- Hero AI plans from the centre of each tile. Very tight jumps that need an off-centre start are treated as impossible, so the fairness check is a bit strict, never too loose.
- Brave jumps aren't checked against the nav graph, so a brave hero can jump into a trap. That's on purpose (it's funny).
- Bats fly through walls.

## Notes for the other session (Dustin's Claude)
- Rules are duplicated in JS (`web/public/js/rules.js`) and Python (`api/app/levels.py`). `api/tests/test_levels.py` reads `rules.js` and fails if sizes, tile costs, bosses or MAX_BUDGET drift.
- Ports 8102 (web) and 8103 (api) are registered in `/opt/apps/PORTS.md`.
- The `bossbuilder.2haks.xyz` block was appended to `/etc/caddy/Caddyfile` (backup first, validate, reload), as the file's header asks. Thanks for restoring the showcase block!
- If Git complains about "dubious ownership": `git config --global --add safe.directory /opt/apps/bossbuilder`.
