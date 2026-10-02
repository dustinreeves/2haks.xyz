import { h, mount, $, debounce, download } from './dom.js';
import { store, blankModel } from './store.js';
import { Engine } from './engine.js';
import { validate } from './validate.js';
import { modelFromVars, parseInventory, referencedVars } from './model.js';
import { topology } from './topology.js';
import { projectView } from './views/project.js';
import { regionsView } from './views/regions.js';
import { profilesView } from './views/profiles.js';
import { devicesView, setDeviceProblems } from './views/devices.js';
import { configsView, getSkipOptional, selectDevice } from './views/configs.js';
import { filesView } from './views/files.js';

const base = new URL('../', import.meta.url).href;
const RELEASE = '7.4';
const EXAMPLES = [
  ['Dual-region, mixed RR + dynamic BGP', 'Project.dualreg.mixed.nocert.j2', 'inventory.dualreg.mixed.json'],
  ['Dual-region, multi-VRF', 'Project.dualreg.multivrf.nocert.j2', 'inventory.dualreg.multivrf.json'],
  ['Dual-region, certificates', 'Project.dualreg.cert.j2', 'inventory.dualreg.json'],
];

const rs = { rev: -1, ready: false, results: null, error: null, message: 'Starting the Python engine…', ms: 0, rendering: false, fails: 0 };
const engine = new Engine(base, m => { rs.message = m; updateStatus(); if (!rs.ready) rebuildIf(['configs']); });
let current = (location.hash || '#project').slice(1);
let topoSel = null, problems = [];

// ------------------------------------------------------------------ toast
let toastT;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 3800);
}

// ------------------------------------------------------------------ rendering orchestration
let dirty = false;
async function runRender() {
  if (rs.rendering) { dirty = true; return; }
  rs.rendering = true; updateStatus();
  try {
    do {
      dirty = false;
      const rev = store.rev, f = store.files();
      const res = await engine.render(f.project, f.inventory, getSkipOptional());
      if (!res) continue;
      rs.ready = true; rs.rev = rev; rs.error = res.error || null; rs.results = res.devices; rs.ms = res.ms;
      rs.fails = Object.values(res.devices).filter(r => r.error).length + (res.error ? 1 : 0);
    } while (dirty);
  } catch (e) { rs.error = { message: String(e.message || e) }; rs.ready = true; }
  rs.rendering = false;
  setDeviceProblems(Object.fromEntries(Object.entries(rs.results || {}).filter(([, r]) => r.error).map(([n, r]) => [n, r.error])));
  refreshProblems(); updateStatus(); rebuildIf(['configs']);
}
const scheduleRender = debounce(runRender, 350);

// ------------------------------------------------------------------ problems
function refreshProblems() {
  problems = validate(store.model);
  for (const [n, r] of Object.entries(rs.results || {})) if (r.error) problems.push({ level: 'error', where: 'Render: ' + n, msg: r.error.message + (r.error.template ? ' (' + r.error.template + (r.error.line ? ':' + r.error.line : '') + ')' : ''), go: 'configs' });
  if (rs.error) problems.push({ level: 'error', where: 'Render', msg: rs.error.message, go: 'files' });
  const e = problems.filter(p => p.level === 'error').length, w = problems.length - e;
  const b = $('#problems'); b.textContent = '';
  b.append(h('span', { class: 'pdot ' + (e ? 'bad' : w ? 'warn' : 'ok') }), e || w ? (e ? e + ' error' + (e > 1 ? 's' : '') : '') + (e && w ? ', ' : '') + (w ? w + ' warning' + (w > 1 ? 's' : '') : '') : 'No problems');
  if (!$('#ppanel').hidden) fillProblems();
}
function fillProblems() {
  const p = $('#ppanel'); p.textContent = '';
  if (!problems.length) { p.append(h('p', { class: 'empty' }, 'Nothing to fix. The design looks consistent.')); return; }
  problems.forEach(x => p.append(h('button', { class: 'prob ' + x.level, onclick: () => { p.hidden = true; go(x.go); } }, h('b', {}, x.where), h('span', {}, x.msg))));
}

// ------------------------------------------------------------------ status chip
function updateStatus() {
  const s = $('#engine');
  if (!rs.ready) { s.className = 'chipstat loading'; s.textContent = rs.message; }
  else if (rs.rendering) { s.className = 'chipstat busy'; s.textContent = 'Rendering…'; }
  else if (rs.error || rs.fails) { s.className = 'chipstat bad'; s.textContent = (rs.fails || 1) + ' failed'; }
  else { s.className = 'chipstat ok'; s.textContent = Object.keys(rs.results || {}).length + ' configs · ' + rs.ms + ' ms'; }
  s.dataset.fresh = rs.ready && !rs.rendering && rs.rev === store.rev ? '1' : '0';
  const nb = $('#nav-configs .badge'); if (nb) { nb.textContent = rs.fails || ''; nb.hidden = !rs.fails; }
  const nd = $('#nav-devices .badge'); if (nd) nd.textContent = Object.keys(store.model.inventory.Hub || {}).length + Object.keys(store.model.inventory.Edge || {}).length;
  $('#undo').disabled = !store.undo.length; $('#redo').disabled = !store.redo.length;
}

// ------------------------------------------------------------------ views
const configsRerender = skipChanged => { if (skipChanged) { rs.results = null; runRender(); } rebuild(); };
function topoView() {
  const m = store.model, info = topoSel && (m.inventory.Hub?.[topoSel] || m.inventory.Edge?.[topoSel]);
  const el = h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Topology'),
    h('p', {}, 'Generated from your design: Hubs on top, Spokes below, one tunnel per overlay. Dashed arcs are Hub-to-Hub tunnels. Click a device for details.')),
    h('div', { class: 'card topo-card' }, topology(m, topoSel)),
    info ? h('div', { class: 'card' }, h('div', { class: 'cardhead' }, h('h3', {}, topoSel), h('button', { class: 'btn', onclick: () => go('configs', topoSel) }, 'View config')),
      h('dl', { class: 'kvs' }, ['loopback', 'profile', 'region'].flatMap(k => [h('dt', {}, k), h('dd', {}, String(info[k] ?? '—'))]))) : null);
  el.addEventListener('click', e => { const g = e.target.closest('[data-name]'); topoSel = g ? g.dataset.name : null; rebuild(); });
  return el;
}
const VIEWS = {
  project: projectView, regions: regionsView, profiles: profilesView, devices: devicesView, topology: topoView,
  configs: () => configsView(rs, configsRerender), files: () => filesView(io),
};
const NAV = [['project', 'Project'], ['regions', 'Regions & Hubs'], ['profiles', 'Profiles'], ['devices', 'Devices'], ['topology', 'Topology'], ['configs', 'Configs'], ['files', 'Files']];

function rebuild() {
  if (!VIEWS[current]) current = 'project';
  const main = $('#main'), y = main.scrollTop;
  const active = document.activeElement, id = active && active.dataset && active.dataset.fid;
  mount(main, VIEWS[current]());
  main.scrollTop = y;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === current));
  updateStatus();
}
const rebuildIf = list => { if (list.includes(current)) rebuild(); };
function go(v, sel) {
  if (sel && v === 'configs') selectDevice(sel);
  current = v; location.hash = v; rebuild(); $('#main').scrollTop = 0;
}

// ------------------------------------------------------------------ import / export
async function importFiles(fileList) {
  const files = [...fileList]; // FileList is live: the input gets cleared right after this call
  try {
    let project = null, inv = null, design = null, n = 0;
    for (const f of files) {
      const text = await f.text(); n++;
      if (/\.json$/i.test(f.name)) {
        const j = JSON.parse(text);
        if (j.model && j.format) design = j; else if (j.Hub || j.Edge || j.defaults) inv = j; else throw new Error(f.name + ': not an inventory or design file');
      } else project = text;
    }
    if (design) { store.replace(design.model, design.name || 'Imported design'); toast('Design loaded.', 'ok'); return; }
    if (!project && !inv) throw new Error('Choose a Project Template (.j2) and/or an inventory (.json).');
    let model = JSON.parse(JSON.stringify(store.model));
    if (project) {
      toast('Reading Project Template…');
      const r = await engine.parse(project);
      if (r.error) throw new Error('Project Template: ' + r.error.message + (r.error.line ? ' (line ' + r.error.line + ')' : ''));
      model = modelFromVars(r.vars, inv ? parseInventory(JSON.stringify(inv)) : { defaults: {}, Hub: {}, Edge: {} }, RELEASE);
    } else model.inventory = { defaults: {}, ...inv };
    store.replace(model, 'Imported design');
    toast('Imported ' + n + ' file' + (n > 1 ? 's' : '') + (project && !inv ? '. No inventory yet: add devices under Devices.' : '.'), 'ok');
  } catch (e) { toast(e.message || String(e), 'err'); }
}
async function loadExample(p, i, label) {
  if (!confirm('Replace the current design with the example "' + label + '"?\n(You can undo.)')) return;
  const get = async n => (await fetch(base + 'releases/' + RELEASE + '/examples/' + n)).text();
  try { await importFiles([new File([await get(p)], p), new File([await get(i)], i)]); store.name = label; go('regions'); } catch (e) { toast(String(e), 'err'); }
}
const io = { importFiles, loadExample, examples: EXAMPLES };

function exportDesign() {
  download((store.name || 'design').replace(/\W+/g, '-') + '.design.json', JSON.stringify({ format: 'sdwan-advpn-designer', version: 1, name: store.name, model: store.model }, null, 2), 'application/json');
}

// ------------------------------------------------------------------ boot
function syncDatalist() {
  const names = new Set(referencedVars(store.model));
  const m = store.model; Object.keys(m.inventory.defaults || {}).forEach(k => names.add(k));
  for (const g of ['Hub', 'Edge']) for (const d of Object.values(m.inventory[g] || {})) Object.keys(d).forEach(k => names.add(k));
  ['hostname', 'loopback', 'profile', 'region'].forEach(k => names.delete(k));
  const dl = $('#varnames'); dl.textContent = ''; [...names].sort().forEach(n => dl.append(h('option', { value: n })));
}

function boot() {
  mount($('#nav'), NAV.map(([v, l]) => h('a', { href: '#' + v, id: 'nav-' + v, 'data-v': v, onclick: e => { e.preventDefault(); go(v); } }, l, v === 'configs' || v === 'devices' ? h('span', { class: 'badge', hidden: v === 'configs' }, '') : null)));
  $('#undo').onclick = () => store.back(); $('#redo').onclick = () => store.forward();
  $('#new').onclick = () => { if (confirm('Start a new blank design? (You can undo.)')) { store.replace(blankModel(RELEASE), 'Untitled design'); go('project'); } };
  $('#export').onclick = exportDesign;
  $('#import').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
  $('#problems').onclick = () => { const p = $('#ppanel'); p.hidden = !p.hidden; if (!p.hidden) fillProblems(); };
  document.addEventListener('click', e => { if (!e.target.closest('#ppanel, #problems')) $('#ppanel').hidden = true; });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.back(); } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); store.forward(); }
    }
  });
  $('#title').value = store.name; $('#title').oninput = e => { store.name = e.target.value; store.save(); };
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v !== current && VIEWS[v]) { current = v; rebuild(); } });

  store.on(({ structural }) => {
    syncDatalist(); refreshProblems(); updateStatus(); scheduleRender();
    const t = $('#title'); if (document.activeElement !== t) t.value = store.name;
    if (structural) rebuild();
  });
  syncDatalist(); refreshProblems(); rebuild();
  engine.init(RELEASE).then(man => { $('#upstream').textContent = 'Fortinet Jinja Orchestrator ' + RELEASE + ' @ ' + man.upstream_commit.slice(0, 7); runRender(); })
    .catch(e => { rs.message = 'Engine failed to start: ' + e.message; rs.error = { message: rs.message }; rs.ready = true; updateStatus(); rebuild(); });
}
boot();
