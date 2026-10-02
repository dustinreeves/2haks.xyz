// Fire Raze engine: a pair of linked portals you can see through and walk through.
//
// Each portal has a local frame: x = right, y = up, z = normal (pointing out of the wall).
// Going in one portal = turning half way round (180° about "up") and coming out of the other.
import * as THREE from "../vendor/three-0.170.0.module.min.js";
import { AXES, insideBox } from "./collide.js";

const V3 = THREE.Vector3;
export const PORTAL_W = 1.2;
export const PORTAL_H = 2.0;
const ROT_Y_PI = new THREE.Matrix4().makeRotationY(Math.PI);

const vertexShader = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Inside: the view through the other portal (rendered to a texture), or a swirl when unlinked.
const fragmentShader = `
  uniform sampler2D tView;
  uniform vec2 uRes;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLive;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    // A living edge: the rim ripples and little sparks run around it.
    float wob = 0.03 * sin(a * 7.0 + uTime * 3.0) + 0.02 * sin(a * 13.0 - uTime * 5.0);
    if (r > 1.0 + wob * 0.5) discard;
    float rim = smoothstep(0.8 + wob, 0.97 + wob * 0.5, r);
    float spark = pow(max(0.0, sin(a * 11.0 + uTime * 6.0)), 24.0) + pow(max(0.0, sin(a * 17.0 - uTime * 4.0)), 24.0);
    rim += spark * smoothstep(0.75, 0.95, r) * 0.8;
    vec3 inside;
    if (uLive > 0.5) {
      inside = texture2D(tView, gl_FragCoord.xy / uRes).rgb;
    } else {
      float swirl = sin(a * 3.0 + r * 9.0 - uTime * 4.0) * 0.5 + 0.5;
      inside = mix(uColor * 0.2, uColor * 0.9, swirl * (1.0 - r * 0.4));
    }
    gl_FragColor = vec4(mix(inside, uColor * 1.6 + 0.25, clamp(rim, 0.0, 1.0)) + uColor * max(0.0, rim - 1.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class PortalSystem {
  constructor(scene, renderer, colors = { blue: 0x2f9bff, orange: 0xff8a1f }) {
    this.renderer = renderer;
    this.scene = scene;
    this.geometry = new THREE.PlaneGeometry(PORTAL_W, PORTAL_H);
    this.blue = this._make("blue", colors.blue);
    this.orange = this._make("orange", colors.orange);
    this.all = [this.blue, this.orange];
    this.onChange = () => {};
    this._virtual = new THREE.PerspectiveCamera();
    this._virtual.matrixAutoUpdate = false;
    this._virtual.matrixWorldAutoUpdate = false;
    this._frustum = new THREE.Frustum();
  }

  _make(name, color) {
    const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tView: { value: rt.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uLive: { value: 0 },
      },
      vertexShader,
      fragmentShader,
    });
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    const light = new THREE.PointLight(color, 4, 3.5);
    light.position.z = 0.5;
    mesh.add(light);
    this.scene.add(mesh);
    return {
      name, color, rt, mat, mesh, placed: false, fixed: false,
      pos: new V3(), normal: new V3(), up: new V3(), right: new V3(),
      matrix: new THREE.Matrix4(), inv: new THREE.Matrix4(), hosts: [],
    };
  }

  other(p) { return p === this.blue ? this.orange : this.blue; }

  get linked() { return this.blue.placed && this.orange.placed; }

  // Matrix that carries anything entering `from` out of `to`.
  through(from, to) {
    return new THREE.Matrix4().multiplyMatrices(to.matrix, ROT_Y_PI).multiply(from.inv);
  }

  /**
   * Work out where a portal fits on a box face that a shot hit.
   * Returns {pos, normal, up} or {error: "surface" | "nofit"}.
   */
  fit(box, hitPoint, normal, axisIndex, facing) {
    if (box.type !== "white" || box.door) return { error: "surface" };
    const a = AXES[axisIndex];
    let up;
    if (a === "y") {
      // Floor/ceiling portal: line it up with the way the shooter faces, snapped to the grid.
      const f = facing.clone().setY(0);
      up = Math.abs(f.x) > Math.abs(f.z) ? new V3(Math.sign(f.x), 0, 0) : new V3(0, 0, Math.sign(f.z) || -1);
      if (normal.y < 0) up.negate();
    } else {
      up = new V3(0, 1, 0);
    }
    const right = new V3().crossVectors(up, normal);
    const pos = hitPoint.clone();
    pos[a] = normal[a] > 0 ? box.max[a] : box.min[a];
    // Slide the portal so it sits completely on the face.
    for (const [vec, half] of [[right, PORTAL_W / 2], [up, PORTAL_H / 2]]) {
      const ax = AXES[[Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z)].indexOf(1)];
      const lo = box.min[ax] + half;
      const hi = box.max[ax] - half;
      if (lo > hi + 1e-6) return { error: "nofit" };
      pos[ax] = THREE.MathUtils.clamp(pos[ax], lo, hi);
    }
    // A wall portal whose bottom is near the floor snaps down onto it, so you can walk in.
    if (a !== "y" && pos.y - PORTAL_H / 2 - box.min.y < 1.2) pos.y = box.min.y + PORTAL_H / 2;
    return { pos, normal: normal.clone(), up };
  }

  /** Place portal `p`. Returns false if it would overlap a fixed portal. */
  place(p, pos, normal, up, solids, fixed = false) {
    const o = this.other(p);
    if (o.placed && o.normal.equals(normal)) {
      const right = new V3().crossVectors(up, normal);
      const d = new V3().subVectors(pos, o.pos);
      if (Math.abs(d.dot(right)) < PORTAL_W && Math.abs(d.dot(up)) < PORTAL_H) {
        if (o.fixed) return false;
        this.clear(o);
      }
    }
    p.pos.copy(pos);
    p.normal.copy(normal);
    p.up.copy(up);
    p.right.crossVectors(up, normal);
    p.matrix.makeBasis(p.right, p.up, p.normal).setPosition(pos);
    p.inv.copy(p.matrix).invert();
    p.mesh.matrix.copy(p.matrix).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.012));
    p.mesh.matrixWorldNeedsUpdate = true;
    p.mesh.visible = true;
    p.placed = true;
    p.fixed = fixed;
    // Every solid box just behind the portal gets a "hole" while something passes through.
    const a = pos.clone().addScaledVector(normal, -0.05);
    const b = pos.clone().addScaledVector(normal, -0.6);
    p.hosts = solids.filter((s) => insideBox(a, s, 0.02) || insideBox(b, s, 0.02));
    this.onChange();
    return true;
  }

  clear(p) {
    p.placed = false;
    p.fixed = false;
    p.mesh.visible = false;
    p.hosts = [];
    this.onChange();
  }

  /** Remove portals the player shot (not fixed ones). Returns true if any were removed. */
  clearUnfixed() {
    let any = false;
    for (const p of this.all) {
      if (p.placed && !p.fixed) {
        this.clear(p);
        any = true;
      }
    }
    return any;
  }

  clearAll() {
    for (const p of this.all) this.clear(p);
  }

  /** Boxes a body may pass through right now because it is lined up with a portal in them. */
  holes(center) {
    const ignore = new Set();
    if (!this.linked) return ignore;
    for (const p of this.all) {
      const local = center.clone().applyMatrix4(p.inv);
      const floorish = Math.abs(p.normal.y) > 0.5;
      const ry = floorish ? PORTAL_H / 2 - 0.15 : PORTAL_H / 2 - 0.65;
      if (Math.abs(local.x) < PORTAL_W / 2 - 0.15 && Math.abs(local.y) < ry && local.z < 1.2 && local.z > -1.5) {
        for (const s of p.hosts) ignore.add(s);
      }
    }
    return ignore;
  }

  /**
   * If `body` ({center, vel, prev}) crossed into a portal since last frame, move it out of the
   * other one, keeping its speed ("speedy thing goes in, speedy thing comes out").
   * Returns the rotation (Matrix3) used, so the caller can turn the camera too, or null.
   */
  teleport(body, half) {
    if (!this.linked) return null;
    for (const p of this.all) {
      const local = body.center.clone().applyMatrix4(p.inv);
      const before = body.prev[p.name];
      body.prev[p.name] = local.z;
      const inRect = Math.abs(local.x) < PORTAL_W / 2 && Math.abs(local.y) < PORTAL_H / 2;
      if (before === undefined || !(before > 0 && local.z <= 0 && inRect)) continue;

      const q = this.other(p);
      const m = this.through(p, q);
      const rot = new THREE.Matrix3().setFromMatrix4(m);
      body.center.applyMatrix4(m);
      body.vel.applyMatrix3(rot);
      // Pop fully out of the exit so the body doesn't get stuck in the wall around it.
      const need = Math.abs(q.normal.x) * half.x + Math.abs(q.normal.y) * half.y + Math.abs(q.normal.z) * half.z + 0.05;
      const out = new V3().subVectors(body.center, q.pos).dot(q.normal);
      if (out < need) body.center.addScaledVector(q.normal, need - out);
      const speedOut = body.vel.dot(q.normal);
      if (speedOut < 2) body.vel.addScaledVector(q.normal, 2 - speedOut);
      const fresh = {};
      for (const pp of this.all) fresh[pp.name] = body.center.clone().applyMatrix4(pp.inv).z;
      body.prev = fresh;
      return rot;
    }
    return null;
  }

  // The view inside a portal is drawn at `viewScale` of full size (you can't tell, and it's faster).
  // uRes stays the full size: the shader works out where it is on screen from that.
  resize(viewScale = 0.75) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    for (const p of this.all) {
      p.rt.setSize(Math.max(1, Math.round(size.x * viewScale)), Math.max(1, Math.round(size.y * viewScale)));
      p.mat.uniforms.uRes.value.copy(size);
    }
  }

  update(t) {
    for (const p of this.all) p.mat.uniforms.uTime.value = t;
  }

  /** Render what each visible portal looks through to. Call before the main render. */
  render(camera) {
    for (const p of this.all) p.mat.uniforms.uLive.value = 0;
    if (!this.linked) return;
    const pv = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(pv);
    const cam = this._virtual;
    for (const p of this.all) {
      p.mesh.updateMatrixWorld();
      if (!this._frustum.intersectsObject(p.mesh)) continue;
      const q = this.other(p);
      cam.matrixWorld.multiplyMatrices(this.through(p, q), camera.matrixWorld);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      cam.projectionMatrix.copy(camera.projectionMatrix);
      obliqueClip(cam, q.normal, q.pos);
      this.renderer.setRenderTarget(p.rt);
      this.renderer.render(this.scene, cam);
    }
    this.renderer.setRenderTarget(null);
    for (const p of this.all) p.mat.uniforms.uLive.value = 1;
  }
}

// Make the camera's near plane match the exit portal's wall, so nothing behind it shows up.
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
function obliqueClip(cam, normal, point) {
  _plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(cam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = cam.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
  _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
  _q.z = -1.0;
  _q.w = (1.0 + e[10]) / e[14];
  _clip.multiplyScalar(2.0 / _clip.dot(_q));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = _clip.z + 1.0;
  e[14] = _clip.w;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}
