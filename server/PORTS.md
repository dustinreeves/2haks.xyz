# Port registry

Apps listen on 127.0.0.1 only (never 0.0.0.0: Docker-published ports skip UFW).
Caddy runs on the host and forwards each subdomain to its port.
Take the next free number, add a row here, and append (never replace) your block in /etc/caddy/Caddyfile.

| Port | App | Service | Subdomain |
|---|---|---|---|
| 8001 | showcase | web (nginx) | projects.2haks.xyz |
| 8002 | showcase | api | projects.2haks.xyz/api/* |
| 8101 | pixel | app | pixel.2haks.xyz |
| 8102 | bossbuilder | web (nginx) | bossbuilder.2haks.xyz |
| 8103 | bossbuilder | api | bossbuilder.2haks.xyz/api/* |
| 8201 | quiz | web (nginx) | quiz.2haks.xyz |
| 8202 | quiz | api | quiz.2haks.xyz/api/* |
