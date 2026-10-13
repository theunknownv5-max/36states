// Procedural vehicles, each its own shape: saloon car, jeep, Hilux, yellow danfo bus, keke,
// okada, lorry, armoured carrier and the ambulance. Built from side profiles (extruded with
// rounded edges), tinted glass, real wheels, lights and bumpers. Forward is -z.
// charVehicle() turns any of them into a burnt-out black shell.
import * as THREE from 'three';
import { VEHICLES } from '../../../shared/vehicles.js';

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const matCache = new Map();
const mat = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
};

export const paint = (colour) => mat(`paint${colour}`, () => new THREE.MeshStandardMaterial({ color: colour, metalness: 0.55, roughness: 0.32, envMapIntensity: 1.15 }));
const M = {
  glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: '#10151a', metalness: 0.9, roughness: 0.06, envMapIntensity: 1.5 })),
  tyre: () => mat('tyre', () => new THREE.MeshStandardMaterial({ color: '#131313', roughness: 0.93 })),
  rim: () => mat('rim', () => new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.85, roughness: 0.3 })),
  plastic: () => mat('plastic', () => new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.7 })),
  chrome: () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: '#d9dde2', metalness: 1, roughness: 0.15 })),
  head: () => mat('head', () => new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c4', emissiveIntensity: 0.55, roughness: 0.2 })),
  tail: () => mat('tail', () => new THREE.MeshStandardMaterial({ color: '#b3120a', emissive: '#ff2a1a', emissiveIntensity: 0.45, roughness: 0.3 })),
  plate: () => mat('plate', () => new THREE.MeshStandardMaterial({ color: '#f1f1ea', roughness: 0.5 })),
  seat: () => mat('seat', () => new THREE.MeshStandardMaterial({ color: '#2a211b', roughness: 0.85 })),
  canvas: (c) => mat(`canvas${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }))
};

// Side profile (x = along, front at +x; y = up) extruded across the width, rounded edges.
function profile(points, width, bevel = 0.05) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.02, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // front (+x) now faces -z
  geo.computeVertexNormals();
  return geo;
}

function part(g, geo, material, x = 0, y = 0, z = 0, tag = 'paint') {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.tag = tag;
  g.add(m);
  return m;
}
const boxGeo = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));

function wheel(g, x, z, r, w, steer = false) {
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tyre = new THREE.Mesh(cached(`t${r}|${w}`, () => new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2)), M.tyre());
  const rim = new THREE.Mesh(cached(`r${r}|${w}`, () => new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 12).rotateZ(Math.PI / 2)), M.rim());
  const hub = new THREE.Mesh(cached(`h${r}|${w}`, () => new THREE.BoxGeometry(w + 0.03, r * 0.9, 0.06)), M.rim());
  tyre.castShadow = true;
  tyre.userData.tag = 'tyre';
  rim.userData.tag = 'rim';
  hub.userData.tag = 'rim';
  spin.add(tyre, rim, hub);
  g.add(pivot);
  g.userData.wheels.push({ pivot, spin, r, steer });
}

function lights(g, W, L, y, frontW = 0.34, sep = 0.3) {
  for (const s of [-1, 1]) {
    part(g, boxGeo(frontW, 0.13, 0.06), M.head(), s * (W / 2 - sep), y, -L / 2 + 0.01, 'light');
    part(g, boxGeo(0.3, 0.13, 0.06), M.tail(), s * (W / 2 - 0.25), y + 0.05, L / 2 - 0.01, 'light');
  }
}

function bumpers(g, W, L, y = 0.42) {
  part(g, boxGeo(W + 0.04, 0.2, 0.16), M.plastic(), 0, y, -L / 2 + 0.02, 'plastic');
  part(g, boxGeo(W + 0.04, 0.2, 0.16), M.plastic(), 0, y, L / 2 - 0.02, 'plastic');
  part(g, boxGeo(0.5, 0.12, 0.03), M.plate(), 0, y + 0.08, L / 2 + 0.07, 'plastic');
  part(g, boxGeo(0.5, 0.12, 0.03), M.plate(), 0, y + 0.08, -L / 2 - 0.07, 'plastic');
}

function mirrors(g, W, z, y, body) {
  for (const s of [-1, 1]) part(g, boxGeo(0.18, 0.12, 0.08), body, s * (W / 2 + 0.08), y, z, 'paint');
}

// ---------- the models ----------
function sedan(g, body) {
  const { L, W } = VEHICLES.sedan;
  part(g, profile([[-2.3, 0.3], [-2.33, 0.66], [-2.25, 0.94], [-1.42, 1.0], [1.3, 1.0], [2.2, 0.86], [2.33, 0.6], [2.3, 0.3]], W), body);
  part(g, profile([[-1.42, 0.98], [-0.95, 1.4], [0.5, 1.42], [1.28, 0.98]], W - 0.16, 0.03), M.glass(), 0, 0, 0, 'glass');
  part(g, boxGeo(W - 0.2, 0.05, 1.38), body, 0, 1.43, 0.22);
  part(g, boxGeo(W - 0.12, 0.42, 0.09), body, 0, 1.2, 0.18); // B-pillar
  part(g, boxGeo(W * 0.62, 0.14, 0.05), M.plastic(), 0, 0.68, -L / 2 - 0.005, 'plastic'); // grille
  mirrors(g, W, -0.95, 1.08, body);
  lights(g, W, L, 0.74);
  bumpers(g, W, L);
  for (const [z, st] of [[-1.42, true], [1.45, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.12), z, 0.33, 0.22, st);
}

function suv(g, body) {
  const { L, W } = VEHICLES.suv;
  part(g, profile([[-2.4, 0.42], [-2.42, 1.15], [1.45, 1.15], [2.32, 1.02], [2.42, 0.72], [2.38, 0.42]], W), body);
  part(g, profile([[-2.36, 1.13], [-2.3, 1.78], [0.75, 1.8], [1.42, 1.13]], W - 0.14, 0.03), M.glass(), 0, 0, 0, 'glass');
  part(g, boxGeo(W - 0.1, 0.07, 3.0), body, 0, 1.82, 0.85);
  for (const z of [0.15, 1.35]) part(g, boxGeo(W - 0.08, 0.6, 0.1), body, 0, 1.48, z);
  part(g, boxGeo(W * 0.7, 0.32, 0.05), M.chrome(), 0, 0.88, -L / 2 - 0.005, 'plastic');
  part(g, cached('spare', () => new THREE.CylinderGeometry(0.36, 0.36, 0.22, 18).rotateX(Math.PI / 2)), M.tyre(), 0, 0.95, L / 2 + 0.12, 'tyre');
  for (const x of [-0.45, 0.45]) part(g, boxGeo(0.05, 0.05, 2.6), M.plastic(), x, 1.88, 0.8, 'plastic'); // roof rails
  mirrors(g, W, -0.75, 1.3, body);
  lights(g, W, L, 0.88);
  bumpers(g, W, L, 0.5);
  for (const [z, st] of [[-1.5, true], [1.5, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.13), z, 0.4, 0.27, st);
}

function pickup(g, body) {
  const { L, W } = VEHICLES.pickup;
  part(g, profile([[-2.62, 0.45], [-2.65, 1.05], [1.55, 1.05], [2.48, 0.98], [2.65, 0.72], [2.6, 0.45]], W), body);
  part(g, profile([[-0.35, 1.03], [-0.32, 1.74], [0.95, 1.76], [1.55, 1.03]], W - 0.14, 0.03), M.glass(), 0, 0, 0, 'glass');
  part(g, boxGeo(W - 0.1, 0.06, 1.25), body, 0, 1.77, -0.3);
  // Open load bed with its walls and tailgate.
  for (const s of [-1, 1]) part(g, boxGeo(0.08, 0.42, 2.2), body, s * (W / 2 - 0.03), 1.25, 1.5);
  part(g, boxGeo(W, 0.42, 0.08), body, 0, 1.25, 2.6);
  part(g, boxGeo(W - 0.16, 0.06, 2.2), M.plastic(), 0, 1.07, 1.5, 'plastic');
  part(g, boxGeo(W * 0.66, 0.3, 0.05), M.chrome(), 0, 0.82, -L / 2 - 0.005, 'plastic');
  mirrors(g, W, -1.2, 1.25, body);
  lights(g, W, L, 0.85);
  bumpers(g, W, L, 0.5);
  for (const [z, st] of [[-1.65, true], [1.6, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.13), z, 0.38, 0.26, st);
}

function danfo(g, body) {
  const { L, W, H } = VEHICLES.danfo;
  part(g, profile([[-2.5, 0.35], [-2.5, H], [1.9, H], [2.45, 1.25], [2.5, 0.6], [2.48, 0.35]], W, 0.06), body);
  // The black stripes every Lagos danfo wears, side windows and the windscreen.
  for (const s of [-1, 1]) {
    for (const y of [0.78, 1.12]) part(g, boxGeo(0.02, 0.07, L - 0.4), M.plastic(), s * (W / 2 + 0.065), y, 0.05, 'plastic');
    part(g, boxGeo(0.02, 0.6, L - 1.4), M.glass(), s * (W / 2 + 0.06), 1.62, 0.35, 'glass');
  }
  part(g, cached('danfoWs', () => new THREE.PlaneGeometry(W - 0.2, 0.75)), M.glass(), 0, 1.55, -1.98, 'glass').rotation.x = -0.9;
  part(g, boxGeo(W - 0.3, 0.05, L - 1.2), M.plastic(), 0, H + 0.08, 0.4, 'plastic'); // roof rack
  for (const z of [-0.6, 0.6, 1.8]) part(g, boxGeo(W - 0.2, 0.08, 0.05), M.plastic(), 0, H + 0.04, z, 'plastic');
  mirrors(g, W, -1.9, 1.5, body);
  lights(g, W, L, 0.8);
  bumpers(g, W, L, 0.45);
  for (const [z, st] of [[-1.6, true], [1.65, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.14), z, 0.36, 0.24, st);
}

function keke(g, body) {
  const { L, W, H } = VEHICLES.keke;
  // Tub with the passenger bench, a nose with the single front wheel, roof on poles.
  part(g, profile([[-1.35, 0.32], [-1.38, 0.95], [-0.2, 1.0], [0.5, 0.75], [1.3, 0.62], [1.38, 0.36]], W, 0.05), body);
  part(g, boxGeo(W - 0.04, 0.06, L - 0.45), M.canvas('#121212'), 0, H, 0.12, 'plastic');
  part(g, boxGeo(W + 0.06, 0.04, L - 0.35), body, 0, H - 0.05, 0.12);
  for (const [x, z] of [[-1, -0.95], [1, -0.95], [-1, 1.25], [1, 1.25]]) part(g, cached('pole', () => new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6)), M.plastic(), x * (W / 2 - 0.05), 1.42, z, 'plastic');
  part(g, cached('kekeWs', () => new THREE.PlaneGeometry(W - 0.25, 0.6)), M.glass(), 0, 1.38, -1.0, 'glass').rotation.x = -0.25;
  part(g, boxGeo(W - 0.2, 0.32, 0.5), M.seat(), 0, 1.08, 0.75, 'seat');
  part(g, boxGeo(0.4, 0.2, 0.35), M.seat(), 0, 1.0, -0.35, 'seat');
  part(g, cached('bar', () => new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6).rotateZ(Math.PI / 2)), M.chrome(), 0, 1.16, -0.82, 'plastic');
  part(g, boxGeo(0.22, 0.14, 0.06), M.head(), 0, 0.72, -L / 2 + 0.02, 'light');
  for (const s of [-1, 1]) part(g, boxGeo(0.16, 0.1, 0.05), M.tail(), s * (W / 2 - 0.15), 0.85, L / 2 - 0.02, 'light');
  wheel(g, 0, -1.0, 0.24, 0.14, true);
  for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.06), 0.85, 0.25, 0.15, false);
}

function okada(g, body) {
  const dark = M.plastic();
  part(g, boxGeo(0.3, 0.24, 0.55), body, 0, 0.86, -0.15); // tank
  part(g, boxGeo(0.28, 0.1, 0.75), M.seat(), 0, 0.82, 0.38, 'seat');
  part(g, boxGeo(0.26, 0.3, 0.4), M.chrome(), 0, 0.48, 0.0, 'plastic'); // engine
  part(g, boxGeo(0.06, 0.06, 0.95), dark, 0, 0.62, 0.2, 'plastic'); // frame
  part(g, cached('exhaust', () => new THREE.CylinderGeometry(0.04, 0.05, 0.8, 8).rotateX(Math.PI / 2)), M.chrome(), 0.17, 0.4, 0.4, 'plastic');
  for (const s of [-1, 1]) part(g, cached('fork', () => new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6)), M.chrome(), s * 0.08, 0.68, -0.62, 'plastic').rotation.x = -0.35;
  part(g, cached('hbar', () => new THREE.CylinderGeometry(0.018, 0.018, 0.68, 6).rotateZ(Math.PI / 2)), dark, 0, 1.08, -0.5, 'plastic');
  part(g, boxGeo(0.16, 0.14, 0.12), body, 0, 0.98, -0.66);
  part(g, boxGeo(0.12, 0.08, 0.04), M.head(), 0, 0.98, -0.73, 'light');
  part(g, boxGeo(0.3, 0.04, 0.4), body, 0, 0.62, 0.72); // rear mudguard
  part(g, boxGeo(0.1, 0.05, 0.04), M.tail(), 0, 0.78, 0.92, 'light');
  wheel(g, 0, -0.7, 0.32, 0.1, true);
  wheel(g, 0, 0.68, 0.32, 0.12, false);
}

function lorry(g, body) {
  const { L, W } = VEHICLES.lorry;
  const cab = 2.3;
  part(g, profile([[L / 2 - cab, 0.7], [L / 2 - cab, 2.75], [L / 2 - 0.35, 2.75], [L / 2, 2.0], [L / 2, 0.7]], W, 0.06), body);
  part(g, cached('lorryWs', () => new THREE.PlaneGeometry(W - 0.25, 0.75)), M.glass(), 0, 2.32, -L / 2 + 0.14, 'glass').rotation.x = -0.45;
  for (const s of [-1, 1]) part(g, boxGeo(0.02, 0.55, 0.9), M.glass(), s * (W / 2 + 0.065), 2.25, -L / 2 + 1.1, 'glass');
  part(g, boxGeo(W * 0.8, 0.5, 0.05), M.chrome(), 0, 1.15, -L / 2 - 0.01, 'plastic');
  // Cargo body: wooden sides with a tarpaulin over the load.
  const bed = L - cab - 0.2;
  part(g, boxGeo(W, 0.15, bed), M.plastic(), 0, 0.78, cab / 2 + 0.1, 'plastic');
  part(g, boxGeo(W, 1.0, bed), M.canvas('#6b4a2a'), 0, 1.35, cab / 2 + 0.1, 'paint');
  part(g, boxGeo(W - 0.1, 1.05, bed - 0.1), M.canvas('#3d5a3a'), 0, 2.35, cab / 2 + 0.1, 'paint');
  for (const z of [-1, 0, 1]) part(g, boxGeo(W + 0.02, 0.06, 0.08), M.canvas('#2a1d12'), 0, 1.88, cab / 2 + 0.1 + z * (bed / 3), 'plastic');
  lights(g, W, L, 1.0);
  bumpers(g, W, L, 0.6);
  for (const [z, st] of [[-L / 2 + 1.2, true], [L / 2 - 2.1, false], [L / 2 - 0.85, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.18), z, 0.5, 0.32, st);
}

function apc(g, body) {
  const { L, W } = VEHICLES.apc;
  part(g, profile([[-3.15, 0.6], [-3.15, 1.85], [-2.75, 2.15], [1.9, 2.15], [3.05, 1.45], [3.15, 0.85], [2.75, 0.6]], W, 0.04), body);
  // Darker armour plates, vision slits, hatch and the turret with its machine gun.
  const dark = mat('apcDark', () => new THREE.MeshStandardMaterial({ color: '#3a3f26', roughness: 0.9, metalness: 0.2 }));
  for (const s of [-1, 1]) {
    part(g, boxGeo(0.04, 0.55, 4.6), dark, s * (W / 2 + 0.03), 1.2, 0.0);
    for (const z of [-1.6, -0.3, 1.0]) part(g, boxGeo(0.05, 0.08, 0.32), M.glass(), s * (W / 2 + 0.05), 1.75, z, 'glass');
  }
  part(g, boxGeo(1.2, 0.05, 0.12), M.glass(), 0, 1.9, -2.55, 'glass');
  const turret = new THREE.Group();
  turret.position.set(0, 2.15, 0.3);
  part(turret, cached('ring', () => new THREE.CylinderGeometry(0.75, 0.82, 0.25, 18)), dark, 0, 0.12, 0);
  part(turret, boxGeo(0.95, 0.42, 1.1), body, 0, 0.45, 0.05);
  part(turret, cached('mg', () => new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8).rotateX(Math.PI / 2)), M.plastic(), 0, 0.5, -1.15, 'plastic');
  part(turret, cached('mgBox', () => new THREE.BoxGeometry(0.22, 0.2, 0.5)), M.plastic(), 0, 0.5, -0.4, 'plastic');
  g.add(turret);
  g.userData.turret = turret;
  part(g, cached('hatch', () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 14)), dark, 0, 2.18, 1.6);
  part(g, boxGeo(W - 0.4, 0.12, 0.15), dark, 0, 0.95, -L / 2 + 0.25);
  for (const s of [-1, 1]) part(g, boxGeo(0.22, 0.12, 0.05), M.head(), s * 0.8, 1.35, -L / 2 + 0.1, 'light');
  for (const z of [-2.0, 0.0, 2.0]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.18), z, 0.55, 0.36, z < -1);
}

// The ambulance: white van, red stripe and cross, flashing light bar.
function ambulance(g) {
  const L = 5.2;
  const W = 2.0;
  const H = 2.45;
  const white = paint('#f5f5f2');
  part(g, profile([[-2.6, 0.4], [-2.6, H], [1.6, H], [2.2, 1.45], [2.6, 1.1], [2.6, 0.4]], W, 0.06), white);
  const red = mat('ambRed', () => new THREE.MeshStandardMaterial({ color: '#d0141b', roughness: 0.5 }));
  for (const s of [-1, 1]) {
    part(g, boxGeo(0.02, 0.22, L - 0.4), red, s * (W / 2 + 0.065), 1.05, 0.1);
    part(g, boxGeo(0.02, 0.5, 0.14), red, s * (W / 2 + 0.07), 1.75, 0.8);
    part(g, boxGeo(0.02, 0.14, 0.5), red, s * (W / 2 + 0.07), 1.75, 0.8);
    part(g, boxGeo(0.02, 0.5, 0.75), M.glass(), s * (W / 2 + 0.06), 1.75, -1.45, 'glass');
  }
  part(g, boxGeo(0.5, 0.14, 0.02), red, 0, 2.0, L / 2 + 0.065);
  part(g, boxGeo(0.14, 0.5, 0.02), red, 0, 2.0, L / 2 + 0.065);
  part(g, cached('ambWs', () => new THREE.PlaneGeometry(W - 0.2, 0.75)), M.glass(), 0, 1.7, -2.05, 'glass').rotation.x = -0.8;
  const bar = new THREE.Group();
  bar.position.set(0, H + 0.1, -1.4);
  const blue = new THREE.MeshStandardMaterial({ color: '#1a3cff', emissive: '#2a5bff', emissiveIntensity: 1 });
  const redL = new THREE.MeshStandardMaterial({ color: '#ff1a1a', emissive: '#ff2a2a', emissiveIntensity: 1 });
  part(bar, boxGeo(0.6, 0.14, 0.3), redL, -0.33, 0, 0, 'light');
  part(bar, boxGeo(0.6, 0.14, 0.3), blue, 0.33, 0, 0, 'light');
  g.add(bar);
  g.userData.beacons = [redL, blue];
  lights(g, W, L, 0.8);
  bumpers(g, W, L, 0.45);
  for (const [z, st] of [[-1.65, true], [1.7, false]]) for (const s of [-1, 1]) wheel(g, s * (W / 2 - 0.14), z, 0.37, 0.24, st);
}

const BUILDERS = { sedan, suv, pickup, danfo, keke, okada, lorry, apc, ambulance };

// A vehicle model: a Group with userData { wheels, type, turret? }.
export function buildVehicle(type, colour) {
  const g = new THREE.Group();
  g.userData = { type, wheels: [] };
  const body = paint(colour || VEHICLES[type]?.colours?.[0] || '#cccccc');
  BUILDERS[type](g, body);
  return g;
}

// ---------- burnt and rusted finishes ----------
let charTex = null;
let emberTex = null;
function charTextures() {
  if (charTex) return;
  const make = (fn) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    fn(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  charTex = make((x) => {
    x.fillStyle = '#2b2622';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random();
      x.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.3 + Math.random() * 0.5})` : v < 0.85 ? `rgba(90,80,72,${Math.random() * 0.35})` : `rgba(120,64,30,${Math.random() * 0.35})`;
      const s = 1 + Math.random() * 6;
      x.fillRect(Math.random() * 256, Math.random() * 256, s, s * (0.4 + Math.random()));
    }
    // Grey ash streaks and blistered paint.
    for (let i = 0; i < 40; i++) {
      x.strokeStyle = `rgba(150,140,130,${0.1 + Math.random() * 0.15})`;
      x.lineWidth = 1 + Math.random() * 3;
      x.beginPath();
      const y0 = Math.random() * 256;
      x.moveTo(Math.random() * 256, y0);
      x.lineTo(Math.random() * 256, y0 + (Math.random() - 0.5) * 40);
      x.stroke();
    }
  });
  emberTex = make((x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, 256, 256);
    // A few glowing cracks and sparse hot specks (most of the surface stays black).
    x.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      x.strokeStyle = `rgba(255,${80 + Math.random() * 60},10,${0.35 + Math.random() * 0.3})`;
      x.lineWidth = 0.8 + Math.random() * 1.2;
      x.beginPath();
      let px = Math.random() * 256;
      let py = Math.random() * 256;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) x.lineTo((px += (Math.random() - 0.5) * 40), (py += (Math.random() - 0.5) * 40));
      x.stroke();
    }
    for (let i = 0; i < 110; i++) {
      const r = 0.5 + Math.random() * 1.4;
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, r * 2);
      gr.addColorStop(0, '#ffd27a');
      gr.addColorStop(0.4, '#ff6a10');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.save();
      x.translate(Math.random() * 256, Math.random() * 256);
      x.fillStyle = gr;
      x.fillRect(-r * 2, -r * 2, r * 4, r * 4);
      x.restore();
    }
  });
}

// One shared-looking charcoal material per burnt object (so each can glow and cool on its own).
// Vehicles use metre UVs (repeat ~3 m per tile); house walls already use 3 m UVs.
export function charMaterial(vertexColors = false) {
  charTextures();
  const rep = vertexColors ? 1 : 0.33;
  const map = charTex.clone();
  const em = emberTex.clone();
  map.repeat.set(rep, rep);
  em.repeat.set(rep, rep);
  return new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 1, metalness: 0.08, emissive: '#ff4a08', emissiveMap: em, emissiveIntensity: 0, vertexColors });
}

// Burnt-out shell: black, glass gone, tyres burnt off, sitting low on its rims.
export function charVehicle(g, char = charMaterial()) {
  g.traverse((o) => {
    if (!o.isMesh) return;
    const tag = o.userData.tag;
    if (tag === 'glass' || tag === 'light' || tag === 'tyre' || tag === 'seat') o.visible = false;
    else o.material = char;
  });
  g.userData.charred = true;
  g.userData.char = char;
  const t = g.userData.turret;
  if (t) t.rotation.set(0.12, 0.6, 0.05);
  return char;
}

// Long-abandoned wreck: faded paint or rust, broken glass, flat tyres.
export function weatherVehicle(g, rust, hash) {
  // No rust given: sun-faded matte paint instead.
  if (!rust) {
    const c = g.children[0].material.color.getHexString();
    rust = mat(`faded${c}`, () => new THREE.MeshStandardMaterial({ color: `#${c}`, roughness: 0.88, metalness: 0.2 }));
  }
  g.traverse((o) => {
    if (!o.isMesh) return;
    const tag = o.userData.tag;
    if (tag === 'glass') o.visible = hash > 0.5;
    else if (tag === 'light') o.material = M.plastic();
    else if (tag === 'paint') o.material = rust;
  });
}
