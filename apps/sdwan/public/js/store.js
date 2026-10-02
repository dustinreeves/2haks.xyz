// Design state: one model object, undo/redo snapshots, autosave to localStorage.
import { emitProject, emitInventory } from './model.js';

const KEY = 'sdwan-advpn-designer:v1';

export function blankModel(release = '7.4') {
  return {
    release,
    options: { lo_summary: '10.200.0.0/16', cert_auth: false },
    regions: { Region1: { as: '65001', hubs: ['Hub1'] } },
    profiles: {
      Branch: { interfaces: [
        { name: { $var: 'isp1_intf' }, role: 'wan', ol_type: 'ISP1', ip: 'dhcp' },
        { name: { $var: 'lan_intf' }, role: 'lan', ip: { $var: 'lan_ip' } },
      ] },
      HubProfile: { interfaces: [
        { name: { $var: 'isp1_intf' }, role: 'wan', ol_type: 'ISP1', ip: { $var: 'isp1_ip' } },
        { name: { $var: 'lan_intf' }, role: 'lan', ip: { $var: 'lan_ip' } },
      ] },
    },
    hubs: { Hub1: { lo_bgp: '10.200.1.253', overlays: { ISP1: { wan_ip: { $var: 'hub_isp1' }, network_id: '11' } } } },
    inventory: {
      defaults: { hub_isp1: '100.64.1.1' },
      Hub: { Hub1: { hostname: 'Hub1', loopback: '10.200.1.253', profile: 'HubProfile', region: 'Region1', isp1_intf: 'port1', isp1_ip: '100.64.1.1/24', lan_intf: 'port5', lan_ip: '10.1.0.1/24' } },
      Edge: { 'Edge-1': { hostname: 'Edge-1', loopback: '10.200.1.1', profile: 'Branch', region: 'Region1', isp1_intf: 'port1', lan_intf: 'port5', lan_ip: '10.0.1.1/24' } },
    },
  };
}

class Store {
  constructor() {
    this.name = 'Untitled design';
    this.model = this.load() || blankModel();
    this.undo = []; this.redo = []; this.last = JSON.stringify(this.model);
    this.handlers = []; this.timer = null; this.rev = 0;
  }
  on(fn) { this.handlers.push(fn); }
  fire(structural) { this.rev++; for (const h of this.handlers) h({ structural }); this.save(); }

  // Structural change (add/remove/rename): snapshot now, tell views to rebuild.
  change(fn) { this.flush(); fn(this.model); this.commit(); this.fire(true); }
  // Value edit while typing: no view rebuild; snapshot after a pause.
  touch() { clearTimeout(this.timer); this.timer = setTimeout(() => this.commit(), 700); this.fire(false); }
  flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; this.commit(); } }
  commit() {
    const now = JSON.stringify(this.model);
    if (now === this.last) return;
    this.undo.push(this.last); if (this.undo.length > 100) this.undo.shift();
    this.redo = []; this.last = now;
  }
  replace(model, name) { this.flush(); this.model = model; if (name) this.name = name; this.commit(); this.fire(true); }
  back() { this.flush(); if (!this.undo.length) return; this.redo.push(this.last); this.last = this.undo.pop(); this.model = JSON.parse(this.last); this.fire(true); }
  forward() { if (!this.redo.length) return; this.undo.push(this.last); this.last = this.redo.pop(); this.model = JSON.parse(this.last); this.fire(true); }

  files() { return { project: emitProject(this.model), inventory: emitInventory(this.model.inventory) }; }

  save() {
    clearTimeout(this._s);
    this._s = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ model: this.model, name: this.name })); } catch { /* private mode etc. */ } }, 400);
  }
  load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.model) { this.name = d.name || this.name; return d.model; } } catch { /* ignore */ }
    return null;
  }
}
export const store = new Store();
