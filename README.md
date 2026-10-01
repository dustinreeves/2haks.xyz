# 2haks.xyz

Apps that Dustin and Tripp build and run on **2haks.xyz**, a small shared server.
Each app has its own subdomain, and [projects.2haks.xyz](https://projects.2haks.xyz) has a card for every one.

This repo is a read-only mirror. The real code lives in Git repos on the server
and is copied here automatically, about every 5 minutes, after each commit
(see [docs/mirror.md](docs/mirror.md)). Please don't edit `apps/` or `server/` here,
because the next sync will overwrite your changes.

## Apps

<!-- apps:start -->
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
