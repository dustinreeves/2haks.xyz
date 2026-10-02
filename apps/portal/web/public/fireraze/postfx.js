// Fire Raze engine: effects applied to the finished picture ("post-processing").
//
//   scene ─► render (HDR, 4× anti-aliasing) ─► bloom ─► tone map + sRGB ─► colour grade + vignette ─► screen
//
// Bloom: anything brighter than white (lamps, portal rims, glowing eyes) softly glows and spills.
// Grade: a slightly cool, clean Portal-2-style look, a touch of contrast, and darker corners.
import * as THREE from "../vendor/three-0.170.0.module.min.js";
import { EffectComposer } from "../vendor/three-addons/postprocessing/EffectComposer.js";
import { OutputPass } from "../vendor/three-addons/postprocessing/OutputPass.js";
import { RenderPass } from "../vendor/three-addons/postprocessing/RenderPass.js";
import { ShaderPass } from "../vendor/three-addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "../vendor/three-addons/postprocessing/UnrealBloomPass.js";

const GradeShader = {
  name: "FireRazeGrade",
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },   // 0 = off
    uContrast: { value: 1.06 },
    uSaturation: { value: 0.94 },
    uTint: { value: new THREE.Vector3(0.985, 1.0, 1.02) }, // a little cool
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(grey), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c *= uTint;
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, { bloom = 0.5, threshold = 0.92, radius = 0.55 } = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), bloom, radius, threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.enabled = true;
  }

  /** Call after the renderer's size or pixel ratio changes. */
  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setPixelRatio(1); // sizes below are already in real pixels
    this.composer.setSize(size.x, size.y);
  }

  set bloomEnabled(on) { this.bloom.enabled = on; }

  set vignette(amount) { this.grade.uniforms.uVignette.value = amount; }

  render(scene, camera, dt) {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render(scene, camera);
  }
}

/**
 * Dynamic resolution: every second, lower the pixel ratio a little if the game is slow,
 * raise it again when there's room. Calls onChange(newRatio) when it changes.
 */
export class DynamicResolution {
  constructor({ min = 0.6, max = Math.min(window.devicePixelRatio || 1, 1.5), target = 55, onChange }) {
    Object.assign(this, { min, max, target, onChange });
    this.ratio = max;
    this.frames = 0;
    this.time = 0;
    this.enabled = true;
  }

  tick(realDt) {
    this.frames++;
    this.time += realDt;
    if (this.time < 1) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (!this.enabled) return;
    let next = this.ratio;
    if (fps < this.target - 5) next = Math.max(this.min, this.ratio - 0.1);
    else if (fps > this.target + 3) next = Math.min(this.max, this.ratio + 0.05);
    if (Math.abs(next - this.ratio) > 1e-3) {
      this.ratio = next;
      this.onChange(next);
    }
  }
}
