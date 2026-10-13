// Procedural weapon models. Every gun points down -Z with the grip near the origin,
// in real-world metres, so the same model serves the first-person view and the
// soldiers' hands. userData carries the muzzle, ejection port, magazine and sight height.
import * as THREE from 'three';

let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    steel: new THREE.MeshStandardMaterial({ color: '#2a2c2e', roughness: 0.38, metalness: 0.85 }),
    blued: new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.3, metalness: 0.9 }),
    poly: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.7, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: '#7a3e1d', roughness: 0.5, metalness: 0.05 }),
    darkwood: new THREE.MeshStandardMaterial({ color: '#4a2a14', roughness: 0.6, metalness: 0.05 }),
    olive: new THREE.MeshStandardMaterial({ color: '#4c5233', roughness: 0.65, metalness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b5872c', roughness: 0.3, metalness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0a1a22', roughness: 0.05, metalness: 0.9, emissive: '#0a2a30', emissiveIntensity: 0.3 }),
    blade: new THREE.MeshStandardMaterial({ color: '#b9bec2', roughness: 0.25, metalness: 0.95 }),
    rocket: new THREE.MeshStandardMaterial({ color: '#4d5a2f', roughness: 0.6, metalness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d9a932', roughness: 0.22, metalness: 1, emissive: '#3a2a00', emissiveIntensity: 0.25 }),
    goldDark: new THREE.MeshStandardMaterial({ color: '#8a6416', roughness: 0.3, metalness: 1 }),
    bone: new THREE.MeshStandardMaterial({ color: '#e2d6b8', roughness: 0.6 }),
    bead: new THREE.MeshStandardMaterial({ color: '#c0281c', roughness: 0.35, metalness: 0.2 })
  };
  return mats;
}

function box(g, mat, w, h, d, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}
function cyl(g, mat, r0, r1, len, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Shared rifle builder.
function rifle(o) {
  const M = materials();
  const g = new THREE.Group();
  const furn = M[o.furniture || 'wood'];
  const rec = o.rec || 0.36;
  box(g, M.steel, 0.052, 0.085, rec, 0, 0.01, -rec / 2 + 0.12);
  box(g, M.steel, 0.04, 0.02, rec * 0.7, 0, 0.06, -rec / 2 + 0.14); // top cover
  // Grip and trigger guard.
  box(g, furn === M.wood ? M.darkwood : M.poly, 0.036, 0.11, 0.045, 0, -0.08, 0.1, -0.32);
  box(g, M.steel, 0.01, 0.035, 0.07, 0, -0.045, 0.04);
  // Stock.
  if (o.stock === 'wood' || o.stock === 'poly') box(g, furn, 0.045, 0.075, 0.3, 0, -0.02, 0.38, 0.08);
  if (o.stock === 'fold') {
    box(g, M.steel, 0.01, 0.02, 0.26, 0.018, -0.01, 0.36);
    box(g, M.steel, 0.01, 0.02, 0.26, -0.018, -0.01, 0.36);
    box(g, M.steel, 0.04, 0.07, 0.015, 0, -0.03, 0.49);
  }
  // Handguard and barrel.
  const hg = o.handguard || 0.2;
  const front = -rec + 0.12;
  box(g, furn, 0.058, 0.065, hg, 0, 0, front - hg / 2);
  const bl = o.barrel || 0.3;
  cyl(g, M.blued, 0.011, 0.012, bl, 0, 0.012, front - bl / 2 - 0.02);
  if (o.gasTube !== false) cyl(g, M.steel, 0.012, 0.012, hg * 0.9, 0, 0.045, front - hg / 2);
  const tip = front - bl - 0.02;
  cyl(g, M.steel, 0.017, 0.017, 0.05, 0, 0.012, tip + 0.025, 8); // muzzle device
  box(g, M.steel, 0.008, 0.045, 0.012, 0, 0.05, tip + 0.06); // front sight
  for (const sx of [-0.009, 0.009]) box(g, M.steel, 0.008, 0.024, 0.02, sx, 0.064, -0.02); // rear sight notch
  // Magazine.
  let mag = null;
  if (o.mag === 'curve') {
    mag = new THREE.Group();
    box(mag, M.steel, 0.032, 0.12, 0.07, 0, -0.06, 0);
    box(mag, M.steel, 0.032, 0.11, 0.07, 0, -0.16, -0.035, 0.45);
    mag.position.set(0, -0.03, front + 0.12);
    g.add(mag);
  } else if (o.mag === 'straight') {
    mag = new THREE.Group();
    box(mag, M.steel, 0.03, o.magLen || 0.2, 0.05, 0, -(o.magLen || 0.2) / 2, 0, 0.15);
    mag.position.set(0, -0.03, front + 0.1);
    g.add(mag);
  } else if (o.mag === 'box') {
    mag = new THREE.Group();
    box(mag, M.olive, 0.09, 0.11, 0.12, -0.02, -0.06, 0);
    mag.position.set(0, -0.03, front + 0.14);
    g.add(mag);
    // Belt into the feed tray.
    for (let i = 0; i < 6; i++) box(g, M.brass, 0.012, 0.012, 0.04, -0.03 - i * 0.012, 0.03 - i * 0.008, front + 0.14);
  }
  if (o.scope) {
    cyl(g, M.blued, 0.02, 0.02, 0.26, 0, 0.11, -0.05, 14);
    cyl(g, M.blued, 0.026, 0.02, 0.05, 0, 0.11, -0.2, 14);
    cyl(g, M.blued, 0.024, 0.02, 0.04, 0, 0.11, 0.1, 14);
    box(g, M.steel, 0.02, 0.04, 0.02, 0, 0.08, -0.12);
    box(g, M.steel, 0.02, 0.04, 0.02, 0, 0.08, 0.02);
    const lens = cyl(g, M.glass, 0.022, 0.022, 0.005, 0, 0.11, -0.227, 14);
    lens.renderOrder = 1;
  }
  if (o.bipod) {
    for (const s of [-1, 1]) {
      const leg = box(g, M.steel, 0.012, 0.22, 0.012, s * 0.03, -0.09, tip + 0.12);
      leg.rotation.z = s * 0.25;
    }
  }
  if (o.carry) box(g, M.steel, 0.02, 0.05, 0.12, 0, 0.085, -0.08);
  g.userData = { muzzle: new THREE.Vector3(0, 0.012, tip - 0.01), eject: new THREE.Vector3(0.03, 0.03, -0.05), mag, sightY: o.scope ? 0.11 : 0.0735, scope: !!o.scope };
  return g;
}

function pistol(big) {
  const M = materials();
  const g = new THREE.Group();
  const s = big ? 1.22 : 1;
  const L = 0.19 * s;
  // Slide with cocking serrations, frame, dust-cover rail, trigger guard and grip.
  box(g, big ? M.steel : M.blued, 0.03 * s, 0.032 * s, L, 0, 0.036 * s, -L / 2 + 0.03);
  for (let i = 0; i < 6; i++) box(g, M.poly, 0.031 * s, 0.022 * s, 0.003, 0, 0.038 * s, 0.015 - i * 0.007);
  box(g, M.poly, 0.027 * s, 0.022 * s, L * 0.82, 0, 0.01 * s, -L * 0.36 + 0.03);
  box(g, M.poly, 0.024 * s, 0.012 * s, L * 0.3, 0, -0.004 * s, -L * 0.62 + 0.03);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.017 * s, 0.003 * s, 4, 12, Math.PI), M.poly);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.004 * s, -0.012);
  g.add(guard);
  box(g, M.steel, 0.004, 0.016 * s, 0.004, 0, -0.008 * s, -0.012);
  const grip = box(g, M.poly, 0.029 * s, 0.1 * s, 0.042 * s, 0, -0.045 * s, 0.022, -0.22);
  grip.scale.z = 1.05;
  cyl(g, M.steel, 0.0065 * s, 0.0065 * s, 0.012, 0, 0.038 * s, -L + 0.026, 8);
  box(g, M.steel, 0.005, 0.009 * s, 0.006, 0, 0.056 * s, -L + 0.04);
  box(g, M.steel, 0.022 * s, 0.008 * s, 0.006, 0, 0.056 * s, 0.022);
  const mag = new THREE.Group();
  box(mag, M.steel, 0.024 * s, 0.022, 0.036 * s, 0, -0.1 * s, 0);
  mag.position.set(0, 0, 0.03);
  g.add(mag);
  g.userData = { muzzle: new THREE.Vector3(0, 0.038 * s, -L + 0.02), eject: new THREE.Vector3(0.02, 0.05, -0.03), mag, sightY: 0.06 * s, scope: false };
  return g;
}

function machete() {
  const M = materials();
  const g = new THREE.Group();
  box(g, M.darkwood, 0.03, 0.035, 0.13, 0, 0, 0.04);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.055, 0.46), M.blade);
  blade.position.set(0, 0.008, -0.27);
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, 0.08), M.blade);
  tip.position.set(0, 0.02, -0.5);
  tip.rotation.x = 0.3;
  g.add(tip);
  g.userData = { muzzle: new THREE.Vector3(0, 0, -0.5), eject: null, mag: null, sightY: 0.05, scope: false };
  return g;
}

function rpg() {
  const M = materials();
  const g = new THREE.Group();
  cyl(g, M.olive, 0.028, 0.028, 0.95, 0, 0.02, -0.2, 14);
  cyl(g, M.wood, 0.036, 0.036, 0.26, 0, 0.02, -0.08, 14); // heat guard
  cyl(g, M.steel, 0.045, 0.03, 0.14, 0, 0.02, 0.32, 14); // venturi flare
  box(g, M.poly, 0.03, 0.1, 0.045, 0, -0.06, 0.02, -0.25);
  box(g, M.poly, 0.03, 0.1, 0.045, 0, -0.06, -0.18, -0.15);
  box(g, M.steel, 0.025, 0.06, 0.05, 0.045, 0.07, -0.12); // optic
  // Warhead.
  const head = new THREE.Group();
  cyl(head, M.rocket, 0.045, 0.045, 0.16, 0, 0, 0, 14);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 14), M.rocket);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.18;
  head.add(cone);
  head.position.set(0, 0.02, -0.75);
  g.add(head);
  g.userData = { muzzle: new THREE.Vector3(0, 0.02, -0.95), eject: null, mag: head, sightY: 0.07, scope: false, rocket: head };
  return g;
}

function danegun() {
  // Long single-shot locally made hunting gun.
  const M = materials();
  const g = new THREE.Group();
  box(g, M.wood, 0.045, 0.06, 0.62, 0, -0.005, -0.12);
  box(g, M.wood, 0.05, 0.08, 0.28, 0, -0.03, 0.34, 0.12);
  cyl(g, M.steel, 0.012, 0.014, 0.9, 0, 0.035, -0.55, 8);
  box(g, M.steel, 0.02, 0.03, 0.06, 0.02, 0.04, 0.05); // hammer lock
  for (const z of [-0.3, -0.6]) cyl(g, M.brass, 0.018, 0.018, 0.015, 0, 0.03, z, 8);
  g.userData = { muzzle: new THREE.Vector3(0, 0.035, -1.0), eject: null, mag: null, sightY: 0.05, scope: false };
  return g;
}

// ---------- relics dug out of graves and tombs ----------
// Golden AK: an AK dipped in gold, with darker gold furniture.
function goldak() {
  const M = materials();
  const g = rifle({ furniture: 'wood', stock: 'wood', mag: 'curve', rec: 0.36, barrel: 0.32 });
  g.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === M.steel || o.material === M.blued) o.material = M.gold;
    else if (o.material === M.wood || o.material === M.darkwood) o.material = M.goldDark;
  });
  return g;
}

// Thunder .50: long, heavy anti-materiel rifle with a big scope, muzzle brake and bipod.
function barrett() {
  const M = materials();
  const g = rifle({ furniture: 'poly', stock: 'poly', mag: 'box', rec: 0.5, barrel: 0.72, handguard: 0.32, scope: true, bipod: true });
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.12), M.steel);
  brake.position.copy(g.userData.muzzle).add(new THREE.Vector3(0, 0, 0.04));
  g.add(brake);
  g.userData.muzzle.z -= 0.08;
  g.scale.setScalar(1.08);
  g.userData.muzzle.multiplyScalar(1.08);
  return g;
}

// Drum Launcher: six-shot revolving grenade launcher.
function drumLauncher() {
  const M = materials();
  const g = new THREE.Group();
  cyl(g, M.olive, 0.05, 0.05, 0.38, 0, 0.03, -0.42, 14); // barrel
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.2, 12), M.steel);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, 0.0, -0.12);
  g.add(drum);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    cyl(g, M.blued, 0.022, 0.022, 0.205, Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.12, 8);
  }
  box(g, M.poly, 0.036, 0.11, 0.045, 0, -0.09, 0.05, -0.3); // grip
  box(g, M.poly, 0.03, 0.09, 0.04, 0, -0.07, -0.33, -0.2); // fore grip
  box(g, M.olive, 0.05, 0.06, 0.26, 0, 0.0, 0.2); // stock
  box(g, M.steel, 0.025, 0.05, 0.06, 0, 0.09, -0.2); // sight
  g.userData = { muzzle: new THREE.Vector3(0, 0.03, -0.62), eject: null, mag: drum, sightY: 0.1, scope: false };
  return g;
}

// Ancestor's Dane Gun: the old hunting gun, wrapped in beads and bone, brass bands.
function ancestral() {
  const M = materials();
  const g = danegun();
  for (const z of [-0.2, -0.42, -0.7]) cyl(g, M.brass, 0.02, 0.02, 0.03, 0, 0.035, z, 10);
  for (let k = 0; k < 9; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), k % 3 === 0 ? M.bone : M.bead);
    b.position.set(0.028, -0.03 + Math.sin(k) * 0.01, -0.05 - k * 0.025);
    g.add(b);
  }
  const charm = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6), M.bone);
  charm.position.set(0.03, -0.07, -0.1);
  g.add(charm);
  return g;
}

// Two guns, one per hand (dual wield). The right gun keeps the usual muzzle; the left one's
// muzzle is muzzle2. Children: [right, left].
function dual(make, spread) {
  const g = new THREE.Group();
  const right = make();
  const left = make();
  right.position.x = spread;
  left.position.x = -spread;
  left.rotation.z = 0.06;
  right.rotation.z = -0.06;
  g.add(right, left);
  const u = right.userData;
  g.userData = {
    dual: true,
    right,
    left,
    muzzle: u.muzzle.clone().add(right.position),
    muzzle2: left.userData.muzzle.clone().add(left.position),
    eject: u.eject ? u.eject.clone().add(right.position) : null,
    mag: u.mag,
    sightY: u.sightY,
    scope: false
  };
  return g;
}

export function buildGun(id) {
  switch (id) {
    case 'dualp9':
      return dual(() => pistol(false), 0.16);
    case 'dualmp5':
      return dual(() => rifle({ furniture: 'poly', stock: 'fold', mag: 'curve', rec: 0.28, barrel: 0.12, handguard: 0.14, gasTube: false }), 0.2);
    case 'ak47':
      return rifle({ furniture: 'wood', stock: 'wood', mag: 'curve', rec: 0.36, barrel: 0.32 });
    case 'g3':
      return rifle({ furniture: 'poly', stock: 'poly', mag: 'straight', magLen: 0.17, rec: 0.38, barrel: 0.36, handguard: 0.24 });
    case 'mp5':
      return rifle({ furniture: 'poly', stock: 'fold', mag: 'curve', rec: 0.28, barrel: 0.12, handguard: 0.14, gasTube: false });
    case 'pkm':
      return rifle({ furniture: 'darkwood', stock: 'wood', mag: 'box', rec: 0.42, barrel: 0.5, handguard: 0.12, bipod: true, carry: true });
    case 'svd':
      return rifle({ furniture: 'wood', stock: 'wood', mag: 'straight', magLen: 0.12, rec: 0.38, barrel: 0.55, handguard: 0.26, scope: true });
    case 'rpg':
      return rpg();
    case 'goldak':
      return goldak();
    case 'barrett':
      return barrett();
    case 'gl':
      return drumLauncher();
    case 'ancestral':
      return ancestral();
    case 'danegun':
      return danegun();
    case 'hawk':
      return pistol(true);
    case 'p9':
      return pistol(false);
    case 'knife':
    default:
      return machete();
  }
}

// One cache of third-person guns per weapon id (cloned per soldier).
const tpCache = new Map();
export function thirdPersonGun(id) {
  if (id === 'dualp9') id = 'p9';
  if (id === 'dualmp5') id = 'mp5';
  if (!tpCache.has(id)) tpCache.set(id, buildGun(id));
  const src = tpCache.get(id);
  const c = src.clone(true);
  c.userData = { ...src.userData, muzzle: src.userData.muzzle.clone() };
  c.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });
  return c;
}
