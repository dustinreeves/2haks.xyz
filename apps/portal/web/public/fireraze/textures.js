// Fire Raze engine: textures drawn in code (no image files needed) and tiled boxes.
//
// Each surface is drawn three times on a canvas:
//   colour     what it looks like
//   height     white = sticks out, black = dents/seams; turned into a normal map so light
//              catches bevels, rivets and scratches as if they were really carved in
//   roughness  white = dull, black = shiny (scuffs and worn spots look different)
import * as THREE from "../vendor/three-0.170.0.module.min.js";

const RES = 512;

function makeCanvas(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  return c;
}

function toTexture(canvas, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function canvasTexture(size, draw) {
  return toTexture(makeCanvas(size, draw), true);
}

// Turn a height canvas into a normal map (how steep the surface is at each pixel, as a colour).
function normalFromHeight(heightCanvas, strength) {
  const s = heightCanvas.width;
  const src = heightCanvas.getContext("2d").getImageData(0, 0, s, s).data;
  const out = document.createElement("canvas");
  out.width = out.height = s;
  const g = out.getContext("2d");
  const img = g.createImageData(s, s);
  const h = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

function surface({ color, height, rough, strength = 4 }) {
  const maps = { map: toTexture(makeCanvas(RES, color), true) };
  if (height) maps.normalMap = toTexture(normalFromHeight(makeCanvas(RES, height), strength), false);
  if (rough) maps.roughnessMap = toTexture(makeCanvas(RES, rough), false);
  return maps;
}

// Repeatable random numbers, so every tile comes out the same each time the game loads.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// Soft, blotchy grime/noise: many faint dots and smudges.
function speckle(g, s, seed, count, color, maxR) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = color(r());
    g.beginPath();
    g.arc(r() * s, r() * s, 0.5 + r() * maxR, 0, Math.PI * 2);
    g.fill();
  }
}

function bevelRect(g, x, y, w, h, b, light, dark) {
  g.fillStyle = light;
  g.fillRect(x, y, w, b);
  g.fillRect(x, y, b, h);
  g.fillStyle = dark;
  g.fillRect(x, y + h - b, w, b);
  g.fillRect(x + w - b, y, b, h);
}

// ---------- white portal tile (Tripp's design: seam + crack + scratches) ----------

function tileCrack(g, s, width, color) {
  const r = rng(7);
  const mid = s / 2;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(mid, s * 0.06);
  for (let y = s * 0.06; y <= s * 0.97; y += 10) g.lineTo(mid + (r() - 0.5) * (r() < 0.15 ? 26 : 9), y);
  g.stroke();
}

function tileScratches(g, s, color) {
  const r = rng(99);
  const mid = s / 2;
  g.strokeStyle = color;
  g.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const sx = mid + (r() < 0.5 ? -1 : 1) * (5 + r() * 16);
    const sy = r() * s;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + (r() - 0.5) * 8, sy + 14 + r() * 40);
    g.stroke();
  }
}

const white = surface({
  color: (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, "#f6f7f8");
    grad.addColorStop(1, "#e9ecef");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    speckle(g, s, 3, 900, (v) => `rgba(120, 128, 136, ${0.02 + v * 0.05})`, 2.5);
    // Grime gathers near the bottom edge.
    const dirt = g.createLinearGradient(0, s * 0.8, 0, s);
    dirt.addColorStop(0, "rgba(90, 96, 102, 0)");
    dirt.addColorStop(1, "rgba(90, 96, 102, 0.12)");
    g.fillStyle = dirt;
    g.fillRect(0, s * 0.8, s, s * 0.2);
    bevelRect(g, 0, 0, s, s, 4, "rgba(255,255,255,0.8)", "rgba(140,148,156,0.55)");
    g.fillStyle = "#8a9096";
    g.fillRect(s / 2 - 3, 0, 6, s);
    tileCrack(g, s, 1.6, "#202428");
    tileScratches(g, s, "rgba(120, 128, 136, 0.55)");
  },
  height: (g, s) => {
    g.fillStyle = "#c8c8c8";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#606060";
    g.fillRect(0, 0, s, 3); g.fillRect(0, s - 3, s, 3); g.fillRect(0, 0, 3, s); g.fillRect(s - 3, 0, 3, s);
    g.fillStyle = "#505050";
    g.fillRect(s / 2 - 3, 0, 6, s);
    tileCrack(g, s, 2.4, "#202020");
    tileScratches(g, s, "rgba(90, 90, 90, 0.8)");
    speckle(g, s, 5, 400, (v) => `rgba(${v < 0.5 ? 255 : 0}, ${v < 0.5 ? 255 : 0}, ${v < 0.5 ? 255 : 0}, 0.05)`, 3);
  },
  rough: (g, s) => {
    g.fillStyle = "#b0b0b0";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 11, 300, (v) => `rgba(${v < 0.5 ? 255 : 90}, ${v < 0.5 ? 255 : 90}, ${v < 0.5 ? 255 : 90}, 0.15)`, 8);
  },
  strength: 3,
});

// ---------- dark metal wall panel (portals don't stick) ----------

function metalLayout(draw) {
  // Four inset plates with rivets in the corners.
  return (g, s) => {
    const half = s / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) draw(g, i * half, j * half, half);
    }
  };
}

const metal = surface({
  color: (g, s) => {
    g.fillStyle = "#3a4046";
    g.fillRect(0, 0, s, s);
    metalLayout((g2, x, y, w) => {
      const grad = g2.createLinearGradient(x, y, x + w, y + w);
      grad.addColorStop(0, "#6a727a");
      grad.addColorStop(1, "#59616a");
      g2.fillStyle = grad;
      g2.fillRect(x + 8, y + 8, w - 16, w - 16);
      bevelRect(g2, x + 8, y + 8, w - 16, w - 16, 3, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.35)");
      // Brushed streaks.
      const r = rng(x * 3 + y + 1);
      for (let k = 0; k < 40; k++) {
        g2.fillStyle = `rgba(255,255,255,${0.01 + r() * 0.025})`;
        g2.fillRect(x + 10, y + 10 + r() * (w - 20), w - 20, 1);
      }
      g2.fillStyle = "#8a929a";
      for (const [cx, cy] of [[16, 16], [w - 16, 16], [16, w - 16], [w - 16, w - 16]]) {
        g2.beginPath(); g2.arc(x + cx, y + cy, 4.5, 0, Math.PI * 2); g2.fill();
      }
    })(g, s);
    speckle(g, s, 21, 500, (v) => `rgba(${v < 0.6 ? 0 : 120}, ${v < 0.6 ? 0 : 110}, ${v < 0.6 ? 0 : 90}, 0.08)`, 3);
  },
  height: (g, s) => {
    g.fillStyle = "#303030";
    g.fillRect(0, 0, s, s);
    metalLayout((g2, x, y, w) => {
      g2.fillStyle = "#a0a0a0";
      g2.fillRect(x + 8, y + 8, w - 16, w - 16);
      g2.fillStyle = "#ffffff";
      for (const [cx, cy] of [[16, 16], [w - 16, 16], [16, w - 16], [w - 16, w - 16]]) {
        g2.beginPath(); g2.arc(x + cx, y + cy, 4.5, 0, Math.PI * 2); g2.fill();
      }
    })(g, s);
  },
  rough: (g, s) => {
    g.fillStyle = "#909090";
    g.fillRect(0, 0, s, s);
    const r = rng(4);
    for (let k = 0; k < 160; k++) {
      g.fillStyle = `rgba(40,40,40,${0.05 + r() * 0.1})`;
      g.fillRect(r() * s, r() * s, 30 + r() * 120, 1 + r() * 2);
    }
  },
  strength: 6,
});

// ---------- floor tiles (grey, worn, small squares) ----------

const floor = surface({
  color: (g, s) => {
    g.fillStyle = "#2a2e32";
    g.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    const r = rng(17);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 92 + Math.floor(r() * 14);
        g.fillStyle = `rgb(${v}, ${v + 4}, ${v + 8})`;
        g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        bevelRect(g, i * t + 3, j * t + 3, t - 6, t - 6, 2, "rgba(255,255,255,0.12)", "rgba(0,0,0,0.25)");
      }
    }
    speckle(g, s, 23, 1600, (v) => `rgba(${v < 0.5 ? 30 : 200}, ${v < 0.5 ? 32 : 205}, ${v < 0.5 ? 36 : 210}, 0.06)`, 2);
    // Scuff marks where people walk.
    const r2 = rng(31);
    g.strokeStyle = "rgba(20, 22, 24, 0.18)";
    for (let k = 0; k < 20; k++) {
      g.lineWidth = 1 + r2() * 3;
      g.beginPath();
      const x = r2() * s;
      const y = r2() * s;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (r2() - 0.5) * 80, y + (r2() - 0.5) * 80, x + (r2() - 0.5) * 120, y + (r2() - 0.5) * 120);
      g.stroke();
    }
  },
  height: (g, s) => {
    g.fillStyle = "#202020";
    g.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = "#b0b0b0";
        g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      }
    }
    speckle(g, s, 29, 900, (v) => `rgba(${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},0.08)`, 2);
  },
  rough: (g, s) => {
    g.fillStyle = "#c0c0c0";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 37, 200, () => "rgba(70,70,70,0.12)", 22); // polished spots
  },
  strength: 5,
});

// ---------- cube ----------

const cube = surface({
  color: (g, s) => {
    g.fillStyle = "#7d858c";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#e3e6e9";
    g.fillRect(70, 70, s - 140, s - 140);
    bevelRect(g, 70, 70, s - 140, s - 140, 6, "rgba(255,255,255,0.7)", "rgba(0,0,0,0.25)");
    g.fillStyle = "#2f9bff";
    for (const [x, y] of [[0, 0], [s - 70, 0], [0, s - 70], [s - 70, s - 70]]) g.fillRect(x, y, 70, 70);
    g.strokeStyle = "#5d656c";
    g.lineWidth = 18;
    g.beginPath(); g.arc(s / 2, s / 2, 86, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#c9ced3";
    g.beginPath(); g.arc(s / 2, s / 2, 70, 0, Math.PI * 2); g.fill();
    speckle(g, s, 41, 500, (v) => `rgba(60,60,60,${0.04 + v * 0.06})`, 2);
  },
  height: (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#c0c0c0";
    g.fillRect(70, 70, s - 140, s - 140);
    g.strokeStyle = "#404040";
    g.lineWidth = 18;
    g.beginPath(); g.arc(s / 2, s / 2, 86, 0, Math.PI * 2); g.stroke();
  },
  rough: (g, s) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#404040";
    for (const [x, y] of [[0, 0], [s - 70, 0], [0, s - 70], [s - 70, s - 70]]) g.fillRect(x, y, 70, 70);
  },
});

// ---------- door ----------

const door = surface({
  color: (g, s) => {
    g.fillStyle = "#dfe3e6";
    g.fillRect(0, 0, s, s);
    speckle(g, s, 51, 600, (v) => `rgba(100,108,116,${0.03 + v * 0.05})`, 2);
    g.fillStyle = "#1d2126";
    g.fillRect(0, s * 0.45, s, s * 0.1);
    // Orange and black hazard stripes on the centre band.
    g.save();
    g.beginPath(); g.rect(0, s * 0.46, s, s * 0.08); g.clip();
    for (let x = -s; x < s * 2; x += 40) {
      g.fillStyle = "#ff8a1f";
      g.beginPath();
      g.moveTo(x, s * 0.46); g.lineTo(x + 20, s * 0.46); g.lineTo(x + 20 + s * 0.08, s * 0.54); g.lineTo(x + s * 0.08, s * 0.54);
      g.fill();
    }
    g.restore();
    g.fillStyle = "#1d2126";
    g.fillRect(s / 2 - 2, 0, 4, s); // where the two halves meet
  },
  height: (g, s) => {
    g.fillStyle = "#b0b0b0";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#606060";
    g.fillRect(0, s * 0.45, s, s * 0.1);
    g.fillStyle = "#202020";
    g.fillRect(s / 2 - 2, 0, 4, s);
  },
});

export const TEXTURES = { white, metal, floor, cube, door };

// A box whose texture repeats every `tile` metres instead of stretching.
// Uses material groups: 0 = sides, 1 = top (so floors can look different from walls), 2 = bottom.
export function tiledBox(size, tile = 2) {
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const dims = [[size.z, size.y], [size.z, size.y], [size.x, size.z], [size.x, size.z], [size.x, size.y], [size.x, size.y]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  const faceMaterial = [0, 0, 1, 2, 0, 0];
  geo.groups.forEach((grp, i) => { grp.materialIndex = faceMaterial[i]; });
  return geo;
}
