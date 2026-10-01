# Pixel

Draw pixel art on a 20×20 or 40×40 grid, save it to a shared gallery, and download it as a PNG.

Live at **https://pixel.2haks.xyz**

## Drawing tools

| Tool | Key | What it does |
|---|---|---|
| Pencil | B | Colour one pixel at a time (drag to draw lines) |
| Eraser | E | Make pixels see-through again |
| Fill | F | Pour colour into an area of matching pixels |
| Picker | I | Grab a colour from the picture |
| Select | S | Drag a box, then drag inside it to move those pixels |

With a selection: **Ctrl+C** copy, **Ctrl+X** cut, **Ctrl+V** paste, **Del** delete, **H**/**V** flip, **Esc** drop it.
Anywhere: **Ctrl+Z** undo, **Ctrl+Y** redo, **G** grid on/off, **Ctrl+S** save.
Flip with nothing selected flips the whole picture.

When you save, your browser keeps a secret "edit token" for that drawing. Only that browser can change or delete it. Anyone else who opens it and saves gets their own copy.

## API

Interactive docs: https://pixel.2haks.xyz/docs

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Is it up, and how many drawings |
| GET | `/api/palette` | Allowed sizes and the 16-colour palette |
| GET | `/api/drawings?limit=60` | Newest drawings (no pixels) |
| POST | `/api/drawings` | Save a new one. Returns `edit_token` once |
| GET | `/api/drawings/{id}` | One drawing with its pixels |
| PUT | `/api/drawings/{id}` | Update (header `X-Edit-Token`) |
| DELETE | `/api/drawings/{id}` | Delete (header `X-Edit-Token`) |
| GET | `/api/drawings/{id}/png?scale=10` | PNG, `scale` 1–32 |

A drawing is `{"title", "author", "size": 20|40, "pixels": [...]}`, where `pixels` has `size × size` entries, row by row, each `"#rrggbb"` (lowercase) or `null` for see-through.

```bash
curl -s https://pixel.2haks.xyz/api/drawings | head
curl -so art.png "https://pixel.2haks.xyz/api/drawings/<id>/png?scale=16"
```

## CLI

Needs only Python 3.10+, no installs.

```bash
python cli/pixel.py list
python cli/pixel.py show <id>              # draws it in your terminal in colour
python cli/pixel.py export <id> art.png --scale 20
python cli/pixel.py delete <id> --token <edit token>
```

Use `--url http://localhost:8101` (or set `PIXEL_URL`) to talk to another server.

## Developing

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
PIXEL_DB=./dev.db .venv/bin/uvicorn app.main:app --reload --port 8765
```

The frontend is plain HTML/CSS/JS in `app/static/`, with no build step. Deploying is covered in [RUNBOOK.md](RUNBOOK.md).
