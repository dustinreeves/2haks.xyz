# RUNBOOK: sdwan (SD-WAN ADVPN Designer)

Static site, no Docker. Caddy serves /opt/apps/sdwan/public at https://sdwan.2haks.xyz (block in deploy/Caddyfile.snippet).
Everything runs client-side (Pyodide + Jinja2 in a Web Worker); there is no backend, database or secret.

- Deploy: commit in /opt/apps/sdwan. Files are served live, no build step.
- CSP (in the snippet) needs `'wasm-unsafe-eval'` for Pyodide and `worker-src 'self'`. `.wasm` must be served as application/wasm (the snippet sets it).
- Tests: `scripts/test.sh` (engine vs Fortinet oracle) and `scripts/browser-test.sh` (Chromium e2e; pulls a ~3.5 GB Playwright image, `docker rmi` it afterwards to save disk).
- Upgrade Pyodide: `PYODIDE_VERSION=x.y.z scripts/vendor-pyodide.sh`, rerun both tests.
- New Fortinet release: see README ("Adding another release").
- public/vendor/pyodide is ~13 MB of committed binaries (mirrored to the public GitHub repo); change rarely.
