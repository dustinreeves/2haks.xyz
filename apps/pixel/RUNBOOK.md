# Pixel runbook

| | |
|---|---|
| URL | https://pixel.2haks.xyz |
| Server dir | `/opt/apps/pixel` (a git repo; pushes update the files) |
| Container | `pixel` on network `web-proxy` |
| Port | `127.0.0.1:8101` → container `8000` |
| Data | Docker volume `pixel-data` → `/data/pixel.db` (SQLite) |
| Caddy | `pixel.2haks.xyz` block in `/etc/caddy/Caddyfile` |
| Env | `PIXEL_DB` (default `/data/pixel.db`). No secrets. |

## Deploy a change

From your own computer, in your clone:

```bash
git push vps main          # remote: 2haks:/opt/apps/pixel
ssh 2haks 'cd /opt/apps/pixel && docker compose up -d --build'
```

First time on a new computer:

```bash
git clone 2haks:/opt/apps/pixel
cd pixel && git remote rename origin vps
```

The server repo has `receive.denyCurrentBranch=updateInstead`, so a push updates the files in `/opt/apps/pixel` directly. Don't edit files on the server by hand, or the next push will be refused. If you do edit there, commit on the server and `git pull vps main` locally.

## Start, stop, logs

```bash
cd /opt/apps/pixel
docker compose up -d --build    # build and (re)start
docker compose down             # stop (the data volume is kept)
docker compose logs -f --tail 100
docker compose ps               # STATUS should say (healthy)
```

## Health check

```bash
curl -s http://127.0.0.1:8101/api/health          # from the server
curl -s https://pixel.2haks.xyz/api/health        # through Caddy
```

The container also has a Docker HEALTHCHECK on the same endpoint.

## Backup and restore

```bash
# backup
mkdir -p /opt/apps/pixel/backups
docker cp pixel:/data/pixel.db /opt/apps/pixel/backups/pixel-$(date +%F).db

# restore
docker compose stop
docker cp backups/pixel-YYYY-MM-DD.db pixel:/data/pixel.db
docker compose start
```

`backups/` and `*.db` are git-ignored.

## Caddy block

```
pixel.2haks.xyz {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8101
}
```

After editing: `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Removing a drawing as an admin

There's no admin page. Delete straight from the database:

```bash
docker exec pixel python -c "import sqlite3; c=sqlite3.connect('/data/pixel.db'); c.execute('DELETE FROM drawings WHERE id=?', ('<id>',)); c.commit()"
```
