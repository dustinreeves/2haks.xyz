// Pixel: the editor. Drawings are a flat array of "#rrggbb" or null (see-through),
// row by row, so pixel (x, y) lives at index y * size + x.
(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const CANVAS_PX = 640;
  const UNDO_LIMIT = 100;
  const STORE_KEY = "pixel:work";
  const TOKENS_KEY = "pixel:tokens";

  const state = {
    size: 20,
    pixels: [],
    color: "#ff004d",
    tool: "pencil",
    grid: true,
    undo: [],
    redo: [],
    sel: null,        // {x, y, w, h}: the dashed box
    float: null,      // {x, y, w, h, pixels}: lifted pixels being moved
    clipboard: null,  // {w, h, pixels}
    drawingId: null,  // set once saved, so Save updates instead of copying
    hover: null,
  };

  // ---------- small helpers ----------

  const blank = (n) => new Array(n * n).fill(null);
  const idx = (x, y) => y * state.size + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < state.size && y < state.size;
  const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

  function storage(fn, fallback) {
    try { return fn(); } catch { return fallback; }
  }
  const tokens = () => storage(() => JSON.parse(localStorage.getItem(TOKENS_KEY)) || {}, {});
  function saveToken(id, token) {
    const t = tokens(); t[id] = token;
    storage(() => localStorage.setItem(TOKENS_KEY, JSON.stringify(t)));
  }
  function forgetToken(id) {
    const t = tokens(); delete t[id];
    storage(() => localStorage.setItem(TOKENS_KEY, JSON.stringify(t)));
  }

  function setStatus(msg) { $("#status").textContent = msg; }

  // ---------- history ----------

  function pushUndo() {
    state.undo.push(state.pixels.slice());
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
    state.redo = [];
    updateButtons();
  }

  function undo() {
    // Undoing mid-move puts the lifted pixels back where they came from.
    state.float = null;
    state.sel = null;
    if (!state.undo.length) return;
    state.redo.push(state.pixels);
    state.pixels = state.undo.pop();
    changed();
  }

  function redo() {
    commitFloat();
    if (!state.redo.length) return;
    state.undo.push(state.pixels);
    state.pixels = state.redo.pop();
    changed();
  }

  // ---------- drawing ----------

  function setPixel(x, y, color) {
    if (inside(x, y)) state.pixels[idx(x, y)] = color;
  }

  // Bresenham's line, so a fast stroke doesn't leave gaps between mouse events.
  function line(x0, y0, x1, y1, color) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      setPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function floodFill(x, y, color) {
    const target = state.pixels[idx(x, y)];
    if (target === color) return false;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (!inside(cx, cy) || state.pixels[idx(cx, cy)] !== target) continue;
      state.pixels[idx(cx, cy)] = color;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return true;
  }

  // What colour is showing at (x, y), counting a selection being moved.
  function colorAt(x, y) {
    const f = state.float;
    if (inRect(f, x, y)) {
      const p = f.pixels[(y - f.y) * f.w + (x - f.x)];
      if (p) return p;
    }
    return state.pixels[idx(x, y)];
  }

  // ---------- selection ----------

  function copyRegion(r) {
    const out = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) out.push(state.pixels[idx(x, y)]);
    return out;
  }

  function clearRegion(r) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) state.pixels[idx(x, y)] = null;
  }

  // Pick up the selected pixels so they can be dragged around.
  function liftSelection() {
    if (state.float || !state.sel) return;
    pushUndo();
    state.float = { ...state.sel, pixels: copyRegion(state.sel) };
    clearRegion(state.sel);
  }

  // Put moved pixels down. See-through pixels don't cover what's underneath.
  function commitFloat() {
    const f = state.float;
    if (!f) return;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const p = f.pixels[y * f.w + x];
        if (p) setPixel(f.x + x, f.y + y, p);
      }
    state.float = null;
    // Pixels dragged off the edge are gone, so trim the box to what's left.
    const s = state.sel;
    if (s) {
      const x0 = Math.max(0, s.x), y0 = Math.max(0, s.y);
      const x1 = Math.min(state.size, s.x + s.w), y1 = Math.min(state.size, s.y + s.h);
      state.sel = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    changed();
  }

  function deselect() {
    commitFloat();
    state.sel = null;
    render();
  }

  function copySelection() {
    if (state.float) {
      const f = state.float;
      state.clipboard = { w: f.w, h: f.h, pixels: f.pixels.slice() };
    } else if (state.sel) {
      state.clipboard = { w: state.sel.w, h: state.sel.h, pixels: copyRegion(state.sel) };
    } else {
      return setStatus("Pick the Select tool and drag a box first.");
    }
    setStatus(`Copied ${state.clipboard.w}×${state.clipboard.h}.`);
    updateButtons();
  }

  function deleteSelection() {
    if (state.float) {
      state.float = null;          // already lifted off the canvas, so just drop it
    } else if (state.sel) {
      pushUndo();
      clearRegion(state.sel);
    } else return;
    state.sel = null;
    changed();
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  function paste() {
    const c = state.clipboard;
    if (!c) return;
    commitFloat();
    pushUndo();
    const x = state.sel ? state.sel.x : 0;
    const y = state.sel ? state.sel.y : 0;
    state.float = { x, y, w: c.w, h: c.h, pixels: c.pixels.slice() };
    state.sel = { x, y, w: c.w, h: c.h };
    setTool("select");
    setStatus("Pasted. Drag it where you want it.");
    render();
  }

  function flip(horizontal) {
    if (!state.sel && !state.float) {
      // Nothing selected: flip the whole picture.
      state.sel = { x: 0, y: 0, w: state.size, h: state.size };
    }
    liftSelection();
    const f = state.float;
    const out = new Array(f.pixels.length);
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const sx = horizontal ? f.w - 1 - x : x;
        const sy = horizontal ? y : f.h - 1 - y;
        out[y * f.w + x] = f.pixels[sy * f.w + sx];
      }
    f.pixels = out;
    render();
  }

  // ---------- pointer input ----------

  let drag = null;

  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - r.left) / r.width) * state.size),
      y: Math.floor(((e.clientY - r.top) / r.height) * state.size),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = cellFromEvent(e);
    if (!inside(x, y)) return;

    switch (state.tool) {
      case "pencil":
      case "eraser": {
        commitFloat();
        state.sel = null;
        const color = state.tool === "eraser" ? null : state.color;
        drag = { kind: "paint", color, last: { x, y }, before: state.pixels.slice() };
        setPixel(x, y, color);
        render();
        break;
      }
      case "fill": {
        commitFloat();
        state.sel = null;
        const before = state.pixels.slice();
        if (floodFill(x, y, state.color)) {
          state.undo.push(before);
          state.redo = [];
          changed();
        }
        break;
      }
      case "picker": {
        const c = colorAt(x, y);
        if (c) { setColor(c); setTool("pencil"); setStatus(`Picked ${c}.`); }
        else setStatus("That pixel is see-through. Pick a coloured one.");
        break;
      }
      case "select": {
        if (inRect(state.float, x, y) || (!state.float && inRect(state.sel, x, y))) {
          liftSelection();
          drag = { kind: "move", dx: x - state.float.x, dy: y - state.float.y };
        } else {
          commitFloat();
          drag = { kind: "select", ax: x, ay: y };
          state.sel = { x, y, w: 1, h: 1 };
        }
        render();
        break;
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const cell = cellFromEvent(e);
    state.hover = inside(cell.x, cell.y) ? cell : null;
    showPosition();
    if (!drag) {
      if (state.tool === "select") {
        canvas.style.cursor = inRect(state.float || state.sel, cell.x, cell.y) ? "move" : "crosshair";
      }
      return render();
    }

    if (drag.kind === "paint") {
      line(drag.last.x, drag.last.y, cell.x, cell.y, drag.color);
      drag.last = cell;
    } else if (drag.kind === "move") {
      state.float.x = cell.x - drag.dx;
      state.float.y = cell.y - drag.dy;
      state.sel = { x: state.float.x, y: state.float.y, w: state.float.w, h: state.float.h };
    } else if (drag.kind === "select") {
      const cx = Math.max(0, Math.min(state.size - 1, cell.x));
      const cy = Math.max(0, Math.min(state.size - 1, cell.y));
      state.sel = {
        x: Math.min(drag.ax, cx), y: Math.min(drag.ay, cy),
        w: Math.abs(cx - drag.ax) + 1, h: Math.abs(cy - drag.ay) + 1,
      };
    }
    render();
  });

  function endDrag() {
    if (!drag) return;
    if (drag.kind === "paint") {
      const same = drag.before.every((p, i) => p === state.pixels[i]);
      if (!same) {
        state.undo.push(drag.before);
        if (state.undo.length > UNDO_LIMIT) state.undo.shift();
        state.redo = [];
      }
      changed();
    } else if (drag.kind === "select") {
      const s = state.sel;
      setStatus(`Selected ${s.w}×${s.h}. Drag inside it to move, or use the buttons.`);
      updateButtons();
    }
    drag = null;
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { state.hover = null; showPosition(); render(); });

  function showPosition() {
    const h = state.hover;
    if (h) setStatus(`x ${h.x + 1}, y ${h.y + 1}`);
  }

  // ---------- rendering ----------

  function render() {
    const n = state.size;
    const cell = CANVAS_PX / n;
    const css = getComputedStyle(document.documentElement);

    // Checkerboard so see-through pixels look see-through.
    const ca = css.getPropertyValue("--checker-a").trim();
    const cb = css.getPropertyValue("--checker-b").trim();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const c = colorAt(x, y);
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        } else {
          const h = cell / 2;
          for (let q = 0; q < 4; q++) {
            ctx.fillStyle = (q === 0 || q === 3) ? ca : cb;
            ctx.fillRect(x * cell + (q % 2) * h, y * cell + (q >> 1) * h, h, h);
          }
        }
      }

    if (state.grid) {
      ctx.strokeStyle = "rgba(128, 128, 128, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const p = Math.round(i * cell) + 0.5;
        ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_PX);
        ctx.moveTo(0, p); ctx.lineTo(CANVAS_PX, p);
      }
      ctx.stroke();
    }

    // Outline the cell under the brush.
    const h = state.hover;
    if (h && state.tool !== "select") {
      ctx.strokeStyle = state.tool === "eraser" ? "#888" : state.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(h.x * cell + 1, h.y * cell + 1, cell - 2, cell - 2);
    }

    const s = state.sel;
    if (s) {
      const r = [s.x * cell + 1, s.y * cell + 1, s.w * cell - 2, s.h * cell - 2];
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#ffffff"; ctx.lineDashOffset = 0; ctx.strokeRect(...r);
      ctx.strokeStyle = "#000000"; ctx.lineDashOffset = 7; ctx.strokeRect(...r);
      ctx.setLineDash([]);
    }
  }

  // Called after anything that changes the picture.
  function changed() {
    render();
    updateButtons();
    storage(() => localStorage.setItem(STORE_KEY, JSON.stringify({
      size: state.size, pixels: state.pixels, drawingId: state.drawingId,
      title: $("#title").value, author: $("#author").value,
    })));
  }

  function updateButtons() {
    $('[data-action="undo"]').disabled = !state.undo.length;
    $('[data-action="redo"]').disabled = !state.redo.length;
    const hasSel = !!(state.sel || state.float);
    for (const a of ["copy", "cut", "delete"]) $(`[data-action="${a}"]`).disabled = !hasSel;
    $('[data-action="paste"]').disabled = !state.clipboard;
  }

  // ---------- tools and colours ----------

  function setTool(tool) {
    if (tool !== "select") { commitFloat(); state.sel = null; }
    state.tool = tool;
    for (const b of $$(".tool")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    canvas.style.cursor = "crosshair";
    render();
    updateButtons();
  }

  function setColor(c) {
    state.color = c.toLowerCase();
    $("#current-swatch").style.background = state.color;
    $("#custom-color").value = state.color;
    for (const s of $$(".swatch")) s.setAttribute("aria-checked", String(s.dataset.color === state.color));
    if (state.tool === "eraser") setTool("pencil");
  }

  function buildPalette(colors) {
    const pal = $("#palette");
    pal.innerHTML = "";
    for (const c of colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = c;
      b.style.background = c;
      b.title = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", c);
      b.addEventListener("click", () => setColor(c));
      pal.appendChild(b);
    }
    setColor(state.color);
  }

  function newDrawing(size) {
    const empty = state.pixels.every((p) => p === null);
    if (!empty && !confirm(`Start a new ${size}×${size} drawing? Anything unsaved will be lost.`)) return;
    state.size = size;
    state.pixels = blank(size);
    state.undo = []; state.redo = [];
    state.sel = null; state.float = null;
    state.drawingId = null;
    $("#title").value = "";
    $("#save-hint").textContent = "";
    changed();
    setStatus(`New ${size}×${size} canvas.`);
  }

  // ---------- saving, loading, export ----------

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json", ...opts.headers }, ...opts });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  async function save() {
    commitFloat();
    const body = JSON.stringify({
      title: $("#title").value || "Untitled",
      author: $("#author").value,
      size: state.size,
      pixels: state.pixels,
    });
    const token = state.drawingId && tokens()[state.drawingId];
    try {
      let d;
      if (token) {
        d = await api(`/api/drawings/${state.drawingId}`, { method: "PUT", body, headers: { "X-Edit-Token": token } });
        $("#save-hint").textContent = "Saved your changes.";
      } else {
        d = await api("/api/drawings", { method: "POST", body });
        saveToken(d.id, d.edit_token);
        $("#save-hint").textContent = state.drawingId
          ? "That one wasn't yours, so you saved your own copy."
          : "Saved! It's in the gallery now.";
      }
      state.drawingId = d.id;
      storage(() => localStorage.setItem("pixel:author", $("#author").value));
      changed();
      loadGallery();
    } catch (err) {
      $("#save-hint").textContent = `Couldn't save: ${err.message}`;
    }
  }

  async function openDrawing(id) {
    const empty = state.pixels.every((p) => p === null);
    if (!empty && !confirm("Open this drawing? Anything unsaved will be lost.")) return;
    try {
      const d = await api(`/api/drawings/${id}`);
      state.size = d.size;
      state.pixels = d.pixels;
      state.undo = []; state.redo = [];
      state.sel = null; state.float = null;
      state.drawingId = d.id;
      $("#title").value = d.title;
      const mine = !!tokens()[d.id];
      if (mine) $("#author").value = d.author;
      $("#save-hint").textContent = mine
        ? "This one's yours. Save updates it."
        : `By ${d.author || "someone"}. Saving makes your own copy.`;
      changed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setStatus(`Couldn't open it: ${err.message}`);
    }
  }

  function download() {
    commitFloat();
    const scale = state.size === 20 ? 32 : 16;
    const out = document.createElement("canvas");
    out.width = out.height = state.size * scale;
    const o = out.getContext("2d");
    for (let y = 0; y < state.size; y++)
      for (let x = 0; x < state.size; x++) {
        const p = state.pixels[idx(x, y)];
        if (p) { o.fillStyle = p; o.fillRect(x * scale, y * scale, scale, scale); }
      }
    out.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${($("#title").value || "pixel-art").replace(/[^\w-]+/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  async function loadGallery() {
    const g = $("#gallery");
    try {
      const list = await api("/api/drawings");
      if (!list.length) { g.innerHTML = '<p class="hint">Nothing here yet. Be the first!</p>'; return; }
      const mine = tokens();
      g.innerHTML = "";
      for (const d of list) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "card" + (mine[d.id] ? " mine" : "");
        const img = document.createElement("img");
        img.alt = d.title;
        img.loading = "lazy";
        img.src = `/api/drawings/${d.id}/png?scale=4&v=${Math.round(d.updated)}`;
        const t = document.createElement("span"); t.className = "t"; t.textContent = d.title;
        const a = document.createElement("span"); a.className = "a"; a.textContent = `${d.author || "Anonymous"} · ${d.size}×${d.size}`;
        card.append(img, t, a);
        card.addEventListener("click", () => openDrawing(d.id));
        g.appendChild(card);
      }
    } catch {
      g.innerHTML = '<p class="hint">The gallery isn\'t reachable right now.</p>';
    }
  }

  // ---------- wiring ----------

  for (const b of $$(".tool")) b.addEventListener("click", () => setTool(b.dataset.tool));
  for (const b of $$("[data-new]")) b.addEventListener("click", () => newDrawing(Number(b.dataset.new)));

  const actions = {
    undo, redo, paste, save, download,
    copy: copySelection, cut: cutSelection, delete: deleteSelection,
    flipH: () => flip(true), flipV: () => flip(false),
  };
  for (const b of $$("[data-action]")) b.addEventListener("click", () => actions[b.dataset.action]());

  $("#custom-color").addEventListener("input", (e) => setColor(e.target.value));
  $("#grid-toggle").addEventListener("change", (e) => { state.grid = e.target.checked; render(); });
  $("#title").addEventListener("input", changed);

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === "c") { e.preventDefault(); copySelection(); }
    else if (mod && k === "x") { e.preventDefault(); cutSelection(); }
    else if (mod && k === "v") { e.preventDefault(); paste(); }
    else if (mod && k === "s") { e.preventDefault(); save(); }
    else if (mod) return;
    else if (k === "delete" || k === "backspace") { e.preventDefault(); deleteSelection(); }
    else if (k === "escape") deselect();
    else if (k === "b" || k === "p") setTool("pencil");
    else if (k === "e") setTool("eraser");
    else if (k === "f") setTool("fill");
    else if (k === "i") setTool("picker");
    else if (k === "s" || k === "m") setTool("select");
    else if (k === "h") flip(true);
    else if (k === "v") flip(false);
    else if (k === "g") { state.grid = !state.grid; $("#grid-toggle").checked = state.grid; render(); }
  });

  // Re-draw when the system switches light/dark, since the checkerboard follows the theme.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

  // ---------- start up ----------

  const saved = storage(() => JSON.parse(localStorage.getItem(STORE_KEY)), null);
  if (saved && [20, 40].includes(saved.size) && saved.pixels?.length === saved.size ** 2) {
    state.size = saved.size;
    state.pixels = saved.pixels;
    state.drawingId = saved.drawingId || null;
    $("#title").value = saved.title || "";
  } else {
    state.pixels = blank(state.size);
  }
  $("#author").value = storage(() => localStorage.getItem("pixel:author"), "") || "";

  buildPalette(["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
                "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"]);
  api("/api/palette").then((p) => buildPalette(p.colors)).catch(() => {});
  setTool("pencil");
  changed();
  loadGallery();
})();
