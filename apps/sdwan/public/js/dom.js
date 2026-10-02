// Tiny DOM helper: h('div', {class:'x', onclick}, child, ...). No innerHTML anywhere (strict CSP, no XSS).
export function h(tag, attrs, ...kids) {
  const el = tag === 'svg' || tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.replace('svg:', '')) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export const svg = (tag, attrs, ...kids) => h('svg:' + tag, attrs, ...kids);
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function mount(el, ...kids) { clear(el); add(el, kids); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = h('textarea', { value: text }); document.body.append(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
