# PROJECT_STATE: portal (Portal Fan Lab + Fire Raze engine)

**Last worked on by:** Tripp (with Claude), 2026-10-02

## Progress
- [x] **Fire Raze** engine (`web/public/fireraze/`): see-through portals with momentum, box physics, chamber builder, realistic lighting (ACES tone mapping, image-based light, soft shadows), code-drawn textures (white tile = Tripp's drawing)
- [x] Game: our own Fire Raze gun model (glowing parts follow the last portal colour, walk bob); portal gun controls (left = blue, right = orange), pick up cubes (E), buttons and doors, goo, fizzlers, exit lift, GLaDOS subtitles (our own lines, no Valve audio/text), Jim the silent core, observation windows, chamber signs, speedrun timer
- [x] 5 chambers: Through the Wall, Cube and Button, Goo Pit, Fling, Fizzler
- [x] API: levels, server-timed runs, fastest-time leaderboard (FastAPI + SQLite); 20 tests
- [x] CLI `portalfan` (levels / show / leaderboard / validate)
- [x] Docker (8301/8302), Caddy block (appended after backup), PORTS.md rows, showcase card, fan-game disclaimer
- [x] Developer mode `?dev` with `fireraze.step()` for testing without the mouse

## Tested in the browser (dev mode)
- Chamber 01 start to finish: shot blue, walked through, came out of the orange portal, reached the exit, server accepted the time.
- Chamber 02: portals to the ledge, picked up the cube, carried it down; the button opened the door.
- Not yet play-tested by hand: 03 Goo Pit, 04 Fling, 05 Fizzler. Please try them with a mouse!

## Next steps
- Hand play-test chambers 03-05 and tune (fling height, jump distances)
- Throwing cubes a bit further; a cube dropper
- Sound effects (our own), a pause menu with mouse sensitivity
- More chambers (see "Making a new chamber" in RUNBOOK.md)

## Known bugs / limits
- Keyboard + mouse only (no phone controls).
- Portals show one level of "portal inside portal" (looking through both at once shows a swirl instead of an endless tunnel).
- The held cube can poke through walls while carried (it drops safely).

## Notes for the other session (Dustin's Claude)
- Ports **8301/8302** are ours. `data/` is owned by uid 10001; don't chown it.
- Caddy block appended at the end of the Caddyfile after a timestamped backup, validated, then reloaded.
- Portal Quiz (`/opt/apps/quiz`, quiz.2haks.xyz) stays up as a separate app.
