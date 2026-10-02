import { buildGun } from "./model.js";
import { Viewer } from "./viewer.js";
import * as R from "./rules.js";

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = "gundesigner:last";

let catalog, L, viewer;
let design;
let baseline; // stats of the bare base gun, for the +/- arrows

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Something went wrong (${res.status})`);
  return body;
}

function statText(stats = {}) {
  return Object.entries(stats)
    .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${catalog.stats.find((s) => s.id === k)?.name || k}`)
    .join(", ");
}

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {}
}

function recall() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && L.bases[d.base] && L.finishes[d.paint?.finish]) return R.tidy(L, d);
  } catch {}
  return null;
}

// ---- drawing the panel ----

function chip(label, { active, disabled, title, onClick, swatch }) {
  const b = el("button", { type: "button", className: "chip", title: title || "", disabled: !!disabled }, [label]);
  if (swatch) b.prepend(el("span", { className: "swatch" }));
  if (swatch) b.firstChild.style.background = swatch;
  b.setAttribute("aria-pressed", active ? "true" : "false");
  b.addEventListener("click", onClick);
  return b;
}

function renderBases() {
  $("#bases").replaceChildren(
    ...catalog.bases.map((b) =>
      chip(b.name, {
        active: design.base === b.id,
        title: b.description,
        onClick: () => change(() => {
          design.base = b.id;
          R.tidy(L, design);
        }, null),
      }),
    ),
  );
  $("#base-description").textContent = L.bases[design.base].description;
}

function renderSlots() {
  const sections = L.slots.map((slot) => {
    const options = catalog.parts.filter((p) => p.slot === slot);
    const mountable = R.hasMount(L, design, slot);
    const chips = [
      chip("None", {
        active: !design.parts[slot],
        onClick: () => change(() => {
          delete design.parts[slot];
          R.tidy(L, design);
        }, null),
      }),
      ...options.map((p) => {
        const ok = R.fits(L, design, p);
        let why = statText(p.stats) || "No stat changes";
        if (!ok) why = p.classes && !p.classes.includes(L.bases[design.base].class)
          ? `Doesn't fit a ${L.bases[design.base].name}`
          : "Needs a barrel first";
        return chip(p.name, {
          active: design.parts[slot] === p.id,
          disabled: !ok,
          title: why,
          onClick: () => change(() => (design.parts[slot] = p.id), slot),
        });
      }),
    ];
    return el("section", { className: "slot" + (mountable ? "" : " slot-off") }, [
      el("h3", { textContent: catalog.slots.find((s) => s.id === slot).name }),
      el("div", { className: "chips" }, chips),
    ]);
  });
  $("#slots").replaceChildren(...sections);
}

function renderPaint() {
  $("#body-color").value = design.paint.body;
  $("#accent-color").value = design.paint.accent;
  $("#finishes").replaceChildren(
    ...catalog.finishes.map((f) =>
      chip(f.name, {
        active: design.paint.finish === f.id,
        title: statText(f.stats) || "Just looks",
        swatch: f.metal.color,
        onClick: () => change(() => (design.paint.finish = f.id), null),
      }),
    ),
  );
}

function renderStats() {
  const stats = R.computeStats(L, design);
  $("#stats").replaceChildren(
    ...catalog.stats.map(({ id, name }) => {
      const v = stats[id];
      const d = v - baseline[id];
      const bar = el("div", { className: "bar" }, [el("span", { className: "fill" }), el("span", { className: "base-mark" })]);
      bar.children[0].style.width = `${v}%`;
      bar.children[1].style.left = `${baseline[id]}%`;
      bar.dataset.stat = id;
      return el("div", { className: "stat" }, [
        el("span", { className: "stat-name", textContent: name }),
        bar,
        el("span", {
          className: "stat-value" + (d > 0 ? " up" : d < 0 ? " down" : ""),
          textContent: d ? `${v} (${d > 0 ? "+" : ""}${d})` : `${v}`,
        }),
      ]);
    }),
  );
}

function render(changedSlot) {
  baseline = R.computeStats(L, { base: design.base, parts: {}, paint: { ...design.paint, finish: catalog.finishes[0].id } });
  $("#gun-name").textContent = R.designName(L, design);
  renderBases();
  renderSlots();
  renderPaint();
  renderStats();
  viewer.show(buildGun(L, design), changedSlot);
  document.documentElement.style.setProperty("--accent", design.paint.accent);
}

function change(mutate, slot) {
  mutate();
  hideShare();
  remember();
  render(slot);
}

// ---- saving, sharing and the gallery ----

function hideShare() {
  $("#share").hidden = true;
  if (location.search) history.replaceState(null, "", location.pathname);
}

function showShare(saved) {
  const url = `${location.origin}${location.pathname}?d=${saved.code}`;
  $("#share-link").value = url;
  $("#share-code").textContent = saved.code;
  $("#share").hidden = false;
  history.replaceState(null, "", `?d=${saved.code}`);
}

function toast(text, bad) {
  const t = $("#toast");
  t.textContent = text;
  t.className = bad ? "toast bad" : "toast";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function save() {
  const btn = $("#save");
  btn.disabled = true;
  try {
    const saved = await api("/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design),
    });
    showShare(saved);
    toast(`Saved as “${saved.name}”`);
    loadGallery();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function load(saved) {
  design = R.tidy(L, structuredClone(saved.design));
  design.parts ||= {};
  remember();
  render(null);
  showShare(saved);
  $("#stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadGallery() {
  const box = $("#gallery");
  try {
    const { designs } = await api("/designs?limit=24");
    if (!designs.length) {
      box.replaceChildren(el("p", { className: "muted", textContent: "No guns saved yet. Be the first!" }));
      return;
    }
    box.replaceChildren(
      ...designs.map((d) => {
        const parts = Object.values(d.design.parts).map((id) => L.parts[id]?.name).filter(Boolean);
        const card = el("button", { type: "button", className: "card" }, [
          el("span", { className: "card-name", textContent: d.name }),
          el("span", { className: "card-base", textContent: L.bases[d.design.base]?.name || d.design.base }),
          el("span", { className: "card-parts", textContent: parts.join(" · ") || "Bare-bones" }),
          el("span", { className: "card-code", textContent: d.code }),
        ]);
        card.style.setProperty("--card-accent", d.design.paint.accent);
        card.style.setProperty("--card-body", d.design.paint.body);
        card.addEventListener("click", () => load(d));
        return card;
      }),
    );
  } catch {
    box.replaceChildren(el("p", { className: "muted", textContent: "Couldn't load the gallery right now." }));
  }
}

// ---- start ----

function wire() {
  $("#body-color").addEventListener("input", (e) => change(() => (design.paint.body = e.target.value), null));
  $("#accent-color").addEventListener("input", (e) => change(() => (design.paint.accent = e.target.value), null));
  $("#random").addEventListener("click", () => change(() => (design = R.randomDesign(catalog, L)), null));
  $("#reset").addEventListener("click", () => change(() => (design = R.emptyDesign(catalog)), null));
  $("#save").addEventListener("click", save);
  $("#copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#share-link").value);
      toast("Link copied!");
    } catch {
      $("#share-link").select();
    }
  });
  $("#photo").addEventListener("click", () => {
    const a = el("a", { href: viewer.photo(), download: `${R.designName(L, design).replace(/[^\w-]+/g, "-")}.png` });
    a.click();
  });
  const fire = () => viewer.fire(R.computeStats(L, design).goofiness >= 50 || design.parts.underbarrel === "ub_confetti");
  $("#fire").addEventListener("click", fire);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["INPUT", "BUTTON", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      fire();
    }
  });
  const toggle = (id, fn) => {
    const b = $(id);
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on);
      fn(on);
    });
  };
  toggle("#spin", (on) => (viewer.spin = on));
  toggle("#explode", (on) => viewer.setExplode(on));
}

async function start() {
  try {
    catalog = await api("/parts");
  } catch (e) {
    $("#viewer").replaceChildren(el("p", { className: "error", textContent: `Couldn't load the parts list: ${e.message}` }));
    return;
  }
  L = R.lookup(catalog);
  viewer = new Viewer($("#viewer"));
  wire();

  const code = new URLSearchParams(location.search).get("d");
  design = recall();
  if (!design) {
    design = R.emptyDesign(catalog);
    design.parts = { barrel: "barrel_std", grip: "grip_std", magazine: "mag_pistol_ext" };
    R.tidy(L, design);
  }
  render(null);
  if (code) {
    try {
      load(await api(`/designs/${encodeURIComponent(code)}`));
    } catch {
      toast("Couldn't find that shared gun.", true);
    }
  }
  loadGallery();
}

start();
