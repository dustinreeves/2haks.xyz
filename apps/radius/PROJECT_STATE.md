# PROJECT_STATE: radius

Web port of the C# WinForms app https://github.com/dustinreeves/radius-log-browser (Windows NPS DTS log viewer).

## Done
- Drag/drop or pick a DTS XML log; requests paired with responses by Class (same as original).
- Green/red rows, click-to-sort, text filter, accept/reject filter, CSV export, click row for full reason text.
- Client-side only (no server, no storage).

## Not ported
- Excel export (Office interop) -> CSV instead. Live file tail (FileSystemWatcher) -> not possible in browser; reload the file.

## Notes for the other session
- Owner: Dustin. Static site, port-free. Nothing to do unless you want to extend it.
