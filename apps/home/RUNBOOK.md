# Home runbook

**URL:** https://2haks.xyz (www.2haks.xyz redirects here)
**Folder:** `/opt/apps/home` (a Git repo on the server)
**What it does:** the front page for 2haks.xyz. It says who we are and lists every app.

## How it fits together

```
Browser ─► Caddy (host) ─┬─ /api/projects* ─► showcase-api 127.0.0.1:8002  (the app list)
                         └─ everything else ─► static files in /opt/apps/home/public
```

- No Docker and no ports of its own. Caddy serves `public/` straight from disk.
- The app cards come from the showcase API, so any app with a showcase card
  (`showcase add ...`) shows up here automatically. The `showcase` card itself is hidden.
- If the API is down, the page shows a link to projects.2haks.xyz instead of cards.

## Changing the page

Edit `public/index.html`, `public/style.css` or `public/app.js`, then commit.
That's all: no build and no restart. A hard refresh in the browser shows the change.

```bash
git push vps main      # from a local clone, or commit directly on the server
```

## Caddy

The site block is in `deploy/Caddyfile.snippet`, and it's appended to `/etc/caddy/Caddyfile`.
If it ever goes missing, append it again (never replace the whole file):

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F-%H%M%S)
cat deploy/Caddyfile.snippet | sudo tee -a /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

## Checks

```bash
curl -fsSI https://2haks.xyz/                 # 200
curl -fsS https://2haks.xyz/api/projects      # JSON list of apps
curl -sI https://www.2haks.xyz/ | grep -i location   # -> https://2haks.xyz/
```

Caddy needs to read the files, so keep `public/` world-readable (the default with umask 002).
