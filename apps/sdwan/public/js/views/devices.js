import { h, download } from '../dom.js';
import { store } from '../store.js';
import { referencedVars } from '../model.js';
import { DEVICE_CORE } from '../schema.js';
import { renameDevice, cloneDevice, bumpIp, bumpName } from '../ops.js';

const extraCols = new Set();   // columns added in the UI but still empty
let problems = {};              // device -> render error, set by app

export const setDeviceProblems = p => { problems = p || {}; };

const varCols = m => {
  const s = new Set(referencedVars(m));
  for (const g of ['Hub', 'Edge']) for (const d of Object.values(m.inventory[g] || {})) for (const k of Object.keys(d)) if (!DEVICE_CORE.includes(k)) s.add(k);
  extraCols.forEach(k => s.add(k));
  return [...s].filter(k => !DEVICE_CORE.includes(k));
};

function setCell(d, key, text, e) {
  const old = d[key];
  if (text === '') delete d[key];
  else d[key] = typeof old === 'number' && /^-?\d+$/.test(text) ? Number(text) : text;
  store.touch();
}

function csvParse(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const csvCell = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

function importCsv(group) {
  const text = prompt('Paste CSV (or tab-separated, e.g. from a spreadsheet) with a header row.\nColumns: hostname, loopback, profile, region, plus any variable names.');
  if (!text) return;
  const rows = csvParse(text); if (rows.length < 2) return;
  const head = rows[0].map(x => x.trim());
  if (!head.includes('hostname')) { alert('The header row needs a "hostname" column.'); return; }
  store.change(m => {
    const g = m.inventory[group] ||= {};
    for (const r of rows.slice(1)) {
      const d = {}; head.forEach((k, i) => { if (k && (r[i] ?? '').trim() !== '') d[k] = r[i].trim(); });
      if (d.hostname) g[d.hostname] = { ...(g[d.hostname] || {}), ...d };
    }
  });
}
function exportCsv(group) {
  const m = store.model, devs = m.inventory[group] || {}, cols = [...DEVICE_CORE, ...varCols(m)];
  const lines = [cols.join(','), ...Object.values(devs).map(d => cols.map(c => csvCell(d[c] === undefined ? '' : String(d[c]))).join(','))];
  download(group.toLowerCase() + '-devices.csv', lines.join('\n') + '\n', 'text/csv');
}

function table(group) {
  const m = store.model, devs = m.inventory[group] ||= {}, cols = varCols(m);
  const head = h('tr', {}, h('th', { class: 'sticky' }, 'device'), h('th', {}, 'hostname'), h('th', {}, 'loopback'), h('th', {}, 'profile'), h('th', {}, 'region'),
    cols.map(c => h('th', { class: 'var' }, c)), h('th', {}, ''));
  const rows = Object.entries(devs).map(([dn, d]) => {
    const err = problems[dn];
    return h('tr', { class: err ? 'haserr' : '' },
      h('td', { class: 'sticky' }, h('input', { class: 'host', value: dn, spellcheck: 'false', title: 'Device name (also the name of its output file)',
        onchange: e => { const v = e.target.value.trim(); let ok; store.change(mm => { ok = renameDevice(mm, group, dn, v); }); if (!ok) e.target.classList.add('invalid'); } }),
        err ? h('span', { class: 'errdot', title: err.message }, '!') : null),
      h('td', {}, h('input', { value: d.hostname ?? '', spellcheck: 'false', placeholder: dn, class: d.hostname && d.hostname !== dn ? 'invalid' : '', title: d.hostname && d.hostname !== dn ? 'Differs from the device name' : '', oninput: e => setCell(d, 'hostname', e.target.value) })),
      h('td', {}, h('input', { value: d.loopback ?? '', spellcheck: 'false', placeholder: '10.200.1.1', oninput: e => setCell(d, 'loopback', e.target.value) })),
      h('td', {}, sel(d, 'profile', Object.keys(m.profiles))),
      h('td', {}, sel(d, 'region', Object.keys(m.regions))),
      cols.map(c => h('td', {}, h('input', { value: d[c] === undefined ? '' : String(d[c]), spellcheck: 'false',
        placeholder: c in (m.inventory.defaults || {}) ? String(m.inventory.defaults[c]) : '', oninput: e => setCell(d, c, e.target.value) }))),
      h('td', { class: 'acts' },
        group === 'Edge' ? h('button', { class: 'ghost', title: 'Duplicate (next hostname, loopback and LAN subnet)', onclick: () => store.change(mm => cloneDevice(mm, group, dn)) }, '⧉') : null,
        h('button', { class: 'ghost danger', title: 'Delete device', onclick: () => store.change(mm => { delete mm.inventory[group][dn]; }) }, '×')));
  });
  return h('div', { class: 'tablewrap' }, h('table', { class: 'inv' }, h('thead', {}, head), h('tbody', {}, rows)));
}
function sel(d, key, options) {
  const s = h('select', { class: d[key] && !options.includes(d[key]) ? 'invalid' : '', onchange: e => { d[key] = e.target.value; store.touch(); } },
    h('option', { value: '' }, '—'), ...options.map(o => h('option', { value: o }, o)),
    d[key] && !options.includes(d[key]) ? h('option', { value: d[key] }, d[key] + ' (unknown)') : null);
  s.value = d[key] ?? '';
  return s;
}

function defaultsCard() {
  const m = store.model, df = m.inventory.defaults ||= {};
  return h('section', { class: 'card' }, h('h3', {}, 'Defaults ', h('span', { class: 'hint' }, 'variables applied to every device unless overridden in its row')),
    Object.entries(df).map(([k, v]) => h('div', { class: 'row' }, h('code', { class: 'kv' }, k),
      h('input', { value: String(v), spellcheck: 'false', oninput: e => { df[k] = e.target.value; store.touch(); } }),
      h('button', { class: 'ghost', onclick: () => store.change(() => { delete df[k]; }) }, '×'))),
    h('div', { class: 'btnrow' }, h('button', { class: 'ghost', onclick: () => { const n = prompt('Variable name'); if (n && /^[A-Za-z_]\w*$/.test(n.trim())) store.change(() => { df[n.trim()] = ''; extraCols.delete(n.trim()); }); } }, '+ default variable')));
}

export function devicesView() {
  const m = store.model;
  const group = (g, title, blurb, canAdd) => h('section', { class: 'card wide' },
    h('div', { class: 'cardhead' }, h('h3', {}, title, h('span', { class: 'count' }, Object.keys(m.inventory[g] || {}).length)),
      h('div', { class: 'btnrow' },
        canAdd ? h('button', { class: 'btn', onclick: () => store.change(mm => {
          const gg = mm.inventory[g] ||= {}, last = Object.keys(gg).pop();
          if (last) cloneDevice(mm, g, last); else gg['Edge-1'] = { hostname: 'Edge-1', profile: Object.keys(mm.profiles)[0], region: Object.keys(mm.regions)[0] };
        }) }, '+ Device') : null,
        canAdd ? h('button', { class: 'ghost', onclick: () => { const n = parseInt(prompt('How many devices to add? (each copies the last one, with the next hostname, loopback and LAN subnet)', '5'), 10); if (n > 0) store.change(mm => { const gg = mm.inventory[g] ||= {}; for (let i = 0; i < Math.min(n, 500); i++) { const last = Object.keys(gg).pop(); if (!last) break; cloneDevice(mm, g, last); } }); } }, '+ N devices…') : null,
        h('button', { class: 'ghost', onclick: () => importCsv(g) }, 'Import CSV…'), h('button', { class: 'ghost', onclick: () => exportCsv(g) }, 'Export CSV'))),
    h('p', { class: 'blurb' }, blurb), table(g));
  return h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Devices'),
    h('p', {}, 'The inventory: one row per FortiGate. The grey columns are the per-device variables your profiles and Hubs refer to with ', h('code', {}, '{ }'),
      '. Leave a cell empty to skip that interface on that device.')),
    h('div', { class: 'btnrow pad' }, h('button', { class: 'ghost', onclick: () => { const n = prompt('New per-device variable (column) name'); if (n && /^[A-Za-z_]\w*$/.test(n.trim())) { extraCols.add(n.trim()); store.change(() => {}); } } }, '+ variable column')),
    group('Hub', 'Hubs', 'One row per Hub. Add Hubs under Regions & Hubs; the hostname must match the Hub name.', false),
    group('Edge', 'Edges (Spokes)', 'Branch devices.', true),
    defaultsCard());
}
