import { QUESTIONS } from "./questions.js";

const CREW = ["Diedra", "Jessica", "Jennifer", "Austina", "Jody", "Lisa", "Laura", "Wendy", "Elizabeth"];
const ROUND = 12;

const DEDICATIONS = [
  (n) => `🎉 This one's for ${n}!`,
  (n) => `💜 Shout-out to ${n}!`,
  (n) => `⭐ ${n}, this one's yours!`,
  (n) => `🩺 Dedicated to ${n}`,
  (n) => `🙌 Big hugs to ${n}`,
  (n) => `☕ ${n} could answer this half-asleep after a 12-hour shift`,
  (n) => `🏆 Brought to you by ${n}`,
];
const RIGHT = ["Nailed it", "Textbook", "Charting that as a win", "Chef's kiss", "Look at you go", "Perfect technique"];
const WRONG = ["Not quite", "So close", "Ooh, tricky one", "Good guess, but no"];
const RANKS = [
  [12, "Chemo Legend 👑", "A perfect round. The whole unit should be calling you for advice."],
  [10, "Charge Nurse Material 🌟", "Practically flawless. Someone get this nurse a raise."],
  [7, "Solid Shift 💪", "Safe hands. Your patients are lucky."],
  [4, "Needs Another Coffee ☕", "Grab a coffee and go again. You've got this."],
  [0, "Call the Pharmacist 📞", "Hey, that's what pharmacists are for! Try another round."],
];

const $ = (sel) => document.querySelector(sel);
let player = null;
let round = [];
let index = 0;
let score = 0;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const withName = (text) => (player ? `${text}, ${player}!` : `${text}!`);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function show(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  window.scrollTo({ top: 0 });
}

// ---- start screen ----

function renderPlayers() {
  const buttons = [...CREW, null].map((name) => {
    const b = el("button", { type: "button", className: "who", textContent: name || "Someone else" });
    b.addEventListener("click", () => {
      player = name;
      startRound();
    });
    return b;
  });
  $("#players").replaceChildren(...buttons);
}

// ---- playing ----

function startRound() {
  const names = shuffle(CREW);
  round = shuffle(QUESTIONS).slice(0, ROUND).map((q, i) => {
    const order = shuffle(q.choices.map((_, k) => k));
    return {
      ...q,
      choices: order.map((k) => q.choices[k]),
      answer: order.indexOf(q.answer),
      honoree: names[i % names.length],
    };
  });
  index = 0;
  score = 0;
  show("play");
  renderQuestion();
}

function renderQuestion() {
  const q = round[index];
  $("#progress-text").textContent = `Question ${index + 1} of ${round.length}`;
  $("#score-text").textContent = `${score} right`;
  $("#progress-fill").style.width = `${(index / round.length) * 100}%`;
  $("#dedication").textContent = q.honoree === player
    ? `💜 This one's for you, ${player}!`
    : pick(DEDICATIONS)(q.honoree);
  $("#question").textContent = q.q;
  $("#feedback").hidden = true;
  $("#choices").replaceChildren(
    ...q.choices.map((text, i) => {
      const b = el("button", { type: "button", className: "choice" }, [
        el("span", { className: "letter", textContent: "ABCD"[i] }),
        el("span", { textContent: text }),
      ]);
      b.addEventListener("click", () => answer(i));
      return b;
    }),
  );
  $("#question").focus();
}

function answer(i) {
  const q = round[index];
  const right = i === q.answer;
  if (right) score++;
  const buttons = [...document.querySelectorAll(".choice")];
  buttons.forEach((b, k) => {
    b.disabled = true;
    if (k === q.answer) b.classList.add("correct");
    else if (k === i) b.classList.add("wrong");
  });
  $("#score-text").textContent = `${score} right`;
  $("#verdict").textContent = right ? `✅ ${withName(pick(RIGHT))}` : `❌ ${withName(pick(WRONG))}`;
  $("#verdict").className = right ? "verdict good" : "verdict bad";
  $("#why").textContent = q.why;
  $("#next").textContent = index + 1 < round.length ? "Next question →" : "See my score 🎉";
  $("#feedback").hidden = false;
  $("#next").focus();
  if (right) confetti(12);
}

function next() {
  index++;
  if (index < round.length) renderQuestion();
  else finish();
}

// ---- results ----

function finish() {
  $("#progress-fill").style.width = "100%";
  const [, title, blurb] = RANKS.find(([min]) => score >= min);
  $("#final-score").textContent = `${score} / ${round.length}`;
  $("#rank").textContent = title;
  $("#blurb").textContent = player ? `${blurb} Thanks for playing, ${player}!` : blurb;
  $("#crew").replaceChildren(...CREW.map((n) => el("li", { className: n === player ? "me" : "", textContent: n })));
  show("results");
  confetti(score >= 10 ? 80 : score >= 7 ? 40 : 15);
}

// ---- confetti ----

const COLORS = ["#ff4f9a", "#ffd23f", "#12b5a6", "#7b5cff", "#ff8a1f"];
function confetti(count) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = $("#confetti");
  for (let i = 0; i < count; i++) {
    const bit = el("span", { className: "bit" });
    bit.style.left = `${Math.random() * 100}vw`;
    bit.style.background = COLORS[i % COLORS.length];
    bit.style.animationDelay = `${Math.random() * 0.4}s`;
    bit.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    bit.style.setProperty("--drift", `${(Math.random() - 0.5) * 200}px`);
    bit.style.setProperty("--spin", `${(Math.random() - 0.5) * 1080}deg`);
    bit.addEventListener("animationend", () => bit.remove());
    layer.append(bit);
  }
}

// ---- start ----

$("#next").addEventListener("click", next);
$("#again").addEventListener("click", startRound);
$("#switch").addEventListener("click", () => show("start"));
$("#bank-size").textContent = QUESTIONS.length;
$("#crew-list").textContent = CREW.slice(0, -1).join(", ") + " & " + CREW.at(-1);
renderPlayers();
show("start");
