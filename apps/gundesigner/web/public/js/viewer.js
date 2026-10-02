// The 3D stage: lighting, drag to turn, wheel/pinch to zoom, auto-spin,
// exploded view, test fire (recoil + sparks or confetti) and PNG photos.
import * as THREE from "../vendor/three-0.170.0.module.min.js";
import { fitBox } from "./model.js";

const CONFETTI = ["#ff4f9a", "#ffd23f", "#12b5a6", "#7b5cff", "#ff8a1f", "#ffffff"];
const MAX_PARTICLES = 240;

// A tiny "photo studio" for reflections, so metal and chrome have something to show.
function studioEnvironment(renderer) {
  const room = new THREE.Scene();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(20, 12, 20),
    new THREE.MeshBasicMaterial({ color: "#3b3f4a", side: THREE.BackSide }),
  );
  room.add(walls);
  const panel = (w, h, pos, intensity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity) }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  panel(10, 3, [0, 5.9, 0], 6);
  panel(4, 8, [-9.9, 1, 3], 3);
  panel(4, 8, [9.9, 1, -3], 2);
  panel(8, 4, [0, 1, 9.9], 1.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  return env;
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.environment = studioEnvironment(this.renderer);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);

    this.scene.add(new THREE.HemisphereLight("#dfe8ff", "#2a2230", 0.6));
    this.key = new THREE.DirectionalLight("#ffffff", 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight("#9fc4ff", 1.2);
    rim.position.set(-30, 20, -40);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // pivot (turned by the user) > recoil (kicks when firing) > gun
    this.pivot = new THREE.Group();
    this.recoil = new THREE.Group();
    this.pivot.add(this.recoil);
    this.scene.add(this.pivot);
    this.pivot.rotation.set(0.12, -0.55, 0);

    this.gun = null;
    this.radius = 20;
    this.shownRadius = 20;
    this.zoom = 1;
    this.spin = true;
    this.explode = 0;
    this.explodeTarget = 0;
    this.kick = 0;
    this.pops = [];
    this.lastTouch = performance.now();
    this.clock = new THREE.Clock();
    this.particles = this.makeParticles();

    this.bindControls();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  makeParticles() {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.4, 1, 0.1),
      new THREE.MeshStandardMaterial({ roughness: 0.5, emissiveIntensity: 0.4 }),
      MAX_PARTICLES,
    );
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.pivot.add(mesh);
    return { mesh, list: [] };
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bindControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let pinch = 0;
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastTouch = performance.now();
    });
    el.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      this.lastTouch = performance.now();
      if (pointers.size === 1) {
        this.pivot.rotation.y += (e.clientX - prev.x) * 0.01;
        this.pivot.rotation.x = Math.max(-0.5, Math.min(0.8, this.pivot.rotation.x + (e.clientY - prev.y) * 0.006));
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.setZoom(this.zoom * (pinch / d));
        pinch = d;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(e.deltaY * 0.001));
      this.lastTouch = performance.now();
    }, { passive: false });
  }

  setZoom(z) {
    this.zoom = Math.max(0.35, Math.min(2.5, z));
  }

  show(built, changedSlot) {
    if (this.gun) {
      this.recoil.remove(this.gun);
      this.gun.traverse((o) => o.isMesh && o.material.dispose());
    }
    this.gun = built.root;
    this.slots = built.slots;
    this.firePoint = built.firePoint;
    const box = fitBox(this.gun); // measure before it joins the turned pivot
    this.recoil.add(this.gun);

    const center = box.getCenter(new THREE.Vector3());
    this.gun.position.copy(center).multiplyScalar(-1); // turn around the middle of the gun
    this.radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    if (!this.framed) this.shownRadius = this.radius; // first gun: no zoom-in from nothing
    this.framed = true;
    this.groundY = box.min.y - center.y;
    this.applyExplode();
    if (changedSlot && this.slots[changedSlot]) this.pops.push({ group: this.slots[changedSlot], t: 0 });
  }

  applyExplode() {
    for (const g of Object.values(this.slots || {})) {
      g.position.copy(g.userData.home).addScaledVector(g.userData.explode, this.explode);
    }
  }

  setExplode(on) {
    this.explodeTarget = on ? 1 : 0;
  }

  fire(confetti) {
    if (!this.gun) return;
    this.kick = 1;
    const origin = this.firePoint.clone().add(this.gun.position);
    for (const slot of ["barrel", "muzzle"]) {
      if (this.slots[slot]) origin.x += this.slots[slot].userData.explode.x * this.explode;
    }
    const count = confetti ? 70 : 26;
    for (let i = 0; i < count && this.particles.list.length < MAX_PARTICLES; i++) {
      const spread = confetti ? 1 : 0.35;
      this.particles.list.push({
        pos: origin.clone(),
        vel: new THREE.Vector3(
          18 + Math.random() * (confetti ? 25 : 45),
          (Math.random() - 0.3) * 20 * spread,
          (Math.random() - 0.5) * 20 * spread,
        ),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        rot: new THREE.Euler(),
        color: new THREE.Color(confetti ? CONFETTI[i % CONFETTI.length] : (Math.random() < 0.5 ? "#ffd27a" : "#ff9a3c")),
        life: confetti ? 2.2 : 0.35 + Math.random() * 0.25,
        gravity: confetti ? 18 : 0,
        drag: confetti ? 2.4 : 6,
      });
    }
  }

  photo() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this.spin && performance.now() - this.lastTouch > 2500) this.pivot.rotation.y += dt * 0.35;

    // Ease the camera to frame the gun.
    const wanted = this.radius * (1 + 0.25 * this.explode); // room for the parts to fly apart
    this.shownRadius += (wanted - this.shownRadius) * Math.min(1, dt * 6);
    // Fit the gun's length across the view, as long as its height still fits.
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    // (sin, not tan, plus a margin: when the gun turns, the near end gets bigger.)
    const dist = Math.max(this.shownRadius / Math.sin(hHalf) * 1.02, (this.shownRadius * 0.62) / Math.sin(vHalf)) * this.zoom;
    this.camera.position.set(0, this.shownRadius * 0.15, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = dist / 50;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();

    // Ground sits under the gun; shadows sized to the gun.
    const r = this.shownRadius;
    this.ground.position.y = (this.groundY ?? -r) - 1;
    this.key.position.set(r * 0.8, r * 3, r * 1.6);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -r * 1.8;
    cam.right = cam.top = r * 1.8;
    cam.near = 1;
    cam.far = r * 8;
    cam.updateProjectionMatrix();

    // Exploded view.
    if (Math.abs(this.explode - this.explodeTarget) > 0.001) {
      this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 7);
      this.applyExplode();
    }

    // Recoil kick.
    this.kick = Math.max(0, this.kick - dt * 5);
    const k = this.kick * this.kick;
    this.recoil.position.x = -k * r * 0.12;
    this.recoil.rotation.z = k * 0.18;

    // A new part pops in.
    this.pops = this.pops.filter((p) => {
      p.t += dt * 4;
      const s = p.t < 1 ? 1 + Math.sin(p.t * Math.PI) * 0.18 : 1;
      p.group.scale.setScalar(s);
      return p.t < 1;
    });

    // Googly eyes wobble, glowing bits pulse.
    this.gun?.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.anim === "wobble") {
        o.position.copy(o.userData.home);
        o.position.x += Math.sin(t * 6 + o.id) * 0.18;
        o.position.y += Math.cos(t * 4.3 + o.id) * 0.18;
      } else if (o.userData.anim === "spin") {
        o.rotation.x += dt * 3;
      }
      if (o.material.userData.glow) o.material.emissiveIntensity = 1.3 + Math.sin(t * 3) * 0.4;
    });

    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateParticles(dt) {
    const p = this.particles;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    p.list = p.list.filter((s) => (s.life -= dt) > 0);
    p.list.forEach((s, i) => {
      s.vel.multiplyScalar(Math.exp(-s.drag * dt));
      s.vel.y -= s.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.rot.x += s.spin.x * dt;
      s.rot.y += s.spin.y * dt;
      s.rot.z += s.spin.z * dt;
      m.compose(s.pos, q.setFromEuler(s.rot), one);
      p.mesh.setMatrixAt(i, m);
      p.mesh.setColorAt(i, s.color);
    });
    p.mesh.count = p.list.length;
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }
}
