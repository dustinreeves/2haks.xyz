#!/bin/sh
# Vendors the Pyodide runtime (Python in WebAssembly) + jinja2/markupsafe wheels into public/vendor/pyodide.
# Run from the repo root. Needs docker. Re-run only to upgrade Pyodide.
set -e
VER=${PYODIDE_VERSION:-314.0.7}
OUT="$(pwd)/public/vendor/pyodide"
mkdir -p "$OUT"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e VER=$VER -v "$OUT":/out node:22-alpine sh -c '
  set -e; cd /tmp && npm i pyodide@$VER >/dev/null 2>&1
  cd node_modules/pyodide
  cp pyodide.asm.wasm pyodide.asm.mjs pyodide.mjs python_stdlib.zip pyodide-lock.json /out/
  BASE=https://cdn.jsdelivr.net/pyodide/v$VER/full
  for w in $(node -e "const l=require(\"./pyodide-lock.json\").packages;for(const n of [\"jinja2\",\"markupsafe\"])console.log(l[n].file_name)"); do
    wget -q -O /out/$w $BASE/$w
  done
  chmod -R a+rX /out'
ls -la "$OUT"
