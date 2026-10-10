// Fire Raze engine: game controllers (DualSense, Xbox and others) through the browser Gamepad API.
//
// Uses the "standard" button layout, which browsers give PlayStation and Xbox controllers:
//   0 ✕/A   1 ○/B   2 □/X   3 △/Y   4 L1   5 R1   6 L2   7 R2   8 Create/View   9 Options/Menu
//   10 L3   11 R3   12 up   13 down   14 left   15 right      axes: 0,1 left stick   2,3 right stick
import * as THREE from "../vendor/three-0.170.0.module.min.js";

export const BUTTON = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const DEADZONE = 0.15;

// Ignore tiny stick wobble, then rescale so movement still starts gently from 0.
function deadzone(x, y) {
  const len = Math.hypot(x, y);
  if (len < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
  return [(x / len) * scaled, (y / len) * scaled];
}

export class GamepadInput {
  constructor() {
    this.index = null;
    this.move = new THREE.Vector2();   // left stick (x right, y down)
    this.look = new THREE.Vector2();   // right stick
    this.down = new Set();             // buttons held now
    this.pressed = new Set();          // buttons that went down this frame
    this.inUse = false;                // true after the controller was used, until the mouse/keys are
    this.name = "";
    this.onConnect = () => {};
    window.addEventListener("gamepadconnected", (e) => {
      if (this.index === null) {
        this.index = e.gamepad.index;
        this.name = e.gamepad.id;
        this.onConnect(e.gamepad);
      }
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (e.gamepad.index === this.index) {
        this.index = null;
        this.inUse = false;
        this.move.set(0, 0);
        this.look.set(0, 0);
        this.down.clear();
      }
    });
  }

  get connected() {
    return this.index !== null;
  }

  /** Read the controller. Call once per frame, before using the values. */
  poll() {
    this.pressed.clear();
    if (this.index === null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this.index];
    if (!gp) return;
    const [mx, my] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0);
    const [lx, ly] = deadzone(gp.axes[2] || 0, gp.axes[3] || 0);
    this.move.set(mx, my);
    this.look.set(lx, ly);
    const now = new Set();
    gp.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) now.add(i);
    });
    for (const i of now) if (!this.down.has(i)) this.pressed.add(i);
    this.down = now;
    if (this.pressed.size || this.move.lengthSq() > 0 || this.look.lengthSq() > 0) this.inUse = true;
  }

  /** Short buzz. strength 0-1, ms = how long. Does nothing if the controller can't rumble. */
  rumble(strength = 0.5, ms = 120) {
    if (this.index === null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this.index];
    const act = gp && gp.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect("dual-rumble", {
      duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.2),
    }).catch(() => {});
  }
}
