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
const CUBE = new THREE.MeshStandardMaterial({ ...TEXTURES.cube, roughness: 0.6, metalness: 0.3 });
// Which material each face group uses (sides, top, bottom). Metal boxes get floor tiles on top.
const FACES = {
  white: [MATS.white, MATS.white, MATS.white],
  metal: [MATS.metal, MATS.floor, MATS.metal],
  glass: [MATS.glass, MATS.glass, MATS.glass],
};
const BUTTON_BASE = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 });
const OBS_INSIDE = new THREE.MeshBasicMaterial({ color: 0x0b0d10 });
const OBS_GLASS = new THREE.MeshStandardMaterial({
  color: 0x8fb8d8, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.9, depthWrite: false,
});
const OBS_FRAME = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });

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
  _chamberSign(r, n, total, name) {
    const tex = canvasTexture(512, (g, s) => {
      g.fillStyle = "#f3f5f7";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#1d2126";
      g.font = "bold 230px 'Segoe UI', system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(n).padStart(2, "0"), s / 2, 170);
      g.fillRect(40, 300, s - 80, 8);
      g.font = "600 44px 'Segoe UI', system-ui, sans-serif";
      g.fillText(`${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, s / 2, 360);
      g.font = "600 40px 'Segoe UI', system-ui, sans-serif";
      g.fillText(name.toUpperCase().slice(0, 18), s / 2, 440);
    });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat);
    sign.userData.ownMaterial = true;
    sign.position.set((r.min.x + r.max.x) / 2 + 2.5, Math.min(2.6, r.max.y - 1), r.max.z - 0.03);
    sign.rotation.y = Math.PI;
    sign.receiveShadow = true;
    this.group.add(sign);
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
    for (const raw of [...shell.map((b) => ({ ...b, type: data.room.type })), ...data.boxes]) {
      const s = { ...box3(raw), type: raw.type };
      s.mesh = this._box(s, FACES[s.type]);
      this.solids.push(s);
    }

    ceilingLights(this.group, r);
    this._observationWindow(r);
    if (options.chamberNumber) this._chamberSign(r, options.chamberNumber, options.chamberCount, data.name);

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

    for (const raw of data.cubes) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), CUBE);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const spawn = new V3(...raw.pos);
      this.cubes.push({ spawn, center: spawn.clone(), vel: new V3(), mesh, held: false, prev: {} });
      mesh.position.copy(spawn);
    }

    // Exit lift: a glowing ring on the floor inside a glass tube.
    this.exit = box3(data.exit);
    const e = this.exit;
    const cx = (e.min.x + e.max.x) / 2;
    const cz = (e.min.z + e.max.z) / 2;
    const radius = (Math.min(e.max.x - e.min.x, e.max.z - e.min.z) / 2) * 0.9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: 0x9ff5ff }));
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
}
