// Fire Raze engine: builds a test chamber from a level file and runs its moving parts
// (doors, buttons, cubes). Level format: see content/levels/*.json and RUNBOOK.md.
import * as THREE from "../vendor/three-0.170.0.module.min.js";
import { box3, overlaps } from "./collide.js";
import { applyGravity, moveBody } from "./physics.js";
import { ceilingLights } from "./lighting.js";
import { canvasTexture, TEXTURES, tiledBox } from "./textures.js";

const V3 = THREE.Vector3;
export const CUBE_HALF = new V3(0.3, 0.3, 0.3);

const MATS = {
  white: new THREE.MeshStandardMaterial({ ...TEXTURES.white, roughness: 0.75 }),
  // Low metalness on purpose: fully metallic surfaces only reflect, and look black in a dim room.
  metal: new THREE.MeshStandardMaterial({ ...TEXTURES.metal, roughness: 0.6, metalness: 0.12 }),
  floor: new THREE.MeshStandardMaterial({ ...TEXTURES.floor, roughness: 0.85, metalness: 0.1 }),
  ceiling: new THREE.MeshStandardMaterial({ ...TEXTURES.ceiling, roughness: 0.8, metalness: 0.05 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }),
};
const plainVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GOO = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: plainVertex,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 18.0;
      float w = sin(p.x + uTime * 1.3) * cos(p.y * 1.3 - uTime) * 0.5 + 0.5;
      gl_FragColor = vec4(mix(vec3(0.16, 0.13, 0.05), vec3(0.42, 0.36, 0.1), w), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});
const FIZZLER = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: plainVertex,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      float s = sin(vUv.x * 60.0 + uTime * 6.0) * sin(vUv.y * 40.0 - uTime * 4.0);
      gl_FragColor = vec4(vec3(0.55, 0.8, 1.0), 0.18 + 0.12 * s);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const DOOR = new THREE.MeshStandardMaterial({ ...TEXTURES.door, roughness: 0.45, metalness: 0.2 });
// Which material each face group uses (sides, top, bottom). Metal boxes get floor tiles on top.
const FACES = {
  white: [MATS.white, MATS.white, MATS.white],
  metal: [MATS.metal, MATS.floor, MATS.ceiling],
  glass: [MATS.glass, MATS.glass, MATS.glass],
};
const BUTTON_BASE = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 });
const OBS_INSIDE = new THREE.MeshBasicMaterial({ color: 0x0b0d10 });
const OBS_GLASS = new THREE.MeshStandardMaterial({
  color: 0x8fb8d8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.9, depthWrite: false,
});
const OBS_FRAME = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });

// Simple pictograms for the chamber sign, drawn in `color` centred on (cx, cy).
function drawIcon(g, kind, cx, cy, color) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 5;
  switch (kind) {
    case "portal":
      g.beginPath(); g.ellipse(0, 0, 16, 28, 0, 0, Math.PI * 2); g.stroke();
      break;
    case "twoPortals":
      g.beginPath(); g.ellipse(-20, 0, 13, 24, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.ellipse(20, 0, 13, 24, 0, 0, Math.PI * 2); g.fill();
      break;
    case "cube":
      g.fillRect(-20, -14, 32, 32);
      g.beginPath(); g.moveTo(-20, -14); g.lineTo(-10, -26); g.lineTo(22, -26); g.lineTo(12, -14); g.fill();
      g.beginPath(); g.moveTo(12, -14); g.lineTo(22, -26); g.lineTo(22, 6); g.lineTo(12, 18); g.fill();
      break;
    case "button":
      g.fillRect(-30, 14, 60, 8);
      g.beginPath(); g.ellipse(0, 10, 22, 8, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.moveTo(0, -28); g.lineTo(0, -6); g.stroke();
      g.beginPath(); g.moveTo(-8, -14); g.lineTo(0, -4); g.lineTo(8, -14); g.stroke();
      break;
    case "goo":
      for (const y of [-8, 8]) {
        g.beginPath();
        for (let x = -30; x <= 30; x += 2) g.lineTo(x, y + Math.sin(x / 6) * 5);
        g.stroke();
      }
      break;
    case "fizzler":
      for (const x of [-18, -6, 6, 18]) { g.beginPath(); g.moveTo(x, -26); g.lineTo(x, 26); g.stroke(); }
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(-28, 0); g.lineTo(28, 0); g.stroke();
      break;
    default:
      break;
  }
  g.restore();
}

const ASSEMBLE_TIME = 0.6; // seconds for each wall/platform to slide into place

// Repeatable random numbers (the same chamber always grows the same plants).
function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

const LEAF_TEX = canvasTexture(128, (g, s) => {
  g.fillStyle = "#4f8a2f";
  g.beginPath();
  g.moveTo(s * 0.5, s * 0.04);
  g.quadraticCurveTo(s * 0.98, s * 0.45, s * 0.5, s * 0.96);
  g.quadraticCurveTo(s * 0.02, s * 0.45, s * 0.5, s * 0.04);
  g.fill();
  g.strokeStyle = "#2f5a1a";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(s * 0.5, s * 0.1); g.lineTo(s * 0.5, s * 0.92); g.stroke();
});
LEAF_TEX.wrapS = LEAF_TEX.wrapT = THREE.ClampToEdgeWrapping;

const MOSS_TEX = canvasTexture(256, (g, s) => {
  const rand = seeded(5);
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * s * 0.45;
    const x = s / 2 + Math.cos(a) * d;
    const y = s / 2 + Math.sin(a) * d;
    const fade = 1 - d / (s * 0.45);
    g.fillStyle = `rgba(${50 + rand() * 40}, ${90 + rand() * 50}, ${30 + rand() * 20}, ${0.35 * fade + 0.1})`;
    g.beginPath();
    g.arc(x, y, 2 + rand() * 7, 0, Math.PI * 2);
    g.fill();
  }
});
MOSS_TEX.wrapS = MOSS_TEX.wrapT = THREE.ClampToEdgeWrapping;

// ---------- the cube: a real 3D model with depth (0.6 m across) ----------
// Dark body, raised corner bumpers joined by edge rails, a sunken light panel on every side,
// and a raised ring with a glowing centre on each panel.
const CUBE_PARTS = (() => {
  const body = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.6, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2a9, roughness: 0.35, metalness: 0.75 });
  const panel = new THREE.MeshStandardMaterial({ ...TEXTURES.cube, roughness: 0.55, metalness: 0.15 });
  const ring = new THREE.MeshStandardMaterial({ color: 0x2b3035, roughness: 0.4, metalness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2f9bff).multiplyScalar(2) });
  return {
    mats: { body, metal, panel, ring, glow },
    core: new THREE.BoxGeometry(0.54, 0.54, 0.54),
    corner: new THREE.BoxGeometry(0.17, 0.17, 0.17),
    rail: new THREE.BoxGeometry(0.27, 0.07, 0.07),
    face: new THREE.BoxGeometry(0.34, 0.34, 0.03),
    ring: new THREE.TorusGeometry(0.085, 0.018, 10, 32),
    dot: new THREE.CircleGeometry(0.05, 24),
  };
})();

function makeCubeModel() {
  const P = CUBE_PARTS;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(P.core, P.mats.body));
  const e = 0.3 - 0.085; // corner centres
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const c = new THREE.Mesh(P.corner, P.mats.metal);
    c.position.set(x * e, y * e, z * 0.215);
    g.add(c);
  }
  // Edge rails between corners (4 along each axis).
  const r = 0.3 - 0.035;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const rx = new THREE.Mesh(P.rail, P.mats.metal);
    rx.position.set(0, a * r, b * r);
    const ry = new THREE.Mesh(P.rail, P.mats.metal);
    ry.rotation.z = Math.PI / 2;
    ry.position.set(a * r, 0, b * r);
    const rz = new THREE.Mesh(P.rail, P.mats.metal);
    rz.rotation.y = Math.PI / 2;
    rz.position.set(a * r, b * r, 0);
    g.add(rx, ry, rz);
  }
  // One sunken panel + raised ring + glowing dot per side.
  const faces = [
    [new THREE.Vector3(1, 0, 0), [0, Math.PI / 2, 0]], [new THREE.Vector3(-1, 0, 0), [0, -Math.PI / 2, 0]],
    [new THREE.Vector3(0, 1, 0), [-Math.PI / 2, 0, 0]], [new THREE.Vector3(0, -1, 0), [Math.PI / 2, 0, 0]],
    [new THREE.Vector3(0, 0, 1), [0, 0, 0]], [new THREE.Vector3(0, 0, -1), [0, Math.PI, 0]],
  ];
  for (const [n, rot] of faces) {
    const side = new THREE.Group();
    side.rotation.set(...rot);
    side.position.copy(n).multiplyScalar(0.27); // panel sits below the rails: that's the depth
    const face = new THREE.Mesh(P.face, P.mats.panel);
    const ring = new THREE.Mesh(P.ring, P.mats.ring);
    ring.position.z = 0.02;
    const dot = new THREE.Mesh(P.dot, P.mats.glow);
    dot.position.z = 0.017;
    side.add(face, ring, dot);
    g.add(side);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

export class World {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.data = null;
    this._reset();
  }

  _reset() {
    this.solids = [];    // {min, max, type, mesh, door?}
    this.goo = [];
    this.fizzlers = [];
    this.doors = [];
    this.buttons = [];
    this.cubes = [];
    this.exit = null;
    this.assembly = [];
    this.assembleTime = 0;
    this.tube = null;
    this.dust = null;
  }

  clear() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.userData.ownMaterial) o.material.dispose();
    });
    this.group.clear();
    this._reset();
  }

  _box(b, material) {
    const size = new V3().subVectors(b.max, b.min);
    const mesh = new THREE.Mesh(tiledBox(size), material);
    mesh.position.copy(b.min).addScaledVector(size, 0.5);
    mesh.castShadow = material !== FACES.glass;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  // A dark, tinted window high up on the right wall: the observation room. Someone is watching.
  _observationWindow(r) {
    if (r.max.y - r.min.y < 6) return;
    const w = Math.min(4, (r.max.z - r.min.z) * 0.3);
    const h = 1.4;
    const x = r.max.x - 0.03;
    const y = r.max.y - 1.4;
    const z = (r.min.z + r.max.z) / 2;
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(w, h), OBS_INSIDE);
    inside.position.set(x + 0.01, y, z);
    inside.rotation.y = -Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), OBS_GLASS);
    glass.position.set(x - 0.02, y, z);
    glass.rotation.y = -Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, h + 0.2, w + 0.2), OBS_FRAME);
    frame.position.set(x + 0.04, y, z);
    // A tiny glowing desk lamp behind the glass.
    const lamp = new THREE.PointLight(0xffd59a, 0.6, 3);
    lamp.position.set(x + 0.4, y - 0.3, z + w * 0.3);
    this.group.add(frame, inside, glass, lamp);
  }

  // Big chamber-number sign by the entrance (on the wall behind where you start).
  // Test-chamber sign (our own design in the Portal style): big number, progress bar, and icons
  // for what's in the room. Dark icon = in this chamber, pale = not. Hangs on the right wall near the start.
  _chamberSign(r, n, total, name, data) {
    const icons = [
      ["portal", true],
      ["twoPortals", data.gun === "both"],
      ["cube", data.cubes.length > 0],
      ["button", data.buttons.length > 0],
      ["goo", data.goo.length > 0],
      ["fizzler", data.fizzlers.length > 0],
    ];
    const tex = canvasTexture(512, (g, s) => {
      g.fillStyle = "#f4f5f6";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#1d2126";
      g.textBaseline = "alphabetic";
      g.font = "bold 200px 'Segoe UI', system-ui, sans-serif";
      g.textAlign = "left";
      g.fillText(String(n).padStart(2, "0"), 30, 200);
      g.font = "600 52px 'Segoe UI', system-ui, sans-serif";
      g.fillText(`/${String(total).padStart(2, "0")}`, 285, 200);
      // Progress bar: one block per chamber, filled up to this one.
      const bw = (s - 60) / total;
      for (let i = 0; i < total; i++) {
        g.fillStyle = i < n ? "#1d2126" : "#c9ced3";
        g.fillRect(30 + i * bw + 2, 228, bw - 4, 16);
      }
      g.font = "600 30px 'Segoe UI', system-ui, sans-serif";
      g.fillStyle = "#1d2126";
      g.fillText(name.toUpperCase().slice(0, 22), 30, 290);
      g.fillRect(30, 310, s - 60, 4);
      icons.forEach(([kind, on], i) => {
        const x = 30 + (i % 3) * 156;
        const y = 330 + Math.floor(i / 3) * 90;
        g.fillStyle = on ? "#1d2126" : "#d5d9dd";
        g.fillRect(x, y, 140, 80);
        drawIcon(g, kind, x + 70, y + 40, on ? "#f4f5f6" : "#f4f5f6");
      });
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, color: 0xd0d0d0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.04 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat);
    sign.userData.ownMaterial = true;
    const start = data.start.pos;
    const z = THREE.MathUtils.clamp(start[2] + 1.2, r.min.z + 0.8, r.max.z - 0.8);
    const y = THREE.MathUtils.clamp(start[1] + 0.6, r.min.y + 1, r.max.y - 0.9);
    sign.position.set(r.max.x - 0.045, y, z); // just in front of its backing plate
    sign.rotation.y = -Math.PI / 2;
    sign.receiveShadow = true;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.62, 1.62), OBS_FRAME);
    backing.position.set(r.max.x - 0.005, y, z);
    this.group.add(backing, sign);
  }

  build(data, options = {}) {
    this.clear();
    this.data = data;

    // Room: walls, ceiling and (optionally) floor around the room's inside space.
    const r = box3(data.room);
    const t = 1;
    const shell = [
      { min: [r.min.x - t, r.min.y - t, r.min.z - t], max: [r.min.x, r.max.y + t, r.max.z + t] },
      { min: [r.max.x, r.min.y - t, r.min.z - t], max: [r.max.x + t, r.max.y + t, r.max.z + t] },
      { min: [r.min.x, r.min.y - t, r.min.z - t], max: [r.max.x, r.max.y + t, r.min.z] },
      { min: [r.min.x, r.min.y - t, r.max.z], max: [r.max.x, r.max.y + t, r.max.z + t] },
      { min: [r.min.x, r.max.y, r.min.z], max: [r.max.x, r.max.y + t, r.max.z] },
    ];
    if (data.room.floor) shell.push({ min: [r.min.x, r.min.y - t, r.min.z], max: [r.max.x, r.min.y, r.max.z] });
    // Walls slide in from outside, platforms rise from below: the chamber builds itself
    // (only the picture moves; collisions are in place straight away).
    const start = new V3(...data.start.pos);
    const shellFrom = [[-4, 0, 0], [4, 0, 0], [0, 0, -4], [0, 0, 4], [0, 4, 0], null];
    this.assembly = [];
    const all = [...shell.map((b) => ({ ...b, type: data.room.type })), ...data.boxes];
    all.forEach((raw, i) => {
      const s = { ...box3(raw), type: raw.type };
      s.mesh = this._box(s, FACES[s.type]);
      this.solids.push(s);
      if (options.assemble === false) return;
      let from;
      let delay;
      if (i < shell.length) {
        from = shellFrom[i];
        delay = 0.05 * i;
      } else {
        from = [0, -(s.max.y - s.min.y) - 0.5, 0];
        const centre = new V3().addVectors(s.min, s.max).multiplyScalar(0.5);
        delay = 0.35 + Math.min(1.2, centre.distanceTo(start) * 0.05);
      }
      if (from) this.assembly.push({ mesh: s.mesh, home: s.mesh.position.clone(), from: new V3(...from), delay });
    });
    this.assembleTime = 0;
    this._applyAssembly();

    ceilingLights(this.group, r, data.theme === "overgrown" ? { intensity: 45 } : {});
    this._observationWindow(r);
    if (options.chamberNumber) this._chamberSign(r, options.chamberNumber, options.chamberCount, data.name, data);
    if (data.theme === "overgrown") this._overgrowth(r, data);
    this._arrivalTube(start, options.arrivalTube !== false);

    for (const raw of data.goo) {
      const b = box3(raw);
      this.goo.push(b);
      const surf = new THREE.Mesh(new THREE.PlaneGeometry(b.max.x - b.min.x, b.max.z - b.min.z), GOO);
      surf.rotation.x = -Math.PI / 2;
      surf.position.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      this.group.add(surf);
    }

    for (const raw of data.fizzlers) {
      const b = box3(raw);
      this.fizzlers.push(b);
      const size = new V3().subVectors(b.max, b.min);
      const thinX = size.x < size.z; // the field is a flat sheet across its two biggest sides
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(thinX ? size.z : size.x, size.y), FIZZLER);
      if (thinX) plane.rotation.y = Math.PI / 2;
      plane.position.copy(b.min).addScaledVector(size, 0.5);
      this.group.add(plane);
    }

    for (const raw of data.doors) {
      const b = box3(raw);
      const size = new V3().subVectors(b.max, b.min);
      const door = { ...b, type: "metal", door: true, id: raw.id, open: 0, home: b.min.y, height: size.y };
      door.mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), DOOR);
      door.mesh.position.copy(b.min).addScaledVector(size, 0.5);
      door.mesh.castShadow = door.mesh.receiveShadow = true;
      this.group.add(door.mesh);
      this.solids.push(door);
      this.doors.push(door);
    }

    for (const raw of data.buttons) {
      const pos = new V3(...raw.pos);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.12, 32), BUTTON_BASE);
      base.position.copy(pos).add(new V3(0, 0.06, 0));
      const topMat = new THREE.MeshStandardMaterial({ color: 0xd7263d, emissive: 0x400000, roughness: 0.4 });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 32), topMat);
      top.userData.ownMaterial = true;
      top.position.copy(pos).add(new V3(0, 0.16, 0));
      base.receiveShadow = top.receiveShadow = true;
      this.group.add(base, top);
      this.buttons.push({ pos, opens: raw.opens, top, topMat, pressed: false });
    }

    for (const raw of data.cubes) this.addCube(new V3(...raw.pos));

    // Exit lift: a glowing ring on the floor inside a glass tube.
    this.exit = box3(data.exit);
    const e = this.exit;
    const cx = (e.min.x + e.max.x) / 2;
    const cz = (e.min.z + e.max.z) / 2;
    const radius = (Math.min(e.max.x - e.min.x, e.max.z - e.min.z) / 2) * 0.9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ff5ff).multiplyScalar(2.5) }));
    ring.userData.ownMaterial = true;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, e.min.y + 0.05, cz);
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, e.max.y - e.min.y, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x9ff5ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    tube.userData.ownMaterial = true;
    tube.position.set(cx, (e.min.y + e.max.y) / 2, cz);
    const lift = new THREE.PointLight(0x9ff5ff, 6, 6);
    lift.position.set(cx, e.min.y + 1.5, cz);
    this.group.add(ring, tube, lift);
  }

  /** Add a cube that respawns at `spawn`. */
  addCube(spawn) {
    const mesh = makeCubeModel();
    mesh.position.copy(spawn);
    this.group.add(mesh);
    const cube = { spawn: spawn.clone(), center: spawn.clone(), vel: new V3(), mesh, held: false, prev: {} };
    this.cubes.push(cube);
    return cube;
  }

  /** Solid boxes right now (open doors don't count). Add cubes for things that can stand on them. */
  solidsNow(includeCubes = false) {
    const list = this.solids.filter((s) => !(s.door && s.open > 0.8));
    if (includeCubes) {
      for (const c of this.cubes) {
        if (!c.held) list.push({ min: c.center.clone().sub(CUBE_HALF), max: c.center.clone().add(CUBE_HALF), cube: true });
      }
    }
    return list;
  }

  respawnCube(c) {
    c.held = false;
    c.center.copy(c.spawn);
    c.vel.set(0, 0, 0);
    c.prev = {};
  }

  resetMovingParts() {
    for (const d of this.doors) d.open = 0;
    for (const c of this.cubes) this.respawnCube(c);
  }

  /**
   * Step loose cubes (falling, sliding, portals). Calls onLost(cube, reason) for goo/fizzler/fall.
   */
  updateCubes(dt, portals, onLost) {
    const solids = this.solidsNow(false);
    for (const c of this.cubes) {
      if (!c.held) {
        applyGravity(c.vel, dt);
        if (moveBody(c.center, CUBE_HALF, c.vel, dt, solids, portals.holes(c.center))) {
          const f = Math.exp(-dt * 8);
          c.vel.x *= f;
          c.vel.z *= f;
        }
        portals.teleport(c, CUBE_HALF);
        if (this.goo.some((g) => overlaps(c.center, CUBE_HALF, g)) || c.center.y < this.data.room.min[1] - 20) {
          this.respawnCube(c);
          onLost(c, "goo");
        } else if (this.fizzlers.some((f) => overlaps(c.center, CUBE_HALF, f))) {
          this.respawnCube(c);
          onLost(c, "fizzle");
        }
      }
      c.mesh.position.copy(c.center);
    }
  }

  /** Buttons go down under a cube or a body; doors open while any of their buttons is down. */
  updateButtonsAndDoors(dt, bodies) {
    for (const b of this.buttons) {
      const onTop = (center, half) => Math.hypot(center.x - b.pos.x, center.z - b.pos.z) < 0.8
        && center.y - half.y > b.pos.y - 0.15 && center.y - half.y < b.pos.y + 0.45;
      b.pressed = this.cubes.some((c) => !c.held && onTop(c.center, CUBE_HALF))
        || bodies.some((body) => onTop(body.center, body.half));
      b.top.position.y = b.pos.y + (b.pressed ? 0.12 : 0.16);
      b.topMat.color.setHex(b.pressed ? 0x1f9d55 : 0xd7263d);
      b.topMat.emissive.setHex(b.pressed ? 0x0a3a1f : 0x400000);
    }
    for (const d of this.doors) {
      const shouldOpen = this.buttons.some((b) => b.pressed && b.opens.includes(d.id));
      const before = d.open;
      d.open = THREE.MathUtils.clamp(d.open + (shouldOpen ? dt * 2 : -dt * 2), 0, 1);
      // Never close a door on someone standing in it.
      if (d.open < before && d.open <= 0.8 && bodies.some((body) => overlaps(body.center, body.half, d))) d.open = before;
      d.mesh.position.y = d.home + d.height / 2 + d.open * d.height * 0.98;
    }
  }

  update(t) {
    GOO.uniforms.uTime.value = t;
    FIZZLER.uniforms.uTime.value = t;
  }

  // ---------- animation: assembling walls, arrival tube, floating dust ----------

  animate(dt) {
    if (this.assembly && this.assembly.length) {
      this.assembleTime += dt;
      this._applyAssembly();
    }
    const tube = this.tube;
    if (tube && tube.lowering) {
      tube.group.position.y -= dt * 3.2;
      if (tube.group.position.y < tube.floorY - tube.height - 0.2) {
        tube.group.visible = false;
        tube.lowering = false;
      }
    }
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.08 * (0.5 + ((i * 7) % 5) / 5);
        if (y > this.dust.userData.top) y = this.dust.userData.bottom;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(y * 3 + i) * dt * 0.03);
      }
      pos.needsUpdate = true;
    }
  }

  /** True once every wall and platform has slid into place. */
  get assembled() {
    return !this.assembly || this.assembly.every((a) => this.assembleTime >= a.delay + ASSEMBLE_TIME);
  }

  _applyAssembly() {
    for (const a of this.assembly) {
      const k = THREE.MathUtils.clamp((this.assembleTime - a.delay) / ASSEMBLE_TIME, 0, 1);
      const ease = 1 - (1 - k) ** 3;
      a.mesh.position.copy(a.home).addScaledVector(a.from, 1 - ease);
      a.mesh.visible = k > 0;
    }
  }

  /** Lower the glass arrival tube into the floor (call when the player has arrived). */
  openArrivalTube() {
    if (this.tube) this.tube.lowering = true;
  }

  _arrivalTube(start, show) {
    this.tube = null;
    if (!show) return;
    const floorY = start.y - 1.6;
    const height = 3;
    const group = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, height, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.userData.ownMaterial = true;
    glass.position.y = height / 2;
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.4, metalness: 0.7 });
    for (const y of [0.03, height]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.05, 8, 40), ringMat);
      ring.userData.ownMaterial = true;
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      group.add(ring);
    }
    group.add(glass);
    group.position.set(start.x, floorY, start.z);
    this.group.add(group);
    this.tube = { group, floorY, height, lowering: false };
  }

  // ---------- the overgrown theme: an old, broken wing taken over by plants ----------

  _overgrowth(r, data) {
    const rand = seeded(data.id.length * 97 + 13);
    const range = (lo, hi) => lo + rand() * (hi - lo);
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({
      map: LEAF_TEX, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: 0xb9d99a,
    });
    const mossMat = new THREE.MeshStandardMaterial({ map: MOSS_TEX, transparent: true, depthWrite: false, roughness: 1 });
    for (const m of [vineMat, leafMat, mossMat]) m.userData.own = true;

    // Hanging vines, each a wobbly tube from the ceiling, with leaves along it.
    const leafGeo = new THREE.PlaneGeometry(0.28, 0.28);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 420);
    leaves.userData.ownMaterial = true;
    let n = 0;
    const dummy = new THREE.Object3D();
    const addLeaf = (p) => {
      if (n >= leaves.count) return;
      dummy.position.copy(p);
      dummy.rotation.set(range(0, Math.PI), range(0, Math.PI * 2), range(0, Math.PI));
      dummy.scale.setScalar(range(0.6, 1.4));
      dummy.updateMatrix();
      leaves.setMatrixAt(n++, dummy.matrix);
    };
    for (let v = 0; v < 16; v++) {
      const x = range(r.min.x + 0.5, r.max.x - 0.5);
      const z = range(r.min.z + 0.5, r.max.z - 0.5);
      const len = range(1.5, Math.min(5, r.max.y - r.min.y - 2.5));
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        pts.push(new V3(x + Math.sin(k * 1.3 + v) * 0.25, r.max.y - (len * k) / 6, z + Math.cos(k * 1.7 + v) * 0.25));
      }
      const vine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, range(0.025, 0.05), 6), vineMat);
      vine.userData.ownMaterial = true;
      vine.castShadow = true;
      this.group.add(vine);
      for (let k = 0; k < 14; k++) addLeaf(pts[Math.floor(rand() * pts.length)].clone().add(new V3(range(-0.25, 0.25), range(-0.2, 0.2), range(-0.25, 0.25))));
    }
    // Plants creeping up from the corners and along the floor edges.
    for (let k = 0; k < 160; k++) {
      const side = Math.floor(rand() * 4);
      const along = rand();
      const x = side < 2 ? (side === 0 ? r.min.x + 0.2 : r.max.x - 0.2) : THREE.MathUtils.lerp(r.min.x, r.max.x, along);
      const z = side >= 2 ? (side === 2 ? r.min.z + 0.2 : r.max.z - 0.2) : THREE.MathUtils.lerp(r.min.z, r.max.z, along);
      addLeaf(new V3(x, r.min.y + range(0.05, 1.6) * rand(), z));
    }
    leaves.count = n;
    leaves.castShadow = true;
    this.group.add(leaves);

    // Moss patches on the floor.
    for (let k = 0; k < 12; k++) {
      const s = range(1.2, 3.2);
      const moss = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mossMat);
      moss.userData.ownMaterial = true;
      moss.rotation.set(-Math.PI / 2, 0, range(0, Math.PI * 2));
      moss.position.set(range(r.min.x + 1, r.max.x - 1), r.min.y + 0.012 + k * 0.0005, range(r.min.z + 1, r.max.z - 1));
      moss.receiveShadow = true;
      this.group.add(moss);
    }

    // Fallen wall panels leaning on the walls (just scenery, you can walk through them).
    for (let k = 0; k < 5; k++) {
      const panel = new THREE.Mesh(tiledBox(new V3(1.8, 1.8, 0.08)), FACES.white);
      const left = rand() < 0.5;
      panel.position.set(left ? r.min.x + 0.45 : r.max.x - 0.45, r.min.y + 0.8, range(r.min.z + 2, r.max.z - 2));
      panel.rotation.set(range(-0.15, 0.15), Math.PI / 2, (left ? 1 : -1) * range(0.25, 0.5));
      panel.castShadow = panel.receiveShadow = true;
      this.group.add(panel);
    }

    // A hole in the ceiling: warm sunlight pours in, with a visible beam and floating dust.
    const hx = THREE.MathUtils.lerp(r.min.x, r.max.x, 0.6);
    const hz = THREE.MathUtils.lerp(r.min.z, r.max.z, 0.55);
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1d0).multiplyScalar(3) }),
    );
    sky.userData.ownMaterial = true;
    sky.rotation.x = Math.PI / 2;
    sky.position.set(hx, r.max.y - 0.01, hz);
    const sun = new THREE.SpotLight(0xffe2b0, 160, 0, 0.42, 0.5, 2);
    sun.position.set(hx, r.max.y + 0.5, hz);
    sun.target.position.set(hx - 1, r.min.y, hz + 1);
    sun.castShadow = true;
    sun.shadow.camera.layers.enable(1);
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0004;
    const beamH = r.max.y - r.min.y;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 2.2, beamH, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe9c0, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.userData.ownMaterial = true;
    beam.position.set(hx - 0.5, r.min.y + beamH / 2, hz + 0.5);
    beam.rotation.set(0.08, 0, 0.08);
    this.group.add(sky, sun, sun.target, beam);

    const count = 260;
    const dust = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      dust[i * 3] = hx + range(-1.8, 1.8);
      dust[i * 3 + 1] = range(r.min.y, r.max.y);
      dust[i * 3 + 2] = hz + range(-1.8, 1.8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0xfff0d0).multiplyScalar(1.5), size: 0.03, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    this.dust.userData = { ownMaterial: true, top: r.max.y, bottom: r.min.y };
    this.group.add(this.dust);
  }
}
