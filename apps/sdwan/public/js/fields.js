// Form controls driven by the schema. Every control writes straight into the model object
// and calls store.touch() (no view rebuild, so typing never loses focus).
import { h } from './dom.js';
import { store } from './store.js';
import { isRef } from './model.js';

const RE = { ip: /^(\d{1,3}\.){3}\d{1,3}$/, cidr: /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/ };
const bad = (type, v) => typeof v === 'string' && v !== '' && RE[type] && !RE[type].test(v);

export const effective = (def, v) => (v === undefined ? def : v);

function setv(obj, key, v) {
  if (v === undefined || v === '') delete obj[key]; else obj[key] = v;
  store.touch();
}

const toNum = (def, s) => {
  if (s.trim() === '') return undefined;
  if (def.asString) return s.trim();
  return /^-?\d+$/.test(s.trim()) ? Number(s.trim()) : s.trim();
};
const show = v => v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v);

// A text-like input with a literal <-> per-device-variable switch.
function textControl(def, obj, key) {
  const wrap = h('span', { class: 'val' });
  const render = () => {
    wrap.textContent = '';
    const v = obj[key];
    if (isRef(v)) {
      const inp = h('input', { class: 'var', list: 'varnames', value: v.$var, placeholder: 'variable name', spellcheck: 'false',
        oninput: e => { obj[key] = { $var: e.target.value.trim() }; store.touch(); } });
      wrap.append(h('span', { class: 'sigil', title: 'Per-device variable: resolved from the Devices inventory' }, '{ }'), inp,
        h('button', { class: 'mini', type: 'button', title: 'Switch to a fixed value', onclick: () => { delete obj[key]; store.touch(); render(); } }, 'abc'));
    } else {
      const inp = h('input', { type: def.secret ? 'password' : 'text', value: show(v), placeholder: def.ph || (def.def !== undefined ? String(Array.isArray(def.def) ? def.def.join(', ') : def.def) : ''), spellcheck: 'false',
        class: bad(def.type, v) ? 'invalid' : '',
        oninput: e => {
          const s = e.target.value;
          let nv = s === '' ? undefined : def.type === 'int' ? toNum(def, s) : def.type === 'list' ? s.split(',').map(x => x.trim()).filter(Boolean) : s;
          if (Array.isArray(nv) && !nv.length) nv = undefined;
          e.target.classList.toggle('invalid', bad(def.type, nv));
          setv(obj, key, nv);
        } });
      wrap.append(inp, h('button', { class: 'mini', type: 'button', title: 'Use a per-device variable (value comes from the inventory)', onclick: () => { obj[key] = { $var: '' }; store.touch(); render(); wrap.querySelector('input.var').focus(); } }, '{ }'));
    }
  };
  render();
  return wrap;
}

function boolControl(def, obj, key) {
  const v = obj[key];
  const sel = h('select', { class: 'tri', onchange: e => { const x = e.target.value; setv(obj, key, x === '' ? undefined : x === 'true'); } },
    h('option', { value: '' }, 'default (' + (def.def === undefined ? 'off' : def.def) + ')'),
    h('option', { value: 'true' }, 'on'), h('option', { value: 'false' }, 'off'));
  sel.value = v === undefined ? '' : String(v);
  return sel;
}
function enumControl(def, obj, key) {
  const sel = h('select', { onchange: e => setv(obj, key, e.target.value || undefined) },
    h('option', { value: '' }, 'default (' + def.def + ')'), ...def.options.map(o => h('option', { value: o }, o)));
  sel.value = obj[key] === undefined ? '' : obj[key];
  return sel;
}
export const control = (def, obj, key = def.key) => def.type === 'bool' ? boolControl(def, obj, key) : def.type === 'enum' ? enumControl(def, obj, key) : textControl(def, obj, key);

// label + control + help line
export function field(def, obj, key = def.key) {
  return h('label', { class: 'field' + (def.required ? ' req' : '') },
    h('span', { class: 'lbl' }, def.label, def.since ? h('em', { class: 'since' }, ' ' + def.since + '+') : null),
    control(def, obj, key),
    def.desc ? h('span', { class: 'help' }, def.desc) : null);
}

// Plain text input bound to obj[key] that does NOT go through the schema (names, etc.).
export function plain(obj, key, { ph = '', cls = '', type = 'text' } = {}) {
  return h('input', { type, class: cls, value: obj[key] === undefined ? '' : obj[key], placeholder: ph, spellcheck: 'false',
    oninput: e => setv(obj, key, e.target.value) });
}
// Name input that renames on commit (blur/enter) through an op; reverts if refused.
export function nameInput(current, onRename, ph = 'name') {
  const inp = h('input', { class: 'name', value: current, placeholder: ph, spellcheck: 'false',
    onkeydown: e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = current; e.target.blur(); } },
    onchange: e => { const v = e.target.value.trim(); if (v === current) return; if (!onRename(v)) { e.target.value = current; e.target.classList.add('invalid'); setTimeout(() => e.target.classList.remove('invalid'), 800); } } });
  return inp;
}
