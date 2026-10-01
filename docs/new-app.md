# Launching a new app

1. **Look first.** Check `/opt/apps`, `/opt/apps/PORTS.md` and `/etc/caddy/Caddyfile`.
   The other person may have added something since you last looked.
2. **Make the folder** at `/opt/apps/<name>` and turn it into a Git repo:
   ```bash
   git init -b main /opt/apps/<name>
   git -C /opt/apps/<name> config receive.denyCurrentBranch updateInstead
   ```
3. **Pick ports.** Take the next free number(s), add a row to `/opt/apps/PORTS.md`,
   and publish them on `127.0.0.1` only in `docker-compose.yml`.
4. **Add docs.** Include a `RUNBOOK.md` (how to run, check, and fix it) and a
   `PROJECT_STATE.md` (what's done, what's next, known bugs).
5. **Keep secrets out of Git.** Put them in a `.env` file that's listed in `.gitignore`.
   This whole repo is public on GitHub. The mirror refuses to copy an app if it finds
   anything that looks like a key or token, but don't count on it.
6. **Start it:** `docker compose up -d --build`, then check `docker compose ps` says healthy.
7. **Add a Caddy block** by appending, never replacing (see [server.md](server.md#editing-the-caddyfile)).
8. **Add a showcase card:**
   ```bash
   showcase add --no-input --slug <name> --author Dustin|Tripp|Co-authored ...
   cd /opt/apps/showcase && git add projects.json && git commit -m "Add <name> card"
   ```
9. **Commit.** Within about 5 minutes the app appears in this repo's
   [app table](../README.md#apps).
