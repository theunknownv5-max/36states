// Collision and ballistics shared by client (movement feel) and server (authority, bots).
// World geometry is a list of axis-aligned boxes; a grid index keeps queries fast.
import { PLAYER } from './config.js';

const CELL = 8;

export function buildIndex(boxes, half) {
  const cells = new Map();
  const key = (cx, cz) => cx * 100000 + cz;
  boxes.forEach((b, i) => {
    const cx0 = Math.floor((b.x0 + half) / CELL);
    const cx1 = Math.floor((b.x1 + half) / CELL);
    const cz0 = Math.floor((b.z0 + half) / CELL);
    const cz1 = Math.floor((b.z1 + half) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
      }
    }
  });
  return { boxes, cells, half, key, stamp: new Uint32Array(boxes.length), frame: 1 };
}

// Indices of boxes overlapping an xz rectangle.
export function query(index, x0, z0, x1, z1, out = []) {
  out.length = 0;
  const { half, cells, key, stamp } = index;
  const f = ++index.frame;
  const cx0 = Math.floor((x0 + half) / CELL);
  const cx1 = Math.floor((x1 + half) / CELL);
  const cz0 = Math.floor((z0 + half) / CELL);
  const cz1 = Math.floor((z1 + half) / CELL);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const list = cells.get(key(cx, cz));
      if (!list) continue;
      for (const i of list) {
        if (stamp[i] === f) continue;
        stamp[i] = f;
        out.push(i);
      }
    }
  }
  return out;
}

// Slab test. Returns [tEnter, tExit] or null.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, b.x0, b.x1],
    [oy, dy, b.y0, b.y1],
    [oz, dz, b.z0, b.z1]
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), tmax];
}

const tmpList = [];
// First world hit along a ray (boxes + ground). d must be normalised.
export function raycast(index, ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  let hitBox = -1;
  let exit = 0;
  // Ground plane at y = 0.
  if (dy < -1e-6) {
    const tg = -oy / dy;
    if (tg >= 0 && tg < best) {
      best = tg;
      hitBox = -2;
    }
  }
  // Walk the ray in steps of one cell, testing boxes in the cells it crosses.
  const steps = Math.ceil(Math.min(maxT, best) / (CELL * 0.5)) + 1;
  const seen = new Set();
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(s * CELL * 0.5, best);
    const px = ox + dx * t;
    const pz = oz + dz * t;
    query(index, px - CELL * 0.5, pz - CELL * 0.5, px + CELL * 0.5, pz + CELL * 0.5, tmpList);
    for (const i of tmpList) {
      if (seen.has(i)) continue;
      seen.add(i);
      const r = rayBox(ox, oy, oz, dx, dy, dz, index.boxes[i]);
      if (r && r[0] < best) {
        best = r[0];
        hitBox = i;
        exit = r[1];
      }
    }
    if (t >= best) break;
  }
  return { t: best, box: hitBox, exitT: exit };
}

// Vertical cylinder test (xz circle, y range).
function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const fx = ox - cx;
  const fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / a, (-b + sq) / a]) {
    if (t < 0) continue;
    const y = oy + dy * t;
    if (y >= y0 && y <= y1) return t;
  }
  return null;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Hit test against a soldier standing at (x, y, z). Returns { t, zone } or null.
export function hitSoldier(ox, oy, oz, dx, dy, dz, p) {
  const crouch = !!p.crouch;
  const downed = !!p.downed;
  if (downed) {
    // Lying on the ground: a low, wide target.
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, 0.75, p.y, p.y + 0.4);
    return t === null ? null : { t, zone: 'body' };
  }
  const headY = p.y + (crouch ? 1.12 : 1.62);
  const bodyTop = p.y + (crouch ? 1.0 : 1.48);
  const legTop = p.y + (crouch ? 0.45 : 0.85);
  const th = raySphere(ox, oy, oz, dx, dy, dz, p.x, headY, p.z, 0.15);
  const tb = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, 0.28, p.y, bodyTop);
  if (th !== null && (tb === null || th <= tb + 0.05)) return { t: th, zone: 'head' };
  if (tb !== null) return { t: tb, zone: oy + dy * tb < legTop ? 'leg' : 'body' };
  return null;
}

// Is the line between two points blocked by walls (or smoke)?
export function lineBlocked(index, ax, ay, az, bx, by, bz, smokes = []) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return false;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const hit = raycast(index, ax, ay, az, nx, ny, nz, len);
  if (hit.t < len - 0.05) return true;
  for (const s of smokes) {
    const t = raySphere(ax, ay, az, nx, ny, nz, s.x, 1.2, s.z, s.r);
    if (t !== null && t < len) return true;
  }
  return false;
}

// Moves a soldier body through the world: walls, steps, gravity, jumping.
// body: { x, y, z, vy, onGround, crouch }; wish: horizontal velocity { x, z }.
export function moveBody(body, wishX, wishZ, dt, index, half, jump = false) {
  const r = PLAYER.radius;
  const h = body.crouch ? PLAYER.crouchHeight : PLAYER.height;
  const list = [];

  const overlapping = (x, y, z) => {
    query(index, x - r, z - r, x + r, z + r, list);
    const hits = [];
    for (const i of list) {
      const b = index.boxes[i];
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1 && y + h > b.y0 && y < b.y1) hits.push(b);
    }
    return hits;
  };

  const tryAxis = (axis, delta) => {
    if (delta === 0) return;
    const nx = axis === 'x' ? body.x + delta : body.x;
    const nz = axis === 'z' ? body.z + delta : body.z;
    const hits = overlapping(nx, body.y, nz);
    if (!hits.length) {
      body.x = nx;
      body.z = nz;
      return;
    }
    // Step up onto low obstacles (kerbs, sandbags, crates) when on the ground.
    const top = Math.max(...hits.map((b) => b.y1));
    if (body.onGround && top - body.y <= PLAYER.stepUp && !overlapping(nx, top + 0.01, nz).length) {
      body.x = nx;
      body.z = nz;
      body.y = top;
      return;
    }
    // Slide flush against the wall.
    let pos = axis === 'x' ? body.x : body.z;
    for (const b of hits) {
      if (axis === 'x') pos = delta > 0 ? Math.min(pos, b.x0 - r - 1e-4) : Math.max(pos, b.x1 + r + 1e-4);
      else pos = delta > 0 ? Math.min(pos, b.z0 - r - 1e-4) : Math.max(pos, b.z1 + r + 1e-4);
    }
    if (axis === 'x') body.x = pos;
    else body.z = pos;
  };

  // Sub-step fast movement so nobody tunnels through thin walls.
  const dist = Math.hypot(wishX, wishZ) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  for (let s = 0; s < steps; s++) {
    tryAxis('x', (wishX * dt) / steps);
    tryAxis('z', (wishZ * dt) / steps);
  }

  // Vertical: gravity, jumping, landing on boxes or the ground.
  if (jump && body.onGround) {
    body.vy = PLAYER.jump;
    body.onGround = false;
  }
  body.vy -= PLAYER.gravity * dt;
  let ny = body.y + body.vy * dt;
  const hits = overlapping(body.x, ny, body.z);
  if (body.vy <= 0) {
    let floor = 0;
    for (const b of hits) if (b.y1 <= body.y + 0.05 + PLAYER.stepUp) floor = Math.max(floor, b.y1);
    // Also stand on a box directly below even if we are not overlapping it yet.
    query(index, body.x - r, body.z - r, body.x + r, body.z + r, list);
    for (const i of list) {
      const b = index.boxes[i];
      if (body.x + r > b.x0 && body.x - r < b.x1 && body.z + r > b.z0 && body.z - r < b.z1 && b.y1 <= body.y + 0.05 && b.y1 > floor) floor = b.y1;
    }
    if (ny <= floor) {
      ny = floor;
      body.vy = 0;
      body.onGround = true;
    } else body.onGround = false;
  } else if (hits.length) {
    // Head hit a ceiling.
    ny = Math.min(...hits.map((b) => b.y0)) - h - 1e-3;
    body.vy = 0;
  }
  body.y = ny;

  // Map boundary.
  const lim = half - 1.5;
  body.x = Math.max(-lim, Math.min(lim, body.x));
  body.z = Math.max(-lim, Math.min(lim, body.z));
  return body;
}

export function insideAnyBox(index, x, y, z, crouch = false) {
  const r = PLAYER.radius * 0.8;
  const h = crouch ? PLAYER.crouchHeight : PLAYER.height;
  const list = query(index, x - r, z - r, x + r, z + r);
  return list.some((i) => {
    const b = index.boxes[i];
    return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1 && y + h - 0.1 > b.y0 && y + 0.1 < b.y1;
  });
}

// Direction from yaw/pitch (yaw 0 looks toward -z, like a Three.js camera).
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function normalise(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Random direction inside a cone around d (deterministic when given an rng).
export function spreadDir(d, angle, rng = Math.random) {
  if (angle <= 0) return d;
  // Build a basis around d.
  const up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let ux = up[1] * d[2] - up[2] * d[1];
  let uy = up[2] * d[0] - up[0] * d[2];
  let uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = d[1] * uz - d[2] * uy;
  const vy = d[2] * ux - d[0] * uz;
  const vz = d[0] * uy - d[1] * ux;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * Math.tan(angle);
  return normalise([d[0] + (ux * Math.cos(a) + vx * Math.sin(a)) * r, d[1] + (uy * Math.cos(a) + vy * Math.sin(a)) * r, d[2] + (uz * Math.cos(a) + vz * Math.sin(a)) * r]);
}
