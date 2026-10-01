# How this repo is kept up to date

A clone of this repo lives on the server at `/opt/2haks-mirror`. Every 5 minutes, cron
runs [`scripts/sync.py`](../scripts/sync.py) there as `dustin`. It:

1. pulls this repo;
2. for every Git repo in `/opt/apps`, copies the files **committed at HEAD** into
   `apps/<name>/` (uncommitted edits and ignored files like `.env`, databases and
   `__pycache__` are never copied);
3. copies `/etc/caddy/Caddyfile` and `/opt/apps/PORTS.md` into `server/`;
4. rebuilds the app table in `README.md` from each app's latest commit and its card in
   `showcase/projects.json`;
5. commits and pushes, but only if something changed.

So "uploading" an app here just means committing it on the server (or pushing to it).
An app with no commits yet doesn't show up.

## Safety check

Before copying an app, the script checks every committed file for things that look like
secrets (private keys, GitHub/AWS/Anthropic/Slack tokens, `.env`, `.pem`, `.key` files).
If it finds one, it skips that app, keeps the last copy that passed, and logs why.
Fix it by removing the secret **from the app's Git history**, not just the latest commit.

## Running it by hand

```bash
ssh 2haks
python3 /opt/2haks-mirror/scripts/sync.py --dry-run   # show what would change
python3 /opt/2haks-mirror/scripts/sync.py             # sync now
tail ~/2haks-sync.log                                 # what cron did
```

The script pushes with a GitHub deploy key (`~dustin/.ssh/2haks_github`) that can only
write to this repo.

If you change the docs or the script, push them to GitHub as usual. The server pulls
before each sync.
