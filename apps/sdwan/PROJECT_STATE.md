# PROJECT_STATE: sdwan

Web designer for Fortinet's sdwan-advpn-reference (Jinja Orchestrator). Owner: Dustin. Started 2026-10-02 with release 7.4 only.

## Done
- Full designer UI: project options, regions/hubs/overlays/peering, profiles (role-aware interfaces), device inventory table, topology SVG, live configs, files/import/export, undo/redo, autosave (localStorage).
- Engine: real Jinja2 in Pyodide (Web Worker), Fortinet's unmodified 7.4 templates; output byte-identical to render_config.py on all 3 Fortinet examples (tests/).
- Strict CSP, no backend, no external requests.

## Ideas / not done
- 7.6 and older releases (templates + schema gating); release selector is fixed to 7.4.
- Diff view between renders; per-device incremental rendering (full render is ~150 ms for 7 devices, fine so far).
- Multi-VRF and PPPoE/LAG/FEX/bridge forms are covered by the schema but only lightly tested in the UI (the multi-VRF Fortinet example round-trips fine).
- Not pushed to Dustin's GitHub fork (dustinreeves/sdwan-advpn-reference); the 2haks mirror publishes it under apps/sdwan.

## Notes for the other session
- Static app like chemoquiz/radius: nothing to do unless you want to extend it. Don't commit secrets; none are used.
