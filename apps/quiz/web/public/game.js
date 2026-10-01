// Portal Quiz: walk through the portal with the right answer.
// The API (/api/*) keeps the answers; this file only draws the world and asks the API.
import * as THREE from "./vendor/three-0.170.0.module.min.js";

const LETTERS = ["A", "B", "C", "D"];
const PORTAL_COLORS = [0x7cf6ff, 0xffd166, 0xc38bff, 0x5dff9d];
const PORTAL_X = [-4.5, -1.5, 1.5, 4.5];
const PORTAL_Z = -8;
const PORTAL_RADIUS = 1.15;
const EYE_HEIGHT = 1.6;
const START = new THREE.Vector3(0, EYE_HEIGHT, 5);
const ROOM = { minX: -9, maxX: 9, maxZ: 9 };
const WALK_SPEED = 4.5;   // metres per second
const TURN_SPEED = 2.0;   // radians per second
const BASE_FOV = 70;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);

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

// ---------- 3D world ----------

const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0720);
scene.fog = new THREE.Fog(0x0b0720, 12, 34);

const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100);
camera.rotation.order = "YXZ";

scene.add(new THREE.HemisphereLight(0xbfb8ff, 0x1a1040, 1.2));
const glow = new THREE.PointLight(0x7cf6ff, 30, 20);
glow.position.set(0, 4, PORTAL_Z + 2);
scene.add(glow);

// Floor with a glowing grid.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 22),
  new THREE.MeshStandardMaterial({ color: 0x1a1240, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.z = 0;
scene.add(floor);
const grid = new THREE.GridHelper(20, 20, 0x7cf6ff, 0x3a2d7a);
grid.position.set(0, 0.01, 0);
grid.material.transparent = true;
grid.material.opacity = 0.45;
scene.add(grid);

// Walls (left, right, back behind the portals).
const wallMat = new THREE.MeshStandardMaterial({ color: 0x241a55, roughness: 0.8 });
function wall(w, h, x, z, rotY) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
  m.position.set(x, h / 2, z);
  m.rotation.y = rotY;
  scene.add(m);
}
wall(22, 6, -10, 0, Math.PI / 2);
wall(22, 6, 10, 0, -Math.PI / 2);
wall(20, 6, 0, -11, 0);
wall(20, 6, 0, 11, Math.PI);

// Floating stars for atmosphere.
{
  const pts = new Float32Array(600 * 3);
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = (Math.random() - 0.5) * 19;
    pts[i + 1] = 0.5 + Math.random() * 5.5;
    pts[i + 2] = (Math.random() - 0.5) * 21;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.7 })));
}

// A swirling disc shader for the inside of each portal.
const swirlVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const swirlFragment = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uDim;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float swirl = sin(a * 4.0 + r * 10.0 - uTime * 3.0) * 0.5 + 0.5;
    float edge = smoothstep(1.0, 0.75, r);
    vec3 col = mix(uColor * 0.35, uColor * 1.4, swirl * (1.0 - r * 0.5));
    col = mix(col, vec3(0.25), uDim);
    gl_FragColor = vec4(col, edge * 0.92);
  }
`;

function makeLabelTexture(letter, text, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(18, 12, 40, 0.85)";
  g.beginPath();
  g.roundRect(4, 4, 504, 184, 28);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  g.stroke();

  g.fillStyle = g.strokeStyle;
  g.font = "bold 92px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, 70, 98);

  // Fit the answer into at most 2 lines, shrinking the font if needed.
  g.fillStyle = "#f4f1ff";
  g.textAlign = "left";
  const maxW = 360;
  let size = 52;
  let lines;
  do {
    g.font = `bold ${size}px system-ui, sans-serif`;
    lines = wrap(g, text, maxW);
    size -= 4;
  } while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > maxW)) && size > 18);
  const lh = size + 10;
  lines.forEach((l, i) => g.fillText(l, 130, 96 + (i - (lines.length - 1) / 2) * lh));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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

const portals = PORTAL_X.map((x, i) => {
  const group = new THREE.Group();
  group.position.set(x, EYE_HEIGHT, PORTAL_Z);

  const ringMat = new THREE.MeshStandardMaterial({
    color: PORTAL_COLORS[i], emissive: PORTAL_COLORS[i], emissiveIntensity: 1.2, roughness: 0.3,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_RADIUS, 0.12, 16, 64), ringMat);
  group.add(ring);

  const discMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(PORTAL_COLORS[i]) }, uDim: { value: 0 } },
    vertexShader: swirlVertex,
    fragmentShader: swirlFragment,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PORTAL_RADIUS, 48), discMat);
  group.add(disc);

  const labelMat = new THREE.MeshBasicMaterial({ transparent: true });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.975), labelMat);
  label.position.set(0, PORTAL_RADIUS + 0.8, 0);
  group.add(label);

  scene.add(group);
  return { group, ring, ringMat, discMat, labelMat, color: PORTAL_COLORS[i], closed: false };
});

function setPortalLabels(choices) {
  portals.forEach((p, i) => {
    if (p.labelMat.map) p.labelMat.map.dispose();
    p.labelMat.map = makeLabelTexture(LETTERS[i], choices[i], p.color);
    p.labelMat.needsUpdate = true;
    p.closed = false;
    p.ringMat.color.setHex(p.color);
    p.ringMat.emissive.setHex(p.color);
    p.discMat.uniforms.uDim.value = 0;
  });
}

function closePortal(i) {
  const p = portals[i];
  p.closed = true;
  p.ringMat.color.setHex(0xff5d7a);
  p.ringMat.emissive.setHex(0xff5d7a);
  p.discMat.uniforms.uDim.value = 0.85;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Narrow screens (phones held upright) see more by widening the view.
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
  if (state.mode !== "playing" || e.target.closest("input, select, textarea")) return;
  if (KEYMAP[e.code]) {
    held.add(KEYMAP[e.code]);
    e.preventDefault();
  }
  const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
  if (n >= 0) choose(n);
});
window.addEventListener("keyup", (e) => { if (KEYMAP[e.code]) held.delete(KEYMAP[e.code]); });
window.addEventListener("blur", () => held.clear());

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  player.yaw -= (e.clientX - drag.x) * 0.005;
  player.pitch = THREE.MathUtils.clamp(player.pitch - (e.clientY - drag.y) * 0.004, -0.9, 0.9);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
const endDrag = () => { drag = null; };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// On-screen arrows for phones and tablets.
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
  player.pos.z = Math.min(player.pos.z, ROOM.maxZ);

  // Walking into the plane of the portals: either you went through one, or you hit the wall.
  if (player.pos.z < PORTAL_Z + 0.3) {
    const hit = PORTAL_X.findIndex((x) => Math.abs(player.pos.x - x) < PORTAL_RADIUS - 0.15);
    if (hit >= 0 && !portals[hit].closed && state.mode === "playing" && !state.busy) {
      choose(hit);
    }
    player.pos.z = PORTAL_Z + 0.3;
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
  hue: 0,
};

function showRound() {
  const r = state.rounds[state.round];
  $("round-info").textContent = `Question ${state.round + 1} of ${state.rounds.length} · ${r.category}`;
  $("question").textContent = r.question;
  const list = $("choice-list");
  list.replaceChildren(...r.choices.map((c, i) => {
    const li = document.createElement("li");
    li.textContent = `Portal ${LETTERS[i]} (key ${i + 1}): ${c}`;
    return li;
  }));
  setPortalLabels(r.choices);
  resetPlayer();
  // Each room gets a new colour, so it feels like you travelled somewhere.
  state.hue = (state.hue + 0.13) % 1;
  const bg = new THREE.Color().setHSL(state.hue, 0.55, 0.06);
  scene.background = bg;
  scene.fog.color = bg;
  wallMat.color.setHSL(state.hue, 0.45, 0.2);
  glow.color.setHSL(state.hue, 0.9, 0.7);
}

let toastTimer;
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ""; }, 1300);
}

let warp = 0; // seconds left of the "whoosh" effect after a right answer
const WARP_TIME = 0.6;

async function choose(i) {
  if (state.mode !== "playing" || state.busy || portals[i].closed) return;
  state.busy = true;
  try {
    const res = await api(`/games/${state.gameId}/answer`, {
      method: "POST",
      body: JSON.stringify({ round: state.round, choice: i }),
    });
    state.score = res.score;
    $("score").textContent = String(res.score);
    if (res.correct) {
      toast(`Correct! +${res.points}`, "good");
      state.correctFirst = res.correct_first_try;
      if (!reducedMotion) warp = WARP_TIME;
      await new Promise((r) => setTimeout(r, reducedMotion ? 300 : WARP_TIME * 1000));
      if (res.finished) {
        endGame();
      } else {
        state.round += 1;
        showRound();
      }
    } else {
      toast("Not that one! Try again", "bad");
      closePortal(i);
      // Bounce the player back from the portal.
      player.pos.z = PORTAL_Z + 3.5;
    }
  } catch (err) {
    toast(err.message, "bad");
    player.pos.z = PORTAL_Z + 3.5;
  } finally {
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
    if (isTouch) $("help").textContent = "Use the arrows to walk · drag to look";
    showRound();
    canvas.focus();
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
    `You got ${state.correctFirst} of ${state.rounds.length} right on the first try.`;
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
    $("final-detail").textContent = `You're number ${res.rank} on the leaderboard! 🏆`;
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
  resetPlayer();
});
$("start-btn").addEventListener("click", startGame);

async function loadLeaderboard() {
  const list = $("leaderboard");
  try {
    const { leaderboard } = await api("/leaderboard");
    if (!leaderboard.length) {
      const li = document.createElement("li");
      li.textContent = "No scores yet. Be the first!";
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

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (state.mode === "playing" && !state.busy) movePlayer(dt);
  else if (state.mode === "menu" && !reducedMotion) player.yaw = Math.sin(t * 0.2) * 0.25; // gentle look-around behind the menu

  portals.forEach((p, i) => {
    p.discMat.uniforms.uTime.value = t + i;
    if (!reducedMotion) p.ring.rotation.z = t * 0.4 * (i % 2 ? 1 : -1);
  });

  const baseFov = camera.userData.baseFov;
  if (warp > 0) {
    warp = Math.max(0, warp - dt);
    const k = 1 - warp / WARP_TIME;
    camera.fov = baseFov + Math.sin(k * Math.PI) * 50;
    player.pos.z -= dt * 12;
    camera.updateProjectionMatrix();
  } else if (camera.fov !== baseFov) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  renderer.render(scene, camera);
});

setPortalLabels(["Space", "Animals", "Maths", "Games"]);
loadCategories();
loadLeaderboard();
