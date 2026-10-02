// Builds a Three.js group for a design from the shapes in parts.json.
// Each slot gets its own group (so it can pop and explode); a part that
// hangs off another part (a muzzle on a barrel) is a child of that group.
import * as THREE from "../vendor/three-0.170.0.module.min.js";

const DEG = Math.PI / 180;

// How far each slot moves in the exploded view.
export const EXPLODE = {
  barrel: [7, 0, 0],
  muzzle: [5, 0, 0],
  grip: [0, -6, 0],
  stock: [-7, 0, 0],
  optic: [0, 6, 0],
  magazine: [0, -8, 2],
  underbarrel: [0, -6, -2],
};

const geometryCache = new Map();

function geometry(s) {
  const key = JSON.stringify([s.t, s.s, s.r1, s.r2, s.l, s.ax, s.seg, s.rad, s.tube]);
  let g = geometryCache.get(key);
  if (g) return g;
  if (s.t === "box") {
    g = new THREE.BoxGeometry(...s.s);
  } else if (s.t === "cyl") {
    g = new THREE.CylinderGeometry(s.r2 ?? s.r1, s.r1, s.l, s.seg || 20);
    if (s.ax === "x") g.rotateZ(-Math.PI / 2);
    if (s.ax === "z") g.rotateX(Math.PI / 2);
  } else if (s.t === "sph") {
    g = new THREE.SphereGeometry(s.rad, 24, 16);
  } else {
    g = new THREE.TorusGeometry(s.rad, s.tube, 12, 36);
    if (s.ax === "x") g.rotateY(Math.PI / 2);
    if (s.ax === "y") g.rotateX(Math.PI / 2);
  }
  geometryCache.set(key, g);
  return g;
}

function materialMaker(L, design) {
  const finish = L.finishes[design.paint.finish];
  const cache = new Map();
  return (m, c) => {
    const key = `${m}|${c || ""}`;
    if (cache.has(key)) return cache.get(key);
    let mat;
    switch (m) {
      case "body":
      case "accent":
        mat = new THREE.MeshStandardMaterial({
          color: c || design.paint[m],
          metalness: finish.body.metalness,
          roughness: finish.body.roughness,
        });
        break;
      case "metal":
        mat = new THREE.MeshStandardMaterial({ color: c || finish.metal.color, metalness: finish.metal.metalness, roughness: finish.metal.roughness });
        break;
      case "dark":
        mat = new THREE.MeshStandardMaterial({ color: c || "#1f2226", metalness: 0.25, roughness: 0.6 });
        break;
      case "glass":
        mat = new THREE.MeshStandardMaterial({ color: c || "#9fd8ff", metalness: 0, roughness: 0.05, transparent: true, opacity: 0.35 });
        break;
      case "glow":
        mat = new THREE.MeshStandardMaterial({ color: c || design.paint.accent, emissive: c || design.paint.accent, emissiveIntensity: 1.6 });
        mat.userData.glow = true;
        break;
      default: // plastic
        mat = new THREE.MeshStandardMaterial({ color: c || "#ffffff", metalness: 0, roughness: 0.45 });
    }
    cache.set(key, mat);
    return mat;
  };
}

function buildShapes(shapes, material) {
  const group = new THREE.Group();
  for (const s of shapes) {
    const mesh = new THREE.Mesh(geometry(s), material(s.m, s.c));
    mesh.position.set(...s.p);
    if (s.r) mesh.rotation.set(s.r[0] * DEG, s.r[1] * DEG, s.r[2] * DEG);
    if (s.sc) mesh.scale.set(...s.sc);
    if (s.nofit) {
      mesh.userData.nofit = true;
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      mesh.material.opacity = 0.7;
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    if (s.anim) {
      mesh.userData.anim = s.anim;
      mesh.userData.home = mesh.position.clone();
    }
    group.add(mesh);
  }
  return group;
}

// Returns { root, slots: {slot: group}, firePoint: Vector3 (in root space), materials: [] }
export function buildGun(L, design) {
  const material = materialMaker(L, design);
  const base = L.bases[design.base];
  const root = new THREE.Group();
  root.add(buildShapes(base.shapes, material));

  const slots = {};
  const placed = { base: { group: root, mounts: base.mounts } };
  for (const slot of L.slots) {
    const part = L.parts[design.parts[slot]];
    if (!part) continue;
    const provider = base.mounts[slot]
      ? placed.base
      : Object.values(placed).find((p) => p.mounts?.[slot]);
    if (!provider) continue;
    const group = buildShapes(part.shapes, material);
    group.position.set(...provider.mounts[slot]);
    group.userData.home = group.position.clone();
    group.userData.explode = new THREE.Vector3(...(EXPLODE[slot] || [0, 0, 0]));
    provider.group.add(group);
    slots[slot] = group;
    placed[slot] = { group, mounts: part.mounts };
  }

  // Where the shot comes out: the front of the barrel (+ muzzle), or the base's barrel mount.
  root.updateMatrixWorld(true);
  const firePoint = new THREE.Vector3(...(base.mounts.barrel || [0, 0, 0]));
  const front = new THREE.Box3();
  for (const slot of ["barrel", "muzzle"]) {
    if (slots[slot]) front.union(fitBox(slots[slot]));
  }
  if (!front.isEmpty()) firePoint.x = front.max.x;
  return { root, slots, firePoint };
}

// Bounding box that ignores things like the laser beam.
export function fitBox(object) {
  const box = new THREE.Box3();
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (o.isMesh && !o.userData.nofit) box.expandByObject(o);
  });
  return box;
}
