# How the server is set up

- **Host:** a Vultr VPS running Ubuntu 24.04.
- **People:** Linux users `dustin` and `tripp`. Both are in the `2haks` and `docker` groups.
  Each of them usually works through their own Claude session, so check what's on the
  server before you change anything: the other person may have changed it.
- **Web server:** [Caddy](https://caddyserver.com/) runs on the host (systemd, not Docker).
  It gets HTTPS certificates automatically and sends each subdomain to an app.
- **Apps:** each app runs in Docker Compose under `/opt/apps/<name>`.

## Network layout

```
Internet ─► Caddy (host, :443) ─┬─ projects.2haks.xyz   ─► 127.0.0.1:8001 / 8002   showcase
                                ├─ pixel.2haks.xyz      ─► 127.0.0.1:8101          pixel
                                └─ <app>.2haks.xyz      ─► 127.0.0.1:<port>        ...
```

- Caddy runs on the host, so it can't reach containers by name. Every app publishes its
  ports on `127.0.0.1:<port>` and Caddy proxies to that.
- **Never publish on `0.0.0.0`.** Docker-published ports skip the UFW firewall.
- The live port list is [`server/PORTS.md`](../server/PORTS.md) (copied from `/opt/apps/PORTS.md`).
- Containers can also join the shared external Docker network `web-proxy`.

## Folders and permissions

- `/opt/apps` belongs to `root:2haks` with mode `2775` (setgid), and `umask 002` is set for
  everyone in `/etc/profile.d`. So both people can edit every app.
- Each app folder is an ordinary (non-bare) Git repo with
  `receive.denyCurrentBranch=updateInstead`, so a `git push` updates the files on the server.
- If Git says "dubious ownership" for a repo the other person created:
  `git config --global --add safe.directory /opt/apps/<name>`.

## Deploying an app

From your own computer, with the server added as a remote named `vps`:

```bash
git push vps main
ssh 2haks 'cd /opt/apps/<name> && docker compose up -d --build'
```

## Editing the Caddyfile

`/etc/caddy/Caddyfile` holds everyone's sites. **Only append a block for your app. Never
replace the whole file.** A full replace once took projects.2haks.xyz down for 10 minutes.

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F-%H%M%S)
# append your block
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
