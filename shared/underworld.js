// Below and around the battlefield: a cemetery with graves you can dig, a domed stone
// mausoleum, a big domed hall whose stairwell drops into an underground tunnel, and a
// catacomb of tombs under the cemetery. Graves and tombs hide relic guns and heavy armour
// you can't buy anywhere else. Shared so server and client build the same thing.
import { range } from './rng.js';

export const UNDER = {
  depth: 4, // tunnel floor is this far below ground
  width: 3, // corridor width
  ceil: 0.35, // ceiling slab thickness (its top is the ground)
  wall: 0.3
};

// Digging: stand at a grave or tomb and hold E.
export const DIG = { graveSecs: 5, tombSecs: 3.5, reach: 1.8, xp: 50, money: 2500 };

// What's buried. Graves are a gamble; the catacomb tombs are richer.
export const LOOT = {
  goldak: { name: 'Golden AK', kind: 'weapon', icon: '🔱' },
  barrett: { name: 'Thunder .50', kind: 'weapon', icon: '⚡' },
  gl: { name: 'Drum Launcher', kind: 'weapon', icon: '🥁' },
  ancestral: { name: "Ancestor's Dane Gun", kind: 'weapon', icon: '🪶' },
  plate: { name: 'Juggernaut plate (200 armour)', kind: 'armor', armor: 200, icon: '🛡' },
  charm: { name: "Warrior's charm armour", kind: 'armor', armor: 150, heal: 25, icon: '🧿' },
  money: { name: '₦2,500 stash', kind: 'money', icon: '💰' },
  gems: { name: 'Life gem', kind: 'gems', icon: '💎' },
  bones: { name: 'Only old bones', kind: 'none', icon: '💀' }
};
export const GRAVE_LOOT = [['goldak', 8], ['ancestral', 10], ['gl', 6], ['barrett', 5], ['plate', 8], ['charm', 10], ['money', 22], ['gems', 11], ['bones', 20]];
export const TOMB_LOOT = [['barrett', 20], ['gl', 20], ['goldak', 22], ['ancestral', 10], ['plate', 18], ['charm', 10]];

export function rollLoot(table, rnd) {
  let r = rnd() * table.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of table) if ((r -= w) <= 0) return k;
  return table[0][0];
}

// Is (x, z) over an opening in the ground (no ground plane there)?
export function inHole(holes, x, z) {
  if (!holes) return false;
  for (const h of holes) if (x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1) return true;
  return false;
}

// ---------- generation ----------
// ctx: { rng, free, reserve, box, visuals, water, half }
// Returns { graves, holes, openings, lamps } (graves include the catacomb tombs).
export function buildUnderworld(ctx) {
  const { rng, free, reserve, water } = ctx;
  const out = { graves: [], holes: [], openings: [] };
  const wet = (r, pad = 2) => water.some((w) => r.x1 > w.x0 - pad && r.x0 < w.x1 + pad && r.z1 > w.z0 - pad && r.z0 < w.z1 + pad);
  for (let tries = 0; tries < 400; tries++) {
    const dx = range(rng, -48, 48);
    const dz = range(rng, -66, 66);
    const gx = dx + (rng() < 0.5 ? -1 : 1) * range(rng, 16, 34);
    const gz = dz + (rng() < 0.5 ? -1 : 1) * range(rng, 22, 40);
    if (Math.abs(gx) > 60 || Math.abs(gz) > 74) continue;
    const plan = planUnderworld(dx, dz, gx, gz);
    if (!free(plan.dome.x0, plan.dome.z0, plan.dome.x1, plan.dome.z1, 2)) continue;
    if (!free(plan.yard.x0, plan.yard.z0, plan.yard.x1, plan.yard.z1, 2)) continue;
    const d = plan.dome;
    const y = plan.yard;
    if (d.x1 + 3 > y.x0 && d.x0 - 3 < y.x1 && d.z1 + 3 > y.z0 && d.z0 - 3 < y.z1) continue;
    if ([plan.dome, plan.yard, ...plan.rects].some((r) => wet(r))) continue;
    reserve(plan.dome.x0, plan.dome.z0, plan.dome.x1, plan.dome.z1, 1);
    reserve(plan.yard.x0, plan.yard.z0, plan.yard.x1, plan.yard.z1, 1);
    buildPlan(plan, ctx, out);
    return out;
  }
  // No room for the whole network: a cemetery on its own.
  for (let tries = 0; tries < 300; tries++) {
    const gx = range(rng, -55, 55);
    const gz = range(rng, -70, 70);
    const yard = { x0: gx - 11, z0: gz - 8, x1: gx + 11, z1: gz + 8 };
    if (!free(yard.x0, yard.z0, yard.x1, yard.z1, 2) || wet(yard)) continue;
    reserve(yard.x0, yard.z0, yard.x1, yard.z1, 1);
    cemetery(ctx, out, yard, gx, gz, null);
    return out;
  }
  return out;
}

// Rectangles of the tunnel network for a dome at (dx, dz) and cemetery at (gx, gz).
function planUnderworld(dx, dz, gx, gz) {
  const W = UNDER.width / 2;
  const south = gz > dz; // which way the dome's stairs go down
  const sA = { x0: dx - 1.3, x1: dx + 1.3, z0: dz - 3.2, z1: dz + 3.2, shaft: true, down: south ? 1 : -1 };
  const startZ = south ? sA.z1 : sA.z0;
  const c1 = { x0: dx - W, x1: dx + W, z0: Math.min(startZ, gz - W), z1: Math.max(startZ, gz + W) };
  const chamber = { x0: gx - 5, x1: gx + 5, z0: gz - 4, z1: gz + 4, chamber: true };
  const east = gx > dx;
  const c2 = { z0: gz - W, z1: gz + W, x0: east ? c1.x1 : chamber.x1, x1: east ? chamber.x0 : c1.x0 };
  // Mausoleum stairs come down into the chamber's far side (away from the dome).
  const bNorth = !south; // the chamber side facing away from the dome
  const sB = bNorth ? { x0: gx - 1.3, x1: gx + 1.3, z0: chamber.z1, z1: chamber.z1 + 6.4, shaft: true, down: -1 } : { x0: gx - 1.3, x1: gx + 1.3, z0: chamber.z0 - 6.4, z1: chamber.z0, shaft: true, down: 1 };
  const maus = { x0: sB.x0 - 1.3, x1: sB.x1 + 1.3, z0: sB.z0 - (sB.down === 1 ? 1.4 : 0.4), z1: sB.z1 + (sB.down === 1 ? 0.4 : 1.4), door: sB.down === 1 ? 'z0' : 'z1' };
  const dome = { x0: dx - 6.5, x1: dx + 6.5, z0: dz - 6.5, z1: dz + 6.5, door: south ? 'z0' : 'z1' };
  // The yard leaves a few metres of open ground all round the mausoleum.
  const yard = { x0: Math.min(maus.x0 - 3, gx - 11), x1: Math.max(maus.x1 + 3, gx + 11), z0: Math.min(maus.z0 - 3.5, gz - 8), z1: Math.max(maus.z1 + 3.5, gz + 8) };
  return { dx, dz, gx, gz, sA, c1, c2, chamber, sB, maus, dome, yard, rects: [sA, c1, c2, chamber, sB] };
}

function buildPlan(p, ctx, out) {
  const { box, visuals } = ctx;
  const D = UNDER.depth;
  const T = UNDER.wall;
  // ---------- the tunnel network ----------
  for (const r of p.rects) {
    out.holes.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 });
    if (r.shaft) {
      out.openings.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 });
      stairs(r, box);
    } else {
      box(r.x0, -D - 0.3, r.z0, r.x1, -D, r.z1, 'tunnel', { under: true, floor: true });
      box(r.x0, -UNDER.ceil, r.z0, r.x1, 0, r.z1, 'tunnel', { under: true, ceil: true, walkway: true });
    }
  }
  // Walls round every rectangle, open wherever another rectangle touches it.
  for (const r of p.rects) {
    const others = p.rects.filter((o) => o !== r);
    const top = r.shaft ? -0.02 : -UNDER.ceil;
    for (const side of ['x0', 'x1', 'z0', 'z1']) {
      const alongX = side === 'z0' || side === 'z1';
      const at = r[side];
      const lo = alongX ? r.x0 - T : r.z0 - T;
      const hi = alongX ? r.x1 + T : r.z1 + T;
      const gaps = [];
      for (const o of others) {
        const touch = side === 'x0' ? Math.abs(o.x1 - at) < 0.02 : side === 'x1' ? Math.abs(o.x0 - at) < 0.02 : side === 'z0' ? Math.abs(o.z1 - at) < 0.02 : Math.abs(o.z0 - at) < 0.02;
        if (!touch) continue;
        const a = Math.max(lo, alongX ? o.x0 : o.z0);
        const b = Math.min(hi, alongX ? o.x1 : o.z1);
        if (b > a) gaps.push([a, b]);
      }
      gaps.sort((a, b) => a[0] - b[0]);
      let cur = lo;
      const segs = [];
      for (const [a, b] of gaps) {
        if (a > cur) segs.push([cur, a]);
        cur = Math.max(cur, b);
      }
      if (cur < hi) segs.push([cur, hi]);
      const out0 = side === 'x0' || side === 'z0' ? at - T : at;
      for (const [a, b] of segs) {
        if (b - a < 0.05) continue;
        if (alongX) box(a, -D - 0.3, out0, b, top, out0 + T, 'tunnel', { under: true });
        else box(out0, -D - 0.3, a, out0 + T, top, b, 'tunnel', { under: true });
      }
    }
  }
  // Lamps along the tunnel ceiling.
  for (const r of p.rects) {
    if (r.shaft) continue;
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    const n = Math.max(1, Math.round(len / 8));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      visuals.push({ type: 'lamp', x: alongX ? r.x0 + (r.x1 - r.x0) * t : (r.x0 + r.x1) / 2, z: alongX ? (r.z0 + r.z1) / 2 : r.z0 + (r.z1 - r.z0) * t, y: -UNDER.ceil - 0.25 });
    }
  }
  // ---------- the catacomb: tombs along the long walls ----------
  const ch = p.chamber;
  for (const zEdge of [ch.z0, ch.z1]) {
    const inward = zEdge === ch.z0 ? 1 : -1;
    for (const x of [ch.x0 + 1.8, (ch.x0 + ch.x1) / 2, ch.x1 - 1.8]) {
      const z0 = zEdge;
      const z1 = zEdge + inward * 1.0;
      // Leave the doorway into the chamber clear.
      if (p.rects.some((o) => o.shaft && x > o.x0 - 1 && x < o.x1 + 1 && Math.abs((inward > 0 ? o.z1 : o.z0) - zEdge) < 0.05)) continue;
      box(x - 1.0, -D, Math.min(z0, z1), x + 1.0, -D + 0.85, Math.max(z0, z1), 'stone', { under: true, tomb: true });
      out.graves.push({ i: out.graves.length, kind: 'tomb', x, z: zEdge + inward * 1.45, y: -D, slab: { x, z: (z0 + z1) / 2, rot: 0 } });
    }
  }
  visuals.push({ type: 'catacomb', x0: ch.x0, z0: ch.z0, x1: ch.x1, z1: ch.z1, y: -D });
  // ---------- the domed hall over the first stairwell ----------
  hall(p.dome, p.sA, ctx);
  // ---------- the cemetery and its mausoleum over the second ----------
  cemetery(ctx, out, p.yard, p.gx, p.gz, p);
}

// Stairs filling a shaft rectangle from the ground at one end down to the tunnel floor.
function stairs(r, box) {
  const D = UNDER.depth;
  const n = 13;
  const h = D / n;
  const len = r.z1 - r.z0;
  const d = len / (n + 1); // the last tread is the landing
  // Each tread only covers its own step; the last one runs on as the landing.
  for (let k = 0; k < n; k++) {
    const y1 = -(k + 1) * h;
    const a = k * d;
    const b = k === n - 1 ? len : (k + 1) * d;
    if (r.down === 1) box(r.x0, -D - 0.3, r.z0 + a, r.x1, y1, r.z0 + b, 'stairs', { under: true, walkway: true });
    else box(r.x0, -D - 0.3, r.z1 - b, r.x1, y1, r.z1 - a, 'stairs', { under: true, walkway: true });
  }
}

function hall(dm, shaft, ctx) {
  const { box, visuals } = ctx;
  const H = 4.4;
  const t = 0.4;
  const doorW = 1.6;
  const cx = (dm.x0 + dm.x1) / 2;
  // Four stone walls, a door on the side where the stairs start, windows on the others.
  for (const side of ['x0', 'x1', 'z0', 'z1']) {
    const alongX = side === 'z0' || side === 'z1';
    const at = dm[side];
    const o0 = side === 'x0' || side === 'z0' ? at : at - t;
    const lo = alongX ? dm.x0 : dm.z0;
    const hi = alongX ? dm.x1 : dm.z1;
    const mid = (lo + hi) / 2;
    const gap = side === dm.door ? doorW : 1.2;
    const wallBox = (a, b, y0, y1) => (alongX ? box(a, y0, o0, b, y1, o0 + t, 'stone', { dome: true }) : box(o0, y0, a, o0 + t, y1, b, 'stone', { dome: true }));
    wallBox(lo, mid - gap / 2, 0, H);
    wallBox(mid + gap / 2, hi, 0, H);
    if (side === dm.door) wallBox(mid - gap / 2, mid + gap / 2, 2.6, H);
    else {
      wallBox(mid - gap / 2, mid + gap / 2, 0, 1.5);
      wallBox(mid - gap / 2, mid + gap / 2, 2.7, H);
    }
  }
  box(dm.x0 - 0.2, H, dm.z0 - 0.2, dm.x1 + 0.2, H + 0.25, dm.z1 + 0.2, 'stone', { roof: true, dome: true });
  // Rails round the stairwell (open where you walk down).
  const r = shaft;
  const rail = (x0, z0, x1, z1) => box(x0, 0, z0, x1, 0.95, z1, 'metal', { pen: false, rail: true });
  rail(r.x0 - 0.12, r.z0, r.x0, r.z1);
  rail(r.x1, r.z0, r.x1 + 0.12, r.z1);
  if (r.down === 1) rail(r.x0 - 0.12, r.z1, r.x1 + 0.12, r.z1 + 0.12);
  else rail(r.x0 - 0.12, r.z0 - 0.12, r.x1 + 0.12, r.z0);
  visuals.push({ type: 'dome', x: cx, z: (dm.z0 + dm.z1) / 2, w: dm.x1 - dm.x0, h: H + 0.25, r: (dm.x1 - dm.x0) / 2 - 0.2, door: dm.door });
}

function cemetery(ctx, out, yard, gx, gz, plan) {
  const { box, visuals, rng } = ctx;
  // Low stone wall with a gate facing the middle of the map.
  const gateSide = Math.abs(gx) > Math.abs(gz) ? (gx > 0 ? 'x0' : 'x1') : gz > 0 ? 'z0' : 'z1';
  for (const side of ['x0', 'x1', 'z0', 'z1']) {
    const alongX = side === 'z0' || side === 'z1';
    const at = yard[side];
    const lo = alongX ? yard.x0 : yard.z0;
    const hi = alongX ? yard.x1 : yard.z1;
    const mid = (lo + hi) / 2;
    const segs = side === gateSide ? [[lo, mid - 1.6], [mid + 1.6, hi]] : [[lo, hi]];
    for (const [a, b] of segs) {
      if (alongX) box(a, 0, at - 0.15, b, 0.85, at + 0.15, 'stone', { fence: true });
      else box(at - 0.15, 0, a, at + 0.15, 0.85, b, 'stone', { fence: true });
    }
    visuals.push({ type: 'gatePosts', side, at, mid, gate: side === gateSide, alongX });
  }
  // Mausoleum (domed tomb house) over the second stairwell.
  const m = plan?.maus;
  if (m) {
    const t = 0.35;
    const H = 3.4;
    for (const side of ['x0', 'x1', 'z0', 'z1']) {
      const alongX = side === 'z0' || side === 'z1';
      const at = m[side];
      const o0 = side === 'x0' || side === 'z0' ? at : at - t;
      const lo = alongX ? m.x0 : m.z0;
      const hi = alongX ? m.x1 : m.z1;
      const mid = (lo + hi) / 2;
      const wb = (a, b, y0, y1) => (alongX ? box(a, y0, o0, b, y1, o0 + t, 'stone', { maus: true }) : box(o0, y0, a, o0 + t, y1, b, 'stone', { maus: true }));
      if (side === m.door) {
        wb(lo, mid - 0.75, 0, H);
        wb(mid + 0.75, hi, 0, H);
        wb(mid - 0.75, mid + 0.75, 2.4, H);
      } else wb(lo, hi, 0, H);
    }
    box(m.x0 - 0.15, H, m.z0 - 0.15, m.x1 + 0.15, H + 0.2, m.z1 + 0.15, 'stone', { roof: true, maus: true });
    visuals.push({ type: 'mausoleum', x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2, w: m.x1 - m.x0, d: m.z1 - m.z0, h: H + 0.2, door: m.door });
  }
  // Rows of graves, keeping a path down the middle and away from the mausoleum.
  const rows = [-5.5, -2, 1.5, 5];
  const cols = [-8.5, -5.5, 5.5, 8.5];
  for (const dz of rows)
    for (const dx of cols) {
      const x = gx + dx;
      const z = gz + dz;
      if (m && x > m.x0 - 1.2 && x < m.x1 + 1.2 && z > m.z0 - 1.6 && z < m.z1 + 1.6) continue;
      if (x < yard.x0 + 1 || x > yard.x1 - 1 || z < yard.z0 + 1.5 || z > yard.z1 - 1.5) continue;
      const rot = 0;
      // Headstone at the head of the grave (the mound itself you walk over).
      box(x - 0.42, 0, z - 1.25, x + 0.42, 0.85, z - 1.1, 'stone', { headstone: true });
      out.graves.push({ i: out.graves.length, kind: 'grave', x, z, y: 0, rot, style: Math.floor(rng() * 4) });
    }
}
