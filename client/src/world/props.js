// Everything on the battlefield that is not a plain box: trees, grass, rocks, the
// landmark, resource-site machinery, roofs, flags, distant scenery.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../shared/rng.js';
import * as T from '../core/textures.js';

const v3 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eul = new THREE.Euler();
const sc = new THREE.Vector3();

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// Lumpy rock / hill geometry: an icosphere pushed around by noise.
function rockGeometry(seed, detail = 2, rough = 0.28) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    const n = hash3(Math.round(v3.x * 4) + seed, Math.round(v3.y * 4), Math.round(v3.z * 4)) * 0.6 + hash3(Math.round(v3.x * 9), Math.round(v3.y * 9) + seed, Math.round(v3.z * 9)) * 0.4;
    v3.multiplyScalar(1 + (n - 0.5) * rough * 2);
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  g.computeVertexNormals();
  return g;
}

// A dome-shaped granite inselberg (Zuma, Olumo, Aso Rock).
function monolithGeometry(seed, w, d, h) {
  const g = rockGeometry(seed, 4, 0.12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    const t = (v3.y + 1) / 2; // 0 bottom .. 1 top
    const taper = 1 - 0.45 * t * t;
    p.setXYZ(i, (v3.x * w * 0.5 * taper) / 0.85, Math.max(-0.5, t * h), (v3.z * d * 0.5 * taper) / 0.85);
  }
  g.computeVertexNormals();
  return g;
}

function cardMaterial(tex, colour, alphaTest = 0.45) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: colour, alphaTest, side: THREE.DoubleSide, roughness: 0.85 });
  return m;
}

function depthFor(tex, alphaTest = 0.45) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest });
}

// Bushy crown made of crossed leaf cards inside an ellipsoid, with normals pointing outward.
function crownGeometry(rng, count, rx, ry, rz, cy, size, flat = false) {
  const geos = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(size, size);
    eul.set(flat ? -Math.PI / 2 + (rng() - 0.5) * 0.6 : rng() * Math.PI, rng() * Math.PI, flat ? (rng() - 0.5) * 0.6 : rng() * Math.PI);
    g.applyMatrix4(m4.makeRotationFromEuler(eul));
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.8;
    const y = (rng() - 0.5) * 1.6;
    g.translate(Math.cos(a) * r * rx, cy + y * ry * 0.6, Math.sin(a) * r * rz);
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  const p = merged.attributes.position;
  const n = merged.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    v3.set(p.getX(i) / rx, (p.getY(i) - cy) / ry + 0.3, p.getZ(i) / rz).normalize();
    n.setXYZ(i, v3.x, v3.y, v3.z);
  }
  return merged;
}

function frondGeometry(count, len, droop, cy, width = 1.1) {
  const geos = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(width, len, 1, 8);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = (p.getY(k) + len / 2) / len; // 0 at stem
      const along = t * len;
      p.setXYZ(k, p.getX(k), -droop * t * t * len * 0.5 + along * 0.35, along);
    }
    g.applyMatrix4(m4.makeRotationY((i / count) * Math.PI * 2 + (i % 2) * 0.2));
    g.translate(0, cy, 0);
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  merged.computeVertexNormals();
  const n = merged.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setY(i, Math.abs(n.getY(i)) + 0.4);
  return merged;
}

function trunkGeometry(rTop, rBot, h, bend = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 9, 6, true);
  g.translate(0, h / 2, 0);
  if (bend) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h;
      p.setX(i, p.getX(i) + t * t * bend);
    }
    g.computeVertexNormals();
  }
  return g;
}

const TREE_TYPES = {
  palm: { trunk: [0.2, 0.3, 9, 0.9], fronds: [12, 4.6, 1.2], leaf: '#8fae4a' },
  acacia: { trunk: [0.12, 0.25, 4, 0], crown: [18, 3.6, 0.7, 3.6, 4.3, 2.6, true], leaf: '#7f9a46' },
  baobab: { trunk: [0.65, 1.1, 5.6, 0], crown: [10, 3.2, 1.2, 3.2, 6.6, 2.2], leaf: '#7d9248' },
  neem: { trunk: [0.16, 0.28, 4.2, 0], crown: [22, 2.8, 2.2, 2.8, 5.6, 2.3], leaf: '#5f8a3a' },
  shea: { trunk: [0.16, 0.3, 3.8, 0], crown: [20, 2.6, 2.0, 2.6, 5.0, 2.2], leaf: '#6a8a3e' },
  mango: { trunk: [0.2, 0.34, 3.6, 0], crown: [30, 3.4, 2.6, 3.4, 5.4, 2.4], leaf: '#3f6e2c' },
  almond: { trunk: [0.16, 0.26, 4.5, 0], crown: [18, 3.4, 1.0, 3.4, 5.2, 2.4, true], leaf: '#5c8f3a' },
  iroko: { trunk: [0.32, 0.55, 9, 0], crown: [34, 4.6, 3.2, 4.6, 10.6, 3.0], leaf: '#3c6a2a' },
  eucalyptus: { trunk: [0.12, 0.26, 11, 0.3], crown: [18, 1.8, 3.6, 1.8, 10.5, 2.0], leaf: '#7a9a6a' },
  mangrove: { trunk: [0.18, 0.4, 3.8, 0], crown: [24, 3.2, 1.8, 3.2, 4.6, 2.3], leaf: '#406b33' },
  plantain: { trunk: [0.1, 0.16, 2.4, 0], fronds: [7, 2.8, 0.9, 1.5], leaf: '#79b246' }
};

export function buildProps(arena, rng) {
  const map = arena.map;
  const root = arena.root;
  const add = (o, shadow = true) => {
    o.traverse?.((c) => {
      if (c.isMesh) {
        c.castShadow = shadow;
        c.receiveShadow = true;
      }
    });
    root.add(o);
    return o;
  };
  arena.loops = []; // positional ambient sound sources (flares, waterfalls)
  // Roof pieces of houses that can burn: kept so the fire can cave the roof in.
  const roofAdd = (o, v) => {
    add(o);
    if (v.house !== undefined && arena.houseParts?.[v.house]) arena.houseParts[v.house].props.push(o);
  };
  const leafTex = T.leafCard();
  const frondTex = T.frondCard();
  const bark = T.barkTexture();
  const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 });
  const dry = map.biome === 'sahel' ? 0.35 : map.biome === 'savanna' ? 0.2 : 0;

  // ---------- trees (instanced per type) ----------
  const byType = {};
  for (const t of map.trees) (byType[t.type] ||= []).push(t);
  // Scenery trees beyond the wall so the world does not end at the perimeter.
  const outside = [];
  const orng = mulberry32(map.seed ^ 77);
  const types = Object.keys(byType);
  if (types.length && map.biome !== 'urban') {
    for (let i = 0; i < 260; i++) {
      const a = orng() * Math.PI * 2;
      const r = map.half + 8 + orng() * 120;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < map.half + 4 && Math.abs(z) < map.half + 4) continue;
      outside.push({ x, z, type: types[Math.floor(orng() * types.length)], s: 0.9 + orng() * 0.6, rot: orng() * 6 });
    }
  }
  for (const t of outside) (byType[t.type] ||= []).push(t);
  for (const [type, list] of Object.entries(byType)) {
    const def = TREE_TYPES[type] || TREE_TYPES.neem;
    const trng = mulberry32(type.length * 999);
    const [rt, rb, h, bend] = def.trunk;
    const trunkGeo = trunkGeometry(rt, rb, h, bend);
    const leafCol = new THREE.Color(def.leaf).lerp(new THREE.Color('#b59a52'), dry);
    let crownGeo;
    let crownMat;
    if (def.fronds) {
      const [n, len, droop, wd] = def.fronds;
      crownGeo = frondGeometry(n, len, droop, h - 0.1, wd || 1.1);
      if (bend) crownGeo.translate(bend, 0, 0);
      crownMat = cardMaterial(frondTex, leafCol, 0.4);
    } else {
      const [n, rx, ry, rz, cy, size, flat] = def.crown;
      crownGeo = crownGeometry(trng, n, rx, ry, rz, cy, size, flat);
      if (bend) crownGeo.translate(bend, 0, 0);
      crownMat = cardMaterial(leafTex, leafCol);
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, type === 'plantain' ? new THREE.MeshStandardMaterial({ color: '#5d7a33', roughness: 0.8 }) : barkMat, list.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    crowns.customDepthMaterial = depthFor(crownMat.map, crownMat.alphaTest);
    const c = new THREE.Color();
    list.forEach((t, i) => {
      q.setFromAxisAngle(sc.set(0, 1, 0), t.rot);
      m4.compose(v3.set(t.x, 0, t.z), q, sc.set(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m4);
      crowns.setMatrixAt(i, m4);
      const k = 0.8 + hash3(t.x, t.z, 1) * 0.4;
      crowns.setColorAt(i, c.setRGB(k, k * (0.95 + hash3(t.z, t.x, 2) * 0.1), k));
    });
    for (const im of [trunks, crowns]) {
      im.castShadow = true;
      im.receiveShadow = true;
      root.add(im);
    }
  }

  // ---------- grass tufts swaying in the wind ----------
  if (map.grass.length) {
    const gtex = T.grassCard();
    const g1 = new THREE.PlaneGeometry(1.1, 0.75);
    g1.translate(0, 0.37, 0);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const tuft = mergeGeometries([g1, g2]);
    const n = tuft.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const tint = new THREE.Color(map.biome === 'sahel' ? '#d6c38a' : map.biome === 'savanna' ? '#cdbf7a' : '#9fbf6a');
    const mat = cardMaterial(gtex, tint, 0.35);
    const wind = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uWind * 1.7 + ip.x * 0.35 + ip.z * 0.21) * 0.12 + sin(uWind * 3.1 + ip.x) * 0.04;
        transformed.x += sway * position.y;
        transformed.z += sway * 0.6 * position.y;`
      );
    };
    const spots = [];
    const grng = mulberry32(map.seed ^ 31);
    for (const g of map.grass) {
      const k = 2 + Math.floor(grng() * 4);
      for (let i = 0; i < k; i++) spots.push({ x: g.x + (grng() - 0.5) * 2.2, z: g.z + (grng() - 0.5) * 2.2, s: g.s * (0.7 + grng() * 0.6), rot: grng() * 6 });
    }
    const max = arena.quality.textureSize >= 1024 ? spots.length : Math.min(spots.length, 1200);
    const im = new THREE.InstancedMesh(tuft, mat, max);
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) {
      const s = spots[i];
      q.setFromAxisAngle(sc.set(0, 1, 0), s.rot);
      m4.compose(v3.set(s.x, 0, s.z), q, sc.set(s.s, s.s, s.s));
      im.setMatrixAt(i, m4);
      const k = 0.75 + hash3(s.x, s.z, 3) * 0.45;
      im.setColorAt(i, c.setRGB(k, k, k * 0.9));
    }
    im.receiveShadow = true;
    root.add(im);
    arena.animated.push({ update: (dt, t) => (wind.value = t) });
  }

  // ---------- rocks ----------
  const rockTex = T.rockTexture();
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normalMap, roughness: 0.92, color: map.biome === 'plateau' ? '#9a948a' : '#b0a596' });
  if (map.rocks.length) {
    const variants = [0, 1, 2].map((s) => rockGeometry(s * 17 + 3));
    const groups = [[], [], []];
    map.rocks.forEach((r, i) => groups[i % 3].push(r));
    groups.forEach((list, vi) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(variants[vi], rockMat, list.length);
      list.forEach((r, i) => {
        q.setFromAxisAngle(sc.set(0, 1, 0), r.rot);
        m4.compose(v3.set(r.x, r.h * 0.25, r.z), q, sc.set(r.r, r.h * 0.75, r.r));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = im.receiveShadow = true;
      root.add(im);
    });
  }

  // ---------- distant hills / skyline ----------
  const hrng = mulberry32(map.seed ^ 99);
  if (map.biome === 'urban') {
    const fac = T.facadeTexture();
    const mat = new THREE.MeshStandardMaterial({ map: fac.map, roughness: 0.5, metalness: 0.2 });
    for (let i = 0; i < 70; i++) {
      const a = hrng() * Math.PI * 2;
      const r = 150 + hrng() * 220;
      const w = 14 + hrng() * 26;
      const h = 20 + hrng() * (hrng() < 0.2 ? 110 : 45);
      const geo = new THREE.BoxGeometry(w, h, w * (0.6 + hrng() * 0.6));
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 12), uv.getY(k) * (h / 14));
      const tex = mat.map.clone();
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      mesh.rotation.y = hrng() * 3;
      root.add(mesh);
    }
    mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
  } else {
    const hillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(map.look.ground).lerp(new THREE.Color('#3f5a35'), map.look.grass * 0.6), roughness: 1 });
    const hillGeo = rockGeometry(5, 3, 0.18);
    const count = map.biome === 'plateau' ? 40 : 22;
    const im = new THREE.InstancedMesh(hillGeo, map.biome === 'plateau' ? rockMat : hillMat, count);
    for (let i = 0; i < count; i++) {
      const a = hrng() * Math.PI * 2;
      const r = 260 + hrng() * 200;
      const w = 40 + hrng() * 70;
      const h = 15 + hrng() * (map.biome === 'plateau' ? 60 : 30);
      m4.compose(v3.set(Math.cos(a) * r, -h * 0.25, Math.sin(a) * r), q.identity(), sc.set(w, h, w * 0.8));
      im.setMatrixAt(i, m4);
    }
    root.add(im);
  }

  // ---------- typed visuals from the map generator ----------
  const paint = (c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3, ...opts });
  const metal = T.metalTexture();
  const zinc = T.zincTexture();
  const zincMat = new THREE.MeshStandardMaterial({ map: zinc.map, normalMap: zinc.normalMap, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide });
  const tankMat = paint('#d9d6cc', { roughness: 0.45, metalness: 0.4, normalMap: metal.normalMap });
  const steel = paint('#5b5f62', { roughness: 0.5, metalness: 0.7 });
  const yellow = paint('#d8a21a', { roughness: 0.5, metalness: 0.4 });
  const dark = paint('#222', { roughness: 0.7 });
  const earth = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1, map: T.groundTexture(map.biome).map });
  const flameTex = T.flameTex();
  const glowTex = T.softDot();
  const mud = T.mudTexture();
  const mudMat = new THREE.MeshStandardMaterial({ map: mud.map, normalMap: mud.normalMap, roughness: 0.95 });

  const flame = (x, y, z, size, light = false) => {
    const g = new THREE.Group();
    const sprites = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.scale.set(size, size * 1.6, 1);
      sp.position.y = size * 0.5 + i * size * 0.2;
      g.add(sp);
      sprites.push(sp);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a30', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.scale.set(size * 4, size * 4, 1);
    glow.position.y = size * 0.7;
    g.add(glow);
    let pl = null;
    if (light) {
      pl = new THREE.PointLight('#ff8a3a', 60, 70, 1.6);
      pl.position.y = size;
      g.add(pl);
    }
    g.position.set(x, y, z);
    root.add(g);
    const seed = x * 3 + z;
    arena.animated.push({
      update: (dt, t) => {
        sprites.forEach((sp, i) => {
          const f = Math.sin(t * (9 + i * 2.3) + seed + i) * 0.5 + 0.5;
          sp.scale.set(size * (0.8 + f * 0.3), size * (1.4 + f * 0.6), 1);
          sp.position.x = Math.sin(t * 2 + i) * size * 0.08 + i * 0.05 * size;
          sp.material.rotation = Math.sin(t * 3 + i) * 0.15;
        });
        if (pl) pl.intensity = 50 + Math.sin(t * 13 + seed) * 10 + Math.sin(t * 7.3) * 8;
      }
    });
    return g;
  };

  for (const v of map.visuals) {
    switch (v.type) {
      case 'flag': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 9, 8), steel);
        pole.position.y = 4.5;
        g.add(pole);
        const geo = new THREE.PlaneGeometry(2.6, 1.6, 14, 6);
        geo.translate(1.3, 0, 0);
        const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.flagTexture(v.side), side: THREE.DoubleSide, roughness: 0.9 }));
        cloth.position.y = 8;
        g.add(cloth);
        g.position.set(v.x, 0, v.z);
        add(g);
        const base = Float32Array.from(geo.attributes.position.array);
        arena.animated.push({
          update: (dt, t) => {
            const p = geo.attributes.position;
            for (let i = 0; i < p.count; i++) {
              const x = base[i * 3];
              p.setZ(i, Math.sin(x * 2.2 - t * 5) * 0.16 * (x / 2.6) + Math.sin(x * 4 - t * 7) * 0.04 * (x / 2.6));
            }
            p.needsUpdate = true;
            geo.computeVertexNormals();
          }
        });
        break;
      }
      case 'pumpjack': {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 5), dark);
        base.position.y = 0.2;
        g.add(base);
        for (const s of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.3, 0.14), yellow);
          leg.position.set(s * 0.45, 1.75, 0.3);
          leg.rotation.z = s * -0.12;
          g.add(leg);
        }
        const pivot = new THREE.Group();
        pivot.position.set(0, 3.3, 0.3);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 5.2), yellow);
        pivot.add(beam);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.35, 16, 1, false, -0.9, 1.8), yellow);
        head.rotation.z = Math.PI / 2;
        head.position.z = -2.7;
        pivot.add(head);
        const weight = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), dark);
        weight.position.set(0, -0.4, 2.4);
        pivot.add(weight);
        g.add(pivot);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 6), steel);
        rod.position.set(0, 1.5, -2.95);
        g.add(rod);
        const well = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.8, 10), steel);
        well.position.set(0, 0.4, -2.95);
        g.add(well);
        g.position.set(v.x, 0, v.z);
        add(g);
        const ph = v.x;
        arena.animated.push({ update: (dt, t) => (pivot.rotation.x = Math.sin(t * 1.3 + ph) * 0.28) });
        arena.loops.push({ kind: 'machine', x: v.x, y: 1, z: v.z });
        break;
      }
      case 'tank': {
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(v.r, v.r, v.h, 28), tankMat);
        body.position.y = v.h / 2;
        g.add(body);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(v.r, 28, 8, 0, Math.PI * 2, 0, 0.35), tankMat);
        cap.position.y = v.h - v.r * 0.94;
        g.add(cap);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(v.r + 0.02, v.r + 0.02, 0.35, 28, 1, true), paint('#a3342b'));
        band.position.y = v.h * 0.7;
        g.add(band);
        const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, v.h, 0.08), steel);
        ladder.position.set(0, v.h / 2, v.r + 0.08);
        g.add(ladder);
        g.position.set(v.x, 0, v.z);
        add(g);
        break;
      }
      case 'pipe': {
        const len = Math.hypot(v.x1 - v.x0, v.z1 - v.z0);
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(v.r * 0.8, v.r * 0.8, len, 12), paint('#7c7f6a', { metalness: 0.6 }));
        pipe.rotation.z = Math.PI / 2;
        const g = new THREE.Group();
        g.add(pipe);
        for (let k = -len / 2 + 1; k < len / 2; k += 3) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.15, v.y, 0.4), dark);
          s.position.set(k, -v.y / 2, 0);
          g.add(s);
        }
        g.position.set((v.x0 + v.x1) / 2, v.y, (v.z0 + v.z1) / 2);
        g.rotation.y = -Math.atan2(v.z1 - v.z0, v.x1 - v.x0);
        add(g);
        break;
      }
      case 'smallFlare': {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 9, 10), steel);
        stack.position.set(v.x, 4.5, v.z);
        add(stack);
        flame(v.x, 9, v.z, 1.4);
        arena.loops.push({ kind: 'flare', x: v.x, y: 9, z: v.z, small: true });
        break;
      }
      case 'heap': {
        const geo = rockGeometry(Math.floor(v.x), 2, 0.2);
        const heap = new THREE.Mesh(geo, earth);
        heap.scale.set(v.r, v.h * 0.6, v.r);
        heap.position.set(v.x, 0, v.z);
        add(heap);
        break;
      }
      case 'headframe': {
        const g = new THREE.Group();
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8.4, 0.18), steel);
          leg.position.set(sx * 0.9, 4.2, sz * 0.9);
          leg.rotation.set(sz * 0.08, 0, -sx * 0.08);
          g.add(leg);
        }
        for (let h = 1.5; h < 8; h += 2) {
          const ring = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), steel);
          ring.position.y = h;
          ring.scale.set(1 - h * 0.04, 1, 1 - h * 0.04);
          g.add(ring);
        }
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 20), steel);
        wheel.position.y = 8.6;
        g.add(wheel);
        g.position.set(v.x, 1.2, v.z);
        add(g);
        arena.animated.push({ update: (dt, t) => (wheel.rotation.z = t * 0.8) });
        break;
      }
      case 'pitHole': {
        const hole = new THREE.Mesh(new THREE.CircleGeometry(v.r, 24), new THREE.MeshStandardMaterial({ color: '#1a120a', roughness: 1 }));
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(v.x, 0.03, v.z);
        root.add(hole);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(v.r, 0.35, 6, 24), earth);
        rim.rotation.x = Math.PI / 2;
        rim.scale.z = 0.5;
        rim.position.set(v.x, 0.05, v.z);
        add(rim);
        break;
      }
      case 'farmRows': {
        if (v.crop === 'ranch') {
          // Grazing cattle (white Fulani / Sokoto Gudali).
          const hide = [paint('#e8e2d6', { metalness: 0, roughness: 0.9 }), paint('#7a4a2a', { metalness: 0, roughness: 0.9 }), paint('#2a2420', { metalness: 0, roughness: 0.9 })];
          for (let i = 0; i < 5; i++) {
            const cow = new THREE.Group();
            const mat = hide[i % 3];
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.1, 4, 8), mat);
            body.rotation.z = Math.PI / 2;
            body.position.y = 1.05;
            cow.add(body);
            const hump = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat);
            hump.position.set(0.45, 1.45, 0);
            cow.add(hump);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.28), mat);
            head.position.set(1.05, 1.15, 0);
            head.rotation.z = -0.5;
            cow.add(head);
            for (const s of [-1, 1]) {
              const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.55, 6), paint('#d9cfb8'));
              horn.position.set(0.95, 1.45, s * 0.2);
              horn.rotation.x = s * 0.6;
              cow.add(horn);
            }
            for (const [lx, lz] of [
              [-0.5, -0.2],
              [-0.5, 0.2],
              [0.5, -0.2],
              [0.5, 0.2]
            ]) {
              const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.8, 6), mat);
              leg.position.set(lx, 0.4, lz);
              cow.add(leg);
            }
            const a = rng() * Math.PI * 2;
            cow.position.set(v.x + Math.cos(a) * (10 + rng() * 4), 0, v.z + Math.sin(a) * (10 + rng() * 4));
            cow.rotation.y = rng() * 6;
            add(cow);
            const ph = rng() * 10;
            arena.animated.push({ update: (dt, t) => (head.rotation.z = -0.5 - Math.max(0, Math.sin(t * 0.5 + ph)) * 0.5) });
          }
        } else {
          // Rows of millet / guinea corn.
          const stalk = new THREE.PlaneGeometry(0.5, 1.6);
          stalk.translate(0, 0.8, 0);
          const tuft = mergeGeometries([stalk, stalk.clone().rotateY(Math.PI / 2)]);
          const mat = cardMaterial(T.grassCard(), new THREE.Color('#c9b26a'), 0.35);
          const list = [];
          for (let r = -3; r <= 3; r++) for (let k = -6; k <= 6; k++) if (rng() < 0.85) list.push([v.x + 14 + r * 1.1, v.z + k * 1.0]);
          const im = new THREE.InstancedMesh(tuft, mat, list.length);
          list.forEach(([x, z], i) => {
            m4.compose(v3.set(x, 0, z), q.setFromAxisAngle(sc.set(0, 1, 0), i), sc.set(1, 0.8 + hash3(x, z, 4) * 0.5, 1));
            im.setMatrixAt(i, m4);
          });
          root.add(im);
        }
        break;
      }
      case 'saltPans': {
        const mat = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.35 });
        for (let i = 0; i < 6; i++) {
          const pan = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), mat);
          pan.rotation.x = -Math.PI / 2;
          pan.position.set(v.x - 13 + (i % 2) * 3.8, 0.03, v.z - 4 + Math.floor(i / 2) * 2.8);
          pan.receiveShadow = true;
          root.add(pan);
        }
        break;
      }
      case 'canoes': {
        const wood = new THREE.MeshStandardMaterial({ map: T.plankTexture().map, color: '#a07a50', roughness: 0.85 });
        for (let i = 0; i < 3; i++) {
          const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), wood);
          hull.scale.set(0.55, 0.45, 3.6);
          hull.rotation.z = Math.PI;
          hull.position.set(v.x + 12 + i * 1.6, 0.42, v.z - 2 + i * 0.7);
          hull.rotation.y = 0.1 * i;
          hull.material.side = THREE.DoubleSide;
          add(hull);
        }
        break;
      }
      case 'monolith': {
        const mesh = new THREE.Mesh(monolithGeometry(Math.floor(v.x * 7), v.w, v.d, v.h), rockMat);
        mesh.position.set(v.x, -0.3, v.z);
        add(mesh);
        break;
      }
      case 'boulder': {
        const mesh = new THREE.Mesh(rockGeometry(Math.floor(v.x * 3 + v.z), 2, 0.22), rockMat);
        mesh.scale.set(v.r, v.h * 0.6, v.r);
        mesh.position.set(v.x, v.h * 0.3, v.z);
        add(mesh);
        break;
      }
      case 'gateArch': {
        // Crenellations along the top of the ancient city wall, and the arch over the gate.
        for (let x = -v.w / 2 + 1; x <= v.w / 2 - 1; x += 1.6) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 6), mudMat);
          cone.position.set(v.x + x, v.h + 0.6, v.z);
          add(cone);
        }
        const arch = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.45, 8, 16, Math.PI), mudMat);
        arch.position.set(v.x, 4.6, v.z);
        add(arch);
        for (const s of [-1, 1]) {
          const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.6, 8), mudMat);
          top.position.set(v.x + s * 4.4, v.h + 3.3, v.z);
          add(top);
        }
        break;
      }
      case 'flareStack': {
        const g = new THREE.Group();
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, v.h, 14), steel);
        stack.position.y = v.h / 2;
        g.add(stack);
        for (let h = 6; h < v.h; h += 8) {
          const band = new THREE.Mesh(new THREE.CylinderGeometry(1.15 - h * 0.018, 1.15 - h * 0.018, 1.2, 14, 1, true), paint('#c9302c'));
          band.position.y = h;
          g.add(band);
        }
        for (let i = 0; i < 3; i++) {
          const guy = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, v.h * 1.05, 4), steel);
          const a = (i / 3) * Math.PI * 2;
          guy.position.set(Math.cos(a) * 7, v.h / 2, Math.sin(a) * 7);
          guy.lookAt(0, v.h, 0);
          guy.rotateX(Math.PI / 2);
          g.add(guy);
        }
        g.position.set(v.x, 0, v.z);
        add(g);
        flame(v.x, v.h, v.z, 5, true);
        arena.loops.push({ kind: 'flare', x: v.x, y: v.h, z: v.z });
        break;
      }
      case 'tower': {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 10, 6), steel);
        ant.position.set(v.x, v.h + 5, v.z);
        add(ant);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a' }));
        lamp.position.set(v.x, v.h + 10.2, v.z);
        root.add(lamp);
        arena.animated.push({ update: (dt, t) => (lamp.visible = Math.sin(t * 3) > 0) });
        break;
      }
      case 'cliff': {
        const mesh = new THREE.Mesh(rockGeometry(9, 3, 0.15), rockMat);
        mesh.scale.set(v.w * 0.62, v.h * 0.62, v.d * 0.75);
        mesh.position.set(v.x, v.h * 0.42, v.z);
        add(mesh);
        break;
      }
      case 'waterfall': {
        const tex = T.waterfallTex();
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, color: '#dfeef5' });
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(v.w, v.h), mat);
        sheet.position.set(v.x, v.h / 2, v.z + v.dir * 0.4);
        if (v.dir < 0) sheet.rotation.y = Math.PI;
        root.add(sheet);
        const mist = [];
        for (let i = 0; i < 8; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.smokePuff(), color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
          sp.position.set(v.x + (i / 7 - 0.5) * v.w, 1, v.z + v.dir * 2);
          sp.scale.setScalar(4);
          root.add(sp);
          mist.push(sp);
        }
        arena.animated.push({
          update: (dt, t) => {
            tex.offset.y = t * 1.6;
            mist.forEach((sp, i) => {
              sp.position.y = 1 + Math.sin(t * 0.7 + i) * 0.5;
              sp.material.rotation = t * 0.1 + i;
            });
          }
        });
        arena.loops.push({ kind: 'waterfall', x: v.x, y: 2, z: v.z });
        break;
      }
      case 'reeds': {
        const blade = new THREE.PlaneGeometry(0.6, 1.8);
        blade.translate(0, 0.9, 0);
        const tuft = mergeGeometries([blade, blade.clone().rotateY(Math.PI / 2)]);
        const mat = cardMaterial(T.grassCard(), new THREE.Color('#9bb067'), 0.35);
        const list = [];
        for (let i = 0; i < 160; i++) {
          const a = rng() * Math.PI * 2;
          const x = v.x + Math.cos(a) * (v.w / 2 + (rng() - 0.3) * 2.5);
          const z = v.z + Math.sin(a) * (v.d / 2 + (rng() - 0.3) * 2.5);
          list.push([Math.max(v.x - v.w / 2 - 2, Math.min(v.x + v.w / 2 + 2, x)), Math.max(v.z - v.d / 2 - 2, Math.min(v.z + v.d / 2 + 2, z))]);
        }
        const im = new THREE.InstancedMesh(tuft, mat, list.length);
        list.forEach(([x, z], i) => {
          m4.compose(v3.set(x, -0.2, z), q.setFromAxisAngle(sc.set(0, 1, 0), i * 1.3), sc.set(1, 0.8 + hash3(x, z, 5) * 0.6, 1));
          im.setMatrixAt(i, m4);
        });
        root.add(im);
        break;
      }
      case 'palaceTop': {
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ]) {
          const p = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 6), mudMat);
          p.position.set(v.x + (sx * v.w) / 2, 6.1, v.z + (sz * v.d) / 2);
          add(p);
        }
        const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), paint('#e8dcc0', { metalness: 0 }));
        dome.position.set(v.x, 7, v.z - 2);
        add(dome);
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.6, 6), paint('#d4af37', { metalness: 0.8, roughness: 0.3 }));
        fin.position.set(v.x, 10.9, v.z - 2);
        add(fin);
        break;
      }
      case 'landmarkSign': {
        const dz = v.z > 0 ? -1 : 1;
        const g = new THREE.Group();
        const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: T.signboardTexture(v.name, `${map.state.name} State · ${map.state.capital}`), roughness: 0.6 }));
        board.position.y = 2.6;
        g.add(board);
        const back = new THREE.Mesh(new THREE.BoxGeometry(6.1, 1.6, 0.06), dark);
        back.position.set(0, 2.6, -0.04);
        g.add(back);
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), steel);
          post.position.set(s * 2.6, 1.7, -0.08);
          g.add(post);
        }
        g.position.set(v.x + 17, 0, v.z + dz * 13);
        if (dz < 0) g.rotation.y = Math.PI;
        add(g);
        break;
      }
      case 'stallRoof': {
        const colours = ['#c0392b', '#2471a3', '#f1c40f', '#27ae60', '#e67e22'];
        const cloth = paint(colours[Math.floor(hash3(v.x, v.z, 6) * colours.length)], { metalness: 0, roughness: 0.9, side: THREE.DoubleSide });
        const g = new THREE.Group();
        const top = new THREE.Mesh(new THREE.PlaneGeometry(v.w + 0.8, v.d + 0.8), cloth);
        top.rotation.x = -Math.PI / 2 + 0.12;
        top.position.y = 2.25;
        g.add(top);
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5), paint('#6b4a2a', { metalness: 0 }));
          pole.position.set((sx * v.w) / 2, 1.15, (sz * v.d) / 2);
          g.add(pole);
        }
        g.position.set(v.x, 0, v.z);
        g.rotation.y = v.rot ? Math.PI / 2 : 0;
        add(g);
        break;
      }
      case 'blockBuilding':
      case 'parapet': {
        const h = v.h + (v.type === 'parapet' ? 0.12 : 0);
        const rim = paint(v.type === 'parapet' && v.kind === 'mud' ? '#8a5a38' : '#b9b3a8', { metalness: 0, roughness: 0.9 });
        if (v.kind === 'mud') rim.map = mud.map;
        for (const [w, d, x, z] of [
          [v.w, 0.2, 0, -v.d / 2],
          [v.w, 0.2, 0, v.d / 2],
          [0.2, v.d, -v.w / 2, 0],
          [0.2, v.d, v.w / 2, 0]
        ]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, d), rim);
          m.position.set(v.x + x, h + 0.27, v.z + z);
          roofAdd(m, v);
        }
        if (hash3(v.x, v.z, 7) < 0.6) {
          // The black rooftop water tank found on half the roofs in Nigeria.
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 1.4, 16), paint('#151515', { metalness: 0, roughness: 0.6 }));
          tank.position.set(v.x + v.w * 0.25, h + 1.1, v.z - v.d * 0.2);
          roofAdd(tank, v);
          const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), steel);
          stand.position.set(v.x + v.w * 0.25, h + 0.2, v.z - v.d * 0.2);
          roofAdd(stand, v);
        }
        break;
      }
      case 'zincRoof': {
        // Pitched corrugated roof over the flat collision slab.
        const rise = 1.1;
        const w = v.w + 0.8;
        const d = v.d + 0.8;
        const along = w >= d;
        const span = along ? d : w;
        const len = along ? w : d;
        const slope = Math.hypot(span / 2, rise);
        const ang = Math.atan2(rise, span / 2);
        const g = new THREE.Group();
        for (const s of [-1, 1]) {
          const geo = new THREE.PlaneGeometry(len, slope);
          const uv = geo.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (slope / 3), uv.getY(i) * (len / 3));
          // Rotate UVs so corrugations run down the slope.
          for (let i = 0; i < uv.count; i++) {
            const a = uv.getX(i);
            uv.setXY(i, uv.getY(i), a);
          }
          const sheet = new THREE.Mesh(geo, zincMat);
          sheet.rotation.x = -Math.PI / 2 + s * ang;
          sheet.position.set(0, v.h + 0.12 + rise / 2, (s * span) / 4);
          g.add(sheet);
        }
        // Gable ends.
        const gable = new THREE.Shape();
        gable.moveTo(-span / 2, 0);
        gable.lineTo(span / 2, 0);
        gable.lineTo(0, rise);
        gable.closePath();
        const gGeo = new THREE.ShapeGeometry(gable);
        for (const s of [-1, 1]) {
          const end = new THREE.Mesh(gGeo, v.kind === 'mud' ? mudMat : paint('#c9c2b0', { metalness: 0, roughness: 0.9, side: THREE.DoubleSide }));
          end.rotation.y = Math.PI / 2;
          end.position.set((s * (len - 0.8)) / 2, v.h + 0.12, 0);
          g.add(end);
        }
        g.position.set(v.x, 0, v.z);
        if (!along) g.rotation.y = Math.PI / 2;
        roofAdd(g, v);
        break;
      }
      default:
    }
  }
}
