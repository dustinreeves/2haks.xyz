// Fire Raze engine: a developer console in the style of Source.
//
//   ConVar      a named setting:   `sv_gravity` prints it, `sv_gravity 300` sets it
//   ConCommand  a named action:    `noclip`, `map 04-fling`
//   cheat       only works while `sv_cheats 1`
//
// Several commands can go on one line, split by ";" (for example `sv_cheats 1; noclip`).

export class DevConsole {
  constructor({ root, log, input }) {
    this.root = root;
    this.logEl = log;
    this.input = input;
    this.vars = new Map();
    this.cmds = new Map();
    this.binds = new Map();
    this.history = [];
    this.historyPos = 0;
    this.isOpen = false;
    this.onToggle = () => {};

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const line = this.input.value;
        this.input.value = "";
        if (line.trim()) {
          this.history.push(line);
          this.historyPos = this.history.length;
          this.print(`] ${line}`, "cmd");
          this.exec(line);
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.historyPos = Math.max(0, Math.min(this.history.length, this.historyPos + (e.key === "ArrowUp" ? -1 : 1)));
        this.input.value = this.history[this.historyPos] || "";
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.complete();
      } else if (e.code === "Backquote" || e.key === "`" || e.key === "~" || e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
      e.stopPropagation(); // typing here never moves the player
    });

    this.cvar("sv_cheats", 0, { help: "Allow cheat commands (1 = on).", min: 0, max: 1 });
    this.command("help", (args) => this.help(args[0]), "help <name>: what a command or setting does.");
    this.command("find", (args) => this.find(args[0] || ""), "find <text>: list commands and settings containing text.");
    this.command("cvarlist", () => this.find(""), "List every command and setting.");
    this.command("echo", (args) => this.print(args.join(" ")), "echo <text>: print text.");
    this.command("clear", () => { this.logEl.replaceChildren(); }, "Clear the console.");
    this.command("bind", (args) => this.bind(args), "bind <key> \"<command>\": run a command when a key is pressed.");
    this.command("unbind", (args) => { this.binds.delete((args[0] || "").toLowerCase()); }, "unbind <key>");
  }

  // ---------- registering ----------

  cvar(name, value, { help = "", cheat = false, min, max, onChange } = {}) {
    this.vars.set(name, { name, value, initial: value, help, cheat, min, max, onChange });
  }

  command(name, run, help = "", { cheat = false } = {}) {
    this.cmds.set(name, { name, run, help, cheat });
  }

  get(name) {
    return this.vars.get(name).value;
  }

  set(name, value, quiet = false) {
    const v = this.vars.get(name);
    let n = Number(value);
    if (!Number.isFinite(n)) {
      this.print(`${name} needs a number`, "err");
      return;
    }
    if (v.min !== undefined) n = Math.max(v.min, n);
    if (v.max !== undefined) n = Math.min(v.max, n);
    const old = v.value;
    v.value = n;
    if (!quiet) this.print(`${name} = ${n}`);
    if (v.onChange && old !== n) v.onChange(n, old);
  }

  get cheats() {
    return this.get("sv_cheats") === 1;
  }

  // ---------- running ----------

  exec(line) {
    for (const part of split(line, ";")) {
      const args = split(part.trim(), " ");
      if (!args.length) continue;
      const name = args.shift().toLowerCase();
      const cmd = this.cmds.get(name);
      const v = this.vars.get(name);
      if (!cmd && !v) {
        this.print(`Unknown command "${name}". Try "find ${name.slice(0, 4)}" or "help".`, "err");
        continue;
      }
      const cheat = cmd ? cmd.cheat : v.cheat && args.length > 0;
      if (cheat && !this.cheats) {
        this.print(`Can't use cheat command ${name} in multiplayer, unless the server has sv_cheats set to 1.`, "err");
        continue;
      }
      try {
        if (cmd) cmd.run(args);
        else if (args.length) this.set(name, args[0]);
        else this.print(`"${name}" = "${v.value}" (default "${v.initial}")${v.help ? ` - ${v.help}` : ""}`);
      } catch (err) {
        this.print(`${name}: ${err.message}`, "err");
      }
    }
  }

  /** Called by the game on every key press while the console is closed. Returns true if a bind ran. */
  key(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    const line = this.binds.get(k);
    if (!line) return false;
    this.exec(line);
    return true;
  }

  bind(args) {
    if (!args.length) {
      for (const [k, line] of this.binds) this.print(`"${k}" = "${line}"`);
      return;
    }
    const key = args[0].toLowerCase();
    if (args.length === 1) {
      this.print(this.binds.has(key) ? `"${key}" = "${this.binds.get(key)}"` : `"${key}" is not bound`);
      return;
    }
    this.binds.set(key, args.slice(1).join(" "));
  }

  help(name) {
    if (!name) {
      this.print("Type a command and press Enter. Tab completes names. Up/Down for history. ` or Esc closes.");
      this.print("Try: find sv_   |   cvarlist   |   sv_cheats 1; noclip   |   help god");
      return;
    }
    const c = this.cmds.get(name) || this.vars.get(name);
    if (!c) this.print(`No command or setting called "${name}".`, "err");
    else this.print(`${name}${c.cheat ? " (cheat)" : ""}: ${c.help || "no description"}`);
  }

  find(text) {
    const names = [...this.cmds.keys(), ...this.vars.keys()].filter((n) => n.includes(text.toLowerCase())).sort();
    for (const n of names) {
      const c = this.cmds.get(n) || this.vars.get(n);
      const value = this.vars.has(n) ? ` = ${this.vars.get(n).value}` : "";
      this.print(`  ${n}${value}${c.cheat ? "  [cheat]" : ""}  ${c.help}`);
    }
    if (!names.length) this.print("Nothing found.");
  }

  complete() {
    const text = this.input.value.trim().toLowerCase();
    if (!text) return;
    const names = [...this.cmds.keys(), ...this.vars.keys()].filter((n) => n.startsWith(text)).sort();
    if (names.length === 1) this.input.value = `${names[0]} `;
    else if (names.length) this.print(names.join("   "));
  }

  print(text, kind = "") {
    const line = document.createElement("div");
    line.textContent = text;
    if (kind) line.className = kind;
    this.logEl.append(line);
    while (this.logEl.childElementCount > 300) this.logEl.firstElementChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ---------- showing ----------

  open() {
    this.isOpen = true;
    this.root.hidden = false;
    this.input.focus();
    this.onToggle(true);
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
    this.input.blur();
    this.onToggle(false);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}

// Split on a separator, but keep "quoted text" together (and drop the quotes).
function split(text, sep) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === "\"") quoted = !quoted;
    else if (ch === sep && !quoted) {
      if (cur.trim() || sep === ";") out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => (sep === " " ? s.trim() : s)).filter((s) => s !== "");
}
