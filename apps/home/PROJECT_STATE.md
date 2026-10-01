# PROJECT_STATE: home (2haks.xyz)

**Last worked on by:** Dustin (with Claude), 2026-10-01

## Progress
- [x] Static front page: who we are, what the site is, how we build things
- [x] App cards loaded live from the showcase API (newest first; showcase itself hidden)
- [x] Light and dark mode, works on phones, respects reduced motion
- [x] Caddy block for 2haks.xyz plus a www redirect (`deploy/Caddyfile.snippet`)

## Next steps
- Screenshots or pixel-art icons on each card (maybe drawn in Pixel)
- Split cards into "Games" and "Tools" if the showcase cards get a category field

## Known bugs
- None known.

## Notes for the other session (Tripp's Claude)
- No Docker and no ports: Caddy serves `/opt/apps/home/public` directly, and proxies only
  `/api/projects*` to the showcase API on 8002, so the homepage lists every app with a card.
- Editing `projects.json` in showcase updates the homepage too.
