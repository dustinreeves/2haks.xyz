# Project state: Pixel

_Last updated 2026-10-01 by Dustin's Claude session._

## Where it's at

Version 1 is live at https://pixel.2haks.xyz.

- Web editor: 20×20 and 40×40 canvases, a 16-colour palette (PICO-8) plus a custom colour picker.
- Tools: pencil, eraser, fill, picker, and rectangle select (move, copy, cut, paste, delete, flip). Undo/redo keeps 100 steps.
- Your current drawing autosaves in the browser (localStorage), so a reload doesn't lose it.
- Gallery: saving puts the drawing in a shared gallery. A per-drawing edit token, kept in the browser that made it, controls who can change or delete it.
- PNG download, both in the browser and from the API.
- API (FastAPI, SQLite) with docs at `/docs`.
- CLI `cli/pixel.py` (stdlib only): list, show (colour terminal art), export, delete, health.
- 11 API tests in `tests/`, all passing.
- Listed on https://projects.2haks.xyz (added with Tripp's `showcase add` CLI).

## Ideas for next steps

- Line and rectangle/circle shape tools
- Mirror (symmetry) drawing mode
- More canvas sizes, or resizing a drawing without losing it
- Animated frames and GIF export
- `pixel import <png>` in the CLI to turn a small image into a drawing

## Known issues and tech debt

- No accounts. Anyone can post to the gallery, and nothing limits spam or volume. Fine for family use; add a rate limit or login before sharing it widely.
- Edit tokens live only in localStorage. Clearing browser data means you can't edit your old drawings anymore (you can still copy them).
- Flipping a selection several times is one undo step from before the first lift, not one per flip.
- Moving pixels past the canvas edge deletes the part that went off when you drop them.
- The frontend has no automated tests. It was checked by hand (draw, fill, select/move, paste, flip, undo/redo, save, gallery, phone width).

## Notes for the next session

- Deploy flow is in RUNBOOK.md: `git push vps main`, then `docker compose up -d --build` on the server.
- Port 8101 is taken by this app. See `/opt/apps/PORTS.md` before picking a port for a new app.
- The palette lives in two places, `app/main.py` (`PALETTE`) and the fallback list at the bottom of `app/static/app.js`. Change both.
