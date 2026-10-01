// Hero navigation.
//
// A "node" is a tile a hero can stand in. From each node we simulate every
// move in TEMPLATES with the real hero physics and record where it lands.
// Dijkstra from the flag then gives each node its distance to the goal.
// The same graph powers the fairness check (can a perfect hero win?) and the
// hero AI, which replays the exact same inputs from the node's centre.

import { W, H, HERO_SIZE } from "./rules.js";
import { stepActor, touchesHazard, overlaps, centerX } from "./physics.js";

export const GOAL = -1;
const MAX_FRAMES = 150;

export const TEMPLATES = [
  { kind: "walk", dir: 1 },
  { kind: "walk", dir: -1 },
  { kind: "drop", dir: 1 },   // walk off a ledge, then let go
  { kind: "drop", dir: -1 },
  ...[1, 0.5, 0, -0.5, -1].flatMap((dir) => [
    { kind: "jump", dir, hold: 30 },  // full jump
    { kind: "jump", dir, hold: 4 },   // short hop
  ]),
];

export const nodeId = (x, y) => y * W + x;

export function standable(grid, x, y) {
  return grid.inside(x, y) && !grid.solid(x, y) && !grid.hazard(x, y) && grid.solid(x, y + 1);
}

export function goalBox(flag) {
  return { x: flag.x + 0.25, y: flag.y - 1, w: 0.5, h: 2 };
}

export function heroBodyAt(x, y) {
  const { w, h } = HERO_SIZE;
  return { x: x + 0.5 - w / 2, y: y + 1 - h, w, h, vx: 0, vy: 0, onGround: true };
}

// Which standable tile is this grounded body in? Prefers the tile under its centre.
export function nodeUnder(grid, b) {
  const y = Math.round(b.y + b.h) - 1;
  const cx = Math.floor(centerX(b));
  if (standable(grid, cx, y)) return nodeId(cx, y);
  for (const x of [cx - 1, cx + 1]) {
    if (x + 1 > b.x && x < b.x + b.w && standable(grid, x, y)) return nodeId(x, y);
  }
  return null;
}

// Advance a body one frame through a move template.
// st = { frame, airborne, startX }; returns "running" | "landed" | "blocked".
export function templateStep(b, grid, tpl, st) {
  let dir = tpl.dir;
  if (tpl.kind === "drop" && st.airborne) dir = 0;
  stepActor(b, { dir, jump: tpl.kind === "jump" && st.frame < tpl.hold }, grid);
  st.frame++;

  if (!b.onGround) {
    st.airborne = true;
    return st.frame >= MAX_FRAMES ? "blocked" : "running";
  }
  if (st.airborne) return "landed";
  if (tpl.kind === "jump") return "running"; // take-off frame
  if (b.hitWall) return "blocked";
  const crossed = (centerX(b) - (st.startX + 0.5 + tpl.dir)) * tpl.dir >= 0;
  if (crossed) return "landed";
  return st.frame >= MAX_FRAMES ? "blocked" : "running";
}

function simulate(grid, node, tpl, goal, trace) {
  const b = heroBodyAt(node.x, node.y);
  const st = { frame: 0, airborne: false, startX: node.x };
  for (;;) {
    const status = templateStep(b, grid, tpl, st);
    trace?.push({ x: centerX(b), y: b.y + b.h / 2 });
    if (touchesHazard(b, grid) || b.y > H + 1) return null;
    if (overlaps(b, goal)) return { to: GOAL, frames: st.frame };
    if (status === "blocked") return null;
    if (status === "landed") {
      const to = nodeUnder(grid, b);
      return to === null ? null : { to, frames: st.frame };
    }
  }
}

export function buildNav(grid) {
  const start = grid.find("S");
  const flag = grid.find("F");
  const nodes = new Map();
  if (!start || !flag) return { nodes, dist: new Map(), startId: null, ok: false, goal: null };
  const goal = goalBox(flag);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (standable(grid, x, y)) nodes.set(nodeId(x, y), { id: nodeId(x, y), x, y, edges: [] });
    }
  }

  // Keep the fastest template to each destination.
  for (const node of nodes.values()) {
    const best = new Map();
    TEMPLATES.forEach((tpl, i) => {
      const r = simulate(grid, node, tpl, goal);
      if (!r || r.to === node.id) return;
      const prev = best.get(r.to);
      if (!prev || r.frames < prev.frames) best.set(r.to, { to: r.to, frames: r.frames, tpl: i });
    });
    node.edges = [...best.values()];
  }

  // Dijkstra on reversed edges, from the goal.
  const incoming = new Map();
  for (const node of nodes.values()) {
    for (const e of node.edges) {
      if (!incoming.has(e.to)) incoming.set(e.to, []);
      incoming.get(e.to).push({ from: node.id, frames: e.frames });
    }
  }
  const dist = new Map([[GOAL, 0]]);
  const done = new Set();
  for (;;) {
    let cur = null, curD = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < curD) { cur = id; curD = d; }
    if (cur === null) break;
    done.add(cur);
    for (const { from, frames } of incoming.get(cur) || []) {
      const nd = curD + frames;
      if (nd < (dist.get(from) ?? Infinity)) dist.set(from, nd);
    }
  }

  const startId = nodeId(start.x, start.y);
  return { nodes, dist, startId, ok: dist.has(startId), goal };
}

// The fastest route from the door, as points for drawing.
export function routePoints(grid, nav) {
  const points = [];
  let id = nav.startId;
  for (let guard = 0; guard < 400 && id !== GOAL && nav.dist.has(id); guard++) {
    const node = nav.nodes.get(id);
    let best = null;
    for (const e of node.edges) {
      const d = e.frames + (nav.dist.get(e.to) ?? Infinity);
      if (!best || d < best.d) best = { e, d };
    }
    if (!best || !Number.isFinite(best.d)) break;
    simulate(grid, node, TEMPLATES[best.e.tpl], nav.goal, points);
    id = best.e.to;
  }
  return points;
}
