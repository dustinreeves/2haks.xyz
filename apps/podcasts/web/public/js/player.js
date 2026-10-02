// The bottom player. The <audio> element streams straight from the creator's host:
// this site never touches the audio.

import { store } from "./store.js";
import { clock, toast } from "./util.js";

const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2];
const SLEEPS = [0, 15, 30, 60, -1]; // minutes; -1 = end of episode
const $ = (id) => document.getElementById(id);

const audio = $("audio");
const bar = $("player");
const seek = $("p-seek");
let current = null;
let pendingSeek = 0;
let lastSaved = 0;
let dragging = false;
let sleepIdx = 0;
let sleepTimer = null;

function emit() {
  document.dispatchEvent(new CustomEvent("player:change", { detail: { key: current?.key, playing: isPlaying() } }));
}

export const isPlaying = () => !!current && !audio.paused && !audio.ended;
export const currentKey = () => current?.key;

function saveProgress(force = false) {
  if (!current || !isFinite(audio.currentTime) || audio.currentTime < 1) return;
  const now = Date.now();
  if (!force && now - lastSaved < 5000) return;
  lastSaved = now;
  store.setProgress(current, audio.currentTime, audio.duration);
}

function paintTime() {
  const dur = isFinite(audio.duration) ? audio.duration : current?.duration || 0;
  const pos = audio.currentTime || pendingSeek || 0;
  $("p-pos").textContent = clock(pos);
  $("p-dur").textContent = clock(dur);
  if (!dragging) seek.value = dur ? Math.round((pos / dur) * 1000) : 0;
  seek.style.setProperty("--pct", `${(seek.value / 10).toFixed(1)}%`);
  let buf = 0;
  if (dur && audio.buffered.length) buf = (audio.buffered.end(audio.buffered.length - 1) / dur) * 100;
  seek.style.setProperty("--buf", `${Math.max(buf, seek.value / 10).toFixed(1)}%`);
}

function paintInfo() {
  $("p-title").textContent = current.title;
  $("p-show").textContent = current.show;
  $("p-art").src = current.art || current.showArt || "favicon.svg";
  $("p-info").href = `#/p/${current.showId}`;
  $("p-next").hidden = store.queue().length === 0;
  document.title = `${current.title} · Pod Pile`;
  if ("mediaSession" in navigator) {
    const src = current.art || current.showArt;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.show,
      album: "Pod Pile",
      artwork: src ? [{ src, sizes: "600x600" }] : [],
    });
  }
}

function paintState() {
  bar.classList.toggle("playing", isPlaying());
  $("p-play").setAttribute("aria-label", isPlaying() ? "Pause" : "Play");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";
  emit();
}

export function load(ref, { autoplay = true } = {}) {
  if (current) saveProgress(true);
  current = ref;
  const p = store.progress(ref.key);
  pendingSeek = p && !p.done ? p.pos : 0;
  audio.src = ref.audio;
  audio.playbackRate = store.settings.speed;
  bar.hidden = false;
  store.setNow(ref);
  paintInfo();
  paintTime();
  if (autoplay) play();
  else paintState();
}

export function play() {
  if (!current) return;
  bar.classList.add("loading");
  const p = audio.play();
  if (p) p.catch((e) => {
    bar.classList.remove("loading");
    if (e.name !== "AbortError" && e.name !== "NotAllowedError") toast("Couldn't play that episode.");
    paintState();
  });
}

export function toggle(ref) {
  if (ref && ref.key !== current?.key) return load(ref);
  if (isPlaying()) audio.pause();
  else play();
}

export function skip(sec) {
  if (!current) return;
  const dur = isFinite(audio.duration) ? audio.duration : Infinity;
  audio.currentTime = Math.max(0, Math.min(dur - 1, (audio.currentTime || 0) + sec));
  paintTime();
}

export function playNext() {
  const next = store.shift();
  if (next) load(next);
  else $("p-next").hidden = true;
}

function setSleep(i) {
  sleepIdx = i;
  clearTimeout(sleepTimer);
  const m = SLEEPS[i];
  const btn = $("p-sleep");
  btn.classList.toggle("on", m !== 0);
  btn.textContent = m === 0 ? "Sleep" : m === -1 ? "Sleep: end" : `Sleep: ${m}m`;
  if (m > 0) sleepTimer = setTimeout(() => { audio.pause(); setSleep(0); toast("Sleep timer: paused. Night night!"); }, m * 60000);
}

// Audio events
audio.addEventListener("loadedmetadata", () => {
  if (pendingSeek && pendingSeek < audio.duration - 5) audio.currentTime = pendingSeek;
  pendingSeek = 0;
  paintTime();
});
audio.addEventListener("timeupdate", () => { paintTime(); saveProgress(); });
audio.addEventListener("progress", paintTime);
audio.addEventListener("playing", () => { bar.classList.remove("loading"); paintState(); });
audio.addEventListener("waiting", () => bar.classList.add("loading"));
audio.addEventListener("pause", () => { bar.classList.remove("loading"); saveProgress(true); paintState(); });
audio.addEventListener("ended", () => {
  store.setProgress(current, 0, audio.duration, true);
  paintState();
  if (SLEEPS[sleepIdx] === -1) { setSleep(0); toast("Sleep timer: done for tonight."); return; }
  playNext();
});
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  bar.classList.remove("loading");
  toast("The creator's server didn't send this episode. Try another one, or again later.");
  paintState();
});

// Controls
$("p-play").addEventListener("click", () => toggle());
$("p-back").addEventListener("click", () => skip(-15));
$("p-fwd").addEventListener("click", () => skip(30));
$("p-next").addEventListener("click", playNext);
$("p-speed").addEventListener("click", () => {
  const i = (SPEEDS.indexOf(store.settings.speed) + 1) % SPEEDS.length;
  store.settings.speed = SPEEDS[i];
  store.saveSettings();
  audio.playbackRate = SPEEDS[i];
  paintSpeed();
});
$("p-sleep").addEventListener("click", () => setSleep((sleepIdx + 1) % SLEEPS.length));

function paintSpeed() {
  const s = store.settings.speed;
  $("p-speed").textContent = `${s}×`;
  $("p-speed").classList.toggle("on", s !== 1);
}

seek.addEventListener("input", () => {
  dragging = true;
  const dur = isFinite(audio.duration) ? audio.duration : current?.duration || 0;
  $("p-pos").textContent = clock((seek.value / 1000) * dur);
  seek.style.setProperty("--pct", `${(seek.value / 10).toFixed(1)}%`);
});
seek.addEventListener("change", () => {
  dragging = false;
  const dur = isFinite(audio.duration) ? audio.duration : 0;
  if (dur) audio.currentTime = (seek.value / 1000) * dur;
  else if (current) { pendingSeek = (seek.value / 1000) * (current.duration || 0); play(); }
});

document.addEventListener("keydown", (e) => {
  if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.("input, textarea, select, [contenteditable]") || (t.closest?.("button, a, summary") && e.key === " ")) return;
  if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
  else if (e.key === "ArrowLeft" || e.key === "j") skip(-15);
  else if (e.key === "ArrowRight" || e.key === "l") skip(30);
});

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
  set("play", () => play());
  set("pause", () => audio.pause());
  set("seekbackward", (d) => skip(-(d.seekOffset || 15)));
  set("seekforward", (d) => skip(d.seekOffset || 30));
  set("seekto", (d) => { audio.currentTime = d.seekTime; });
  set("nexttrack", () => { if (store.queue().length) playNext(); });
}

document.addEventListener("store:change", () => { if (current) $("p-next").hidden = store.queue().length === 0; });

// Bring back what was playing last time (paused, at the same spot).
paintSpeed();
const last = store.now();
if (last) load(last, { autoplay: false });
