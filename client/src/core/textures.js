// Procedural PBR-style textures, generated on canvas at load time (no downloads).
// Each surface returns { map, normalMap } with tileable detail. Swap any of these for
// photo-scanned textures later without touching the rest of the game.
import * as THREE from 'three';
import { mulberry32 } from '../../../shared/rng.js';

const cache = new Map();
let SIZE = 512;
export function setTextureSize(s) {
  SIZE = s;
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function toTexture(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Tileable fractal value noise in [0, 1].
export function fbm(size, octaves, rng, baseCells = 4) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells;
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        out[y * size + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function normalFromHeight(height, size, strength) {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const dn = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (dn - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len) * 127.5 + 127.5;
      img.data[i + 1] = (ny / len) * 127.5 + 127.5;
      img.data[i + 2] = (1 / len) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Generic pixel surface: fn(x, y, n1, n2, rng) -> { c: [r,g,b], h: height }
function pixelSurface(key, size, seed, fn, strength = 3, extraDraw = null) {
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(seed);
  const n1 = fbm(size, 5, rng, 4);
  const n2 = fbm(size, 4, rng, 16);
  const height = new Float32Array(size * size);
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = fn(x, y, n1[i], n2[i], rng);
      height[i] = r.h;
      img.data[i * 4] = r.c[0];
      img.data[i * 4 + 1] = r.c[1];
      img.data[i * 4 + 2] = r.c[2];
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (extraDraw) extraDraw(ctx, size, rng, height);
  const out = { map: toTexture(c), normalMap: normalFromHeight(height, size, strength) };
  cache.set(key, out);
  return out;
}

// ---------- ground ----------
const GROUND = {
  sahel: { a: '#d2ae74', b: '#b98f57', c: '#e2c48f', grain: 0.35, pebbles: 0.004 },
  savanna: { a: '#9c7f4a', b: '#7e6a3b', c: '#b39a5e', grain: 0.4, pebbles: 0.006 },
  plateau: { a: '#7d6f55', b: '#635743', c: '#958a74', grain: 0.5, pebbles: 0.02 },
  rainforest: { a: '#8f4f2b', b: '#6e3a1f', c: '#a8653a', grain: 0.35, pebbles: 0.006 },
  creeks: { a: '#5a4e36', b: '#433a28', c: '#6c6044', grain: 0.3, pebbles: 0.002 },
  urban: { a: '#6f6a64', b: '#5a5650', c: '#837e77', grain: 0.45, pebbles: 0.01 }
};
export function groundTexture(biome) {
  const g = GROUND[biome] || GROUND.savanna;
  const A = hex(g.a);
  const B = hex(g.b);
  const C = hex(g.c);
  return pixelSurface(`ground-${biome}`, SIZE, 101 + biome.length, (x, y, n1, n2, rng) => {
    let col = mix(B, A, clamp01(n1 * 1.6 - 0.2));
    col = mix(col, C, clamp01((n2 - 0.55) * 3));
    const grain = (rng() - 0.5) * 40 * g.grain;
    let h = n1 * 0.6 + n2 * 0.4;
    if (rng() < g.pebbles) {
      h += 0.6;
      col = mix(col, [140, 132, 120], 0.6);
    }
    return { c: [col[0] + grain, col[1] + grain, col[2] + grain], h };
  }, 2.5);
}

// ---------- walls ----------
export function mudTexture() {
  return pixelSurface('mud', SIZE, 7, (x, y, n1, n2, rng) => {
    const A = [150, 98, 62];
    const B = [120, 76, 46];
    let col = mix(B, A, n1);
    // Hand-smoothed horizontal courses and vertical rain streaks.
    const course = Math.sin((y / SIZE) * Math.PI * 10 + n2 * 3) * 0.5 + 0.5;
    const streak = Math.pow(Math.abs(Math.sin((x / SIZE) * Math.PI * 23 + n1 * 6)), 30) * (y / SIZE);
    col = mix(col, [90, 58, 36], streak * 0.6 + course * 0.08);
    const g = (rng() - 0.5) * 18;
    return { c: [col[0] + g, col[1] + g, col[2] + g], h: n1 * 0.5 + n2 * 0.5 + course * 0.2 };
  }, 4, (ctx, s, rng) => {
    ctx.strokeStyle = 'rgba(60,35,20,0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      let x = rng() * s;
      let y = rng() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rng() - 0.5) * 18;
        y += rng() * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function plasterTexture() {
  // Light base: buildings are tinted per-instance with vertex colours.
  return pixelSurface('plaster', SIZE, 9, (x, y, n1, n2, rng) => {
    const v = 205 + n2 * 30 - Math.pow(clamp01(1 - y / SIZE), 6) * 0 - (rng() - 0.5) * 10;
    // Grime from the ground up and from the roof edge down.
    const yy = y / SIZE;
    const grime = clamp01((yy - 0.75) * 4) * 0.35 + Math.pow(n1, 3) * 0.4;
    const c = mix([v, v, v * 0.97], [110, 100, 85], grime);
    return { c, h: n2 * 0.4 + n1 * 0.2 };
  }, 2.2, (ctx, s, rng) => {
    // Peeling patches show the block work underneath.
    for (let i = 0; i < 5; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = 6 + rng() * 22;
      ctx.fillStyle = 'rgba(150,140,125,0.7)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + rng() * 0.6), rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export function plankTexture() {
  return pixelSurface('plank', SIZE, 13, (x, y, n1, n2, rng) => {
    const boards = 7;
    const u = (x / SIZE) * boards;
    const b = Math.floor(u);
    const f = u - b;
    const tone = ((b * 37) % 11) / 11;
    const grain = Math.sin(y * 0.09 + n2 * 14 + b * 3) * 0.5 + 0.5;
    let col = mix([96, 70, 44], [140, 104, 66], tone * 0.6 + grain * 0.3);
    col = mix(col, [70, 72, 70], clamp01(n1 - 0.45) * 1.2); // weathering
    const gap = f < 0.04 || f > 0.96;
    if (gap) col = [30, 22, 14];
    return { c: col, h: gap ? 0 : 0.6 + grain * 0.2 };
  }, 5);
}

export function stoneTexture() {
  return pixelSurface('stone', SIZE, 17, (x, y, n1, n2, rng) => {
    const rows = 6;
    const v = (y / SIZE) * rows;
    const r = Math.floor(v);
    const u = (x / SIZE) * 4 + (r % 2) * 0.5;
    const fu = u - Math.floor(u);
    const fv = v - r;
    const mortar = fu < 0.04 || fu > 0.96 || fv < 0.06 || fv > 0.94;
    const tone = (((Math.floor(u) * 13 + r * 7) % 9) / 9) * 0.5;
    let col = mix([120, 112, 100], [165, 155, 140], tone + n2 * 0.4);
    if (mortar) col = [92, 86, 78];
    return { c: col, h: mortar ? 0 : 0.5 + n2 * 0.5 };
  }, 5);
}

export function zincTexture() {
  return pixelSurface('zinc', SIZE, 19, (x, y, n1, n2, rng) => {
    const corr = Math.sin((x / SIZE) * Math.PI * 2 * 18) * 0.5 + 0.5;
    const rust = clamp01((n1 - 0.42) * 2.5 + (y / SIZE) * 0.2);
    let col = mix([150, 155, 158], [118, 64, 32], rust);
    col = mix(col, [70, 40, 22], clamp01(n2 - 0.6) * rust);
    const shade = 0.82 + corr * 0.25;
    return { c: [col[0] * shade, col[1] * shade, col[2] * shade], h: corr };
  }, 6);
}

export function concreteTexture() {
  return pixelSurface('concrete', SIZE, 23, (x, y, n1, n2, rng) => {
    const v = 150 + n1 * 40 + (rng() - 0.5) * 16;
    const stain = clamp01((n2 - 0.6) * 3);
    const c = mix([v, v * 0.98, v * 0.95], [95, 92, 85], stain * 0.7);
    // Form-work lines.
    const line = (x % (SIZE / 2)) < 2 || (y % (SIZE / 4)) < 2;
    return { c: line ? [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8] : c, h: n2 * 0.5 + (line ? 0 : 0.2) };
  }, 2.5);
}

export function sandbagTexture() {
  return pixelSurface('sandbag', SIZE, 29, (x, y, n1, n2, rng) => {
    const rows = 4;
    const v = (y / SIZE) * rows;
    const r = Math.floor(v);
    const u = (x / SIZE) * 3 + (r % 2) * 0.5;
    const fu = u - Math.floor(u);
    const fv = v - r;
    const bulge = Math.sin(fu * Math.PI) * Math.sin(fv * Math.PI);
    const weave = ((x + y) % 4 < 2 ? 1 : 0.94) * ((x - y + 400) % 4 < 2 ? 1 : 0.96);
    let col = mix([120, 108, 76], [168, 152, 112], bulge * 0.7 + n2 * 0.3);
    col = mix(col, [90, 70, 45], clamp01(n1 - 0.55) * 1.4);
    return { c: col.map((c) => c * weave), h: bulge };
  }, 6);
}

export function crateTexture() {
  return pixelSurface('crate', SIZE, 31, (x, y, n1, n2) => {
    const u = x / SIZE;
    const v = y / SIZE;
    const frame = u < 0.09 || u > 0.91 || v < 0.09 || v > 0.91 || Math.abs(u - v) < 0.05;
    const board = Math.floor(v * 6);
    const grain = Math.sin(x * 0.11 + n2 * 10 + board * 4) * 0.5 + 0.5;
    let col = mix([120, 90, 55], [165, 128, 82], grain * 0.5 + n1 * 0.4);
    if (frame) col = mix(col, [95, 70, 40], 0.5);
    const gap = !frame && (v * 6) % 1 < 0.04;
    if (gap) col = [40, 28, 18];
    return { c: col, h: frame ? 1 : gap ? 0 : 0.6 };
  }, 4, (ctx, s) => {
    ctx.fillStyle = 'rgba(25,25,25,0.6)';
    ctx.font = `bold ${s * 0.08}px monospace`;
    ctx.fillText('FRAGILE', s * 0.3, s * 0.55);
  });
}

export function metalTexture() {
  return pixelSurface('metal', SIZE, 37, (x, y, n1, n2, rng) => {
    const rust = clamp01((n1 - 0.5) * 3);
    let col = mix([92, 98, 92], [120, 60, 30], rust);
    col = mix(col, [60, 60, 58], clamp01(n2 - 0.5));
    const g = (rng() - 0.5) * 10;
    return { c: [col[0] + g, col[1] + g, col[2] + g], h: rust * 0.4 + n2 * 0.2 };
  }, 2);
}

export function containerTexture() {
  return pixelSurface('container', SIZE, 41, (x, y, n1, n2) => {
    const corr = Math.abs(((x / SIZE) * 24) % 1 - 0.5) < 0.25 ? 1 : 0;
    const rust = clamp01((n1 - 0.55) * 3) + clamp01((y / SIZE - 0.85) * 5) * 0.5;
    // White base so the per-container vertex colour shows through.
    const col = mix([215, 215, 215], [120, 70, 40], clamp01(rust));
    const s = 0.86 + corr * 0.16;
    return { c: col.map((c) => c * s), h: corr };
  }, 6);
}

export function drumTexture() {
  return pixelSurface('drum', SIZE, 43, (x, y, n1) => {
    const v = y / SIZE;
    const band = Math.abs(v - 0.33) < 0.03 || Math.abs(v - 0.66) < 0.03;
    const rust = clamp01((n1 - 0.5) * 3);
    let col = mix([40, 80, 140], [130, 70, 35], rust);
    if (band) col = mix(col, [30, 30, 30], 0.4);
    return { c: col, h: band ? 1 : 0.5 };
  }, 4);
}

export function rustTexture() {
  return pixelSurface('rust', SIZE, 47, (x, y, n1, n2, rng) => {
    const paint = clamp01((n2 - 0.45) * 4);
    let col = mix([105, 52, 26], [70, 40, 25], n1);
    col = mix(col, [60, 80, 100], paint * 0.6); // patches of old paint
    const g = (rng() - 0.5) * 22;
    return { c: [col[0] + g, col[1] + g, col[2] + g], h: n1 * 0.6 + n2 * 0.4 };
  }, 3);
}

export function rockTexture() {
  return pixelSurface('rock', SIZE, 53, (x, y, n1, n2, rng) => {
    const vein = Math.pow(1 - Math.abs(Math.sin((x * 0.02 + n1 * 8) * 1.3)), 12);
    let col = mix([96, 92, 86], [150, 144, 134], n1);
    col = mix(col, [70, 66, 62], vein * 0.5);
    col = mix(col, [120, 110, 80], clamp01(n2 - 0.65) * 1.5); // lichen
    const g = (rng() - 0.5) * 26;
    return { c: [col[0] + g, col[1] + g, col[2] + g], h: n1 * 0.7 + n2 * 0.3 - vein * 0.2 };
  }, 5);
}

export function barkTexture() {
  return pixelSurface('bark', SIZE, 59, (x, y, n1, n2, rng) => {
    const ridge = Math.pow(Math.abs(Math.sin((x / SIZE) * Math.PI * 14 + n1 * 5)), 0.6);
    const col = mix([55, 42, 30], [118, 96, 72], ridge * 0.7 + n2 * 0.3);
    return { c: col, h: ridge };
  }, 6);
}

export function facadeTexture() {
  if (cache.has('facade')) return cache.get('facade');
  const s = SIZE;
  const [c, ctx] = makeCanvas(s);
  const rng = mulberry32(61);
  ctx.fillStyle = '#9a958c';
  ctx.fillRect(0, 0, s, s);
  const cols = 4;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = (k / cols) * s + s * 0.04;
      const y = (r / rows) * s + s * 0.05;
      const w = s / cols - s * 0.08;
      const h = s / rows - s * 0.12;
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      const lit = rng() < 0.15;
      g.addColorStop(0, lit ? '#e8d6a8' : '#3a4a58');
      g.addColorStop(1, lit ? '#b89a62' : '#1b2630');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, h * 0.3);
      ctx.fillStyle = '#6e6a62';
      ctx.fillRect(x - 2, y + h, w + 4, 4);
      if (rng() < 0.2) {
        // A split AC unit.
        ctx.fillStyle = '#d8d8d4';
        ctx.fillRect(x + w * 0.6, y + h + 6, w * 0.32, h * 0.18);
      }
    }
  }
  const out = { map: toTexture(c), normalMap: null };
  cache.set('facade', out);
  return out;
}

// ---------- sprites and alpha cards ----------
function spriteTex(key, size, draw) {
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(size);
  draw(ctx, size);
  const t = toTexture(c, { repeat: false });
  cache.set(key, t);
  return t;
}

export const softDot = () =>
  spriteTex('softdot', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

export const smokePuff = () =>
  spriteTex('smoke', 256, (ctx, s) => {
    const rng = mulberry32(71);
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * s * 0.25;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      const rad = s * (0.12 + rng() * 0.18);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });

export const flashStar = () =>
  spriteTex('flash', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.2, 'rgba(255,200,90,0.9)');
    g.addColorStop(0.6, 'rgba(255,120,20,0.25)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.translate(s / 2, s / 2);
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(s * 0.48, 0);
      ctx.lineTo(0, 3);
      ctx.fill();
    }
  });

export const flameTex = () =>
  spriteTex('flame', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.55, s * 0.5);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.25, 'rgba(255,190,60,0.95)');
    g.addColorStop(0.6, 'rgba(240,80,10,0.5)');
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s / 2, s * 0.55, s * 0.32, s * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  });

export const bulletHole = () =>
  spriteTex('hole', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.22, 'rgba(15,12,10,0.9)');
    g.addColorStop(0.4, 'rgba(60,55,50,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

export const scorchTex = () =>
  spriteTex('scorch', 256, (ctx, s) => {
    const rng = mulberry32(83);
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * s * 0.3;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.22);
      g.addColorStop(0, 'rgba(10,8,6,0.5)');
      g.addColorStop(1, 'rgba(10,8,6,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });

export const bloodTex = () =>
  spriteTex('blood', 128, (ctx, s) => {
    const rng = mulberry32(89);
    ctx.fillStyle = 'rgba(110,8,8,0.9)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.arc(s / 2 + (rng() - 0.5) * s * 0.6, s / 2 + (rng() - 0.5) * s * 0.6, 2 + rng() * s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  });

export const ringTex = () =>
  spriteTex('ring', 256, (ctx, s) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = s * 0.012;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * s * 0.36, s / 2 + Math.sin(a) * s * 0.36);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4);
      ctx.stroke();
    }
  });

export const beamTex = () =>
  spriteTex('beam', 64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const v = ctx.createLinearGradient(0, 0, 0, s);
    v.addColorStop(0, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, s, s);
  });

export const grassCard = () =>
  spriteTex('grass', 256, (ctx, s) => {
    const rng = mulberry32(97);
    for (let i = 0; i < 70; i++) {
      const x = s * 0.1 + rng() * s * 0.8;
      const h = s * (0.35 + rng() * 0.6);
      const lean = (rng() - 0.5) * s * 0.3;
      const g = ctx.createLinearGradient(0, s, 0, s - h);
      const dry = rng();
      g.addColorStop(0, `rgb(${50 + dry * 40},${70 + dry * 30},${25})`);
      g.addColorStop(1, `rgb(${150 + dry * 70},${165 + dry * 30},${70 + dry * 20})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 3, s);
      ctx.quadraticCurveTo(x + lean * 0.4, s - h * 0.6, x + lean, s - h);
      ctx.quadraticCurveTo(x + lean * 0.4 + 2, s - h * 0.6, x + 3, s);
      ctx.fill();
    }
  });

export const leafCard = () =>
  spriteTex('leaf', 256, (ctx, s) => {
    const rng = mulberry32(101);
    for (let i = 0; i < 220; i++) {
      const x = s / 2 + (rng() - 0.5) * s * 0.9;
      const y = s / 2 + (rng() - 0.5) * s * 0.9;
      if (Math.hypot(x - s / 2, y - s / 2) > s * 0.46) continue;
      const g = 90 + rng() * 80;
      ctx.fillStyle = `rgb(${g * 0.45},${g},${g * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + rng() * 6, 2 + rng() * 3, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

export const frondCard = () =>
  spriteTex('frond', 256, (ctx, s) => {
    // A palm frond: midrib with leaflets, drawn along the texture's length.
    ctx.strokeStyle = '#4a5a22';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    for (let i = 0; i < 46; i++) {
      const y = (i / 46) * s;
      const len = s * 0.46 * Math.sin((i / 46) * Math.PI * 0.9 + 0.2);
      const g = 90 + (i % 5) * 14;
      ctx.strokeStyle = `rgb(${g * 0.5},${g},${g * 0.25})`;
      ctx.lineWidth = 3;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s / 2, y);
        ctx.quadraticCurveTo(s / 2 + sgn * len * 0.6, y + 4, s / 2 + sgn * len, y + 16);
        ctx.stroke();
      }
    }
  });

export function waterNormal() {
  if (cache.has('water')) return cache.get('water');
  const size = 256;
  const rng = mulberry32(111);
  const h = fbm(size, 5, rng, 8);
  const t = normalFromHeight(h, size, 6);
  cache.set('water', t);
  return t;
}

export function waterfallTex() {
  return spriteTex('falls', 256, (ctx, s) => {
    const rng = mulberry32(113);
    ctx.fillStyle = 'rgba(200,220,230,0.65)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      const x = rng() * s;
      const y = rng() * s;
      ctx.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.6})`;
      ctx.fillRect(x, y, 1 + rng() * 3, 10 + rng() * 40);
    }
  });
}

// ---------- signs, labels and advert placeholders ----------
export function labelTexture(lines, { w = 512, h = 128, bg = 'rgba(0,0,0,0)', colour = '#fff', font = 'Rajdhani', weight = 700, size = 54, stroke = true } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((line, i) => {
    const sz = i === 0 ? size : size * 0.6;
    ctx.font = `${weight} ${sz}px "${font}", sans-serif`;
    const y = h / 2 + (i - (list.length - 1) / 2) * size * 0.85;
    if (stroke) {
      ctx.lineWidth = sz * 0.14;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(line, w / 2, y);
    }
    ctx.fillStyle = colour;
    ctx.fillText(line, w / 2, y);
  });
  return toTexture(c, { repeat: false });
}

export function signboardTexture(title, sub) {
  const [c, ctx] = makeCanvas(1024, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0d4d2b');
  g.addColorStop(1, '#073019');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#e8e2c8';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 996, 228);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '700 78px "Rajdhani", sans-serif';
  ctx.fillText(title.toUpperCase(), 512, 120, 940);
  ctx.font = '600 40px "Rajdhani", sans-serif';
  ctx.fillStyle = '#d7e8c0';
  ctx.fillText(sub, 512, 196, 940);
  return toTexture(c, { repeat: false });
}

// "Your brand here" house adverts shown on walls nobody has bought yet.
const HOUSE = [
  { bg: ['#0b1220', '#13294b'], title: 'YOUR BRAND HERE', sub: 'Advertise on every wall in 36 States', accent: '#36d1ff' },
  { bg: ['#102a12', '#1f5a24'], title: 'ONE NIGERIA', sub: 'Play fair. Fight hard. Respect the ref.', accent: '#ffffff' },
  { bg: ['#2a0e0e', '#5a1818'], title: 'COLLECT THE 💎', sub: 'Every advert carries a life gem', accent: '#ffd23f' },
  { bg: ['#1d1630', '#3d2a6b'], title: 'BOOK THIS WALL', sub: 'Reach players in this state live', accent: '#ff7ad9' },
  { bg: ['#2b2008', '#6b4c0c'], title: '36 STATES', sub: 'Season One · The Battle for Nigeria', accent: '#ffcf4a' }
];
export function houseAdTexture(i) {
  const key = `house-${i % HOUSE.length}`;
  if (cache.has(key)) return cache.get(key);
  const h = HOUSE[i % HOUSE.length];
  const [c, ctx] = makeCanvas(1024, 480);
  const g = ctx.createLinearGradient(0, 0, 1024, 480);
  g.addColorStop(0, h.bg[0]);
  g.addColorStop(1, h.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 480);
  // Diagonal light streaks.
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#fff';
  for (let k = 0; k < 6; k++) {
    ctx.beginPath();
    ctx.moveTo(k * 220 - 100, 0);
    ctx.lineTo(k * 220 + 20, 0);
    ctx.lineTo(k * 220 - 160, 480);
    ctx.lineTo(k * 220 - 280, 480);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.fillStyle = h.accent;
  ctx.font = '400 110px "Black Ops One", Impact, sans-serif';
  ctx.fillText(h.title, 512, 230, 960);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 46px "Rajdhani", sans-serif';
  ctx.fillText(h.sub, 512, 320, 960);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 30px "Rajdhani", sans-serif';
  ctx.fillText('Advertise on this wall · talk to the 36 States team', 512, 420);
  const t = toTexture(c, { repeat: false });
  cache.set(key, t);
  return t;
}

export function flagTexture(side) {
  return spriteTex(`flag-${side}`, 256, (ctx, s) => {
    if (side === 'sec') {
      ctx.fillStyle = '#008751';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s / 3, 0, s / 3, s);
    } else {
      ctx.fillStyle = '#151515';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#8f1d1d';
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.lineTo(s, 0);
      ctx.lineTo(s, s * 0.25);
      ctx.lineTo(s * 0.25, s);
      ctx.fill();
    }
  });
}
