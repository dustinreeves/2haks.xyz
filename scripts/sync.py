#!/usr/bin/env python3
"""Mirror every app in /opt/apps into this repo and push it to GitHub.

Runs on the 2haks.xyz server from cron. For each app that is a Git repo it
copies the files committed at HEAD (never uncommitted work, never ignored
files) into apps/<name>/, copies the server's Caddyfile and port registry
into server/, rebuilds the app table in README.md, then commits and pushes.

An app is skipped, and its last mirrored copy kept, if any committed file
looks like a secret (private keys, API tokens, .env files).

Usage: scripts/sync.py [--dry-run]
"""
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APPS_DIR = Path("/opt/apps")
SERVER_FILES = {
    Path("/etc/caddy/Caddyfile"): "server/Caddyfile",
    APPS_DIR / "PORTS.md": "server/PORTS.md",
}
CARDS_APP = "showcase"  # its projects.json describes every app

SECRET_NAME = re.compile(r"(^|/)(\.env(\..*)?|id_(rsa|ed25519|ecdsa)[^/]*|[^/]*\.(pem|key|p12|pfx))$")
SECRET_TEXT = re.compile(
    rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"
    rb"|\bgh[pousr]_[A-Za-z0-9]{30,}"
    rb"|\bgithub_pat_[A-Za-z0-9_]{30,}"
    rb"|\bAKIA[0-9A-Z]{16}\b"
    rb"|\bsk-(ant-)?[A-Za-z0-9_-]{30,}"
    rb"|\bxox[abpr]-[A-Za-z0-9-]{10,}"
)
START, END = "<!-- apps:start -->", "<!-- apps:end -->"


def git(*args, cwd, binary=False):
    out = subprocess.run(
        ["git", "-c", "safe.directory=*", *args],
        cwd=cwd, check=True, capture_output=True,
    ).stdout
    return out if binary else out.decode().strip()


def app_repos():
    for d in sorted(APPS_DIR.iterdir()):
        if not (d / ".git").is_dir():
            continue
        try:
            head = git("rev-parse", "--short", "HEAD", cwd=d)
        except subprocess.CalledProcessError:
            continue  # no commits yet
        yield d, head


def secret_problems(app):
    problems = []
    for name in git("ls-tree", "-r", "--name-only", "HEAD", cwd=app).splitlines():
        if SECRET_NAME.search(name):
            problems.append(f"{name}: secret-looking file name")
            continue
        if SECRET_TEXT.search(git("show", f"HEAD:{name}", cwd=app, binary=True)):
            problems.append(f"{name}: secret-looking content")
    return problems


def mirror_app(app):
    dest = REPO / "apps" / app.name
    tmp = dest.with_name(f".{app.name}.tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    tar = git("archive", "--format=tar", "HEAD", cwd=app, binary=True)
    with tarfile.open(fileobj=io.BytesIO(tar)) as t:
        t.extractall(tmp, filter="data")
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)


def load_cards():
    try:
        raw = git("show", "HEAD:projects.json", cwd=APPS_DIR / CARDS_APP)
        return {p["slug"]: p for p in json.loads(raw)["projects"]}
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return {}


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def app_table(repos, cards):
    rows = [
        "| App | Live at | By | What it is | Last commit |",
        "|---|---|---|---|---|",
    ]
    for app, head in repos:
        card = cards.get(app.name, {})
        when, who, subject = git("log", "-1", "--format=%ad%x00%an%x00%s", "--date=short", cwd=app).split("\0")
        url = card.get("url")
        rows.append("| " + " | ".join([
            f"[{cell(card.get('name', app.name))}](apps/{app.name}/)",
            f"[{url.removeprefix('https://')}]({url})" if url else "not listed yet",
            cell(card.get("author", who)),
            cell(card.get("description", "No showcase card yet.")),
            f"`{head}` {when}, {cell(who)}: {cell(subject)}",
        ]) + " |")
    return "\n".join(rows)


def update_readme(table):
    readme = REPO / "README.md"
    text = readme.read_text()
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    readme.write_text(f"{before}{START}\n{table}\n{END}{after}")


def main():
    dry_run = "--dry-run" in sys.argv
    git("pull", "--ff-only", "--quiet", cwd=REPO)

    repos, changed = [], []
    for app, head in app_repos():
        problems = secret_problems(app)
        if problems:
            print(f"SKIP {app.name}: " + "; ".join(problems), file=sys.stderr)
            if (REPO / "apps" / app.name).exists():
                repos.append((app, head))  # keep listing the last good copy
            continue
        mirror_app(app)
        repos.append((app, head))
        if git("status", "--porcelain", "--", f"apps/{app.name}", cwd=REPO):
            changed.append(f"{app.name} {head}")

    for old in (REPO / "apps").glob("[!.]*"):
        if old.is_dir() and not (APPS_DIR / old.name).exists():
            shutil.rmtree(old)
            changed.append(f"remove {old.name}")

    for src, rel in SERVER_FILES.items():
        dest = REPO / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)

    update_readme(app_table(repos, load_cards()))

    git("add", "-A", cwd=REPO)
    status = git("status", "--porcelain", cwd=REPO)
    if not status:
        print("No changes.")
        return
    other = [l[3:] for l in status.splitlines() if not l[3:].startswith("apps/")]
    summary = ", ".join(changed + [f for f in other if f != "README.md"]) or "README"
    message = f"Sync from server: {summary}"
    if dry_run:
        print(f"Would commit: {message}\n{status}")
        return
    git("commit", "--quiet", "-m", message, cwd=REPO)
    git("push", "--quiet", cwd=REPO)
    print(message)


if __name__ == "__main__":
    main()
