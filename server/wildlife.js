// Life in and around the water, on the server: crocodiles in the big rivers and lakes, and the
// skills soldiers train by doing (swimming, fitness) with the danger of deep water for anyone
// who can't swim yet.
import { bigWaters, deepWater, SKILLS, DROWN } from '../shared/skills.js';
import { inWater } from '../shared/map.js';

const now = () => Date.now();
export const CROC = { hp: 170, speed: 2.2, chase: 6.4, sight: 15, bite: 30, biteEvery: 1500, reach: 1.9, lunge: 1.4, respawnMs: 90000, hitR: 0.75 };

export class Wildlife {
  constructor(match) {
    this.m = match;
    this.map = match.map;
    const rng = match.rng;
    // One crocodile for every 45 m of big river (at most three on a map).
    this.crocs = [];
    for (const w of bigWaters(this.map)) {
      const n = Math.max(1, Math.min(2, Math.round(Math.max(w.x1 - w.x0, w.z1 - w.z0) / 45)));
      for (let k = 0; k < n && this.crocs.length < 3; k++) {
        const c = { i: this.crocs.length, w, hp: CROC.hp, state: 'lurk', x: 0, z: 0, yaw: rng() * 6.28, target: null, biteAt: 0, respawnAt: 0, goal: null };
        this.place(c);
        this.crocs.push(c);
      }
    }
  }

  place(c) {
    const w = c.w;
    const rng = this.m.rng;
    c.x = w.x0 + 3 + rng() * Math.max(0.5, w.x1 - w.x0 - 6);
    c.z = w.z0 + 3 + rng() * Math.max(0.5, w.z1 - w.z0 - 6);
    c.hp = CROC.hp;
    c.state = 'lurk';
    c.target = null;
  }

  view() {
    return this.crocs.map((c) => [c.i, +c.x.toFixed(2), +c.z.toFixed(2), +c.yaw.toFixed(2), c.state === 'dead' ? 2 : c.state === 'chase' ? 1 : 0]);
  }

  // Inside a crocodile's water (with a little lunge out onto the bank).
  inCrocWater(c, x, z, pad = 0) {
    const w = c.w;
    return x > w.x0 - pad && x < w.x1 + pad && z > w.z0 - pad && z < w.z1 + pad;
  }

  tick(dt) {
    const t = now();
    for (const c of this.crocs) {
      if (c.state === 'dead') {
        if (t >= c.respawnAt) this.place(c);
        continue;
      }
      // Who's in the water and close?
      let prey = null;
      let best = CROC.sight;
      for (const p of this.m.players.values()) {
        if (p.status !== 'alive' || p.veh != null || p.y > 0.6 || p.y < -1) continue;
        if (!this.inCrocWater(c, p.x, p.z, 0.8)) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < best) {
          best = d;
          prey = p;
        }
      }
      if (prey) {
        c.state = 'chase';
        const dx = prey.x - c.x;
        const dz = prey.z - c.z;
        const d = Math.hypot(dx, dz) || 1;
        c.yaw = Math.atan2(-dx, -dz);
        if (d > CROC.reach * 0.8) {
          const step = Math.min(d - CROC.reach * 0.7, CROC.chase * dt);
          const nx = c.x + (dx / d) * step;
          const nz = c.z + (dz / d) * step;
          if (this.inCrocWater(c, nx, nz, CROC.lunge)) {
            c.x = nx;
            c.z = nz;
          }
        }
        if (d <= CROC.reach && t - c.biteAt > CROC.biteEvery) {
          c.biteAt = t;
          this.m.broadcastNear(prey, { t: 'croc', a: 'bite', i: c.i, id: prey.id }, 60);
          this.m.damage(prey, null, CROC.bite, { weapon: 'croc', melee: true, from: [c.x, 0.3, c.z] });
          if (prey.human && prey.status === 'alive') this.m.toast(prey, '🐊 Crocodile dey bite you! Comot from the water!', 'bad');
        }
      } else {
        c.state = 'lurk';
        if (!c.goal || t > c.goal.until || Math.hypot(c.goal.x - c.x, c.goal.z - c.z) < 0.5) {
          const w = c.w;
          c.goal = { x: w.x0 + 3 + Math.random() * Math.max(0.5, w.x1 - w.x0 - 6), z: w.z0 + 3 + Math.random() * Math.max(0.5, w.z1 - w.z0 - 6), until: t + 9000 };
        }
        const dx = c.goal.x - c.x;
        const dz = c.goal.z - c.z;
        const d = Math.hypot(dx, dz) || 1;
        c.x += (dx / d) * Math.min(d, CROC.speed * dt);
        c.z += (dz / d) * Math.min(d, CROC.speed * dt);
        c.yaw = Math.atan2(-dx, -dz);
      }
    }
    this.trainAndDrown(dt, t);
  }

  // Bullets: the head and back show just above the water.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let hit = null;
    for (const c of this.crocs) {
      if (c.state === 'dead') continue;
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      for (const along of [-1.1, 0, 1.1]) {
        const cx = c.x + fx * along;
        const cz = c.z + fz * along;
        const cy = 0.05;
        const lx = ox - cx;
        const ly = oy - cy;
        const lz = oz - cz;
        const b = lx * dx + ly * dy + lz * dz;
        const cc = lx * lx + ly * ly + lz * lz - CROC.hitR * CROC.hitR;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const tt = -b - Math.sqrt(disc);
        if (tt > 0 && tt < maxT && (!hit || tt < hit.t)) hit = { c, t: tt };
      }
    }
    return hit;
  }

  hurt(c, dmg, by) {
    if (c.state === 'dead') return;
    c.hp -= dmg;
    if (c.hp > 0) return;
    c.state = 'dead';
    c.respawnAt = now() + CROC.respawnMs;
    this.m.broadcast({ t: 'croc', a: 'dead', i: c.i, by: by?.name || null });
    if (by?.human) {
      this.m.toast(by, '🐊 You don kill the crocodile! +75 XP', 'streak');
      this.m.addXP(by, 75);
    }
  }

  onBlast(x, y, z, radius, dmg, owner) {
    for (const c of this.crocs) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < radius && y < 2.5) this.hurt(c, dmg * (1 - d / radius), owner);
    }
  }

  // ---------- skills: swimming and fitness ----------
  trainAndDrown(dt, t) {
    const mult = this.m.practice ? SKILLS.practiceMult : 1;
    for (const p of this.m.players.values()) {
      if (!p.human || p.status !== 'alive' || p.veh != null) {
        p.drownT = 0;
        continue;
      }
      const sk = (p.profile.skills ||= { swim: 0, fitness: 0 });
      const moved = p.lastPos ? Math.hypot(p.x - p.lastPos.x, p.z - p.lastPos.z) : 0;
      p.lastPos = { x: p.x, z: p.z };
      const wet = p.y < 0.2 && p.y > -1 && inWater(this.map, p.x, p.z);
      if (wet && moved > 0.02) this.raise(p, 'swim', SKILLS.swim.perSec * mult * dt);
      if (p.sprint && moved > 0.1 && !wet) this.raise(p, 'fitness', SKILLS.fitness.perSec * mult * dt);
      // Deep water without the skill: you start to go under.
      if (wet && deepWater(this.map, p.x, p.z) && sk.swim < SKILLS.swim.canSwimAt) {
        if (!p.drownT) this.m.toast(p, `🌊 Deep water! You no sabi swim yet (${Math.floor(sk.swim)}/${SKILLS.swim.canSwimAt}). Go back to the bank, or train swimming.`, 'bad');
        p.drownT = (p.drownT || 0) + dt;
        if (p.drownT > DROWN.graceSecs) {
          p.drownAcc = (p.drownAcc || 0) + DROWN.dps * dt;
          if (p.drownAcc >= 3) {
            const hp = Math.floor(p.drownAcc);
            p.drownAcc -= hp;
            this.m.damage(p, null, hp, { weapon: 'drown', melee: true });
          }
        }
      } else p.drownT = 0;
    }
  }

  raise(p, key, n) {
    const sk = p.profile.skills;
    const before = sk[key] || 0;
    sk[key] = Math.min(SKILLS.max, before + n);
    const crossed = (lvl) => before < lvl && sk[key] >= lvl;
    if (key === 'swim' && crossed(SKILLS.swim.canSwimAt)) this.m.toast(p, '🏊 You don learn to swim! Deep water no go drown you again.', 'streak');
    if (key === 'swim' && crossed(SKILLS.swim.fastAt)) this.m.toast(p, '🏊 Strong swimmer: you dey move fast for water now.', 'streak');
    if (key === 'fitness' && (crossed(25) || crossed(50) || crossed(75) || crossed(100))) this.m.toast(p, `💪 Fitness ${Math.floor(sk.fitness)}: you fit run longer now.`, 'streak');
    if (Math.floor(before) !== Math.floor(sk[key])) this.m.hooks.saveProfile?.();
  }
}
