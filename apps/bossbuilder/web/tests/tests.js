// Browser tests for the game logic. Open web/tests/index.html from a server rooted at web/.

import { H } from "../public/js/rules.js";
import { Grid, defaultLevel, levelProblems } from "../public/js/level.js";
import { buildNav } from "../public/js/nav.js";
import { createWorld, updateWorld } from "../public/js/world.js";
import { autoBossInput } from "../public/js/boss.js";
import { newSave } from "../public/js/save.js";

const out = document.getElementById("out");
const lines = [];
let failed = 0;

function test(name, fn) {
  try {
    fn();
    lines.push(`<span class="pass">PASS</span> ${name}`);
  } catch (e) {
    failed++;
    lines.push(`<span class="fail">FAIL</span> ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function edit(changes) {
  const g = Grid.fromLevel(defaultLevel());
  changes(g);
  return { ...defaultLevel(), tiles: g.toRows() };
}

function runWave(level, wave, auto, seed = 1, setup = () => {}) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const save = newSave();
  save.wave = wave;
  const w = createWorld(level, save, rand);
  setup(w);
  for (let i = 0; !w.done && i < 60 * 300; i++) updateWorld(w, auto ? autoBossInput(w.boss, w) : {});
  return w;
}

test("default level is valid and beatable", () => {
  const lvl = defaultLevel();
  assert(levelProblems(lvl, newSave()).length === 0, "default level has problems");
  assert(buildNav(Grid.fromLevel(lvl)).ok, "no route on the default level");
});

test("heroes can cross a 3-wide pit and climb a 2-high wall", () => {
  const lvl = edit((g) => {
    for (let y = H - 2; y < H; y++) for (let x = 15; x < 18; x++) g.set(x, y, ".");
    g.set(25, H - 3, "#"); g.set(25, H - 4, "#");
  });
  assert(buildNav(Grid.fromLevel(lvl)).ok, "route not found");
});

test("a 3-high wall blocks the route", () => {
  const lvl = edit((g) => { for (let y = H - 5; y < H - 2; y++) g.set(30, y, "#"); });
  assert(!buildNav(Grid.fromLevel(lvl)).ok, "route found over a 3-high wall");
});

test("a 6-wide pit blocks the route", () => {
  const lvl = edit((g) => { for (let y = H - 2; y < H; y++) for (let x = 20; x < 26; x++) g.set(x, y, "."); });
  assert(!buildNav(Grid.fromLevel(lvl)).ok, "route found over a 6-wide pit");
});

test("a row of spikes across the floor blocks the route", () => {
  const lvl = edit((g) => { for (let x = 20; x < 26; x++) g.set(x, H - 3, "^"); });
  assert(!buildNav(Grid.fromLevel(lvl)).ok, "route found over 6 spikes");
});

test("budget and locks are enforced", () => {
  const lvl = edit((g) => { for (let x = 10; x < 15; x++) g.set(x, H - 3, "c"); });
  const problems = levelProblems(lvl, newSave());
  assert(problems.some((p) => p.includes("locked")), "cannon should be locked");
  assert(problems.some((p) => p.includes("trap points")), "25 points should exceed the base 20");
});

test("with no boss, every hero escapes an empty level", () => {
  const w = runWave(defaultLevel(), 3, false, 1, (world) => { world.boss.alive = false; });
  assert(w.escaped === w.total, `${w.escaped}/${w.total} escaped`);
});

test("with no boss, most heroes get through pits, walls and spikes", () => {
  const lvl = edit((g) => {
    for (let y = H - 2; y < H; y++) for (let x = 15; x < 18; x++) g.set(x, y, ".");
    g.set(25, H - 3, "#"); g.set(25, H - 4, "#");
    g.set(32, H - 3, "^"); g.set(33, H - 3, "^");
  });
  const w = runWave(lvl, 5, false, 2, (world) => { world.boss.alive = false; });
  assert(w.escaped >= w.total * 0.6, `only ${w.escaped}/${w.total} escaped`);
});

test("an idle boss usually loses wave 1 (heroes stomp it)", () => {
  let won = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const w = runWave(defaultLevel(), 1, false, seed);
    if (w.escaped * 2 < w.total) won++;
  }
  assert(won <= 3, `idle boss won ${won}/6`);
});

test("the auto boss wins wave 1", () => {
  const w = runWave(defaultLevel(), 1, true);
  assert(w.escaped * 2 < w.total, `${w.escaped}/${w.total} escaped`);
});

out.innerHTML = `${lines.join("\n")}\n\n${failed ? `<span class="fail">${failed} failed</span>` : '<span class="pass">All passed</span>'}`;
document.title = failed ? "FAIL" : "PASS";
