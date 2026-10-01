// One wave of play: heroes, minions, cannons, projectiles and the boss.

import { DT, H, W, PHYS, COINS_PER_HERO, waveHeroes } from "./rules.js";
import { Grid } from "./level.js";
import { moveBody, overlaps, touchesHazard, centerX, centerY } from "./physics.js";
import { buildNav } from "./nav.js";
import { makeHero, updateHero, heroGaveUp, bounce } from "./heroes.js";
import { makeBoss, updateBoss, breathBox, hurtBoss } from "./boss.js";

// Heroes arrive in packs: GROUP_SIZE close together, then a pause.
const GROUP_SIZE = 4;
const SPAWN_GAP = 0.35;
const GROUP_GAP = 3;
const CANNON_RELOAD = 2.2;
const WAVE_TIME_LIMIT = 240;

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function createWorld(level, save, rand = Math.random) {
  const grid = Grid.fromLevel(level);
  const nav = buildNav(grid);
  const mix = waveHeroes(save.wave);
  // Rookies first, champions last, shuffled within the middle of the pack.
  const roster = [
    ...Array(mix.rookie).fill("rookie"),
    ...shuffle([...Array(mix.knight).fill("knight"), ...Array(Math.ceil(mix.champion / 2)).fill("champion")], rand),
    ...Array(Math.floor(mix.champion / 2)).fill("champion"),
  ];

  const minions = [];
  const cannons = [];
  grid.forEach((c, x, y) => {
    if (c === "s") minions.push({ kind: "slime", alive: true, dir: -1, body: { x: x + 0.1, y: y + 0.45, w: 0.8, h: 0.55, vx: 0, vy: 0, onGround: false } });
    if (c === "b") minions.push({ kind: "bat", alive: true, x0: x + 0.15, y0: y + 0.2, t: rand() * 6, body: { x: x + 0.15, y: y + 0.2, w: 0.7, h: 0.5 } });
    if (c === "c") cannons.push({ x, y, reload: 1 + rand() * CANNON_RELOAD, fire: 0 });
  });

  return {
    grid,
    nav,
    rand,
    start: grid.find("S"),
    flag: grid.find("F"),
    roster,
    total: roster.length,
    heroes: [],
    spawnIn: 0.5,
    minions,
    cannons,
    projectiles: [],
    shockwaves: [],
    effects: [],
    dangers: [],
    boss: makeBoss(level.boss, grid.find("K"), save.upgrades),
    defeated: 0,
    escaped: 0,
    coins: 0,
    time: 0,
    shake: 0,
    done: false,
  };
}

function defeatHero(world, hero, why) {
  hero.alive = false;
  world.defeated++;
  world.coins += COINS_PER_HERO;
  const x = centerX(hero.body), y = hero.body.y;
  world.effects.push({ kind: "poof", x, y: y + 0.4, t: 0 });
  world.effects.push({ kind: "text", text: `+${COINS_PER_HERO}`, coin: true, x, y, t: 0, color: "#fde047" });
  if (why) world.effects.push({ kind: "text", text: why, x, y: y - 0.6, t: 0, color: "#e5e7eb", small: true });
}

function updateMinions(world) {
  for (const m of world.minions) {
    if (!m.alive) continue;
    const b = m.body;
    if (m.kind === "slime") {
      b.vx = m.dir * 1.5;
      b.vy = Math.min(b.vy + PHYS.gravity * DT, PHYS.maxFall);
      moveBody(b, world.grid);
      const aheadX = Math.floor(m.dir > 0 ? b.x + b.w + 0.05 : b.x - 0.05);
      const noFloor = b.onGround && !world.grid.solid(aheadX, Math.floor(b.y + b.h + 0.1));
      if (b.hitWall || noFloor) m.dir = -m.dir;
      if (b.y > H + 1) m.alive = false;
    } else {
      m.t += DT;
      b.x = m.x0 + 2.5 * Math.sin(m.t * 1.1);
      b.y = m.y0 + 0.5 * Math.sin(m.t * 3.1);
      m.dir = Math.cos(m.t * 1.1) >= 0 ? 1 : -1;
    }
  }
}

function updateCannons(world) {
  for (const c of world.cannons) {
    c.fire = Math.max(0, c.fire - DT);
    c.reload -= DT;
    if (c.reload > 0) continue;
    let target = null, best = Infinity;
    for (const h of world.heroes) {
      if (!h.alive) continue;
      const dx = centerX(h.body) - (c.x + 0.5);
      const dy = centerY(h.body) - (c.y + 0.5);
      if (Math.abs(dx) < 14 && Math.abs(dy) < 3 && Math.abs(dx) < best) { best = Math.abs(dx); target = dx; }
    }
    if (target === null) continue;
    const dir = Math.sign(target) || -1;
    c.reload = CANNON_RELOAD;
    if (world.grid.solid(c.x + dir, c.y)) continue;
    c.dir = dir;
    c.fire = 0.2;
    world.projectiles.push({ kind: "ball", x: dir > 0 ? c.x + 1 : c.x - 0.45, y: c.y + 0.3, w: 0.45, h: 0.45, vx: dir * 7, life: 3 });
  }
}

function updateProjectiles(world) {
  for (const p of world.projectiles) {
    p.x += p.vx * DT;
    p.life -= DT;
    if (world.grid.solid(Math.floor(p.x + p.w / 2), Math.floor(p.y + p.h / 2)) || p.x < -1 || p.x > W + 1) p.life = 0;
  }
  world.projectiles = world.projectiles.filter((p) => p.life > 0);

  for (const s of world.shockwaves) {
    s.x += s.dir * 12 * DT;
    s.life -= DT;
    const front = Math.floor(s.dir > 0 ? s.x + s.w : s.x);
    const floorY = Math.floor(s.y + s.h + 0.1);
    if (world.grid.solid(front, Math.floor(s.y + s.h / 2)) || !world.grid.solid(front, floorY)) s.life = 0;
  }
  world.shockwaves = world.shockwaves.filter((s) => s.life > 0);
}

function stompOrHit(hero, box) {
  return hero.body.vy > 0 && hero.body.y + hero.body.h - box.y < 0.4;
}

function checkHero(world, hero) {
  const b = hero.body;
  if (touchesHazard(b, world.grid)) return defeatHero(world, hero, "Ouch!");
  if (b.y > H + 1) return defeatHero(world, hero, "Fell!");
  if (overlaps(b, world.nav.goal)) {
    hero.alive = false;
    hero.escaped = true;
    world.escaped++;
    world.effects.push({ kind: "text", text: "Escaped!", x: centerX(b), y: b.y, t: 0, color: "#93c5fd", small: true });
    return;
  }
  if (heroGaveUp(hero)) return defeatHero(world, hero, "Gave up!");

  for (const m of world.minions) {
    if (!m.alive || !overlaps(b, m.body)) continue;
    if (stompOrHit(hero, m.body)) {
      m.alive = false;
      world.effects.push({ kind: "poof", x: centerX(m.body), y: centerY(m.body), t: 0 });
      bounce(hero);
    } else {
      return defeatHero(world, hero, "Bonk!");
    }
  }

  const boss = world.boss;
  if (boss.alive && overlaps(b, boss.body)) {
    if (stompOrHit(hero, boss.body)) {
      hurtBoss(boss, world);
      bounce(hero);
    } else if (boss.squishCd === 0) {
      boss.squishCd = boss.squishCooldown;
      return defeatHero(world, hero, "Squish!");
    }
    // Otherwise the boss is still recovering, and the hero slips past.
  }
  const breath = breathBox(boss);
  if (breath && overlaps(b, breath)) return defeatHero(world, hero, "Toasty!");
  for (const p of world.projectiles) {
    if (overlaps(b, p)) {
      p.life = 0;
      return defeatHero(world, hero, p.kind === "fire" ? "Toasty!" : "Boom!");
    }
  }
  for (const s of world.shockwaves) {
    if (overlaps(b, s)) return defeatHero(world, hero, "Shaken!");
  }
}

export function updateWorld(world, bossInput) {
  if (world.done) return;
  world.time += DT;
  world.shake = Math.max(0, world.shake - DT);

  world.spawnIn -= DT;
  if (world.roster.length && world.spawnIn <= 0) {
    world.heroes.push(makeHero(world.roster.shift(), world.start, world.rand));
    const spawned = world.total - world.roster.length;
    world.spawnIn = spawned % GROUP_SIZE === 0 ? GROUP_GAP : SPAWN_GAP;
  }

  updateBoss(world.boss, bossInput, world);
  updateMinions(world);
  updateCannons(world);
  updateProjectiles(world);

  // What heroes watch out for. "flying" dangers move through the air, so
  // patient heroes wait for them to pass instead of jumping at them.
  const danger = (b, flying) => ({ x: centerX(b), halfW: b.w / 2, top: b.y, bottom: b.y + b.h, flying });
  world.dangers = [
    ...world.minions.filter((m) => m.alive).map((m) => danger(m.body, m.kind === "bat")),
    ...world.projectiles.map((p) => danger(p, true)),
    ...(world.boss.alive ? [danger(world.boss.body, !!world.boss.def.flies)] : []),
  ];

  for (const hero of world.heroes) {
    if (!hero.alive) continue;
    updateHero(hero, world, world.rand);
    checkHero(world, hero);
  }
  world.projectiles = world.projectiles.filter((p) => p.life > 0);
  world.heroes = world.heroes.filter((h) => h.alive);

  for (const e of world.effects) e.t += DT;
  world.effects = world.effects.filter((e) => e.t < (e.kind === "text" ? 1.2 : 0.5));

  if (world.time > WAVE_TIME_LIMIT) {
    for (const hero of world.heroes) defeatHero(world, hero, "Gave up!");
    world.heroes = [];
  }
  if (!world.roster.length && !world.heroes.length) world.done = true;
}

export function waveWon(world) {
  return world.escaped * 2 < world.total;
}
