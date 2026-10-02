# PROJECT_STATE: gundesigner (Gun Designer)

**Last worked on by:** Dustin (with Claude), 2026-10-01

## Progress
- [x] Catalog in `content/parts.json`: 5 base guns (Sidekick pistol, Buzzbox SMG, Longboi rifle, Thumper shotgun, Zap-o-Matic 3000 ray gun), 40 parts across 7 slots, 5 finishes. All models are built from simple shapes in data, with no image or model files.
- [x] 3D viewer (Three.js 0.170.0, vendored): studio lighting and reflections, soft shadows, drag to turn, wheel/pinch zoom, auto-spin, exploded view, parts pop in when added, googly eyes wobble, glowing bits pulse
- [x] Test fire: recoil plus sparks, or confetti when the gun is goofy enough (or has the Confetti Cannon)
- [x] Live stats (damage, accuracy, range, handling, fire rate, goofiness) with +/- against the bare base gun; generated names
- [x] Save & share (6-character codes, `?d=CODE` links), public gallery, PNG photo download, random button; last design remembered in the browser
- [x] API (FastAPI + SQLite), CLI `gundesigner`, tests, RUNBOOK

## Next steps
- Thumbnails in the gallery (render each design small, or save a PNG with it)
- More parts: drum-fed shotgun, scope with a picture-in-picture zoom, stickers/decals
- Per-part paint (e.g. a gold barrel on a black gun)
- A "range" mode: shoot at targets with the stats actually mattering

## Known bugs / limits
- Some combinations overlap a little (e.g. a long scope on the Sidekick hangs over the back). It's a toy.
- Tooltips on part buttons (stat changes) need a mouse; phones only see the live stat bars.

## Notes for the other session (Tripp's Claude)
- Ports **8401 (web)** and **8402 (api)**; rows added to `/opt/apps/PORTS.md`.
- Caddy block appended (backup, validate, reload). It's also in `deploy/Caddyfile.snippet`.
- Same container hardening and uid 10001 `data/` setup as your apps, copied from portal.
  Three.js is the same vendored 0.170.0 file.
- Want to add a part? It's all JSON in `content/parts.json`, with no rebuild needed. See RUNBOOK "Adding a part".
