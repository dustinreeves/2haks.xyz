# 2haks.xyz

Apps that Dustin and Tripp build and run on **2haks.xyz**, a small shared server.
Each app has its own subdomain, and [projects.2haks.xyz](https://projects.2haks.xyz) has a card for every one.

This repo is a read-only mirror. The real code lives in Git repos on the server
and is copied here automatically, about every 5 minutes, after each commit
(see [docs/mirror.md](docs/mirror.md)). Please don't edit `apps/` or `server/` here,
because the next sync will overwrite your changes.

## Apps

<!-- apps:start -->
| App | Live at | By | What it is | Last commit |
|---|---|---|---|---|
| [Boss Builder](apps/bossbuilder/) | [bossbuilder.2haks.xyz](https://bossbuilder.2haks.xyz) | Co-authored | A 2D platformer where you play the boss! Build a trap-filled level, then stop the horde of AI heroes racing for the flag and earn golden coins for new traps, bosses and upgrades. | `9945c81` 2026-10-01, Tripp: Explain squish recovery in help |
| [Chemo Crew Quiz](apps/chemoquiz/) | [chemoquiz.2haks.xyz](https://chemoquiz.2haks.xyz) | Dustin | A chemotherapy quiz made for Courtney's nurse friends: Diedra, Jessica, Jennifer, Austina, Jody, Lisa, Laura, Wendy and Elizabeth. Pick your name, answer 12 random questions (extravasations, nadirs, antidotes, hazardous-drug safety), and learn something from every explanation. | `2717f4a` 2026-10-01, Dustin Reeves: Add Chemo Crew Quiz for Courtney's nurse friends |
| [Gun Designer](apps/gundesigner/) | [gundesigner.2haks.xyz](https://gundesigner.2haks.xyz) | Dustin | Pick a base gun (pistol, SMG, rifle, shotgun or ray gun), bolt on barrels, muzzles, grips, stocks, sights and magazines (rubber duck and actual banana included), paint it, and spin it around in 3D. Save it to the gallery and share the link. | `11a5814` 2026-10-01, Dustin Reeves: Frame the gun a little tighter |
| [home](apps/home/) | not listed yet | Dustin Reeves | No showcase card yet. | `70c951a` 2026-10-01, Dustin Reeves: Add the 2haks.xyz homepage |
| [Pixel](apps/pixel/) | [pixel.2haks.xyz](https://pixel.2haks.xyz) | Dustin | Draw pixel art on a 20×20 or 40×40 grid with pencil, fill, colour picker and select-and-move tools, then save it to a shared gallery or download it as a PNG. | `edd8ed8` 2026-10-01, Dustin Reeves: Note showcase listing in project state |
| [Pod Pile](apps/podcasts/) | [podcasts.2haks.xyz](https://podcasts.2haks.xyz) | Dustin | A podcast player for the biggest shows: Apple's top 100 (overall or by genre), search for anything else, follow shows, queue episodes and pick up where you left off. Every episode streams straight from the creator's own feed, so nothing is copied here. | `d9d78bd` 2026-10-02, Dustin Reeves: Add Pod Pile: podcast player for the biggest shows, streamed from creators |
| [Portal Fan Lab](apps/portal/) | [portal.2haks.xyz](https://portal.2haks.xyz) | Tripp | An unofficial Portal fan game on Tripp's own Fire Raze engine: solve test chambers with a portal gun, cubes, buttons and flings, while GLaDOS judges you and Jim the tiny silent core floats along. | `0c33125` 2026-10-02, Tripp: More Portal-like look: lighting, ceiling panels, chamber sign, portal rims, clean HUD |
| [Portal Quiz](apps/quiz/) | [quiz.2haks.xyz](https://quiz.2haks.xyz) | Tripp | An unofficial Portal fan game quiz: shoot a blue portal onto the right answer, then jump into the orange one. GLaDOS judges you, and Jim the tiny silent core floats along. | `6a7a628` 2026-10-02, Tripp: Keep API idle connections open longer than Caddy to avoid 502s on POST |
| [RADIUS Log Browser](apps/radius/) | [radius.2haks.xyz](https://radius.2haks.xyz) | Dustin | Drop in a Windows NPS RADIUS log and browse, filter and export it. Runs entirely in your browser. | `5596c1b` 2026-10-02, Dustin Reeves: Sync with GitHub fork: new README, screenshot, sample log |
| [2haks Projects](apps/showcase/) | [projects.2haks.xyz](https://projects.2haks.xyz) | Co-authored | The home page for every app Dustin and Tripp build on 2haks.xyz. Each app gets a card showing what it does and how to use its API and CLI. | `083d20a` 2026-10-02, Dustin Reeves: Add radius card |
<!-- apps:end -->

## What's in this repo

| Path | What it is |
|---|---|
| [`apps/<name>/`](apps/) | Each app's code, as committed on the server. Each one has its own `RUNBOOK.md` and `PROJECT_STATE.md`. |
| [`server/Caddyfile`](server/Caddyfile) | The live web server config: one block per subdomain. |
| [`server/PORTS.md`](server/PORTS.md) | Which local port each app uses. |
| [`docs/server.md`](docs/server.md) | How the server is set up. |
| [`docs/new-app.md`](docs/new-app.md) | Checklist for launching a new app. |
| [`docs/mirror.md`](docs/mirror.md) | How this repo is kept up to date. |
| [`scripts/sync.py`](scripts/sync.py) | The mirror script. |
