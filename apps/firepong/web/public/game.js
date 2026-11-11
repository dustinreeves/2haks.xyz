// Fire Pong: the game on top of the Fire Raze engine (lighting, post-processing, controller).
// The rules live in pong.js; this file draws them, plays sounds and handles menus and input.
import * as THREE from "./vendor/three-0.170.0.module.min.js";
import { setupLighting } from "./fireraze/lighting.js";
import { DynamicResolution, PostFX } from "./fireraze/postfx.js";
import { BUTTON, GamepadInput } from "./fireraze/gamepad.js";
import {
  AI_LEVELS, BALL_R, MAGNET_HOLD, PADDLE, PORTAL_R, TABLE, aiInput, newGame, spawnItem, step,
} from "./pong.js";

const $ = (id) => document.getElementById(id);
const DEV = new URLSearchParams(location.search).has("dev");
const PLAYER_COLORS = [0x4cc9f0, 0xff8c1a];          // blue and orange, like portals
const PLAYER_CSS = ["#4cc9f0", "#ff8c1a"];

// ---------------------------------------------------------------- renderer, scene, camera

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070c);
scene.fog = new THREE.Fog(0x06070c, 30, 70);
setupLighting(renderer, scene, { exposure: 1.0, environment: 0.45 });

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 150);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0.3);
const PITCH = (58 * Math.PI) / 180;
const shake = { power: 0 };

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const distance = Math.max(17, 26 / aspect);       // wide enough for the whole table on any screen
  camera.aspect = aspect;
  camera.position.set(0, Math.sin(PITCH) * distance, Math.cos(PITCH) * distance).add(CAMERA_TARGET);
  camera.lookAt(CAMERA_TARGET);
  camera.updateProjectionMatrix();
}

const postfx = new PostFX(renderer, scene, camera, { bloom: 0.75, threshold: 1.0, radius: 0.6 });
postfx.aoEnabled = false;       // ambient occlusion is too slow for a game this simple
postfx.vignette = 0.45;

const applied = { w: 0, h: 0 };
function resize() {
  applied.w = window.innerWidth;
  applied.h = window.innerHeight;
  if (!applied.w || !applied.h) return;      // a hidden pane can report 0 x 0; wait for a real size
  renderer.setSize(applied.w, applied.h, false);
  postfx.resize();
  fitCamera();
}
const dynamicResolution = new DynamicResolution({
  onChange(ratio) {
    renderer.setPixelRatio(ratio);
    resize();
  },
});
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- the table

function tableTexture() {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, "#10162a");
  grad.addColorStop(1, "#0a0e1c");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "rgba(90,130,220,0.12)";
  g.lineWidth = 2;
  for (let x = 0; x <= c.width; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 0; y <= c.height; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  g.strokeStyle = "rgba(200,225,255,0.55)";
  g.lineWidth = 6;
  g.setLineDash([36, 30]);
  g.beginPath(); g.moveTo(c.width / 2, 20); g.lineTo(c.width / 2, c.height - 20); g.stroke();
  g.setLineDash([]);
  g.beginPath(); g.arc(c.width / 2, c.height / 2, 110, 0, Math.PI * 2); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const glow = (color, intensity) => new THREE.MeshStandardMaterial({
  color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
});

const HL = TABLE.halfLength;
const HW = TABLE.halfWidth;

// Everything on the table lives in this group, so tilting the board tilts it all together.
const board = new THREE.Group();
scene.add(board);
const MAX_TILT_ANGLE = (7 * Math.PI) / 180;

const base = new THREE.Mesh(
  new THREE.BoxGeometry(HL * 2 + 1.6, 0.6, HW * 2 + 1.6),
  new THREE.MeshStandardMaterial({ color: 0x1a1f30, roughness: 0.5, metalness: 0.7 }),
);
base.position.y = -0.31;
base.receiveShadow = true;
board.add(base);

const top = new THREE.Mesh(
  new THREE.PlaneGeometry(HL * 2, HW * 2),
  new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.35, metalness: 0.3 }),
);
top.rotation.x = -Math.PI / 2;
top.receiveShadow = true;
board.add(top);

// Glowing rails along the long sides and coloured goal strips at the ends.
for (const s of [-1, 1]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(HL * 2 + 0.8, 0.3, 0.3), glow(0x6ea8ff, 0.9));
  rail.position.set(0, 0.15, s * (HW + 0.15));
  board.add(rail);
  const goal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, HW * 2), glow(PLAYER_COLORS[s === -1 ? 0 : 1], 1.2));
  goal.position.set(s * (HL + 0.1), 0.1, 0);
  board.add(goal);
}

const keyLight = new THREE.SpotLight(0xdfe9ff, 1500, 0, 0.8, 0.8, 2);
keyLight.position.set(0, 15, 3);
keyLight.target.position.set(0, 0, 0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.03;
scene.add(keyLight, keyLight.target);

// ---------------------------------------------------------------- paddles, balls, items, portals, shields

const paddleMeshes = [0, 1].map((i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(PADDLE.halfThick * 2, 0.4, 2), glow(PLAYER_COLORS[i], 1.8));
  m.castShadow = true;
  m.position.y = 0.2;
  board.add(m);
  return m;
});

const ballMaterial = glow(0xffffff, 2.2);
ballMaterial.color.set(0xffffff);
const ballGeometry = new THREE.SphereGeometry(BALL_R, 24, 16);
const ballMeshes = [];
const ballLight = new THREE.PointLight(0xffffff, 2.5, 5, 2);
board.add(ballLight);

const shieldMeshes = [0, 1].map((i) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.7, HW * 2),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xb388ff, emissiveIntensity: 2.5,
      transparent: true, opacity: 0.8 }),
  );
  m.position.set(i === 0 ? -HL + 0.1 : HL - 0.1, 0.35, 0);
  m.visible = false;
  board.add(m);
  return m;
});

const portalMeshes = [0x2d7dff, 0xff8c1a].map((color) => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R, 0.09, 12, 40), glow(color, 3));
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_R - 0.05, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
  );
  g.add(ring, disc);
  g.rotation.x = -Math.PI / 2;
  g.position.y = 0.06;
  g.visible = false;
  board.add(g);
  return g;
});

function labelTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 96;
  const g = c.getContext("2d");
  g.font = "bold 52px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  g.strokeText(text, 192, 50);
  g.fillStyle = color;
  g.fillText(text, 192, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One material + label per power-up type, shared by every item of that type.
const itemLook = new Map();
const itemGeometry = new THREE.OctahedronGeometry(0.42);
const itemRingGeometry = new THREE.TorusGeometry(0.62, 0.04, 8, 32);
function lookFor(def) {
  if (!itemLook.has(def.id)) {
    const color = new THREE.Color(def.color);
    itemLook.set(def.id, {
      body: glow(color, 2.2),
      ring: glow(color, 3),
      label: new THREE.SpriteMaterial({ map: labelTexture(def.name, def.color), transparent: true, depthWrite: false }),
    });
  }
  return itemLook.get(def.id);
}
const itemMeshes = new Map();

function syncItems(game, time) {
  const seen = new Set();
  for (const item of game.items) {
    seen.add(item.id);
    let group = itemMeshes.get(item.id);
    if (!group) {
      const look = lookFor(item.def);
      group = new THREE.Group();
      const body = new THREE.Mesh(itemGeometry, look.body);
      body.castShadow = true;
      const ring = new THREE.Mesh(itemRingGeometry, look.ring);
      ring.rotation.x = Math.PI / 2;
      const label = new THREE.Sprite(look.label);
      label.scale.set(2.4, 0.6, 1);
      label.position.y = 1.15;
      group.add(body, ring, label);
      group.userData.body = body;
      board.add(group);
      itemMeshes.set(item.id, group);
    }
    group.position.set(item.x, 0.65 + Math.sin(time * 3 + item.id) * 0.1, item.z);
    group.userData.body.rotation.y = time * 1.8;
    // Blink in the last 3 seconds so players know it's about to vanish.
    group.visible = item.life > 3 || Math.floor(time * 6) % 2 === 0;
  }
  for (const [id, group] of itemMeshes) {
    if (!seen.has(id)) {
      board.remove(group);
      itemMeshes.delete(id);
    }
  }
}

// ---------------------------------------------------------------- sparks (trails, bursts)

class Sparks {
  constructor(max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max).fill(1);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    board.add(this.points);
  }

  emit(x, y, z, color, count = 12, speed = 3, life = 0.6) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * s, (Math.random() - 0.2) * s * 0.8, Math.sin(a) * s], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.span[i] = this.life[i];
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.span[i]);
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= 1 - Math.min(1, dt * 2.5);
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
        this.col[i * 3 + k] = this.base[i * 3 + k] * f;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
const sparks = new Sparks();

// ---------------------------------------------------------------- sound (made with Web Audio, no files)

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  tone(freq, length = 0.12, { type = "square", gain = 0.07, slide = 0, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + length);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  hit(speed) { this.tone(300 + speed * 18, 0.1); }
  wall() { this.tone(180, 0.07, { type: "triangle", gain: 0.06 }); }
  score(good) { this.tone(good ? 520 : 260, 0.35, { type: "sawtooth", slide: good ? 400 : -150, gain: 0.06 }); }
  pickup() { [520, 660, 880].forEach((f, i) => this.tone(f, 0.12, { type: "triangle", delay: i * 0.07 })); }
  portal() { this.tone(900, 0.2, { type: "sine", slide: -600, gain: 0.08 }); }
  shield() { this.tone(140, 0.25, { type: "sawtooth", slide: 300, gain: 0.07 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, { type: "triangle", delay: i * 0.12 })); }
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", delay: i * 0.15 })); }
}
const sfx = new Sfx();

// ---------------------------------------------------------------- state

const gamepad = new GamepadInput();
const keys = new Set();
const view = { mode: "ai", level: "normal", powerups: true };
let state = "menu";            // menu | playing | paused | over
let game = null;
let defs = [];                 // power-ups from the API
const aiMem = {};
const pointerTargets = [null, null];
const pointerSides = new Map();

// ---------------------------------------------------------------- HUD

const hud = {
  score: [$("score0"), $("score1")],
  name: [$("name0"), $("name1")],
  chips: [$("chips0"), $("chips1")],
  meter: [$("meter0"), $("meter1")],
  meterBox: [$("meterbox0"), $("meterbox1")],
  banner: $("banner"),
  toast: $("toast"),
};
const chipCache = [new Map(), new Map()];
let lastScores = "";

function showToast(text, color) {
  hud.toast.textContent = text;
  hud.toast.style.color = color;
  hud.toast.classList.remove("show");
  void hud.toast.offsetWidth;          // restart the animation
  hud.toast.classList.add("show");
}

function updateHud() {
  if (!game) return;
  const scores = game.score.join("-");
  if (scores !== lastScores) {
    lastScores = scores;
    hud.score[0].textContent = game.score[0];
    hud.score[1].textContent = game.score[1];
  }
  hud.banner.textContent = !game.over && game.balls.length === 0 ? "Get ready!" : "";
  for (let p = 0; p < 2; p++) {
    hud.meter[p].style.width = `${Math.round(game.meter[p] * 100)}%`;
    hud.meterBox[p].classList.toggle("locked", game.tiltLocked[p]);
  }

  // One chip per running power-up, on the side of the player it affects.
  for (let p = 0; p < 2; p++) {
    const wanted = new Map();
    for (const e of game.effects) if (e.player === p) wanted.set(e.effect, e);
    if (game.shields[p] > 0) wanted.set("shield", { name: "Shield", color: "#b388ff", left: game.shields[p] });
    if (game.magnet[p] > 0) {
      wanted.set("magnet", { name: `Magnet x${game.magnet[p]}`, color: "#e0e0e0", left: game.magnetLeft[p] });
    }
    const cache = chipCache[p];
    for (const [key, el] of cache) {
      if (!wanted.has(key)) { el.remove(); cache.delete(key); }
    }
    for (const [key, e] of wanted) {
      let el = cache.get(key);
      if (!el) {
        el = document.createElement("span");
        el.className = "chip";
        el.style.borderColor = e.color;
        el.style.color = e.color;
        hud.chips[p].appendChild(el);
        cache.set(key, el);
      }
      const text = `${e.name} ${Math.ceil(e.left)}s`;
      if (el.textContent !== text) el.textContent = text;
    }
  }
}

// ---------------------------------------------------------------- drawing the game

const tint = new THREE.Color();
function syncScene(time, dt) {
  if (!game) {
    for (const m of ballMeshes) m.visible = false;
    ballLight.visible = false;
    board.rotation.set(0, 0, 0);
    return;
  }
  for (let p = 0; p < 2; p++) {
    const pad = game.paddles[p];
    const mesh = paddleMeshes[p];
    mesh.position.set(pad.x, 0.2, pad.z);
    mesh.scale.z = pad.half / PADDLE.baseHalf;
    const magnet = game.magnet[p] > 0;
    mesh.material.emissive.set(magnet ? 0xf2f2f2 : PLAYER_COLORS[p]);
    mesh.material.emissiveIntensity = magnet ? 2.4 : 1.8;
  }

  const fire = game.effects.some((e) => e.effect === "fireball");
  const slow = game.effects.some((e) => e.effect === "slow_mo");
  tint.set(fire ? 0xff7a1a : slow ? 0x7fd8ff : 0xffffff);
  ballMaterial.emissive.copy(tint);
  while (ballMeshes.length < game.balls.length) {
    const m = new THREE.Mesh(ballGeometry, ballMaterial);
    m.castShadow = true;
    board.add(m);
    ballMeshes.push(m);
  }
  ballMeshes.forEach((m, i) => {
    const ball = game.balls[i];
    m.visible = Boolean(ball);
    if (!ball) return;
    m.position.set(ball.x, BALL_R, ball.z);
    // A little trail behind every ball, bigger and fiery for a fireball.
    if (state === "playing") {
      sparks.emit(ball.x, 0.2, ball.z, fire ? 0xff7a1a : slow ? 0x7fd8ff : 0xaaccff, fire ? 3 : 1, fire ? 1.6 : 0.5,
        fire ? 0.5 : 0.35);
    }
  });
  const main = game.balls[0];
  ballLight.visible = Boolean(main);
  if (main) {
    ballLight.position.set(main.x, 1.2, main.z);
    ballLight.color.copy(tint);
  }

  for (let p = 0; p < 2; p++) {
    const left = game.shields[p];
    shieldMeshes[p].visible = left > 0 && (left > 3 || Math.floor(time * 8) % 2 === 0);
  }
  const portals = game.portals;
  portalMeshes.forEach((m, i) => {
    m.visible = Boolean(portals);
    if (!portals) return;
    const at = i === 0 ? portals.a : portals.b;
    m.position.set(at.x, 0.06, at.z);
    m.scale.setScalar(portals.left > 2 ? 1 + Math.sin(time * 6) * 0.05 : 0.7 + Math.sin(time * 20) * 0.1);
  });
  syncItems(game, time);

  // Tilt: the side the ball is rolling towards dips down (positive x / z = right / towards you).
  board.rotation.z = -game.tilt.x * MAX_TILT_ANGLE;
  board.rotation.x = game.tilt.z * MAX_TILT_ANGLE;

  shake.power = Math.max(0, shake.power - dt * 2.2);
  const s = shake.power * 0.25;
  fitCamera();
  if (s > 0.001) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
}

// ---------------------------------------------------------------- game events

function handleEvents() {
  const humanSide = view.mode === "ai" ? 0 : null;
  for (const ev of game.events) {
    switch (ev.type) {
      case "hit":
        sfx.hit(ev.speed);
        sparks.emit(ev.x, 0.3, ev.z, PLAYER_COLORS[ev.player], 14, 3.5, 0.5);
        shake.power = Math.min(1, shake.power + 0.15);
        if (ev.player === humanSide) gamepad.rumble(0.3, 80);
        break;
      case "wall":
        sfx.wall();
        sparks.emit(ev.x, 0.3, ev.z, 0x6ea8ff, 5, 2, 0.35);
        break;
      case "catch":
        sfx.shield();
        sparks.emit(ev.x, 0.3, ev.z, 0xffffff, 16, 3, 0.6);
        break;
      case "release":
        sfx.hit(14);
        break;
      case "portal":
        sfx.portal();
        sparks.emit(ev.from.x, 0.3, ev.from.z, 0x2d7dff, 14, 3, 0.5);
        sparks.emit(ev.x, 0.3, ev.z, 0xff8c1a, 14, 3, 0.5);
        break;
      case "shield":
        sfx.shield();
        sparks.emit(ev.x, 0.3, ev.z, 0xb388ff, 24, 4, 0.7);
        shake.power = Math.min(1, shake.power + 0.4);
        break;
      case "pickup": {
        sfx.pickup();
        sparks.emit(ev.x, 0.6, ev.z, ev.def.color, 30, 5, 0.9);
        const who = playerLabel(ev.player);
        showToast(`${who}: ${ev.def.name}!`, PLAYER_CSS[ev.player]);
        break;
      }
      case "bonus-lost":
        sparks.emit(ev.x, 0.3, ev.z, 0xf9c80e, 10, 2.5, 0.4);
        break;
      case "score": {
        const good = humanSide === null || ev.player === humanSide;
        sfx.score(good);
        sparks.emit(ev.x, 0.4, ev.z, PLAYER_COLORS[ev.player], 60, 7, 1.1);
        shake.power = 1;
        if (good) gamepad.rumble(0.7, 220);
        showToast(`Point for ${playerLabel(ev.player)}!`, PLAYER_CSS[ev.player]);
        break;
      }
      case "over":
        if (humanSide === null || ev.winner === humanSide) sfx.win(); else sfx.lose();
        state = "over";
        setTimeout(showEnd, 1300);
        break;
      default:
        break;
    }
  }
  game.events.length = 0;
}

function playerLabel(p) {
  if (view.mode === "ai") return p === 0 ? "You" : "Computer";
  return p === 0 ? "Player 1" : "Player 2";
}

// ---------------------------------------------------------------- input

function axis(neg, pos) {
  return (pos.some((c) => keys.has(c)) ? 1 : 0) - (neg.some((c) => keys.has(c)) ? 1 : 0);
}

function readInput() {
  gamepad.poll();
  const input = { move: [0, 0], release: [false, false], tilt: [[0, 0], [0, 0]] };
  if (view.mode === "ai") {
    input.move[0] = axis(["KeyW"], ["KeyS"]);
    input.release[0] = keys.has("Space") || keys.has("Enter");
  } else {
    input.move[0] = axis(["KeyW"], ["KeyS"]);
    input.move[1] = axis(["KeyI"], ["KeyK"]);
    input.release[0] = keys.has("Space");
    input.release[1] = keys.has("Enter");
  }
  // Everybody can tilt the board. Against the computer the arrows and A / D / Q / E all tilt for you.
  // With two players: Player 1 A / D (left / right) and Q / E (up / down); Player 2 J / L and U / O, or the arrows.
  if (view.mode === "ai") {
    input.tilt[0] = [axis(["ArrowLeft", "KeyA"], ["ArrowRight", "KeyD"]), axis(["ArrowUp", "KeyQ"], ["ArrowDown", "KeyE"])];
  } else {
    input.tilt[0] = [axis(["KeyA"], ["KeyD"]), axis(["KeyQ"], ["KeyE"])];
    input.tilt[1] = [axis(["KeyJ", "ArrowLeft"], ["KeyL", "ArrowRight"]), axis(["KeyU", "ArrowUp"], ["KeyO", "ArrowDown"])];
  }
  // On-screen tilt buttons (phones and tablets).
  for (let p = 0; p < 2; p++) {
    if (input.tilt[p][0] === 0 && input.tilt[p][1] === 0) input.tilt[p] = [touchTilt[p][0], touchTilt[p][1]];
  }
  if (gamepad.connected) {
    const stick = gamepad.move.y;
    const dpad = (gamepad.down.has(BUTTON.DOWN) ? 1 : 0) - (gamepad.down.has(BUTTON.UP) ? 1 : 0);
    if (input.move[0] === 0) input.move[0] = dpad || stick;
    if (gamepad.down.has(BUTTON.CROSS) || gamepad.down.has(BUTTON.R1) || gamepad.down.has(BUTTON.R2)) {
      input.release[0] = true;
    }
    // The right stick tilts the board.
    if (input.tilt[0][0] === 0 && input.tilt[0][1] === 0) input.tilt[0] = [gamepad.look.x, gamepad.look.y];
    if (gamepad.pressed.has(BUTTON.OPTIONS)) togglePause();
  }
  for (let side = 0; side < 2; side++) {
    if (pointerTargets[side] !== null && input.move[side] === 0) {
      input.move[side] = Math.max(-1, Math.min(1, (pointerTargets[side] - game.paddles[side].z) / 0.4));
    }
  }
  return input;
}

const raycaster = new THREE.Raycaster();
const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
function screenToZ(e) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(tablePlane, hitPoint) ? hitPoint.z : null;
}

function pointerSide(e) {
  return view.mode === "local" && e.clientX > window.innerWidth / 2 ? 1 : 0;
}

canvas.addEventListener("pointerdown", (e) => {
  if (state !== "playing") return;
  const side = pointerSide(e);
  pointerSides.set(e.pointerId, side);
  canvas.setPointerCapture(e.pointerId);
  pointerTargets[side] = screenToZ(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (state !== "playing" || !pointerSides.has(e.pointerId)) return;
  pointerTargets[pointerSides.get(e.pointerId)] = screenToZ(e);
});
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => {
    if (!pointerSides.has(e.pointerId)) return;
    pointerTargets[pointerSides.get(e.pointerId)] = null;
    pointerSides.delete(e.pointerId);
  });
}

const GAME_KEYS = new Set([
  "KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE", "KeyI", "KeyK", "KeyJ", "KeyL", "KeyU", "KeyO",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter",
]);

// On-screen tilt buttons: each one holds a direction while it is pressed.
const touchTilt = [[0, 0], [0, 0]];
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
for (const button of document.querySelectorAll("#tiltpads button")) {
  const p = Number(button.dataset.p);
  const dir = [Number(button.dataset.dx), Number(button.dataset.dz)];
  const press = (e) => {
    e.preventDefault();
    try {
      button.setPointerCapture(e.pointerId);     // keep getting events if the finger slides off the button
    } catch {
      // not fatal: the button still works while the finger stays on it
    }
    touchTilt[p] = dir;
    button.classList.add("down");
  };
  const release = () => {
    if (touchTilt[p] === dir) touchTilt[p] = [0, 0];
    button.classList.remove("down");
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;      // typing a nickname
  if (e.code === "KeyM") { sfx.muted = !sfx.muted; showToast(sfx.muted ? "Sound off" : "Sound on", "#ffffff"); return; }
  if (e.code === "Escape" || e.code === "KeyP") { togglePause(); return; }
  if (state === "playing" && GAME_KEYS.has(e.code)) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); if (state === "playing") pause(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "playing") pause(); });

// ---------------------------------------------------------------- panels and flow

const panels = { start: $("start"), pause: $("pause"), end: $("end") };
function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
  $("hud").hidden = name === "start";
}

function pause() {
  if (state !== "playing") return;
  state = "paused";
  showPanel("pause");
}

function resume() {
  if (state !== "paused") return;
  state = "playing";
  showPanel(null);
  $("hud").hidden = false;
  sfx.unlock();
}

function togglePause() {
  if (state === "playing") pause();
  else if (state === "paused") resume();
}

function startMatch() {
  sfx.unlock();
  game = newGame({ defs, powerups: view.powerups });
  for (const key of Object.keys(aiMem)) delete aiMem[key];
  pointerTargets.fill(null);
  pointerSides.clear();
  for (const cache of chipCache) { for (const el of cache.values()) el.remove(); cache.clear(); }
  lastScores = "";
  hud.name[0].textContent = view.mode === "ai" ? "YOU" : "PLAYER 1";
  hud.name[1].textContent = view.mode === "ai" ? "COMPUTER" : "PLAYER 2";
  hud.toast.classList.remove("show");
  state = "playing";
  showPanel(null);
  $("hud").hidden = false;
  $("hint").textContent = view.mode === "ai"
    ? "W / S move · ← ↑ ↓ → (or A D Q E) tilt the board · Space lets go of the magnet · P pause · M sound"
    : "P1: W/S move, A/D/Q/E tilt, Space · P2: I/K move, J/L/U/O (or arrows) tilt, Enter · P pause";
  touchTilt[0] = [0, 0];
  touchTilt[1] = [0, 0];
  $("tiltpads").hidden = !coarsePointer;
  $("pad1").hidden = view.mode !== "local";
  document.activeElement?.blur();
}

function showEnd() {
  if (!game || !game.over) return;
  const won = view.mode === "ai" ? game.winner === 0 : true;
  $("end-title").textContent = view.mode === "ai" ? (won ? "You win!" : "The computer wins") : `${playerLabel(game.winner)} wins!`;
  $("end-title").style.color = PLAYER_CSS[game.winner];
  $("end-score").textContent = `${game.score[0]} - ${game.score[1]}  ·  ${formatTime(game.t)}`;
  $("name-form").hidden = !(view.mode === "ai" && won);
  $("name-error").textContent = "";
  $("name-form").querySelector("button").disabled = false;
  showPanel("end");
  state = "over";
  loadLeaderboard();
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, "0")}`;
}

async function loadLeaderboard() {
  const lists = [$("leaderboard"), $("end-leaderboard")];
  try {
    const res = await fetch("api/leaderboard");
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()).leaderboard;
    for (const list of lists) {
      list.replaceChildren();
      if (rows.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No wins yet. Be the first!";
        list.appendChild(li);
      }
      for (const r of rows) {
        const li = document.createElement("li");
        li.textContent = `${r.name} · ${r.score} · ${r.difficulty} · ${r.seconds}s${r.powerups ? "" : " · no power-ups"}`;
        list.appendChild(li);
      }
    }
  } catch {
    for (const list of lists) {
      list.replaceChildren();
      const li = document.createElement("li");
      li.textContent = "Can't load the leaderboard right now.";
      list.appendChild(li);
    }
  }
}

async function loadPowerups() {
  const status = $("powerup-status");
  try {
    const res = await fetch("api/powerups");
    if (!res.ok) throw new Error(String(res.status));
    defs = (await res.json()).powerups;
    const list = $("powerup-list");
    list.replaceChildren();
    for (const d of defs) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = d.name;
      name.style.color = d.color;
      li.append(name, ` ${d.description}`);
      list.appendChild(li);
    }
    status.textContent = "";
  } catch {
    defs = [];
    status.textContent = "Can't reach the power-up list, so this match will be plain Pong.";
  }
}

$("play-ai").addEventListener("click", () => { view.mode = "ai"; startMatch(); });
$("play-local").addEventListener("click", () => { view.mode = "local"; startMatch(); });
$("level").addEventListener("change", (e) => { view.level = e.target.value; });
$("powerups-on").addEventListener("change", (e) => { view.powerups = e.target.checked; });
$("resume-btn").addEventListener("click", resume);
$("menu-btn").addEventListener("click", toMenu);
$("again-btn").addEventListener("click", startMatch);
$("end-menu-btn").addEventListener("click", toMenu);

function toMenu() {
  state = "menu";
  game = null;
  showPanel("start");
  loadLeaderboard();
}

$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  const error = $("name-error");
  button.disabled = true;
  error.textContent = "";
  try {
    const res = await fetch("api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("name").value.trim(),
        difficulty: view.level,
        player_score: game.score[0],
        ai_score: game.score[1],
        seconds: Math.round(game.t * 10) / 10,
        powerups: game.powerupsOn,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = Array.isArray(body.detail) ? "Please use 1-12 letters, numbers, spaces, - or _." : body.detail;
      throw new Error(detail || `error ${res.status}`);
    }
    $("name-form").hidden = true;
    showToast("Saved!", "#3ddc84");
    loadLeaderboard();
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});

// ---------------------------------------------------------------- the loop

function simulate(dt) {
  if (!game || state !== "playing") return;
  const input = readInput();
  if (view.mode === "ai") {
    const ai = aiInput(game, 1, view.level, aiMem, dt);
    input.move[1] = ai.move;
    input.release[1] = ai.release;
    input.tilt[1] = ai.tilt;
  }
  step(game, dt, input);
  handleEvents();
  updateHud();
}

let last = performance.now();
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (window.innerWidth !== applied.w || window.innerHeight !== applied.h) resize();
  if (!applied.w || !applied.h) {
    requestAnimationFrame(frame);
    return;
  }
  if (state === "paused") {
    gamepad.poll();
    if (gamepad.pressed.has(BUTTON.OPTIONS)) resume();
  }
  simulate(real);
  sparks.update(real);
  syncScene(now / 1000, real);
  postfx.render(scene, camera, real);
  dynamicResolution.tick(real);
  requestAnimationFrame(frame);
}

loadPowerups();
loadLeaderboard();
showPanel("start");
requestAnimationFrame(frame);

if (DEV) {
  // Developer mode (?dev): poke at the game from the browser console without waiting in real time.
  window.firepong = {
    get game() { return game; },
    view,
    start(mode = "ai", options = {}) { Object.assign(view, { mode }, options); startMatch(); },
    step(seconds, frameLength = 1 / 60) {
      for (let t = 0; t < seconds; t += frameLength) simulate(frameLength);
      sparks.update(0);
    },
    spawn(id) { spawnItem(game, defs.find((d) => d.id === id)); },
    aiLevels: AI_LEVELS,
    magnetHold: MAGNET_HOLD,
  };
}
