#!/usr/bin/env python3
"""Writes public/releases/<rel>/manifest.json (static hosting can't list directories)."""
import json, os, sys
rel = sys.argv[1]; commit = sys.argv[2] if len(sys.argv) > 2 else ''
base = f'public/releases/{rel}'
t = sorted(f for f in os.listdir(f'{base}/templates') if f.endswith('.j2'))
o = sorted('optional/' + f for f in os.listdir(f'{base}/templates/optional') if f.endswith('.j2'))
ex = sorted(os.listdir(f'{base}/examples'))
json.dump({'release': rel, 'upstream': 'fortinet-solutions-cse/sdwan-advpn-reference', 'upstream_commit': commit,
           'templates': t, 'optional': o, 'examples': ex}, open(f'{base}/manifest.json', 'w'), indent=1)
print(rel, len(t), len(o), len(ex))
