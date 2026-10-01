// Game rules and balance numbers. Units are tiles and seconds unless noted.
// The API validates shared levels with the same tile set, sizes and MAX_BUDGET
// (api/app/levels.py). Change both together.

export const TILE = 32;         // pixels per tile
export const W = 64;            // level width in tiles
export const H = 18;            // level height in tiles
export const DT = 1 / 60;       // fixed physics step

export const PHYS = {
  gravity: 42,
  runSpeed: 6,
  jumpSpeed: 14,
  jumpCut: 5,       // releasing jump early caps upward speed to this
  maxFall: 18,
};

export const HERO_SIZE = { w: 0.6, h: 0.85 };
export const STOMP_BOUNCE = 10;
export const COINS_PER_HERO = 5;

// Tiles. `cost` is trap points; `unlock` is the shop id that unlocks it.
export const TILES = {
  ".": { name: "Eraser", cost: 0 },
  "#": { name: "Block", cost: 0, solid: true, tip: "Solid ground. Free!" },
  "^": { name: "Spikes", cost: 1, hazard: true, tip: "Heroes who touch them are out." },
  "~": { name: "Lava", cost: 2, hazard: true, unlock: "lava", tip: "Hot! Put it in pits." },
  "s": { name: "Slime", cost: 3, minion: true, tip: "Walks back and forth. Can be stomped." },
  "b": { name: "Bat", cost: 4, minion: true, unlock: "bat", tip: "Flies in a wavy line. Can be stomped." },
  "c": { name: "Cannon", cost: 5, solid: true, unlock: "cannon", tip: "Shoots cannonballs at heroes." },
  "S": { name: "Hero Door", cost: 0, unique: true, tip: "Where heroes come in." },
  "F": { name: "Flag", cost: 0, unique: true, tip: "Heroes win if they touch it." },
  "K": { name: "Boss Spot", cost: 0, unique: true, tip: "Where your boss starts." },
};
export const PALETTE = ["#", "^", "~", "s", "b", "c", "S", "F", "K", "."];

export const BOSSES = {
  slime_king: {
    name: "Slime King", w: 1.8, h: 1.4, speed: 5, jump: 13, hp: 6, cooldown: 1.4,
    attack: "pound", attackName: "Ground Pound",
    tip: "Jumps and slams down, sending shockwaves along the ground.",
  },
  fire_golem: {
    name: "Fire Golem", w: 1.4, h: 2, speed: 4.5, jump: 12, hp: 8, cooldown: 0.7,
    attack: "fireball", attackName: "Fireball", unlock: "fire_golem",
    tip: "Slow but tough. Throws fireballs.",
  },
  shadow_dragon: {
    name: "Shadow Dragon", w: 2.2, h: 1.3, speed: 6, jump: 0, hp: 7, cooldown: 1.6,
    attack: "breath", attackName: "Shadow Breath", unlock: "shadow_dragon", flies: true,
    tip: "Flies anywhere and breathes shadow fire.",
  },
};

export const BASE_BUDGET = 20;
export const BUDGET_STEP = 10;

export const UNLOCKS = {
  lava: { name: "Lava", price: 15 },
  bat: { name: "Bat", price: 25 },
  cannon: { name: "Cannon", price: 40 },
  fire_golem: { name: "Fire Golem", price: 60 },
  shadow_dragon: { name: "Shadow Dragon", price: 150 },
};

export const UPGRADES = {
  budget: { name: "Trap Points", desc: `+${BUDGET_STEP} trap points`, prices: [10, 20, 35, 50, 70] },
  health: { name: "Boss Health", desc: "+1 boss heart", prices: [15, 25, 40, 55, 75] },
  speed: { name: "Boss Speed", desc: "+8% boss speed", prices: [20, 40, 70] },
  cooldown: { name: "Quick Attack", desc: "Attack and squish 12% more often", prices: [20, 40, 70] },
};

// Effect of each upgrade level (used by boss.js).
export const UPGRADE_EFFECT = { health: 1, speed: 0.08, cooldown: 0.88 };

export const MAX_BUDGET = BASE_BUDGET + BUDGET_STEP * UPGRADES.budget.prices.length; // 70

export const HERO_TYPES = {
  // aimError: tiles off when lining up a jump; choiceNoise: frames of randomness when
  // picking a move; randomPick: chance of a random move; patience: seconds a hero will
  // wait for a flying danger to pass; react: chance to jump at a danger in the way.
  rookie: { name: "Rookie", color: "#4ade80", aimError: 0.3, choiceNoise: 40, randomPick: 0.2, patience: 0, react: 0.35 },
  knight: { name: "Knight", color: "#60a5fa", aimError: 0.1, choiceNoise: 10, randomPick: 0.05, patience: 0.8, react: 0.7 },
  champion: { name: "Champion", color: "#fbbf24", aimError: 0.02, choiceNoise: 0, randomPick: 0, patience: 2, react: 0.95 },
};

export function waveHeroes(wave) {
  const count = Math.min(8 + 3 * wave, 48);
  const champion = Math.round(count * Math.min(0.5, 0.06 * (wave - 1)));
  const knight = Math.round(count * Math.min(0.5, 0.15 + 0.07 * wave));
  const rookie = Math.max(0, count - champion - knight);
  return { count, rookie, knight, champion };
}
