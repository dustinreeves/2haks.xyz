#!/usr/bin/env bash
# Set up order emails through Outlook/Hotmail (SMTP). Run it yourself, in a real terminal:
#   ssh -t 2haks /opt/apps/trippsdelivery/deploy/set-smtp.sh
# It asks for your Outlook address and an APP PASSWORD (typing is hidden), writes them to
# .env (not in Git), restarts the API and sends one test email.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env
[ -f "$ENV_FILE" ] || { echo "No .env found in $(pwd)"; exit 1; }

read -r -p "Your Outlook/Hotmail address: " SMTP_USER
read -r -s -p "App password (hidden): " SMTP_PASSWORD; echo
read -r -p "Send orders to [trippreeves@gmail.com]: " NOTIFY_TO
NOTIFY_TO=${NOTIFY_TO:-trippreeves@gmail.com}
[ -n "$SMTP_USER" ] && [ -n "$SMTP_PASSWORD" ] || { echo "Both the address and the app password are needed."; exit 1; }

# Keep every other line (like ADMIN_TOKEN); rewrite in place so the file's owner and mode stay.
TMP=$(mktemp)
grep -v -E '^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|NOTIFY_TO)=' "$ENV_FILE" > "$TMP" || true
{
  printf 'SMTP_HOST=smtp-mail.outlook.com\n'
  printf 'SMTP_PORT=587\n'
  printf 'SMTP_USER=%s\n' "$SMTP_USER"
  printf 'SMTP_PASSWORD=%s\n' "$SMTP_PASSWORD"
  printf 'SMTP_FROM=%s\n' "$SMTP_USER"
  printf 'NOTIFY_TO=%s\n' "$NOTIFY_TO"
} >> "$TMP"
cat "$TMP" > "$ENV_FILE"
rm -f "$TMP"
unset SMTP_PASSWORD

echo "Restarting the API..."
docker compose up -d --force-recreate api > /dev/null 2>&1
sleep 8

echo "Sending a test email to $NOTIFY_TO ..."
docker compose exec -T api python - <<'PY'
from app import mailer
try:
    mailer._send_smtp({"id": 0, "name": "Setup test", "water": 1, "dog": 0, "lawn": 0, "total": 2})
    print("SUCCESS: test email sent. Check the inbox (and Spam).")
except Exception as exc:
    print("FAILED:", type(exc).__name__, exc)
PY
