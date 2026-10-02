// Fire Raze engine: realistic-looking light.
//  - Tone mapping (like a film camera) so bright lights glow instead of clipping to flat white.
//  - Image-based light: a small, bright "light box" scene is blurred into an environment map,
//    so every surface picks up soft bounce light and shiny things get reflections.
//  - Soft shadows from ceiling spot lights (added per room by the world).
import * as THREE from "../vendor/three-0.170.0.module.min.js";

export function setupLighting(renderer, scene, { exposure = 1.0, environment = 0.55 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = lightBoxScene();
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  scene.environmentIntensity = environment;
  env.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  pmrem.dispose();

  // A faint sky/ground fill so nothing is ever pitch black.
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3f44, 0.35));
}

// A grey room with glowing ceiling strips and a couple of wall panels: what the surfaces "see".
function lightBoxScene() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 10),
    new THREE.MeshBasicMaterial({ color: 0x6b7278, side: THREE.BackSide }),
  );
  room.position.y = 3;
  env.add(room);
  const glow = (w, h, d, x, y, z, strength) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    m.material.color.setScalar(strength);
    m.position.set(x, y, z);
    env.add(m);
  };
  for (const x of [-3, 0, 3]) glow(0.6, 0.1, 8, x, 5.9, 0, 9);
  glow(0.1, 3, 4, -4.9, 3, 0, 1.8);
  glow(0.1, 3, 4, 4.9, 3, 0, 1.8);
  glow(10, 0.1, 10, 0, 0.05, 0, 0.35); // floor bounce
  return env;
}

/**
 * Ceiling spot lights for a room. Only the first `shadowCount` cast shadows (shadows cost a
 * lot of speed, so we keep them few).
 */
export function ceilingLights(group, room, { spacing = 6, intensity = 90, shadowCount = 2 } = {}) {
  const lights = [];
  const fixture = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 3 });
  // Lots of lights slow the game down, so big rooms get them spread further apart (max 6).
  const along = (lo, hi, sp) => {
    const out = [];
    const n = Math.max(1, Math.round((hi - lo) / sp));
    for (let i = 0; i < n; i++) out.push(lo + ((i + 0.5) * (hi - lo)) / n);
    return out;
  };
  let sp = spacing;
  while (along(room.min.x, room.max.x, sp).length * along(room.min.z, room.max.z, sp).length > 6) sp += 1;
  const xs = along(room.min.x, room.max.x, sp);
  const zs = along(room.min.z, room.max.z, sp);
  const y = room.max.y - 0.12;
  for (const z of zs) {
    for (const x of xs) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.5), fixture);
      housing.position.set(x, room.max.y - 0.06, z);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.32), lamp);
      tube.position.set(x, y - 0.02, z);
      group.add(housing, tube);

      const spot = new THREE.SpotLight(0xf4f8ff, intensity, 0, 1.05, 0.7, 2);
      spot.position.set(x, y - 0.1, z);
      spot.target.position.set(x, room.min.y, z);
      if (lights.length < shadowCount) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.bias = -0.0004;
        spot.shadow.normalBias = 0.03;
        spot.shadow.camera.near = 0.3;
        spot.shadow.camera.far = room.max.y - room.min.y + 6;
      }
      group.add(spot, spot.target);
      lights.push(spot);
    }
  }
  return lights;
}
