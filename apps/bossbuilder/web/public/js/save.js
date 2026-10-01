// Progress is kept in this browser only (localStorage). Every access is guarded:
// storage can be blocked or full, and the game must still run.

import { UNLOCKS, UPGRADES } from "./rules.js";
import { defaultLevel, shapeError } from "./level.js";

const KEY = "bossbuilder.save.v1";

export function newSave() {
  return {
    coins: 0,
    wave: 1,
    unlocked: [],
    upgrades: {},
    level: defaultLevel(),
    stats: { waves: 0, defeated: 0, escaped: 0 },
    autoBoss: false,
    seenHelp: false,
  };
}

const wholeNumber = (n, max = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(n) && n >= 0 && n <= max;

function clean(raw) {
  const save = newSave();
  if (!raw || typeof raw !== "object") return save;
  if (wholeNumber(raw.coins)) save.coins = raw.coins;
  if (wholeNumber(raw.wave) && raw.wave >= 1) save.wave = raw.wave;
  if (Array.isArray(raw.unlocked)) save.unlocked = raw.unlocked.filter((id) => id in UNLOCKS);
  if (raw.upgrades && typeof raw.upgrades === "object") {
    for (const [id, def] of Object.entries(UPGRADES)) {
      if (wholeNumber(raw.upgrades[id], def.prices.length)) save.upgrades[id] = raw.upgrades[id];
    }
  }
  if (!shapeError(raw.level)) save.level = raw.level;
  if (raw.stats && typeof raw.stats === "object") {
    for (const k of Object.keys(save.stats)) if (wholeNumber(raw.stats[k])) save.stats[k] = raw.stats[k];
  }
  save.autoBoss = raw.autoBoss === true;
  save.seenHelp = raw.seenHelp === true;
  return save;
}

export function loadSave() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? clean(JSON.parse(text)) : newSave();
  } catch {
    return newSave();
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
