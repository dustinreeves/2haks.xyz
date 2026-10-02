// Fire Raze engine: box maths shared by physics, portals and the world.
import * as THREE from "../vendor/three-0.170.0.module.min.js";

export const AXES = ["x", "y", "z"];

export function box3(raw) {
  return { min: new THREE.Vector3(...raw.min), max: new THREE.Vector3(...raw.max) };
}

export function insideBox(p, b, pad = 0) {
  return p.x >= b.min.x - pad && p.x <= b.max.x + pad
    && p.y >= b.min.y - pad && p.y <= b.max.y + pad
    && p.z >= b.min.z - pad && p.z <= b.max.z + pad;
}

// Does a box centred on `center` with half-size `half` overlap box `b`?
export function overlaps(center, half, b) {
  return center.x + half.x > b.min.x && center.x - half.x < b.max.x
    && center.y + half.y > b.min.y && center.y - half.y < b.max.y
    && center.z + half.z > b.min.z && center.z - half.z < b.max.z;
}

// Ray vs box ("slab" method). Returns {t, normal, axis} for the face the ray hits first, or null.
export function rayBox(origin, dir, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  for (let i = 0; i < 3; i++) {
    const ax = AXES[i];
    const o = origin[ax];
    const d = dir[ax];
    if (Math.abs(d) < 1e-9) {
      if (o < b.min[ax] || o > b.max[ax]) return null;
      continue;
    }
    let t1 = (b.min[ax] - o) / d;
    let t2 = (b.max[ax] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) { tmin = t1; axis = i; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || axis < 0) return null;
  const normal = new THREE.Vector3();
  normal.setComponent(axis, dir[AXES[axis]] > 0 ? -1 : 1);
  return { t: tmin, normal, axis };
}

// Nearest box a ray hits, out of `boxes`.
export function castRay(origin, dir, boxes, maxDist = 100) {
  let best = null;
  for (const b of boxes) {
    const hit = rayBox(origin, dir, b);
    if (hit && hit.t < maxDist && (!best || hit.t < best.t)) best = { ...hit, box: b };
  }
  return best;
}
