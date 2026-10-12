// Server-side soldiers that fill empty slots so every state always has a fight.
// They see with line-of-sight (smoke blocks them), react with a human-like delay,
// spray in bursts with recoil-like error, capture sites, hunt, throw grenades and call streaks.
import { WEAPONS, PLAYER, KILLSTREAKS, FACTIONS } from '../shared/config.js';
import { moveBody, lineBlocked, spreadDir, normalise } from '../shared/physics.js';
import { findPath, inWater } from '../shared/map.js';

const now = () => Date.now();
const NAMES = ['Musa', 'Emeka', 'Tunde', 'Ngozi', 'Aisha', 'Kelechi', 'Bello', 'Ifeanyi', 'Yusuf', 'Chidi', 'Femi', 'Halima', 'Obinna', 'Sani', 'Uche', 'Bayo', 'Danjuma', 'Efosa', 'Garba', 'Ikenna', 'Zainab', 'Tobi', 'Ebuka', 'Amina', 'Segun', 'Nnamdi', 'Ladi', 'Osas', 'Kabiru', 'Tamuno'];
const SEC_RANKS = ['Pte', 'Cpl', 'Sgt', 'Insp', 'Lt'];
const OUT_TAGS = ['', 'Baba', 'Small', 'Big', 'Oga'];

export function botName(rng, side) {
  const n = NAMES[Math.floor(rng() * NAMES.length)];
  const pre = side === 'sec' ? SEC_RANKS[Math.floor(rng() * SEC_RANKS.length)] : OUT_TAGS[Math.floor(rng() * OUT_TAGS.length)];
  return `${pre ? `${pre} ` : ''}${n} [BOT]`;
}

const LOADOUTS = {
  police: [['mp5', 0.6], ['ak47', 0.4]],
  army: [['g3', 0.7], ['pkm', 0.12], ['svd', 0.18]],
  civildefence: [['ak47', 0.55], ['pkm', 0.45]],
  vigilante: [['danegun', 0.45], ['ak47', 0.55]],
  bandit: [['ak47', 0.8], ['pkm', 0.2]],
  militant: [['ak47', 0.7], ['mp5', 0.3]],
  smuggler: [['mp5', 0.5], ['ak47', 0.5]]
};

export function botLoadout(faction, rng) {
  const list = LOADOUTS[faction] || LOADOUTS.police;
  let r = rng();
  for (const [w, p] of list) {
    if ((r -= p) <= 0) return w;
  }
  return list[0][0];
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class BotBrain {
  constructor(match) {
    this.match = match;
    this.respawnAt = 0;
    this.skill = 0.55 + Math.random() * 0.35; // 0..1, higher = better aim and faster reactions
  }

  onSpawn(p) {
    this.target = null;
    this.reactAt = 0;
    this.lastSeen = null;
    this.path = null;
    this.goal = null;
    this.repathAt = 0;
    this.thinkTimer = Math.random() * 0.2;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeUntil = 0;
    this.burst = 0;
    this.pauseUntil = 0;
    this.hurtBy = null;
    this.stuckCheck = { t: now(), x: p.x, z: p.z };
    this.crouchUntil = 0;
    this.engagedAt = 0;
  }

  onHurt(attacker) {
    if (attacker) this.hurtBy = { id: attacker.id, t: now() };
  }

  useStreak(kind) {
    const m = this.match;
    const me = [...m.players.values()].find((p) => p.bot === this);
    if (!me) return;
    setTimeout(() => {
      if (!me.streaksAvail[kind] || !m.players.has(me.id)) return;
      me.streaksAvail[kind] = false;
      if (kind === 'uav') {
        m.uav[me.side] = now() + KILLSTREAKS.uav.duration * 1000;
        m.broadcast({ t: 'uav', side: me.side, until: m.uav[me.side], by: me.name });
      } else {
        // Shell the enemy-held site, or the last place an enemy was seen.
        const enemySite = m.sites.find((s) => s.owner && s.owner !== me.side);
        const spot = enemySite || this.lastSeen || m.map.bases[me.side === 'sec' ? 'out' : 'sec'];
        m.callArtillery(me, spot.x + (Math.random() - 0.5) * 6, spot.z + (Math.random() - 0.5) * 6);
      }
    }, 1200 + Math.random() * 2000);
  }

  eye(p) {
    return [p.x, p.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye), p.z];
  }

  perceive(p) {
    const m = this.match;
    const t = now();
    const [ex, ey, ez] = this.eye(p);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let best = null;
    let bestD = Infinity;
    for (const o of m.players.values()) {
      if (o.side === p.side || (o.status !== 'alive' && o.status !== 'downed')) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) continue;
      const facing = (dx * fx + dz * fz) / (dist || 1);
      const heard = t - o.firedAt < 1500 && dist < 45;
      const shotMe = this.hurtBy && this.hurtBy.id === o.id && t - this.hurtBy.t < 3000;
      if (facing < 0.25 && dist > 10 && !heard && !shotMe) continue;
      const chestY = o.y + (o.status === 'downed' ? 0.3 : o.crouch ? 0.8 : 1.2);
      if (lineBlocked(m.map.index, ex, ey, ez, o.x, chestY, o.z, m.smokes)) {
        if (heard && dist < 30 && !this.target) this.lastSeen = { x: o.x, z: o.z, t };
        continue;
      }
      const score = dist * (o.status === 'downed' ? 1.6 : 1);
      if (score < bestD) {
        bestD = score;
        best = o;
      }
    }
    if (best) {
      if (!this.target || this.target.id !== best.id) {
        this.reactAt = t + (650 - this.skill * 380) + Math.random() * 200;
        this.engagedAt = this.reactAt;
      }
      this.target = best;
      this.lastSeen = { x: best.x, z: best.z, t };
    } else {
      // Lost sight: maybe throw a grenade where they were.
      if (this.target && this.lastSeen && p.frag > 0 && Math.random() < 0.25) {
        const d = Math.hypot(this.lastSeen.x - p.x, this.lastSeen.z - p.z);
        if (d > 9 && d < 28) this.throwAt(p, this.lastSeen.x, this.lastSeen.z);
      }
      this.target = null;
    }
  }

  throwAt(p, x, z) {
    const T = 1.15;
    const o = this.eye(p);
    const v = [(x - o[0]) / T, (0.2 - o[1] + 0.5 * PLAYER.gravity * T * T) / T, (z - o[2]) / T];
    const sp = Math.hypot(...v);
    const vv = sp > 22 ? v.map((c) => (c / sp) * 22) : v;
    p.frag--;
    this.match.throwGrenade(p, 'frag', o, vv);
  }

  // Where should this bot be going?
  chooseGoal(p) {
    const m = this.match;
    const t = now();
    if (this.lastSeen && !this.target && t - this.lastSeen.t < 4500) {
      this.setGoal(p, this.lastSeen.x, this.lastSeen.z, 'hunt');
      return;
    }
    if (this.goal && this.goal.kind === 'site' && t < this.goal.until) {
      const site = this.goal.site;
      const mine = site.owner === p.side && Math.abs(site.progress) >= 1;
      if (!mine || Math.random() < 0.97) return;
    }
    const sites = m.discovery ? [...m.sites, m.discovery] : m.sites;
    let best = null;
    let bestScore = Infinity;
    for (const s of sites) {
      const dist = Math.hypot(s.x - p.x, s.z - p.z);
      let score = dist;
      if (s.owner === p.side) score += 90 + Math.random() * 60; // already ours: lower priority (defend sometimes)
      if (s.contested) score -= 25;
      if (s.id === 'D') score -= 30;
      score += Math.random() * 40;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * best.r * 0.6;
    this.setGoal(p, best.x + Math.cos(a) * r, best.z + Math.sin(a) * r, 'site', best);
  }

  setGoal(p, x, z, kind, site = null) {
    if (this.goal && this.goal.kind === kind && Math.hypot(this.goal.x - x, this.goal.z - z) < 3) return;
    this.goal = { x, z, kind, site, until: now() + 15000 + Math.random() * 15000 };
    this.path = findPath(this.match.map.nav, p.x, p.z, x, z);
    this.repathAt = now() + 5000;
  }

  tick(p, dt) {
    const m = this.match;
    const t = now();
    if (p.status === 'dead') {
      if (t >= this.respawnAt) m.spawn(p);
      return;
    }
    if (p.status !== 'alive') return;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.2;
      this.perceive(p);
      if (!this.target) this.chooseGoal(p);
    }

    let wishX = 0;
    let wishZ = 0;
    let speed = PLAYER.run * 0.9 * (FACTIONS[p.faction].perks.speedMult || 1);
    const blind = t < p.blindUntil;
    const tgt = this.target;

    if (tgt && (tgt.status === 'alive' || tgt.status === 'downed') && !blind) {
      // Turn toward the target.
      const [ex, ey, ez] = this.eye(p);
      const ty = tgt.y + (tgt.status === 'downed' ? 0.3 : tgt.crouch ? 0.85 : 1.25);
      const dx = tgt.x - ex;
      const dz = tgt.z - ez;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(ty - ey, dist);
      const turn = (3 + this.skill * 5) * dt;
      const dy = angleDiff(wantYaw, p.yaw);
      p.yaw += Math.max(-turn, Math.min(turn, dy));
      p.pitch += Math.max(-turn, Math.min(turn, wantPitch - p.pitch));
      // Strafe while fighting.
      if (t > this.strafeUntil) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + 500 + Math.random() * 900;
        if (Math.random() < 0.25) this.crouchUntil = t + 1200;
      }
      p.crouch = t < this.crouchUntil;
      const sx = Math.cos(p.yaw) * this.strafeDir;
      const sz = -Math.sin(p.yaw) * this.strafeDir;
      speed = p.crouch ? PLAYER.crouchSpeed : PLAYER.walk;
      wishX = sx * speed;
      wishZ = sz * speed;
      if (dist > 45) {
        wishX += -Math.sin(p.yaw) * PLAYER.walk * 0.7;
        wishZ += -Math.cos(p.yaw) * PLAYER.walk * 0.7;
      }
      if (t >= this.reactAt && Math.abs(dy) < 0.2) this.shoot(p, tgt, dist);
    } else {
      p.crouch = false;
      this.burst = 0;
      // Follow the path.
      if (this.path && this.path.length) {
        const [wx, wz] = this.path[0];
        const dx = wx - p.x;
        const dz = wz - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.3) this.path.shift();
        else {
          wishX = (dx / d) * speed;
          wishZ = (dz / d) * speed;
          const wantYaw = Math.atan2(-dx, -dz);
          p.yaw += angleDiff(wantYaw, p.yaw) * Math.min(1, dt * 6);
          p.pitch *= 0.9;
        }
      } else if (this.goal && this.goal.kind === 'site') {
        // Holding a site: wander a little inside it.
        if (Math.random() < dt * 0.4) {
          const s = this.goal.site;
          const a = Math.random() * Math.PI * 2;
          this.path = [[s.x + Math.cos(a) * s.r * 0.5, s.z + Math.sin(a) * s.r * 0.5]];
        }
        p.yaw += dt * 0.6 * this.strafeDir;
      } else if (this.goal && this.goal.kind === 'hunt') {
        this.goal = null;
      }
      if (t > this.repathAt && this.goal) {
        this.path = findPath(m.map.nav, p.x, p.z, this.goal.x, this.goal.z);
        this.repathAt = t + 5000;
      }
      // Unstick.
      if (t - this.stuckCheck.t > 1500) {
        const moved = Math.hypot(p.x - this.stuckCheck.x, p.z - this.stuckCheck.z);
        if (moved < 0.4 && this.goal && this.path?.length) {
          this.path = findPath(m.map.nav, p.x + (Math.random() - 0.5) * 2, p.z + (Math.random() - 0.5) * 2, this.goal.x, this.goal.z);
          this.jump = true;
        }
        this.stuckCheck = { t, x: p.x, z: p.z };
      }
    }
    if (inWater(m.map, p.x, p.z)) {
      wishX *= 0.6;
      wishZ *= 0.6;
    }
    moveBody(p, wishX, wishZ, dt, m.map.index, m.map.half, this.jump);
    this.jump = false;
    p.sprint = Math.hypot(wishX, wishZ) > PLAYER.walk + 0.5;
  }

  shoot(p, tgt, dist) {
    const m = this.match;
    const t = now();
    const id = p.weapons[p.slot];
    const w = WEAPONS[id];
    if (!w || w.melee) return;
    const a = m.ammoOf(p, id);
    if (p.reloadUntil && t < p.reloadUntil) return;
    if (!a || a.mag <= 0) {
      if (a && a.reserve <= 0) {
        // Out of ammo for the main gun: switch to the pistol.
        p.slot = 'secondary';
        return;
      }
      m.startReload(p);
      return;
    }
    if (t < this.pauseUntil) return;
    if (t - p.lastFire < 60000 / w.rpm) return;
    // Knife range? Use it.
    if (dist < 1.6 && Math.random() < 0.5) return m.onMelee(p, {});
    const [ex, ey, ez] = this.eye(p);
    const ty = tgt.y + (tgt.status === 'downed' ? 0.3 : tgt.crouch ? 0.85 : 1.25) + (Math.random() < 0.18 * this.skill ? 0.4 : 0);
    const dir = normalise([tgt.x - ex, ty - ey, tgt.z - ez]);
    // Aim settles over the first second and a half of a fight; spraying makes it worse.
    const settle = Math.max(0.2, 1 - (t - this.engagedAt) / 1500);
    const err = (0.006 + 0.05 * settle * (1.2 - this.skill)) * (1 + this.burst * 0.12) + (p.crouch ? 0 : w.moveSpread * 0.25);
    const shotDir = spreadDir(dir, err);
    p.lastFire = t;
    p.firedAt = t;
    p.protectUntil = 0;
    a.mag--;
    m.hitscan(p, [ex, ey, ez], shotDir, id);
    this.burst++;
    const burstLen = w.auto ? 3 + Math.floor(Math.random() * (dist < 20 ? 8 : 4)) : 1;
    if (this.burst >= burstLen) {
      this.burst = 0;
      this.pauseUntil = t + (w.auto ? 220 + Math.random() * 380 : 200 + Math.random() * 450) * (dist > 50 ? 1.6 : 1);
    }
  }
}
