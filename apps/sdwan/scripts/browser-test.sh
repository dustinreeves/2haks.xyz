#!/bin/sh
# Headless-Chromium end-to-end test (needs docker; pulls the Playwright image on first use, ~3.5 GB).
set -e; cd "$(dirname "$0")/.."; OUT=${1:-/tmp/sdwan-shots}; mkdir -p "$OUT"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$(pwd)":/app:ro -v "$OUT":/out -w /tmp mcr.microsoft.com/playwright:v1.49.0-noble \
  sh -c 'npm i playwright@1.49.0 >/dev/null 2>&1 && NODE_PATH=/tmp/node_modules node /app/tests/browser.mjs'
