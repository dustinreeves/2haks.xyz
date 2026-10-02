// Small helpers. Everything is built with DOM calls (never innerHTML), because titles,
// show notes and artwork links come from other people's feeds.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v; // CSSOM, so the strict CSP allows it
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// replaceChildren, but skipping null/false (replaceChildren would print them as text).
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function icon(path, cls = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

export const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  queue: "M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-3v-3h2v3h3v2h-3v3h-2v-3h-3v-2z",
  queued: "M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm11.5.5 1.4-1.4 1.6 1.6 4.1-4.1 1.4 1.4-5.5 5.5z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  up: "M7 14l5-5 5 5z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
};

export function clock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const two = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

export function minutes(sec) {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} hr ${mm} min` : `${hh} hr`;
}

export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = (Date.now() - d) / 86400000;
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

// Plain text with web links turned into real (safe) links.
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<>"')\]]+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0].replace(/[.,;:!?]+$/, "");
    frag.append(text.slice(last, m.index));
    frag.append(h("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, url));
    last = m.index + url.length;
    re.lastIndex = last;
  }
  frag.append(text.slice(last));
  return frag;
}

export function art(src, alt = "") {
  return h("img", { src: src || "favicon.svg", alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

export async function api(path) {
  const res = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : `Something went wrong (${res.status}).`;
    throw new Error(detail);
  }
  return body;
}
