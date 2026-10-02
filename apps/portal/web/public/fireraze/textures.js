// Fire Raze engine: textures drawn in code (no image files needed) and tiled boxes.
import * as THREE from "../vendor/three-0.170.0.module.min.js";

export function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// A box whose texture repeats every `tile` metres instead of stretching.
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
  return geo;
}

export const TEXTURES = {
  // Portal-able wall tile, designed by Tripp: a white panel with a grey seam down the middle,
  // a wiggly dark crack along the seam, and thin scratch marks beside it.
  white: canvasTexture(512, (g, s) => {
    g.fillStyle = "#f2f4f6";
    g.fillRect(0, 0, s, s);
    // Very faint panel edge, so neighbouring tiles read as separate panels.
    g.strokeStyle = "rgba(150, 158, 166, 0.35)";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);

    const mid = s / 2;
    g.fillStyle = "#8a9096";
    g.fillRect(mid - 3, 0, 6, s); // the seam

    // Crack: a thin dark line that wobbles along the seam (same every time, so tiles match).
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.strokeStyle = "#202428";
    g.lineWidth = 1.6;
    g.beginPath();
    let x = mid;
    g.moveTo(x, s * 0.06);
    for (let y = s * 0.06; y <= s * 0.97; y += 10) {
      x = mid + (rand() - 0.5) * (rand() < 0.15 ? 26 : 9);
      g.lineTo(x, y);
    }
    g.stroke();

    // Scratches: short, faint grey strokes either side of the seam.
    g.strokeStyle = "rgba(120, 128, 136, 0.55)";
    g.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const sx = mid + (rand() < 0.5 ? -1 : 1) * (5 + rand() * 14);
      const sy = rand() * s;
      const len = 14 + rand() * 40;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + (rand() - 0.5) * 8, sy + len);
      g.stroke();
    }
  }),
  metal: canvasTexture(256, (g, s) => {
    g.fillStyle = "#2f3438";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#3d4348";
    g.fillRect(6, 6, s - 12, s - 12);
    g.strokeStyle = "#262a2e";
    g.lineWidth = 3;
    g.strokeRect(20, 20, s - 40, s - 40);
    g.fillStyle = "#555c63";
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) {
      g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    }
  }),
  cube: canvasTexture(256, (g, s) => {
    g.fillStyle = "#8d959c";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#d9dde1";
    g.fillRect(36, 36, s - 72, s - 72);
    g.fillStyle = "#2f9bff";
    for (const [x, y] of [[0, 0], [s - 36, 0], [0, s - 36], [s - 36, s - 36]]) g.fillRect(x, y, 36, 36);
    g.strokeStyle = "#6e767d";
    g.lineWidth = 10;
    g.beginPath(); g.arc(s / 2, s / 2, 44, 0, Math.PI * 2); g.stroke();
  }),
  door: canvasTexture(256, (g, s) => {
    g.fillStyle = "#e4e7ea";
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#1d2126";
    g.fillRect(0, s * 0.45, s, s * 0.1);
    g.fillStyle = "#ff8a1f";
    g.fillRect(s * 0.46, 0, s * 0.08, s);
  }),
};
