// Pod Pile: pages and routing. Routes live in the URL hash:
//   #/                 top chart (all genres)
//   #/top/<genre>      top chart for one genre
//   #/search/<words>   search
//   #/p/<id>           one show and its episodes
//   #/queue            up next and history

import * as player from "./player.js";
import { epRef, store } from "./store.js";
import { ICONS, api, art, clock, fill, h, icon, linkify, minutes, toast, when } from "./util.js";

const view = document.getElementById("view");
const EP_PAGE = 40;
let genres = null;
let renderId = 0;

const showCache = new Map(); // id -> show page data, for quick back/forward

// ---------- shared bits ----------

function explicitBadge(on) {
  return on ? h("span", { class: "badge-e", title: "Explicit" }, "E") : null;
}

function showCard(s) {
  return h("a", { class: "card", href: `#/p/${s.id}` },
    h("div", { class: "art" },
      art(s.artwork, ""),
      s.rank ? h("span", { class: `rank${s.rank <= 3 ? " top3" : ""}` }, `#${s.rank}`) : null),
    h("div", { class: "name" }, s.name, explicitBadge(s.explicit)),
    h("div", { class: "by" }, s.author));
}

function skeletonGrid(n = 12) {
  return h("div", { class: "grid" }, Array.from({ length: n }, () =>
    h("div", { class: "card" }, h("div", { class: "art skel" }), h("div", { class: "skel", style: "height:14px;margin-top:10px;width:80%" }))));
}

function errorNote(e, retry) {
  return h("div", { class: "note err" }, e.message || String(e), " ",
    retry ? h("button", { class: "link-btn", type: "button", onclick: retry }, "Try again") : null);
}

function explicitToggle(onchange) {
  const box = h("input", { type: "checkbox", checked: store.settings.hideExplicit });
  box.addEventListener("change", () => {
    store.settings.hideExplicit = box.checked;
    store.saveSettings();
    onchange();
  });
  return h("label", { class: "toggle" }, box, "Hide explicit shows");
}

const visible = (shows) => (store.settings.hideExplicit ? shows.filter((s) => !s.explicit) : shows);

function playButton(ref) {
  const btn = h("button", { class: "play", type: "button", "aria-label": `Play ${ref.title}`, dataset: { play: ref.key } },
    icon(ICONS.play, "i-play"), icon(ICONS.pause, "i-pause"));
  btn.addEventListener("click", () => player.toggle(ref));
  paintPlayButton(btn);
  return btn;
}

function paintPlayButton(btn) {
  const isCur = btn.dataset.play === player.currentKey();
  const playing = isCur && player.isPlaying();
  btn.classList.toggle("current", isCur);
  btn.classList.toggle("playing", playing);
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

document.addEventListener("player:change", () => {
  document.querySelectorAll("[data-play]").forEach(paintPlayButton);
});

function queueButton(ref) {
  const btn = h("button", { class: "icon-btn", type: "button" });
  const paint = () => {
    const q = store.inQueue(ref.key);
    fill(btn, icon(q ? ICONS.queued : ICONS.queue));
    btn.title = q ? "Remove from Up next" : "Add to Up next";
    btn.setAttribute("aria-label", btn.title);
  };
  btn.addEventListener("click", () => {
    if (store.inQueue(ref.key)) store.dequeue(ref.key);
    else { store.enqueue(ref); toast("Added to Up next"); }
    paint();
  });
  paint();
  return btn;
}

function playedButton(ref, onchange) {
  const p = store.progress(ref.key);
  const done = !!p?.done;
  return h("button", {
    class: "icon-btn", type: "button", title: done ? "Mark as not played" : "Mark as played",
    "aria-label": done ? "Mark as not played" : "Mark as played",
    onclick: () => { store.markPlayed(ref, !done); onchange(); },
  }, icon(done ? ICONS.close : ICONS.check));
}

function episodeSub(ref, extra = []) {
  const p = store.progress(ref.key);
  const bits = [when(ref.published), ...extra];
  let status = null;
  if (p?.done) status = h("span", { class: "done" }, "Played");
  else if (p && p.pos > 15) {
    const dur = p.dur || ref.duration;
    status = dur ? `${minutes(dur - p.pos)} left` : `at ${clock(p.pos)}`;
  } else if (ref.duration) status = minutes(ref.duration);
  return h("div", { class: "sub" }, [...bits, status].filter(Boolean).flatMap((b, i) => (i ? [" · ", b] : [b])));
}

function miniBar(ref) {
  const p = store.progress(ref.key);
  const dur = p?.dur || ref.duration;
  if (!p || p.done || !dur || p.pos < 15) return null;
  return h("div", { class: "bar-mini" }, h("i", { style: `width:${Math.min(100, (p.pos / dur) * 100).toFixed(1)}%` }));
}

function episodeRow(ref, { notes = "", showName = false, side = [] } = {}) {
  const li = h("li", { class: "ep" });
  const paint = () => {
    fill(li,
      playButton(ref),
      h("div", {},
        h("p", { class: "title" }, ref.title),
        showName ? h("div", { class: "sub" }, h("a", { href: `#/p/${ref.showId}` }, ref.show)) : null,
        episodeSub(ref),
        miniBar(ref)),
      h("div", { class: "side" }, ...side.map((f) => f(ref, paint)), queueButton(ref), playedButton(ref, paint)),
      notes ? h("details", {}, h("summary", {}, "Show notes"), h("p", { class: "notes" }, linkify(notes))) : null);
  };
  paint();
  return li;
}

// ---------- pages ----------

async function home(genre = "all") {
  const id = ++renderId;
  document.title = "Pod Pile: the biggest podcasts";

  const chips = h("div", { class: "chips" });
  const gridWrap = h("div", {}, skeletonGrid());
  const fresh = h("p", { class: "muted", style: "font-size:13px" });

  const resume = store.inProgress(6);
  const follows = visible(store.follows());

  fill(view,
    h("section", { class: "hero" },
      h("h1", {}, "The ", h("span", {}, "biggest"), " podcasts, all in one pile."),
      h("p", {}, "The top 100 shows right now, straight from each creator's own feed. Tap one and press play.")),
    resume.length ? h("section", {}, h("h2", {}, "Keep listening"),
      h("ul", { class: "eps" }, resume.map((p) => episodeRow(p.ref, { showName: true })))) : null,
    follows.length ? h("section", {}, h("h2", {}, "Your shows"),
      h("div", { class: "row-scroll" }, follows.map(showCard))) : null,
    h("section", {},
      h("h2", {}, genre === "all" ? "Top 100" : `Top 100: ${genreName(genre)}`),
      h("div", { class: "bar" }, chips, explicitToggle(() => home(genre))),
      gridWrap, fresh));

  try {
    genres ||= (await api("/genres")).genres;
    if (id !== renderId) return;
    fill(chips, ...genres.map((g) =>
      h("a", { class: `chip${g.id === genre ? " on" : ""}`, href: g.id === "all" ? "#/" : `#/top/${g.id}` }, g.name)));
    chips.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center" });
    if (genre !== "all") view.querySelector("section:last-child h2").textContent = `Top 100: ${genreName(genre)}`;

    const data = await api(`/top?genre=${encodeURIComponent(genre)}`);
    if (id !== renderId) return;
    const shows = visible(data.shows);
    const hidden = data.shows.length - shows.length;
    fill(gridWrap, shows.length ? h("div", { class: "grid" }, shows.map(showCard)) : h("p", { class: "empty" }, "Nothing here."));
    fresh.textContent = `Chart from Apple Podcasts (US), updated ${when(data.fetched).toLowerCase()} at ${new Date(data.fetched).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      + (hidden ? ` ${hidden} explicit show${hidden === 1 ? "" : "s"} hidden.` : "");
  } catch (e) {
    if (id === renderId) fill(gridWrap, errorNote(e, () => home(genre)));
  }
}

const genreName = (g) => genres?.find((x) => x.id === g)?.name || g;

async function search(q) {
  const id = ++renderId;
  document.getElementById("search-q").value = q;
  document.title = `${q} · Pod Pile`;
  const results = h("div", {}, skeletonGrid(6));
  fill(view,
    h("h2", {}, `Shows matching “${q}”`),
    h("div", { class: "bar" }, explicitToggle(() => search(q))),
    results);
  if (q.length < 2) { fill(results, h("p", { class: "empty" }, "Type at least two letters.")); return; }
  try {
    const data = await api(`/search?q=${encodeURIComponent(q)}`);
    if (id !== renderId) return;
    const shows = visible(data.shows);
    fill(results, shows.length ? h("div", { class: "grid" }, shows.map(showCard))
      : h("p", { class: "empty" }, "No shows found. Try different words."));
  } catch (e) {
    if (id === renderId) fill(results, errorNote(e, () => search(q)));
  }
}

async function show(showId) {
  const id = ++renderId;
  const cached = showCache.get(showId);
  if (!cached) {
    fill(view, h("div", { class: "show-head" }, h("div", { class: "art skel" }),
      h("div", {}, h("div", { class: "skel", style: "height:36px;width:60%;margin:8px 0" }), h("div", { class: "skel", style: "height:16px;width:30%" }))));
  }
  let data;
  try {
    data = cached || await api(`/podcasts/${encodeURIComponent(showId)}`);
  } catch (e) {
    if (id === renderId) fill(view, errorNote(e, () => show(showId)));
    return;
  }
  if (id !== renderId) return;
  showCache.set(showId, data);
  if (showCache.size > 30) showCache.delete(showCache.keys().next().value);

  const pod = data.podcast;
  const refs = data.episodes.map((ep) => ({ ref: epRef(pod, ep), ep }));
  document.title = `${pod.name} · Pod Pile`;

  const about = h("p", { class: "about clamp" }, pod.description);
  const moreAbout = h("button", { class: "link-btn", type: "button", onclick: () => { about.classList.remove("clamp"); moreAbout.remove(); } }, "More");
  const follow = h("button", { class: "btn", type: "button" });
  const paintFollow = () => {
    const on = store.isFollowing(pod.id);
    follow.textContent = on ? "✓ Following" : "+ Follow";
    follow.classList.toggle("on", on);
  };
  follow.addEventListener("click", () => { toast(store.toggleFollow(pod) ? `Following ${pod.name}` : "Unfollowed"); paintFollow(); });
  paintFollow();

  let sortNewest = true, filter = "", hidePlayed = false, shown = EP_PAGE;
  const list = h("ul", { class: "eps" });
  const more = h("button", { class: "btn more", type: "button", onclick: () => { shown += EP_PAGE; paintList(); } }, "Show more episodes");
  const filterBox = h("input", { type: "search", placeholder: "Find an episode…", "aria-label": "Find an episode" });
  filterBox.addEventListener("input", () => { filter = filterBox.value.trim().toLowerCase(); shown = EP_PAGE; paintList(); });
  const sortBtn = h("button", { class: "btn", type: "button", onclick: () => { sortNewest = !sortNewest; sortBtn.textContent = sortNewest ? "Newest first" : "Oldest first"; paintList(); } }, "Newest first");
  const playedBox = h("input", { type: "checkbox" });
  playedBox.addEventListener("change", () => { hidePlayed = playedBox.checked; paintList(); });

  function paintList() {
    let rows = sortNewest ? refs : [...refs].reverse();
    if (filter) rows = rows.filter(({ ep }) => ep.title.toLowerCase().includes(filter) || ep.description.toLowerCase().includes(filter));
    if (hidePlayed) rows = rows.filter(({ ref }) => !store.progress(ref.key)?.done);
    fill(list, ...rows.slice(0, shown).map(({ ref, ep }) => episodeRow(ref, { notes: ep.description })));
    if (!rows.length) fill(list, h("li", { class: "empty" }, filter ? "No episodes match." : "No episodes to show."));
    more.hidden = rows.length <= shown;
  }

  const latest = refs[0]?.ref;
  const meta = [pod.genre, `${pod.episode_count} episode${pod.episode_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  fill(view,
    h("div", { class: "show-head" },
      h("div", { class: "art" }, art(pod.artwork, pod.name)),
      h("div", {},
        h("h1", {}, pod.name, explicitBadge(pod.explicit)),
        h("div", { class: "by" }, pod.author),
        h("div", { class: "meta" }, meta),
        about, pod.description.length > 280 ? moreAbout : null,
        h("div", { class: "actions" },
          latest ? h("button", { class: "btn primary", type: "button", onclick: () => player.load(latest) }, "▶ Play latest") : null,
          follow,
          pod.link ? h("a", { class: "btn", href: pod.link, target: "_blank", rel: "noopener noreferrer" }, "Website ↗") : null,
          pod.apple_url ? h("a", { class: "btn", href: pod.apple_url, target: "_blank", rel: "noopener noreferrer" }, "Apple ↗") : null),
        data.stale ? h("p", { class: "note" }, "The creator's feed didn't answer just now, so this is the last copy we saw.") : null)),
    h("div", { class: "ep-tools" },
      h("h2", {}, "Episodes"),
      filterBox, sortBtn,
      h("label", { class: "toggle" }, playedBox, "Hide played")),
    refs.length < pod.episode_count ? h("p", { class: "muted", style: "font-size:13px;margin:0" }, `Showing the newest ${refs.length} of ${pod.episode_count}.`) : null,
    list, more);
  paintList();
}

function queuePage() {
  ++renderId;
  document.title = "Up next · Pod Pile";
  const q = store.queue();
  const hist = store.history(30);
  const moveUp = (ref) => h("button", {
    class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move up",
    onclick: () => { store.moveUp(ref.key); queuePage(); },
  }, icon(ICONS.up));
  fill(view,
    h("h2", {}, "Up next"),
    q.length ? h("ul", { class: "eps" }, q.map((ref, i) => episodeRow(ref, { showName: true, side: i ? [moveUp] : [] })))
      : h("p", { class: "empty" }, "Nothing queued. Tap the list icon on any episode to add it here."),
    q.length ? h("button", { class: "btn", type: "button", onclick: () => player.playNext() }, "▶ Play the queue") : null,
    h("h2", {}, "Recently played"),
    hist.length ? h("ul", { class: "eps" }, hist.map((p) => episodeRow(p.ref, { showName: true })))
      : h("p", { class: "empty" }, "Nothing yet."));
}

// ---------- routing ----------

function route() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [page, ...rest] = hash.split("/");
  const arg = rest.join("/");
  if (page === "p" && /^\d{1,12}$/.test(arg)) show(arg);
  else if (page === "search") search(arg.trim());
  else if (page === "top" && arg) home(arg);
  else if (page === "queue") queuePage();
  else home();
  if (page !== "search") document.getElementById("search-q").value = "";
  scrollTo(0, 0);
}

document.getElementById("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("search-q").value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

function paintQueueCount() {
  const n = store.queue().length;
  const c = document.getElementById("queue-count");
  c.textContent = n;
  c.hidden = n === 0;
}
document.addEventListener("store:change", paintQueueCount);

addEventListener("hashchange", route);
paintQueueCount();
route();
