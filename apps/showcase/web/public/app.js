"use strict";

// Builds the project cards from /api/projects.
// Only textContent is used for card data, so nothing in projects.json can inject HTML.

const statusEl = document.getElementById("status");
const listEl = document.getElementById("cards");
const template = document.getElementById("card-template");

const AUTHOR_CLASS = { Dustin: "author-dustin", Tripp: "author-tripp", "Co-authored": "author-both" };

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function exampleBlock(label, commands) {
  const section = document.createElement("section");
  section.className = "example";
  const heading = document.createElement("h3");
  heading.textContent = label;
  section.append(heading);

  for (const cmd of commands) {
    const row = document.createElement("div");
    row.className = "example-row";
    const code = document.createElement("code");
    code.textContent = cmd;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", `Copy: ${cmd}`);
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        button.textContent = "Copied!";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    });
    row.append(code, button);
    section.append(row);
  }
  return section;
}

function renderCard(project) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.id = project.slug;

  const link = card.querySelector(".card-link");
  link.textContent = project.name;
  link.href = project.url;

  const badge = card.querySelector(".badge");
  badge.textContent = project.author;
  badge.classList.add(AUTHOR_CLASS[project.author] || "author-both");

  const date = card.querySelector(".card-date");
  date.dateTime = project.launch_date;
  date.textContent = `Launched ${formatDate(project.launch_date)}`;

  card.querySelector(".card-description").textContent = project.description;

  const examples = card.querySelector(".examples");
  if (project.examples.api.length) examples.append(exampleBlock("API", project.examples.api));
  if (project.examples.cli.length) examples.append(exampleBlock("CLI", project.examples.cli));
  if (!examples.childElementCount) examples.remove();

  return card;
}

async function load() {
  try {
    const resp = await fetch("/api/projects", { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { projects } = await resp.json();
    listEl.replaceChildren(...projects.map(renderCard));
    statusEl.textContent = projects.length ? "" : "No projects yet. Check back soon!";
    statusEl.hidden = projects.length > 0;
  } catch (err) {
    console.error("Could not load projects:", err);
    statusEl.textContent = "Couldn't load the projects right now. Please try again in a minute.";
    statusEl.classList.add("error");
  }
}

load();
