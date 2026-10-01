// Level editor: paint tiles with the mouse or a finger.

import { TILES } from "./rules.js";
import { budgetFor, trapCost, isUnlocked } from "./level.js";

const UNDO_LIMIT = 100;

export class Editor {
  // hooks: { save(), changed(), toast(msg) }
  constructor(canvas, camera, grid, getSave, hooks) {
    this.canvas = canvas;
    this.cam = camera;
    this.grid = grid;
    this.getSave = getSave;
    this.hooks = hooks;
    this.tool = "#";
    this.hover = null;
    this.undoStack = [];
    this.painting = false;
    this.lastCell = null;
    this.active = true;

    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", () => this.onUp());
    canvas.addEventListener("pointercancel", () => this.onUp());
    canvas.addEventListener("pointerleave", () => { this.hover = null; });
    canvas.addEventListener("contextmenu", (e) => { if (this.active) e.preventDefault(); });
  }

  setGrid(grid) {
    this.grid = grid;
    this.undoStack = [];
  }

  cellAt(e) {
    const t = this.cam.toTile(e.clientX, e.clientY);
    const x = Math.floor(t.x), y = Math.floor(t.y);
    return this.grid.inside(x, y) ? { x, y } : null;
  }

  onDown(e) {
    if (!this.active) return;
    const cell = this.cellAt(e);
    if (!cell) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.painting = true;
    this.erasing = e.button === 2;
    this.lastCell = null;
    this.pushUndo();
    this.strokeChanged = false;
    this.paintCell(cell, true);
  }

  onMove(e) {
    if (!this.active) return;
    const cell = this.cellAt(e);
    this.hover = cell ? { ...cell, ok: this.canPlace(cell, this.erasing ? "." : this.tool).ok } : null;
    if (this.painting && cell) this.paintCell(cell, false);
  }

  onUp() {
    if (!this.painting) return;
    this.painting = false;
    if (!this.strokeChanged) this.undoStack.pop();
    else this.hooks.save();
  }

  pushUndo() {
    this.undoStack.push(this.grid.toRows());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  undo() {
    const rows = this.undoStack.pop();
    if (!rows) return this.hooks.toast("Nothing to undo.");
    rows.forEach((row, y) => Array.from(row).forEach((c, x) => this.grid.set(x, y, c)));
    this.hooks.changed();
    this.hooks.save();
  }

  canPlace({ x, y }, c) {
    const old = this.grid.get(x, y);
    if (old === c) return { ok: true, same: true };
    if (TILES[old].unique && c !== old) {
      return { ok: false, why: `That's the ${TILES[old].name}. Pick it in the palette to move it.` };
    }
    if (!isUnlocked(this.getSave(), TILES[c].unlock)) {
      return { ok: false, why: `${TILES[c].name} is locked. Unlock it in the shop!` };
    }
    const cost = trapCost(this.grid) - (TILES[old].cost || 0) + (TILES[c].cost || 0);
    const budget = budgetFor(this.getSave());
    if (cost > budget) {
      return { ok: false, why: `Not enough trap points (${budget}). Get more in the shop!` };
    }
    return { ok: true };
  }

  paintCell(cell, first) {
    if (this.lastCell && this.lastCell.x === cell.x && this.lastCell.y === cell.y) return;
    this.lastCell = cell;
    const c = this.erasing ? "." : this.tool;
    const check = this.canPlace(cell, c);
    if (check.same) return;
    if (!check.ok) {
      if (first) this.hooks.toast(check.why);
      return;
    }
    if (TILES[c].unique) {
      const old = this.grid.find(c);
      if (old) this.grid.set(old.x, old.y, ".");
      this.painting = false; // one placement per tap for the door, flag and boss
    }
    this.grid.set(cell.x, cell.y, c);
    this.strokeChanged = true;
    this.hooks.changed();
    if (!this.painting) this.hooks.save();
  }
}
