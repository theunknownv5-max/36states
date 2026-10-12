// Cinematic boot screen: a smoky night over Nigeria, every state lighting up as
// the game loads, tracers and artillery flashes on the horizon.
import { STATES } from '../../../shared/states.js';
import { OUTLINE, projector } from './nigeria.js';

const TIPS = [
  'Every advert wall carries a 💎 life gem. Grab it, and nobody else can for two minutes.',
  'Down but not out: a teammate has 10 seconds to revive you.',
  'As a spirit you are invisible to the enemy. Run for a glowing gem.',
  'Thin walls — mud, zinc, planks — can be shot through. Concrete cannot.',
  'Sprinting is loud. Hold Z to walk quietly; vigilantes are silent anyway.',
  'Army units call artillery after four kills instead of five.',
  'Mid-match discoveries are worth double. Watch for the gold beam.',
  'Smuggler income: +30% from every site your side holds.',
  'Crouch and aim down sights for a steady shot.',
  'Creek militants move fast through water and pay less for explosives.'
];

export class Boot {
  constructor() {
    this.el = document.getElementById('boot');
    this.canvas = document.getElementById('boot-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fill = document.getElementById('boot-fill');
    this.tip = document.getElementById('boot-tip');
    this.progress = 0;
    this.shown = 0;
    this.t0 = performance.now();
    this.tracers = [];
    this.embers = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random(), v: 0.02 + Math.random() * 0.05 }));
    this.flashes = [];
    this.tipI = Math.floor(Math.random() * TIPS.length);
    this.tip.textContent = TIPS[this.tipI];
    this.tipTimer = setInterval(() => {
      this.tipI = (this.tipI + 1) % TIPS.length;
      this.tip.textContent = TIPS[this.tipI];
    }, 3800);
    this.resize = () => {
      const r = devicePixelRatio > 1.5 ? 1.5 : devicePixelRatio;
      this.canvas.width = innerWidth * r;
      this.canvas.height = innerHeight * r;
    };
    this.resize();
    addEventListener('resize', this.resize);
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  set(p, text) {
    this.progress = Math.max(this.progress, p);
    if (text) this.tip.textContent = text;
  }

  loop(now) {
    if (!this.running) return;
    const t = (now - this.t0) / 1000;
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.shown += (this.progress - this.shown) * 0.08;
    this.fill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    // Night sky with a warm glow of battle on the horizon.
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#05070a');
    sky.addColorStop(0.65, '#0b1210');
    sky.addColorStop(1, '#2a160c');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    // Map of Nigeria, glowing.
    const mapW = Math.min(W * 0.85, H * 1.1);
    const mapH = mapW * 0.86;
    const project = projector(mapW, mapH, 10);
    const ox = (W - mapW) / 2;
    const oy = (H - mapH) / 2 + H * 0.02;
    c.save();
    c.translate(ox, oy);
    c.beginPath();
    OUTLINE.forEach(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.closePath();
    const land = c.createRadialGradient(mapW / 2, mapH / 2, 0, mapW / 2, mapH / 2, mapW * 0.6);
    land.addColorStop(0, 'rgba(15,122,70,0.22)');
    land.addColorStop(1, 'rgba(15,122,70,0.05)');
    c.fillStyle = land;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = `rgba(47,213,133,${0.35 + Math.sin(t * 2) * 0.1})`;
    c.shadowColor = '#2fd585';
    c.shadowBlur = 18;
    c.stroke();
    c.shadowBlur = 0;
    // States ignite one by one with load progress.
    const lit = Math.floor(this.shown * STATES.length + t * 2) % (STATES.length + 1);
    STATES.forEach((s, i) => {
      const [x, y] = project(s.lon, s.lat);
      const on = i < Math.max(lit, this.shown * STATES.length);
      const pulse = 0.5 + Math.sin(t * 3 + i) * 0.5;
      c.beginPath();
      c.arc(x, y, on ? 3 + pulse * 2 : 2, 0, Math.PI * 2);
      c.fillStyle = on ? (i % 3 === 0 ? '#ff5a4f' : '#ffcf4a') : 'rgba(255,255,255,0.25)';
      c.shadowColor = c.fillStyle;
      c.shadowBlur = on ? 14 : 0;
      c.fill();
    });
    c.shadowBlur = 0;
    c.restore();
    // Tracers across the sky.
    if (Math.random() < 0.18) {
      const fromLeft = Math.random() < 0.5;
      this.tracers.push({ x: fromLeft ? 0 : W, y: H * (0.55 + Math.random() * 0.4), vx: (fromLeft ? 1 : -1) * W * (0.9 + Math.random() * 0.6), vy: -H * (0.2 + Math.random() * 0.3), life: 1.4, col: Math.random() < 0.5 ? '#ffcf7a' : '#ff6a4a' });
    }
    c.lineCap = 'round';
    for (const tr of this.tracers) {
      tr.life -= 1 / 60;
      const x2 = tr.x + tr.vx / 60;
      const y2 = tr.y + tr.vy / 60;
      c.strokeStyle = tr.col;
      c.globalAlpha = Math.max(0, tr.life);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(tr.x, tr.y);
      c.lineTo(x2 + tr.vx * 0.04, y2 + tr.vy * 0.04);
      c.stroke();
      tr.x = x2;
      tr.y = y2;
      tr.vy += H * 0.006;
    }
    c.globalAlpha = 1;
    this.tracers = this.tracers.filter((tr) => tr.life > 0);
    // Artillery flashes on the horizon.
    if (Math.random() < 0.03) this.flashes.push({ x: Math.random() * W, life: 1 });
    for (const f of this.flashes) {
      f.life -= 0.03;
      const g = c.createRadialGradient(f.x, H, 0, f.x, H, H * 0.5);
      g.addColorStop(0, `rgba(255,150,60,${f.life * 0.5})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    this.flashes = this.flashes.filter((f) => f.life > 0);
    // Embers rising.
    for (const e of this.embers) {
      e.y -= e.v / 60;
      e.x += Math.sin(t + e.s * 10) * 0.0005;
      if (e.y < 0) {
        e.y = 1;
        e.x = Math.random();
      }
      c.fillStyle = `rgba(255,${120 + e.s * 80},40,${0.3 + e.s * 0.4})`;
      c.fillRect(e.x * W, e.y * H, 2 * e.s + 1, 2 * e.s + 1);
    }
    // Vignette.
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.75)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
    requestAnimationFrame(this.loop);
  }

  // Wait for a click (needed anyway to start audio).
  ready() {
    this.set(1, 'Ready.');
    const btn = document.getElementById('boot-enter');
    btn.hidden = false;
    return new Promise((res) => {
      btn.onclick = () => res();
    });
  }

  hide() {
    this.running = false;
    clearInterval(this.tipTimer);
    removeEventListener('resize', this.resize);
    this.el.hidden = true;
  }
}
