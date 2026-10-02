#!/bin/sh
# Regenerates tests/oracle with Fortinet's own render_config.py (real Ansible ipaddr), as ground truth.
# Usage: scripts/make-oracle.sh <path to upstream checkout of release/7.4>
set -e
UP=$(cd "$1" && pwd); OUT="$(pwd)/tests/oracle"; rm -rf "$OUT"; mkdir -p "$OUT"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -v "$UP":/repo:ro -v "$OUT":/oracle -w /tmp python:3.12-slim sh -c '
pip install -q --target /tmp/pylib jinja2 ansible netaddr >/dev/null 2>&1; export PYTHONPATH=/tmp/pylib
cp -r /repo /tmp/work && cd /tmp/work; P=dynamic-bgp-on-lo/projects
for pair in "mixed Project.dualreg.mixed.nocert.j2 inventory.dualreg.mixed.json" "multi_vrf Project.dualreg.multivrf.nocert.j2 inventory.dualreg.multivrf.json" "deployment_guide Project.dualreg.cert.j2 inventory.dualreg.json"; do
  set -- $pair; python3 render_config.py -f dynamic-bgp-on-lo -p $P/$2 -i $P/$3 -o /oracle/$1 >/dev/null
done'
