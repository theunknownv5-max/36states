// Deterministic battlefield generator. The same state always produces the same map,
// so the server (hits, bots, gems) and every client (rendering, movement) agree.
import { mulberry32, range, pick } from './rng.js';
import { STATE_BY_ID, RESOURCES, BIOMES, stateSeed } from './states.js';
import { buildIndex } from './physics.js';
import { MATCH, DRUMS } from './config.js';

export const HALF = 110; // map runs from -110 to 110 metres on x and z
const NAV_CELL = 2;

const BIOME_RULES = {
  sahel: { buildings: 16, wall: 'mud', roof: 'flat', trees: 30, treeTypes: ['acacia', 'baobab', 'neem'], rocks: 8, grass: 80, cover: 70 },
  savanna: { buildings: 16, wall: 'mud', roof: 'zinc', trees: 70, treeTypes: ['shea', 'acacia', 'baobab', 'mango'], rocks: 14, grass: 420, cover: 70 },
  plateau: { buildings: 11, wall: 'stone', roof: 'zinc', trees: 40, treeTypes: ['eucalyptus', 'shea'], rocks: 60, grass: 380, cover: 60 },
  rainforest: { buildings: 15, wall: 'plaster', roof: 'zinc', trees: 150, treeTypes: ['palm', 'iroko', 'mango', 'plantain'], rocks: 6, grass: 520, cover: 65 },
  creeks: { buildings: 13, wall: 'plank', roof: 'zinc', trees: 95, treeTypes: ['palm', 'mangrove', 'plantain'], rocks: 2, grass: 420, cover: 60 },
  urban: { buildings: 24, wall: 'plaster', roof: 'flat', trees: 30, treeTypes: ['palm', 'almond'], rocks: 0, grass: 60, cover: 85 }
};

const PEN_KINDS = new Set(['mud', 'plaster', 'plank', 'zinc', 'crate', 'drum', 'stall', 'wreck']);

export function generateMap(stateId) {
  const state = STATE_BY_ID[stateId];
  if (!state) throw new Error(`Unknown state ${stateId}`);
  // Retry with a nudged seed in the rare case the layout blocks a route.
  for (let attempt = 0; attempt < 8; attempt++) {
    const map = tryGenerate(state, stateSeed(state.id) + attempt * 7919);
    if (map.connected) return map;
  }
  return tryGenerate(state, stateSeed(state.id));
}

function tryGenerate(state, seed) {
  const rng = mulberry32(seed);
  const rules = BIOME_RULES[state.biome];
  const boxes = [];
  const visuals = [];
  const water = [];
  const adWalls = [];
  const G = HALF; // shorthand

  // Occupancy grid (2 m) used only during placement.
  const occ = new Uint8Array((HALF * 2 / 2) ** 2);
  const occN = (HALF * 2) / 2;
  const cellOf = (v) => Math.floor((v + HALF) / 2);
  const reserve = (x0, z0, x1, z1, margin = 0) => {
    for (let cx = cellOf(x0 - margin); cx <= cellOf(x1 + margin); cx++)
      for (let cz = cellOf(z0 - margin); cz <= cellOf(z1 + margin); cz++) if (cx >= 0 && cz >= 0 && cx < occN && cz < occN) occ[cz * occN + cx] = 1;
  };
  const free = (x0, z0, x1, z1, margin = 2) => {
    if (x0 - margin < -G + 3 || x1 + margin > G - 3 || z0 - margin < -G + 3 || z1 + margin > G - 3) return false;
    for (let cx = cellOf(x0 - margin); cx <= cellOf(x1 + margin); cx++)
      for (let cz = cellOf(z0 - margin); cz <= cellOf(z1 + margin); cz++) if (occ[cz * occN + cx]) return false;
    return true;
  };
  const box = (x0, y0, z0, x1, y1, z1, kind, extra = {}) => {
    const b = { x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), kind, pen: PEN_KINDS.has(kind), ...extra };
    boxes.push(b);
    return b;
  };

  // ---------- perimeter ----------
  const PH = state.biome === 'urban' ? 14 : 5;
  box(-G, 0, -G - 1, G, PH, -G + 0.5, 'perimeter');
  box(-G, 0, G - 0.5, G, PH, G + 1, 'perimeter');
  box(-G - 1, 0, -G, -G + 0.5, PH, G, 'perimeter');
  box(G - 0.5, 0, -G, G + 1, PH, G, 'perimeter');

  // ---------- bases ----------
  const bases = {};
  for (const [side, bx] of [
    ['sec', -92],
    ['out', 92]
  ]) {
    const dir = side === 'sec' ? 1 : -1; // toward the centre
    reserve(bx - 12, -24, bx + 12, 24, 1);
    const spawns = [];
    for (let i = 0; i < 10; i++) spawns.push({ x: bx - dir * 4 + (i % 2) * dir * 4, z: -16 + Math.floor(i / 2) * 8, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 });
    // Sandbag front line with two gaps, a bunker and supply crates.
    const fx = bx + dir * 9;
    box(fx - 0.6, 0, -22, fx + 0.6, 1.1, -9, 'sandbag');
    box(fx - 0.6, 0, -5, fx + 0.6, 1.1, 5, 'sandbag');
    box(fx - 0.6, 0, 9, fx + 0.6, 1.1, 22, 'sandbag');
    box(bx - dir * 9 - 3, 0, -6, bx - dir * 9 + 3, 2.8, 6, 'concrete', { bunker: true });
    box(bx - 1, 0, 18, bx + 1.2, 1.4, 20.2, 'crate');
    box(bx - 1, 0, -20.2, bx + 1.2, 1.4, -18, 'crate');
    visuals.push({ type: 'flag', x: bx - dir * 2, z: 0, side });
    bases[side] = { x: bx, z: 0, spawns, dir };
  }

  // ---------- resource sites (A, B, C) ----------
  const sitePos = [
    [-30 + range(rng, -6, 6), -58 + range(rng, -8, 8)],
    [range(rng, -8, 8), range(rng, -10, 10)],
    [30 + range(rng, -6, 6), 58 + range(rng, -8, 8)]
  ];
  if (rng() < 0.5) {
    // Mirror sometimes so A is not always north.
    for (const p of sitePos) p[1] = -p[1];
  }
  const sites = state.resources.map((res, i) => {
    const [x, z] = sitePos[i];
    const def = RESOURCES[res];
    reserve(x - 11, z - 11, x + 11, z + 11);
    siteProps(def.prop, x, z, rng, box, visuals);
    return { id: 'ABC'[i], resource: res, label: def.site, x, z, r: MATCH.siteRadius };
  });

  // ---------- landmark ----------
  const lmSide = rng() < 0.5 ? -1 : 1;
  const lm = { ...state.landmark, x: range(rng, -10, 10), z: lmSide * range(rng, 62, 72) };
  // Keep the landmark clear of sites.
  for (const s of sites) if (Math.hypot(s.x - lm.x, s.z - lm.z) < 30) lm.x += lm.x < s.x ? -14 : 14;
  buildLandmark(lm, rng, box, visuals, water);
  reserve(lm.x - 14, lm.z - 12, lm.x + 14, lm.z + 12);

  // ---------- water channels (creeks and Lagos lagoon canal) ----------
  if (state.biome === 'creeks' || state.biome === 'urban') {
    const channels = state.biome === 'creeks' ? [-48 + range(rng, -4, 4), 46 + range(rng, -4, 4)] : [range(rng, -40, -30)];
    for (const cx of channels) {
      const w = state.biome === 'creeks' ? 8 : 10;
      water.push({ x0: cx - w / 2, z0: -G, x1: cx + w / 2, z1: G, depth: 0.7 });
      // Plank bridges across.
      for (const bz of [-60, 0, 60]) {
        const z = bz + range(rng, -10, 10);
        box(cx - w / 2 - 1, 0, z - 1.4, cx + w / 2 + 1, 0.25, z + 1.4, 'bridge', { walkway: true });
      }
      reserve(cx - w / 2, -G, cx + w / 2, G);
    }
  }

  // ---------- advert walls (each carries a life gem) ----------
  const adCandidates = [
    [-62, -26],
    [-62, 26],
    [-38, 4],
    [-16, -34],
    [-14, 36],
    [16, -36],
    [14, 34],
    [38, -4],
    [62, -26],
    [62, 26],
    [-34, -86],
    [34, 86],
    [-34, 86],
    [34, -86]
  ];
  for (const [ax, az] of adCandidates) {
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const x = ax + range(rng, -7, 7);
      const z = az + range(rng, -7, 7);
      // Face the nearest base so fighters advancing see it, alternating axis for variety.
      const alongX = Math.abs(z) > 70 || rng() < 0.6;
      const w = 6.4;
      const t = 0.5;
      const hw = alongX ? t / 2 : w / 2;
      const hd = alongX ? w / 2 : t / 2;
      if (!free(x - hw, z - hd, x + hw, z + hd, 3)) continue;
      reserve(x - hw, z - hd, x + hw, z + hd, 1.5);
      let nx = 0;
      let nz = 0;
      if (alongX) nx = x > 0 ? 1 : -1; // panel faces away from the centre line toward the nearer base... and its attackers
      else nz = z > 0 ? -1 : 1;
      if (alongX && Math.abs(x) < 20) nx = rng() < 0.5 ? 1 : -1;
      const b = box(x - hw, 0, z - hd, x + hw, 3.4, z + hd, 'adwall');
      const id = `${state.id}:${adWalls.length}`;
      b.ad = id;
      adWalls.push({
        id,
        x,
        z,
        nx,
        nz,
        w,
        h: 3.0,
        y: 1.9,
        face: { x: x + nx * (t / 2 + 0.02), z: z + nz * (t / 2 + 0.02) },
        gem: { x: x + nx * 1.5, y: 1.15, z: z + nz * 1.5 }
      });
      placed = true;
    }
  }

  // ---------- buildings ----------
  const buildings = [];
  for (let n = 0, tries = 0; n < rules.buildings && tries < 400; tries++) {
    const w = range(rng, 7, state.biome === 'urban' ? 14 : 12);
    const d = range(rng, 6, 11);
    const x = range(rng, -G + 22, G - 22);
    const z = range(rng, -G + 8, G - 8);
    if (Math.abs(x) > 74 && Math.abs(z) < 30) continue; // keep base approaches open
    if (!free(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 3)) continue;
    reserve(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1.5);
    const solid = state.biome === 'urban' && rng() < 0.4;
    const height = solid ? range(rng, 8, 18) : rules.wall === 'mud' ? 2.7 : 3.1;
    buildings.push(makeBuilding(x, z, w, d, height, solid, rules, rng, box, visuals));
    n++;
  }

  // ---------- cover ----------
  const coverKinds = state.biome === 'urban' || state.biome === 'creeks' ? ['crate', 'sandbag', 'drum', 'wreck', 'container', 'barrier', 'stall'] : ['crate', 'sandbag', 'drum', 'wreck', 'stall', 'barrier'];
  for (let n = 0, tries = 0; n < rules.cover && tries < 800; tries++) {
    const kind = pick(rng, coverKinds);
    const x = range(rng, -G + 8, G - 8);
    const z = range(rng, -G + 8, G - 8);
    const rot = rng() < 0.5;
    const dims = { crate: [1.3, 1.3, 1.3], sandbag: [3.2, 1.05, 0.9], drum: [0.7, 0.95, 0.7], wreck: [4.3, 1.45, 1.85], container: [6.1, 2.6, 2.45], barrier: [3, 1.0, 0.6], stall: [3, 0.95, 1.6] }[kind];
    const hw = (rot ? dims[2] : dims[0]) / 2;
    const hd = (rot ? dims[0] : dims[2]) / 2;
    if (!free(x - hw, z - hd, x + hw, z + hd, 1.5)) continue;
    reserve(x - hw, z - hd, x + hw, z + hd, 1);
    const k = kind === 'barrier' ? 'concrete' : kind;
    box(x - hw, 0, z - hd, x + hw, dims[1], z + hd, k, { prop: kind, rot });
    if (kind === 'crate' && rng() < 0.35) box(x - hw * 0.8, dims[1], z - hd * 0.8, x + hw * 0.8, dims[1] * 1.85, z + hd * 0.8, 'crate', { prop: 'crate' });
    if (kind === 'stall') visuals.push({ type: 'stallRoof', x, z, rot, w: dims[0], d: dims[2] });
    if (kind === 'drum') {
      for (const [ox, oz] of [
        [0.8, 0],
        [0, 0.8]
      ])
        if (rng() < 0.5) box(x + ox - hw, 0, z + oz - hd, x + ox + hw, dims[1], z + oz + hd, 'drum', { prop: 'drum' });
    }
    n++;
  }

  // ---------- trees, rocks, grass ----------
  const trees = [];
  for (let n = 0, tries = 0; n < rules.trees && tries < 1500; tries++) {
    const x = range(rng, -G + 4, G - 4);
    const z = range(rng, -G + 4, G - 4);
    if (!free(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 1.2)) continue;
    if (water.some((w) => x > w.x0 - 1 && x < w.x1 + 1 && z > w.z0 && z < w.z1) && rules.treeTypes[0] !== 'palm') continue;
    reserve(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0.5);
    const type = pick(rng, rules.treeTypes);
    const s = range(rng, 0.8, 1.3);
    const tr = type === 'baobab' ? 0.9 * s : 0.28 * s;
    box(x - tr, 0, z - tr, x + tr, 5 * s, z + tr, 'trunk', { hidden: true, pen: false });
    trees.push({ x, z, type, s, rot: rng() * Math.PI * 2 });
    n++;
  }
  const rocks = [];
  for (let n = 0, tries = 0; n < rules.rocks && tries < 600; tries++) {
    const r = range(rng, 1.2, state.biome === 'plateau' ? 4.5 : 2.5);
    const x = range(rng, -G + 8, G - 8);
    const z = range(rng, -G + 8, G - 8);
    if (!free(x - r, z - r, x + r, z + r, 1.5)) continue;
    reserve(x - r, z - r, x + r, z + r, 1);
    const h = r * range(rng, 0.8, 1.6);
    // Collider is the box inscribed in the boulder.
    box(x - r * 0.72, 0, z - r * 0.72, x + r * 0.72, h * 0.9, z + r * 0.72, 'rock', { hidden: true, pen: false });
    rocks.push({ x, z, r, h, rot: rng() * Math.PI * 2 });
    n++;
  }
  const grass = [];
  for (let n = 0; n < rules.grass; n++) {
    const x = range(rng, -G + 2, G - 2);
    const z = range(rng, -G + 2, G - 2);
    if (occ[cellOf(z) * occN + cellOf(x)] && rng() < 0.7) continue;
    grass.push({ x, z, s: range(rng, 0.6, 1.4), rot: rng() * 6.28 });
  }

  // ---------- discovery spots (new deposits found mid-match) ----------
  const discoverySpots = [];
  for (let tries = 0; tries < 200 && discoverySpots.length < 4; tries++) {
    const x = range(rng, -60, 60);
    const z = range(rng, -80, 80);
    if (!free(x - 5, z - 5, x + 5, z + 5, 1)) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 28)) continue;
    reserve(x - 5, z - 5, x + 5, z + 5);
    discoverySpots.push({ x, z });
  }

  // Which drums hold fuel (explosive) and which hold water. Hash of position, so it
  // never shifts the random sequence the rest of the map depends on.
  const drums = [];
  boxes.forEach((b, i) => {
    if (b.prop !== 'drum') return;
    const h = Math.abs(Math.sin(b.x0 * 12.9898 + b.z0 * 78.233) * 43758.5453) % 1;
    b.fuel = h < DRUMS.fuelShare;
    b.drum = drums.length;
    drums.push(i);
  });

  // ---------- paid billboards: skyline towers outside the walls and LED road screens ----------
  // Own random stream, placed last, so the rest of the layout never shifts.
  const brng = mulberry32(seed ^ 0xb1b0);
  const billboards = [];
  const urbanSky = state.biome === 'urban' || state.biome === 'creeks';
  [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ].forEach(([sx, sz], i) => {
    const along = range(brng, -45, 45);
    const dist = 124 + range(brng, 0, 8);
    const x = sx ? sx * dist : along;
    const z = sz ? sz * dist : along;
    const tower = urbanSky || brng() < 0.35;
    const base = tower ? range(brng, 24, 38) : range(brng, 16, 22);
    billboards.push({
      id: `${state.id}:s${i}`,
      type: 'sky',
      x,
      z,
      nx: -sx,
      nz: -sz,
      w: 28,
      h: 15.75,
      y: base + 2.2 + 15.75 / 2,
      tower: tower ? { h: base, w: range(brng, 32, 40), d: range(brng, 16, 22), seed: Math.floor(brng() * 1e6) } : null,
      pole: tower ? 0 : base
    });
  });
  const ledSpots = [
    [-48, 0, -1],
    [48, 0, 1],
    [-30, -40, -1],
    [30, 40, 1],
    [-30, 40, -1],
    [30, -40, 1]
  ];
  for (const [lx, lz, face] of ledSpots) {
    if (billboards.filter((b) => b.type === 'led').length >= 2) break;
    if (billboards.some((b) => b.type === 'led' && Math.sign(b.x) === Math.sign(lx))) continue;
    for (let tries = 0; tries < 25; tries++) {
      const x = lx + range(brng, -10, 10);
      const z = lz + range(brng, -14, 14);
      if (!free(x - 0.5, z - 4.6, x + 0.5, z + 4.6, 1.5)) continue;
      if (water.some((w) => x > w.x0 - 2 && x < w.x1 + 2)) continue;
      reserve(x - 0.5, z - 4.6, x + 0.5, z + 4.6, 1);
      for (const pz of [z - 3, z + 3]) box(x - 0.2, 0, pz - 0.2, x + 0.2, 9.5, pz + 0.2, 'metal', { pen: false, hidden: true });
      const n = billboards.filter((b) => b.type === 'led').length;
      billboards.push({ id: `${state.id}:l${n}`, type: 'led', x, z, nx: face, nz: 0, w: 8, h: 4.5, y: 7.2, twoSided: true });
      break;
    }
  }

  // Ground ad tiles: big flat 16:9 artworks laid into open ground, read best from the
  // drone and rooftops. Purely visual (no collision), never on sites, bases or water.
  for (const [tw, th] of [
    [16, 9],
    [16, 9],
    [12, 6.75]
  ]) {
    const n = billboards.filter((b) => b.type === 'ground').length;
    if (n >= 3) break;
    for (let tries = 0; tries < 120; tries++) {
      // Long side runs north-south and the artwork reads upright for soldiers coming
      // from their own base (top of the image points away from the nearer base).
      const hw = th / 2;
      const hd = tw / 2;
      const x = range(brng, -62, 62);
      const z = range(brng, -82, 82);
      if (!free(x - hw, z - hd, x + hw, z + hd, 1)) continue;
      if (billboards.some((b) => b.type === 'ground' && Math.hypot(b.x - x, b.z - z) < 40)) continue;
      reserve(x - hw, z - hd, x + hw, z + hd, 0.5);
      billboards.push({ id: `${state.id}:g${n}`, type: 'ground', x, z, w: tw, h: th, rot: x < 0 ? -Math.PI / 2 : Math.PI / 2, y: 0.035 });
      break;
    }
  }
  // Keep grass tufts off the tiles so the artwork stays clean.
  const onTile = (x, z) =>
    billboards.some((b) => {
      if (b.type !== 'ground') return false;
      const hw = (b.rot ? b.h : b.w) / 2 + 0.4;
      const hd = (b.rot ? b.w : b.h) / 2 + 0.4;
      return Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd;
    });
  for (let i = grass.length - 1; i >= 0; i--) if (onTile(grass[i].x, grass[i].z)) grass.splice(i, 1);

  const map = {
    billboards,
    drums,
    stateId: state.id,
    state,
    biome: state.biome,
    look: BIOMES[state.biome],
    half: HALF,
    seed,
    boxes,
    visuals,
    water,
    adWalls,
    sites,
    bases,
    landmark: lm,
    buildings,
    trees,
    rocks,
    grass,
    discoverySpots
  };
  map.index = buildIndex(boxes, HALF + 2);
  map.nav = buildNav(map);
  map.connected = checkConnected(map);
  return map;
}

// ---------- props for each kind of resource site ----------
function siteProps(prop, x, z, rng, box, visuals) {
  const at = (dx, dz) => [x + dx, z + dz];
  switch (prop) {
    case 'wellhead': {
      const [px, pz] = at(-5, 3);
      box(px - 0.8, 0, pz - 2.2, px + 0.8, 2.6, pz + 2.2, 'metal', { pen: false });
      visuals.push({ type: 'pumpjack', x: px, z: pz });
      for (const [dx, dz] of [
        [5, -4],
        [5.5, 3.5]
      ]) {
        const [tx, tz] = at(dx, dz);
        box(tx - 1.6, 0, tz - 1.6, tx + 1.6, 4, tz + 1.6, 'tank', { hidden: true, pen: false });
        visuals.push({ type: 'tank', x: tx, z: tz, r: 1.8, h: 4 });
      }
      box(x - 7, 0, z - 6.4, x + 2, 0.55, z - 5.8, 'pipe', { hidden: true });
      visuals.push({ type: 'pipe', x0: x - 7, z0: z - 6.1, x1: x + 2, z1: z - 6.1, y: 0.3, r: 0.3 });
      break;
    }
    case 'tanks': {
      for (const [dx, dz] of [
        [-5, -4],
        [5, -4],
        [-5, 4.5]
      ]) {
        const [tx, tz] = at(dx, dz);
        box(tx - 1.8, 0, tz - 1.8, tx + 1.8, 5, tz + 1.8, 'tank', { hidden: true, pen: false });
        visuals.push({ type: 'tank', x: tx, z: tz, r: 2, h: 5 });
      }
      visuals.push({ type: 'smallFlare', x: x + 6, z: z + 5 });
      box(x + 5.6, 0, z + 4.6, x + 6.4, 9, z + 5.4, 'metal', { hidden: true });
      break;
    }
    case 'mine':
    case 'pit': {
      // Spoil heaps, a headframe or pit rim, ore carts.
      for (const [dx, dz, r] of [
        [-6, -4, 2.6],
        [6, 4.5, 2.2],
        [6, -5, 1.8]
      ]) {
        const [rx, rz] = at(dx, dz);
        box(rx - r * 0.7, 0, rz - r * 0.7, rx + r * 0.7, r * 0.9, rz + r * 0.7, 'rock', { hidden: true, pen: false });
        visuals.push({ type: 'heap', x: rx, z: rz, r, h: r });
      }
      if (prop === 'mine') {
        const [hx, hz] = at(-5, 5);
        box(hx - 1.5, 0, hz - 1.5, hx + 1.5, 1.2, hz + 1.5, 'concrete');
        visuals.push({ type: 'headframe', x: hx, z: hz });
      } else visuals.push({ type: 'pitHole', x: x - 1, z: z + 6, r: 2.4 });
      const [cx, cz] = at(2, -6.5);
      box(cx - 0.9, 0, cz - 0.6, cx + 0.9, 1.1, cz + 0.6, 'metal', { prop: 'cart' });
      break;
    }
    case 'quarry':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const [rx, rz] = at(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
        box(rx - 1.4, 0, rz - 1.4, rx + 1.4, 1.6 + (i % 2), rz + 1.4, 'stone', { prop: 'block' });
      }
      break;
    case 'farm':
    case 'sacks':
    case 'pans':
    case 'ranch':
    case 'logs':
    case 'jetty':
    case 'containers':
    default: {
      // Stacks of produce sacks / logs / containers + a storage shed.
      const kind = prop === 'containers' ? 'container' : prop === 'logs' ? 'logs' : 'sacks';
      for (const [dx, dz] of [
        [-6, -4],
        [6, 4],
        [6, -5],
        [-6, 5]
      ]) {
        const [sx, sz] = at(dx, dz);
        const big = kind === 'container';
        box(sx - (big ? 3 : 1.3), 0, sz - (big ? 1.2 : 1), sx + (big ? 3 : 1.3), big ? 2.6 : 1.2, sz + (big ? 1.2 : 1), kind === 'container' ? 'container' : kind === 'logs' ? 'crate' : 'sandbag', { prop: kind });
      }
      if (prop === 'farm' || prop === 'ranch') visuals.push({ type: 'farmRows', x, z, crop: prop });
      if (prop === 'pans') visuals.push({ type: 'saltPans', x, z });
      if (prop === 'jetty') visuals.push({ type: 'canoes', x, z });
      break;
    }
  }
  visuals.push({ type: 'siteMarker', x, z });
}

// ---------- landmarks ----------
function buildLandmark(lm, rng, box, visuals, water) {
  const { x, z, type } = lm;
  switch (type) {
    case 'rock': {
      // A great granite monolith (Zuma, Olumo, Aso Rock...).
      const w = 20;
      const d = 15;
      const h = 26;
      for (let k = 0; k < 4; k++) {
        const s = 1 - k * 0.2;
        box(x - (w / 2) * s * 0.85, (h / 4) * k, z - (d / 2) * s * 0.85, x + (w / 2) * s * 0.85, (h / 4) * (k + 1), z + (d / 2) * s * 0.85, 'rock', { hidden: true, pen: false });
      }
      visuals.push({ type: 'monolith', x, z, w, d, h });
      break;
    }
    case 'hills':
      for (let i = 0; i < 7; i++) {
        const r = range(rng, 2.5, 5.5);
        const bx = x + range(rng, -10, 10);
        const bz = z + range(rng, -8, 8);
        const h = r * range(rng, 1, 1.8);
        box(bx - r * 0.7, 0, bz - r * 0.7, bx + r * 0.7, h * 0.9, bz + r * 0.7, 'rock', { hidden: true, pen: false });
        visuals.push({ type: 'boulder', x: bx, z: bz, r, h });
      }
      break;
    case 'gate': {
      const w = 26;
      const t = 2.2;
      const h = 7;
      box(x - w / 2, 0, z - t / 2, x - 2.2, h, z + t / 2, 'mudthick', { pen: false });
      box(x + 2.2, 0, z - t / 2, x + w / 2, h, z + t / 2, 'mudthick', { pen: false });
      box(x - 2.2, 4.6, z - t / 2, x + 2.2, h, z + t / 2, 'mudthick', { pen: false });
      for (const sx of [-1, 1]) box(x + sx * 4.4 - 1.6, 0, z - 2, x + sx * 4.4 + 1.6, h + 2, z + 2, 'mudthick', { pen: false, tower: true });
      visuals.push({ type: 'gateArch', x, z, w, h });
      break;
    }
    case 'flare': {
      box(x - 1.3, 0, z - 1.3, x + 1.3, 32, z + 1.3, 'metal', { hidden: true, pen: false });
      visuals.push({ type: 'flareStack', x, z, h: 32 });
      for (const dz of [-6, 6]) {
        box(x - 9, 0, z + dz - 0.3, x + 9, 0.6, z + dz + 0.3, 'pipe', { hidden: true });
        visuals.push({ type: 'pipe', x0: x - 9, z0: z + dz, x1: x + 9, z1: z + dz, y: 0.3, r: 0.3 });
      }
      for (const dx of [-7, 7]) {
        box(x + dx - 1.6, 0, z - 1.6, x + dx + 1.6, 4.5, z + 1.6, 'tank', { hidden: true, pen: false });
        visuals.push({ type: 'tank', x: x + dx, z, r: 1.8, h: 4.5 });
      }
      break;
    }
    case 'tower': {
      box(x - 6, 0, z - 6, x + 6, 44, z + 6, 'concrete', { pen: false, tower: true });
      visuals.push({ type: 'tower', x, z, w: 12, h: 44 });
      break;
    }
    case 'falls': {
      box(x - 13, 0, z - 4, x + 13, 16, z + 4, 'rock', { hidden: true, pen: false });
      visuals.push({ type: 'cliff', x, z, w: 26, d: 8, h: 16 });
      const dir = z > 0 ? -1 : 1;
      water.push({ x0: x - 9, z0: Math.min(z + dir * 4, z + dir * 14), x1: x + 9, z1: Math.max(z + dir * 4, z + dir * 14), depth: 1.0, pool: true });
      visuals.push({ type: 'waterfall', x, z: z + dir * 4.05, dir, w: 7, h: 16 });
      break;
    }
    case 'lake':
      water.push({ x0: x - 14, z0: z - 9, x1: x + 14, z1: z + 9, depth: 1.1, lake: true });
      visuals.push({ type: 'reeds', x, z, w: 28, d: 18 });
      break;
    case 'palace': {
      const w = 22;
      const d = 16;
      const t = 0.8;
      const h = 5;
      box(x - w / 2, 0, z - d / 2, x + w / 2, h, z - d / 2 + t, 'mudthick', { pen: false });
      box(x - w / 2, 0, z + d / 2 - t, x - 2, h, z + d / 2, 'mudthick', { pen: false });
      box(x + 2, 0, z + d / 2 - t, x + w / 2, h, z + d / 2, 'mudthick', { pen: false });
      box(x - w / 2, 0, z - d / 2, x - w / 2 + t, h, z + d / 2, 'mudthick', { pen: false });
      box(x + w / 2 - t, 0, z - d / 2, x + w / 2, h, z + d / 2, 'mudthick', { pen: false });
      box(x - 4, 0, z - 5, x + 4, 7, z + 1, 'mudthick', { pen: false });
      visuals.push({ type: 'palaceTop', x, z, w, d });
      break;
    }
  }
  visuals.push({ type: 'landmarkSign', x, z, name: lm.name });
}

// ---------- buildings ----------
function makeBuilding(x, z, w, d, height, solid, rules, rng, box, visuals) {
  const kind = rules.wall;
  if (solid) {
    box(x - w / 2, 0, z - d / 2, x + w / 2, height, z + d / 2, 'concrete', { pen: false, tower: true });
    visuals.push({ type: 'blockBuilding', x, z, w, d, h: height });
    return { x, z, w, d, h: height, solid: true };
  }
  const t = kind === 'mud' ? 0.35 : 0.25;
  const h = height;
  const doorW = 1.5;
  // Door on a random side, a window gap on another.
  const doorSide = Math.floor(rng() * 4);
  const winSide = (doorSide + 1 + Math.floor(rng() * 3)) % 4;
  const wallsDef = [
    { side: 0, x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z - d / 2 + t, along: 'x' },
    { side: 1, x0: x + w / 2 - t, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, along: 'z' },
    { side: 2, x0: x - w / 2, z0: z + d / 2 - t, x1: x + w / 2, z1: z + d / 2, along: 'x' },
    { side: 3, x0: x - w / 2, z0: z - d / 2, x1: x - w / 2 + t, z1: z + d / 2, along: 'z' }
  ];
  for (const wd of wallsDef) {
    const len = wd.along === 'x' ? wd.x1 - wd.x0 : wd.z1 - wd.z0;
    if (wd.side === doorSide || wd.side === winSide) {
      const gap = wd.side === doorSide ? doorW : 1.2;
      const c = range(rng, -len / 2 + 1.5, len / 2 - 1.5);
      const mid = wd.along === 'x' ? (wd.x0 + wd.x1) / 2 + c : (wd.z0 + wd.z1) / 2 + c;
      if (wd.along === 'x') {
        box(wd.x0, 0, wd.z0, mid - gap / 2, h, wd.z1, kind);
        box(mid + gap / 2, 0, wd.z0, wd.x1, h, wd.z1, kind);
        if (wd.side === doorSide) box(mid - gap / 2, 2.15, wd.z0, mid + gap / 2, h, wd.z1, kind);
        else {
          box(mid - gap / 2, 0, wd.z0, mid + gap / 2, 1.05, wd.z1, kind);
          box(mid - gap / 2, 2.1, wd.z0, mid + gap / 2, h, wd.z1, kind);
        }
      } else {
        box(wd.x0, 0, wd.z0, wd.x1, h, mid - gap / 2, kind);
        box(wd.x0, 0, mid + gap / 2, wd.x1, h, wd.z1, kind);
        if (wd.side === doorSide) box(wd.x0, 2.15, mid - gap / 2, wd.x1, h, mid + gap / 2, kind);
        else {
          box(wd.x0, 0, mid - gap / 2, wd.x1, 1.05, mid + gap / 2, kind);
          box(wd.x0, 2.1, mid - gap / 2, wd.x1, h, mid + gap / 2, kind);
        }
      }
    } else box(wd.x0, 0, wd.z0, wd.x1, h, wd.z1, kind);
  }
  // Roof slab (solid from above, keeps rooms shaded).
  const roofKind = rules.roof === 'zinc' ? 'zinc' : kind;
  box(x - w / 2 - 0.2, h, z - d / 2 - 0.2, x + w / 2 + 0.2, h + 0.12, z + d / 2 + 0.2, roofKind, { roof: true });
  visuals.push({ type: rules.roof === 'zinc' ? 'zincRoof' : 'parapet', x, z, w, d, h, kind });
  return { x, z, w, d, h, solid: false, kind };
}

// ---------- navigation grid for bots ----------
function buildNav(map) {
  const n = (HALF * 2) / NAV_CELL;
  const blocked = new Uint8Array(n * n);
  const slow = new Uint8Array(n * n);
  const pad = 0.35;
  for (const b of map.boxes) {
    if (b.walkway || b.roof) continue;
    if (b.y0 > 1.6 || b.y1 < 0.5) continue;
    const cx0 = Math.max(0, Math.floor((b.x0 - pad + HALF) / NAV_CELL));
    const cx1 = Math.min(n - 1, Math.floor((b.x1 + pad + HALF) / NAV_CELL));
    const cz0 = Math.max(0, Math.floor((b.z0 - pad + HALF) / NAV_CELL));
    const cz1 = Math.min(n - 1, Math.floor((b.z1 + pad + HALF) / NAV_CELL));
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) blocked[cz * n + cx] = 1;
  }
  for (const w of map.water) {
    for (let cx = Math.max(0, Math.floor((w.x0 + HALF) / NAV_CELL)); cx <= Math.min(n - 1, Math.floor((w.x1 + HALF) / NAV_CELL)); cx++)
      for (let cz = Math.max(0, Math.floor((w.z0 + HALF) / NAV_CELL)); cz <= Math.min(n - 1, Math.floor((w.z1 + HALF) / NAV_CELL)); cz++) slow[cz * n + cx] = 1;
  }
  return { n, cell: NAV_CELL, blocked, slow };
}

export function navCell(nav, x, z) {
  const cx = Math.max(0, Math.min(nav.n - 1, Math.floor((x + HALF) / nav.cell)));
  const cz = Math.max(0, Math.min(nav.n - 1, Math.floor((z + HALF) / nav.cell)));
  return [cx, cz];
}

export function navCentre(nav, cx, cz) {
  return [cx * nav.cell - HALF + nav.cell / 2, cz * nav.cell - HALF + nav.cell / 2];
}

// Nearest walkable cell to a point.
export function nearestOpen(nav, x, z) {
  const [cx, cz] = navCell(nav, x, z);
  if (!nav.blocked[cz * nav.n + cx]) return [cx, cz];
  for (let r = 1; r < 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ax = cx + dx;
        const az = cz + dz;
        if (ax < 0 || az < 0 || ax >= nav.n || az >= nav.n) continue;
        if (!nav.blocked[az * nav.n + ax]) return [ax, az];
      }
    }
  }
  return [cx, cz];
}

function checkConnected(map) {
  const { nav } = map;
  const n = nav.n;
  const seen = new Uint8Array(n * n);
  const [sx, sz] = nearestOpen(nav, map.bases.sec.x, 0);
  const queue = [sz * n + sx];
  seen[queue[0]] = 1;
  while (queue.length) {
    const c = queue.pop();
    const cx = c % n;
    const cz = (c / n) | 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]) {
      const ax = cx + dx;
      const az = cz + dz;
      if (ax < 0 || az < 0 || ax >= n || az >= n) continue;
      const k = az * n + ax;
      if (seen[k] || nav.blocked[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  const reach = (x, z) => {
    const [cx, cz] = nearestOpen(nav, x, z);
    return !!seen[cz * n + cx];
  };
  return reach(map.bases.out.x, 0) && map.sites.every((s) => reach(s.x, s.z)) && map.adWalls.every((a) => reach(a.gem.x, a.gem.z));
}

// A* path on the nav grid. Returns a list of [x, z] waypoints.
export function findPath(nav, ax, az, bx, bz, maxIter = 6000) {
  const n = nav.n;
  const [sx, sz] = nearestOpen(nav, ax, az);
  const [gx, gz] = nearestOpen(nav, bx, bz);
  const start = sz * n + sx;
  const goal = gz * n + gx;
  const g = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  // Binary heap of [priority, cell].
  const heap = [];
  const push = (p, k) => {
    heap.push([p, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (heap[pi][0] <= heap[i][0]) break;
      [heap[pi], heap[i]] = [heap[i], heap[pi]];
      i = pi;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  push(0, start);
  g[start] = 0;
  const h = (k) => Math.hypot((k % n) - gx, ((k / n) | 0) - gz);
  let it = 0;
  const closed = new Uint8Array(n * n);
  while (heap.length && it++ < maxIter) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % n;
    const cz = (cur / n) | 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ax2 = cx + dx;
        const az2 = cz + dz;
        if (ax2 < 0 || az2 < 0 || ax2 >= n || az2 >= n) continue;
        const k = az2 * n + ax2;
        if (nav.blocked[k]) continue;
        if (dx && dz && (nav.blocked[cz * n + ax2] || nav.blocked[az2 * n + cx])) continue; // no corner cutting
        const cost = g[cur] + (dx && dz ? 1.414 : 1) * (nav.slow[k] ? 2.5 : 1);
        if (cost < g[k]) {
          g[k] = cost;
          came[k] = cur;
          push(cost + h(k), k);
        }
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) cells.push(k);
  cells.reverse();
  // Thin the path: keep every other cell plus the end.
  const pts = [];
  cells.forEach((k, i) => {
    if (i % 2 === 1 || i === cells.length - 1) pts.push(navCentre(nav, k % n, (k / n) | 0));
  });
  return pts;
}

export function inWater(map, x, z) {
  return map.water.find((w) => x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1) || null;
}
