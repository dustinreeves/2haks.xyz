// Fast, local sanity checks. They explain the common mistakes before the renderer fails with a Jinja error.
import { isRef } from './model.js';

const IP = /^(\d{1,3}\.){3}\d{1,3}$/, CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const lit = v => (typeof v === 'string' && !isRef(v) ? v : null);

export function validate(m) {
  const out = [];
  const err = (where, msg, go) => out.push({ level: 'error', where, msg, go });
  const warn = (where, msg, go) => out.push({ level: 'warn', where, msg, go });
  const regions = Object.entries(m.regions), hubs = Object.entries(m.hubs), profiles = Object.keys(m.profiles);
  const inv = m.inventory, hubDev = inv.Hub || {}, edgeDev = inv.Edge || {};

  if (!m.options.lo_summary && !regions.every(([, r]) => r.lo_summary)) err('Project', 'No loopback summary: set lo_summary on the project or on every region.', 'project');
  if (!regions.length) err('Regions', 'Define at least one region.', 'regions');

  const inRegion = new Set();
  for (const [rn, r] of regions) {
    if (!r.as) err('Region ' + rn, 'Missing AS number.', 'regions');
    if (regions.length > 1) for (const k of ['lo_summary', 'lan_summary']) if (!r[k] && !(r.vrfs && r.vrfs.length)) warn('Region ' + rn, 'Multi-regional designs need ' + k + ' on every region.', 'regions');
    if (!(r.hubs || []).length) err('Region ' + rn, 'No Hubs assigned.', 'regions');
    for (const hn of r.hubs || []) { inRegion.add(hn); if (!m.hubs[hn]) err('Region ' + rn, 'Hub "' + hn + '" is not defined under Hubs.', 'regions'); }
    for (const k of ['lo_summary', 'lan_summary']) if (lit(r[k]) && !CIDR.test(r[k])) err('Region ' + rn, k + ' must look like 10.0.0.0/16.', 'regions');
  }
  const ass = regions.map(([, r]) => r.as).filter(Boolean);
  if (new Set(ass).size !== ass.length) warn('Regions', 'Two regions share an AS number (inter-region eBGP expects distinct ASNs).', 'regions');

  const olTypes = new Set();
  for (const [hn, hub] of hubs) {
    if (!inRegion.has(hn)) warn('Hub ' + hn, 'Not assigned to any region.', 'regions');
    if (!hub.lo_bgp) err('Hub ' + hn, 'Missing BGP loopback.', 'regions');
    else if (lit(hub.lo_bgp) && !IP.test(hub.lo_bgp)) err('Hub ' + hn, 'BGP loopback is not an IPv4 address.', 'regions');
    const ols = Object.entries(hub.overlays || {});
    if (!ols.length) err('Hub ' + hn, 'No overlays defined.', 'regions');
    const ids = new Map();
    for (const [on, ol] of ols) {
      olTypes.add(on);
      if (ol.wan_ip === undefined || ol.wan_ip === '') err('Hub ' + hn + ' / ' + on, 'Missing endpoint IP.', 'regions');
      if (ol.network_id === undefined || ol.network_id === '') err('Hub ' + hn + ' / ' + on, 'Missing network ID.', 'regions');
      else { const k = String(ol.network_id); if (ids.has(k)) err('Hub ' + hn, 'Network ID ' + k + ' used by both ' + ids.get(k) + ' and ' + on + '.', 'regions'); ids.set(k, on); }
    }
    if (!(hn in hubDev)) warn('Hub ' + hn, 'No matching Hub device in Devices, so no config is generated for it.', 'devices');
  }

  const names = new Map(), loops = new Map();
  for (const [g, devs] of [['Hub', hubDev], ['Edge', edgeDev]]) for (const [dn, d] of Object.entries(devs)) {
    const w = g + ' ' + dn;
    if (names.has(d.hostname || dn)) err(w, 'Duplicate hostname "' + (d.hostname || dn) + '".', 'devices'); names.set(d.hostname || dn, 1);
    if (!d.hostname) err(w, 'Missing hostname.', 'devices');
    else if (d.hostname !== dn) warn(w, 'Hostname "' + d.hostname + '" differs from the device name "' + dn + '".', 'devices');
    if (!d.loopback) err(w, 'Missing loopback.', 'devices');
    else if (!IP.test(String(d.loopback).split('/')[0])) err(w, 'Loopback is not an IPv4 address.', 'devices');
    else { const k = String(d.loopback).split('/')[0]; if (loops.has(k)) err(w, 'Loopback ' + k + ' already used by ' + loops.get(k) + '.', 'devices'); loops.set(k, w); }
    if (!d.profile) err(w, 'No profile.', 'devices'); else if (!profiles.includes(d.profile)) err(w, 'Unknown profile "' + d.profile + '".', 'devices');
    if (!d.region) err(w, 'No region.', 'devices'); else if (!m.regions[d.region]) err(w, 'Unknown region "' + d.region + '".', 'devices');
    for (const [k, v] of Object.entries(d)) if (/(^|_)(lan\d*_ip)$|^lan_ip$/.test(k) && v && !CIDR.test(v)) warn(w, k + ' should include a mask (e.g. 10.0.1.1/24).', 'devices');
    if (g === 'Hub' && d.region && m.regions[d.region] && !(m.regions[d.region].hubs || []).includes(d.hostname || dn)) warn(w, 'Hub device is not listed among its region’s Hubs.', 'regions');
  }
  for (const [pn, p] of Object.entries(m.profiles)) {
    for (const i of p.interfaces || []) {
      if (i.role === 'wan' && lit(i.ol_type) && olTypes.size && !olTypes.has(i.ol_type)) warn('Profile ' + pn, 'WAN interface uses overlay "' + i.ol_type + '", which no Hub defines.', 'profiles');
      if (i.role === 'wan' && !i.ol_type && Object.values(inv.Edge || {}).some(d => d.profile === pn)) warn('Profile ' + pn, 'A WAN interface has no overlay (ol_type): it will not build tunnels.', 'profiles');
    }
  }
  if (!Object.keys(hubDev).length) warn('Devices', 'No Hub devices.', 'devices');
  if (!Object.keys(edgeDev).length) warn('Devices', 'No Edge devices.', 'devices');
  return out;
}
