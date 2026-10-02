# RUNBOOK: radius (RADIUS Log Browser)

Static site, no Docker. Caddy serves /opt/apps/radius/public at https://radius.2haks.xyz.
All parsing happens in the visitor's browser (logs contain usernames/MACs, nothing is uploaded; CSP has `connect-src 'none'`).

- Deploy: commit in /opt/apps/radius. Files are served live, no build.
- Caddy block: deploy/Caddyfile.snippet (append-only rule, see server docs).
- `public/codes.js` was generated from the original C# tables (packet types, NPS reason codes).
- `public/sample.log` is a tiny fake log for trying it out.
