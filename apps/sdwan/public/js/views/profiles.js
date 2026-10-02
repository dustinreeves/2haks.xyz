import { h } from '../dom.js';
import { store } from '../store.js';
import { field, nameInput } from '../fields.js';
import { ROLES, PROFILE_OPTIONS, ifaceFields, KNOWN_IFACE_KEYS, BRIDGE_FIELDS } from '../schema.js';
import { renameProfile, deleteProfile, uniqueName } from '../ops.js';
import { isRef } from '../model.js';

let selected = null;
const PRIMARY = { wan: ['name', 'ip', 'ol_type'], lan: ['name', 'ip'], backbone: ['name', 'ip', 'ol_type'] };

function ifaceCard(p, i, idx) {
  const list = p.interfaces, role = i.role || 'wan';
  const defs = ifaceFields(role), prim = PRIMARY[role] || ['name', 'parent'];
  const primary = prim.map(k => defs.find(f => f.key === k)).filter(Boolean);
  const rest = defs.filter(f => !prim.includes(f.key) && (!f.showIf || f.showIf(i)));
  const set = rest.filter(f => i[f.key] !== undefined).length;
  const extra = Object.keys(i).filter(k => !KNOWN_IFACE_KEYS.has(k));
  const move = d => store.change(() => { const j = idx + d; if (j < 0 || j >= list.length) return; [list[idx], list[j]] = [list[j], list[idx]]; });
  return h('div', { class: 'iface role-' + role },
    h('div', { class: 'ifhead' },
      h('select', { class: 'role', title: 'Interface role', onchange: e => store.change(() => { i.role = e.target.value; }) },
        ROLES.map(([v, l]) => h('option', { value: v, selected: v === role }, l))),
      h('div', { class: 'ifprim' }, primary.map(f => field({ ...f, desc: '' }, i))),
      h('div', { class: 'ifbtns' },
        h('button', { class: 'ghost', title: 'Move up', onclick: () => move(-1) }, '↑'), h('button', { class: 'ghost', title: 'Move down', onclick: () => move(1) }, '↓'),
        h('button', { class: 'ghost', title: 'Duplicate', onclick: () => store.change(() => { list.splice(idx + 1, 0, JSON.parse(JSON.stringify(i))); }) }, '⧉'),
        h('button', { class: 'ghost danger', title: 'Delete interface', onclick: () => store.change(() => { list.splice(idx, 1); }) }, '×'))),
    rest.length || extra.length ? h('details', { class: 'ifmore', open: false },
      h('summary', {}, 'More settings', set ? h('span', { class: 'badge' }, set + ' set') : null),
      h('div', { class: 'grid' }, rest.map(f => field(f, i))),
      extra.length ? h('div', { class: 'grid' }, extra.map(k => h('label', { class: 'field' }, h('span', { class: 'lbl' }, k, h('em', { class: 'since' }, ' (custom)')),
        h('input', { value: isRef(i[k]) ? '{' + i[k].$var + '}' : JSON.stringify(i[k]), spellcheck: 'false',
          oninput: e => { try { i[k] = JSON.parse(e.target.value); } catch { i[k] = e.target.value; } store.touch(); } })))) : null) : null);
}

export function profilesView() {
  const m = store.model, names = Object.keys(m.profiles);
  if (!selected || !(selected in m.profiles)) selected = names[0] || null;
  const p = selected && m.profiles[selected];

  const side = h('aside', { class: 'plist' },
    names.map(n => h('button', { class: 'pitem' + (n === selected ? ' on' : ''), onclick: () => { selected = n; store.change(() => {}); } },
      h('span', {}, n), h('small', {}, countDev(m, n) + (countDev(m, n) === 1 ? ' device' : ' devices')))),
    h('button', { class: 'btn', onclick: () => store.change(mm => { selected = uniqueName(mm.profiles, 'Profile'); mm.profiles[selected] = { interfaces: [{ name: { $var: 'isp1_intf' }, role: 'wan', ol_type: 'ISP1', ip: 'dhcp' }] }; }) }, '+ Profile'));

  if (!p) return h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Device profiles')), h('div', { class: 'profiles' }, side, h('p', { class: 'empty' }, 'No profiles yet.')));

  const optsSet = PROFILE_OPTIONS.filter(f => p.options && f.key in p.options);
  const optsFree = PROFILE_OPTIONS.filter(f => !(p.options && f.key in p.options));
  const editor = h('div', { class: 'peditor' },
    h('section', { class: 'card' },
      h('div', { class: 'cardhead' }, h('span', { class: 'tag' }, 'Profile'), nameInput(selected, to => { let ok; store.change(mm => { ok = renameProfile(mm, selected, to); if (ok) selected = to; }); return ok; }),
        h('button', { class: 'ghost', onclick: () => store.change(mm => { const n = uniqueName(mm.profiles, selected + '-copy'); mm.profiles[n] = JSON.parse(JSON.stringify(p)); selected = n; }) }, 'Duplicate'),
        h('button', { class: 'ghost danger', onclick: () => confirm('Delete profile ' + selected + '?') && store.change(mm => { deleteProfile(mm, selected); selected = null; }) }, 'Delete')),
      h('p', { class: 'blurb' }, 'A profile is the local topology of a device: its interfaces and what each is for. Use ', h('code', {}, '{ }'),
        ' variables for anything that differs per device (interface names, LAN IPs) and fill them in under Devices — interfaces whose name is unset are skipped, so one profile can serve different hardware.'),
      h('div', { class: 'grid' }, field({ key: 'ha', label: 'HA cluster', type: 'bool', def: false, desc: 'Skips settings not allowed in HA mode (e.g. hostname).' }, p))),
    h('section', { class: 'card' }, h('h3', {}, 'Interfaces'),
      p.interfaces.map((i, idx) => ifaceCard(p, i, idx)),
      h('div', { class: 'btnrow' },
        ['wan', 'lan'].map(r => h('button', { class: 'ghost', onclick: () => store.change(() => { p.interfaces.push({ name: { $var: '' }, role: r, ...(r === 'wan' ? { ip: 'dhcp' } : {}) }); }) }, '+ ' + r.toUpperCase() + ' interface')),
        h('button', { class: 'ghost', onclick: () => store.change(() => { p.interfaces.push({ name: '', role: 'lag_member' }); }) }, '+ other…'))),
    h('section', { class: 'card' }, h('h3', {}, 'Bridges ', h('span', { class: 'hint' }, '(hardware / virtual switches, Edge only)')),
      (p.bridges || []).map((b, bi) => h('div', { class: 'row' }, h('div', { class: 'grid g2' }, BRIDGE_FIELDS.map(f => field(f, b))),
        h('button', { class: 'ghost', onclick: () => store.change(() => { p.bridges.splice(bi, 1); if (!p.bridges.length) delete p.bridges; }) }, '×'))),
      h('button', { class: 'ghost', onclick: () => store.change(() => { (p.bridges ||= []).push({ name: 'BR_LAN' }); }) }, '+ Bridge')),
    h('section', { class: 'card' }, h('h3', {}, 'Profile overrides ', h('span', { class: 'hint' }, '(take precedence over the project settings)')),
      h('div', { class: 'grid' }, optsSet.map(f => h('div', { class: 'ovr' }, field(f, p.options),
        h('button', { class: 'ghost', title: 'Remove override', onclick: () => store.change(() => { delete p.options[f.key]; if (!Object.keys(p.options).length) delete p.options; }) }, '×')))),
      optsFree.length ? h('select', { class: 'addsel', onchange: e => { if (e.target.value) store.change(() => { const f = PROFILE_OPTIONS.find(x => x.key === e.target.value); (p.options ||= {})[f.key] = f.def !== undefined ? f.def : ''; }); } },
        h('option', { value: '' }, '+ add override'), optsFree.map(f => h('option', { value: f.key }, f.label))) : null));

  return h('div', { class: 'view' }, h('div', { class: 'viewhead' }, h('h2', {}, 'Device profiles'),
    h('p', {}, 'Describe the interfaces of each kind of site. Every device (Hubs too) is assigned one profile.')),
    h('div', { class: 'profiles' }, side, editor));
}

const countDev = (m, n) => ['Hub', 'Edge'].reduce((a, g) => a + Object.values(m.inventory[g] || {}).filter(d => d.profile === n).length, 0);
