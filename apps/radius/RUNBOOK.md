# RUNBOOK: radius (RADIUS Log Browser)

Static site, no Docker. Caddy serves /opt/apps/radius/public at https://radius.2haks.xyz.
All parsing happens in the visitor's browser (logs contain usernames/MACs, nothing is uploaded; CSP has `connect-src 'none'`).

- Source of truth for the code is also https://github.com/dustinreeves/radius-log-browser (site files at its root; here they live in public/). Keep both in step.
- Deploy: commit in /opt/apps/radius. Files are served live, no build.
- Caddy block: deploy/Caddyfile.snippet (append-only rule, see server docs).
- `public/codes.js` was generated from the original C# tables (packet types, NPS reason codes).
- `public/sample-nps.xml` is a small fake log for trying it out.
