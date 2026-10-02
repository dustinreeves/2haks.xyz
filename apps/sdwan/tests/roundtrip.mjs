// Regression: engine output == Fortinet's render_config.py, and parse -> emit -> render is lossless.
// Run: scripts/test.sh
import { loadPyodide } from '/app/public/vendor/pyodide/pyodide.mjs';
import fs from 'fs';
import { emitProject, emitInventory, modelFromVars, parseInventory } from '/app/public/js/model.js';

const REL = '/app/public/releases/7.4/', ORACLE = '/app/tests/oracle/';
const SETS = [
  ['mixed', 'Project.dualreg.mixed.nocert.j2', 'inventory.dualreg.mixed.json'],
  ['multi_vrf', 'Project.dualreg.multivrf.nocert.j2', 'inventory.dualreg.multivrf.json'],
  ['deployment_guide', 'Project.dualreg.cert.j2', 'inventory.dualreg.json'],
];
const py = await loadPyodide({ indexURL: '/app/public/vendor/pyodide/' });
await py.loadPackage(['jinja2', 'markupsafe']);
for (const f of ['ipaddr.py', 'engine.py']) py.FS.writeFile('/' + f, fs.readFileSync('/app/public/py/' + f));
const man = JSON.parse(fs.readFileSync(REL + 'manifest.json', 'utf8'));
const tpls = {};
for (const t of [...man.templates, ...man.optional]) tpls[t] = fs.readFileSync(REL + 'templates/' + t, 'utf8');
py.runPython('import sys; sys.path.insert(0, "/"); import engine');
py.globals.set('tj', JSON.stringify(tpls));
py.runPython('engine.load_release(tj)');
const call = (fn, ...a) => { py.globals.set('_a', a); return JSON.parse(py.runPython(`import json; engine.${fn}(*_a.to_py())`)); };

let fail = 0;
const check = (label, res, dir) => {
  for (const [dev, r] of Object.entries(res.devices)) {
    const exp = fs.readFileSync(ORACLE + dir + '/' + dev, 'utf8');
    const ok = !r.error && r.text === exp;
    if (!ok) { fail++; console.log('  FAIL', label, dev, r.error ? JSON.stringify(r.error) : ''); }
  }
  console.log(label.padEnd(34), Object.keys(res.devices).length, 'devices');
};
for (const [dir, projFile, invFile] of SETS) {
  const project = fs.readFileSync(REL + 'examples/' + projFile, 'utf8');
  const invText = fs.readFileSync(REL + 'examples/' + invFile, 'utf8');
  check(dir + ': original project', call('render', project, invText), dir);
  const parsed = call('parse_project', project);
  if (parsed.error) { fail++; console.log('  PARSE FAIL', dir, parsed.error); continue; }
  const model = modelFromVars(parsed.vars, parseInventory(invText));
  const regen = emitProject(model);
  check(dir + ': regenerated project', call('render', regen, emitInventory(model.inventory)), dir);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP + '/' + dir + '.regen.j2', regen);
}
console.log(fail ? `FAILED (${fail})` : 'ALL PASS');
process.exit(fail ? 1 : 0);
