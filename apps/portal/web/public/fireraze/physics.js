// Fire Raze engine: simple, solid box physics.
// Bodies are boxes that never rotate (like the player in most first-person games).
import { AXES, overlaps } from "./collide.js";

export const GRAVITY = 15;
export const MAX_FALL_SPEED = 30;
const STEP = 0.12; // never move further than this in one go, so fast things can't pass through walls

/**
 * Move a box-shaped body by its velocity, sliding along walls.
 * `solids` are boxes to bump into; boxes in `ignore` are skipped (portal holes).
 * Changes `center` and `vel` in place. Returns true when the body lands on something.
 */
export function moveBody(center, half, vel, dt, solids, ignore = new Set()) {
  const dist = vel.length() * dt;
  const steps = Math.max(1, Math.ceil(dist / STEP));
  const h = dt / steps;
  let grounded = false;
  for (let i = 0; i < steps; i++) {
    for (const ax of AXES) {
      const v = vel[ax];
      if (v === 0) continue;
      center[ax] += v * h;
      for (const s of solids) {
        if (ignore.has(s) || !overlaps(center, half, s)) continue;
        if (v > 0) {
          center[ax] = s.min[ax] - half[ax] - 1e-4;
        } else {
          center[ax] = s.max[ax] + half[ax] + 1e-4;
          if (ax === "y") grounded = true;
        }
        vel[ax] = 0;
      }
    }
  }
  return grounded;
}

// Live settings the console can change (`sv_gravity`).
export const physicsSettings = { gravity: GRAVITY };

export function applyGravity(vel, dt) {
  vel.y = Math.max(vel.y - physicsSettings.gravity * dt, -MAX_FALL_SPEED);
}
