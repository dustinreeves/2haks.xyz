// Fills "The stuff" from the showcase API (proxied at /api/* by Caddy),
// so every app that gets a showcase card shows up here automatically.
const AUTHORS = {
  Dustin: "Dustin",
  Tripp: "Tripp",
  "Co-authored": "Dustin & Tripp",
};
const ACCENTS = ["#ff4f9a", "#12b5a6", "#ffb000", "#7b5cff"];

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function card(project, i) {
  const url = /^https:\/\//.test(project.url) ? project.url : "#";
  const link = el("a", { className: "card", href: url }, [
    el("h3", { textContent: project.name }),
    el("p", { textContent: project.description }),
    el("div", { className: "meta" }, [
      el("span", { className: "badge", textContent: AUTHORS[project.author] || project.author }),
      el("span", { className: "go", textContent: "Play →" }),
    ]),
  ]);
  link.style.setProperty("--accent", ACCENTS[i % ACCENTS.length]);
  return link;
}

async function load() {
  const box = document.getElementById("apps");
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error(res.status);
    const { projects } = await res.json();
    const apps = projects
      .filter((p) => p.slug !== "showcase")
      .sort((a, b) => b.launch_date.localeCompare(a.launch_date));
    box.replaceChildren(...apps.map(card));
  } catch {
    box.replaceChildren(el("p", { className: "muted" }, [
      "Couldn't load the list right now. See everything at ",
      el("a", { href: "https://projects.2haks.xyz", textContent: "projects.2haks.xyz" }),
      ".",
    ]));
  }
}

load();
