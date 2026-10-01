// Box-vs-tile physics. Bodies are { x, y, w, h, vx, vy, onGround } in tiles,
// with (x, y) the top-left corner and y pointing down.

import { DT, PHYS } from "./rules.js";

const EPS = 1e-6;

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function centerX(b) {
  return b.x + b.w / 2;
}

export function centerY(b) {
  return b.y + b.h / 2;
}

// Move by velocity for one step, stopping at solid tiles (x first, then y).
export function moveBody(b, grid) {
  b.hitWall = 0;
  b.x += b.vx * DT;
  if (b.vx !== 0) {
    const y0 = Math.floor(b.y + EPS);
    const y1 = Math.floor(b.y + b.h - EPS);
    const tx = b.vx > 0 ? Math.floor(b.x + b.w - EPS) : Math.floor(b.x + EPS);
    for (let y = y0; y <= y1; y++) {
      if (grid.solid(tx, y)) {
        b.x = b.vx > 0 ? tx - b.w : tx + 1;
        b.hitWall = Math.sign(b.vx);
        b.vx = 0;
        break;
      }
    }
  }

  b.y += b.vy * DT;
  b.onGround = false;
  if (b.vy !== 0) {
    const x0 = Math.floor(b.x + EPS);
    const x1 = Math.floor(b.x + b.w - EPS);
    const ty = b.vy > 0 ? Math.floor(b.y + b.h - EPS) : Math.floor(b.y + EPS);
    for (let x = x0; x <= x1; x++) {
      if (grid.solid(x, ty)) {
        if (b.vy > 0) {
          b.y = ty - b.h;
          b.onGround = true;
        } else {
          b.y = ty + 1;
        }
        b.vy = 0;
        break;
      }
    }
  }
}

// One step for a hero-like body. input = { dir: -1..1, jump: bool (held) }.
export function stepActor(b, input, grid, speed = PHYS.runSpeed, jumpSpeed = PHYS.jumpSpeed) {
  b.vx = input.dir * speed;
  if (input.jump && b.onGround) {
    b.vy = -jumpSpeed;
    b.onGround = false;
  }
  if (!input.jump && b.vy < -PHYS.jumpCut) b.vy = -PHYS.jumpCut;
  b.vy = Math.min(b.vy + PHYS.gravity * DT, PHYS.maxFall);
  moveBody(b, grid);
}

// Spikes only hurt in their pointy lower part; lava below its surface.
const HAZARD_BOXES = {
  "^": { dx: 0.15, dy: 0.45, w: 0.7, h: 0.55 },
  "~": { dx: 0, dy: 0.3, w: 1, h: 0.7 },
};

export function touchesHazard(b, grid) {
  const x0 = Math.floor(b.x), x1 = Math.floor(b.x + b.w - EPS);
  const y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - EPS);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const box = HAZARD_BOXES[grid.get(x, y)];
      if (box && overlaps(b, { x: x + box.dx, y: y + box.dy, w: box.w, h: box.h })) return true;
    }
  }
  return false;
}
