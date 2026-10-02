// Portal Fan Lab: an unofficial Portal fan game.
// Test chambers come from the API (/api/levels). The API also keeps the run clock and the leaderboard.
import * as THREE from "./vendor/three-0.170.0.module.min.js";

const V3 = THREE.Vector3;
const BLUE = 0x2f9bff;
const ORANGE = 0xff8a1f;
const PORTAL_W = 1.2;
const PORTAL_H = 2.0;
const EYE_HEIGHT = 1.6;
const EYE_TO_CENTER = 0.7; // body centre is 0.7 below the eyes
const PLAYER_HALF = new V3(0.3, 0.9, 0.3);
const CUBE_HALF = new V3(0.3, 0.3, 0.3);
const GRAVITY = 15;
const JUMP_SPEED = 5.5;
const WALK_SPEED = 4.5;
const MAX_FALL = 30;
const LOOK_SPEED = 0.0022;
const HOLD_DISTANCE = 1.6;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouchOnly = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;

const $ = (id) => document.getElementById(id);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- GLaDOS (all lines written for this fan game; text only) ----------

const LINES = {
  done: [
    "Chamber complete. I am adding a gold star to your file. It is the only star. The file is otherwise empty.",
    "Well done. Jim did a spin. I have asked him not to do that indoors.",
    "Correct use of portals detected. This will be noted. Somewhere. Probably.",
  ],
  goo: [
    "You fell in the goo. The goo is not a swimming pool. Restarting the chamber.",
    "That was the goo. Please avoid the goo. I will reset everything, again.",
  ],
  fall: ["You fell out of the test. Interesting. Let's pretend that didn't happen."],
  restart: ["Restarting the chamber. Jim and I will look away."],
  badSurface: [
    "Portals only stick to white surfaces. That is not a white surface.",
    "No. Dark metal does not hold portals. Look for white panels.",
  ],
  noFit: ["There is not enough room there for a portal."],
  orangeLocked: ["Your gun only fires blue portals in this chamber. The orange one is already placed."],
  fizzle: ["The fizzler erased your portals. That is its job. It loves its job."],
  cubeFizzle: [
    "The cube was fizzled. Don't worry, it felt nothing. A new one is on the way.",
  ],
  cubeGoo: ["The cube fell in the goo. I'll make you a new one. Try to keep this one dry."],
  end: [
    "All test chambers complete. You have been a wonderful test subject. Jim agrees. He did not say so, but he agrees.",
  ],
};

let subtitleTimer;
let lastLine = "";
function say(text) {
  if (!text) return;
  lastLine = text;
  $("subtitle-text").textContent = text;
  $("subtitle").hidden = false;
  clearTimeout(subtitleTimer);
  subtitleTimer = setTimeout(() => { $("subtitle").hidden = true; }, 3500 + text.length * 45);
}
let lastSayAt = 0;
function sayOnce(list) {
  const now = performance.now();
  if (now - lastSayAt < 2500) return;
  lastSayAt = now;
  say(pick(list));
}

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    let detail = body && body.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join(", ");
    throw new Error(detail || `Something went wrong (${res.status})`);
  }
  return body;
}

// ---------- textures drawn in code ----------

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const TEX = {
  white: canvasTexture(256, (g, s) => {
    g.fillStyle = "#b9c0c6";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const shade = 236 + ((i + j) % 2) * 6;
        g.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 4})`;
        g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
      }
    }
  }),
  metal: canvasTexture(256, (g, s) => {
    g.fillStyle = "#2f3438";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#3d4348";
    g.fillRect(6, 6, s - 12, s - 12);
    g.strokeStyle = "#262a2e";
    g.lineWidth = 3;
    g.strokeRect(20, 20, s - 40, s - 40);
    g.fillStyle = "#555c63";
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) {
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
  }),
  cube: canvasTexture(256, (g, s) => {
    g.fillStyle = "#8d959c";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#d9dde1";
    g.fillRect(36, 36, s - 72, s - 72);
    g.fillStyle = "#2f9bff";
    for (const [x, y] of [[0, 0], [s - 36, 0], [0, s - 36], [s - 36, s - 36]]) g.fillRect(x, y, 36, 36);
    g.strokeStyle = "#6e767d";
    g.lineWidth = 10;
    g.beginPath(); g.arc(s / 2, s / 2, 44, 0, Math.PI * 2); g.stroke();
  }),
  door: canvasTexture(256, (g, s) => {
    g.fillStyle = "#e4e7ea";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#1d2126";
    g.fillRect(0, s * 0.45, s, s * 0.1);
    g.fillStyle = "#ff8a1f";
    g.fillRect(s * 0.46, 0, s * 0.08, s);
  }),
};

// BoxGeometry whose texture repeats every 2 m instead of stretching.
function tiledBox(size, tile = 2) {
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const uv = geo.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const dims = [[size.z, size.y], [size.z, size.y], [size.x, size.z], [size.x, size.z], [size.x, size.y], [size.x, size.y]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return geo;
}

// ---------- renderer, camera, lights ----------

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2126);
scene.add(new THREE.HemisphereLight(0xffffff, 0x50575e, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(4, 12, 6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, 1, 0.03, 200);
camera.rotation.order = "YXZ";
scene.add(camera);

// ---------- portals (you can see through them) ----------

const portalVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const portalFragment = `
  uniform sampler2D tView;
  uniform vec2 uRes;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLive;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;
    float rim = smoothstep(0.82, 0.97, r);
    vec3 inside;
    if (uLive > 0.5) {
      inside = texture2D(tView, gl_FragCoord.xy / uRes).rgb;
    } else {
      float a = atan(p.y, p.x);
      float swirl = sin(a * 3.0 + r * 9.0 - uTime * 4.0) * 0.5 + 0.5;
      inside = mix(uColor * 0.2, uColor * 0.9, swirl * (1.0 - r * 0.4));
    }
    vec3 col = mix(inside, uColor * 1.4 + 0.2, rim);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const portalGeo = new THREE.PlaneGeometry(PORTAL_W, PORTAL_H);

function makePortal(name, color) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tView: { value: rt.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uLive: { value: 0 },
    },
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
  });
  const mesh = new THREE.Mesh(portalGeo, mat);
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  const light = new THREE.PointLight(color, 4, 3.5);
  light.position.z = 0.5;
  mesh.add(light);
  scene.add(mesh);
  return {
    name, color, rt, mat, mesh,
    placed: false, fixed: false,
    pos: new V3(), normal: new V3(), up: new V3(), right: new V3(),
    matrix: new THREE.Matrix4(), inv: new THREE.Matrix4(),
    hosts: [], // boxes the portal "cuts a hole" in
  };
}
const portals = { blue: makePortal("blue", BLUE), orange: makePortal("orange", ORANGE) };
const other = (p) => (p === portals.blue ? portals.orange : portals.blue);
const linked = () => portals.blue.placed && portals.orange.placed;

const ROT_Y_PI = new THREE.Matrix4().makeRotationY(Math.PI);
function throughMatrix(from, to) {
  return new THREE.Matrix4().multiplyMatrices(to.matrix, ROT_Y_PI).multiply(from.inv);
}

function placePortal(p, pos, normal, up, fixed = false) {
  p.pos.copy(pos);
  p.normal.copy(normal);
  p.up.copy(up);
  p.right.crossVectors(up, normal);
  p.matrix.makeBasis(p.right, p.up, p.normal).setPosition(pos);
  p.inv.copy(p.matrix).invert();
  p.mesh.matrix.copy(p.matrix).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.012));
  p.mesh.matrixWorldNeedsUpdate = true;
  p.mesh.visible = true;
  p.placed = true;
  p.fixed = fixed;
  // Every solid box just behind the portal gets a hole while you pass through.
  const a = pos.clone().addScaledVector(normal, -0.05);
  const b = pos.clone().addScaledVector(normal, -0.6);
  p.hosts = level.solids.filter((s) => insideBox(a, s, 0.02) || insideBox(b, s, 0.02));
  updateCrosshair();
}

function clearPortal(p) {
  p.placed = false;
  p.mesh.visible = false;
  p.hosts = [];
  updateCrosshair();
}

function clearPlayerPortals() {
  let any = false;
  for (const p of Object.values(portals)) {
    if (p.placed && !p.fixed) {
      clearPortal(p);
      any = true;
    }
  }
  return any;
}

// Clip everything behind the exit portal's wall (an "oblique near plane").
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
function obliqueClip(cam, normal, point) {
  _plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(cam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = cam.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
  _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
  _q.z = -1.0;
  _q.w = (1.0 + e[10]) / e[14];
  _clip.multiplyScalar(2.0 / _clip.dot(_q));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = _clip.z + 1.0;
  e[14] = _clip.w;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

const virtualCam = new THREE.PerspectiveCamera();
virtualCam.matrixAutoUpdate = false;
virtualCam.matrixWorldAutoUpdate = false;
const frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

function renderPortalViews() {
  for (const p of Object.values(portals)) p.mat.uniforms.uLive.value = 0;
  if (!linked()) return;
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_pv);
  for (const p of Object.values(portals)) {
    p.mesh.updateMatrixWorld();
    if (!frustum.intersectsObject(p.mesh)) continue;
    // Looking into p shows the view out of the other portal.
    const q = other(p);
    virtualCam.matrixWorld.multiplyMatrices(throughMatrix(p, q), camera.matrixWorld);
    virtualCam.matrixWorldInverse.copy(virtualCam.matrixWorld).invert();
    virtualCam.projectionMatrix.copy(camera.projectionMatrix);
    obliqueClip(virtualCam, q.normal, q.pos);
    renderer.setRenderTarget(p.rt);
    renderer.render(scene, virtualCam);
  }
  renderer.setRenderTarget(null);
  for (const p of Object.values(portals)) p.mat.uniforms.uLive.value = 1;
}

// ---------- the portal gun ----------

const gun = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 6, 16), white);
  body.rotation.x = Math.PI / 2;
  gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.13, 16), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.21;
  gun.add(barrel);
  for (const side of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.15), dark);
    claw.position.set(side * 0.055, 0.03, -0.25);
    claw.rotation.y = side * 0.25;
    gun.add(claw);
  }
}
const gunGlowMat = new THREE.MeshBasicMaterial({ color: BLUE });
const gunGlow = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), gunGlowMat);
gunGlow.position.z = -0.28;
gun.add(gunGlow);
gun.position.set(0.26, -0.24, -0.45);
camera.add(gun);
let recoil = 0;

const beamMat = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.9, depthWrite: false });
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), beamMat);
beam.visible = false;
scene.add(beam);
let beamLife = 0;

function fireBeam(to, color) {
  recoil = 1;
  gunGlowMat.color.setHex(color);
  beamMat.color.setHex(color);
  const from = gunGlow.getWorldPosition(new V3());
  const dir = new V3().subVectors(to, from);
  beam.position.copy(from).addScaledVector(dir, 0.5);
  beam.scale.set(1, Math.max(0.01, dir.length()), 1);
  beam.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
  beam.visible = true;
  beamLife = 0.12;
}

// ---------- Jim, the little core who never talks ----------

const jim = new THREE.Group();
const jimEyeMat = new THREE.MeshBasicMaterial({ color: 0xffc640 });
{
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.35, metalness: 0.6 }),
  );
  jim.add(shell);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.205, 0.022, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.5, metalness: 0.5 }),
  );
  jim.add(band);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), jimEyeMat);
  eye.position.z = 0.196;
  jim.add(eye);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), new THREE.MeshBasicMaterial({ color: 0x1d2126 }));
  pupil.position.z = 0.199;
  jim.add(pupil);
  const glow = new THREE.PointLight(0xffc640, 1.2, 2);
  glow.position.z = 0.35;
  jim.add(glow);
}
scene.add(jim);
const jimMood = { kind: "idle", time: 0 };
function jimReact(kind, seconds = 1.4) {
  jimMood.kind = kind;
  jimMood.time = seconds;
}

// ---------- level building ----------

const level = {
  data: null,
  group: new THREE.Group(),
  solids: [],   // {min, max, type, door?}
  goo: [],
  fizzlers: [],
  doors: [],
  buttons: [],
  cubes: [],
  exit: null,
  shaders: [],  // materials with a uTime uniform
};
scene.add(level.group);

function box3(b) {
  return { min: new V3(...b.min), max: new V3(...b.max) };
}

function insideBox(p, b, pad = 0) {
  return p.x >= b.min.x - pad && p.x <= b.max.x + pad
    && p.y >= b.min.y - pad && p.y <= b.max.y + pad
    && p.z >= b.min.z - pad && p.z <= b.max.z + pad;
}

function overlaps(center, half, b) {
  return center.x + half.x > b.min.x && center.x - half.x < b.max.x
    && center.y + half.y > b.min.y && center.y - half.y < b.max.y
    && center.z + half.z > b.min.z && center.z - half.z < b.max.z;
}

const MATS = {
  white: new THREE.MeshStandardMaterial({ map: TEX.white, roughness: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ map: TEX.metal, roughness: 0.6, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0xbfe6ff, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false,
  }),
};

function addBoxMesh(b, material) {
  const size = new V3().subVectors(b.max, b.min);
  const mesh = new THREE.Mesh(tiledBox(size), material);
  mesh.position.copy(b.min).addScaledVector(size, 0.5);
  level.group.add(mesh);
  return mesh;
}

const gooMatTemplate = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: portalVertex,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 18.0;
      float w = sin(p.x + uTime * 1.3) * cos(p.y * 1.3 - uTime) * 0.5 + 0.5;
      vec3 col = mix(vec3(0.16, 0.13, 0.05), vec3(0.42, 0.36, 0.1), w);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }
  `,
});

const fizzMatTemplate = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: portalVertex,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      float s = sin(vUv.x * 60.0 + uTime * 6.0) * sin(vUv.y * 40.0 - uTime * 4.0);
      float a = 0.18 + 0.12 * s;
      gl_FragColor = vec4(vec3(0.55, 0.8, 1.0), a);
      #include <colorspace_fragment>
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function clearLevel() {
  level.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && level.shaders.includes(o.material)) o.material.dispose();
  });
  level.group.clear();
  Object.assign(level, { solids: [], goo: [], fizzlers: [], doors: [], buttons: [], cubes: [], exit: null, shaders: [] });
  clearPortal(portals.blue);
  clearPortal(portals.orange);
}

function buildLevel(data) {
  clearLevel();
  level.data = data;

  // Room: walls, ceiling and (optionally) floor around the room's inside space.
  const r = box3(data.room);
  const t = 1;
  const roomBoxes = [
    { min: [r.min.x - t, r.min.y - t, r.min.z - t], max: [r.min.x, r.max.y + t, r.max.z + t] },
    { min: [r.max.x, r.min.y - t, r.min.z - t], max: [r.max.x + t, r.max.y + t, r.max.z + t] },
    { min: [r.min.x, r.min.y - t, r.min.z - t], max: [r.max.x, r.max.y + t, r.min.z] },
    { min: [r.min.x, r.min.y - t, r.max.z], max: [r.max.x, r.max.y + t, r.max.z + t] },
    { min: [r.min.x, r.max.y, r.min.z], max: [r.max.x, r.max.y + t, r.max.z] },
  ];
  if (data.room.floor) roomBoxes.push({ min: [r.min.x, r.min.y - t, r.min.z], max: [r.max.x, r.min.y, r.max.z] });
  for (const b of [...roomBoxes.map((b) => ({ ...b, type: data.room.type })), ...data.boxes]) {
    const s = { ...box3(b), type: b.type };
    s.mesh = addBoxMesh(s, MATS[s.type]);
    level.solids.push(s);
  }

  // Ceiling light strips.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let x = r.min.x + 3; x < r.max.x - 1; x += 4) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, (r.max.z - r.min.z) * 0.8), lightMat);
    strip.position.set(x, r.max.y - 0.03, (r.min.z + r.max.z) / 2);
    level.group.add(strip);
  }

  for (const g of data.goo) {
    const b = box3(g);
    level.goo.push(b);
    const mat = gooMatTemplate.clone();
    level.shaders.push(mat);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(b.max.x - b.min.x, b.max.z - b.min.z), mat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
    level.group.add(surf);
  }

  for (const f of data.fizzlers) {
    const b = box3(f);
    level.fizzlers.push(b);
    const mat = fizzMatTemplate.clone();
    level.shaders.push(mat);
    const size = new V3().subVectors(b.max, b.min);
    // The field is a flat sheet across its two biggest sides.
    const thin = size.x < size.z ? "x" : "z";
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(thin === "x" ? size.z : size.x, size.y), mat,
    );
    if (thin === "x") plane.rotation.y = Math.PI / 2;
    plane.position.copy(b.min).addScaledVector(size, 0.5);
    level.group.add(plane);
  }

  const doorMat = new THREE.MeshStandardMaterial({ map: TEX.door, roughness: 0.5 });
  level.shaders.push(doorMat);
  for (const d of data.doors) {
    const b = box3(d);
    const solid = { ...b, type: "metal", door: true, open: 0, id: d.id, home: b.min.y, height: b.max.y - b.min.y };
    const size = new V3().subVectors(b.max, b.min);
    solid.mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), doorMat);
    solid.mesh.position.copy(b.min).addScaledVector(size, 0.5);
    level.group.add(solid.mesh);
    level.solids.push(solid);
    level.doors.push(solid);
  }

  for (const btn of data.buttons) {
    const pos = new V3(...btn.pos);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.85, 0.12, 32),
      new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6 }),
    );
    base.position.copy(pos).add(new V3(0, 0.06, 0));
    const topMat = new THREE.MeshStandardMaterial({ color: 0xd7263d, emissive: 0x400000, roughness: 0.4 });
    level.shaders.push(topMat);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 32), topMat);
    top.position.copy(pos).add(new V3(0, 0.16, 0));
    level.group.add(base, top);
    level.buttons.push({ pos, opens: btn.opens, top, topMat, pressed: false });
  }

  const cubeMat = new THREE.MeshStandardMaterial({ map: TEX.cube, roughness: 0.5 });
  level.shaders.push(cubeMat);
  for (const c of data.cubes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), cubeMat);
    level.group.add(mesh);
    const cube = { spawn: new V3(...c.pos), pos: new V3(...c.pos), vel: new V3(), mesh, held: false, prev: {} };
    mesh.position.copy(cube.pos);
    level.cubes.push(cube);
  }

  // Exit lift: a glowing ring on the floor with a glass tube.
  level.exit = box3(data.exit);
  const e = level.exit;
  const cx = (e.min.x + e.max.x) / 2;
  const cz = (e.min.z + e.max.z) / 2;
  const radius = Math.min(e.max.x - e.min.x, e.max.z - e.min.z) / 2 * 0.9;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.06, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x9ff5ff }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(cx, e.min.y + 0.05, cz);
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0x9ff5ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  level.shaders.push(tubeMat);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, e.max.y - e.min.y, 32, 1, true), tubeMat);
  tube.position.set(cx, (e.min.y + e.max.y) / 2, cz);
  const lift = new THREE.PointLight(0x9ff5ff, 6, 6);
  lift.position.set(cx, e.min.y + 1.5, cz);
  level.group.add(ring, tube, lift);

  for (const f of data.fixed_portals) {
    const p = portals[f.color];
    const normal = new V3(...f.normal);
    const up = Math.abs(normal.y) > 0.5 ? new V3(0, 0, -1) : new V3(0, 1, 0);
    placePortal(p, new V3(...f.pos), normal, up, true);
  }
  $("orange-help").hidden = data.gun !== "both";
  resetPlayer();
}

function resetLevelState() {
  clearPlayerPortals();
  for (const d of level.doors) d.open = 0;
  for (const c of level.cubes) respawnCube(c);
  resetPlayer();
}

// ---------- player ----------

const player = {
  center: new V3(),
  vel: new V3(),
  yaw: 0,
  pitch: 0,
  onGround: false,
  held: null,
  prev: {},     // last side of each portal plane we were on
};

function resetPlayer() {
  const s = level.data.start;
  player.center.set(s.pos[0], s.pos[1] - EYE_TO_CENTER, s.pos[2]);
  player.vel.set(0, 0, 0);
  player.yaw = THREE.MathUtils.degToRad(s.yaw);
  player.pitch = 0;
  player.held = null;
  player.prev = {};
  for (const c of level.cubes) c.held = false;
}

function eyePos(out = new V3()) {
  return out.copy(player.center).setY(player.center.y + EYE_TO_CENTER);
}

function lookDir(out = new V3()) {
  return out.set(
    -Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.yaw) * Math.cos(player.pitch),
  );
}

// ---------- input ----------

const held = new Set();
const KEYMAP = {
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};
let locked = false;

window.addEventListener("keydown", (e) => {
  if (state.mode !== "playing") return;
  if (e.target instanceof Element && e.target.closest("input, textarea")) return;
  if (KEYMAP[e.code]) { held.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === "Space") { held.add("jump"); e.preventDefault(); }
  if (e.code === "KeyE" && !e.repeat) toggleHold();
  if (e.code === "KeyR" && !e.repeat) { say(pick(LINES.restart)); resetLevelState(); }
  if (e.code === "KeyH" && !e.repeat) say(level.data.hint || "No hints here. You've got this.");
});
window.addEventListener("keyup", (e) => {
  if (KEYMAP[e.code]) held.delete(KEYMAP[e.code]);
  if (e.code === "Space") held.delete("jump");
});
window.addEventListener("blur", () => held.clear());

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  if (state.mode !== "playing") return;
  if (!locked) {
    canvas.requestPointerLock();
    return;
  }
  if (e.button === 0) shoot("blue");
  if (e.button === 2) shoot("orange");
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  if (state.mode === "playing") $("pause").hidden = locked;
  if (!locked) held.clear();
});
document.addEventListener("mousemove", (e) => {
  if (!locked || state.mode !== "playing") return;
  player.yaw -= e.movementX * LOOK_SPEED;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * LOOK_SPEED, -1.5, 1.5);
});
$("resume-btn").addEventListener("click", () => canvas.requestPointerLock());

// ---------- shooting ----------

// Ray vs box ("slab" method). Returns {t, normal} for the nearest face hit, or null.
function rayBox(origin, dir, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [b.min.x, b.min.y, b.min.z];
  const hi = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - o[i]) / d[i];
    let t2 = (hi[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) { tmin = t1; axis = i; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || axis < 0) return null;
  const normal = new V3();
  normal.setComponent(axis, d[axis] > 0 ? -1 : 1);
  return { t: tmin, normal, axis };
}

function castRay(origin, dir, maxDist = 100) {
  let best = null;
  for (const s of level.solids) {
    if (s.door && s.open > 0.8) continue;
    const hit = rayBox(origin, dir, s);
    if (hit && hit.t < maxDist && (!best || hit.t < best.t)) best = { ...hit, solid: s };
  }
  return best;
}

const AXES = ["x", "y", "z"];

function shoot(color) {
  if (color === "orange" && level.data.gun !== "both") {
    sayOnce(LINES.orangeLocked);
    return;
  }
  const p = portals[color];
  const origin = eyePos();
  const dir = lookDir();
  const hit = castRay(origin, dir);
  const end = hit ? origin.clone().addScaledVector(dir, hit.t) : origin.clone().addScaledVector(dir, 30);
  fireBeam(end, p.color);
  if (!hit) return;
  const s = hit.solid;
  if (s.type !== "white" || s.door) {
    sayOnce(LINES.badSurface);
    return;
  }

  const normal = hit.normal;
  const a = AXES[hit.axis];
  let up;
  if (a === "y") {
    // Floor/ceiling portal: line it up with the way you are facing (snapped to the grid).
    const f = lookDir().setY(0);
    up = Math.abs(f.x) > Math.abs(f.z) ? new V3(Math.sign(f.x), 0, 0) : new V3(0, 0, Math.sign(f.z) || -1);
    if (normal.y < 0) up.negate();
  } else {
    up = new V3(0, 1, 0);
  }
  const right = new V3().crossVectors(up, normal);

  // Slide the portal so it fits completely on the face.
  const pos = end.clone();
  pos[a] = normal[a] > 0 ? s.max[a] : s.min[a];
  for (const [vec, half] of [[right, PORTAL_W / 2], [up, PORTAL_H / 2]]) {
    const ax = AXES[[Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z)].indexOf(1)];
    const lo = s.min[ax] + half;
    const hi = s.max[ax] - half;
    if (lo > hi + 1e-6) {
      sayOnce(LINES.noFit);
      return;
    }
    pos[ax] = THREE.MathUtils.clamp(pos[ax], lo, hi);
  }

  // Don't overlap the other portal on the same wall.
  const o = other(p);
  if (o.placed && o.normal.equals(normal)) {
    const d = new V3().subVectors(pos, o.pos);
    if (Math.abs(d.dot(right)) < PORTAL_W && Math.abs(d.dot(up)) < PORTAL_H) {
      if (o.fixed) {
        sayOnce(LINES.noFit);
        return;
      }
      clearPortal(o);
    }
  }
  placePortal(p, pos, normal, up);
}

function updateCrosshair() {
  document.querySelector("#crosshair .l").classList.toggle("on", portals.blue.placed);
  const r = document.querySelector("#crosshair .r");
  r.classList.toggle("on", portals.orange.placed);
  r.classList.toggle("off", !!level.data && level.data.gun !== "both" && !portals.orange.placed);
}

// ---------- cubes ----------

function respawnCube(c) {
  if (player.held === c) player.held = null;
  c.held = false;
  c.pos.copy(c.spawn);
  c.vel.set(0, 0, 0);
  c.prev = {};
}

function toggleHold() {
  if (player.held) {
    const c = player.held;
    c.held = false;
    player.held = null;
    // If the cube ended up inside a wall, drop it at your feet instead.
    if (level.solids.some((s) => !(s.door && s.open > 0.8) && overlaps(c.pos, CUBE_HALF, s))) {
      c.pos.copy(player.center);
      c.vel.set(0, 0, 0);
    }
    return;
  }
  const eye = eyePos();
  const dir = lookDir();
  let best = null;
  for (const c of level.cubes) {
    const to = new V3().subVectors(c.pos, eye);
    const along = to.dot(dir);
    if (along < 0 || along > 2.8) continue;
    const off = to.clone().addScaledVector(dir, -along).length();
    if (off < 0.55 && (!best || along < best.along)) best = { c, along };
  }
  if (best) {
    player.held = best.c;
    best.c.held = true;
  }
}

// ---------- physics ----------

function solidsFor(isPlayer) {
  const list = [];
  for (const s of level.solids) if (!(s.door && s.open > 0.8)) list.push(s);
  if (isPlayer) {
    for (const c of level.cubes) {
      if (!c.held) list.push({ min: c.pos.clone().sub(CUBE_HALF), max: c.pos.clone().add(CUBE_HALF), cube: true });
    }
  }
  return list;
}

// Boxes to ignore because you're stepping through a portal in them.
function portalHoles(center, half) {
  const ignore = new Set();
  if (!linked()) return ignore;
  for (const p of Object.values(portals)) {
    const local = center.clone().applyMatrix4(p.inv);
    const floorish = Math.abs(p.normal.y) > 0.5;
    const ry = floorish ? PORTAL_H / 2 - 0.15 : PORTAL_H / 2 - 0.65;
    if (Math.abs(local.x) < PORTAL_W / 2 - 0.15 && Math.abs(local.y) < ry && local.z < 1.2 && local.z > -1.5) {
      for (const s of p.hosts) ignore.add(s);
    }
  }
  return ignore;
}

// Move a box-shaped body, sliding along walls. Returns true when it lands on something.
function moveBody(center, half, vel, dt, isPlayer) {
  const solids = solidsFor(isPlayer);
  const ignore = portalHoles(center, half);
  const dist = vel.length() * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.12));
  const h = dt / steps;
  let grounded = false;
  for (let i = 0; i < steps; i++) {
    for (const ax of AXES) {
      const v = vel[ax];
      if (v === 0) continue;
      center[ax] += v * h;
      for (const s of solids) {
        if (ignore.has(s) || !overlaps(center, half, s)) continue;
        if (v > 0) center[ax] = s.min[ax] - half[ax] - 1e-4;
        else {
          center[ax] = s.max[ax] + half[ax] + 1e-4;
          if (ax === "y") grounded = true;
        }
        vel[ax] = 0;
      }
    }
  }
  return grounded;
}

// Did this body cross a portal this frame? If so, send it out the other side.
function checkTeleport(body, half, isPlayer) {
  if (!linked()) return false;
  for (const p of Object.values(portals)) {
    const local = body.center.clone().applyMatrix4(p.inv);
    const before = body.prev[p.name];
    body.prev[p.name] = local.z;
    const inRect = Math.abs(local.x) < PORTAL_W / 2 && Math.abs(local.y) < PORTAL_H / 2;
    if (before === undefined || !(before > 0 && local.z <= 0 && inRect)) continue;

    const q = other(p);
    const m = throughMatrix(p, q);
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    body.center.applyMatrix4(m);
    body.vel.applyMatrix3(rot);
    // Pop fully out of the exit portal so we don't get stuck in its wall.
    const need = Math.abs(q.normal.x) * half.x + Math.abs(q.normal.y) * half.y + Math.abs(q.normal.z) * half.z + 0.05;
    const out = new V3().subVectors(body.center, q.pos).dot(q.normal);
    if (out < need) body.center.addScaledVector(q.normal, need - out);
    const speedOut = body.vel.dot(q.normal);
    if (speedOut < 2) body.vel.addScaledVector(q.normal, 2 - speedOut);
    if (isPlayer) {
      const look = lookDir().applyMatrix3(rot);
      player.yaw = Math.atan2(-look.x, -look.z);
      player.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)), -1.2, 1.2);
    }
    body.prev = {};
    for (const pp of Object.values(portals)) body.prev[pp.name] = body.center.clone().applyMatrix4(pp.inv).z;
    return true;
  }
  return false;
}

const _wish = new V3();

function updatePlayer(dt) {
  const forward = new V3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new V3(-forward.z, 0, forward.x);
  _wish.set(0, 0, 0);
  if (held.has("forward")) _wish.add(forward);
  if (held.has("back")) _wish.sub(forward);
  if (held.has("right")) _wish.add(right);
  if (held.has("left")) _wish.sub(right);
  if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(WALK_SPEED);

  // Full control on the ground; a little steering in the air (so flings keep their speed).
  const vx = player.vel.x;
  const vz = player.vel.z;
  if (player.onGround) {
    const k = Math.min(1, dt * 14);
    player.vel.x += (_wish.x - vx) * k;
    player.vel.z += (_wish.z - vz) * k;
    if (held.has("jump")) player.vel.y = JUMP_SPEED;
  } else if (_wish.lengthSq() > 0) {
    const k = Math.min(1, dt * 2);
    const horiz = Math.hypot(vx, vz);
    player.vel.x += (_wish.x - vx) * k;
    player.vel.z += (_wish.z - vz) * k;
    // Steering never adds speed beyond what you already had (or walking speed).
    const limit = Math.max(horiz, WALK_SPEED);
    const now = Math.hypot(player.vel.x, player.vel.z);
    if (now > limit) {
      player.vel.x *= limit / now;
      player.vel.z *= limit / now;
    }
  }
  player.vel.y = Math.max(player.vel.y - GRAVITY * dt, -MAX_FALL);

  player.onGround = moveBody(player.center, PLAYER_HALF, player.vel, dt, true);
  checkTeleport(player, PLAYER_HALF, true);

  // Hazards and goals.
  const c = player.center;
  if (level.goo.some((g) => insideBox(c, g))) return die(LINES.goo);
  if (c.y < level.data.room.min[1] - 20) return die(LINES.fall);
  if (level.fizzlers.some((f) => overlaps(c, PLAYER_HALF, f))) {
    if (clearPlayerPortals()) sayOnce(LINES.fizzle);
    if (player.held) {
      respawnCube(player.held);
      sayOnce(LINES.cubeFizzle);
    }
  }
  if (insideBox(c, level.exit)) chamberComplete();
}

function updateCubes(dt) {
  const eye = eyePos();
  const dir = lookDir();
  for (const c of level.cubes) {
    if (c.held) {
      const target = eye.clone().addScaledVector(dir, HOLD_DISTANCE);
      c.vel.subVectors(target, c.pos).multiplyScalar(1 / Math.max(dt, 1e-3)).clampLength(0, 12);
      c.pos.lerp(target, Math.min(1, dt * 20));
      if (c.pos.distanceTo(target) > 2.5) toggleHold();
      c.prev = {};
    } else {
      c.vel.y = Math.max(c.vel.y - GRAVITY * dt, -MAX_FALL);
      const grounded = moveBody(c.pos, CUBE_HALF, c.vel, dt, false);
      if (grounded) {
        const f = Math.exp(-dt * 8);
        c.vel.x *= f;
        c.vel.z *= f;
      }
      checkTeleport({ center: c.pos, vel: c.vel, get prev() { return c.prev; }, set prev(v) { c.prev = v; } }, CUBE_HALF, false);
      if (level.goo.some((g) => insideBox(c.pos, g)) || c.pos.y < level.data.room.min[1] - 20) {
        respawnCube(c);
        sayOnce(LINES.cubeGoo);
      } else if (level.fizzlers.some((f) => overlaps(c.pos, CUBE_HALF, f))) {
        respawnCube(c);
        sayOnce(LINES.cubeFizzle);
      }
    }
    c.mesh.position.copy(c.pos);
  }
}

function updateButtonsAndDoors(dt) {
  for (const b of level.buttons) {
    const onTop = (center, half) => Math.hypot(center.x - b.pos.x, center.z - b.pos.z) < 0.8
      && center.y - half.y > b.pos.y - 0.15 && center.y - half.y < b.pos.y + 0.45;
    b.pressed = level.cubes.some((c) => !c.held && onTop(c.pos, CUBE_HALF)) || onTop(player.center, PLAYER_HALF);
    b.top.position.y = b.pos.y + (b.pressed ? 0.12 : 0.16);
    b.topMat.color.setHex(b.pressed ? 0x1f9d55 : 0xd7263d);
    b.topMat.emissive.setHex(b.pressed ? 0x0a3a1f : 0x400000);
  }
  for (const d of level.doors) {
    const open = level.buttons.some((b) => b.pressed && b.opens.includes(d.id));
    const before = d.open;
    d.open = THREE.MathUtils.clamp(d.open + (open ? dt * 2 : -dt * 2), 0, 1);
    // Don't close a door on the player.
    if (d.open < before && d.open <= 0.8 && overlaps(player.center, PLAYER_HALF, d)) d.open = before;
    const size = d.height;
    d.mesh.position.y = d.home + size / 2 + d.open * size * 0.98;
  }
}

function updateJim(dt, t) {
  const forward = new V3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new V3(-forward.z, 0, forward.x);
  const target = eyePos().addScaledVector(forward, 2.2).addScaledVector(right, -1.3);
  target.y -= 0.35 - (reducedMotion ? 0 : Math.sin(t * 2.2) * 0.06);
  if (jimMood.time > 0) {
    jimMood.time -= dt;
    if (jimMood.kind === "sad") target.y -= 0.35;
    if (jimMood.kind === "happy" && !reducedMotion) target.y += Math.abs(Math.sin(t * 10)) * 0.25;
    if (jimMood.time <= 0) jimMood.kind = "idle";
  }
  if (jim.position.distanceTo(target) > 8) jim.position.copy(target); // after teleports, catch up
  jim.position.lerp(target, Math.min(1, dt * 4));
  jim.lookAt(eyePos());
  if (!reducedMotion && jimMood.kind === "happy") jim.rotateZ(t * 12);
  if (jimMood.kind === "sad") jim.rotateX(0.5);
  jimEyeMat.color.setHex(jimMood.kind === "sad" ? 0x8a6a20 : 0xffc640);
}

// ---------- game flow ----------

const state = {
  mode: "menu", // menu | loading | playing | ended
  runId: null,
  levels: [],
  index: 0,
  startedAt: 0,
  totalSeconds: 0,
};

async function fade(on) {
  $("fade").classList.toggle("on", on);
  await sleep(reducedMotion ? 0 : 380);
}

function die(lines) {
  jimReact("sad");
  say(pick(lines));
  resetLevelState();
}

async function loadChamber(i) {
  state.mode = "loading";
  const data = await api(`/levels/${encodeURIComponent(state.levels[i])}`);
  buildLevel(data);
  state.index = i;
  $("chamber-num").textContent = `Test chamber ${String(i + 1).padStart(2, "0")} / ${String(state.levels.length).padStart(2, "0")}`;
  $("chamber-name").textContent = data.name;
  jim.position.copy(eyePos());
  updateCrosshair();
  state.mode = "playing";
  say(data.intro);
}

let completing = false;
async function chamberComplete() {
  if (completing) return;
  completing = true;
  state.mode = "loading";
  held.clear();
  jimReact("happy", 2);
  try {
    const res = await api(`/runs/${state.runId}/complete`, {
      method: "POST",
      body: JSON.stringify({ level: state.levels[state.index] }),
    });
    state.totalSeconds = res.total_seconds;
    if (res.finished) {
      say(pick(LINES.end));
      endRun();
    } else {
      say(pick(LINES.done));
      await fade(true);
      await loadChamber(state.index + 1);
      await fade(false);
    }
  } catch (err) {
    say(`Something went wrong: ${err.message}`);
    state.mode = "playing";
    resetPlayer();
  } finally {
    completing = false;
  }
}

async function startRun() {
  const btn = $("start-btn");
  btn.disabled = true;
  $("start-error").textContent = "";
  try {
    const run = await api("/runs", { method: "POST" });
    state.runId = run.run_id;
    state.levels = run.levels;
    state.startedAt = performance.now();
    $("start").hidden = true;
    $("end").hidden = true;
    $("hud").hidden = false;
    await loadChamber(0);
    canvas.requestPointerLock();
  } catch (err) {
    $("start-error").textContent = err.message;
    state.mode = "menu";
  } finally {
    btn.disabled = false;
  }
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

function endRun() {
  state.mode = "ended";
  document.exitPointerLock();
  $("hud").hidden = true;
  $("pause").hidden = true;
  $("final-time").textContent = formatTime(state.totalSeconds);
  $("final-detail").textContent = `You finished all ${state.levels.length} test chambers. Jim is very proud. He didn't say so.`;
  $("name-form").hidden = false;
  $("name-error").textContent = "";
  $("end").hidden = false;
  $("name").focus();
}

$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || $("name-form").querySelector("button");
  btn.disabled = true;
  $("name-error").textContent = "";
  try {
    const res = await api(`/runs/${state.runId}/finish`, {
      method: "POST",
      body: JSON.stringify({ name: $("name").value }),
    });
    $("name-form").hidden = true;
    $("final-detail").textContent = `You're number ${res.rank} on the leaderboard!`;
    loadLeaderboard();
  } catch (err) {
    $("name-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("again-btn").addEventListener("click", () => {
  state.mode = "menu";
  $("end").hidden = true;
  $("start").hidden = false;
});
$("start-btn").addEventListener("click", startRun);

async function loadLeaderboard() {
  const list = $("leaderboard");
  try {
    const { leaderboard } = await api("/leaderboard");
    if (!leaderboard.length) {
      const li = document.createElement("li");
      li.textContent = "No test subjects yet. Be the first!";
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...leaderboard.map((row) => {
      const li = document.createElement("li");
      const time = document.createElement("span");
      time.className = "pts";
      time.textContent = formatTime(row.seconds);
      li.append(row.name, time);
      return li;
    }));
  } catch {
    const li = document.createElement("li");
    li.textContent = "Couldn't load times.";
    list.replaceChildren(li);
  }
}

// ---------- screen size ----------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  for (const p of Object.values(portals)) {
    p.rt.setSize(size.x, size.y);
    p.mat.uniforms.uRes.value.copy(size);
  }
}
window.addEventListener("resize", resize);
resize();

// ---------- main loop ----------

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (level.data) {
    if (state.mode === "playing" && (locked || isTouchOnly)) {
      updatePlayer(dt);
      if (state.mode === "playing") updateCubes(dt);
    }
    if (state.mode !== "menu") updateButtonsAndDoors(dt);
    updateJim(dt, t);
  } else {
    // Menu background: slowly look around an empty chamber.
    player.yaw = Math.sin(t * 0.15) * 0.6;
  }

  for (const m of level.shaders) if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
  for (const p of Object.values(portals)) p.mat.uniforms.uTime.value = t;

  if (beamLife > 0) {
    beamLife -= dt;
    beamMat.opacity = Math.max(0, beamLife / 0.12);
    if (beamLife <= 0) beam.visible = false;
  }
  recoil = Math.max(0, recoil - dt * 6);
  gun.position.z = -0.45 + recoil * 0.07;
  gun.rotation.x = recoil * 0.15;
  if (!reducedMotion) gun.position.y = -0.24 + Math.sin(t * 2) * 0.005;

  if (state.mode === "playing" || state.mode === "loading") {
    $("timer").textContent = formatTime((performance.now() - state.startedAt) / 1000);
  }

  camera.position.copy(eyePos());
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
  renderPortalViews();
  renderer.render(scene, camera);
});

// Show the first chamber behind the menu.
if (isTouchOnly) {
  $("touch-note").hidden = false;
}
loadLeaderboard();
api("/levels").then(async ({ levels }) => {
  if (!levels.length || state.mode !== "menu") return;
  const data = await api(`/levels/${encodeURIComponent(levels[0].id)}`);
  if (state.mode === "menu") buildLevel(data);
}).catch((err) => { $("start-error").textContent = `The lab server isn't answering: ${err.message}`; });
