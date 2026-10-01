#!/usr/bin/env python3
"""pixel: look at and download drawings from the command line.

Uses only the Python standard library, so it runs anywhere with Python 3.10+.

    python cli/pixel.py list
    python cli/pixel.py show 3f9a1c2e
    python cli/pixel.py export 3f9a1c2e cat.png --scale 20
    python cli/pixel.py delete 3f9a1c2e --token <edit token>

Point it at another server with --url or the PIXEL_URL environment variable.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

DEFAULT_URL = os.environ.get("PIXEL_URL", "https://pixel.2haks.xyz")


def request(base, path, method="GET", headers=None):
    req = urllib.request.Request(base.rstrip("/") + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.read(), res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", e.reason)
        except ValueError:
            detail = e.reason
        sys.exit(f"error: {e.code} {detail}")
    except urllib.error.URLError as e:
        sys.exit(f"error: can't reach {base} ({e.reason})")


def get_json(base, path):
    body, _ = request(base, path)
    return json.loads(body)


def cmd_list(args):
    drawings = get_json(args.url, f"/api/drawings?limit={args.limit}")
    if not drawings:
        print("No drawings yet.")
        return
    for d in drawings:
        when = datetime.fromtimestamp(d["updated"]).strftime("%Y-%m-%d %H:%M")
        size = f'{d["size"]}x{d["size"]}'
        print(f'{d["id"]}  {size:>5}  {when}  {d["title"]}  ({d["author"] or "anonymous"})')


def cmd_show(args):
    """Draw it in the terminal. Each character shows two pixels stacked: the top
    one as the text colour of '▀' and the bottom one as the background."""
    d = get_json(args.url, f'/api/drawings/{args.id}')
    size, px = d["size"], d["pixels"]

    def rgb(p):
        return tuple(int(p[i:i + 2], 16) for i in (1, 3, 5)) if p else None

    print(f'{d["title"]} by {d["author"] or "anonymous"} ({size}x{size})')
    for y in range(0, size, 2):
        line = []
        for x in range(size):
            top = rgb(px[y * size + x])
            bottom = rgb(px[(y + 1) * size + x]) if y + 1 < size else None
            fg = f"\x1b[38;2;{top[0]};{top[1]};{top[2]}m" if top else "\x1b[39m"
            bg = f"\x1b[48;2;{bottom[0]};{bottom[1]};{bottom[2]}m" if bottom else "\x1b[49m"
            line.append(fg + bg + ("▀" if top else " "))
        print("".join(line) + "\x1b[0m")


def cmd_export(args):
    body, _ = request(args.url, f"/api/drawings/{args.id}/png?scale={args.scale}")
    with open(args.out, "wb") as f:
        f.write(body)
    print(f"Saved {args.out}")


def cmd_delete(args):
    request(args.url, f"/api/drawings/{args.id}", method="DELETE", headers={"X-Edit-Token": args.token})
    print(f"Deleted {args.id}")


def cmd_health(args):
    print(json.dumps(get_json(args.url, "/api/health")))


def main():
    p = argparse.ArgumentParser(prog="pixel", description="Pixel art from the command line.")
    p.add_argument("--url", default=DEFAULT_URL, help=f"server (default {DEFAULT_URL})")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("list", help="list recent drawings")
    s.add_argument("--limit", type=int, default=30)
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="draw one in the terminal")
    s.add_argument("id")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("export", help="download one as a PNG")
    s.add_argument("id")
    s.add_argument("out", help="file to write, e.g. art.png")
    s.add_argument("--scale", type=int, default=16, help="how many image pixels per drawing pixel (1-32)")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("delete", help="delete one you made (needs its edit token)")
    s.add_argument("id")
    s.add_argument("--token", required=True)
    s.set_defaults(func=cmd_delete)

    s = sub.add_parser("health", help="check the server is up")
    s.set_defaults(func=cmd_health)

    args = p.parse_args()
    if sys.platform == "win32":
        os.system("")  # turns on colour codes in the Windows console
        sys.stdout.reconfigure(encoding="utf-8")
    args.func(args)


if __name__ == "__main__":
    main()
