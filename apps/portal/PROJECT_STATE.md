# PROJECT_STATE: portal (Portal Fan Lab + Fire Raze engine)

**Last worked on by:** Tripp (with Claude), 2026-10-02 (Portal 2 plan step 1 done)

## Progress
- [x] **Fire Raze** engine (`web/public/fireraze/`): see-through portals with momentum, box physics, chamber builder, realistic lighting (ACES tone mapping, image-based light, soft shadows), code-drawn textures with generated normal + roughness maps (white tile = Tripp's drawing; metal panels, floor tiles, cube, hazard-striped doors)
- [x] Game: our own Fire Raze gun model (glowing parts follow the last portal colour, walk bob); portal gun controls (left = blue, right = orange), pick up cubes (E), buttons and doors, goo, fizzlers, exit lift, GLaDOS subtitles (our own lines, no Valve audio/text), Jim the silent personality core (hangs from an arm on a ceiling rail, follows you, blinks), observation windows, chamber signs, speedrun timer
- [x] 5 chambers: Through the Wall, Cube and Button, Goo Pit, Fling, Fizzler
- [x] API: levels, server-timed runs, fastest-time leaderboard (FastAPI + SQLite); 20 tests
- [x] CLI `portalfan` (levels / show / leaderboard / validate)
- [x] Docker (8301/8302), Caddy block (appended after backup), PORTS.md rows, showcase card, fan-game disclaimer
- [x] Developer mode `?dev` with `fireraze.step()` for testing without the mouse

- [x] Slow-mo (Z), Source-style developer console (`), Portal-gun-style model
- [x] Portal 2 plan, step 1 (engine): post-processing in `fireraze/postfx.js` (HDR + 4x MSAA, bloom, tone map, colour grade + vignette), dynamic resolution, portal views at 75% size, glowing emissive parts; console cvars `mat_disable_bloom`, `mat_vignette`, `mat_postprocess_enable`, `r_dynamic_resolution`. Three.js add-ons vendored in `web/public/vendor/three-addons/` (see its README)
- [x] Cube is a real 3D model with depth (corner bumpers, edge rails, sunken panels, glowing centre)

## Tested in the browser (dev mode)
- Chamber 01 start to finish: shot blue, walked through, came out of the orange portal, reached the exit, server accepted the time.
- Chamber 02: portals to the ledge, picked up the cube, carried it down; the button opened the door.
- Not yet play-tested by hand: 03 Goo Pit, 04 Fling, 05 Fizzler. Please try them with a mouse!

## Next steps
- Portal 2 plan: step 2 chambers (flip panels, elevator, overgrown chamber), 3 puzzles (lasers, light bridges, launch pads, gels), 4 gun, 5 menus
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
