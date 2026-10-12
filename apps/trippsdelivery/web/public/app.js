"use strict";

// Desktop only: block phones, tablets and touch-first devices.
(function () {
  var ua = navigator.userAgent || "";
  var mobileUA = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|BlackBerry|Opera Mini/i.test(ua);
  var iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  var coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
  if (mobileUA || iPadOS || coarse) document.documentElement.classList.add("blocked-on");
})();

var PRICE = { water: 2, dog: 95, lawn: 39 };
var MAX = { water: 24, dog: 5, lawn: 5 };
var qty = { water: 0, dog: 0, lawn: 0 };
var stock = 0;

var $ = function (id) { return document.getElementById(id); };
var ids = { water: ["wm", "wp", "wq"], dog: ["dm", "dp", "dq"], lawn: ["lm", "lp", "lq"] };

function total() {
  return qty.water * PRICE.water + qty.dog * PRICE.dog + qty.lawn * PRICE.lawn;
}

function render() {
  $("stock").textContent = stock - qty.water;
  Object.keys(ids).forEach(function (k) {
    $(ids[k][2]).textContent = qty[k];
    $(ids[k][0]).disabled = qty[k] === 0;
    var cap = k === "water" ? Math.min(stock, MAX.water) : MAX[k];
    $(ids[k][1]).disabled = qty[k] >= cap;
  });
  $("total").textContent = "$" + total();
  $("send").disabled = total() === 0 || !$("name").value.trim();
}

function say(text, kind) {
  var el = $("status");
  el.textContent = text;
  el.className = kind || "";
}

function loadStock() {
  return fetch("/api/stock")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      stock = j.water;
      qty.water = Math.min(qty.water, stock);
      render();
    })
    .catch(function () { say("Could not load the water stock. Try reloading.", "bad"); });
}

// FormSubmit only accepts messages from browsers. The order is already saved either way.
function emailFallback(order) {
  var items = [];
  if (order.water) items.push(order.water + " x Water");
  if (order.dog) items.push(order.dog + " x Dog sitting");
  if (order.lawn) items.push(order.lawn + " x Lawn mowing");
  fetch("https://formsubmit.co/ajax/trippreeves@gmail.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      _subject: "Tripp's Delivery order #" + order.id + " from " + order.name,
      Name: order.name,
      Order: items.join(", "),
      Total: "$" + order.total
    })
  }).catch(function () { /* saved on the server; Tripp can see it with `tripps orders` */ });
}

Object.keys(ids).forEach(function (k) {
  $(ids[k][0]).onclick = function () { qty[k]--; render(); };
  $(ids[k][1]).onclick = function () { qty[k]++; render(); };
});
$("name").oninput = render;

$("send").onclick = function () {
  var name = $("name").value.trim();
  var due = total();
  $("send").disabled = true;
  say("Sending...");

  fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, water: qty.water, dog: qty.dog, lawn: qty.lawn })
  }).then(function (r) {
    return r.json().then(function (j) { return { ok: r.ok, body: j }; });
  }).then(function (res) {
    if (!res.ok) {
      var detail = res.body && res.body.detail;
      throw new Error(typeof detail === "string" ? detail : "Something went wrong.");
    }
    var order = res.body;
    qty = { water: 0, dog: 0, lawn: 0 };
    stock = order.water_left;
    say("Order sent, " + name + "! Total due: $" + due, "ok");
    render();
    // The API emails by SMTP when configured; otherwise the browser sends the email itself.
    if (!order.emailed) emailFallback(order);
  }).catch(function (err) {
    say(err.message || "Could not send. Try again in a moment.", "bad");
    loadStock();
  });
};

render();
loadStock();
