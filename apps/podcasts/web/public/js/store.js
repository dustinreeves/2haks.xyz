// Everything personal (follows, queue, where you stopped) lives in this browser only.

const KEY = "podpile:v1";
const MAX_PROGRESS = 400;

const blank = () => ({ follows: [], queue: [], progress: {}, now: null, settings: { speed: 1, hideExplicit: true } });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* private window or blocked storage: start fresh */ }
  return blank();
}

const state = load();
let saveTimer;

function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full or blocked */ }
  };
  if (now) write();
  else saveTimer = setTimeout(write, 300);
  document.dispatchEvent(new CustomEvent("store:change"));
}
addEventListener("pagehide", () => save(true));

// An episode as the player needs it, small enough to keep in the queue and history.
export function epRef(show, ep) {
  return {
    key: `${show.id}:${ep.id}`,
    showId: show.id,
    show: show.name,
    title: ep.title,
    audio: ep.audio,
    type: ep.type,
    art: ep.image || show.artwork,
    showArt: show.artwork,
    duration: ep.duration || 0,
    published: ep.published,
  };
}

export const store = {
  settings: state.settings,
  saveSettings() { save(); },

  // Follows
  follows: () => state.follows,
  isFollowing: (id) => state.follows.some((f) => f.id === id),
  toggleFollow(show) {
    const i = state.follows.findIndex((f) => f.id === show.id);
    if (i >= 0) state.follows.splice(i, 1);
    else state.follows.unshift({ id: show.id, name: show.name, author: show.author, artwork: show.artwork, explicit: !!show.explicit });
    save();
    return i < 0;
  },

  // Progress: seconds listened, keyed by episode key
  progress: (key) => state.progress[key],
  setProgress(ref, pos, dur, done = false) {
    const p = state.progress[ref.key] || {};
    state.progress[ref.key] = { pos: Math.floor(pos), dur: Math.floor(dur || p.dur || ref.duration || 0), done: done || p.done || false, at: Date.now(), ref };
    if (done) state.progress[ref.key].pos = 0;
    const keys = Object.keys(state.progress);
    if (keys.length > MAX_PROGRESS) {
      keys.sort((a, b) => state.progress[a].at - state.progress[b].at);
      for (const k of keys.slice(0, keys.length - MAX_PROGRESS)) delete state.progress[k];
    }
    save();
  },
  markPlayed(ref, played) {
    if (played) this.setProgress(ref, 0, 0, true);
    else { delete state.progress[ref.key]; save(); }
  },
  inProgress(limit = 10) {
    return Object.values(state.progress)
      .filter((p) => !p.done && p.pos > 15 && p.ref)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  },
  history(limit = 30) {
    return Object.values(state.progress).filter((p) => p.ref).sort((a, b) => b.at - a.at).slice(0, limit);
  },

  // Queue
  queue: () => state.queue,
  inQueue: (key) => state.queue.some((q) => q.key === key),
  enqueue(ref, next = false) {
    if (this.inQueue(ref.key)) return false;
    next ? state.queue.unshift(ref) : state.queue.push(ref);
    save();
    return true;
  },
  dequeue(key) {
    const i = state.queue.findIndex((q) => q.key === key);
    if (i >= 0) { state.queue.splice(i, 1); save(); }
  },
  moveUp(key) {
    const i = state.queue.findIndex((q) => q.key === key);
    if (i > 0) { [state.queue[i - 1], state.queue[i]] = [state.queue[i], state.queue[i - 1]]; save(); }
  },
  shift() {
    const next = state.queue.shift();
    save();
    return next;
  },

  // Now playing (so the bar comes back after a reload)
  now: () => state.now,
  setNow(ref) { state.now = ref; save(); },
};
