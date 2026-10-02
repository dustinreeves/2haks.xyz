import { h } from '../dom.js';
import { store } from '../store.js';
import { field, nameInput, plain } from '../fields.js';
import { REGION_FIELDS, HUB_FIELDS, OVERLAY_FIELDS, PEERING_FIELDS } from '../schema.js';
import { renameRegion, renameHub, deleteRegion, deleteHub, uniqueName } from '../ops.js';

const confirmDel = what => confirm('Delete ' + what + '?\nThis also updates anything that references it.');

function regionCard(rn) {
  const m = store.model, r = m.regions[rn];
  const multi = (r.vrfs || []).length > 0;
  const avail = Object.keys(m.hubs).filter(x => !(r.hubs || []).includes(x));
  return h('section', { class: 'card region' },
    h('div', { class: 'cardhead' }, h('span', { class: 'tag' }, 'Region'), nameInput(rn, to => { let ok; store.change(mm => { ok = renameRegion(mm, rn, to); }); return ok; }),
      h('button', { class: 'ghost danger', onclick: () => confirmDel('region ' + rn) && store.change(mm => deleteRegion(mm, rn)) }, 'Delete')),
    h('div', { class: 'grid' }, REGION_FIELDS.map(f => field(f, r))),
    h('div', { class: 'sub' }, h('h4', {}, 'Hubs serving this region'),
      h('div', { class: 'chips' }, (r.hubs || []).map(hn => h('span', { class: 'chip' + (m.hubs[hn] ? '' : ' bad') }, hn,
        h('button', { title: 'Remove', onclick: () => store.change(() => { r.hubs = r.hubs.filter(x => x !== hn); }) }, '×'))),
        avail.length ? h('select', { class: 'addsel', onchange: e => { if (e.target.value) store.change(() => { (r.hubs ||= []).push(e.target.value); }); } },
          h('option', { value: '' }, '+ add hub'), avail.map(a => h('option', { value: a }, a))) : null)),
    h('div', { class: 'sub' }, h('h4', {}, 'VRFs ', h('span', { class: 'hint' }, multi ? '(multi-VRF design)' : '(optional: add to enable multi-VRF)')),
      (r.vrfs || []).map((v, i) => h('div', { class: 'row' }, h('span', { class: 'rowlbl' }, 'VRF'), plain(v, 'id', { ph: 'id', cls: 'sm' }),
        plain(v, 'lan_summary', { ph: 'LAN summary 10.0.0.0/16' }), plain(v, 'lo_summary', { ph: 'loopback summary (optional)' }),
        h('button', { class: 'ghost', onclick: () => store.change(() => { r.vrfs.splice(i, 1); if (!r.vrfs.length) delete r.vrfs; }) }, '×'))),
      h('button', { class: 'ghost', onclick: () => store.change(() => { (r.vrfs ||= []).push({ id: 10 + (r.vrfs?.length || 0) + 1 }); }) }, '+ VRF')));
}

function overlayRows(hub) {
  const ols = hub.overlays ||= {};
  return Object.entries(ols).map(([on, ol]) => h('div', { class: 'ovl' },
    h('div', { class: 'ovlhead' }, h('span', { class: 'tag ol' }, 'Overlay'),
      nameInput(on, to => { if (!to || to in ols) return false; store.change(() => { const o = {}; for (const [k, v] of Object.entries(ols)) o[k === on ? to : k] = v; hub.overlays = o; }); return true; }),
      h('button', { class: 'ghost', title: 'Remove overlay', onclick: () => store.change(() => { delete ols[on]; }) }, '×')),
    h('div', { class: 'grid' }, OVERLAY_FIELDS.map(f => field(f, ol)))));
}

function hubCard(hn) {
  const m = store.model, hub = m.hubs[hn];
  const peer = hub.peering || {};
  return h('section', { class: 'card hub' },
    h('div', { class: 'cardhead' }, h('span', { class: 'tag hubtag' }, 'Hub'), nameInput(hn, to => { let ok; store.change(mm => { ok = renameHub(mm, hn, to); }); return ok; }),
      h('button', { class: 'ghost danger', onclick: () => confirmDel('hub ' + hn + ' (and its device)') && store.change(mm => deleteHub(mm, hn)) }, 'Delete')),
    h('div', { class: 'grid' }, HUB_FIELDS.map(f => field(f, hub))),
    h('div', { class: 'sub' }, h('h4', {}, 'Overlays terminated on this Hub'), overlayRows(hub),
      h('div', { class: 'btnrow' }, ['ISP1', 'ISP2', 'MPLS'].filter(x => !(x in (hub.overlays || {}))).map(x =>
        h('button', { class: 'ghost', onclick: () => store.change(() => { (hub.overlays ||= {})[x] = { wan_ip: { $var: hn.replace(/\W/g, '_').toLowerCase() + '_' + x.toLowerCase() }, network_id: String(11 + Object.keys(hub.overlays || {}).length) }; }) }, '+ ' + x)),
        h('button', { class: 'ghost', onclick: () => { const n = prompt('Overlay name (must match ol_type on the profiles)'); if (n) store.change(() => { (hub.overlays ||= {})[n] = { wan_ip: { $var: '' }, network_id: '' }; }); } }, '+ custom…'))),
    h('details', { class: 'sub', open: Object.keys(peer).length > 0 },
      h('summary', {}, 'BGP peering (mixed deployments)'),
      h('p', { class: 'hint' }, 'Optional. By default a single peering serves all Spokes. Define named peerings (e.g. EDGE_RR and EDGE) to mix route-reflector and dynamic-BGP Spokes.'),
      Object.entries(peer).map(([pn, p]) => h('div', { class: 'ovl' }, h('div', { class: 'ovlhead' }, h('span', { class: 'tag ol' }, 'Peering'),
        nameInput(pn, to => { if (!to || to in peer) return false; store.change(() => { const o = {}; for (const [k, v] of Object.entries(peer)) o[k === pn ? to : k] = v; hub.peering = o; }); return true; }),
        h('button', { class: 'ghost', onclick: () => store.change(() => { delete peer[pn]; if (!Object.keys(peer).length) delete hub.peering; }) }, '×')),
        h('div', { class: 'grid' }, PEERING_FIELDS.map(f => field(f, p))))),
      h('button', { class: 'ghost', onclick: () => store.change(() => { const p = hub.peering ||= {}; p[uniqueName(p, Object.keys(p).length ? 'EDGE' : 'EDGE_RR')] = { dynamic_bgp: Object.keys(p).length > 0, lo_summary: store.model.options.lo_summary || '' }; }) }, '+ peering')));
}

export function regionsView() {
  const m = store.model;
  return h('div', { class: 'view' },
    h('div', { class: 'viewhead' }, h('h2', {}, 'Regions & Hubs'),
      h('p', {}, 'A region is a group of Hubs and the Spokes they serve. Each Hub terminates one tunnel endpoint per overlay (ISP1, ISP2, MPLS…); Spokes connect to them using the matching ',
        h('code', {}, 'ol_type'), ' on their WAN links.')),
    h('div', { class: 'cols2' },
      h('div', {}, h('div', { class: 'sechead' }, h('h3', {}, 'Regions'),
        h('button', { class: 'btn', onclick: () => store.change(mm => { mm.regions[uniqueName(mm.regions, 'Region')] = { as: String(65001 + Object.keys(mm.regions).length), hubs: [] }; }) }, '+ Region')),
        Object.keys(m.regions).map(regionCard)),
      h('div', {}, h('div', { class: 'sechead' }, h('h3', {}, 'Hubs'),
        h('button', { class: 'btn', onclick: () => store.change(mm => {
          const n = uniqueName(mm.hubs, 'Hub'), k = Object.keys(mm.hubs).length;
          mm.hubs[n] = { lo_bgp: '', overlays: { ISP1: { wan_ip: { $var: n.toLowerCase() + '_isp1' }, network_id: String(11 + 10 * k) } } };
          const last = Object.values(mm.regions).pop(); if (last) (last.hubs ||= []).push(n);
        }) }, '+ Hub')),
        Object.keys(m.hubs).map(hubCard))));
}
