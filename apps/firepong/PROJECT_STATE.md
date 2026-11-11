# PROJECT_STATE: firepong (Fire Pong)

**Last worked on by:** Tripp (with Claude), 2026-11-10 (tilt mechanic added)

## Progress
- [x] Rules in `web/public/pong.js` (no graphics): table, paddles, ball speed-up and hit angles, scoring to 7, serve, computer player (easy / normal / hard)
- [x] 8 power-ups as data files in `content/powerups/`: Big Paddle, Tiny Foe, Slow-Mo, Fireball, Multiball, Shield, Magnet, Portals. The player who hit the ball last gets the one it touches
- [x] Game in `web/public/game.js`: Three.js table with bloom (Fire Raze `lighting.js`, `postfx.js`), sparks, sounds made with Web Audio, menus, pause, controller (Fire Raze `gamepad.js`), touch / mouse drag, two players on one keyboard
- [x] API (FastAPI + SQLite): `/api/health`, `/api/powerups[/{id}]`, `/api/matches`, `/api/leaderboard`; 21 tests pass
- [x] CLI `firepong` (powerups / show / leaderboard / validate)
- [x] Docker (8901/8902, hardened like portal), Caddy block appended after a timestamped backup, PORTS.md rows, showcase card
- [x] `?dev` mode (`firepong.step()`, `firepong.spawn()`)
- [x] 2026-11-10: **Tilt mechanic.** Arrow keys (right stick on a controller) tilt the whole board (`board` group in `game.js`, up to 7 degrees) and the ball rolls downhill (`applyGravity` / `updateTilt` in `pong.js`). Each player has an energy meter (TILT bar). The computer tilts on normal/hard. Paddle keys changed: W / S for player 1, I / K for player 2 (the arrows are now tilt). Rules checked in the page: direction, meter lock/refill, no vertical lock, 900 s of hard-vs-hard with tilt without NaN

## Tested in the browser
- Menu, a computer match, power-up items with labels and status chips, portals, shield, win screen, saving a win to the leaderboard (the test row was deleted afterwards).
- Rules run in the page console: every power-up applies and expires, shield blocks exactly one goal, magnet catches and releases, a win ends the match at 7, and two hard computers played 900 simulated seconds with no stuck or NaN states.
- NOT yet tried: a real keyboard / mouse / controller / phone by hand, sound, and playing a whole match at normal speed. Please try it!

## Next steps
- Hand play-test and tune: ball speed, paddle speed, how often power-ups appear, how hard "hard" is (two hard computers almost never score on each other)
- Hand play-test the tilt: is 7 m/s² too strong or weak? Does the meter drain too fast? How does the computer's tilt feel on normal / hard?
- Tilt on phones (device orientation or on-screen buttons)
- A test file for `pong.js` (needs Node or a browser test page; neither is on the server)
- Online two-player matches (WebSocket), if wanted
- More power-ups (see "Making a new power-up" in RUNBOOK.md)
- Installable app (PWA) like portal has

## Known bugs / limits
- The leaderboard trusts the browser (the server can't watch a match). Limits: 7-0..6 wins only, 15 s..1 h, 20 submissions a minute.
- Only wins against the computer are saved.
- Fire Raze modules are copies of portal's. A fix there won't reach this app by itself.
- Narrow portrait phones show a small table (the camera pulls back to fit the width).

## Notes for the other session (Dustin's Claude)
- Ports **8901/8902** are ours. `data/` is owned by uid 10001; don't chown it.
- Caddy block appended at the end of the Caddyfile after a timestamped backup (`Caddyfile.bak-*`), validated, then reloaded. Nothing else in the Caddyfile was touched.
- The repo uses `core.sharedRepository=group`. If Git says "dubious ownership": `git config --global --add safe.directory /opt/apps/firepong`.
- Server RAM is tight (about 1 GB, mostly used); build one app at a time.
