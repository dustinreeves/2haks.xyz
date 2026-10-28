// The thing in the Backrooms.
//
// You never see its face: it's a tall, thin, pitch-black shape that keeps to the haze. A flickering
// lamp always hangs behind it, so its long shadow reaches round corners before it does. It stalks
// you through the maze, slips away when you look straight at it, and now and then sneaks up right
// behind you. It can't hurt you. Its laboured breathing is made live with Web Audio (no recordings)
// and comes from wherever it is, muffled when there's a wall in between.
//
// Turn it off with `br_monster 0` in the console; `br_monster_volume` sets how loud it breathes.
import * as THREE from "./vendor/three-0.170.0.module.min.js";
import { castRay } from "./fireraze/index.js";

const V3 = THREE.Vector3;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- the breathing ----------

class Breathing {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.muffle = ctx.createBiquadFilter(); // walls in between: only the low part gets through
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 4000;
    this.panner = ctx.createPanner();       // sound comes from where it is
    Object.assign(this.panner, {
      panningModel: "HRTF", distanceModel: "inverse", refDistance: 1.5, rolloffFactor: 1.3, maxDistance: 40,
    });
    this.muffle.connect(this.panner).connect(this.master).connect(ctx.destination);
    // Two seconds of noise to shape into breaths.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.running = false;
    this.volume = 0.8;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.5);
    this._next();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  setVolume(v) {
    this.volume = v;
    if (this.running) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  // One breath: a struggling, catching inhale, a short hold, a long rattling exhale, then a pause.
  _next() {
    if (!this.running) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.05;
    const inhale = 0.9 + Math.random() * 0.6;
    const hold = 0.08 + Math.random() * 0.2;
    const exhale = 1.1 + Math.random() * 0.7;
    const pause = 0.25 + Math.random() * 1.1;
    const tIn = t0 + inhale;
    const tOut = tIn + hold + exhale;

    // Breath: noise through a band filter whose pitch rises on the inhale and falls on the exhale.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(700, t0);
    band.frequency.linearRampToValueAtTime(1700, tIn);
    band.frequency.setValueAtTime(1400, tIn + hold);
    band.frequency.linearRampToValueAtTime(600, tOut);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    // The inhale catches: it keeps stalling, like it can't get the air in.
    const catches = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= catches; i++) {
      const tc = t0 + (inhale * i) / (catches + 1);
      env.gain.linearRampToValueAtTime(0.5 * (i / catches), tc - 0.06);
      env.gain.linearRampToValueAtTime(0.08, tc);
    }
    env.gain.linearRampToValueAtTime(0.55, tIn);
    env.gain.linearRampToValueAtTime(0.0, tIn + hold);
    env.gain.linearRampToValueAtTime(0.5, tIn + hold + 0.15);
    env.gain.linearRampToValueAtTime(0.0, tOut);
    src.connect(band).connect(env).connect(this.muffle);
    src.start(t0);
    src.stop(tOut + 0.05);

    // Wheeze: a thin, wavering whistle on the inhale, and a low rattle on the exhale.
    const wheeze = ctx.createOscillator();
    wheeze.type = "sawtooth";
    wheeze.frequency.setValueAtTime(330, t0);
    wheeze.frequency.linearRampToValueAtTime(520 + Math.random() * 120, tIn);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 7 + Math.random() * 5;
    const wobbleAmt = ctx.createGain();
    wobbleAmt.gain.value = 18;
    wobble.connect(wobbleAmt).connect(wheeze.frequency);
    const wf = ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 900;
    wf.Q.value = 5;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t0);
    wg.gain.linearRampToValueAtTime(0.05, t0 + inhale * 0.6);
    wg.gain.linearRampToValueAtTime(0, tIn);
    wheeze.connect(wf).connect(wg).connect(this.muffle);
    const rattle = ctx.createOscillator();
    rattle.type = "square";
    rattle.frequency.value = 55 + Math.random() * 20;
    const rf = ctx.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 300;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0, tIn + hold);
    rg.gain.linearRampToValueAtTime(0.06, tIn + hold + 0.3);
    rg.gain.linearRampToValueAtTime(0, tOut);
    rattle.connect(rf).connect(rg).connect(this.muffle);
    for (const o of [wheeze, wobble, rattle]) { o.start(t0); o.stop(tOut + 0.05); }

    this.timer = setTimeout(() => this._next(), (tOut - ctx.currentTime + pause) * 1000);
  }

  place(pos, camera, muffled) {
    const p = this.panner;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(pos.x, t, 0.05);
      p.positionY.setTargetAtTime(pos.y, t, 0.05);
      p.positionZ.setTargetAtTime(pos.z, t, 0.05);
    } else p.setPosition(pos.x, pos.y, pos.z);
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const at = new V3(-e[8], -e[9], -e[10]);
    const up = new V3(e[4], e[5], e[6]);
    const me = new V3().setFromMatrixPosition(camera.matrixWorld);
    if (l.positionX) {
      l.positionX.setTargetAtTime(me.x, t, 0.05);
      l.positionY.setTargetAtTime(me.y, t, 0.05);
      l.positionZ.setTargetAtTime(me.z, t, 0.05);
      l.forwardX.setTargetAtTime(at.x, t, 0.05);
      l.forwardY.setTargetAtTime(at.y, t, 0.05);
      l.forwardZ.setTargetAtTime(at.z, t, 0.05);
      l.upX.setTargetAtTime(up.x, t, 0.05);
      l.upY.setTargetAtTime(up.y, t, 0.05);
      l.upZ.setTargetAtTime(up.z, t, 0.05);
    } else {
      l.setPosition(me.x, me.y, me.z);
      l.setOrientation(at.x, at.y, at.z, up.x, up.y, up.z);
    }
    this.muffle.frequency.setTargetAtTime(muffled ? 550 : 4000, t, 0.25);
  }
}

// ---------- the figure ----------

function makeFigure() {
  // Pure black: no light, no detail, no face. The haze does not lighten it, so it stays a solid shape.
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const g = new THREE.Group();

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 1.25, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.15, 4, 8), black);
    leg.position.y = -0.62;
    leg.castShadow = true;
    hip.add(leg);
    g.add(hip);
    return hip;
  });
  const chest = new THREE.Group();
  chest.position.y = 1.25;
  g.add(chest);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.62, 4, 10), black);
  torso.position.y = 0.42;
  torso.scale.set(1, 1, 0.7);
  torso.castShadow = true;
  chest.add(torso);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.28, 4, 8), black);
  neck.position.set(0, 0.95, 0.04);
  neck.rotation.x = -0.35; // head hangs forward
  neck.castShadow = true;
  chest.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), black);
  head.scale.set(0.9, 1.4, 1);
  head.position.set(0, 1.12, -0.06);
  head.castShadow = true;
  chest.add(head);
  // Arms far too long: they hang past the knees.
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.17, 0.78, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 1.1, 4, 8), black);
    arm.position.y = -0.58;
    arm.castShadow = true;
    shoulder.add(arm);
    shoulder.rotation.z = s * 0.08;
    chest.add(shoulder);
    return shoulder;
  });
  return { group: g, legs, arms, chest, head };
}

// ---------- the creature ----------

export class BackroomsMonster {
  constructor(scene) {
    this.scene = scene;
    this.fig = makeFigure();
    this.fig.group.visible = false;
    scene.add(this.fig.group);
    // Its lamp: always behind it, so the shadow is thrown ahead of it, towards you.
    this.lamp = new THREE.PointLight(0xffe2a0, 10, 14, 2);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(512, 512);
    this.lamp.shadow.bias = -0.003;
    this.lamp.shadow.camera.near = 0.2;
    this.lamp.shadow.camera.far = 14;
    this.lamp.visible = false;
    scene.add(this.lamp);
    this.breath = null;
    this.active = false;
  }

  /** Make the breathing sound possible (browsers only allow sound after a click or key press). */
  unlockAudio() {
    try {
      if (!this.breath) this.breath = new Breathing();
      if (this.breath.ctx.state === "suspended") this.breath.ctx.resume().catch(() => {});
    } catch {
      this.breath = null; // no Web Audio: it stays silent
    }
  }

  setVolume(v) { if (this.breath) this.breath.setVolume(v); }

  start(level) {
    if (!level.maze) return;
    this.maze = level.maze;
    const { n, cell } = this.maze;
    this.pos = new V3((n - 0.5) * cell, 0, 0.5 * cell); // the far corner from you (not the exit)
    this.heading = 0;
    this.mode = "stalk";
    this.seenTime = 0;
    this.creepIn = 25 + Math.random() * 20;
    this.phase = 0;
    this.flicker = 0;
    this.active = true;
    this.fig.group.visible = true;
    this.lamp.visible = true;
    if (this.breath) this.breath.start();
  }

  stop() {
    this.active = false;
    this.fig.group.visible = false;
    this.lamp.visible = false;
    if (this.breath) this.breath.stop();
  }

  // ----- maze helpers -----
  _cellOf(p) {
    const { n, cell } = this.maze;
    return [THREE.MathUtils.clamp(Math.floor(p.x / cell), 0, n - 1), THREE.MathUtils.clamp(Math.floor(p.z / cell), 0, n - 1)];
  }

  _centre([i, j]) {
    const c = this.maze.cell;
    return new V3((i + 0.5) * c, 0, (j + 0.5) * c);
  }

  _open(i, j, di, dj) {
    const { n, wallE, wallS } = this.maze;
    const a = i + di;
    const b = j + dj;
    if (a < 0 || b < 0 || a >= n || b >= n) return false;
    if (di === 1) return !wallE[i][j];
    if (di === -1) return !wallE[a][j];
    if (dj === 1) return !wallS[i][j];
    return !wallS[i][b];
  }

  // Shortest way through the maze (breadth-first search). Returns a list of cells.
  _path(from, to) {
    const key = ([i, j]) => i * 100 + j;
    const prev = new Map([[key(from), null]]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift();
      if (c[0] === to[0] && c[1] === to[1]) break;
      for (const [di, dj] of STEPS) {
        if (!this._open(c[0], c[1], di, dj)) continue;
        const nb = [c[0] + di, c[1] + dj];
        if (prev.has(key(nb))) continue;
        prev.set(key(nb), c);
        queue.push(nb);
      }
    }
    if (!prev.has(key(to))) return [from];
    const path = [];
    for (let c = to; c; c = prev.get(key(c))) path.unshift(c);
    return path;
  }

  _farCell(from) {
    const { n } = this.maze;
    for (let tries = 0; tries < 30; tries++) {
      const c = [Math.floor(Math.random() * n), Math.floor(Math.random() * n)];
      if (Math.abs(c[0] - from[0]) + Math.abs(c[1] - from[1]) >= 5) return c;
    }
    return [n - 1 - from[0], n - 1 - from[1]];
  }

  /**
   * ctx: { eye, look, camera, solids, dt, onCaught(), caption(text) }
   * Returns nothing; moves the creature, its lamp, its sound.
   */
  update(ctx) {
    if (!this.active) return;
    const { eye, look, camera, solids, dt } = ctx;
    const me = this._cellOf(this.pos);
    const you = this._cellOf(eye);
    const head = this.pos.clone().setY(2.15);
    const toIt = new V3().subVectors(head, eye);
    const dist = Math.hypot(toIt.x, toIt.z);
    const hit = castRay(eye, toIt.clone().normalize(), solids, toIt.length());
    const lineOfSight = !hit || hit.t > toIt.length() - 0.3;
    const lookingAtIt = look.dot(toIt.clone().normalize()) > Math.cos(0.65);
    const seen = lineOfSight && lookingAtIt && dist < 20;

    this.seenTime = seen ? this.seenTime + dt : Math.max(0, this.seenTime - dt * 2);
    this.creepIn -= dt;

    // Decide what to do.
    if (this.mode !== "flee" && this.seenTime > 0.45) {
      this.mode = "flee"; // you looked at it: it slips away
      this.target = this._farCell(you);
      this.flicker = 0.6;
    } else if (this.mode === "stalk" && this.creepIn <= 0 && !seen) {
      this.mode = "creep"; // sneak right up behind you
    }
    let goal = you;
    let speed = 1.2;
    if (this.mode === "flee") {
      goal = this.target;
      speed = 3.6;
      if (me[0] === goal[0] && me[1] === goal[1]) this.mode = "stalk";
    } else if (this.mode === "creep") {
      speed = 1.9;
    }
    const path = this._path(me, goal);
    let moveTo = null;
    if (this.mode === "creep" && path.length <= 2) moveTo = eye.clone().sub(look.clone().setY(0).normalize().multiplyScalar(0.9)).setY(0);
    else if (this.mode !== "stalk" || path.length > 3) moveTo = this._centre(path[Math.min(1, path.length - 1)]);
    // Stalking: it stops two rooms away and waits, breathing.

    let moving = false;
    if (moveTo) {
      const d = new V3().subVectors(moveTo, this.pos).setY(0);
      const len = d.length();
      if (len > 0.05) {
        this.pos.addScaledVector(d.normalize(), Math.min(len, speed * dt));
        this.heading = Math.atan2(-d.x, -d.z);
        moving = true;
      }
    }
    if (!moving) this.heading = Math.atan2(-(eye.x - this.pos.x), -(eye.z - this.pos.z)); // turns to face you

    // Right behind you: the lights die, the breathing is in your ear, then it's gone.
    if (this.mode === "creep" && dist < 1.3) {
      ctx.onCaught();
      this.pos.copy(this._centre(this._farCell(you)));
      this.mode = "stalk";
      this.creepIn = 30 + Math.random() * 30;
    }

    // Pose: slow, heavy, wrong.
    const f = this.fig;
    this.phase += dt * (moving ? speed * 2.2 : 0.6);
    f.group.position.copy(this.pos);
    f.group.rotation.y = THREE.MathUtils.lerp(f.group.rotation.y, this.heading, Math.min(1, dt * 3));
    f.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(this.phase + i * Math.PI) * 0.35 : 0; });
    f.arms.forEach((a, i) => { a.rotation.x = Math.sin(this.phase * 0.5 + i) * 0.12; });
    const breathe = Math.sin(performance.now() / 1000 * 2.4);
    f.chest.scale.set(1 + breathe * 0.04, 1 + Math.abs(breathe) * 0.02, 1 + breathe * 0.05);
    f.head.rotation.z = Math.sin(performance.now() / 1000 * 0.7) * 0.25;

    // Its lamp hangs behind it (away from you), so the shadow falls your way.
    const away = new V3(this.pos.x - eye.x, 0, this.pos.z - eye.z);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    this.lamp.position.copy(this.pos).addScaledVector(away, 1.3).setY(2.55);
    this.flicker = Math.max(0, this.flicker - dt);
    const buzz = this.flicker > 0 ? (Math.random() < 0.5 ? 0.1 : 1) : (Math.random() < 0.02 ? 0.3 : 1);
    this.lamp.intensity = 10 * buzz;

    // Sound and captions.
    if (this.breath) this.breath.place(head, camera, !lineOfSight);
    this.captionIn = (this.captionIn ?? 4) - dt;
    if (this.captionIn <= 0 && dist < 12) {
      ctx.caption(dist < 4 ? "[laboured breathing, very close]" : lineOfSight ? "[laboured breathing]" : "[muffled wheezing behind the walls]");
      this.captionIn = 6 + Math.random() * 6;
    }
  }
}
