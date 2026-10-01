// Canvas drawing. The camera works in tiles: after begin(), 1 unit = 1 tile.

import { TILE, W, H, BOSSES, HERO_TYPES } from "./rules.js";
import { breathBox } from "./boss.js";

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.scale = 1;
    this.dpr = 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.scale = rect.height / (H * TILE);
    this.clamp();
  }

  get px() { return TILE * this.scale * this.dpr; }       // device pixels per tile
  get viewW() { return this.canvas.width / this.px; }     // view width in tiles

  clamp() {
    this.x = Math.max(0, Math.min(this.x, Math.max(0, W - this.viewW)));
  }

  follow(tx) {
    this.x += (tx - this.viewW / 2 - this.x) * 0.12;
    this.clamp();
  }

  // Screen (CSS px) to tile coordinates.
  toTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const s = TILE * this.scale;
    return { x: (clientX - rect.left) / s + this.x, y: (clientY - rect.top) / s };
  }
}

function begin(ctx, cam, shake = 0) {
  const sx = shake ? (Math.random() - 0.5) * shake * 0.6 : 0;
  const sy = shake ? (Math.random() - 0.5) * shake * 0.6 : 0;
  ctx.setTransform(cam.px, 0, 0, cam.px, (-cam.x + sx) * cam.px, sy * cam.px);
}

function text(ctx, cam, str, x, y, size, color, align = "center") {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${Math.round(size * cam.px)}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, size * cam.px * 0.18);
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  const px = (x - cam.x) * cam.px, py = y * cam.px;
  ctx.strokeText(str, px, py);
  ctx.fillStyle = color;
  ctx.fillText(str, px, py);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------- background and tiles ----------

const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: (i * 37.7) % W, y: ((i * 13.3) % (H * 0.55)), r: 0.03 + (i % 3) * 0.015,
}));

function drawBackground(ctx, cam, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, cam.canvas.height);
  g.addColorStop(0, "#140f2e");
  g.addColorStop(0.6, "#2e1a52");
  g.addColorStop(1, "#4a1d5e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.canvas.width, cam.canvas.height);

  // Stars and mountains scroll slower than the level (parallax).
  ctx.setTransform(cam.px, 0, 0, cam.px, -cam.x * 0.3 * cam.px, 0);
  for (const s of STARS) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s.x);
    ctx.fillStyle = "#e9d5ff";
    ctx.fillRect(s.x, s.y, s.r * 2, s.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#24163f";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * 0.62 + Math.sin(x * 0.45) * 1.6 + Math.sin(x * 0.17) * 1.2);
  ctx.lineTo(W, H);
  ctx.fill();
}

function drawBlock(ctx, grid, x, y) {
  ctx.fillStyle = "#3b3552";
  ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = "#4a4366";
  ctx.fillRect(x + 0.05, y + 0.05, 0.42, 0.4);
  ctx.fillRect(x + 0.53, y + 0.05, 0.42, 0.4);
  ctx.fillRect(x + 0.05, y + 0.55, 0.9, 0.4);
  if (!grid.solid(x, y - 1)) {
    ctx.fillStyle = "#7c6aa8";
    ctx.fillRect(x, y, 1, 0.12);
  }
}

function drawSpikes(ctx, x, y) {
  ctx.fillStyle = "#cbd5e1";
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 0.04;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i / 3 + 0.02, y + 1);
    ctx.lineTo(x + i / 3 + 1 / 6, y + 0.4);
    ctx.lineTo(x + (i + 1) / 3 - 0.02, y + 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawLava(ctx, grid, x, y, t) {
  const top = grid.get(x, y - 1) === "~" ? 0 : 0.3;
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(x, y + top, 1, 1 - top);
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.moveTo(x, y + 1);
  for (let i = 0; i <= 4; i++) ctx.lineTo(x + i / 4, y + top + 0.12 + Math.sin(t * 4 + x * 2 + i) * 0.06);
  ctx.lineTo(x + 1, y + 1);
  ctx.fill();
  ctx.fillStyle = "#fde047";
  ctx.fillRect(x + ((t * 0.7 + x * 0.37) % 1) * 0.8, y + top + 0.35, 0.1, 0.1);
}

function drawCannon(ctx, x, y, dir = -1, fire = 0) {
  ctx.fillStyle = "#1f2937";
  roundRect(ctx, x + 0.05, y + 0.2, 0.9, 0.8, 0.12);
  ctx.fill();
  ctx.fillStyle = "#4b5563";
  const bx = dir > 0 ? x + 0.55 : x - 0.05;
  roundRect(ctx, bx, y + 0.3, 0.5, 0.36, 0.08);
  ctx.fill();
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.7, 0.12, 0, Math.PI * 2);
  ctx.fill();
  if (fire > 0) {
    ctx.fillStyle = `rgba(253, 186, 116, ${fire * 4})`;
    ctx.beginPath();
    ctx.arc(dir > 0 ? x + 1.15 : x - 0.15, y + 0.48, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDoor(ctx, x, y) {
  ctx.fillStyle = "#78350f";
  ctx.beginPath();
  ctx.moveTo(x + 0.1, y + 1);
  ctx.lineTo(x + 0.1, y - 0.3);
  ctx.arc(x + 0.5, y - 0.3, 0.4, Math.PI, 0);
  ctx.lineTo(x + 0.9, y + 1);
  ctx.fill();
  ctx.fillStyle = "#a16207";
  ctx.fillRect(x + 0.2, y - 0.4, 0.6, 1.4);
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(x + 0.7, y + 0.4, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlag(ctx, x, y, t) {
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x + 0.45, y - 1.2, 0.1, 2.2);
  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.moveTo(x + 0.55, y - 1.2);
  ctx.quadraticCurveTo(x + 1.0, y - 1.05 + Math.sin(t * 5) * 0.08, x + 1.35, y - 0.95);
  ctx.lineTo(x + 0.55, y - 0.65);
  ctx.fill();
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.arc(x + 0.5, y - 1.25, 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawTiles(ctx, cam, grid, t, editing) {
  const x0 = Math.max(0, Math.floor(cam.x) - 1), x1 = Math.min(W, Math.ceil(cam.x + cam.viewW) + 1);
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      const c = grid.get(x, y);
      if (c === "#") drawBlock(ctx, grid, x, y);
      else if (c === "^") drawSpikes(ctx, x, y);
      else if (c === "~") drawLava(ctx, grid, x, y, t);
      else if (c === "S") drawDoor(ctx, x, y);
      else if (c === "F") drawFlag(ctx, x, y, t);
      else if (editing && c === "c") drawCannon(ctx, x, y);
      else if (editing && c === "s") drawSlime(ctx, { x: x + 0.1, y: y + 0.45, w: 0.8, h: 0.55 }, t, -1);
      else if (editing && c === "b") drawBat(ctx, { x: x + 0.15, y: y + 0.2, w: 0.7, h: 0.5 }, t);
    }
  }
}

// ---------- creatures ----------

function eyes(ctx, cx, cy, gap, r, facing, color = "#111827") {
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx + s * gap, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + s * gap + facing * r * 0.35, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSlime(ctx, b, t, facing) {
  const squish = Math.sin(t * 8) * 0.04;
  ctx.fillStyle = "#22c55e";
  roundRect(ctx, b.x - squish, b.y + squish, b.w + squish * 2, b.h - squish, [0.35, 0.35, 0.08, 0.08]);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(b.x + 0.15, b.y + 0.12, 0.12, 0.08);
  eyes(ctx, b.x + b.w / 2, b.y + 0.25, 0.14, 0.09, facing);
}

function drawBat(ctx, b, t) {
  const flap = Math.sin(t * 18) * 0.25;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  ctx.fillStyle = "#7c3aed";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s * 0.55, cy - 0.15 - flap);
    ctx.lineTo(cx + s * 0.4, cy + 0.15);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#4c1d95";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 0.22, 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fca5a5";
  ctx.fillRect(cx - 0.11, cy - 0.06, 0.07, 0.07);
  ctx.fillRect(cx + 0.04, cy - 0.06, 0.07, 0.07);
}

function drawHero(ctx, hero, t) {
  const b = hero.body;
  const color = HERO_TYPES[hero.type].color;
  const run = b.onGround && Math.abs(b.vx) > 0.1 ? Math.sin(t * 20 + hero.id) * 0.08 : 0;
  // legs
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(b.x + 0.12, b.y + b.h - 0.22 + run, 0.14, 0.22 - run);
  ctx.fillRect(b.x + b.w - 0.26, b.y + b.h - 0.22 - run, 0.14, 0.22 + run);
  // body
  ctx.fillStyle = color;
  roundRect(ctx, b.x + 0.05, b.y + 0.3, b.w - 0.1, 0.38, 0.06);
  ctx.fill();
  // head + helmet
  ctx.fillStyle = "#fcd9b6";
  ctx.fillRect(b.x + 0.12, b.y + 0.08, b.w - 0.24, 0.26);
  ctx.fillStyle = "#9ca3af";
  roundRect(ctx, b.x + 0.08, b.y, b.w - 0.16, 0.14, [0.08, 0.08, 0, 0]);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillRect(b.x + b.w / 2 + hero.facing * 0.1 - 0.03, b.y + 0.17, 0.06, 0.07);
  // sword
  ctx.fillStyle = "#e5e7eb";
  const sx = hero.facing > 0 ? b.x + b.w - 0.02 : b.x - 0.08;
  ctx.fillRect(sx, b.y + 0.1, 0.1, 0.42);
  if (hero.type === "champion") {
    ctx.fillStyle = "#fde047";
    ctx.fillRect(b.x + b.w / 2 - 0.05, b.y - 0.12, 0.1, 0.12);
  }
}

function drawBoss(ctx, boss, t) {
  if (!boss.alive) return;
  const b = boss.body;
  if (boss.invuln > 0 && Math.floor(t * 15) % 2) ctx.globalAlpha = 0.4;
  else if (boss.squishCd > 0) ctx.globalAlpha = 0.65; // recovering: heroes can slip past
  const cx = b.x + b.w / 2, f = boss.facing;

  if (boss.kind === "slime_king") {
    const squish = boss.slamming ? -0.1 : Math.sin(t * 5) * 0.05;
    ctx.fillStyle = "#16a34a";
    roundRect(ctx, b.x - squish, b.y + squish, b.w + squish * 2, b.h - squish, [0.8, 0.8, 0.15, 0.15]);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(b.x + 0.3, b.y + 0.3, 0.2, 0.12);
    eyes(ctx, cx, b.y + 0.6, 0.3, 0.17, f, "#7f1d1d");
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(cx - 0.45, b.y + 0.1 + squish);
    ctx.lineTo(cx - 0.45, b.y - 0.35);
    ctx.lineTo(cx - 0.22, b.y - 0.12);
    ctx.lineTo(cx, b.y - 0.42);
    ctx.lineTo(cx + 0.22, b.y - 0.12);
    ctx.lineTo(cx + 0.45, b.y - 0.35);
    ctx.lineTo(cx + 0.45, b.y + 0.1 + squish);
    ctx.fill();
  } else if (boss.kind === "fire_golem") {
    ctx.fillStyle = "#57534e";
    roundRect(ctx, b.x, b.y + 0.4, b.w, b.h - 0.4, 0.15);
    ctx.fill();
    ctx.fillStyle = "#44403c";
    roundRect(ctx, b.x + 0.15, b.y, b.w - 0.3, 0.6, 0.12);
    ctx.fill();
    ctx.fillStyle = "#f97316";
    ctx.fillRect(b.x + 0.25, b.y + 0.9, b.w - 0.5, 0.12);
    ctx.fillRect(b.x + 0.4, b.y + 1.3, b.w - 0.8, 0.1);
    ctx.fillStyle = `hsl(${30 + Math.sin(t * 6) * 10}, 100%, 60%)`;
    ctx.fillRect(cx - 0.3 + f * 0.08, b.y + 0.2, 0.17, 0.12);
    ctx.fillRect(cx + 0.13 + f * 0.08, b.y + 0.2, 0.17, 0.12);
  } else {
    const flap = Math.sin(t * 7) * 0.35;
    ctx.fillStyle = "#3b0764";
    for (const s of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.6, b.y + 0.5);
      ctx.lineTo(cx + s * 1.3, b.y - 0.5 - flap);
      ctx.lineTo(cx + s * 2.0, b.y + 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#581c87";
    roundRect(ctx, b.x + 0.2, b.y + 0.35, b.w - 0.4, b.h - 0.45, 0.35);
    ctx.fill();
    roundRect(ctx, f > 0 ? b.x + b.w - 0.75 : b.x - 0.05, b.y, 0.8, 0.6, 0.2);
    ctx.fill();
    ctx.fillStyle = "#e879f9";
    ctx.fillRect(f > 0 ? b.x + b.w - 0.3 : b.x + 0.15, b.y + 0.15, 0.14, 0.12);
    ctx.strokeStyle = "#581c87";
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(f > 0 ? b.x + 0.3 : b.x + b.w - 0.3, b.y + b.h - 0.4);
    ctx.quadraticCurveTo(cx - f * 1.4, b.y + b.h + 0.1, cx - f * 1.8, b.y + b.h - 0.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const breath = breathBox(boss);
  if (breath) {
    const g = ctx.createLinearGradient(f > 0 ? breath.x : breath.x + breath.w, 0, f > 0 ? breath.x + breath.w : breath.x, 0);
    g.addColorStop(0, "rgba(232,121,249,0.9)");
    g.addColorStop(1, "rgba(88,28,135,0)");
    ctx.fillStyle = g;
    roundRect(ctx, breath.x, breath.y, breath.w, breath.h, 0.4);
    ctx.fill();
  }
}

function drawProjectiles(ctx, world, t) {
  for (const p of world.projectiles) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (p.kind === "fire") {
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(cx, cy, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(cx, cy, p.w / 4 + Math.sin(t * 30) * 0.03, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(cx, cy, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6b7280";
      ctx.fillRect(cx - 0.1, cy - 0.12, 0.08, 0.08);
    }
  }
  ctx.fillStyle = "rgba(167, 243, 208, 0.75)";
  for (const s of world.shockwaves) {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + s.h);
    ctx.quadraticCurveTo(s.x + s.w / 2, s.y - 0.2, s.x + s.w, s.y + s.h);
    ctx.fill();
  }
}

function drawEffects(ctx, cam, world) {
  for (const e of world.effects) {
    if (e.kind === "poof") {
      const r = (e.big ? 1.5 : 0.5) + e.t * (e.big ? 4 : 2);
      ctx.strokeStyle = `rgba(255,255,255,${1 - e.t * 2})`;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const e of world.effects) {
    if (e.kind !== "text") continue;
    const label = e.coin ? `${e.text} 🪙` : e.text;
    text(ctx, cam, label, e.x, e.y - e.t * 1.2, e.small ? 0.35 : 0.5, e.color);
  }
}

export function drawRoute(ctx, cam, points) {
  begin(ctx, cam);
  ctx.fillStyle = "rgba(253, 224, 71, 0.85)";
  for (let i = 0; i < points.length; i += 3) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- scenes ----------

export function drawEditor(ctx, cam, grid, bossKind, t, hover) {
  drawBackground(ctx, cam, t);
  begin(ctx, cam);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  drawTiles(ctx, cam, grid, t, true);

  const spot = grid.find("K");
  if (spot) {
    const def = BOSSES[bossKind];
    ctx.globalAlpha = 0.85;
    drawBoss(ctx, {
      alive: true, kind: bossKind, facing: -1, invuln: 0, breath: 0,
      body: { x: spot.x + 0.5 - def.w / 2, y: spot.y + 1 - def.h, w: def.w, h: def.h },
    }, t);
    ctx.globalAlpha = 1;
  }

  if (hover) {
    ctx.strokeStyle = hover.ok ? "rgba(253,224,71,0.9)" : "rgba(248,113,113,0.9)";
    ctx.lineWidth = 0.06;
    ctx.strokeRect(hover.x + 0.03, hover.y + 0.03, 0.94, 0.94);
  }
}

export function drawWorld(ctx, cam, world, t) {
  drawBackground(ctx, cam, t);
  begin(ctx, cam, world.shake);
  drawTiles(ctx, cam, world.grid, t, false);
  for (const c of world.cannons) drawCannon(ctx, c.x, c.y, c.dir, c.fire);
  for (const m of world.minions) {
    if (!m.alive) continue;
    if (m.kind === "slime") drawSlime(ctx, m.body, t, m.dir);
    else drawBat(ctx, m.body, t);
  }
  drawBoss(ctx, world.boss, t);
  for (const h of world.heroes) drawHero(ctx, h, t);
  drawProjectiles(ctx, world, t);
  drawEffects(ctx, cam, world);
}

// Small preview for palette buttons.
export function drawTileIcon(canvas, c, bossKind = "slime_king") {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  ctx.setTransform(size, 0, 0, size, 0, 0);
  ctx.clearRect(0, 0, 1, 1);
  const fake = { get: () => ".", solid: () => false };
  if (c === "#") drawBlock(ctx, fake, 0, 0);
  else if (c === "^") drawSpikes(ctx, 0, 0);
  else if (c === "~") drawLava(ctx, { get: () => "." }, 0, -0.2, 0);
  else if (c === "s") drawSlime(ctx, { x: 0.1, y: 0.4, w: 0.8, h: 0.55 }, 0, 1);
  else if (c === "b") drawBat(ctx, { x: 0.15, y: 0.25, w: 0.7, h: 0.5 }, 0.3);
  else if (c === "c") drawCannon(ctx, 0.05, -0.05, -1);
  else if (c === "S") { ctx.setTransform(size * 0.7, 0, 0, size * 0.7, size * 0.15, size * 0.28); drawDoor(ctx, 0, 0.1); }
  else if (c === "F") { ctx.setTransform(size * 0.6, 0, 0, size * 0.6, size * 0.05, size * 0.75); drawFlag(ctx, 0, 0, 0); }
  else if (c === "K") {
    const def = BOSSES[bossKind];
    const s = 0.85 / Math.max(def.w, def.h + 0.4);
    ctx.setTransform(size * s, 0, 0, size * s, size * (0.5 - (def.w * s) / 2), size * 0.08);
    drawBoss(ctx, { alive: true, kind: bossKind, facing: 1, invuln: 0, breath: 0, body: { x: 0, y: 0.45, w: def.w, h: def.h } }, 0);
  } else {
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(0.25, 0.25); ctx.lineTo(0.75, 0.75);
    ctx.moveTo(0.75, 0.25); ctx.lineTo(0.25, 0.75);
    ctx.stroke();
  }
}
