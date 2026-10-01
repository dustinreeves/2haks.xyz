// Level data: a grid of one-character tiles (see TILES in rules.js).
// Saved/shared form: { version: 1, boss: "slime_king", tiles: [H strings of W chars] }

import { W, H, TILES, BOSSES, BASE_BUDGET, BUDGET_STEP, UNLOCKS } from "./rules.js";

export class Grid {
  constructor(rows) {
    this.cells = rows.map((r) => Array.from(r));
  }

  static fromLevel(level) {
    return new Grid(level.tiles);
  }

  clone() {
    return new Grid(this.toRows());
  }

  toRows() {
    return this.cells.map((r) => r.join(""));
  }

  inside(x, y) {
    return x >= 0 && x < W && y >= 0 && y < H;
  }

  // Outside the level: side walls are solid, the sky and the pit below are empty.
  get(x, y) {
    if (x < 0 || x >= W) return "#";
    if (y < 0 || y >= H) return ".";
    return this.cells[y][x];
  }

  set(x, y, c) {
    if (this.inside(x, y)) this.cells[y][x] = c;
  }

  solid(x, y) {
    return !!TILES[this.get(x, y)]?.solid;
  }

  hazard(x, y) {
    return !!TILES[this.get(x, y)]?.hazard;
  }

  find(c) {
    for (let y = 0; y < H; y++) {
      const x = this.cells[y].indexOf(c);
      if (x !== -1) return { x, y };
    }
    return null;
  }

  forEach(fn) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(this.cells[y][x], x, y);
  }
}

export function defaultLevel() {
  const g = new Grid(Array.from({ length: H }, (_, y) => (y >= H - 2 ? "#" : ".").repeat(W)));
  g.set(2, H - 3, "S");
  g.set(W - 3, H - 3, "F");
  g.set(W - 9, H - 3, "K");
  return { version: 1, boss: "slime_king", tiles: g.toRows() };
}

export function levelFromGrid(grid, boss) {
  return { version: 1, boss, tiles: grid.toRows() };
}

export function budgetFor(save) {
  return BASE_BUDGET + BUDGET_STEP * (save.upgrades.budget || 0);
}

export function trapCost(grid) {
  let total = 0;
  grid.forEach((c) => { total += TILES[c]?.cost || 0; });
  return total;
}

export function isUnlocked(save, unlockId) {
  return !unlockId || save.unlocked.includes(unlockId);
}

// Checks the shape of a level from storage or the network. Returns an error string or null.
export function shapeError(level) {
  if (!level || typeof level !== "object") return "Level data is missing.";
  if (level.version !== 1) return "This level was made with a different version of the game.";
  if (!(level.boss in BOSSES)) return "Unknown boss.";
  if (!Array.isArray(level.tiles) || level.tiles.length !== H) return `A level must be ${H} rows tall.`;
  for (const row of level.tiles) {
    if (typeof row !== "string" || row.length !== W) return `Every row must be ${W} tiles wide.`;
    for (const c of row) if (!(c in TILES)) return `Unknown tile "${c}".`;
  }
  return null;
}

// Rules a level must follow before a wave can start (the route check lives in nav.js).
export function levelProblems(level, save) {
  const shape = shapeError(level);
  if (shape) return [shape];

  const grid = Grid.fromLevel(level);
  const problems = [];
  const counts = {};
  grid.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });

  for (const c of ["S", "F", "K"]) {
    if ((counts[c] || 0) !== 1) problems.push(`Place exactly one ${TILES[c].name}.`);
  }
  for (const [c, n] of Object.entries(counts)) {
    const unlock = TILES[c]?.unlock;
    if (n && !isUnlocked(save, unlock)) problems.push(`${TILES[c].name} is locked. Unlock it in the shop.`);
  }
  if (!isUnlocked(save, BOSSES[level.boss].unlock)) {
    problems.push(`${BOSSES[level.boss].name} is locked. Unlock it in the shop.`);
  }
  const cost = trapCost(grid);
  const budget = budgetFor(save);
  if (cost > budget) problems.push(`This level uses ${cost} trap points, but you only have ${budget}.`);

  const door = grid.find("S");
  if (door && !grid.solid(door.x, door.y + 1)) problems.push("The Hero Door needs a block under it.");

  const spot = grid.find("K");
  if (spot) {
    const { w, h } = BOSSES[level.boss];
    const x0 = spot.x + 0.5 - w / 2, y0 = spot.y + 1 - h;
    let blocked = false;
    for (let y = Math.floor(y0); y <= spot.y; y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) blocked ||= grid.solid(x, y);
    }
    if (blocked) problems.push(`Your ${BOSSES[level.boss].name} needs more room around the Boss Spot.`);
  }
  return problems;
}

export const UNLOCK_NAMES = Object.fromEntries(Object.entries(UNLOCKS).map(([k, v]) => [k, v.name]));
