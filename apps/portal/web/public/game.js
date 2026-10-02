// Portal Fan Lab: an unofficial Portal fan game, running on the Fire Raze engine.
// Test chambers come from the API (/api/levels). The API also keeps the run clock and the leaderboard.
import * as THREE from "./vendor/three-0.170.0.module.min.js";
import {
  applyGravity, castRay, CUBE_HALF, ENGINE, insideBox, moveBody, overlaps, PortalSystem, setupLighting, World,
} from "./fireraze/index.js";

const V3 = THREE.Vector3;
const BLUE = 0x2f9bff;
const ORANGE = 0xff8a1f;
const EYE_TO_CENTER = 0.7; // body centre is 0.7 m below the eyes
const PLAYER_HALF = new V3(0.3, 0.9, 0.3);
const JUMP_SPEED = 5.5;
const WALK_SPEED = 4.5;
const LOOK_SPEED = 0.0022;
const HOLD_DISTANCE = 1.6;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isTouchOnly = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
// Developer mode (open the page with ?dev): play without mouse lock, and get `fireraze` in the browser console.
const DEV = new URLSearchParams(location.search).has("dev");

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
  surface: [
    "Portals only stick to white surfaces. That is not a white surface.",
    "No. Dark metal does not hold portals. Look for white panels.",
  ],
  nofit: ["There is not enough room there for a portal."],
  orangeLocked: ["Your gun only fires blue portals in this chamber. The orange one is already placed."],
  fizzle: ["The fizzler erased your portals. That is its job. It loves its job."],
  cubeFizzle: ["The cube was fizzled. Don't worry, it felt nothing. A new one is on the way."],
  cubeGoo: ["The cube fell in the goo. I'll make you a new one. Try to keep this one dry."],
  end: ["All test chambers complete. You have been a wonderful test subject. Jim agrees. He did not say so, but he agrees."],
};

let subtitleTimer;
function say(text) {
  if (!text) return;
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

// ---------- engine setup ----------

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2126);
setupLighting(renderer, scene);

const camera = new THREE.PerspectiveCamera(75, 1, 0.03, 200);
camera.rotation.order = "YXZ";
scene.add(camera);

const world = new World(scene);
const portals = new PortalSystem(scene, renderer, { blue: BLUE, orange: ORANGE });
portals.onChange = updateCrosshair;

// ---------- the portal gun ----------

// Our own design (the "Fire Raze gun"): smooth white shell, dark finned back end, glass core
// window on the side, light strip on top, and a three-prong emitter at the front.
// Every glowing part takes the colour of the last portal you shot. Forward is -z.
const gun = new THREE.Group();
const gunGlowMat = new THREE.MeshBasicMaterial({ color: BLUE });
const gunGlowParts = [gunGlowMat];
let gunGlow; // the emitter tip: beams start here
{
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f6, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.45, metalness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.45 });
  const glow = () => {
    const m = new THREE.MeshBasicMaterial({ color: BLUE });
    gunGlowParts.push(m);
    return m;
  };
  const along = (mesh) => { mesh.rotation.x = Math.PI / 2; return mesh; }; // point a lathe/cylinder along -z

  // Shell: a smooth, egg-shaped body spun from a side profile.
  const profile = [[0, 0.16], [0.05, 0.155], [0.075, 0.12], [0.085, 0.05], [0.082, -0.04], [0.068, -0.12], [0.05, -0.16], [0.045, -0.165]]
    .map(([r, z]) => new THREE.Vector2(r, z));
  const shell = along(new THREE.Mesh(new THREE.LatheGeometry(profile, 32), white));
  shell.scale.set(1, 1, 0.92); // a little flatter top-to-bottom
  gun.add(shell);

  // Back end: dark cap with cooling fins.
  const cap = along(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 24), dark));
  cap.position.z = 0.17;
  gun.add(cap);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.008, 0.035), grey);
    fin.position.set(0, -0.03 + i * 0.02, 0.19);
    gun.add(fin);
  }

  // Top spine with a glowing strip.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.22), dark);
  spine.position.set(0, 0.078, 0.0);
  gun.add(spine);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.18), glow());
  strip.position.set(0, 0.095, 0.0);
  gun.add(strip);

  // Side window: a glass tube with the glowing core inside (on the side you can see).
  const core = along(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 12), glow()));
  core.position.set(-0.07, 0.0, 0.02);
  const tube = along(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 16), glass));
  tube.position.copy(core.position);
  gun.add(core, tube);

  // Front emitter: dark barrel, glowing ring and three prongs curling inwards.
  const barrel = along(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.07, 24), dark));
  barrel.position.z = -0.19;
  gun.add(barrel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 32), glow());
  ring.position.z = -0.226;
  gun.add(ring);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const prong = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.08), grey);
    base.position.z = -0.04;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.035), dark);
    tip.position.set(0, -0.012, -0.09);
    tip.rotation.x = 0.5; // bends in towards the middle
    prong.add(base, tip);
    prong.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.21);
    prong.rotation.z = a - Math.PI / 2;
    gun.add(prong);
  }

  gunGlow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), gunGlowMat);
  gunGlow.position.z = -0.27;
  gun.add(gunGlow);
  const tipLight = new THREE.PointLight(BLUE, 0.35, 0.8);
  tipLight.position.z = -0.3;
  gun.add(tipLight);
  gun.userData.tipLight = tipLight;
  gun.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
}

function setGunColor(color) {
  for (const m of gunGlowParts) m.color.setHex(color);
  gun.userData.tipLight.color.setHex(color);
}
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
  setGunColor(color);
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
  jim.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.35, metalness: 0.6 }),
  ));
  jim.add(new THREE.Mesh(
    new THREE.TorusGeometry(0.205, 0.022, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.5, metalness: 0.5 }),
  ));
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

// ---------- player ----------

const player = {
  center: new V3(),
  vel: new V3(),
  half: PLAYER_HALF,
  yaw: 0,
  pitch: 0,
  onGround: false,
  held: null,
  prev: {}, // which side of each portal we were on last frame
};

function resetPlayer() {
  const s = world.data.start;
  player.center.set(s.pos[0], s.pos[1] - EYE_TO_CENTER, s.pos[2]);
  player.vel.set(0, 0, 0);
  player.yaw = THREE.MathUtils.degToRad(s.yaw);
  player.pitch = 0;
  player.held = null;
  player.prev = {};
  for (const c of world.cubes) c.held = false;
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

function loadWorld(data, chamberNumber = 1, chamberCount = 1) {
  world.build(data, { chamberNumber, chamberCount });
  portals.clearAll();
  for (const f of data.fixed_portals) {
    const normal = new V3(...f.normal);
    const up = Math.abs(normal.y) > 0.5 ? new V3(0, 0, -1) : new V3(0, 1, 0);
    portals.place(portals[f.color], new V3(...f.pos), normal, up, world.solids, true);
  }
  $("orange-help").hidden = data.gun !== "both";
  resetPlayer();
  updateCrosshair();
}

function resetChamber() {
  portals.clearUnfixed();
  world.resetMovingParts();
  resetPlayer();
}

// ---------- input ----------

const held = new Set();
const KEYMAP = {
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};
let locked = false;
const active = () => state.mode === "playing" && (locked || DEV);

window.addEventListener("keydown", (e) => {
  if (state.mode !== "playing") return;
  if (e.target instanceof Element && e.target.closest("input, textarea")) return;
  if (KEYMAP[e.code]) { held.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === "Space") { held.add("jump"); e.preventDefault(); }
  if (e.code === "KeyE" && !e.repeat) toggleHold();
  if (e.code === "KeyR" && !e.repeat) { say(pick(LINES.restart)); resetChamber(); }
  if (e.code === "KeyH" && !e.repeat) say(world.data.hint || "No hints here. You've got this.");
});
window.addEventListener("keyup", (e) => {
  if (KEYMAP[e.code]) held.delete(KEYMAP[e.code]);
  if (e.code === "Space") held.delete("jump");
});
window.addEventListener("blur", () => held.clear());

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  if (state.mode !== "playing") return;
  if (!locked && !DEV) {
    canvas.requestPointerLock();
    return;
  }
  if (e.button === 0) shoot("blue");
  if (e.button === 2) shoot("orange");
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  if (state.mode === "playing" && !DEV) $("pause").hidden = locked;
  if (!locked) held.clear();
});
document.addEventListener("mousemove", (e) => {
  if (!locked || state.mode !== "playing") return;
  player.yaw -= e.movementX * LOOK_SPEED;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * LOOK_SPEED, -1.5, 1.5);
});
$("resume-btn").addEventListener("click", () => canvas.requestPointerLock());

// ---------- shooting and carrying ----------

function shoot(color) {
  if (color === "orange" && world.data.gun !== "both") {
    sayOnce(LINES.orangeLocked);
    return false;
  }
  const p = portals[color];
  const origin = eyePos();
  const dir = lookDir();
  const hit = castRay(origin, dir, world.solidsNow());
  const end = hit ? origin.clone().addScaledVector(dir, hit.t) : origin.clone().addScaledVector(dir, 30);
  fireBeam(end, p.color);
  if (!hit) return false;
  const spot = portals.fit(hit.box, end, hit.normal, hit.axis, dir);
  if (spot.error) {
    sayOnce(LINES[spot.error]);
    return false;
  }
  if (!portals.place(p, spot.pos, spot.normal, spot.up, world.solids)) {
    sayOnce(LINES.nofit);
    return false;
  }
  return true;
}

function updateCrosshair() {
  document.querySelector("#crosshair .l").classList.toggle("on", portals.blue.placed);
  const r = document.querySelector("#crosshair .r");
  r.classList.toggle("on", portals.orange.placed);
  r.classList.toggle("off", !!world.data && world.data.gun !== "both" && !portals.orange.placed);
}

function toggleHold() {
  if (player.held) {
    const c = player.held;
    c.held = false;
    player.held = null;
    // If the cube ended up inside a wall, drop it at your feet instead.
    if (world.solidsNow().some((s) => overlaps(c.center, CUBE_HALF, s))) {
      c.center.copy(player.center);
      c.vel.set(0, 0, 0);
    }
    c.prev = {};
    return;
  }
  const eye = eyePos();
  const dir = lookDir();
  let best = null;
  for (const c of world.cubes) {
    const to = new V3().subVectors(c.center, eye);
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

// ---------- per-frame updates ----------

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

  // Full control on the ground; only a little steering in the air, so flings keep their speed.
  const vx = player.vel.x;
  const vz = player.vel.z;
  if (player.onGround) {
    const k = Math.min(1, dt * 14);
    player.vel.x += (_wish.x - vx) * k;
    player.vel.z += (_wish.z - vz) * k;
    if (held.has("jump")) player.vel.y = JUMP_SPEED;
  } else if (_wish.lengthSq() > 0) {
    const k = Math.min(1, dt * 2);
    const before = Math.hypot(vx, vz);
    player.vel.x += (_wish.x - vx) * k;
    player.vel.z += (_wish.z - vz) * k;
    const limit = Math.max(before, WALK_SPEED); // steering never adds speed
    const now = Math.hypot(player.vel.x, player.vel.z);
    if (now > limit) {
      player.vel.x *= limit / now;
      player.vel.z *= limit / now;
    }
  }
  applyGravity(player.vel, dt);

  player.onGround = moveBody(player.center, PLAYER_HALF, player.vel, dt, world.solidsNow(true), portals.holes(player.center));
  const rot = portals.teleport(player, PLAYER_HALF);
  if (rot) {
    const look = lookDir().applyMatrix3(rot);
    player.yaw = Math.atan2(-look.x, -look.z);
    player.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)), -1.2, 1.2);
    player.onGround = false;
  }

  // Hazards and the exit.
  const c = player.center;
  if (world.goo.some((g) => insideBox(c, g))) return die(LINES.goo);
  if (c.y < world.data.room.min[1] - 20) return die(LINES.fall);
  if (world.fizzlers.some((f) => overlaps(c, PLAYER_HALF, f))) {
    if (portals.clearUnfixed()) sayOnce(LINES.fizzle);
    if (player.held) {
      world.respawnCube(player.held);
      player.held = null;
      sayOnce(LINES.cubeFizzle);
    }
  }
  if (insideBox(c, world.exit)) chamberComplete();
}

function updateHeldCube(dt) {
  const c = player.held;
  if (!c) return;
  const target = eyePos().addScaledVector(lookDir(), HOLD_DISTANCE);
  c.vel.subVectors(target, c.center).multiplyScalar(1 / Math.max(dt, 1e-3)).clampLength(0, 12);
  c.center.lerp(target, Math.min(1, dt * 20));
  if (c.center.distanceTo(target) > 2.5) toggleHold();
}

function updateJim(dt, t) {
  const forward = new V3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new V3(-forward.z, 0, forward.x);
  const target = eyePos().addScaledVector(forward, 3.2).addScaledVector(right, -1.9);
  target.y -= 0.35 - (reducedMotion ? 0 : Math.sin(t * 2.2) * 0.06);
  if (jimMood.time > 0) {
    jimMood.time -= dt;
    if (jimMood.kind === "sad") target.y -= 0.35;
    if (jimMood.kind === "happy" && !reducedMotion) target.y += Math.abs(Math.sin(t * 10)) * 0.25;
    if (jimMood.time <= 0) jimMood.kind = "idle";
  }
  if (jim.position.distanceTo(target) > 8) jim.position.copy(target); // catch up after portals
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
  resetChamber();
}

async function loadChamber(i) {
  state.mode = "loading";
  const data = await api(`/levels/${encodeURIComponent(state.levels[i])}`);
  loadWorld(data, i + 1, state.levels.length);
  state.index = i;
  $("chamber-num").textContent = `Test chamber ${String(i + 1).padStart(2, "0")} / ${String(state.levels.length).padStart(2, "0")}`;
  $("chamber-name").textContent = data.name;
  jim.position.copy(eyePos());
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
    resetPlayer();
    state.mode = "playing";
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
    if (!DEV) canvas.requestPointerLock();
  } catch (err) {
    $("start-error").textContent = err.message;
    state.mode = "menu";
  } finally {
    btn.disabled = false;
  }
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function endRun() {
  state.mode = "ended";
  if (document.pointerLockElement) document.exitPointerLock();
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
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  portals.resize();
}
window.addEventListener("resize", resize);
resize();

// ---------- main loop ----------

const clock = new THREE.Clock();
function frame(dt, t) {
  if (world.data) {
    if (active()) {
      updatePlayer(dt);
      if (state.mode === "playing") {
        updateHeldCube(dt);
        world.updateCubes(dt, portals, (c, why) => sayOnce(why === "goo" ? LINES.cubeGoo : LINES.cubeFizzle));
      }
    }
    if (state.mode === "playing") world.updateButtonsAndDoors(dt, [player]);
    for (const c of world.cubes) c.mesh.position.copy(c.center);
    updateJim(dt, t);
  }
  if (state.mode === "menu") player.yaw = Math.sin(t * 0.15) * 0.6;

  world.update(t);
  portals.update(t);

  if (beamLife > 0) {
    beamLife -= dt;
    beamMat.opacity = Math.max(0, beamLife / 0.12);
    if (beamLife <= 0) beam.visible = false;
  }
  recoil = Math.max(0, recoil - dt * 6);
  gun.position.z = -0.45 + recoil * 0.07;
  gun.rotation.x = recoil * 0.15;
  if (!reducedMotion) {
    // Breathing sway, plus a bob while walking on the ground.
    const walk = player.onGround ? Math.min(1, Math.hypot(player.vel.x, player.vel.z) / WALK_SPEED) : 0;
    gun.position.y = -0.24 + Math.sin(t * 2) * 0.005 - Math.abs(Math.sin(t * 9)) * 0.012 * walk;
    gun.position.x = 0.26 + Math.sin(t * 4.5) * 0.008 * walk;
  }

  if (state.mode === "playing" || state.mode === "loading") {
    $("timer").textContent = formatTime((performance.now() - state.startedAt) / 1000);
  }

  camera.position.copy(eyePos());
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
  portals.render(camera);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  frame(dt, clock.elapsedTime);
});

if (isTouchOnly) $("touch-note").hidden = false;
if (DEV) {
  // Developer console: try `fireraze.player`, `fireraze.shoot("blue")`, `fireraze.world.cubes`.
  // `fireraze.step(2)` runs the game for 2 seconds at 60 fps, even if the tab is in the background.
  let devTime = 0;
  const step = (seconds = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      devTime += 1 / 60;
      frame(1 / 60, devTime);
    }
    return { center: player.center.clone(), vel: player.vel.clone(), mode: state.mode };
  };
  window.fireraze = { ENGINE, THREE, world, portals, player, state, shoot, toggleHold, resetChamber, held, step };
  console.info(`${ENGINE.name} ${ENGINE.version} developer mode`);
}

// Show the first chamber behind the menu.
loadLeaderboard();
api("/levels").then(async ({ levels }) => {
  if (!levels.length || state.mode !== "menu") return;
  const data = await api(`/levels/${encodeURIComponent(levels[0].id)}`);
  if (state.mode === "menu") loadWorld(data, 1, levels.length);
}).catch((err) => { $("start-error").textContent = `The lab server isn't answering: ${err.message}`; });
