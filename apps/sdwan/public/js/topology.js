// SVG topology: regions as boxes, Hubs on top, Edges below, tunnels as lines.
import { svg } from './dom.js';

const OL_COLORS = ['#2a7de1', '#e07b00', '#2e9e5b', '#a24bd0', '#d1436a', '#18a2b8'];

export function topology(m, selected) {
  const regions = Object.entries(m.regions);
  const inv = m.inventory, edges = inv.Edge || {};
  const olNames = [...new Set(Object.values(m.hubs).flatMap(h => Object.keys(h.overlays || {})))];
  const col = n => OL_COLORS[olNames.indexOf(n) % OL_COLORS.length];

  const COLW = 330, EDGE_W = 92, EDGE_H = 44, HUB_W = 120, HUB_H = 54, TOP = 96, GAP = 36;
  const layout = regions.map(([rn, r], ci) => {
    const hubs = (r.hubs || []).filter(h => m.hubs[h]);
    const eds = Object.entries(edges).filter(([, d]) => d.region === rn).map(([n, d]) => ({ n, d }));
    const perRow = Math.max(1, Math.floor((COLW - 20) / (EDGE_W + 10)));
    const rows = Math.ceil(eds.length / perRow);
    return { rn, r, ci, hubs, eds, perRow, rows };
  });
  const tallest = Math.max(1, ...layout.map(l => l.rows));
  const H = TOP + HUB_H + 130 + tallest * (EDGE_H + 14) + 56;
  const W = Math.max(480, layout.length * (COLW + GAP) + GAP);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'topo', role: 'img', 'aria-label': 'Topology diagram' });
  const hubPos = {}, lines = [], nodes = [], bg = [];

  for (const l of layout) {
    const x0 = GAP + l.ci * (COLW + GAP);
    bg.push(svg('rect', { x: x0, y: 14, width: COLW, height: H - 56, rx: 14, class: 'region' }));
    nodes.push(svg('text', { x: x0 + 14, y: 38, class: 'rname' }, l.rn));
    nodes.push(svg('text', { x: x0 + COLW - 14, y: 38, class: 'rmeta', 'text-anchor': 'end' }, 'AS ' + (l.r.as || '?') + (l.r.lo_summary ? '  ·  ' + l.r.lo_summary : '')));
    const step = COLW / (l.hubs.length || 1);
    l.hubs.forEach((hn, i) => {
      const cx = x0 + step * i + step / 2, y = TOP + 6;
      hubPos[hn] = { cx, y, bottom: y + HUB_H };
      nodes.push(svg('g', { class: 'hub' + (selected === hn ? ' sel' : ''), 'data-kind': 'Hub', 'data-name': hn },
        svg('rect', { x: cx - HUB_W / 2, y, width: HUB_W, height: HUB_H, rx: 10 }),
        svg('text', { x: cx, y: y + 22, 'text-anchor': 'middle', class: 'hn' }, hn),
        svg('text', { x: cx, y: y + 40, 'text-anchor': 'middle', class: 'hm' }, m.hubs[hn].lo_bgp && typeof m.hubs[hn].lo_bgp === 'string' ? m.hubs[hn].lo_bgp : 'HUB')));
    });
    const ey = TOP + HUB_H + 120;
    l.eds.forEach(({ n, d }, i) => {
      const row = Math.floor(i / l.perRow), colI = i % l.perRow;
      const inRow = Math.min(l.perRow, l.eds.length - row * l.perRow);
      const x = x0 + (COLW - inRow * (EDGE_W + 10) + 10) / 2 + colI * (EDGE_W + 10), y = ey + row * (EDGE_H + 14);
      l.hubs.forEach(hn => lines.push({ from: { x: x + EDGE_W / 2, y }, to: hubPos[hn], hub: hn, edge: n }));
      nodes.push(svg('g', { class: 'edge' + (selected === n ? ' sel' : ''), 'data-kind': 'Edge', 'data-name': n },
        svg('rect', { x, y, width: EDGE_W, height: EDGE_H, rx: 8 }),
        svg('text', { x: x + EDGE_W / 2, y: y + 19, 'text-anchor': 'middle', class: 'en' }, n.length > 13 ? n.slice(0, 12) + '…' : n),
        svg('text', { x: x + EDGE_W / 2, y: y + 34, 'text-anchor': 'middle', class: 'em' }, d.profile || '')));
    });
  }
  // Edge -> Hub tunnels (one line per overlay, fanned slightly)
  const under = [];
  for (const ln of lines) {
    if (!ln.to) continue;
    const ols = Object.keys(m.hubs[ln.hub].overlays || {});
    ols.forEach((o, i) => {
      const off = (i - (ols.length - 1) / 2) * 5;
      under.push(svg('path', { class: 'tun', stroke: col(o), d: `M${ln.from.x + off},${ln.from.y} C${ln.from.x + off},${ln.from.y - 50} ${ln.to.cx + off},${ln.to.bottom + 50} ${ln.to.cx + off},${ln.to.bottom}` }));
    });
  }
  // Hub <-> Hub (inter-region always when multireg; intra-region when enabled)
  const hubLines = [], hubNames = Object.keys(hubPos), multireg = m.options.multireg !== false, intra = m.options.intrareg_hub2hub === true;
  const regionOf = hn => layout.find(l => l.hubs.includes(hn));
  for (let i = 0; i < hubNames.length; i++) for (let j = i + 1; j < hubNames.length; j++) {
    const a = hubNames[i], b = hubNames[j], same = regionOf(a) === regionOf(b);
    if ((same && !intra) || (!same && !multireg)) continue;
    const A = hubPos[a], B = hubPos[b], mid = TOP - 52 - (same ? 0 : 8);
    hubLines.push(svg('path', { class: 'h2h' + (same ? ' intra' : ''), d: `M${A.cx},${A.y} C${A.cx},${mid} ${B.cx},${mid} ${B.cx},${B.y}` }));
  }
  root.append(...bg, ...hubLines, ...under, ...nodes);

  const legend = olNames.map((o, i) => svg('g', {}, svg('rect', { x: 14 + i * 90, y: H - 26, width: 18, height: 4, fill: col(o) }), svg('text', { x: 38 + i * 90, y: H - 20, class: 'rmeta' }, o)));
  root.append(...legend);
  return root;
}
