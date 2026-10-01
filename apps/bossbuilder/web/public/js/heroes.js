// Hero AI. On the ground a hero picks a move from the nav graph, walks to the
// exact start spot (plus its aim error), waits if danger is close, then
// replays the move's inputs until it lands.

import { DT, PHYS, HERO_TYPES, HERO_SIZE, STOMP_BOUNCE } from "./rules.js";
import { stepActor, centerX } from "./physics.js";
import { TEMPLATES, GOAL, heroBodyAt, nodeUnder, templateStep } from "./nav.js";

const FIRST = ["Sir", "Lady", "Captain", "Little", "Brave", "Sneaky", "Speedy", "Lord", "Dame"];
const LAST = ["Hops", "Pebble", "Bolt", "Biscuit", "Sprout", "Zip", "Waffles", "Noodle", "Pip", "Clank"];
const GIVE_UP_AFTER = 6; // seconds without making progress

let nextId = 1;

export function makeHero(type, start, rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return {
    id: nextId++,
    type,
    traits: HERO_TYPES[type],
    name: `${pick(FIRST)} ${pick(LAST)}`,
    body: heroBodyAt(start.x, start.y),
    alive: true,
    escaped: false,
    plan: null,
    bouncing: false,
    waited: 0,
    brave: false,
    nextRoll: 0,
    facing: 1,
    bestDist: Infinity,
    stuckFor: 0,
  };
}

function choosePlan(hero, world, rand) {
  const { nav, grid } = world;
  const id = nodeUnder(grid, hero.body);
  const node = id === null ? null : nav.nodes.get(id);
  if (!node) return null;

  const options = node.edges.filter((e) => e.to === GOAL || nav.dist.has(e.to));
  if (!options.length) return null;

  const t = hero.traits;
  let edge;
  if (rand() < t.randomPick) {
    edge = options[Math.floor(rand() * options.length)];
  } else {
    let best = Infinity;
    for (const e of options) {
      const score = e.frames + (e.to === GOAL ? 0 : nav.dist.get(e.to)) + rand() * t.choiceNoise;
      if (score < best) { best = score; edge = e; }
    }
  }

  const progress = nav.dist.get(id);
  if (progress < hero.bestDist) {
    hero.bestDist = progress;
    hero.stuckFor = 0;
  }
  return {
    node,
    tpl: TEMPLATES[edge.tpl],
    aimX: node.x + 0.5 + (rand() * 2 - 1) * t.aimError,
    running: false,
    st: null,
  };
}

const LOOK_AHEAD = 5;

// The closest danger in front of the hero, at about the same height.
function threatAhead(hero, world) {
  const b = hero.body;
  const hx = centerX(b), feet = b.y + b.h;
  let best = null;
  for (const d of world.dangers) {
    const dx = (d.x - hx) * hero.facing;
    if (dx < -0.3 || dx > LOOK_AHEAD || d.top > feet + 0.2 || d.bottom < b.y - 0.5) continue;
    if (!best || dx < best.dx) best = { dx, flying: d.flying, halfW: d.halfW, height: feet - d.top };
  }
  return best;
}

// Distances (centre to centre) from which a full forward jump clears the
// danger's front edge on the way up, without landing short of it.
function jumpWindow(threat) {
  const { runSpeed, jumpSpeed, gravity } = PHYS;
  const reach = threat.halfW + HERO_SIZE.w / 2;
  const h = Math.max(0, threat.height) + 0.1;
  const disc = jumpSpeed * jumpSpeed - 2 * gravity * h;
  if (disc < 0) return null; // too tall to jump over
  const tUp = (jumpSpeed - Math.sqrt(disc)) / gravity;
  const airTime = (2 * jumpSpeed) / gravity;
  const win = { min: reach + runSpeed * tUp + 0.15, max: reach + runSpeed * airTime * 0.85 };
  return win.min < win.max ? win : null;
}

// Jump at the danger, hoping to stomp it or clear it. Not checked against the
// nav graph, so a brave hero can land in a trap.
function braveJump(hero, world) {
  const tpl = { kind: "jump", dir: hero.facing, hold: 30 };
  hero.plan = { node: null, tpl, running: true, st: { frame: 0, airborne: false, startX: Math.floor(centerX(hero.body)) } };
  templateStep(hero.body, world.grid, tpl, hero.plan.st);
}

// Returns true if the hero dealt with a danger this frame (waited, lined up or jumped).
function reactToThreat(hero, world, rand) {
  const threat = threatAhead(hero, world);
  if (!threat) {
    hero.waited = 0;
    return false;
  }
  if (world.time >= hero.nextRoll) {
    hero.brave = rand() < hero.traits.react;
    hero.nextRoll = world.time + 1;
  }
  if (threat.flying && hero.waited < hero.traits.patience) {
    hero.waited += DT;
    hero.plan = null;
    stepActor(hero.body, { dir: 0, jump: false }, world.grid);
    return true;
  }
  const win = hero.brave && jumpWindow(threat);
  if (!win) return false;

  const sweet = (win.min + win.max) / 2;
  hero.plan = null;
  if (threat.dx >= win.min && threat.dx <= sweet + 0.02) {
    braveJump(hero, world);
  } else {
    // Line up: walk toward the sweet spot (backing off if too close).
    const move = Math.max(-1, Math.min(1, (threat.dx - sweet) / (PHYS.runSpeed * DT)));
    stepActor(hero.body, { dir: move * hero.facing, jump: false }, world.grid);
  }
  return true;
}

export function updateHero(hero, world, rand = Math.random) {
  const b = hero.body;
  hero.stuckFor += DT;

  // Dangers are checked whenever the hero is on the ground and not mid-jump.
  const midAir = hero.plan?.running && (hero.plan.st.airborne || hero.plan.tpl.kind === "jump");
  if (b.onGround && !midAir && reactToThreat(hero, world, rand)) return;

  if (hero.plan?.running) {
    const plan = hero.plan;
    const status = templateStep(b, world.grid, plan.tpl, plan.st);
    if (plan.tpl.dir) hero.facing = Math.sign(plan.tpl.dir);
    if (status !== "running") hero.plan = null;
    return;
  }

  let input = { dir: 0, jump: false };
  if (b.onGround) {
    hero.plan ??= choosePlan(hero, world, rand);
    const plan = hero.plan;
    if (plan?.tpl.dir) hero.facing = Math.sign(plan.tpl.dir);
    if (plan) {
      const d = plan.aimX - centerX(b);
      if (Math.abs(d) > 0.002) {
        input.dir = Math.max(-1, Math.min(1, d / (PHYS.runSpeed * DT)));
      } else {
        plan.running = true;
        plan.st = { frame: 0, airborne: false, startX: plan.node.x };
        if (templateStep(b, world.grid, plan.tpl, plan.st) !== "running") hero.plan = null;
        return;
      }
    } else {
      // Not on the map (standing on something odd): run toward the flag and hop.
      input = { dir: Math.sign(world.flag.x - centerX(b)) || 1, jump: rand() < 0.05 };
    }
  } else {
    // Airborne without a move (after a bounce or a push): drift forward.
    hero.plan = null;
    if (b.vy >= 0) hero.bouncing = false;
    input = { dir: hero.facing * 0.4, jump: hero.bouncing };
  }

  if (input.dir) hero.facing = Math.sign(input.dir);
  stepActor(b, input, world.grid);
}

export function heroGaveUp(hero) {
  return hero.stuckFor > GIVE_UP_AFTER;
}

// Bounce off something the hero stomped.
// "Holding jump" while bouncing stops stepActor from cutting the bounce short.
export function bounce(hero) {
  hero.body.vy = -STOMP_BOUNCE;
  hero.body.onGround = false;
  hero.bouncing = true;
  hero.plan = null;
}
