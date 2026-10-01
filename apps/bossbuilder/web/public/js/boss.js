// The boss: that's you! Controlled by the keyboard/touch buttons, or by autoBossInput().

import { DT, PHYS, H, BOSSES, UPGRADE_EFFECT } from "./rules.js";
import { moveBody, centerX, centerY } from "./physics.js";

const SLAM_SPEED = 22;
const GUARD_RADIUS = 10;
// After squishing a hero by touch, the boss needs a moment before it can squish again.
const SQUISH_COOLDOWN = 0.9;

export function makeBoss(kind, spot, upgrades) {
  const def = BOSSES[kind];
  const hp = def.hp + UPGRADE_EFFECT.health * (upgrades.health || 0);
  const quicker = Math.pow(UPGRADE_EFFECT.cooldown, upgrades.cooldown || 0);
  const home = { x: spot.x + 0.5 - def.w / 2, y: spot.y + 1 - def.h };
  return {
    kind,
    def,
    home,
    body: { ...home, w: def.w, h: def.h, vx: 0, vy: 0, onGround: false },
    hp,
    maxHp: hp,
    speed: def.speed * (1 + UPGRADE_EFFECT.speed * (upgrades.speed || 0)),
    cooldown: def.cooldown * quicker,
    squishCooldown: SQUISH_COOLDOWN * quicker,
    cd: 0,
    squishCd: 0,
    facing: -1,
    invuln: 0,
    alive: true,
    slamQueued: false,
    slamming: false,
    breath: 0,
  };
}

// input = { left, right, up, down, attack, slow }
// attack is true for one step when pressed; slow is set by the auto boss.
export function updateBoss(boss, input, world) {
  if (!boss.alive) return;
  const b = boss.body;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) boss.facing = dir;
  boss.cd = Math.max(0, boss.cd - DT);
  boss.squishCd = Math.max(0, boss.squishCd - DT);
  boss.invuln = Math.max(0, boss.invuln - DT);
  boss.breath = Math.max(0, boss.breath - DT);

  const speed = boss.speed * (input.slow ? AUTO_SPEED : 1);
  b.vx = dir * speed;
  if (boss.def.flies) {
    b.vy = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * speed * 0.85;
  } else {
    if (input.up && b.onGround && !boss.slamming) b.vy = -boss.def.jump;
    if (boss.slamQueued && b.vy >= 0) {
      boss.slamQueued = false;
      boss.slamming = true;
    }
    b.vy = boss.slamming ? SLAM_SPEED : Math.min(b.vy + PHYS.gravity * DT, PHYS.maxFall);
    if (boss.slamming) b.vx = 0;
  }
  moveBody(b, world.grid);

  if (boss.slamming && b.onGround) {
    boss.slamming = false;
    world.shake = 0.3;
    for (const d of [-1, 1]) {
      world.shockwaves.push({ x: centerX(b) - 0.4, y: b.y + b.h - 0.7, w: 0.8, h: 0.7, dir: d, life: 0.6 });
    }
  }

  if (b.y > H + 2) {
    Object.assign(b, boss.home, { vx: 0, vy: 0 });
    boss.slamming = boss.slamQueued = false;
  }

  if (input.attack && boss.cd === 0) attack(boss, world);
}

function attack(boss, world) {
  const b = boss.body;
  boss.cd = boss.cooldown;
  switch (boss.def.attack) {
    case "pound":
      if (b.onGround) {
        b.vy = -boss.def.jump * 0.8;
        boss.slamQueued = true;
      } else {
        boss.slamming = true;
      }
      break;
    case "fireball":
      world.projectiles.push({
        kind: "fire",
        x: boss.facing > 0 ? b.x + b.w : b.x - 0.5,
        y: b.y + b.h * 0.3,
        w: 0.5, h: 0.5,
        vx: boss.facing * 11,
        life: 2.5,
      });
      break;
    case "breath":
      boss.breath = 0.7;
      break;
  }
}

export function breathBox(boss) {
  if (!boss.alive || boss.breath <= 0) return null;
  const b = boss.body;
  const w = 3.2;
  return { x: boss.facing > 0 ? b.x + b.w : b.x - w, y: b.y + 0.1, w, h: b.h - 0.2 };
}

export function hurtBoss(boss, world) {
  if (!boss.alive || boss.invuln > 0) return;
  boss.hp--;
  boss.invuln = 1;
  if (boss.hp <= 0) {
    boss.alive = false;
    world.effects.push({ kind: "poof", x: centerX(boss.body), y: centerY(boss.body), t: 0, big: true });
    world.effects.push({ kind: "text", text: "Boss defeated!", x: centerX(boss.body), y: boss.body.y, t: 0, color: "#f87171" });
  }
}

// Computer control: guards the area around the boss spot. On purpose it is
// slower and less accurate than a good player, so playing yourself pays off.
const AUTO_THINK = 0.3;       // seconds between decisions
const AUTO_SPEED = 0.65;      // fraction of normal boss speed
const AUTO_ATTACK_CHANCE = 0.3;

export function autoBossInput(boss, world) {
  boss.autoWait = (boss.autoWait ?? 0) - DT;
  if (boss.autoWait > 0 && boss.autoInput) return { ...boss.autoInput, attack: false };
  boss.autoWait = AUTO_THINK;
  boss.autoInput = decideAuto(boss, world);
  return boss.autoInput;
}

function decideAuto(boss, world) {
  const input = { left: false, right: false, up: false, down: false, attack: false, slow: true };
  if (!boss.alive) return input;
  const b = boss.body;
  const bx = centerX(b), by = centerY(b);
  const homeX = boss.home.x + b.w / 2;

  let target = null, best = Infinity;
  for (const h of world.heroes) {
    if (!h.alive || Math.abs(centerX(h.body) - homeX) > GUARD_RADIUS) continue;
    const d = Math.hypot(centerX(h.body) - bx, centerY(h.body) - by);
    if (d < best) { best = d; target = h; }
  }

  const tx = target ? centerX(target.body) : homeX;
  const ty = target ? centerY(target.body) : boss.home.y + b.h / 2;
  const dx = tx - bx, dy = ty - by;
  if (Math.abs(dx) > 0.4) {
    input.right = dx > 0;
    input.left = dx < 0;
  }

  if (boss.def.flies) {
    input.up = dy < -0.3;
    input.down = dy > 0.3;
  } else if (b.onGround && (b.hitWall || (target && dy < -1.5 && Math.abs(dx) < 3))) {
    input.up = true;
  }

  if (target && Math.sign(dx) === boss.facing && world.rand() < AUTO_ATTACK_CHANCE) {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    input.attack =
      (boss.def.attack === "pound" && adx < 4 && ady < 2) ||
      (boss.def.attack === "fireball" && adx < 10 && ady < 1) ||
      (boss.def.attack === "breath" && adx < 3.5 && ady < 1.2);
  }
  return input;
}
