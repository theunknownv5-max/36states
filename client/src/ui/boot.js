// Cinematic boot: "POWERED BY BUSINESS GAME EXPERIENCE", then a burning night skyline with searchlights,
// tracers, artillery flashes and drifting smoke; the POD logo slams in with a shockwave,
// an ammo belt fills as the game loads and the radio crackles in Pidgin.
import { GAME } from '../../../shared/config.js';

const TIPS = [
  'Every advert wall has a 💎 life gem. Once taken, nobody can take it again for 2 minutes.',
  'If you go down, a teammate has 10 seconds to revive you. Call for help!',
  'As a spirit, enemies cannot see you. Run to any glowing gem.',
  'Bullets go through mud, tin and plank walls. Concrete stops them.',
  'Red drums marked PMS are fuel. Shoot one near enemies and watch it blow.',
  'Running makes noise. Hold Z to walk quietly.',
  'For Plant & Defuse, one life per round. Plan well before you rush.',
  'The Army can call artillery after 4 kills. Everyone else needs 5.',
  'A gold beam on the map means a new deposit was found. It is worth double points.',
  'When scoped with a sniper, hold Shift to steady your aim.',
  'Campaign stage: clear it without dying to earn 3 stars.'
];

const RADIO = [
  '[RADIO] Alpha One, have you reached the objective? Over.',
  '[RADIO] Bandits moving along the creek. Eyes open!',
  '[RADIO] HQ, we need medevac for Sector B. Quick quick!',
  '[RADIO] Who get eyes on the gas flare? Over.',
  '[RADIO] Charlie team, hold that ground. No shaking!',
  '[RADIO] Drone is up. Enemy positions on radar.',
  '[RADIO] Bomb planted at site A! Defuse it now!',
  '[RADIO] All units: this is Proof of Duty. Over and out.'
];

export class Boot {
  constructor() {
    this.el = document.getElementById('boot');
    this.canvas = document.getElementById('boot-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pctEl = document.getElementById('boot-pct');
    this.tip = document.getElementById('boot-tip');
    this.radio = document.getElementById('boot-radio-text');
    this.belt = document.getElementById('boot-belt');
    document.getElementById('boot-version').textContent = GAME.version;
    // Ammo belt: 24 rounds that fill as the game loads.
    this.rounds = [];
    for (let i = 0; i < 24; i++) {
      const r = document.createElement('i');
      this.belt.appendChild(r);
      this.rounds.push(r);
    }
    this.progress = 0;
    this.shown = 0;
    this.t0 = performance.now();
    this.tracers = [];
    this.flashes = [];
    this.rings = [];
    this.embers = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random(), v: 0.02 + Math.random() * 0.06, w: Math.random() * 6 }));
    this.smoke = Array.from({ length: 14 }, (_, i) => ({ x: Math.random(), y: 0.45 + Math.random() * 0.4, r: 0.12 + Math.random() * 0.2, v: 0.004 + Math.random() * 0.008, a: 0.1 + Math.random() * 0.15, i }));
    this.skyline = this.makeSkyline();
    this.tipI = Math.floor(Math.random() * TIPS.length);
    this.tip.textContent = TIPS[this.tipI];
    this.tipTimer = setInterval(() => {
      this.tipI = (this.tipI + 1) % TIPS.length;
      this.tip.classList.remove('in');
      void this.tip.offsetWidth;
      this.tip.textContent = TIPS[this.tipI];
      this.tip.classList.add('in');
    }, 4200);
    this.radioI = 0;
    this.typeRadio();
    this.resize = () => {
      const r = Math.min(1.5, devicePixelRatio || 1);
      this.canvas.width = innerWidth * r;
      this.canvas.height = innerHeight * r;
    };
    this.resize();
    addEventListener('resize', this.resize);
    // The logo lands after the credit.
    setTimeout(() => {
      this.el.classList.add('logo-in');
      this.rings.push({ t: 0 });
      this.flashes.push({ x: 0.5, life: 1, big: true });
      this.shake = 1;
    }, 1700);
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  typeRadio() {
    const line = RADIO[this.radioI % RADIO.length];
    this.radioI++;
    let i = 0;
    clearInterval(this.typeTimer);
    this.typeTimer = setInterval(() => {
      i++;
      this.radio.textContent = line.slice(0, i);
      if (i >= line.length) {
        clearInterval(this.typeTimer);
        this.radioTimer = setTimeout(() => this.running && this.typeRadio(), 1800);
      }
    }, 28);
  }

  // A distant city skyline with a cable bridge, like the logo.
  makeSkyline() {
    const blocks = [];
    let x = 0;
    while (x < 1) {
      const w = 0.015 + Math.random() * 0.045;
      blocks.push({ x, w, h: 0.05 + Math.random() * (Math.random() < 0.15 ? 0.3 : 0.14), lights: Math.random() });
      x += w + Math.random() * 0.01;
    }
    return blocks;
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
    const pct = Math.round(this.shown * 100);
    this.pctEl.textContent = pct;
    const filled = Math.round(this.shown * this.rounds.length);
    this.rounds.forEach((r, i) => r.classList.toggle('on', i < filled));
    this.shake = (this.shake || 0) * 0.9;
    c.save();
    if (this.shake > 0.01) c.translate((Math.random() - 0.5) * 18 * this.shake, (Math.random() - 0.5) * 18 * this.shake);
    // Burning night sky.
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#040304');
    sky.addColorStop(0.55, '#1a0904');
    sky.addColorStop(0.78, '#5a1d06');
    sky.addColorStop(1, '#120603');
    c.fillStyle = sky;
    c.fillRect(-20, -20, W + 40, H + 40);
    // Big low sun / fire glow behind the city.
    const gx = W * 0.5;
    const gy = H * 0.74;
    const glow = c.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.55);
    glow.addColorStop(0, `rgba(255,140,30,${0.55 + Math.sin(t * 1.3) * 0.05})`);
    glow.addColorStop(0.35, 'rgba(200,70,10,0.25)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    // Searchlights sweeping the sky.
    for (let i = 0; i < 3; i++) {
      const bx = W * (0.15 + i * 0.35);
      const a = -Math.PI / 2 + Math.sin(t * (0.35 + i * 0.13) + i * 2) * 0.55;
      const len = H * 1.1;
      const g = c.createLinearGradient(bx, H * 0.8, bx + Math.cos(a) * len, H * 0.8 + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,230,180,0.16)');
      g.addColorStop(1, 'rgba(255,230,180,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(bx, H * 0.8);
      c.lineTo(bx + Math.cos(a - 0.05) * len, H * 0.8 + Math.sin(a - 0.05) * len);
      c.lineTo(bx + Math.cos(a + 0.05) * len, H * 0.8 + Math.sin(a + 0.05) * len);
      c.closePath();
      c.fill();
    }
    // Smoke drifting across.
    for (const s of this.smoke) {
      s.x += s.v / 60;
      if (s.x - s.r > 1.1) s.x = -s.r;
      const r = s.r * W;
      const g = c.createRadialGradient(s.x * W, s.y * H, 0, s.x * W, s.y * H, r);
      g.addColorStop(0, `rgba(60,40,30,${s.a})`);
      g.addColorStop(1, 'rgba(60,40,30,0)');
      c.fillStyle = g;
      c.fillRect(s.x * W - r, s.y * H - r, r * 2, r * 2);
    }
    // City skyline and bridge silhouette.
    const base = H * 0.82;
    c.fillStyle = '#080404';
    for (const b of this.skyline) {
      c.fillRect(b.x * W, base - b.h * H, b.w * W + 1, b.h * H + 2);
      if (b.lights > 0.5) {
        c.fillStyle = 'rgba(255,170,80,0.5)';
        for (let k = 0; k < 4; k++) if (Math.sin(b.x * 999 + k * 7 + Math.floor(t * 0.5)) > 0.6) c.fillRect(b.x * W + 3 + (k % 2) * 6, base - b.h * H + 8 + k * 9, 2, 3);
        c.fillStyle = '#080404';
      }
    }
    const px = W * 0.82;
    c.strokeStyle = '#080404';
    c.lineWidth = Math.max(2, W * 0.004);
    c.beginPath();
    c.moveTo(px - W * 0.012, base);
    c.lineTo(px, base - H * 0.26);
    c.lineTo(px + W * 0.012, base);
    c.stroke();
    c.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      c.beginPath();
      c.moveTo(px, base - H * (0.06 + k * 0.022));
      c.lineTo(px - W * (0.04 + k * 0.022), base - 4);
      c.moveTo(px, base - H * (0.06 + k * 0.022));
      c.lineTo(px + W * (0.04 + k * 0.022), base - 4);
      c.stroke();
    }
    c.fillStyle = '#050303';
    c.fillRect(0, base, W, H - base);
    // Tracers.
    if (Math.random() < 0.22) {
      const left = Math.random() < 0.5;
      this.tracers.push({ x: left ? 0 : W, y: H * (0.55 + Math.random() * 0.3), vx: (left ? 1 : -1) * W * (0.9 + Math.random() * 0.7), vy: -H * (0.25 + Math.random() * 0.35), life: 1.3, col: Math.random() < 0.6 ? '#ffd27a' : '#ff5a3a' });
    }
    c.lineCap = 'round';
    for (const tr of this.tracers) {
      tr.life -= 1 / 60;
      const x2 = tr.x + tr.vx / 60;
      const y2 = tr.y + tr.vy / 60;
      c.strokeStyle = tr.col;
      c.globalAlpha = Math.max(0, tr.life);
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(tr.x, tr.y);
      c.lineTo(x2 + tr.vx * 0.05, y2 + tr.vy * 0.05);
      c.stroke();
      tr.x = x2;
      tr.y = y2;
      tr.vy += H * 0.006;
    }
    c.globalAlpha = 1;
    this.tracers = this.tracers.filter((tr) => tr.life > 0);
    // Artillery flashes on the horizon.
    if (Math.random() < 0.025) {
      this.flashes.push({ x: Math.random(), life: 1 });
      this.shake = Math.max(this.shake, 0.25);
    }
    for (const f of this.flashes) {
      f.life -= f.big ? 0.02 : 0.035;
      const g = c.createRadialGradient(f.x * W, base, 0, f.x * W, base, H * (f.big ? 1 : 0.45));
      g.addColorStop(0, `rgba(255,190,90,${f.life * (f.big ? 0.8 : 0.45)})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    this.flashes = this.flashes.filter((f) => f.life > 0);
    // Shockwave ring when the logo lands.
    for (const r of this.rings) {
      r.t += 1 / 60;
      const rad = r.t * Math.max(W, H) * 0.9;
      c.strokeStyle = `rgba(255,170,70,${Math.max(0, 0.7 - r.t)})`;
      c.lineWidth = 6 * (1 - r.t);
      c.beginPath();
      c.arc(W / 2, H * 0.42, rad, 0, Math.PI * 2);
      c.stroke();
    }
    this.rings = this.rings.filter((r) => r.t < 1);
    // Embers.
    for (const e of this.embers) {
      e.y -= e.v / 60;
      e.x += Math.sin(t * 1.5 + e.w) * 0.0006;
      if (e.y < 0) {
        e.y = 1;
        e.x = Math.random();
      }
      c.fillStyle = `rgba(255,${120 + e.s * 90},40,${0.35 + e.s * 0.45})`;
      c.fillRect(e.x * W, e.y * H, 1.5 * e.s + 1, 1.5 * e.s + 1);
    }
    // Vignette.
    const v = c.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.9);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.8)');
    c.fillStyle = v;
    c.fillRect(-20, -20, W + 40, H + 40);
    c.restore();
    requestAnimationFrame(this.loop);
  }

  // Wait for a tap (needed anyway to start sound).
  ready() {
    this.set(1);
    const btn = document.getElementById('boot-enter');
    setTimeout(() => (btn.hidden = false), 400);
    return new Promise((res) => {
      btn.onclick = () => {
        this.el.classList.add('leaving');
        setTimeout(res, 450);
      };
    });
  }

  hide() {
    this.running = false;
    clearInterval(this.tipTimer);
    clearInterval(this.typeTimer);
    clearTimeout(this.radioTimer);
    removeEventListener('resize', this.resize);
    this.el.hidden = true;
  }
}
