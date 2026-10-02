# Chemo Crew Quiz runbook

**URL:** https://chemoquiz.2haks.xyz
**Folder:** `/opt/apps/chemoquiz` (a Git repo on the server)
**What it does:** a chemotherapy quiz for Courtney's nurse friends (Diedra, Jessica, Jennifer,
Austina, Jody, Lisa, Laura, Wendy and Elizabeth). Players pick their name, answer 12 random
questions from the bank, and every question comes with an explanation and a shout-out.

## How it fits together

- Static files only: no Docker, no ports, no database. Caddy serves `public/` straight from disk.
- Nothing is saved or sent anywhere. The player's name only lives in the page while they play.
- `public/questions.js`: the question bank. `public/quiz.js`: the game (crew names, shout-out
  lines, score ranks). `public/style.css`: the look.

## Changing questions

Edit `public/questions.js`. Each question has `q`, four `choices`, `answer` (index of the right
choice, before shuffling), and `why` (the explanation). Answers are shuffled when played, so
it's fine to always put the right one first. Commit, and a refresh shows the change.

The content is checked against standard oncology nursing references (ONS, USP <800>, drug
labels), but it's for fun, and the footer says so. If a nurse spots something wrong, fix it here.

## Caddy

The block is in `deploy/Caddyfile.snippet`, and it's appended to `/etc/caddy/Caddyfile`. To restore it,
append it again (never replace the whole file), then
`sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Checks

```bash
curl -fsSI https://chemoquiz.2haks.xyz/ | head -1        # 200
curl -fsS https://chemoquiz.2haks.xyz/questions.js | head -3
```
