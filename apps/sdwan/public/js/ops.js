// Model operations that must keep references consistent (rename / delete cascades).
import { isRef } from './model.js';

const rekey = (obj, from, to) => {      // rename a key, preserving order
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k === from ? to : k] = v;
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, out);
};
export const uniqueName = (obj, base) => { let n = base, i = 2; while (n in obj) n = base + i++; return n; };

export function renameRegion(m, from, to) {
  if (!to || from === to || to in m.regions) return false;
  rekey(m.regions, from, to);
  for (const g of ['Hub', 'Edge']) for (const d of Object.values(m.inventory[g] || {})) if (d.region === from) d.region = to;
  return true;
}
export function renameProfile(m, from, to) {
  if (!to || from === to || to in m.profiles) return false;
  rekey(m.profiles, from, to);
  for (const g of ['Hub', 'Edge']) for (const d of Object.values(m.inventory[g] || {})) if (d.profile === from) d.profile = to;
  return true;
}
export function renameHub(m, from, to) {
  if (!to || from === to || to in m.hubs) return false;
  rekey(m.hubs, from, to);
  for (const r of Object.values(m.regions)) r.hubs = (r.hubs || []).map(h => h === from ? to : h);
  const hubs = m.inventory.Hub || {};
  if (from in hubs) { rekey(hubs, from, to); if (hubs[to].hostname === from) hubs[to].hostname = to; }
  return true;
}
export function deleteRegion(m, name) { delete m.regions[name]; }
export function deleteProfile(m, name) { delete m.profiles[name]; }
export function deleteHub(m, name) {
  delete m.hubs[name];
  for (const r of Object.values(m.regions)) r.hubs = (r.hubs || []).filter(h => h !== name);
  if (m.inventory.Hub) delete m.inventory.Hub[name];
}
export function renameDevice(m, group, from, to) {
  const g = m.inventory[group]; if (!to || from === to || to in g) return false;
  rekey(g, from, to); if (g[to].hostname === from) g[to].hostname = to;
  if (group === 'Hub' && from in m.hubs && !(to in m.hubs)) renameHub(m, from, to);
  return true;
}

// ---- IP helpers (IPv4) used for "duplicate device" / bulk add
export const ip2n = s => { const p = String(s).split('/')[0].split('.').map(Number); return p.length === 4 && p.every(x => x >= 0 && x < 256) ? ((p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]) >>> 0) : null; };
export const n2ip = n => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.');
export function bumpIp(s, by = 1) {
  if (isRef(s) || typeof s !== 'string') return s;
  const [ip, mask] = s.split('/'); const n = ip2n(ip); if (n === null) return s;
  return n2ip((n + by) >>> 0) + (mask ? '/' + mask : '');
}
export function bumpName(name, taken) {
  const m = /^(.*?)(\d+)$/.exec(name); let base = m ? m[1] : name + '-', n = m ? +m[2] : 1, cand;
  do { cand = base + ++n; } while (taken && cand in taken);
  return cand;
}

// New device cloned from a template device: next hostname, next loopback; per-device LAN IPs bumped on the third octet.
export function cloneDevice(m, group, srcName) {
  const g = m.inventory[group], src = g[srcName], name = bumpName(srcName, g);
  const d = JSON.parse(JSON.stringify(src));
  d.hostname = name; d.loopback = bumpIp(src.loopback, 1);
  for (const [k, v] of Object.entries(d)) if (/(^|_)lan\d*_ip$|_lan_ip$|^lan_ip$/.test(k) && typeof v === 'string') {
    const [ip, mask] = v.split('/'), n = ip2n(ip); if (n !== null) d[k] = n2ip((n + 256) >>> 0) + (mask ? '/' + mask : '');
  }
  g[name] = d; return name;
}
