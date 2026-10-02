// Portal Quiz: an unofficial Portal fan game.
// Shoot a blue portal onto an answer panel, then drop into the orange portal on the floor.
// The API (/api/*) keeps the answers; this file only draws the chamber and asks the API.
import * as THREE from "./vendor/three-0.170.0.module.min.js";

const LETTERS = ["A", "B", "C", "D"];
const BLUE = 0x2f9bff;
const ORANGE = 0xff8a1f;
const PANEL_X = [-4.8, -1.6, 1.6, 4.8];
const PANEL_Z = -8.9;
const PANEL_W = 2.6;
const PANEL_H = 3.4;
const FLOOR_PORTAL = new THREE.Vector3(0, 0.02, 1.5);
const FLOOR_PORTAL_RADIUS = 0.9;
const EYE_HEIGHT = 1.6;
const START = new THREE.Vector3(0, EYE_HEIGHT, 6);
const ROOM = { minX: -6.6, maxX: 6.6, minZ: -8.3, maxZ: 8.4, width: 14, depth: 18, height: 7 };
const WALK_SPEED = 4.5;
const TURN_SPEED = 2.0;
const BASE_FOV = 70;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------- GLaDOS (all lines written for this fan game) ----------

const LINES = {
  intro: [
    "Hello, and welcome to the Quiz Wing. Please shoot a portal onto the correct answer. Then jump in. That is the whole test. Even you can do it. Probably.",
    "Oh. A new test subject. And you brought Jim. Jim is a very small core. Jim does not talk, which makes him my favourite.",
  ],
  correct: [
    "Correct. I am recording that as a lucky guess.",
    "Well done. That was the right answer. I checked twice because I was surprised.",
    "Correct. Jim is spinning. I believe that means he is happy. Or broken.",
    "Good. The next test chamber is ready. It has more science in it.",
    "Correct. You are doing better than the last test subject. He tried to portal into the ceiling.",
  ],
  wrong: [
    "No. That panel is now made of metal portals will not stick to. Science has spoken.",
    "Incorrect. Do not worry. Being wrong is an important part of science. Mostly for you.",
    "That was the wrong answer. Jim looks disappointed. He is a sphere, but I can tell.",
    "Wrong. Try a different panel. There are only three left. Two, if you keep this up.",
  ],
  noBlue: [
    "You jumped into a portal with nowhere to go. Shoot a blue portal on an answer panel first.",
    "The orange portal needs a partner. Put a blue portal on an answer. That is how portals work.",
  ],
  metal: [
    "Portals do not stick to that panel any more. You already tried it. Remember?",
  ],
  jim: [
    "That is Jim. Jim does not talk. It is honestly his best feature.",
    "Please stop poking Jim. He is a core, not a button.",
    "Jim would like you to focus on the test. I am guessing. He did not say anything.",
  ],
  end: [
    "Testing is complete. You did well. There will be a party. I am almost sure there will be a party.",
    "All test chambers done. Jim did a little spin. I have never seen him do that before. It was upsetting.",
  ],
};

let subtitleTimer;
function say(text) {
  const box = $("subtitle");
  $("subtitle-text").textContent = text;
  box.hidden = false;
  clearTimeout(subtitleTimer);
  subtitleTimer = setTimeout(() => { box.hidden = true; }, 3500 + text.length * 45);
}

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
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

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat[0] !== 1 || repeat[1] !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// White square wall panels with thin grey seams.
const wallTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = "#e9ecef";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const shade = 232 + ((i + j) % 2) * 6;
      g.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 4})`;
      g.fillRect(i * 128 + 4, j * 128 + 4, 120, 120);
    }
  }
  g.strokeStyle = "#b5bcc3";
  g.lineWidth = 4;
  for (let k = 0; k <= 256; k += 128) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke();
  }
}, [ROOM.width / 2, ROOM.height / 2]);

// Dark metal floor tiles.
const floorTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = "#4a5056";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#33383d";
  g.lineWidth = 6;
  g.strokeRect(0, 0, w, h);
  g.strokeStyle = "#5a6066";
  g.lineWidth = 2;
  g.strokeRect(10, 10, w - 20, h - 20);
}, [ROOM.width / 2, ROOM.depth / 2]);

function signTexture(letter, text, mode = "normal") {
  return canvasTexture(512, 192, (g) => {
    g.fillStyle = mode === "metal" ? "#3a3f44" : "#f6f7f8";
    g.fillRect(0, 0, 512, 192);
    g.fillStyle = mode === "metal" ? "#6c737a" : "#1d2126";
    g.fillRect(0, 0, 150, 192);
    g.fillStyle = mode === "metal" ? "#3a3f44" : "#f6f7f8";
    g.font = "bold 120px 'Segoe UI', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letter, 75, 100);

    g.fillStyle = mode === "metal" ? "#9aa1a8" : "#1d2126";
    g.textAlign = "left";
    const maxW = 335;
    let size = 84;
    let lines;
    do {
      g.font = `600 ${size}px 'Segoe UI', system-ui, sans-serif`;
      lines = wrap(g, text, maxW);
      size -= 4;
    } while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > maxW)) && size > 18);
    const lh = size + 10;
    lines.forEach((l, i) => g.fillText(l, 168, 98 + (i - (lines.length - 1) / 2) * lh));
  });
}

function chamberTexture(n, total) {
  return canvasTexture(256, 384, (g) => {
    g.fillStyle = "#f6f7f8";
    g.fillRect(0, 0, 256, 384);
    g.fillStyle = "#1d2126";
    g.font = "bold 150px 'Segoe UI', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(n).padStart(2, "0"), 128, 130);
    g.fillRect(24, 230, 208, 6);
    g.font = "600 36px 'Segoe UI', system-ui, sans-serif";
    g.fillText(`of ${String(total).padStart(2, "0")}`, 128, 290);
  });
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && g.measureText(test).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------- the test chamber ----------

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa3ab);

const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 100);
camera.rotation.order = "YXZ";
scene.add(camera); // the portal gun is a child of the camera

scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6066, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 10, 6);
scene.add(sun);

const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7, metalness: 0.2 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
  new THREE.MeshStandardMaterial({ color: 0x7d858c, roughness: 0.9 }),
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = ROOM.height;
scene.add(ceiling);

// Long ceiling light strips.
for (const x of [-4, 0, 4]) {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.08, ROOM.depth - 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  strip.position.set(x, ROOM.height - 0.05, 0);
  scene.add(strip);
}

function wall(w, h, x, z, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  m.position.set(x, h / 2, z);
  m.rotation.y = rotY;
  scene.add(m);
}
wall(ROOM.depth, ROOM.height, -ROOM.width / 2, 0, Math.PI / 2);
wall(ROOM.depth, ROOM.height, ROOM.width / 2, 0, -Math.PI / 2);
wall(ROOM.width, ROOM.height, 0, -ROOM.depth / 2, 0);
wall(ROOM.width, ROOM.height, 0, ROOM.depth / 2, Math.PI);

// Big chamber number sign on the left wall.
const chamberSignMat = new THREE.MeshBasicMaterial();
const chamberSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), chamberSignMat);
chamberSign.position.set(-ROOM.width / 2 + 0.02, 3, 3);
chamberSign.rotation.y = Math.PI / 2;
scene.add(chamberSign);

// Swirly portal surface shader.
const portalVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const portalFragment = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpen;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p) / max(uOpen, 0.001);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float swirl = sin(a * 3.0 + r * 9.0 - uTime * 4.0) * 0.5 + 0.5;
    float rim = smoothstep(0.75, 1.0, r);
    vec3 col = mix(uColor * 0.25, uColor * 1.2, swirl * 0.6 + rim);
    col += rim * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makePortal(color, w, h) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpen: { value: 0 } },
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const light = new THREE.PointLight(color, 6, 4);
  mesh.add(light);
  light.position.z = 0.4;
  return { mesh, mat, light, open: 0, target: 0 };
}

// The orange portal is always open on the floor.
const orange = makePortal(ORANGE, FLOOR_PORTAL_RADIUS * 2, FLOOR_PORTAL_RADIUS * 2.6);
orange.mesh.rotation.x = -Math.PI / 2;
orange.mesh.position.copy(FLOOR_PORTAL);
orange.target = 1;
scene.add(orange.mesh);

// The blue portal moves to whichever answer panel you shoot.
const blue = makePortal(BLUE, 1.5, 2.4);
blue.mesh.visible = false;
scene.add(blue.mesh);

// Answer panels on the back wall.
const panels = PANEL_X.map((x, i) => {
  const surfaceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const surface = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.1), surfaceMat);
  surface.position.set(x, PANEL_H / 2 + 0.3, PANEL_Z);
  surface.userData.panel = i;
  scene.add(surface);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W + 0.2, PANEL_H + 0.2, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.4 }),
  );
  frame.position.set(x, PANEL_H / 2 + 0.3, PANEL_Z - 0.04);
  scene.add(frame);

  const signMat = new THREE.MeshBasicMaterial();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_W * 0.375), signMat);
  sign.position.set(x, PANEL_H + 1.05, PANEL_Z + 0.02);
  sign.userData.panel = i;
  scene.add(sign);

  return { surface, surfaceMat, signMat, metal: false, text: "" };
});
const shootTargets = panels.flatMap((p) => [p.surface]);

function setPanels(choices) {
  panels.forEach((p, i) => {
    p.metal = false;
    p.text = choices[i];
    p.surfaceMat.color.setHex(0xffffff);
    p.surfaceMat.metalness = 0;
    if (p.signMat.map) p.signMat.map.dispose();
    p.signMat.map = signTexture(LETTERS[i], choices[i]);
    p.signMat.needsUpdate = true;
  });
  closeBlue();
}

function makeMetal(i) {
  const p = panels[i];
  p.metal = true;
  p.surfaceMat.color.setHex(0x3a3f44);
  p.surfaceMat.metalness = 0.6;
  if (p.signMat.map) p.signMat.map.dispose();
  p.signMat.map = signTexture(LETTERS[i], p.text, "metal");
  p.signMat.needsUpdate = true;
}

// ---------- the portal gun (held in front of the camera) ----------

const gun = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f5, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 6, 16), white);
  body.rotation.x = Math.PI / 2;
  gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 16), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.26;
  gun.add(barrel);
  for (const side of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.18), dark);
    claw.position.set(side * 0.07, 0.04, -0.3);
    claw.rotation.y = side * 0.25;
    gun.add(claw);
  }
  const top = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), dark);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, 0.1, 0.04);
  gun.add(top);
}
const gunGlowMat = new THREE.MeshBasicMaterial({ color: BLUE });
const gunGlow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), gunGlowMat);
gunGlow.position.z = -0.34;
gun.add(gunGlow);
gun.position.set(0.32, -0.28, -0.55);
gun.scale.setScalar(0.8);
camera.add(gun);
let recoil = 0;

// A short-lived blue beam from the gun to where the portal lands.
const beamMat = new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.9 });
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), beamMat);
beam.visible = false;
scene.add(beam);
let beamLife = 0;

// ---------- Jim, the little core who never talks ----------

const jim = new THREE.Group();
const jimEyeMat = new THREE.MeshBasicMaterial({ color: 0xffc640 });
{
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.35, metalness: 0.6 }),
  );
  jim.add(shell);
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.225, 0.025, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.5, metalness: 0.5 }),
  );
  jim.add(band);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), jimEyeMat);
  eye.position.z = 0.215;
  jim.add(eye);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x1d2126 }));
  pupil.position.z = 0.218;
  jim.add(pupil);
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.018, 6, 16, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x4a5056 }),
    );
    handle.position.set(side * 0.2, 0, 0);
    handle.rotation.set(0, Math.PI / 2, side * Math.PI / 2);
    jim.add(handle);
  }
  const light = new THREE.PointLight(0xffc640, 1.5, 2);
  light.position.z = 0.4;
  jim.add(light);
}
jim.traverse((o) => { o.userData.jim = true; });
jim.position.set(-1, 1.4, 4.5);
scene.add(jim);
const jimMood = { kind: "idle", time: 0 };
function jimReact(kind) {
  jimMood.kind = kind;
  jimMood.time = kind === "idle" ? 0 : 1.4;
}

// ---------- screen size ----------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.userData.baseFov = w < h ? 90 : BASE_FOV;
  camera.fov = camera.userData.baseFov;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- player controls ----------

const player = { pos: START.clone(), yaw: 0, pitch: -0.05 };
const held = new Set();
const KEYMAP = {
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "strafeLeft", KeyD: "strafeRight", ArrowLeft: "left", ArrowRight: "right",
};

window.addEventListener("keydown", (e) => {
  if (state.mode !== "playing" || (e.target instanceof Element && e.target.closest("input, select, textarea"))) return;
  if (KEYMAP[e.code]) {
    held.add(KEYMAP[e.code]);
    e.preventDefault();
  }
  const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
  if (n >= 0) shootAtPanel(n);
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    jumpIn();
  }
});
window.addEventListener("keyup", (e) => { if (KEYMAP[e.code]) held.delete(KEYMAP[e.code]); });
window.addEventListener("blur", () => held.clear());

// Drag to look; a quick tap/click (without dragging) shoots a portal at that spot.
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  player.yaw -= (e.clientX - drag.x) * 0.005;
  player.pitch = THREE.MathUtils.clamp(player.pitch - (e.clientY - drag.y) * 0.004, -0.9, 0.9);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
  if (moved < 8 && performance.now() - drag.t < 400) shootAtScreen(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener("pointercancel", () => { drag = null; });

const isTouch = window.matchMedia("(pointer: coarse)").matches;
document.querySelectorAll("#touch button").forEach((b) => {
  const key = b.dataset.key;
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); held.add(key); b.setPointerCapture(e.pointerId); });
  const up = () => held.delete(key);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("lostpointercapture", up);
});

function resetPlayer() {
  player.pos.copy(START);
  player.yaw = 0;
  player.pitch = -0.05;
  held.clear();
}

// ---------- shooting portals ----------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();

function shootAtScreen(clientX, clientY) {
  if (state.mode !== "playing" || state.busy) return;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...shootTargets, jim], true);
  const hit = hits[0];
  fireBeam(hit ? hit.point : raycaster.ray.at(12, tmp));
  if (!hit) return;
  if (hit.object.userData.jim) {
    jimReact("poke");
    say(pick(LINES.jim));
    return;
  }
  if (hit.object.userData.panel !== undefined) placeBlue(hit.object.userData.panel);
}

function shootAtPanel(i) {
  if (state.mode !== "playing" || state.busy) return;
  fireBeam(panels[i].surface.position);
  placeBlue(i);
}

function fireBeam(to) {
  recoil = 1;
  gunGlowMat.color.setHex(BLUE);
  const from = gunGlow.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3().subVectors(to, from);
  beam.position.copy(from).addScaledVector(dir, 0.5);
  beam.scale.set(1, dir.length(), 1);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  beam.visible = true;
  beamLife = 0.15;
}

function placeBlue(i) {
  if (panels[i].metal) {
    say(pick(LINES.metal));
    return;
  }
  state.target = i;
  blue.mesh.position.set(PANEL_X[i], PANEL_H / 2 + 0.3, PANEL_Z + 0.07);
  blue.mesh.visible = true;
  blue.open = 0;
  blue.target = 1;
}

function closeBlue() {
  state.target = null;
  blue.target = 0;
  blue.open = 0;
  blue.mesh.visible = false;
}

function jumpIn() {
  if (state.mode !== "playing" || state.busy) return;
  if (state.target === null) {
    nag();
    return;
  }
  choose(state.target);
}

let lastNag = 0;
function nag() {
  const now = performance.now();
  if (now - lastNag > 4000) {
    say(pick(LINES.noBlue));
    lastNag = now;
  }
}

// ---------- moving ----------

const forward = new THREE.Vector3();
const sideways = new THREE.Vector3();

function movePlayer(dt) {
  if (held.has("left")) player.yaw += TURN_SPEED * dt;
  if (held.has("right")) player.yaw -= TURN_SPEED * dt;

  forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  sideways.set(-forward.z, 0, forward.x);
  const step = WALK_SPEED * dt;
  if (held.has("forward")) player.pos.addScaledVector(forward, step);
  if (held.has("back")) player.pos.addScaledVector(forward, -step);
  if (held.has("strafeRight")) player.pos.addScaledVector(sideways, step);
  if (held.has("strafeLeft")) player.pos.addScaledVector(sideways, -step);

  player.pos.x = THREE.MathUtils.clamp(player.pos.x, ROOM.minX, ROOM.maxX);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, ROOM.minZ, ROOM.maxZ);

  // Stepping onto the orange floor portal.
  const dx = player.pos.x - FLOOR_PORTAL.x;
  const dz = player.pos.z - FLOOR_PORTAL.z;
  if (Math.hypot(dx, dz * 0.77) < FLOOR_PORTAL_RADIUS * 0.8) {
    if (state.target === null) {
      nag();
      // Step back off the portal so you don't stand in it.
      const len = Math.hypot(dx, dz) || 1;
      player.pos.x = FLOOR_PORTAL.x + (dx / len) * FLOOR_PORTAL_RADIUS * 1.4;
      player.pos.z = FLOOR_PORTAL.z + (dz / len || 1) * FLOOR_PORTAL_RADIUS * 1.4;
    } else {
      choose(state.target);
    }
  }
}

// ---------- game state ----------

const state = {
  mode: "menu", // menu | playing | ended
  busy: false,
  gameId: null,
  rounds: [],
  round: 0,
  score: 0,
  correctFirst: 0,
  target: null, // panel with the blue portal on it
};

function showRound() {
  const r = state.rounds[state.round];
  const n = state.round + 1;
  $("round-info").textContent = `Test chamber ${String(n).padStart(2, "0")} / ${String(state.rounds.length).padStart(2, "0")} · ${r.category}`;
  $("question").textContent = r.question;
  $("choice-list").replaceChildren(...r.choices.map((c, i) => {
    const li = document.createElement("li");
    li.textContent = `Panel ${LETTERS[i]} (key ${i + 1}): ${c}`;
    return li;
  }));
  setPanels(r.choices);
  if (chamberSignMat.map) chamberSignMat.map.dispose();
  chamberSignMat.map = chamberTexture(n, state.rounds.length);
  chamberSignMat.needsUpdate = true;
  resetPlayer();
}

let toastTimer;
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ""; }, 1300);
}

// "Fall" through the floor portal and out of the blue one.
let fall = 0;
const FALL_TIME = 0.7;

function backToStart() {
  player.pos.copy(START);
  player.yaw = 0;
  player.pitch = -0.05;
  held.clear();
}

async function choose(i) {
  if (state.mode !== "playing" || state.busy || panels[i].metal) return;
  state.busy = true;
  if (!reducedMotion) fall = FALL_TIME;
  try {
    const [res] = await Promise.all([
      api(`/games/${state.gameId}/answer`, { method: "POST", body: JSON.stringify({ round: state.round, choice: i }) }),
      new Promise((r) => setTimeout(r, reducedMotion ? 100 : FALL_TIME * 1000)),
    ]);
    state.score = res.score;
    $("score").textContent = String(res.score);
    if (res.correct) {
      toast(`Correct! +${res.points}`, "good");
      jimReact("happy");
      state.correctFirst = res.correct_first_try;
      if (res.finished) {
        say(pick(LINES.end));
        await new Promise((r) => setTimeout(r, 1200));
        endGame();
      } else {
        say(pick(LINES.correct));
        await new Promise((r) => setTimeout(r, 900));
        state.round += 1;
        showRound();
      }
    } else {
      toast("Wrong panel!", "bad");
      jimReact("sad");
      say(pick(LINES.wrong));
      makeMetal(i);
      closeBlue();
      backToStart();
    }
  } catch (err) {
    toast(err.message, "bad");
    closeBlue();
    backToStart();
  } finally {
    fall = 0;
    state.busy = false;
  }
}

async function startGame() {
  const btn = $("start-btn");
  btn.disabled = true;
  $("start-error").textContent = "";
  try {
    const category = $("category").value || null;
    const g = await api("/games", { method: "POST", body: JSON.stringify({ category }) });
    Object.assign(state, { mode: "playing", gameId: g.game_id, rounds: g.rounds, round: 0, score: 0, correctFirst: 0 });
    $("score").textContent = "0";
    $("start").hidden = true;
    $("end").hidden = true;
    $("hud").hidden = false;
    $("touch").hidden = !isTouch;
    if (isTouch) $("help").textContent = "Tap an answer to shoot a portal · walk into the orange portal · drag to look";
    showRound();
    say(pick(LINES.intro));
  } catch (err) {
    $("start-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function endGame() {
  state.mode = "ended";
  held.clear();
  $("hud").hidden = true;
  $("touch").hidden = true;
  $("final-score").textContent = String(state.score);
  $("final-detail").textContent =
    `You got ${state.correctFirst} of ${state.rounds.length} right on the first try. Jim is proud of you. Probably.`;
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
    const res = await api(`/games/${state.gameId}/finish`, {
      method: "POST",
      body: JSON.stringify({ name: $("name").value }),
    });
    $("name-form").hidden = true;
    $("final-detail").textContent = `You're test subject number ${res.rank} on the leaderboard!`;
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
  closeBlue();
  resetPlayer();
});
$("start-btn").addEventListener("click", startGame);

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
      const pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = String(row.score);
      li.append(row.name, pts);
      return li;
    }));
  } catch {
    const li = document.createElement("li");
    li.textContent = "Couldn't load scores.";
    list.replaceChildren(li);
  }
}

async function loadCategories() {
  try {
    const { categories } = await api("/categories");
    const sel = $("category");
    for (const c of categories) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.questions})`;
      sel.append(opt);
    }
  } catch (err) {
    $("start-error").textContent = `The quiz server isn't answering: ${err.message}`;
  }
}

// ---------- main loop ----------

const jimTarget = new THREE.Vector3();
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (state.mode === "playing" && !state.busy) movePlayer(dt);
  else if (state.mode === "menu" && !reducedMotion) player.yaw = Math.sin(t * 0.2) * 0.3;

  // Portals open smoothly and swirl.
  for (const p of [orange, blue]) {
    p.open += (p.target - p.open) * Math.min(1, dt * 10);
    p.mat.uniforms.uOpen.value = reducedMotion ? p.target : p.open;
    p.mat.uniforms.uTime.value = t;
  }

  // Beam and recoil.
  if (beamLife > 0) {
    beamLife -= dt;
    beamMat.opacity = Math.max(0, beamLife / 0.15);
    if (beamLife <= 0) beam.visible = false;
  }
  recoil = Math.max(0, recoil - dt * 6);
  gun.position.z = -0.55 + recoil * 0.08;
  gun.rotation.x = recoil * 0.15;
  if (!reducedMotion) gun.position.y = -0.28 + Math.sin(t * 2) * 0.006;
  gunGlowMat.color.setHex(state.target === null ? BLUE : ORANGE);

  // Jim floats beside you, a little ahead, and looks at you.
  forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  sideways.set(-forward.z, 0, forward.x);
  jimTarget.copy(player.pos).addScaledVector(forward, 2.6).addScaledVector(sideways, -1.6);
  jimTarget.y = 1.15 + (reducedMotion ? 0 : Math.sin(t * 2.2) * 0.06);
  if (jimMood.time > 0) {
    jimMood.time -= dt;
    if (jimMood.kind === "sad") jimTarget.y -= 0.35;
    if (jimMood.kind === "happy" && !reducedMotion) jimTarget.y += Math.abs(Math.sin(t * 10)) * 0.25;
    if (jimMood.time <= 0) jimReact("idle");
  }
  jim.position.lerp(jimTarget, Math.min(1, dt * 4));
  jim.lookAt(player.pos);
  if (!reducedMotion) {
    if (jimMood.kind === "happy") jim.rotateZ(t * 12);
    if (jimMood.kind === "poke") jim.rotateZ(Math.sin(t * 30) * 0.4);
    if (jimMood.kind === "sad") jim.rotateX(0.5);
  }
  jimEyeMat.color.setHex(jimMood.kind === "sad" ? 0x8a6a20 : 0xffc640);

  // Falling through the floor portal.
  const baseFov = camera.userData.baseFov;
  camera.position.copy(player.pos);
  if (fall > 0) {
    fall = Math.max(0, fall - dt);
    const k = 1 - fall / FALL_TIME;
    camera.position.y -= k * k * 2.2;
    camera.fov = baseFov + Math.sin(k * Math.PI) * 40;
    camera.updateProjectionMatrix();
  } else if (camera.fov !== baseFov) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.render(scene, camera);
});

setPanels(["Space", "Animals", "Maths", "Games"]);
chamberSignMat.map = chamberTexture(1, 10);
loadCategories();
loadLeaderboard();
