import { h, download, copyText } from '../dom.js';
import { store } from '../store.js';
import { zip } from '../zip.js';

let selected = null, query = '', skipOptional = false;
export const getSkipOptional = () => skipOptional;
export const selectDevice = n => { selected = n; };

const KW = /^(\s*)(config|edit|next|end|set|unset|append|delete|purge|select|unselect|execute|show|get)\b(.*)$/;
function line(text, q) {
  const el = h('div', { class: 'ln' });
  if (text.startsWith('#')) { el.className += text.startsWith('# ') && /\.j2$/.test(text) ? ' sect' : ' cmt'; el.append(text); return el; }
  const m = KW.exec(text);
  if (!m) { el.append(text); return el; }
  const [, ind, kw, rest] = m;
  el.append(ind, h('span', { class: 'c-kw c-' + kw }, kw));
  if (kw === 'set' || kw === 'unset') { const r = /^(\s+)(\S+)(.*)$/.exec(rest); if (r) { el.append(r[1], h('span', { class: 'c-key' }, r[2]), h('span', { class: 'c-val' }, r[3])); return el; } }
  el.append(h('span', { class: 'rest' }, rest));
  return el;
}

export function configsView(rs, onRerender) {
  const m = store.model, results = rs.results || {};
  const names = ['Hub', 'Edge'].flatMap(g => Object.keys(m.inventory[g] || {}));
  if (!selected || !names.includes(selected)) selected = names[0] || null;
  const cur = selected && results[selected];

  const list = h('aside', { class: 'dlist' }, ['Hub', 'Edge'].map(g => Object.keys(m.inventory[g] || {}).length ? h('div', {},
    h('div', { class: 'dgroup' }, g === 'Hub' ? 'Hubs' : 'Edges'),
    Object.keys(m.inventory[g]).map(n => {
      const r = results[n];
      return h('button', { class: 'ditem' + (n === selected ? ' on' : ''), onclick: () => { selected = n; onRerender(); } },
        h('span', { class: 'dot ' + (!r ? 'wait' : r.error ? 'bad' : 'ok') }), h('span', { class: 'dn' }, n),
        r && r.text ? h('small', {}, r.text.split('\n').length + ' lines') : null);
    })) : null));

  let body;
  if (!rs.ready) body = h('div', { class: 'placeholder' }, h('div', { class: 'spin' }), h('p', {}, rs.message || 'Starting the Python engine…'), h('p', { class: 'hint' }, 'First load downloads ~13 MB (cached afterwards). Everything runs in your browser.'));
  else if (rs.error) body = errorBox(rs.error, 'The Project Template could not be evaluated');
  else if (!selected) body = h('p', { class: 'empty' }, 'Add devices to generate configuration.');
  else if (!cur) body = h('div', { class: 'placeholder' }, h('div', { class: 'spin' }), h('p', {}, 'Rendering…'));
  else if (cur.error) body = errorBox(cur.error, 'Could not render ' + selected);
  else {
    const lines = cur.text.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
    const q = query.trim().toLowerCase();
    const pre = h('div', { class: 'cli', tabindex: '0' });
    const hits = [];
    lines.forEach((t, i) => { const el = line(t); if (q && t.toLowerCase().includes(q)) { el.classList.add('hit'); hits.push(el); } pre.append(el); });
    const sections = lines.map((t, i) => [t, i]).filter(([t]) => /^# .*\.j2$/.test(t));
    let hi = -1;
    const jump = d => { if (!hits.length) return; hi = (hi + d + hits.length) % hits.length; hits.forEach(x => x.classList.remove('cur')); hits[hi].classList.add('cur'); hits[hi].scrollIntoView({ block: 'center' }); cnt.textContent = (hi + 1) + ' / ' + hits.length; };
    const cnt = h('span', { class: 'hint' }, q ? hits.length + ' matches' : '');
    body = h('div', { class: 'cfg' },
      h('div', { class: 'cfgbar' },
        h('strong', {}, selected), h('span', { class: 'hint' }, lines.length.toLocaleString() + ' lines'),
        h('input', { type: 'search', class: 'search', placeholder: 'Find in config…', value: query, 'aria-label': 'Find in config',
          oninput: e => { query = e.target.value; onRerender(); }, onkeydown: e => { if (e.key === 'Enter') jump(e.shiftKey ? -1 : 1); } }),
        h('button', { class: 'ghost', onclick: () => jump(-1) }, '↑'), h('button', { class: 'ghost', onclick: () => jump(1) }, '↓'), cnt,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: async e => { const ok = await copyText(cur.text); e.target.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => (e.target.textContent = 'Copy'), 1400); } }, 'Copy'),
        h('button', { class: 'btn', onclick: () => download(selected + '.txt', cur.text) }, 'Download'),
        h('button', { class: 'btn', onclick: () => download('configs-' + (store.name || 'design').replace(/\W+/g, '-') + '.zip', zip(Object.fromEntries(Object.entries(results).filter(([, r]) => r.text).map(([n, r]) => [n + '.txt', r.text])))) }, 'Download all (.zip)')),
      h('div', { class: 'secbar' }, sections.map(([t, i]) => h('button', { class: 'chip sm', title: 'Jump to section', onclick: () => pre.children[i].scrollIntoView({ block: 'start' }) }, t.slice(2).replace('.j2', '')))),
      pre);
  }
  return h('div', { class: 'view configs' }, h('div', { class: 'viewhead tight' }, h('h2', {}, 'Generated configuration'),
    h('p', {}, 'Live output from Fortinet’s Jinja Orchestrator ' + store.model.release + ' templates. Paste into the FortiGate CLI or load as a configuration script.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: skipOptional, onchange: e => { skipOptional = e.target.checked; onRerender(true); } }),
      ' Skip optional templates ', h('span', { class: 'hint' }, '(SD-WAN rules & firewall policy: leave on if FortiManager provides them)'))),
    h('div', { class: 'cfgwrap' }, list, body));
}

function errorBox(e, title) {
  return h('div', { class: 'errbox' }, h('h3', {}, title),
    e.template ? h('p', {}, 'In ', h('code', {}, e.template === 'Project' ? 'Project Template (generated)' : e.template), e.line ? ' line ' + e.line : '', ':') : null,
    h('pre', {}, e.message),
    h('p', { class: 'hint' }, /undefined/.test(e.message) ? 'A variable the templates need has no value for this device. Check its row under Devices (or add a default).' : 'See Problems for related checks.'));
}
