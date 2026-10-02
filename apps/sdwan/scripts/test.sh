#!/bin/sh
# Runs the regression suite in a throwaway node container (no host install needed).
cd "$(dirname "$0")/.." && docker run --rm --user "$(id -u):$(id -g)" -v "$(pwd)":/app:ro node:22-alpine node /app/tests/roundtrip.mjs
