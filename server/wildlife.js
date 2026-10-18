// Animals on the server, so every player sees the same ones and can fight them: crocodiles in the
// big rivers and lakes, and stray dogs around the houses (some just bark and bolt at gunfire,
// guard dogs go for anyone who comes too close). Also the skills soldiers train by doing
// (swimming, fitness) with the danger of deep water for anyone who can't swim yet.
import { bigWaters, deepWater, SKILLS, DROWN } from '../shared/skills.js';
import { inWater } from '../shared/map.js';
import { moveBody, insideAnyBox } from '../shared/physics.js';

const now = () => Date.now();
export const CROC = { hp: 170, speed: 2.2, chase: 6.4, sight: 15, bite: 30, biteEvery: 1500, reach: 1.9, lunge: 1.4, respawnMs: 90000, hitR: 0.75, xp: 75 };
export const DOG = { hp: 45, walk: 1.6, run: 7.5, bite: 9, biteEvery: 1100, reach: 1.3, guardSight: 7, attackMs: 9000, respawnMs: 120000, hitR: 0.32, xp: 20 };

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
    // Stray dogs near the houses: two to six, about a third of them guard dogs.
    this.dogs = [];
    const homes = (this.map.buildings || []).filter((b) => !b.solid);
    const n = Math.min(6, Math.max(homes.length ? 2 : 0, Math.round(homes.length / 3)));
    for (let k = 0; k < n; k++) {
      const h = homes[Math.floor(rng() * homes.length)];
      const home = { x: h.x + (h.w / 2 + 2) * (rng() < 0.5 ? -1 : 1), z: h.z + (rng() - 0.5) * h.d };
      if (insideAnyBox(this.map.index, home.x, 0, home.z) || inWater(this.map, home.x, home.z)) continue;
      this.dogs.push({ i: this.dogs.length, home, guard: rng() < 0.35, hp: DOG.hp, state: 'wander', body: { x: home.x, y: 0, z: home.z, vy: 0, onGround: true, crouch: false }, yaw: rng() * 6.28, goal: null, until: 0, target: null, biteAt: 0, respawnAt: 0, barkAt: 0 });
    }
  }

  // Gunfire and blasts: plain strays bolt, guard dogs come for whoever is shooting close by.
  scare(x, z, r = 30, by = null) {
    const t = now();
    for (const d of this.dogs) {
      if (d.state === 'dead') continue;
      const dist = Math.hypot(d.body.x - x, d.body.z - z);
      if (dist > r) continue;
      if (d.guard && by && by.status === 'alive' && dist < 16) {
        d.state = 'attack';
        d.target = by.id;
        d.until = t + DOG.attackMs;
      } else if (d.state !== 'attack') {
        d.state = 'flee';
        d.until = t + 4000;
        d.goal = { x: d.body.x + (d.body.x - x) * 2, z: d.body.z + (d.body.z - z) * 2 };
      }
    }
  }

  tickDogs(dt, t) {
    for (const d of this.dogs) {
      const b = d.body;
      if (d.state === 'dead') {
        if (t >= d.respawnAt) Object.assign(d, { state: 'wander', hp: DOG.hp, target: null, body: { x: d.home.x, y: 0, z: d.home.z, vy: 0, onGround: true, crouch: false } });
        continue;
      }
      let wx = 0;
      let wz = 0;
      // Guard dogs notice anyone who comes too close to their patch and go for them.
      if (d.guard && d.state !== 'attack') {
        for (const p of this.m.players.values()) {
          if (p.status !== 'alive' || p.veh != null || p.y > 1.5) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < DOG.guardSight) {
            d.state = 'attack';
            d.target = p.id;
            d.until = t + DOG.attackMs;
            this.m.broadcastNear(p, { t: 'dog', a: 'bark', i: d.i }, 50);
            break;
          }
        }
      }
      if (d.state === 'attack') {
        const p = this.m.players.get(d.target);
        if (!p || p.status !== 'alive' || p.veh != null || t > d.until) {
          d.state = 'flee';
          d.until = t + 3000;
          d.goal = { x: d.home.x, z: d.home.z };
        } else {
          const dx = p.x - b.x;
          const dz = p.z - b.z;
          const dist = Math.hypot(dx, dz) || 1;
          d.yaw = Math.atan2(-dx, -dz);
          if (dist > DOG.reach * 0.8) {
            wx = (dx / dist) * DOG.run;
            wz = (dz / dist) * DOG.run;
          }
          if (dist <= DOG.reach && t - d.biteAt > DOG.biteEvery) {
            d.biteAt = t;
            this.m.broadcastNear(p, { t: 'dog', a: 'bite', i: d.i, id: p.id }, 50);
            this.m.damage(p, null, DOG.bite, { weapon: 'dog', melee: true, from: [b.x, 0.6, b.z] });
            if (p.human && p.status === 'alive' && Math.random() < 0.4) this.m.toast(p, 'A guard dog is biting you! Shoot it or use your machete.', 'bad');
          }
        }
      } else {
        if (d.state === 'flee' && t > d.until) d.state = 'wander';
        if (!d.goal || Math.hypot(d.goal.x - b.x, d.goal.z - b.z) < 0.5 || (d.state === 'wander' && Math.random() < dt * 0.15)) {
          d.goal = d.state === 'wander' && Math.random() < 0.4 ? null : { x: d.home.x + (Math.random() - 0.5) * 20, z: d.home.z + (Math.random() - 0.5) * 20 };
        }
        if (d.goal) {
          const dx = d.goal.x - b.x;
          const dz = d.goal.z - b.z;
          const len = Math.hypot(dx, dz) || 1;
          const sp = d.state === 'flee' ? DOG.run : DOG.walk;
          wx = (dx / len) * sp;
          wz = (dz / len) * sp;
          d.yaw = Math.atan2(-dx, -dz);
        }
      }
      if (inWater(this.map, b.x + wx * 0.3, b.z + wz * 0.3)) {
        wx = -wx;
        wz = -wz;
        d.goal = null;
      }
      moveBody(b, wx, wz, dt, this.map.index, this.map.half - 3, false);
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

  // Dogs for the snapshot: [i, x, z, yaw, state] with state 0 wander, 1 flee, 2 dead, 3 attack.
  dogView() {
    return this.dogs.map((d) => [d.i, +d.body.x.toFixed(2), +d.body.z.toFixed(2), +d.yaw.toFixed(2), { wander: 0, flee: 1, dead: 2, attack: 3 }[d.state]]);
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
          if (prey.human && prey.status === 'alive') this.m.toast(prey, '🐊 A crocodile is biting you! Get out of the water!', 'bad');
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
    this.tickDogs(dt, t);
    this.trainAndDrown(dt, t);
  }

  // Bullets: a crocodile's head and back show just above the water; a dog is small and low.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let hit = null;
    const sphere = (cx, cy, cz, r, c) => {
      const lx = ox - cx;
      const ly = oy - cy;
      const lz = oz - cz;
      const b = lx * dx + ly * dy + lz * dz;
      const cc = lx * lx + ly * ly + lz * lz - r * r;
      const disc = b * b - cc;
      if (disc < 0) return;
      const tt = -b - Math.sqrt(disc);
      if (tt > 0 && tt < maxT && (!hit || tt < hit.t)) hit = { c, t: tt };
    };
    for (const c of this.crocs) {
      if (c.state === 'dead') continue;
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      for (const along of [-1.1, 0, 1.1]) sphere(c.x + fx * along, 0.05, c.z + fz * along, CROC.hitR, c);
    }
    for (const d of this.dogs) {
      if (d.state === 'dead') continue;
      const fx = -Math.sin(d.yaw);
      const fz = -Math.cos(d.yaw);
      for (const along of [-0.22, 0.22]) sphere(d.body.x + fx * along, d.body.y + 0.5, d.body.z + fz * along, DOG.hitR, d);
    }
    return hit;
  }

  // Machete or fists at whatever animal is right in front of you.
  melee(p, fx, fz, reach, dmg) {
    let best = null;
    let bd = Infinity;
    for (const a of [...this.crocs, ...this.dogs]) {
      if (a.state === 'dead') continue;
      const ax = a.body ? a.body.x : a.x;
      const az = a.body ? a.body.z : a.z;
      const dx = ax - p.x;
      const dz = az - p.z;
      const dist = Math.hypot(dx, dz);
      const r = a.body ? reach : reach + 0.8;
      if (dist > r || (dx * fx + dz * fz) / (dist || 1) < 0.4) continue;
      if (dist < bd) {
        bd = dist;
        best = a;
      }
    }
    if (best) this.hurt(best, dmg, p);
    return !!best;
  }

  hurt(c, dmg, by) {
    if (c.state === 'dead') return;
    const dog = !!c.body;
    c.hp -= dmg;
    if (dog && c.hp > 0) {
      // Hurt dogs either run for it or (guard dogs) turn on whoever hurt them.
      if (c.guard && by?.status === 'alive') Object.assign(c, { state: 'attack', target: by.id, until: now() + DOG.attackMs });
      else Object.assign(c, { state: 'flee', until: now() + 5000, goal: { x: c.home.x, z: c.home.z } });
      this.m.broadcast({ t: 'dog', a: 'yelp', i: c.i });
    }
    if (c.hp > 0) return;
    c.state = 'dead';
    c.respawnAt = now() + (dog ? DOG.respawnMs : CROC.respawnMs);
    if (dog) this.m.broadcast({ t: 'dog', a: 'dead', i: c.i, by: by?.name || null });
    else this.m.broadcast({ t: 'croc', a: 'dead', i: c.i, by: by?.name || null });
    if (by?.human) {
      const xp = dog ? DOG.xp : CROC.xp;
      this.m.toast(by, dog ? `Guard dog down. +${xp} XP` : `You killed the crocodile! +${xp} XP`, 'streak');
      this.m.addXP(by, xp);
    }
  }

  onBlast(x, y, z, radius, dmg, owner) {
    for (const c of this.crocs) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < radius && y < 2.5) this.hurt(c, dmg * (1 - d / radius), owner);
    }
    for (const g of this.dogs) {
      const d = Math.hypot(g.body.x - x, g.body.z - z);
      if (d < radius) this.hurt(g, dmg * (1 - d / radius), owner);
    }
    this.scare(x, z, radius * 4);
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
        if (!p.drownT) this.m.toast(p, `🌊 Deep water! You cannot swim yet (${Math.floor(sk.swim)}/${SKILLS.swim.canSwimAt}). Go back to the bank, or train swimming.`, 'bad');
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
    if (key === 'swim' && crossed(SKILLS.swim.canSwimAt)) this.m.toast(p, '🏊 You learned to swim! Deep water will not drown you any more.', 'streak');
    if (key === 'swim' && crossed(SKILLS.swim.fastAt)) this.m.toast(p, '🏊 Strong swimmer: you move fast in the water now.', 'streak');
    if (key === 'fitness' && (crossed(25) || crossed(50) || crossed(75) || crossed(100))) this.m.toast(p, `💪 Fitness ${Math.floor(sk.fitness)}: you can run longer now.`, 'streak');
    if (Math.floor(before) !== Math.floor(sk[key])) this.m.hooks.saveProfile?.();
  }
}
