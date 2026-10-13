// Builds a state's battlefield from the shared deterministic map: terrain, every wall,
// crate and building, water, sky, sun and weather. Props, foliage and live markers
// (sites, gems, adverts) live in props.js and markers.js.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mulberry32 } from '../../../shared/rng.js';
import { inWater } from '../../../shared/map.js';
import { query } from '../../../shared/physics.js';
import * as T from '../core/textures.js';
import { buildProps } from './props.js';
import { buildVehicle, charVehicle, charMaterial, weatherVehicle } from './vehicle-models.js';
import { VEHICLES } from '../../../shared/vehicles.js';

// ---------- geometry builder: boxes merged per material, UVs in world metres ----------
class BoxBuilder {
  constructor() {
    this.groups = new Map();
  }
  group(key) {
    if (!this.groups.has(key)) this.groups.set(key, { pos: [], nor: [], uv: [], col: [], idx: [] });
    return this.groups.get(key);
  }
  // tile: metres per texture repeat, or 'fit' for 0..1 on every face.
  add(key, b, tile, tint = [1, 1, 1], skipBottom = true) {
    const g = this.group(key);
    const { x0, y0, z0, x1, y1, z1 } = b;
    const faces = [
      // normal, 4 corners (counter-clockwise seen from outside)
      [[1, 0, 0], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 'zy'],
      [[-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 'zy'],
      [[0, 1, 0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 'xz'],
      [[0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 'xz'],
      [[0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 'xy'],
      [[0, 0, -1], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 'xy']
    ];
    for (const [n, a, bb, c, d, plane] of faces) {
      if (skipBottom && n[1] === -1 && y0 <= 0.01) continue;
      const base = g.pos.length / 3;
      for (const v of [a, bb, c, d]) {
        g.pos.push(v[0], v[1], v[2]);
        g.nor.push(n[0], n[1], n[2]);
        let u;
        let w;
        if (tile === 'fit') {
          const lu = plane === 'zy' ? (v[2] - z0) / (z1 - z0) : (v[0] - x0) / (x1 - x0);
          const lv = plane === 'xz' ? (v[2] - z0) / (z1 - z0) : (v[1] - y0) / (y1 - y0);
          u = lu;
          w = lv;
        } else {
          u = (plane === 'zy' ? v[2] : v[0]) / tile;
          w = (plane === 'xz' ? v[2] : v[1]) / tile;
        }
        g.uv.push(u, w);
        // Fake ambient occlusion: darker near the ground.
        const ao = n[1] === 0 ? 0.72 + Math.min(1, v[1] / 1.4) * 0.28 : 1;
        g.col.push(tint[0] * ao, tint[1] * ao, tint[2] * ao);
      }
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  build(materials, parent) {
    for (const [key, g] of this.groups) {
      if (!g.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      geo.setIndex(g.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
  }
}

function surfaceMat(tex, opts = {}) {
  return new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap || null, roughness: 0.9, metalness: 0, vertexColors: true, ...opts });
}

const PLASTER_TINTS = ['#f1e6cf', '#d8e6ee', '#f0d5cf', '#d9ead3', '#f3e7a8', '#ffffff', '#e8d2b0', '#c9dff2'];
const CONTAINER_TINTS = ['#a3342b', '#2d5d9a', '#2f7a46', '#d77a1e', '#6d6d6d', '#e2e2e2', '#264a6e'];
const rgb = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

// Sun direction, fog, rain and haze per biome; the hour is fixed per match for fairness.
const ATMOS = {
  sahel: { fog: 0.0062, turbidity: 9, rayleigh: 1.2, rainChance: 0, dust: true },
  savanna: { fog: 0.0042, turbidity: 6, rayleigh: 1.5, rainChance: 0.15 },
  plateau: { fog: 0.0035, turbidity: 3, rayleigh: 2, rainChance: 0.25 },
  rainforest: { fog: 0.0058, turbidity: 8, rayleigh: 2.2, rainChance: 0.4 },
  creeks: { fog: 0.006, turbidity: 8, rayleigh: 2, rainChance: 0.35 },
  urban: { fog: 0.005, turbidity: 10, rayleigh: 1.4, rainChance: 0.15 }
};

export class Arena {
  constructor(renderer, scene, map, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.map = map;
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'arena';
    scene.add(this.root);
    this.time = 0;
    this.animated = []; // { update(dt, t, camera) }
    const rng = mulberry32(map.seed ^ 0xa5a5);
    this.rng = rng;
    T.setTextureSize(quality.textureSize >= 2048 ? 1024 : quality.textureSize >= 1024 ? 512 : 256);

    this.buildAtmosphere(rng);
    this.buildTerrain();
    this.buildBoxes(rng);
    this.buildWater();
    buildProps(this, rng);
  }

  // ---------- sky, sun, fog, weather ----------
  buildAtmosphere(rng) {
    const a = ATMOS[this.map.biome] || ATMOS.savanna;
    this.atmos = a;
    // 07:30 to 17:30, then sun elevation from the hour.
    this.hour = 7.5 + rng() * 10;
    const elev = Math.max(8, Math.sin(((this.hour - 6) / 12) * Math.PI) * 68);
    const azim = this.hour < 12 ? 95 : 265;
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = a.turbidity;
    u.rayleigh.value = a.rayleigh;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
    this.sky = sky;

    // Image-based lighting from the same sky.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(4000);
    skyClone.material.uniforms.sunPosition.value.copy(this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) skyClone.material.uniforms[k].value = u[k].value;
    envScene.add(skyClone);
    this.envRT = pmrem.fromScene(envScene, 0, 1, 5000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    const low = elev < 25;
    const sunCol = low ? '#ffc58a' : '#fff2dc';
    this.sun = new THREE.DirectionalLight(sunCol, low ? 2.4 : 3.1);
    this.sun.castShadow = this.quality.shadows;
    const s = this.sun.shadow;
    s.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    s.camera.left = s.camera.bottom = -70;
    s.camera.right = s.camera.top = 70;
    s.camera.near = 1;
    s.camera.far = 400;
    s.bias = -0.0005;
    s.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#c8dcff', this.map.look.ground, 0.55);
    this.scene.add(this.hemi);

    const haze = new THREE.Color(this.map.look.haze);
    if (low) haze.lerp(new THREE.Color('#e0a070'), 0.3);
    this.scene.fog = new THREE.FogExp2(haze, a.fog);
    this.raining = rng() < a.rainChance;
    if (this.raining) {
      this.scene.fog.density *= 1.35;
      this.sun.intensity *= 0.55;
      u.turbidity.value = 14;
      this.buildRain();
    }
    if (a.dust) this.buildDust();
  }

  buildRain() {
    const n = this.quality.textureSize >= 1024 ? 5000 : 2500;
    const pos = new Float32Array(n * 6);
    const rng = mulberry32(5);
    for (let i = 0; i < n; i++) {
      const x = (rng() - 0.5) * 60;
      const y = rng() * 30;
      const z = (rng() - 0.5) * 60;
      pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#b8c4cc', transparent: true, opacity: 0.35, depthWrite: false }));
    rain.frustumCulled = false;
    this.scene.add(rain);
    this.animated.push({
      update: (dt, t, cam) => {
        const p = geo.attributes.position.array;
        for (let i = 0; i < n; i++) {
          const k = i * 6;
          p[k + 1] -= 28 * dt;
          p[k + 4] -= 28 * dt;
          if (p[k + 1] < 0) {
            p[k + 1] += 30;
            p[k + 4] += 30;
          }
        }
        geo.attributes.position.needsUpdate = true;
        rain.position.set(cam.position.x, 0, cam.position.z);
        rain.visible = cam.position.y > -0.6; // no rain in the tunnel
      }
    });
  }

  buildDust() {
    // Harmattan dust motes drifting in the light.
    const n = 600;
    const pos = new Float32Array(n * 3);
    const rng = mulberry32(6);
    for (let i = 0; i < n; i++) pos.set([(rng() - 0.5) * 50, rng() * 8, (rng() - 0.5) * 50], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#f0d9a8', size: 0.05, transparent: true, opacity: 0.6, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.animated.push({
      update: (dt, t, cam) => {
        pts.visible = cam.position.y > -0.6;
        pts.position.set(cam.position.x + Math.sin(t * 0.1) * 3, 0, cam.position.z + t * 0.4 - Math.floor((t * 0.4) / 50) * 50 - 25);
      }
    });
  }

  // ---------- terrain ----------
  buildTerrain() {
    const map = this.map;
    const tex = T.groundTexture(map.biome);
    const n = mulberry32(map.seed);
    // Cheap value noise for colour variation.
    const grid = new Float32Array(64 * 64);
    for (let i = 0; i < grid.length; i++) grid[i] = n();
    const noise = (x, z) => {
      const gx = ((x / 18) % 64 + 64) % 64;
      const gz = ((z / 18) % 64 + 64) % 64;
      const x0 = Math.floor(gx);
      const z0 = Math.floor(gz);
      const fx = gx - x0;
      const fz = gz - z0;
      const g = (a, b) => grid[(b % 64) * 64 + (a % 64)];
      return (g(x0, z0) * (1 - fx) + g(x0 + 1, z0) * fx) * (1 - fz) + (g(x0, z0 + 1) * (1 - fx) + g(x0 + 1, z0 + 1) * fx) * fz;
    };
    const green = map.look.grass;
    const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, vertexColors: true });
    // Blend a second surface in natural patches and add large-scale tone variation,
    // so the ground never looks like one repeated tile.
    const patchTex = T.groundPatchTexture(map.biome).map;
    const mask = T.maskTexture();
    // Stairwells going underground are cut out of the ground.
    const opens = (map.openings || []).slice(0, 4).map((o) => new THREE.Vector4(o.x0, o.z0, o.x1, o.z1));
    while (opens.length < 4) opens.push(new THREE.Vector4(1e5, 1e5, 1e5, 1e5));
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPatch = { value: patchTex };
      sh.uniforms.uMask = { value: mask };
      sh.uniforms.uOpen = { value: opens };
      sh.fragmentShader = 'uniform sampler2D uPatch;\nuniform sampler2D uMask;\nuniform vec4 uOpen[4];\n' + sh.fragmentShader.replace(
        '#include <map_fragment>',
        `{
          vec2 wp = vMapUv * 9.0;
          for (int k = 0; k < 4; k++) {
            vec4 o = uOpen[k];
            if (wp.x > o.x && wp.x < o.z && wp.y > o.y && wp.y < o.w) discard;
          }
        }
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 patchCol = texture2D( uPatch, vMapUv * 1.31 + 0.17 ).rgb;
          float m = texture2D( uMask, vMapUv * 0.043 ).r;
          float m2 = texture2D( uMask, vMapUv * 0.009 + 0.37 ).r;
          float blend = smoothstep( 0.46, 0.62, m );
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, patchCol, blend );
          sampledDiffuseColor.rgb *= 0.82 + m2 * 0.36;
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
    };
    // A fine grid over the battlefield and a coarse one for the land beyond the wall.
    const patch = (size, segs, drop) => {
      const geo = new THREE.PlaneGeometry(size, size, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        uv.setXY(i, x / 9, z / 9);
        let y = 0;
        const d = Math.max(Math.abs(x), Math.abs(z)) - map.half;
        // Gentle rolling land beyond the perimeter wall.
        if (d > 0) y = Math.max(0, d - 4) * 0.04 * (noise(x * 0.4, z * 0.4) + 0.4) * 8;
        // River and lake beds.
        for (const w of map.water) {
          const dx = Math.max(w.x0 - x, 0, x - w.x1);
          const dz = Math.max(w.z0 - z, 0, z - w.z1);
          const dd = Math.hypot(dx, dz);
          if (dd < 1.5) y = Math.min(y, -0.95 * (1 - dd / 1.5));
        }
        pos.setY(i, y - drop);
        const v = noise(x, z);
        const v2 = noise(x * 3.1 + 40, z * 3.1);
        // Grass tint mixes towards green in wet biomes, toward sun-baked in dry ones.
        const g = Math.max(0, (v - 0.45) * 2) * green;
        const shade = 0.82 + v2 * 0.3;
        col[i * 3] = shade * (1 - g * 0.45);
        col[i * 3 + 1] = shade * (1 + g * 0.12);
        col[i * 3 + 2] = shade * (1 - g * 0.5);
        if (y < -0.1) {
          col[i * 3] *= 0.55;
          col[i * 3 + 1] *= 0.55;
          col[i * 3 + 2] *= 0.5;
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      return mesh;
    };
    const inner = (map.half + 10) * 2;
    this.ground = patch(inner, Math.round(inner / 1.25), 0);
    patch(700, 120, 0.04);
  }

  // ---------- every collision box, merged per material ----------
  buildBoxes(rng) {
    const map = this.map;
    const B = new BoxBuilder();
    const mats = {
      concrete: surfaceMat(T.concreteTexture()),
      facade: surfaceMat(T.facadeTexture(), { roughness: 0.4, metalness: 0.2, emissive: '#2a2216', emissiveIntensity: 0.0 }),
      sandbag: surfaceMat(T.sandbagTexture()),
      crate: surfaceMat(T.crateTexture(), { roughness: 0.85 }),
      mud: surfaceMat(T.mudTexture()),
      plaster: surfaceMat(T.plasterTexture()),
      plank: surfaceMat(T.plankTexture()),
      stone: surfaceMat(T.stoneTexture()),
      zinc: surfaceMat(T.zincTexture(), { roughness: 0.55, metalness: 0.55 }),
      metal: surfaceMat(T.metalTexture(), { roughness: 0.6, metalness: 0.5 }),
      container: surfaceMat(T.containerTexture(), { roughness: 0.6, metalness: 0.35 }),
      rust: surfaceMat(T.rustTexture(), { roughness: 0.8, metalness: 0.4 }),
      perimeter: surfaceMat(T.concreteTexture())
    };
    this.materials = mats;
    const tintFor = (b) => {
      // Stable per-box colour from its coordinates.
      const h = Math.abs(Math.sin(b.x0 * 12.9898 + b.z0 * 78.233) * 43758.5453) % 1;
      return h;
    };
    // Each plaster building keeps one colour: key it off the roof slab nearest.
    const plasterTint = (b) => {
      const cx = Math.round((b.x0 + b.x1) / 16);
      const cz = Math.round((b.z0 + b.z1) / 16);
      const h = Math.abs(Math.sin(cx * 3.1 + cz * 7.7) * 9871.3) % 1;
      return rgb(PLASTER_TINTS[Math.floor(h * PLASTER_TINTS.length)]);
    };
    const houseB = new Map();
    const houseBuilder = (b) => {
      if (!houseB.has(b.house)) houseB.set(b.house, { walls: new BoxBuilder(), roof: new BoxBuilder() });
      const hb = houseB.get(b.house);
      return b.roof ? hb.roof : hb.walls;
    };
    for (const b of map.boxes) {
      if (b.hidden) continue;
      const k = b.kind;
      // Houses that can burn get their own meshes (walls, roof) so each can char on its own.
      const HB = b.house !== undefined ? houseBuilder(b) : B;
      if (b.prop === 'drum' || b.prop === 'wreck' || k === 'adwall' || k === 'vehicle' || b.headstone || b.tomb || b.cave) continue; // custom meshes
      if (k === 'tunnel') {
        // Tunnel ceilings sit just under the ground surface so they never flicker through it.
        HB.add('stone', b.ceil ? { ...b, y1: -0.05 } : b, 2.5, b.floor ? [0.42, 0.4, 0.38] : [0.55, 0.52, 0.48]);
        continue;
      }
      if (k === 'stairs') {
        HB.add('stone', b, 1.2, [0.7, 0.67, 0.62]);
        continue;
      }
      if (k === 'perimeter') HB.add('perimeter', b, 4, [0.85, 0.84, 0.8]);
      else if (k === 'concrete') HB.add(b.tower ? 'facade' : 'concrete', b, b.tower ? 12 : 3, b.tower ? [1, 1, 1] : [0.95, 0.94, 0.92]);
      else if (k === 'sandbag') HB.add('sandbag', b, 1.8);
      else if (k === 'crate') HB.add('crate', b, 'fit', b.prop === 'logs' ? [0.8, 0.7, 0.6] : [1, 1, 1]);
      else if (k === 'mud' || k === 'mudthick') HB.add('mud', b, 3, k === 'mudthick' ? [1.05, 0.92, 0.85] : [1, 1, 1]);
      else if (k === 'plaster') HB.add('plaster', b, 3, b.roof ? [0.8, 0.8, 0.78] : plasterTint(b));
      else if (k === 'plank' || k === 'bridge' || k === 'stall') HB.add('plank', b, 2.5, k === 'stall' ? [1.1, 0.95, 0.8] : [1, 1, 1]);
      else if (k === 'stone') HB.add('stone', b, 3);
      else if (k === 'zinc') HB.add('zinc', b, 3);
      else if (k === 'container') HB.add('container', b, 2.5, rgb(CONTAINER_TINTS[Math.floor(tintFor(b) * CONTAINER_TINTS.length)]));
      else if (k === 'metal' || k === 'pipe' || k === 'tank') HB.add('metal', b, 2);
      else if (k === 'ruin') HB.add(this.map.biome === 'sahel' ? 'mud' : 'concrete', b, 3, [0.5, 0.46, 0.41]);
      else if (k === 'rubble') HB.add('concrete', b, 1.5, [0.55, 0.52, 0.48]);
      else if (k === 'warehouse') HB.add('zinc', b, 3, [0.72, 0.78, 0.82]);
      else if (k === 'wagon') {
        if (b.style === 'tanker' || b.style === 'loco') continue; // drawn as proper shapes
        HB.add('rust', b, 3, b.style === 'flat' ? [0.7, 0.62, 0.55] : [0.95, 0.75, 0.6]);
      }
      else HB.add('concrete', b, 3);
    }
    B.build(mats, this.root);
    this.houseParts = [];
    for (const [hi, hb] of houseB) {
      const walls = new THREE.Group();
      const roof = new THREE.Group();
      hb.walls.build(mats, walls);
      hb.roof.build(mats, roof);
      this.root.add(walls, roof);
      this.houseParts[hi] = { walls, roof, props: this.houseParts[hi]?.props || [] };
    }

    // Burnt-out cars and oil drums get proper shapes.
    const wrecks = map.boxes.filter((b) => b.prop === 'wreck');
    const drums = map.boxes.filter((b) => b.prop === 'drum');
    this.buildWrecks(wrecks, mats.rust);
    this.buildDrums(drums);
  }

  // Abandoned and burnt-out vehicles used as cover: every one different (saloon, jeep, Hilux,
  // or danfo; burnt black, rusted through or faded and stripped).
  buildWrecks(list, rust) {
    if (!list.length) return;
    const types = ['sedan', 'suv', 'pickup', 'sedan', 'danfo', 'suv', 'sedan', 'pickup'];
    const faded = ['#7d7a70', '#6b5a48', '#8a8f86', '#5d6b74', '#9a8a6a', '#6a4a40', '#40484c'];
    list.forEach((b) => {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const h = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(cx * 3.17 + cz * 9.71) * 9631.7) % 1;
      const type = types[Math.floor(h * types.length)];
      const def = VEHICLES[type];
      const along = b.x1 - b.x0 > b.z1 - b.z0;
      const L = along ? b.x1 - b.x0 : b.z1 - b.z0;
      const g = buildVehicle(type, faded[Math.floor(h2 * faded.length)]);
      const s = L / def.L;
      g.scale.set(s, Math.min(1, ((b.y1 - b.y0) / def.H) * 1.12), s);
      if (h2 < 0.42) {
        charVehicle(g, this.charMat ||= charMaterial());
        g.position.y = -0.2;
      } else weatherVehicle(g, h2 < 0.7 ? (this.wreckRust ||= Object.assign(rust.clone(), { vertexColors: false })) : null, h2);
      for (const m of g.userData.wheelMerged) m.scale.y = 0.9; // flat tyres, sitting low
      g.position.set(cx, g.position.y, cz);
      g.rotation.set((h - 0.5) * 0.06, (along ? Math.PI / 2 : 0) + (h2 > 0.5 ? Math.PI : 0) + (h - 0.5) * 0.1, (h2 - 0.5) * 0.08);
      g.traverse((o) => o.isMesh && (o.matrixAutoUpdate = false, o.updateMatrix()));
      this.root.add(g);
    });
  }

  // Fuel drums (red, explode when shot) and plastic water drums (blue, harmless).
  buildDrums(list) {
    this.drumSlots = new Map(); // drum index -> { mesh, slot, matrix }
    if (!list.length) return;
    const geo = new THREE.CylinderGeometry(0.33, 0.33, 0.92, 22, 1);
    geo.translate(0, 0.46, 0);
    const lid = new THREE.CylinderGeometry(0.31, 0.33, 0.02, 22);
    const fuel = T.fuelDrumTexture();
    const water = T.waterDrumTexture();
    const kinds = [
      { list: list.filter((b) => b.fuel), mat: new THREE.MeshStandardMaterial({ map: fuel.map, normalMap: fuel.normalMap, roughness: 0.5, metalness: 0.55 }) },
      { list: list.filter((b) => !b.fuel), mat: new THREE.MeshStandardMaterial({ map: water.map, normalMap: water.normalMap, roughness: 0.38, metalness: 0 }) }
    ];
    for (const k of kinds) {
      if (!k.list.length) continue;
      const im = new THREE.InstancedMesh(geo, k.mat, k.list.length);
      const caps = new THREE.InstancedMesh(lid, k.mat, k.list.length);
      k.list.forEach((b, i) => {
        const m = new THREE.Matrix4().makeRotationY(b.x0 * 3);
        m.setPosition((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
        im.setMatrixAt(i, m);
        caps.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.93, 0)));
        this.drumSlots.set(b.drum, { im, caps, slot: i, m, cm: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.93, 0)), b });
      });
      im.castShadow = im.receiveShadow = caps.castShadow = true;
      this.root.add(im, caps);
    }
  }

  // A drum blew up: hide it and sink its collision box, exactly like the server.
  killDrum(i) {
    const d = this.drumSlots?.get(i);
    if (!d || d.dead) return;
    d.dead = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    d.im.setMatrixAt(d.slot, zero);
    d.caps.setMatrixAt(d.slot, zero);
    d.im.instanceMatrix.needsUpdate = d.caps.instanceMatrix.needsUpdate = true;
    d.b.oy0 = d.b.y0;
    d.b.oy1 = d.b.y1;
    d.b.y0 = -3;
    d.b.y1 = -2.5;
  }

  restoreDrums() {
    for (const d of this.drumSlots?.values() || []) {
      if (!d.dead) continue;
      d.dead = false;
      d.im.setMatrixAt(d.slot, d.m);
      d.caps.setMatrixAt(d.slot, d.cm);
      d.im.instanceMatrix.needsUpdate = d.caps.instanceMatrix.needsUpdate = true;
      d.b.y0 = d.b.oy0;
      d.b.y1 = d.b.oy1;
    }
  }

  // ---------- rivers, creeks, lakes ----------
  buildWater() {
    if (!this.map.water.length) return;
    const nrm = T.waterNormal();
    const mats = [];
    for (const w of this.map.water) {
      const geo = new THREE.PlaneGeometry(w.x1 - w.x0 + 2, w.z1 - w.z0 + (w.z1 - w.z0 > 200 ? 30 : 2));
      geo.rotateX(-Math.PI / 2);
      const t = nrm.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set((w.x1 - w.x0) / 6, (w.z1 - w.z0) / 6);
      t.needsUpdate = true;
      const mat = new THREE.MeshPhysicalMaterial({
        color: this.map.biome === 'creeks' ? '#2f3a2a' : this.map.biome === 'urban' ? '#2a3d44' : '#31464a',
        roughness: 0.06,
        metalness: 0.0,
        normalMap: t,
        normalScale: new THREE.Vector2(0.35, 0.35),
        transparent: true,
        opacity: 0.9,
        envMapIntensity: 1.2
      });
      mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((w.x0 + w.x1) / 2, -0.18, (w.z0 + w.z1) / 2);
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    this.animated.push({
      update: (dt, t) => {
        for (const m of mats) {
          m.normalMap.offset.set(t * 0.012, t * 0.03);
        }
      }
    });
  }

  // ---------- queries used by the game ----------
  inWater(x, z) {
    return inWater(this.map, x, z);
  }

  // Surface under a fighter's feet (for footstep sounds and dust puffs).
  surfaceAt(x, y, z) {
    if (y < 0.1 && this.inWater(x, z)) return 'water';
    if (y > 0.05) {
      const list = query(this.map.index, x - 0.2, z - 0.2, x + 0.2, z + 0.2);
      for (const i of list) {
        const b = this.map.index.boxes[i];
        if (Math.abs(b.y1 - y) < 0.12 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
          if (['plank', 'bridge', 'crate', 'stall'].includes(b.kind)) return 'wood';
          if (['metal', 'zinc', 'container', 'tank', 'pipe', 'wreck', 'drum'].includes(b.kind)) return 'metal';
          if (b.kind === 'sandbag') return 'sand';
          return 'concrete';
        }
      }
    }
    return { sahel: 'sand', savanna: 'dirt', plateau: 'gravel', rainforest: 'dirt', creeks: 'mud', urban: 'concrete' }[this.map.biome];
  }

  update(dt, camera) {
    this.time += dt;
    // Keep the sun's shadow box centred on the player.
    const c = camera.position;
    const snap = 4;
    const sx = Math.round(c.x / snap) * snap;
    const sz = Math.round(c.z / snap) * snap;
    this.sun.position.set(sx + this.sunDir.x * 150, this.sunDir.y * 150, sz + this.sunDir.z * 150);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
    for (const a of this.animated) a.update(dt, this.time, camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });
    this.envRT?.dispose();
  }
}
