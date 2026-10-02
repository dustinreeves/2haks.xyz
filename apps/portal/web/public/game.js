// Portal Fan Lab: an unofficial Portal fan game, running on the Fire Raze engine.
// Test chambers come from the API (/api/levels). The API also keeps the run clock and the leaderboard.
import * as THREE from "./vendor/three-0.170.0.module.min.js";
import {
  applyGravity, castRay, CUBE_HALF, DevConsole, ENGINE, insideBox, moveBody, overlaps, physicsSettings, PortalSystem,
  DynamicResolution, PostFX, setupLighting, World,
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
const postfx = new PostFX(renderer, scene, camera);
const dynres = new DynamicResolution({
  onChange: (ratio) => {
    renderer.setPixelRatio(ratio);
    resize();
  },
});
camera.rotation.order = "YXZ";
scene.add(camera);

const world = new World(scene);
const portals = new PortalSystem(scene, renderer, { blue: BLUE, orange: ORANGE });
portals.onChange = updateCrosshair;

// ---------- the portal gun ----------

// Portal-gun-style model, built from our own shapes (no copied model): a big rounded white back
// shell, a dark neck with a glowing glass tube on top, a white front collar, and three long black
// claws around the emitter. Every glowing part takes the colour of the last portal. Forward is -z.
const gun = new THREE.Group();
const gunGlowMat = new THREE.MeshBasicMaterial({ color: BLUE });
const gunGlowParts = [gunGlowMat];
let gunGlow; // the emitter tip: beams start here
{
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f4, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.5, metalness: 0.4 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x6f777e, roughness: 0.35, metalness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.35 });
  const glow = () => {
    const m = new THREE.MeshBasicMaterial({ color: BLUE });
    gunGlowParts.push(m);
    return m;
  };
  const along = (mesh) => { mesh.rotation.x = Math.PI / 2; return mesh; }; // lathe/cylinder axis → z
  const lathe = (pts, mat) => along(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 40), mat));

  // Back shell: big, round and white (it rests against your arm).
  const back = lathe([[0, 0.26], [0.05, 0.255], [0.085, 0.235], [0.105, 0.19], [0.11, 0.12], [0.104, 0.05], [0.085, 0.0], [0.06, -0.02]], white);
  back.scale.set(1, 1, 0.85);
  gun.add(back);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.16), black); // underside handle
  grip.position.set(0, -0.09, 0.13);
  gun.add(grip);

  // Neck: dark and narrow, with ribs.
  const neck = along(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.1, 24), black));
  neck.position.z = -0.06;
  gun.add(neck);
  for (const z of [-0.03, -0.06, -0.09]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, 6, 24), grey);
    rib.position.z = z;
    gun.add(rib);
  }

  // Glass tube on top, with the glowing core inside, held by two brackets.
  const tube = along(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 20), glass));
  tube.position.set(0, 0.085, -0.02);
  const core = along(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.18, 12), glow()));
  core.position.copy(tube.position);
  gun.add(tube, core);
  for (const z of [-0.1, 0.06]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.04, 0.02), black);
    bracket.position.set(0, 0.07, z);
    gun.add(bracket);
  }

  // Front collar: white, narrowing towards the emitter.
  const collar = lathe([[0.062, -0.1], [0.075, -0.13], [0.072, -0.18], [0.058, -0.215]], white);
  gun.add(collar);

  // Emitter: dark ring with a glowing centre.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 10, 32), black);
  ring.position.z = -0.218;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), glow());
  lens.position.z = -0.214;
  lens.rotation.y = Math.PI; // face forward (-z)
  gun.add(ring, lens);

  // Three long black claws: out, forward, then curling in at the tips.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2; // one on top, two below
    const claw = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.1), black);
    base.position.z = -0.05;
    base.rotation.x = -0.22; // leans outwards
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.016, 0.07), black);
    tip.position.set(0, 0.018, -0.125);
    tip.rotation.x = 0.55; // curls back in
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), grey);
    knuckle.position.set(0, 0.024, -0.1);
    claw.add(base, tip, knuckle);
    claw.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.19);
    claw.rotation.z = a - Math.PI / 2;
    gun.add(claw);
  }

  gunGlow = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 12), gunGlowMat);
  gunGlow.position.z = -0.29;
  gun.add(gunGlow);
  const tipLight = new THREE.PointLight(BLUE, 0.4, 0.9);
  tipLight.position.z = -0.3;
  gun.add(tipLight);
  gun.userData.tipLight = tipLight;
  gun.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
}

function setGunColor(color) {
  for (const m of gunGlowParts) m.color.setHex(color).multiplyScalar(2.5); // brighter than white = glows (bloom)
  gun.userData.tipLight.color.setHex(color);
}
setGunColor(BLUE);
gun.position.set(0.26, -0.24, -0.56);
gun.scale.setScalar(0.85);
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
  beamMat.color.setHex(color).multiplyScalar(3);
  const from = gunGlow.getWorldPosition(new V3());
  const dir = new V3().subVectors(to, from);
  beam.position.copy(from).addScaledVector(dir, 0.5);
  beam.scale.set(1, Math.max(0.01, dir.length()), 1);
  beam.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
  beam.visible = true;
  beamLife = 0.12;
}

// ---------- Jim, the little core who never talks ----------

// Jim is a personality core hanging from an arm on a ceiling rail. He slides along the rail to
// follow you, his big eye watches you, and he blinks. Built from our own shapes. +z is his front.
const JIM_EYE = 0x3fa9ff;
const jimRig = new THREE.Group();   // carriage on the rail + arm + core
const jim = new THREE.Group();      // the core itself (turns to look at you)
const jimArm = new THREE.Group();
const jimEyeMat = new THREE.MeshBasicMaterial({ color: JIM_EYE });
const jimLids = [];
const jimEyeLight = new THREE.PointLight(JIM_EYE, 1.2, 2.5);
{
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xd8dde1, roughness: 0.35, metalness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.45, metalness: 0.7 });
  const greyMat = new THREE.MeshStandardMaterial({ color: 0x7c848b, roughness: 0.4, metalness: 0.8 });

  // Two shell halves with a dark gap between them, and a dark face plate around the eye.
  for (const side of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16, side > 0 ? 0 : Math.PI, Math.PI), shellMat);
    half.position.x = side * 0.006;
    jim.add(half);
  }
  jim.add(new THREE.Mesh(new THREE.SphereGeometry(0.212, 24, 16), darkMat));
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 32), darkMat);
  plate.rotation.x = Math.PI / 2;
  plate.position.z = 0.22;
  jim.add(plate);

  // The big eye: a glowing lens inside a grey ring.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 12, 32), greyMat);
  ring.position.z = 0.25;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.095, 32), jimEyeMat);
  lens.position.z = 0.247;
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), new THREE.MeshBasicMaterial({ color: 0x0c1a2a }));
  pupil.position.z = 0.249;
  jim.add(ring, lens, pupil);
  jimEyeLight.position.z = 0.4;
  jim.add(jimEyeLight);

  // Eyelids: two dark shutters that slide over the eye to blink (scale.y 0 = open, 1 = shut).
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, side * 0.1, 0.256);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.01), darkMat);
    lid.position.y = -side * 0.05;
    pivot.add(lid);
    pivot.scale.y = 0.001;
    jim.add(pivot);
    jimLids.push(pivot);
  }

  // Handles above and below (like a carrying handle on a ball).
  for (const side of [1, -1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 24, Math.PI), greyMat);
    handle.rotation.y = Math.PI / 2;
    if (side < 0) handle.rotation.z = Math.PI;
    handle.position.y = side * 0.2;
    jim.add(handle);
  }

  // Arm from the rail down to the top handle; its length changes per room (scaled in updateJim).
  const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12), darkMat);
  armMesh.position.y = -0.5;
  jimArm.add(armMesh);
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.45), greyMat);
  const clamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), darkMat);
  clamp.position.y = -0.1;
  jimRig.add(carriage, clamp, jimArm, jim);
  jimRig.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}
scene.add(jimRig);
const jimRail = { x: 0, y: 6, zMin: -5, zMax: 5, floor: 0 };

// A ceiling rail along the room, slightly to the left of where you start.
function buildJimRail(data) {
  const r = data.room;
  const x = THREE.MathUtils.clamp(data.start.pos[0] - 2.5, r.min[0] + 1, r.max[0] - 1);
  Object.assign(jimRail, { x, y: r.max[1] - 0.15, zMin: r.min[2] + 0.8, zMax: r.max[2] - 0.8, floor: r.min[1] });
  const len = r.max[2] - r.min[2];
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.4, metalness: 0.8 });
  const beamMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, len), mat);
  beamMesh.position.set(x, r.max[1] - 0.06, (r.min[2] + r.max[2]) / 2);
  const groove = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, len), new THREE.MeshBasicMaterial({ color: 0x0b0d10 }));
  groove.position.set(x, r.max[1] - 0.125, (r.min[2] + r.max[2]) / 2);
  beamMesh.castShadow = true;
  beamMesh.userData.ownMaterial = true;
  world.group.add(beamMesh, groove);
  jimRig.position.set(x, jimRail.y, THREE.MathUtils.clamp(data.start.pos[2] - 3, jimRail.zMin, jimRail.zMax));
}
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
  buildJimRail(data);
  stopSlowmo();
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
  if (e.code === "Backquote" || e.key === "`" || e.key === "~") {
    e.preventDefault();
    con.toggle();
    return;
  }
  if (con.isOpen || state.mode !== "playing") return;
  if (e.target instanceof Element && e.target.closest("input, textarea")) return;
  if (!e.repeat) con.key(e);
  if (KEYMAP[e.code]) { held.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === "Space") { held.add("jump"); e.preventDefault(); }
  if (e.code === "KeyE" && !e.repeat) toggleHold();
  if (e.code === "KeyR" && !e.repeat) { say(pick(LINES.restart)); resetChamber(); }
  if (e.code === "KeyH" && !e.repeat) say(world.data.hint || "No hints here. You've got this.");
  if (e.code === "KeyZ" && !e.repeat) startSlowmo();
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
  if (state.mode === "playing" && !DEV) $("pause").hidden = locked || con.isOpen;
  if (!locked) held.clear();
});
document.addEventListener("mousemove", (e) => {
  if (!locked || state.mode !== "playing") return;
  const look = LOOK_SPEED * (con.get("sensitivity") / 3);
  player.yaw -= e.movementX * look;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * look, -1.5, 1.5);
});
$("resume-btn").addEventListener("click", () => canvas.requestPointerLock());

// ---------- developer console (press `) ----------
// Commands and settings named after Portal's own console. Ones that only make sense with
// Half-Life 2's weapons, NPCs or maps (impulse 101, npc_create, give weapon_crowbar...) are left out.

const con = new DevConsole({ root: $("console"), log: $("console-log"), input: $("console-input") });
const flags = { noclip: false, god: false, cheated: false, gunUpgraded: false };
const fullbright = new THREE.AmbientLight(0xffffff, 2.5);
fullbright.visible = false;
scene.add(fullbright);

con.onToggle = (open) => {
  held.clear();
  if (open && document.pointerLockElement) document.exitPointerLock();
  if (!open && state.mode === "playing" && !DEV) canvas.requestPointerLock();
};

function markCheated() {
  if (flags.cheated || (state.mode !== "playing" && state.mode !== "loading")) return;
  flags.cheated = true;
  con.print("Cheats are on: this run can't go on the leaderboard.", "err");
}

con.vars.get("sv_cheats").onChange = (v) => { if (v === 1) markCheated(); };
con.cvar("sv_gravity", 600, {
  help: "World gravity in Source units (600 = normal; 1 unit = 1 inch).",
  cheat: true, min: -2000, max: 5000,
  onChange: (v) => { physicsSettings.gravity = v * 0.0254; },
});
con.cvar("host_timescale", 1, { help: "Game speed for everything (1 = normal).", cheat: true, min: 0.1, max: 10 });
con.cvar("fov_desired", 75, {
  help: "Field of view in degrees.", min: 60, max: 110,
  onChange: (v) => { camera.fov = v; camera.updateProjectionMatrix(); },
});
con.cvar("sensitivity", 3, { help: "Mouse sensitivity.", min: 0.1, max: 20 });
con.cvar("crosshair", 1, { help: "Show the crosshair.", min: 0, max: 1, onChange: (v) => { $("crosshair").hidden = !v; } });
con.cvar("r_drawviewmodel", 1, { help: "Show the portal gun in your hands.", min: 0, max: 1, onChange: (v) => { gun.visible = !!v; } });
con.cvar("cl_showfps", 0, { help: "Show frames per second.", min: 0, max: 1 });
con.cvar("cl_showpos", 0, { help: "Show your position, angle and speed.", min: 0, max: 1 });
con.cvar("mat_fullbright", 0, {
  help: "Light everything evenly, no shadows.", cheat: true, min: 0, max: 1,
  onChange: (v) => { fullbright.visible = !!v; },
});
con.cvar("sv_portal_placement_never_fail", 0, { help: "Portals stick to any surface.", cheat: true, min: 0, max: 1 });
con.cvar("mat_disable_bloom", 0, { help: "Turn off the glow around bright lights.", min: 0, max: 1, onChange: (v) => { postfx.bloomEnabled = !v; } });
con.cvar("mat_vignette", 1, { help: "Darker screen corners.", min: 0, max: 1, onChange: (v) => { postfx.vignette = v ? 0.35 : 0; } });
con.cvar("mat_postprocess_enable", 1, { help: "All picture effects (bloom, colour grade).", min: 0, max: 1, onChange: (v) => { postfx.enabled = !!v; } });
con.cvar("r_dynamic_resolution", 1, { help: "Lower sharpness automatically to keep the game smooth.", min: 0, max: 1, onChange: (v) => { dynres.enabled = !!v; if (!v) { renderer.setPixelRatio(dynres.max); resize(); } } });

con.command("noclip", () => {
  flags.noclip = !flags.noclip;
  player.vel.set(0, 0, 0);
  con.print(`noclip ${flags.noclip ? "ON" : "OFF"}`);
}, "Fly through walls (toggle).", { cheat: true });
con.command("god", () => {
  flags.god = !flags.god;
  con.print(`godmode ${flags.god ? "ON" : "OFF"}`);
}, "Goo and falling can't hurt you (toggle).", { cheat: true });
con.command("kill", () => { if (state.mode === "playing") die(LINES.goo); }, "Restart the chamber the hard way.");
con.command("restart", () => { if (state.mode === "playing") resetChamber(); }, "Restart this chamber.");
con.command("reload", () => { if (state.mode === "playing") resetChamber(); }, "Same as restart.");
con.command("portals_resetall", () => { portals.clearUnfixed(); }, "Remove the portals you shot.");
con.command("upgrade_portalgun", () => {
  flags.gunUpgraded = true;
  $("orange-help").hidden = false;
  con.print("Portal gun upgraded: orange portals unlocked.");
}, "Unlock orange portals in every chamber.", { cheat: true });
con.command("give", (args) => {
  if (args[0] === "weapon_portalgun") con.exec("upgrade_portalgun");
  else con.print(`give: "${args[0] || ""}" isn't in Portal Fan Lab. Try "give weapon_portalgun".`, "err");
}, "give weapon_portalgun", { cheat: true });
con.command("ent_create", (args) => {
  if (args[0] !== "prop_weighted_cube") {
    con.print("ent_create: only prop_weighted_cube is available here.", "err");
    return;
  }
  if (!world.data) return;
  world.addCube(eyePos().addScaledVector(lookDir(), 1.5));
}, "ent_create prop_weighted_cube: drop a cube in front of you.", { cheat: true });
con.command("maps", () => {
  api("/levels").then(({ levels }) => levels.forEach((lv) => con.print(`  ${lv.id}  (${lv.name})`)));
}, "List the test chambers.");
con.command("map", (args) => {
  const i = state.levels.indexOf(args[0]);
  if (state.mode !== "playing") con.print("Start testing first, then use map.", "err");
  else if (i < 0) con.print(`map: no chamber "${args[0] || ""}". Type "maps" to see them.`, "err");
  else {
    markCheated();
    loadChamber(i);
  }
}, "map <chamber id>: jump to a chamber.", { cheat: true });
con.command("hint", () => { if (world.data) say(world.data.hint || "No hints here."); }, "Ask for this chamber's hint.");
con.command("disconnect", () => {
  if (state.mode === "playing" || state.mode === "ended") {
    state.mode = "menu";
    if (document.pointerLockElement) document.exitPointerLock();
    ["hud", "end", "pause"].forEach((id) => { $(id).hidden = true; });
    $("start").hidden = false;
    con.close();
  }
}, "Leave to the main menu.");
con.command("quit", () => con.exec("disconnect"), "Leave to the main menu.");
con.command("version", () => con.print(`${ENGINE.name} ${ENGINE.version} | Portal Fan Lab | Three.js r${THREE.REVISION}`), "Engine version.");
con.print(`${ENGINE.name} ${ENGINE.version} console. Type "help" to start.`);

// ---------- shooting and carrying ----------

function shoot(color) {
  if (color === "orange" && world.data.gun !== "both" && !flags.gunUpgraded) {
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
  const anySurface = con.cheats && con.get("sv_portal_placement_never_fail") === 1;
  const box = anySurface ? { ...hit.box, type: "white", door: false } : hit.box;
  const spot = portals.fit(box, end, hit.normal, hit.axis, dir);
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
  r.classList.toggle("off", !!world.data && world.data.gun !== "both" && !flags.gunUpgraded && !portals.orange.placed);
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

// noclip: fly where you look, straight through walls. No gravity, no hazards.
function noclipMove(dt) {
  const dir = lookDir();
  const right = new V3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const move = new V3();
  if (held.has("forward")) move.add(dir);
  if (held.has("back")) move.sub(dir);
  if (held.has("right")) move.add(right);
  if (held.has("left")) move.sub(right);
  if (held.has("jump")) move.y += 1;
  if (move.lengthSq() > 0) player.center.addScaledVector(move.normalize(), WALK_SPEED * 2 * dt);
  player.vel.set(0, 0, 0);
  player.prev = {};
  if (insideBox(player.center, world.exit)) chamberComplete();
}

function updatePlayer(dt) {
  if (flags.noclip) return noclipMove(dt);
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
  if (!flags.god && world.goo.some((g) => insideBox(c, g))) return die(LINES.goo);
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

let blinkTimer = 3;
function updateJim(dt, t) {
  if (jimMood.time > 0) {
    jimMood.time -= dt;
    if (jimMood.time <= 0) jimMood.kind = "idle";
  }
  // Slide along the rail to stay a little ahead of you.
  const eye = eyePos();
  const ahead = -Math.cos(player.yaw) * 2.5;
  const z = THREE.MathUtils.clamp(eye.z + ahead, jimRail.zMin, jimRail.zMax);
  if (Math.abs(jimRig.position.z - z) > 12) jimRig.position.z = z; // after a long portal jump
  jimRig.position.set(jimRail.x, jimRail.y, THREE.MathUtils.lerp(jimRig.position.z, z, Math.min(1, dt * 2)));

  // Hang a bit above your eye level (the arm stretches to reach), but never too low.
  let hang = THREE.MathUtils.clamp(jimRail.y - (eye.y + 0.7), 1.0, jimRail.y - jimRail.floor - 1.4);
  if (jimMood.kind === "sad") hang += 0.3;
  if (jimMood.kind === "happy" && !reducedMotion) hang -= Math.abs(Math.sin(t * 8)) * 0.15;
  const corePos = jimRig.position.clone().setY(jimRail.y - hang);
  jim.position.set(0, -hang, 0);
  jimArm.scale.y = Math.max(0.01, hang - 0.2);

  // Look at you (in the rig's space), with a little wobble when happy.
  jim.lookAt(eye);
  if (!reducedMotion) {
    if (jimMood.kind === "happy") jim.rotateZ(Math.sin(t * 14) * 0.35);
    else jim.rotateZ(Math.sin(t * 1.3) * 0.06);
  }
  if (jimMood.kind === "sad") jim.rotateX(0.45);

  // Blink every few seconds; half-close the lids when sad.
  blinkTimer -= dt;
  if (blinkTimer < -0.15) blinkTimer = 2.5 + Math.random() * 3;
  const shut = blinkTimer < 0 ? 1 : jimMood.kind === "sad" ? 0.55 : 0.001;
  for (const lid of jimLids) lid.scale.y = THREE.MathUtils.lerp(lid.scale.y, shut, Math.min(1, dt * 25));
  jimEyeMat.color.setHex(jimMood.kind === "sad" ? 0x1c4d77 : JIM_EYE).multiplyScalar(jimMood.kind === "sad" ? 1 : 2.2);
  jimEyeLight.intensity = jimMood.kind === "sad" ? 0.4 : 1.2;
  return corePos;
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
    // Cheated runs are timed here only; the server's official clock skips them.
    const res = flags.cheated
      ? { finished: state.index + 1 >= state.levels.length, total_seconds: (performance.now() - state.startedAt) / 1000 }
      : await api(`/runs/${state.runId}/complete`, {
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
    Object.assign(flags, { noclip: false, god: false, gunUpgraded: false, cheated: con.cheats });
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
  stopSlowmo();
  if (document.pointerLockElement) document.exitPointerLock();
  $("hud").hidden = true;
  $("pause").hidden = true;
  $("final-time").textContent = formatTime(state.totalSeconds);
  $("final-detail").textContent = flags.cheated
    ? "You finished with cheats on, so this run can't go on the leaderboard. Jim saw everything."
    : `You finished all ${state.levels.length} test chambers. Jim is very proud. He didn't say so.`;
  $("name-form").hidden = flags.cheated;
  $("name-error").textContent = "";
  $("end").hidden = false;
  if (!flags.cheated) $("name").focus();
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
  postfx.resize();
}
window.addEventListener("resize", resize);
resize();

// ---------- main loop ----------

// Slow-mo (Z): the world runs at SLOW_SCALE speed for SLOW_SECONDS while you move normally.
const SLOW_SCALE = 1 / 3;
const SLOW_SECONDS = 6;
const SLOW_RECHARGE = 10;
const slowmo = { left: 0, recharge: 0 };
let worldTime = 0;

function startSlowmo() {
  if (slowmo.left > 0 || slowmo.recharge > 0) return;
  slowmo.left = SLOW_SECONDS;
}

function stopSlowmo() {
  slowmo.left = 0;
  slowmo.recharge = 0;
  updateSlowmoHud();
}

function updateSlowmo(dt) {
  if (slowmo.left > 0) {
    slowmo.left = Math.max(0, slowmo.left - dt);
    if (slowmo.left === 0) slowmo.recharge = SLOW_RECHARGE;
  } else if (slowmo.recharge > 0) {
    slowmo.recharge = Math.max(0, slowmo.recharge - dt);
  }
  updateSlowmoHud();
  return slowmo.left > 0 ? SLOW_SCALE : 1;
}

function updateSlowmoHud() {
  const on = slowmo.left > 0;
  document.body.classList.toggle("slowmo", on);
  const fill = on ? slowmo.left / SLOW_SECONDS : 1 - slowmo.recharge / SLOW_RECHARGE;
  $("slowmo-fill").style.transform = `scaleX(${fill})`;
  $("slowmo").classList.toggle("charging", !on && slowmo.recharge > 0);
  $("slowmo-label").textContent = on ? "Slow-mo" : slowmo.recharge > 0 ? "Recharging" : "Z: slow-mo ready";
}

const clock = new THREE.Clock();
let fps = 60;

function updateDevInfo() {
  const lines = [];
  if (con.get("cl_showfps")) lines.push(`fps: ${Math.round(fps)}`);
  if (con.get("cl_showpos")) {
    const e = eyePos();
    const deg = (r) => THREE.MathUtils.radToDeg(r).toFixed(1);
    lines.push(`pos: ${e.x.toFixed(2)} ${e.y.toFixed(2)} ${e.z.toFixed(2)}`);
    lines.push(`ang: ${deg(-player.pitch)} ${deg(player.yaw)} 0`);
    lines.push(`vel: ${player.vel.length().toFixed(2)} m/s`);
  }
  if (flags.noclip) lines.push("noclip");
  if (flags.god) lines.push("god");
  $("devinfo").textContent = lines.join("\n");
  $("devinfo").hidden = !lines.length;
}

function frame(realDt, t) {
  const dt = realDt * con.get("host_timescale");
  fps = fps * 0.95 + (1 / Math.max(realDt, 1e-3)) * 0.05;
  updateDevInfo();
  // You move at real speed; everything else uses worldDt.
  const scale = state.mode === "playing" ? updateSlowmo(dt) : 1;
  const worldDt = dt * scale;
  worldTime += worldDt;
  if (world.data) {
    if (active()) {
      updatePlayer(dt);
      if (state.mode === "playing") {
        updateHeldCube(dt);
        world.updateCubes(worldDt, portals, (c, why) => sayOnce(why === "goo" ? LINES.cubeGoo : LINES.cubeFizzle));
      }
    }
    if (state.mode === "playing") world.updateButtonsAndDoors(worldDt, [player]);
    for (const c of world.cubes) c.mesh.position.copy(c.center);
    updateJim(worldDt, worldTime);
  }
  if (state.mode === "menu") player.yaw = Math.sin(t * 0.15) * 0.6;

  world.update(worldTime);
  portals.update(worldTime);

  if (beamLife > 0) {
    beamLife -= dt;
    beamMat.opacity = Math.max(0, beamLife / 0.12);
    if (beamLife <= 0) beam.visible = false;
  }
  recoil = Math.max(0, recoil - dt * 6);
  gun.position.z = -0.56 + recoil * 0.07;
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
  postfx.render(scene, camera, dt);
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  dynres.tick(dt);
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
  window.fireraze = { ENGINE, THREE, world, portals, player, state, shoot, toggleHold, resetChamber, held, step, slowmo, startSlowmo, con, gun };
  console.info(`${ENGINE.name} ${ENGINE.version} developer mode`);
}

// Show the first chamber behind the menu.
loadLeaderboard();
api("/levels").then(async ({ levels }) => {
  if (!levels.length || state.mode !== "menu") return;
  const data = await api(`/levels/${encodeURIComponent(levels[0].id)}`);
  if (state.mode === "menu") loadWorld(data, 1, levels.length);
}).catch((err) => { $("start-error").textContent = `The lab server isn't answering: ${err.message}`; });
