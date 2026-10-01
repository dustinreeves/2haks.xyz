// Boss Builder: screens, input and the game loop.

import { DT, TILE, W, TILES, PALETTE, BOSSES, UNLOCKS, UPGRADES, waveHeroes } from "./rules.js";
import { Grid, defaultLevel, levelFromGrid, budgetFor, trapCost, isUnlocked, levelProblems, shapeError } from "./level.js";
import { buildNav, routePoints } from "./nav.js";
import { createWorld, updateWorld, waveWon } from "./world.js";
import { autoBossInput } from "./boss.js";
import { Camera, drawEditor, drawWorld, drawRoute, drawTileIcon } from "./render.js";
import { Editor } from "./editor.js";
import { loadSave, writeSave } from "./save.js";
import * as api from "./api.js";

const $ = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const cam = new Camera(canvas);

const save = loadSave();
let grid = Grid.fromLevel(save.level);
let mode = "build";       // "build" | "play"
let world = null;
let showRoute = false;
let route = null;          // { ok, points } for the current grid, or null if stale

function persist() {
  save.level = levelFromGrid(grid, save.level.boss);
  if (!writeSave(save)) toast("Couldn't save progress in this browser.");
}

// ---------- toast ----------

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- editor ----------

let routeDirtyAt = 0;
const editor = new Editor(canvas, cam, grid, () => save, {
  save: persist,
  changed: () => {
    route = null;
    routeDirtyAt = performance.now();
    $("route-status").textContent = "";
    updateBudget();
  },
  toast,
});

function buildPalette() {
  const pal = $("palette");
  pal.replaceChildren();
  PALETTE.forEach((c, i) => {
    const t = TILES[c];
    const locked = !isUnlocked(save, t.unlock);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-btn";
    btn.dataset.tile = c;
    btn.setAttribute("aria-pressed", String(editor.tool === c));
    btn.title = `${t.name}${t.cost ? ` (${t.cost} trap point${t.cost > 1 ? "s" : ""})` : ""}: ${t.tip || "Erase tiles"}${i < 9 ? ` [${i + 1}]` : ""}`;
    const icon = document.createElement("canvas");
    icon.width = icon.height = 64;
    drawTileIcon(icon, c, save.level.boss);
    const label = document.createElement("span");
    label.textContent = t.name;
    btn.append(icon, label);
    if (t.cost) {
      const cost = document.createElement("small");
      cost.className = "cost";
      cost.textContent = String(t.cost);
      btn.append(cost);
    }
    if (locked) {
      btn.classList.add("locked");
      const lock = document.createElement("small");
      lock.className = "lock";
      lock.textContent = `🔒 ${UNLOCKS[t.unlock].price}`;
      btn.append(lock);
    }
    btn.addEventListener("click", () => {
      if (locked) {
        toast(`${t.name} is locked. Unlock it in the shop for ${UNLOCKS[t.unlock].price} 🪙.`);
        return;
      }
      selectTool(c);
    });
    pal.append(btn);
  });
}

function selectTool(c) {
  editor.tool = c;
  for (const b of $("palette").children) b.setAttribute("aria-pressed", String(b.dataset.tile === c));
}

function buildBossSelect() {
  const sel = $("boss-select");
  sel.replaceChildren();
  for (const [id, def] of Object.entries(BOSSES)) {
    const opt = document.createElement("option");
    opt.value = id;
    const locked = !isUnlocked(save, def.unlock);
    opt.textContent = locked ? `🔒 ${def.name} (${UNLOCKS[def.unlock].price} 🪙)` : def.name;
    opt.disabled = locked;
    sel.append(opt);
  }
  sel.value = save.level.boss;
}

$("boss-select").addEventListener("change", (e) => {
  save.level.boss = e.target.value;
  persist();
  buildPalette();
  const problems = levelProblems(save.level, save);
  toast(problems.find((p) => p.includes("room")) || `${BOSSES[save.level.boss].name}: ${BOSSES[save.level.boss].tip}`);
});

function updateBudget() {
  const used = trapCost(grid), budget = budgetFor(save);
  $("budget-text").textContent = `${used} / ${budget}`;
  $("budget-fill").style.width = `${Math.min(100, (used / budget) * 100)}%`;
}

function updateStats() {
  $("coins").textContent = save.coins;
  $("wave").textContent = save.wave;
}

function refreshRoute() {
  if (route) return route;
  const nav = buildNav(grid);
  route = { ok: nav.ok, points: nav.ok ? routePoints(grid, nav) : [] };
  const el = $("route-status");
  el.textContent = nav.ok ? "" : "⚠️ Heroes can't reach the flag. Every level must be possible to beat!";
  return route;
}

$("btn-route").addEventListener("click", () => {
  showRoute = !showRoute;
  $("btn-route").setAttribute("aria-pressed", String(showRoute));
  if (showRoute && !refreshRoute().ok) toast("There's no way to reach the flag yet. Open up a path!");
});
$("btn-undo").addEventListener("click", () => editor.undo());
$("btn-clear").addEventListener("click", () => {
  if (!confirm("Start a new, empty level? Your current level will be replaced.")) return;
  setLevel(defaultLevel(), save.level.boss);
});

function setLevel(level, boss = level.boss) {
  save.level = { ...level, boss };
  grid = Grid.fromLevel(save.level);
  editor.setGrid(grid);
  route = null;
  persist();
  buildPalette();
  buildBossSelect();
  updateBudget();
}

// Horizontal scrolling while building.
const scroll = $("scroll");
scroll.addEventListener("input", () => {
  cam.x = (Number(scroll.value) / 100) * Math.max(0, W - cam.viewW);
  cam.clamp();
});
canvas.addEventListener("wheel", (e) => {
  if (mode !== "build") return;
  e.preventDefault();
  cam.x += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / (TILE * cam.scale);
  cam.clamp();
  syncScroll();
}, { passive: false });

function syncScroll() {
  const max = Math.max(0, W - cam.viewW);
  scroll.value = max ? String((cam.x / max) * 100) : "0";
  scroll.hidden = max === 0;
}

// ---------- keyboard and touch ----------

const keys = { left: false, right: false, up: false, down: false };
let attackQueued = false;
const KEYMAP = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
};

window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea, dialog[open]")) return;
  if (mode === "play") {
    if (e.code in KEYMAP) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if ((e.code === "Space" || e.code === "KeyJ") && !e.repeat) { attackQueued = true; e.preventDefault(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { editor.undo(); e.preventDefault(); return; }
  if (e.code === "ArrowLeft" || e.code === "KeyA") { cam.x -= 2; cam.clamp(); syncScroll(); }
  if (e.code === "ArrowRight" || e.code === "KeyD") { cam.x += 2; cam.clamp(); syncScroll(); }
  const n = Number(e.key);
  if (n >= 1 && n <= 9) {
    const c = PALETTE[n - 1];
    if (isUnlocked(save, TILES[c].unlock)) selectTool(c);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code in KEYMAP) keys[KEYMAP[e.code]] = false;
});
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

for (const btn of $("touch").querySelectorAll("button")) {
  const key = btn.dataset.key;
  const press = (down) => (e) => {
    e.preventDefault();
    if (key === "attack") { if (down) attackQueued = true; } else keys[key] = down;
    btn.classList.toggle("down", down);
  };
  btn.addEventListener("pointerdown", press(true));
  btn.addEventListener("pointerup", press(false));
  btn.addEventListener("pointercancel", press(false));
  btn.addEventListener("pointerleave", press(false));
}

const isTouch = window.matchMedia("(pointer: coarse)").matches;

// ---------- waves ----------

function startWave() {
  const problems = levelProblems(save.level, save);
  if (problems.length) return toast(problems[0]);
  if (!refreshRoute().ok) {
    showRoute = true;
    $("btn-route").setAttribute("aria-pressed", "true");
    return toast("Heroes can't reach the flag! Every level must be possible to beat.");
  }
  world = createWorld(save.level, save);
  mode = "play";
  editor.active = false;
  attackQueued = false;
  document.body.classList.add("playing");
  $("build-bar").hidden = true;
  $("build-actions").hidden = true;
  $("play-hud").hidden = false;
  $("touch").hidden = !isTouch;
  $("touch-down").hidden = !BOSSES[world.boss.kind].flies;
  $("auto-boss").checked = save.autoBoss;
  const def = BOSSES[world.boss.kind];
  const mix = waveHeroes(save.wave);
  $("play-hint").textContent = isTouch
    ? `Wave ${save.wave}: ${mix.count} heroes are coming! 💥 = ${def.attackName}`
    : `Wave ${save.wave}: ${mix.count} heroes are coming! Arrows/WASD to move, Space = ${def.attackName}`;
  $("play-hint").hidden = false;
  setTimeout(() => { $("play-hint").hidden = true; }, 5000);
  requestAnimationFrame(() => cam.resize());
}

function endWave(stoppedEarly = false) {
  const w = world;
  if (stoppedEarly) w.escaped += w.heroes.length + w.roster.length;
  const won = !stoppedEarly && waveWon(w);
  save.coins += w.coins;
  save.stats.defeated += w.defeated;
  save.stats.escaped += w.escaped;
  save.stats.waves += 1;
  if (won) save.wave += 1;
  writeSave(save);

  world = null;
  mode = "build";
  editor.active = true;
  document.body.classList.remove("playing");
  $("build-bar").hidden = false;
  $("build-actions").hidden = false;
  $("play-hud").hidden = true;
  $("touch").hidden = true;
  $("play-hint").hidden = true;
  for (const k in keys) keys[k] = false;
  updateStats();
  requestAnimationFrame(() => { cam.resize(); syncScroll(); });

  $("results-title").textContent = won ? "👑 The boss wins!" : "😅 The heroes got through…";
  $("results-text").textContent = won
    ? `You beat wave ${save.wave - 1}! Wave ${save.wave} will bring even more heroes.`
    : "No worries! Try more traps, a trickier path, or an upgrade from the shop, then try again.";
  $("res-defeated").textContent = w.defeated;
  $("res-escaped").textContent = w.escaped;
  $("res-coins").textContent = `+${w.coins}`;
  $("dlg-results").showModal();
}

$("btn-start").addEventListener("click", startWave);
$("btn-stop").addEventListener("click", () => {
  if (confirm("End this wave now? You keep the coins you've earned so far.")) endWave(true);
});
$("auto-boss").addEventListener("change", (e) => {
  save.autoBoss = e.target.checked;
  writeSave(save);
  e.target.blur();
});

function heartsText(boss) {
  if (!boss.alive) return "💀 Boss defeated";
  return "❤️".repeat(boss.hp) + "🖤".repeat(boss.maxHp - boss.hp);
}

function updateHud() {
  const left = world.heroes.length + world.roster.length;
  $("hud-hearts").textContent = heartsText(world.boss);
  $("hud-heroes").textContent = `🛡️ ${left} left`;
  $("hud-coins").textContent = `🪙 +${world.coins}`;
}

// ---------- shop ----------

function shopCard(title, desc, price, state, onBuy) {
  const card = document.createElement("div");
  card.className = "shop-card";
  const h = document.createElement("b");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = desc;
  const btn = document.createElement("button");
  btn.type = "button";
  if (state === "owned") {
    btn.textContent = "✅ Owned";
    btn.disabled = true;
  } else if (state === "max") {
    btn.textContent = "⭐ Max level";
    btn.disabled = true;
  } else {
    btn.textContent = `Buy for ${price} 🪙`;
    btn.disabled = save.coins < price;
    btn.className = "primary";
    btn.addEventListener("click", onBuy);
  }
  card.append(h, p, btn);
  return card;
}

function renderShop() {
  $("shop-coins").textContent = save.coins;
  const unlocks = $("shop-unlocks");
  unlocks.replaceChildren();
  for (const [id, u] of Object.entries(UNLOCKS)) {
    const tile = Object.values(TILES).find((t) => t.unlock === id);
    const boss = Object.values(BOSSES).find((b) => b.unlock === id);
    const desc = boss ? `New boss! ${boss.tip}` : tile.tip;
    unlocks.append(shopCard(u.name, desc, u.price, save.unlocked.includes(id) ? "owned" : "buy", () => buy(u.price, () => save.unlocked.push(id), `${u.name} unlocked!`)));
  }
  const upgrades = $("shop-upgrades");
  upgrades.replaceChildren();
  for (const [id, u] of Object.entries(UPGRADES)) {
    const lvl = save.upgrades[id] || 0;
    const max = lvl >= u.prices.length;
    const title = `${u.name} ${"●".repeat(lvl)}${"○".repeat(u.prices.length - lvl)}`;
    upgrades.append(shopCard(title, u.desc, u.prices[lvl], max ? "max" : "buy", () => buy(u.prices[lvl], () => { save.upgrades[id] = lvl + 1; }, `${u.name} upgraded!`)));
  }
}

function buy(price, apply, message) {
  if (save.coins < price) return;
  save.coins -= price;
  apply();
  writeSave(save);
  updateStats();
  updateBudget();
  buildPalette();
  buildBossSelect();
  renderShop();
  toast(`🎉 ${message}`);
}

$("btn-shop").addEventListener("click", () => { renderShop(); $("dlg-shop").showModal(); });

// ---------- sharing ----------

async function loadRecent() {
  const list = $("recent-list");
  try {
    const { levels } = await api.recentLevels();
    list.replaceChildren();
    if (!levels.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No shared levels yet. Be the first!";
      list.append(li);
    }
    for (const lv of levels) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${lv.name} · ${BOSSES[lv.boss]?.name ?? lv.boss}`;
      const code = document.createElement("code");
      code.textContent = lv.code;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Load";
      btn.addEventListener("click", () => loadCode(lv.code));
      li.append(name, code, btn);
      list.append(li);
    }
  } catch (err) {
    list.replaceChildren();
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = err.message;
    list.append(li);
  }
}

async function loadCode(code) {
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return toast("Codes have 6 letters and numbers.");
  try {
    const data = await api.getLevel(code);
    const shape = shapeError(data.level);
    if (shape) return toast(shape);
    const problems = levelProblems(data.level, save);
    if (problems.length) return toast(`Can't use "${data.name}" yet: ${problems[0]}`);
    if (!confirm(`Load "${data.name}"? It will replace the level you're building.`)) return;
    setLevel(data.level);
    $("dlg-share").close();
    toast(`Loaded "${data.name}"!`);
  } catch (err) {
    toast(err.message);
  }
}

$("btn-share").addEventListener("click", () => {
  $("share-result").textContent = "";
  $("dlg-share").showModal();
  loadRecent();
});
$("btn-do-share").addEventListener("click", async () => {
  const problems = levelProblems(save.level, save);
  if (problems.length) return toast(problems[0]);
  if (!refreshRoute().ok) return toast("Only fair levels can be shared. Heroes need a way to the flag!");
  const out = $("share-result");
  out.textContent = "Sharing…";
  try {
    const res = await api.shareLevel(save.level);
    out.textContent = "";
    const code = document.createElement("code");
    code.className = "big-code";
    code.textContent = res.code;
    out.append(`"${res.name}" code: `, code);
    loadRecent();
  } catch (err) {
    out.textContent = err.message;
  }
});
$("btn-load-code").addEventListener("click", () => loadCode($("code-input").value));
$("code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); loadCode(e.target.value); }
});

$("btn-help").addEventListener("click", () => $("dlg-help").showModal());

// ---------- loop ----------

let last = performance.now();
let acc = 0;
let clock = 0;

function frame(now) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += elapsed;

  if (mode === "play" && world) {
    acc += elapsed;
    while (acc >= DT && !world.done) {
      const input = $("auto-boss").checked ? autoBossInput(world.boss, world) : { ...keys, attack: attackQueued };
      attackQueued = false;
      updateWorld(world, input);
      acc -= DT;
    }
    const target = world.boss.alive ? world.boss.body : world.heroes[0]?.body;
    if (target) cam.follow(target.x + target.w / 2);
    drawWorld(ctx, cam, world, clock);
    updateHud();
    if (world.done) endWave();
  } else {
    acc = 0;
    drawEditor(ctx, cam, grid, save.level.boss, clock, editor.hover);
    // Wait until painting pauses before re-planning the route; it takes a moment.
    if (showRoute && (route || (!editor.painting && now - routeDirtyAt > 150))) {
      const r = refreshRoute();
      if (r.ok) drawRoute(ctx, cam, r.points);
    }
  }
  requestAnimationFrame(frame);
}

// ---------- start ----------

new ResizeObserver(() => { cam.resize(); syncScroll(); }).observe($("stage"));
buildPalette();
buildBossSelect();
updateBudget();
updateStats();
selectTool("#");
if (!save.seenHelp) {
  $("dlg-help").showModal();
  save.seenHelp = true;
  writeSave(save);
}
requestAnimationFrame(frame);
