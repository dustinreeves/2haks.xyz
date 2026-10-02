// Fire Raze engine: the player's body (our own "test subject" design, built from simple shapes).
//
// Layers decide which camera sees what:
//   LAYERS.WORLD     everything normal (every camera)
//   LAYERS.BODY      your own body: only portal views and shadows see it, never your own eyes
//   LAYERS.VIEWMODEL the gun in front of your eyes: only your own eyes see it
import * as THREE from "../vendor/three-0.170.0.module.min.js";

export const LAYERS = { WORLD: 0, BODY: 1, VIEWMODEL: 2 };

const MAT = {
  suit: new THREE.MeshStandardMaterial({ color: 0xe0702a, roughness: 0.75 }),
  top: new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.8 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc98d68, roughness: 0.6 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.7 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.4 }),
  spring: new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.3, metalness: 0.8 }),
  gunWhite: new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.35 }),
  gunDark: new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.5, metalness: 0.4 }),
};

function limb(radius, length, material) {
  // A cylinder that hangs DOWN from its pivot (the joint is at the top).
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 10), material);
  mesh.position.y = -length / 2;
  return mesh;
}

/**
 * Build the test subject. Feet are at y = 0, facing -z (the same way as the camera at yaw 0).
 * Returns { root, update(state) } where state = { speed, onGround, pitch, dt }.
 */
export function makeTestSubject({ gunColor = 0x2f9bff } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything above the hips, leans when aiming up/down
  body.position.y = 0.95;
  root.add(body);

  // Hips, with the jumpsuit's sleeves tied around the waist.
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.2), MAT.suit);
  hips.position.y = 0.95;
  root.add(hips);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.045, 8, 24), MAT.suit);
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.06;
  body.add(tie);
  for (const side of [-1, 1]) {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.22, 4, 8), MAT.suit);
    sleeve.position.set(side * 0.06, -0.08, -0.17);
    sleeve.rotation.z = side * 0.25;
    body.add(sleeve);
  }

  // Top and head.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.2), MAT.top);
  torso.position.y = 0.28;
  body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), MAT.skin);
  neck.position.y = 0.55;
  body.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.67;
  body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), MAT.skin));
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), MAT.hair);
  hair.rotation.x = 0.35;
  head.add(hair);
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 8), MAT.hair);
  tail.position.set(0, -0.04, 0.13);
  tail.rotation.x = 0.4;
  head.add(tail);

  // Legs: hip joint → knee joint → boot with a long-fall spring blade behind the heel.
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.9, 0);
    root.add(hip);
    hip.add(limb(0.075, 0.44, MAT.suit));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    knee.add(limb(0.065, 0.4, MAT.suit));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.26), MAT.boot);
    boot.position.set(0, -0.41, -0.04);
    knee.add(boot);
    const blade = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, -0.2, 0.06), new THREE.Vector3(0, -0.36, 0.2), new THREE.Vector3(0, -0.46, 0.08),
    ), 10, 0.012, 6), MAT.spring);
    knee.add(blade);
    return { hip, knee };
  });

  // Arms reach forward to hold the gun.
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.22, 0.47, 0);
    body.add(shoulder);
    shoulder.add(limb(0.045, 0.3, MAT.skin));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(limb(0.04, 0.28, MAT.skin));
    return { shoulder, elbow, side };
  });

  // A small portal gun in the hands.
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 6, 12), MAT.gunWhite);
  gunBody.rotation.x = Math.PI / 2;
  const front = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 12), MAT.gunDark);
  front.rotation.x = Math.PI / 2;
  front.position.z = -0.22;
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(gunColor).multiplyScalar(1.5) });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), glowMat);
  core.rotation.x = Math.PI / 2;
  core.position.y = 0.075;
  gun.add(gunBody, front, core);
  gun.position.set(0.1, 0.3, -0.32);
  body.add(gun);

  root.traverse((o) => {
    o.layers.set(LAYERS.BODY);
    if (o.isMesh) o.castShadow = true;
  });

  let phase = 0;
  let swing = 0;

  /** Pose the body for this frame. */
  function update({ speed, onGround, pitch, dt }) {
    const walking = onGround ? Math.min(1, speed / 4.5) : 0;
    phase += dt * (4 + speed * 1.6) * (walking > 0.05 ? 1 : 0);
    swing += ((onGround ? walking : 0) - swing) * Math.min(1, dt * 10);
    legs.forEach(({ hip, knee }, i) => {
      const s = Math.sin(phase + i * Math.PI);
      hip.rotation.x = onGround ? s * 0.6 * swing : (i ? -0.5 : 0.3); // tuck legs in the air
      // Knees only bend backwards (negative x rotation swings the shin back).
      knee.rotation.x = onGround ? -Math.max(0, -Math.cos(phase + i * Math.PI)) * 0.8 * swing : -0.7;
    });
    // Lean the upper body to aim where you look.
    body.rotation.x = THREE.MathUtils.clamp(pitch, -1, 1) * 0.35;
    head.rotation.x = THREE.MathUtils.clamp(pitch, -1, 1) * 0.5;
    for (const { shoulder, elbow, side } of arms) {
      // Positive x rotation swings a hanging arm forwards (towards -z).
      shoulder.rotation.x = 1.15 + Math.sin(phase) * 0.05 * swing;
      shoulder.rotation.z = side * -0.35;
      elbow.rotation.x = 0.6;
    }
  }

  function setGunColor(color) {
    glowMat.color.setHex(color).multiplyScalar(1.5);
  }

  return { root, update, setGunColor };
}
