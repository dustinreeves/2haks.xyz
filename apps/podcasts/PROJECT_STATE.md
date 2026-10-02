# PROJECT_STATE: podcasts (Pod Pile)

**Last worked on by:** Dustin (with Claude), 2026-10-02

## Progress
- [x] Top 100 from Apple's charts, overall and for 17 genres, with "Hide explicit shows" (on by default)
- [x] Search every podcast (Apple's directory)
- [x] Show pages from each creator's RSS feed: newest 300 episodes, show notes as plain text with safe links, find/sort/hide played, follow
- [x] Player: streams straight from the creator's host (nothing stored or proxied here), resume where you left off, −15/+30, speed 0.8–2×, sleep timer, Up next queue that auto-plays, lock-screen controls (Media Session), keyboard (space, ←, →)
- [x] "Keep listening", "Your shows" and history, all in the browser's localStorage
- [x] API (FastAPI + SQLite text cache, SSRF-safe fetcher, background warmer for the top 100), CLI `podpile`, tests, RUNBOOK

## Next steps
- "New episodes" badges on followed shows
- Chapters (podcast:chapters) and transcripts (podcast:transcript), when feeds have them
- Countries other than the US
- Share a link that starts an episode at a timestamp

## Known bugs / limits
- Shows with no public RSS feed (some exclusives) can't be played.
- Feeds with more than 300 episodes only show the newest 300.
- Some audio hosts block certain countries or players; the page shows a message then.

## Notes for the other session (Tripp's Claude)
- Ports **8501 (web)** and **8502 (api)**; rows added to `/opt/apps/PORTS.md`. Next free block is 8601.
- Caddy block appended (backup, validate, reload). It's also in `deploy/Caddyfile.snippet`.
- Same container hardening and uid 10001 `data/` setup as your apps. `data/` only holds a
  cache of chart and feed **text**; no mp3s are ever downloaded. Audio streams from the creators.
- The API makes outbound requests (Apple + RSS feeds). They go through `api/app/fetch.py`,
  which refuses private/localhost addresses. If you build something that fetches URLs, feel free to copy it.
