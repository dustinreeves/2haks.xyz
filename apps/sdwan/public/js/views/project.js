import { h } from '../dom.js';
import { store } from '../store.js';
import { field } from '../fields.js';
import { PROJECT_GROUPS } from '../schema.js';
import { isRef } from '../model.js';

const KNOWN = new Set(PROJECT_GROUPS.flatMap(g => g.fields.map(f => f.key)));

export function projectView() {
  const m = store.model, o = m.options;
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Filter options…', 'aria-label': 'Filter options' });
  const cards = PROJECT_GROUPS.map(g => {
    const rows = g.fields.filter(f => !f.showIf || f.showIf(m)).map(f => field(f, o));
    return h('section', { class: 'card', 'data-group': g.id },
      h('h3', {}, g.title), h('p', { class: 'blurb' }, g.blurb), h('div', { class: 'grid' }, rows));
  });
  // bool changes can reveal/hide dependent fields -> rebuild
  const wrap = h('div', { class: 'cards', onchange: e => { if (e.target.tagName === 'SELECT') store.change(() => {}); } }, cards);
  q.addEventListener('input', () => {
    const t = q.value.toLowerCase();
    wrap.querySelectorAll('.field').forEach(el => { el.hidden = t && !el.textContent.toLowerCase().includes(t); });
    wrap.querySelectorAll('.card').forEach(c => { c.hidden = t && ![...c.querySelectorAll('.field')].some(e => !e.hidden); });
  });

  const extra = Object.keys(o).filter(k => !KNOWN.has(k));
  if (extra.length) wrap.append(h('section', { class: 'card' }, h('h3', {}, 'Other variables'),
    h('p', { class: 'blurb' }, 'Set in the imported Project Template but not covered by a form field. Kept as-is.'),
    h('div', { class: 'grid' }, extra.map(k => h('label', { class: 'field' }, h('span', { class: 'lbl' }, k),
      h('input', { value: isRef(o[k]) ? '{' + o[k].$var + '}' : JSON.stringify(o[k]), spellcheck: 'false',
        oninput: e => { try { o[k] = JSON.parse(e.target.value); } catch { o[k] = e.target.value; } store.touch(); } }))))));
  return h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Project settings'),
    h('p', {}, 'Global design options. Anything left on "default" is not written to the Project Template, so Fortinet’s built-in default applies.'), q), wrap);
}
