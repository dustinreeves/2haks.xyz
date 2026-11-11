// Fire Pong rules. No graphics in here, so the game logic can run (and be tested) on its own.
//
// The table lies along the x axis: player 0 is on the left (x < 0), player 1 on the right.
// Paddles slide along z (up/down on the screen). y is up, but the game is flat.
// Units are metres; time is seconds.

export const TABLE = { halfLength: 8, halfWidth: 5 };
export const WIN_SCORE = 7;
export const BALL_R = 0.25;
export const PADDLE = { x: 7.4, halfThick: 0.15, baseHalf: 1.0, speed: 9 };
export const SPEED = { start: 8, max: 18, gain: 1.04 };
export const MAX_BALLS = 5;
export const ITEM = { radius: 0.55, life: 12, maxOnTable: 2 };
export const PORTAL_R = 0.7;
export const MAGNET_HOLD = 1.5;

const MAX_STEP = 1 / 120;       // never move further than this in one go, so fast balls can't skip a paddle
const MAX_FRAME = 1 / 20;       // a long pause (slow tab) must not make the ball jump

export const AI_LEVELS = {
  easy:   { react: 0.30, error: 1.5,  speed: 0.60 },
  normal: { react: 0.15, error: 0.7,  speed: 0.85 },
  hard:   { react: 0.06, error: 0.25, speed: 1.00 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Bounce a z position back and forth inside [-lim, lim] (a ball's path with wall bounces unfolded). */
export function foldZ(z, lim) {
  const width = 2 * lim;
  let u = (z + lim) % (2 * width);
  if (u < 0) u += 2 * width;
  if (u > width) u = 2 * width - u;
  return u - lim;
}

/**
 * Start a new match.
 *   defs      power-up definitions from the API (see content/powerups/*.json)
 *   powerups  false = plain Pong
 *   rng       a function returning 0..1 (pass your own to make tests repeatable)
 */
export function newGame({ defs = [], powerups = true, rng = Math.random, target = WIN_SCORE } = {}) {
  const side = (i) => ({ x: i === 0 ? -PADDLE.x : PADDLE.x, z: 0, half: PADDLE.baseHalf, input: 0 });
  return {
    t: 0,
    rng,
    defs,
    powerupsOn: powerups && defs.length > 0,
    target,
    score: [0, 0],
    over: false,
    winner: null,
    paddles: [side(0), side(1)],
    balls: [],
    items: [],
    effects: [],            // { id, effect, player (who it affects), left, amount }
    shields: [0, 0],        // seconds left on each player's shield
    magnet: [0, 0],         // catches left
    magnetLeft: [0, 0],
    portals: null,          // { left, a: {x, z}, b: {x, z} }
    lastHit: null,
    serveTimer: 1.2,
    serveDir: rng() < 0.5 ? -1 : 1,
    nextSpawn: 4 + rng() * 3,
    nextItemId: 1,
    events: [],
  };
}

function pickDef(game) {
  const total = game.defs.reduce((sum, d) => sum + d.weight, 0);
  let roll = game.rng() * total;
  for (const d of game.defs) {
    roll -= d.weight;
    if (roll < 0) return d;
  }
  return game.defs[game.defs.length - 1];
}

/** Put a power-up on the table (the game does this by itself every few seconds). */
export function spawnItem(game, def = pickDef(game)) {
  game.items.push({
    id: game.nextItemId++,
    def,
    x: (game.rng() - 0.5) * 7,
    z: (game.rng() - 0.5) * 7.4,
    life: ITEM.life,
  });
}

function addEffect(game, def, player, amount = def.amount) {
  // Picking up the same thing again just refreshes the clock.
  const old = game.effects.find((e) => e.effect === def.effect && e.player === player);
  if (old) {
    old.left = def.duration;
    old.amount = amount;
  } else {
    game.effects.push({ id: def.id, effect: def.effect, color: def.color, name: def.name, player,
      left: def.duration, amount });
  }
}

function applyPowerup(game, def, player) {
  const other = 1 - player;
  switch (def.effect) {
    case "big_paddle": addEffect(game, def, player); break;
    case "tiny_foe": addEffect(game, def, other); break;
    case "slow_mo": addEffect(game, def, player); break;
    case "fireball": addEffect(game, def, player); break;
    case "multiball": {
      const main = game.balls.find((b) => !b.stuck) || game.balls[0];
      if (!main) break;
      const extra = Math.round(def.amount);
      for (let i = 0; i < extra && game.balls.length < MAX_BALLS; i++) {
        const spin = (i % 2 === 0 ? 1 : -1) * (0.3 + 0.15 * Math.floor(i / 2));
        const dx = main.dx * Math.cos(spin) - main.dz * Math.sin(spin);
        const dz = main.dx * Math.sin(spin) + main.dz * Math.cos(spin);
        game.balls.push({ x: main.x, z: main.z, dx, dz, speed: main.speed, bonus: true, cool: 0.3, stuck: null,
          stuckT: 0 });
      }
      break;
    }
    case "shield": game.shields[player] = def.duration; break;
    case "magnet":
      game.magnet[player] = Math.round(def.amount);
      game.magnetLeft[player] = def.duration;
      break;
    case "portals": {
      const za = (game.rng() - 0.5) * 7;
      let zb = (game.rng() - 0.5) * 7;
      if (Math.abs(za - zb) < 2.5) zb = za > 0 ? za - 3 : za + 3;
      game.portals = { left: def.duration, a: { x: -2, z: za }, b: { x: 2, z: zb } };
      break;
    }
    default: break;   // an effect this version of the game doesn't know: ignore it
  }
}

/** The multiplier an effect type currently gives (for paddles: per player). */
function paddleScale(game, player) {
  let scale = 1;
  for (const e of game.effects) {
    if (e.player !== player) continue;
    if (e.effect === "big_paddle" || e.effect === "tiny_foe") scale *= e.amount;
  }
  return scale;
}

function ballFactor(game) {
  let f = 1;
  for (const e of game.effects) {
    if (e.effect === "slow_mo") f = Math.min(f, e.amount);
  }
  for (const e of game.effects) {
    if (e.effect === "fireball") f *= e.amount;
  }
  return f;
}

function serve(game) {
  const angle = (game.rng() - 0.5) * 0.9;
  game.balls = [{
    x: 0, z: (game.rng() - 0.5) * 4,
    dx: Math.cos(angle) * game.serveDir, dz: Math.sin(angle),
    speed: SPEED.start, bonus: false, cool: 0, stuck: null, stuckT: 0,
  }];
  game.lastHit = null;
  game.events.push({ type: "serve" });
}

function point(game, scorer, ball) {
  game.score[scorer]++;
  game.events.push({ type: "score", player: scorer, x: ball.x, z: ball.z });
  // A clean slate for the next point.
  game.balls = [];
  game.items = [];
  game.effects = [];
  game.shields = [0, 0];
  game.magnet = [0, 0];
  game.magnetLeft = [0, 0];
  game.portals = null;
  game.serveTimer = 1.2;
  game.serveDir = scorer === 0 ? 1 : -1;   // the player who just lost gets the ball
  game.nextSpawn = game.t + 4 + game.rng() * 3;
  if (game.score[scorer] >= game.target) {
    game.over = true;
    game.winner = scorer;
    game.events.push({ type: "over", winner: scorer });
  }
}

function paddleHit(game, ball, p) {
  const pad = game.paddles[p];
  const dir = p === 0 ? 1 : -1;
  const offset = clamp((ball.z - pad.z) / pad.half, -1, 1);
  const angle = offset * 0.96;            // up to about 55 degrees
  ball.dx = Math.cos(angle) * dir;
  ball.dz = Math.sin(angle);
  ball.x = pad.x + dir * (PADDLE.halfThick + BALL_R);
  ball.speed = Math.min(SPEED.max, ball.speed * SPEED.gain);
  game.lastHit = p;
  if (game.magnet[p] > 0) {
    game.magnet[p]--;
    ball.stuck = p;
    ball.stuckT = MAGNET_HOLD;
    game.events.push({ type: "catch", player: p, x: ball.x, z: ball.z });
  } else {
    game.events.push({ type: "hit", player: p, x: ball.x, z: ball.z, speed: ball.speed });
  }
}

function stepBall(game, ball, h, input) {
  if (ball.stuck !== null) {
    const p = ball.stuck;
    const pad = game.paddles[p];
    ball.z = pad.z;
    ball.x = pad.x + (p === 0 ? 1 : -1) * (PADDLE.halfThick + BALL_R + 0.01);
    ball.stuckT -= h;
    if (input.release[p] || ball.stuckT <= 0) {
      const angle = clamp(pad.input, -1, 1) * 0.6;
      ball.dx = Math.cos(angle) * (p === 0 ? 1 : -1);
      ball.dz = Math.sin(angle);
      ball.stuck = null;
      ball.cool = 0.2;
      game.events.push({ type: "release", player: p });
    }
    return null;
  }

  const v = ball.speed * ballFactor(game);
  ball.x += ball.dx * v * h;
  ball.z += ball.dz * v * h;
  ball.cool = Math.max(0, ball.cool - h);

  const zLim = TABLE.halfWidth - BALL_R;
  if (ball.z > zLim) { ball.z = zLim; ball.dz = -Math.abs(ball.dz); game.events.push({ type: "wall", x: ball.x, z: ball.z }); }
  if (ball.z < -zLim) { ball.z = -zLim; ball.dz = Math.abs(ball.dz); game.events.push({ type: "wall", x: ball.x, z: ball.z }); }

  if (game.portals && ball.cool <= 0) {
    const { a, b } = game.portals;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (Math.hypot(ball.x - from.x, ball.z - from.z) < PORTAL_R) {
        ball.x = to.x;
        ball.z = to.z;
        ball.cool = 0.5;
        game.events.push({ type: "portal", x: to.x, z: to.z, from: { x: from.x, z: from.z } });
        break;
      }
    }
  }

  for (let p = 0; p < 2; p++) {
    const pad = game.paddles[p];
    const dir = p === 0 ? 1 : -1;
    const movingToward = ball.dx * dir < 0;
    const faceX = pad.x + dir * PADDLE.halfThick;
    const reached = dir === 1 ? ball.x - BALL_R <= faceX : ball.x + BALL_R >= faceX;
    const notPast = dir === 1 ? ball.x >= pad.x - PADDLE.halfThick : ball.x <= pad.x + PADDLE.halfThick;
    if (movingToward && reached && notPast && Math.abs(ball.z - pad.z) <= pad.half + BALL_R * 0.6) {
      paddleHit(game, ball, p);
      return null;
    }
  }

  // Past a goal line?
  for (let p = 0; p < 2; p++) {
    const out = p === 0 ? ball.x < -TABLE.halfLength : ball.x > TABLE.halfLength;
    if (!out) continue;
    if (game.shields[p] > 0) {
      game.shields[p] = 0;
      ball.dx = p === 0 ? Math.abs(ball.dx) : -Math.abs(ball.dx);
      ball.x = p === 0 ? -TABLE.halfLength + BALL_R : TABLE.halfLength - BALL_R;
      game.events.push({ type: "shield", player: p, x: ball.x, z: ball.z });
      return null;
    }
    return { out: true, loser: p };
  }
  return null;
}

/**
 * Move the game forward `dt` seconds.
 *   input = { move: [p0, p1], release: [bool, bool] }   move: -1..1 along z (+1 = down the screen)
 * Things that happened (hit, score, pickup...) are left in game.events; clear it after reading.
 */
export function step(game, dt, input) {
  if (game.over) return;
  dt = Math.min(dt, MAX_FRAME);
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / steps;
  for (let i = 0; i < steps && !game.over; i++) substep(game, h, input);
}

function substep(game, h, input) {
  game.t += h;

  for (let p = 0; p < 2; p++) {
    const pad = game.paddles[p];
    const target = PADDLE.baseHalf * paddleScale(game, p);
    pad.half += (target - pad.half) * Math.min(1, h * 10);
    pad.input = clamp(input.move[p] || 0, -1, 1);
    pad.z = clamp(pad.z + pad.input * PADDLE.speed * h, -(TABLE.halfWidth - pad.half), TABLE.halfWidth - pad.half);
  }

  for (const e of game.effects) e.left -= h;
  game.effects = game.effects.filter((e) => e.left > 0);
  for (let p = 0; p < 2; p++) {
    if (game.shields[p] > 0) game.shields[p] = Math.max(0, game.shields[p] - h);
    if (game.magnetLeft[p] > 0) {
      game.magnetLeft[p] -= h;
      if (game.magnetLeft[p] <= 0) game.magnet[p] = 0;
    }
  }
  if (game.portals) {
    game.portals.left -= h;
    if (game.portals.left <= 0) game.portals = null;
  }

  if (game.balls.length === 0) {
    game.serveTimer -= h;
    if (game.serveTimer <= 0) serve(game);
    return;
  }

  // Power-ups appear on the table while a ball is in play.
  if (game.powerupsOn && game.t >= game.nextSpawn && game.items.length < ITEM.maxOnTable) {
    spawnItem(game);
    game.nextSpawn = game.t + 5 + game.rng() * 5;
  }
  for (const item of game.items) item.life -= h;
  game.items = game.items.filter((it) => it.life > 0);

  for (const ball of [...game.balls]) {
    const result = stepBall(game, ball, h, input);
    if (result && result.out) {
      if (ball.bonus) {
        game.balls.splice(game.balls.indexOf(ball), 1);
        game.events.push({ type: "bonus-lost", x: ball.x, z: ball.z });
      } else {
        point(game, 1 - result.loser, ball);
        return;
      }
    }
  }
  // The main ball is gone but bonus balls remain: the oldest one becomes the main ball.
  if (game.balls.length > 0 && game.balls.every((b) => b.bonus)) game.balls[0].bonus = false;

  // Pick up power-ups: the player who hit the ball last gets them.
  if (game.lastHit !== null) {
    for (const ball of game.balls) {
      for (const item of [...game.items]) {
        if (Math.hypot(ball.x - item.x, ball.z - item.z) <= ITEM.radius + BALL_R) {
          game.items.splice(game.items.indexOf(item), 1);
          applyPowerup(game, item.def, game.lastHit);
          game.events.push({ type: "pickup", player: game.lastHit, def: item.def, x: item.x, z: item.z });
        }
      }
    }
  }
}

/**
 * The computer player. Call it every frame; it "thinks" only now and then, like a person.
 *   mem = {} (keep the same object between calls)
 * Returns { move, release } for `side`.
 */
export function aiInput(game, side, level, mem, dt) {
  const cfg = AI_LEVELS[level] || AI_LEVELS.normal;
  const pad = game.paddles[side];
  mem.wait = (mem.wait ?? 0) - dt;
  if (mem.wait <= 0 || mem.target === undefined) {
    mem.wait = cfg.react;
    const toward = side === 0 ? -1 : 1;            // which way a ball is travelling to reach us
    let best = null;
    for (const b of game.balls) {
      if (b.stuck !== null || b.dx * toward <= 0) continue;
      const dist = Math.abs(b.x - pad.x);
      if (!best || dist < best.dist) best = { ball: b, dist };
    }
    if (best) {
      const b = best.ball;
      const zAt = b.z + (b.dz / Math.abs(b.dx)) * best.dist;
      const wrong = (game.rng() - 0.5) * 2 * cfg.error * Math.min(1, best.dist / 8 + 0.3);
      mem.target = foldZ(zAt, TABLE.halfWidth - BALL_R) + wrong;
    } else {
      mem.target = 0;
    }
  }
  const diff = mem.target - pad.z;
  const move = clamp(diff / 0.6, -1, 1) * cfg.speed;
  const holding = game.balls.some((b) => b.stuck === side && b.stuckT < MAGNET_HOLD - 0.7);
  return { move, release: holding };
}
