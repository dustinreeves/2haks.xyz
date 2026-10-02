// Stats and names for a design. Mirrors compute_stats / design_name in
// api/app/catalog.py, so the page can show them before a design is saved.

export function emptyDesign(catalog) {
  return {
    base: catalog.bases[0].id,
    parts: {},
    paint: { body: "#2f3640", accent: "#ff4f9a", finish: catalog.finishes[0].id },
  };
}

export function lookup(catalog) {
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  return {
    bases: byId(catalog.bases),
    parts: byId(catalog.parts),
    finishes: byId(catalog.finishes),
    slots: catalog.slots.map((s) => s.id),
    stats: catalog.stats.map((s) => s.id),
  };
}

// Can this part go on this design right now?
export function fits(L, design, part) {
  const base = L.bases[design.base];
  if (part.classes && !part.classes.includes(base.class)) return false;
  return hasMount(L, design, part.slot);
}

export function hasMount(L, design, slot) {
  if (L.bases[design.base].mounts[slot]) return true;
  return Object.entries(design.parts).some(
    ([s, id]) => s !== slot && id && L.parts[id]?.mounts?.[slot],
  );
}

// Drop parts that no longer fit (after a base change or removing a barrel).
export function tidy(L, design) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [slot, id] of Object.entries(design.parts)) {
      const part = L.parts[id];
      if (!part || !fits(L, design, part)) {
        delete design.parts[slot];
        changed = true;
      }
    }
  }
  return design;
}

export function computeStats(L, design) {
  const total = { ...L.bases[design.base].stats };
  const extras = Object.values(design.parts).map((id) => L.parts[id]);
  extras.push(L.finishes[design.paint.finish]);
  for (const item of extras) {
    for (const [k, v] of Object.entries(item?.stats || {})) total[k] = (total[k] || 0) + v;
  }
  return Object.fromEntries(L.stats.map((k) => [k, Math.max(0, Math.min(100, total[k] || 0))]));
}

export function designName(L, design) {
  let best = null;
  let bestGoof = null;
  for (const slot of L.slots) {
    const part = L.parts[design.parts[slot]];
    if (part?.nick) {
      const goof = part.stats?.goofiness || 0;
      if (bestGoof === null || goof > bestGoof) {
        best = part.nick;
        bestGoof = goof;
      }
    }
  }
  return [L.finishes[design.paint.finish].adj, best, L.bases[design.base].name].filter(Boolean).join(" ");
}

export function randomDesign(catalog, L, rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const hex = () => "#" + Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
  const design = {
    base: pick(catalog.bases).id,
    parts: {},
    paint: { body: hex(), accent: hex(), finish: pick(catalog.finishes).id },
  };
  // Barrel first so a muzzle has somewhere to go.
  for (const slot of L.slots) {
    if (rand() < 0.2) continue;
    const options = catalog.parts.filter((p) => p.slot === slot && fits(L, design, p));
    if (options.length) design.parts[slot] = pick(options).id;
  }
  return design;
}
