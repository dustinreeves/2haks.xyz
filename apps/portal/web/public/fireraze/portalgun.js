// Fire Raze engine: the portal gun model (our own build from simple shapes, modelled by eye from
// reference pictures; no copied model or textures). Units are metres, forward is -z.
//
//   back shell   big white egg-shaped dome with panel seams and a round indicator light on top
//   chin         white scoop under the front, cut flat along the top
//   barrel       black tube with a six-sided nut, two thick rings and a slotted collar at the muzzle,
//                and a glass tube with a glowing core inside
//   claws        three long, thin black claws (elbow joint, flat paddle tips) on a hub ring,
//                with cables looping back to the shell
import * as THREE from "../vendor/three-0.170.0.module.min.js";

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

/**
 * Build the gun. Returns { group, muzzle, light, setColor(hex) }.
 * `muzzle` is where portal shots start; every glowing part takes the colour from setColor.
 */
export function makePortalGun({ color = 0x2f9bff } = {}) {
  const group = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xbfc3c6, roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5, side: THREE.DoubleSide,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.55, metalness: 0.45 });
  const darkGrey = new THREE.MeshStandardMaterial({ color: 0x2c3135, roughness: 0.45, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x7c848b, roughness: 0.3, metalness: 0.85 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.08, transparent: true, opacity: 0.45, metalness: 0.1 });
  const glowMats = [];
  const glow = (strength = 1.25) => { // strength above 1 = glows (bloom)
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData.strength = strength;
    glowMats.push(m);
    return m;
  };

  // Lathe/cylinder helpers. A lathe spins a side profile [radius, z] around the gun's long axis.
  const alongZ = (mesh) => { mesh.rotation.x = Math.PI / 2; return mesh; };
  const lathe = (profile, mat, segs = 48, phiStart = 0, phiLength = Math.PI * 2) => alongZ(new THREE.Mesh(
    new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segs, phiStart, phiLength), mat,
  ));
  const tubeZ = (r, z0, z1, mat, segs = 32, open = false) => {
    const m = alongZ(new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), segs, 1, open), mat));
    m.position.z = (z0 + z1) / 2;
    return m;
  };
  // A thin rod between two points.
  const rod = (a, b, r, mat) => {
    const dir = new V3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 10), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
  };

  // ---------- back shell ----------
  // Profile from the rounded back (z = +0.225) to the open front edge (z = -0.075): big and egg-shaped,
  // reaching forward around the barrel like the reference pictures.
  const shellProfile = [[0.0, 0.225], [0.05, 0.218], [0.083, 0.196], [0.105, 0.16], [0.118, 0.11],
    [0.122, 0.06], [0.12, 0.01], [0.114, -0.04], [0.106, -0.075]];
  const shellR = (z) => { // shell radius at a given z (for placing seams and the light)
    for (let i = 1; i < shellProfile.length; i++) {
      const [r0, z0] = shellProfile[i - 1];
      const [r1, z1] = shellProfile[i];
      if (z <= z0 && z >= z1) return r0 + ((z0 - z) / (z0 - z1)) * (r1 - r0);
    }
    return 0.1;
  };
  group.add(lathe(shellProfile, white, 56));
  // Dark insides seen through the open front.
  group.add(tubeZ(0.098, 0.14, -0.08, black, 32));

  // Panel seams: one along the top, one along each side, and one ring around the middle.
  for (const angle of [Math.PI / 2, 0.15, Math.PI - 0.15]) {
    const pts = [];
    for (let z = 0.2; z >= -0.07; z -= 0.02) {
      const r = shellR(z) + 0.0015;
      pts.push(new V3(Math.cos(angle) * r, Math.sin(angle) * r, z));
    }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0018, 4), seam));
  }
  const ringSeam = new THREE.Mesh(new THREE.TorusGeometry(shellR(0.1) + 0.001, 0.0018, 4, 64), seam);
  ringSeam.position.z = 0.1;
  group.add(ringSeam);

  // Round indicator light on top of the shell.
  const lightZ = 0.06;
  const topY = shellR(lightZ);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 10, 28), darkGrey);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, topY + 0.002, lightZ);
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.019, 24), glow(0.8)); // softer: it's right under your eye
  lamp.rotation.x = -Math.PI / 2;
  lamp.position.set(0, topY + 0.004, lightZ);
  group.add(bezel, lamp);

  // ---------- chin: white scoop under the front, open on top ----------
  const chin = lathe([[0.112, -0.06], [0.116, -0.1], [0.11, -0.15], [0.098, -0.19], [0.09, -0.2]],
    white, 40, -Math.PI * 0.42, Math.PI * 0.84); // lower part only, cut flat along the top
  group.add(chin);

  // ---------- barrel ----------
  group.add(tubeZ(0.068, -0.05, -0.23, black, 32));
  // Six-sided nut (hub for the claws).
  const nut = tubeZ(0.088, -0.16, -0.2, darkGrey, 6);
  nut.rotation.y = Math.PI / 6;
  group.add(nut);
  // Two thick rings at the muzzle.
  for (const z of [-0.225, -0.26]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.02, 12, 36), black);
    ring.position.z = z;
    group.add(ring);
  }
  // Slotted outer collar: a thin shell with dark slots around it.
  group.add(tubeZ(0.084, -0.2, -0.24, darkGrey, 36, true));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.026), black);
    slot.position.set(Math.cos(a) * 0.086, Math.sin(a) * 0.086, -0.22);
    slot.rotation.z = a + Math.PI / 2;
    group.add(slot);
  }
  // Glass tube in the muzzle with the glowing core inside.
  group.add(tubeZ(0.045, -0.1, -0.27, glass, 24));
  group.add(tubeZ(0.014, -0.1, -0.265, glow(), 12));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), glow());
  lens.position.z = -0.271;
  lens.rotation.y = Math.PI;
  group.add(lens);

  // ---------- three claws ----------
  // Built "pointing up" in their own group, then turned to their place around the barrel.
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3]) {
    const claw = new THREE.Group();
    claw.rotation.z = a - Math.PI / 2;
    // Big and spidery: out to an elbow, then far forward past the muzzle.
    const base = new V3(0, 0.09, -0.18);
    const elbow = new V3(0, 0.24, -0.25);
    const tip = new V3(0, 0.2, -0.43);
    claw.add(rod(base, elbow, 0.009, black));
    claw.add(rod(elbow, tip, 0.0075, black));
    // A second, thinner strut makes it look built, not just a stick.
    claw.add(rod(new V3(0, 0.095, -0.16), new V3(0, 0.23, -0.235), 0.0035, steel));
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), steel);
    knuckle.position.copy(elbow);
    claw.add(knuckle);
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0025, 6, 14), steel);
    spring.position.copy(base).lerp(elbow, 0.45);
    spring.rotation.y = Math.PI / 2;
    claw.add(spring);
    // Flat paddle tip, angled in a little.
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.075, 0.04), black);
    paddle.position.copy(tip).add(new V3(0, 0.02, -0.006));
    paddle.rotation.x = -0.35;
    claw.add(paddle);
    // Cable looping from the shell to the claw's elbow.
    const cable = new THREE.CatmullRomCurve3([
      new V3(0, shellR(0.02) - 0.004, 0.02), new V3(0, 0.19, -0.05), new V3(0, 0.26, -0.15), elbow.clone().add(new V3(0, 0.005, 0.01)),
    ]);
    claw.add(new THREE.Mesh(new THREE.TubeGeometry(cable, 24, 0.0045, 6), black));
    group.add(claw);
  }

  // ---------- muzzle point and light ----------
  const muzzle = new THREE.Object3D();
  muzzle.position.z = -0.29;
  group.add(muzzle);
  const light = new THREE.PointLight(color, 0.15, 0.7); // faint: it sits right next to the shell
  light.position.z = -0.32;
  group.add(light);

  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  function setColor(hex) {
    for (const m of glowMats) m.color.setHex(hex).multiplyScalar(m.userData.strength);
    light.color.setHex(hex);
  }
  setColor(color);
  return { group, muzzle, light, setColor };
}
