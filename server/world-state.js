// The living battlefield, on the server: vehicles (enter, drive, run people over, shoot from,
// blow up), houses that burn down to charcoal shells, C4 charges and the paid ambulance.
// The Match calls in from its message handler, explosions, hitscan, damage and tick.
import { VEHICLES, WRECK, HOUSES, C4, AMBULANCE, footprint, insideVehicle, vehicleBlocked, exitSpots, forward } from '../shared/vehicles.js';
import { moveBox, insideAnyBox } from '../shared/physics.js';
import { findPath, inWater } from '../shared/map.js';
import { PLAYER, WEAPONS, MONEY } from '../shared/config.js';
import { DIG, LOOT, GRAVE_LOOT, TOMB_LOOT, rollLoot } from '../shared/underworld.js';

const now = () => Date.now();
const r2 = (v) => Math.round(v * 100) / 100;
// Vehicle states: 0 fine, 1 engine on fire (will blow), 2 burning wreck, 3 charred shell.
const OK = 0;
const FIRE = 1;
const BURNING = 2;
const ASH = 3;

export class WorldState {
  constructor(match) {
    this.m = match;
    this.map = match.map;
    this.seq = 0;
    // Remember where everything started so each new round puts it back.
    for (const d of this.map.vehicles) {
      const b = this.map.boxes[d.box];
      d.orig = { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y1: b.y1 };
    }
    for (const h of this.map.houses) {
      const b = this.map.boxes[h.roof];
      if (b) h.origRoof = { y0: b.y0, y1: b.y1 };
    }
    this.reset();
  }

  reset() {
    const { map } = this;
    this.vehicles = map.vehicles.map((d) => {
      const o = d.orig;
      moveBox(map.index, d.box, o.x0, o.z0, o.x1, o.z1);
      map.boxes[d.box].y1 = o.y1;
      return { i: d.i, type: d.type, x: d.x, z: d.z, yaw: d.yaw, speed: 0, hp: VEHICLES[d.type].hp, state: OK, driver: null, box: d.box, lastHit: null, burnUntil: 0, lastMove: 0 };
    });
    this.houses = map.houses.map((h) => {
      const b = map.boxes[h.roof];
      if (b && h.origRoof) Object.assign(b, h.origRoof);
      return { i: h.i, hp: h.hp, state: OK, until: 0, lastHit: null };
    });
    this.charges = [];
    this.ambulances = [];
    // Graves and tombs: what each one hides is decided at the start of the round.
    const rnd = this.m.rng || Math.random;
    this.graves = map.graves.map((g) => ({ i: g.i, dug: false, loot: rollLoot(g.kind === 'tomb' ? TOMB_LOOT : GRAVE_LOOT, rnd), digger: null }));
    for (const p of this.m.players?.values() || []) p.dig = null;
  }

  // What a player joining mid-battle needs.
  view() {
    return {
      v: this.vehicles.map((v) => [v.i, r2(v.x), r2(v.z), +v.yaw.toFixed(3), v.state, v.driver || 0]),
      h: this.houses.filter((h) => h.state !== OK).map((h) => [h.i, h.state]),
      c: this.charges.map((c) => [c.id, ...this.chargePos(c).map(r2), c.owner]),
      g: this.graves.filter((g) => g.dug).map((g) => [g.i, g.loot])
    };
  }

  // Moving vehicles, for the 20 Hz snapshot.
  snapshot() {
    const t = now();
    const out = [];
    for (const v of this.vehicles) if (v.driver || t - v.lastMove < 600) out.push([v.i, r2(v.x), r2(v.z), +v.yaw.toFixed(3), +v.speed.toFixed(1)]);
    return out;
  }

  seatOf(p) {
    return p && p.veh != null ? this.vehicles[p.veh] : null;
  }

  vehicleOfBox(b) {
    return b && b.veh !== undefined ? this.vehicles[b.veh] : null;
  }

  // Someone sitting in an APC can't be shot; only blowing up the APC gets them.
  armoredSeat(p) {
    const v = this.seatOf(p);
    return !!v && VEHICLES[v.type].armored;
  }

  // ---------- messages ----------
  handle(p, msg) {
    if (msg.t === 'veh') {
      if (msg.a === 'enter') return this.enter(p, Number(msg.i)), true;
      if (msg.a === 'exit') return this.exit(p), true;
      return true;
    }
    if (msg.t === 'c4') {
      if (msg.a === 'plant') return this.plant(p, msg), true;
      if (msg.a === 'det') return this.detonate(p), true;
      return true;
    }
    if (msg.t === 'amb') return this.callAmbulance(p), true;
    if (msg.t === 'dig') {
      if (msg.a === 'start') this.startDig(p, Number(msg.i));
      else this.stopDig(p, 'stop');
      return true;
    }
    return false;
  }

  // ---------- digging graves and opening tombs ----------
  startDig(p, i) {
    const g = this.graves[i];
    const G = this.map.graves[i];
    if (!g || !p.human || g.dug || p.veh != null || !this.m.canAct(p)) return;
    if (g.digger && g.digger !== p.id) return this.m.toast(p, 'Somebody dey dig this one already.', 'bad');
    if (Math.hypot(p.x - G.x, p.z - G.z) > DIG.reach || Math.abs(p.y - G.y) > 1.3) return;
    if (p.dig) this.stopDig(p, 'switch');
    g.digger = p.id;
    p.dig = { i, since: now(), x: p.x, z: p.z };
    const secs = G.kind === 'tomb' ? DIG.tombSecs : DIG.graveSecs;
    this.m.send(p, { t: 'dig', i, secs });
    this.m.broadcastNear(p, { t: 'digging', id: p.id, i, on: true }, 45);
  }

  stopDig(p, reason) {
    if (!p.dig) return;
    const g = this.graves[p.dig.i];
    if (g && g.digger === p.id) g.digger = null;
    this.m.broadcastNear(p, { t: 'digging', id: p.id, i: p.dig.i, on: false }, 45);
    p.dig = null;
    this.m.send(p, { t: 'dig', i: -1, reason });
  }

  finishDig(p) {
    const g = this.graves[p.dig.i];
    const G = this.map.graves[p.dig.i];
    p.dig = null;
    g.dug = true;
    g.digger = null;
    const L = LOOT[g.loot];
    if (L.kind === 'weapon') {
      this.m.giveWeapon(p, g.loot);
      p.slot = WEAPONS[g.loot].slot;
      p.reloadUntil = 0;
    } else if (L.kind === 'armor') {
      p.armor = Math.max(p.armor || 0, L.armor);
      p.helmet = true;
      if (L.heal) p.health = Math.min(PLAYER.maxHealth, p.health + L.heal);
    } else if (L.kind === 'money') p.money = Math.min(MONEY.max, p.money + DIG.money);
    else if (L.kind === 'gems') p.profile.gems += 1;
    this.m.broadcast({ t: 'grave', i: g.i, by: p.name, id: p.id, loot: g.loot });
    this.m.send(p, { t: 'dig', i: -1, reason: 'done' });
    if (L.kind === 'none') this.m.toast(p, `${G.kind === 'tomb' ? 'The tomb' : 'The grave'} empty. ${L.icon} Na only old bones dey inside.`, 'bad');
    else {
      this.m.toast(p, `${L.icon} You dig out: ${L.name}!${L.kind === 'weapon' ? ' Relic gun: you go lose am if you die.' : ''}`, 'streak');
      this.m.addXP(p, DIG.xp);
    }
    this.m.mission?.(p, 'digs');
    this.m.syncMe(p);
  }

  enter(p, i) {
    const v = this.vehicles[i];
    if (!v || p.veh != null || !this.m.canAct(p) || v.state >= BURNING || v.driver) return;
    const d = VEHICLES[v.type];
    if (Math.hypot(p.x - v.x, p.z - v.z) > d.L / 2 + 2.4 || p.y > 2) return;
    v.driver = p.id;
    v.speed = 0;
    v.lastMove = now();
    p.veh = i;
    p.x = v.x;
    p.z = v.z;
    p.y = d.seatY;
    p.crouch = true;
    p.healAt = 0; // no first aid while driving
    this.m.broadcast({ t: 'vseat', i, id: p.id });
    this.m.syncMe(p);
  }

  exit(p, quiet = false) {
    const v = this.seatOf(p);
    if (!v) return;
    v.driver = null;
    v.speed = 0;
    p.veh = null;
    const lim = this.map.half - 2;
    const spot =
      exitSpots(v.type, v.x, v.z, v.yaw).find(([x, z]) => Math.abs(x) < lim && Math.abs(z) < lim && !insideAnyBox(this.map.index, x, 0, z, false)) ||
      exitSpots(v.type, v.x, v.z, v.yaw)[0];
    p.x = Math.max(-lim, Math.min(lim, spot[0]));
    p.z = Math.max(-lim, Math.min(lim, spot[1]));
    p.y = 0;
    p.crouch = false;
    p.history = [];
    this.m.broadcast({ t: 'vseat', i: v.i, id: null, out: p.id });
    if (!quiet) this.m.send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
    this.m.syncMe(p);
  }

  // The driver's client drives; the server checks speed and walls, then moves the car's box.
  drive(p, mv, t) {
    const v = this.seatOf(p);
    if (!v) return false;
    const d = VEHICLES[v.type];
    const [x, z, yaw, speed] = mv;
    const dt = Math.min(1, Math.max(0.03, (t - (v.lastMove || t - 50)) / 1000));
    const lim = this.map.half - 2;
    const moved = Math.hypot(x - v.x, z - v.z);
    const bad = moved > d.top * 1.6 * dt + 1.5 || Math.abs(x) > lim || Math.abs(z) > lim || vehicleBlocked(v.type, x, z, yaw, this.map.index, v.box, 0.3);
    if (bad || v.state >= BURNING) {
      this.m.send(p, { t: 'vcorrect', x: v.x, z: v.z, yaw: v.yaw });
      return true;
    }
    const s = Math.max(-d.top, Math.min(d.top, speed));
    // Slamming into something hard dents it.
    const drop = Math.abs(v.speed) - Math.abs(s);
    if (Math.abs(v.speed) > WRECK.crashMin && drop > WRECK.crashMin * 0.6) this.damageVehicle(v, drop * WRECK.crashDmg, null, 'crash');
    v.x = x;
    v.z = z;
    v.yaw = yaw;
    v.speed = s;
    v.lastMove = t;
    const fp = footprint(v.type, x, z, yaw);
    moveBox(this.map.index, v.box, fp.x0, fp.z0, fp.x1, fp.z1);
    p.x = x;
    p.z = z;
    p.y = d.seatY;
    p.crouch = true;
    return true;
  }

  // Where a shot from inside a vehicle may start.
  shotOrigin(p) {
    const v = this.seatOf(p);
    if (!v) return null;
    return [v.x, VEHICLES[v.type].eye, v.z];
  }

  // ---------- damage ----------
  // A bullet hit vehicle box b. Returns how much of the bullet carries on (0 = stopped).
  bulletHit(b, dmg, by, weapon) {
    const v = this.vehicleOfBox(b);
    if (!v) return 0;
    const d = VEHICLES[v.type];
    if (v.state >= BURNING) return 0;
    if (d.armored) {
      // Sparks off the armour; only the Thunder .50 relic bites into it.
      if (WEAPONS[weapon]?.antiArmor) this.damageVehicle(v, dmg * 0.35, by, weapon);
      return 0;
    }
    this.damageVehicle(v, dmg * WRECK.bulletMult * (by && !by.human ? WRECK.botBulletMult : 1), by, 'bullet');
    return d.open ? 1 : WRECK.passMult;
  }

  damageVehicle(v, amount, by, weapon) {
    if (v.state >= BURNING || amount <= 0) return;
    const d = VEHICLES[v.type];
    v.hp -= amount;
    if (by) v.lastHit = by.id;
    if (v.state === OK && v.hp <= d.hp * WRECK.fireAt && v.hp > 0) {
      v.state = FIRE;
      this.m.broadcast({ t: 'vstate', i: v.i, s: FIRE });
    }
    if (v.hp <= 0) this.destroyVehicle(v);
    else if (v.driver) this.m.syncMe(this.m.players.get(v.driver));
  }

  destroyVehicle(v) {
    if (v.state >= BURNING) return;
    const d = VEHICLES[v.type];
    const t = now();
    v.state = BURNING;
    v.hp = 0;
    v.speed = 0;
    v.burnUntil = t + WRECK.burnSecs * 1000;
    v.lastMove = t;
    const box = this.map.boxes[v.box];
    box.y1 = Math.min(box.y1, d.H * 0.72); // tyres burn, the shell sags
    const by = (v.lastHit && this.m.players.get(v.lastHit)) || null;
    const driver = v.driver ? this.m.players.get(v.driver) : null;
    if (driver) this.exit(driver);
    this.m.broadcast({ t: 'vstate', i: v.i, s: BURNING, x: r2(v.x), z: r2(v.z), yaw: +v.yaw.toFixed(3), by: by?.name || null });
    // Charges stuck on it drop where they are.
    for (const c of this.charges) {
      if (c.veh !== v.i) continue;
      const [x, y, z] = this.chargePos(c);
      Object.assign(c, { veh: null, x, y, z });
    }
    this.m.explode(v.x, 1.0, v.z, WRECK.blast, WRECK.blastDmg, by, 'vehicle', true);
    if (by?.human) {
      this.m.toast(by, `💥 You don blow ${d.name}! +${d.armored ? 250 : 60} XP`, 'streak');
      this.m.addXP(by, d.armored ? 250 : 60);
      this.m.mission?.(by, 'wrecks');
    }
    // Whoever was inside an APC climbs out burnt but alive (just about).
    if (driver && d.armored && driver.status === 'alive') this.m.damage(driver, by, 45, { weapon: 'vehicle', explosive: true });
  }

  // Called by Match.explode for every blast: rockets, grenades, C4, drums, artillery, wrecks.
  onBlast(x, y, z, radius, dmg, owner, weapon) {
    for (const v of this.vehicles) {
      if (v.state >= BURNING) continue;
      const d = VEHICLES[v.type];
      const eff = Math.max(0, Math.hypot(v.x - x, v.z - z) - d.W / 2);
      if (eff > radius || y > d.H + 3) continue;
      let mult = d.armored ? WRECK.armoredBlastMult : WRECK.blastMult;
      if (weapon === 'c4') mult *= 1.4;
      if (weapon === 'frag' && d.armored) mult *= 0.4;
      this.damageVehicle(v, dmg * mult * Math.pow(1 - eff / radius, 1.1), owner, weapon);
    }
    const reach = radius * 0.75;
    for (const [k, h] of this.houses.entries()) {
      if (h.state !== OK) continue;
      const H = this.map.houses[k];
      const ex = Math.max(Math.abs(x - H.x) - H.w / 2, 0);
      const ez = Math.max(Math.abs(z - H.z) - H.d / 2, 0);
      const ed = Math.hypot(ex, ez);
      if (ed > reach || y > H.h + 3) continue;
      const mult = weapon === 'c4' ? HOUSES.c4Mult : weapon === 'frag' ? 0.6 : 1;
      h.hp -= dmg * mult * (1 - ed / reach);
      if (owner) h.lastHit = owner.id;
      if (h.hp <= 0) this.burnHouse(h);
    }
  }

  burnHouse(h) {
    const H = this.map.houses[h.i];
    h.state = BURNING;
    h.until = now() + HOUSES.burnSecs * 1000;
    // The roof caves in.
    const b = this.map.boxes[H.roof];
    if (b) {
      b.y0 = -3;
      b.y1 = -2.5;
    }
    const by = (h.lastHit && this.m.players.get(h.lastHit)) || null;
    this.m.broadcast({ t: 'house', i: h.i, s: BURNING, by: by?.name || null });
    if (by?.human) {
      this.m.toast(by, '🔥 That house don catch fire! +80 XP', 'streak');
      this.m.addXP(by, 80);
    }
  }

  // ---------- C4 ----------
  chargePos(c) {
    if (c.veh == null) return [c.x, c.y, c.z];
    const v = this.vehicles[c.veh];
    const [fx, fz] = forward(v.yaw);
    return [v.x + fx * c.la - fz * c.ls, c.y, v.z + fz * c.la + fx * c.ls];
  }

  plant(p, msg) {
    if (!this.m.canAct(p) || !(p.c4 > 0)) return;
    const pos = msg.pos;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return;
    const eye = this.shotOrigin(p) || [p.x, p.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye), p.z];
    if (Math.hypot(pos[0] - eye[0], pos[1] - eye[1], pos[2] - eye[2]) > C4.reach + (p.veh != null ? 2 : 0)) return this.m.toast(p, 'Too far. Go near the place wey you wan stick am.', 'bad');
    if (this.charges.filter((c) => c.owner === p.id).length >= C4.maxPlanted) return this.m.toast(p, `Na ${C4.maxPlanted} C4 you fit plant at once. Press L to blow dem first.`, 'bad');
    const c = { id: ++this.seq, owner: p.id, side: p.side, x: pos[0], y: Math.max(0.05, pos[1]), z: pos[2], veh: null, la: 0, ls: 0 };
    const v = Number.isInteger(msg.veh) ? this.vehicles[msg.veh] : null;
    if (v && v.state < BURNING && insideVehicle(v.type, v.x, v.z, v.yaw, pos[0], pos[2], 0.8)) {
      const [fx, fz] = forward(v.yaw);
      const dx = pos[0] - v.x;
      const dz = pos[2] - v.z;
      c.veh = v.i;
      c.la = dx * fx + dz * fz;
      c.ls = dx * -fz + dz * fx;
    }
    p.c4--;
    this.charges.push(c);
    this.m.broadcast({ t: 'c4', a: 'plant', id: c.id, pos: this.chargePos(c).map(r2), veh: c.veh, by: p.id });
    if (!p.c4Hinted && p.human) {
      p.c4Hinted = true;
      this.m.toast(p, 'C4 don stick. Comot far, then press L (or 💥) to blow am.', 'info');
    }
    this.m.syncMe(p);
  }

  detonate(p) {
    const mine = this.charges.filter((c) => c.owner === p.id && !c.at);
    if (!mine.length || (p.status !== 'alive' && p.status !== 'downed')) return;
    const t = now();
    mine.forEach((c, k) => (c.at = t + 150 + k * C4.chainMs));
    this.m.send(p, { t: 'c4', a: 'det' });
  }

  dropCharges(id) {
    const gone = this.charges.filter((c) => c.owner === id);
    if (!gone.length) return;
    this.charges = this.charges.filter((c) => c.owner !== id);
    for (const c of gone) this.m.broadcast({ t: 'c4', a: 'gone', id: c.id });
  }

  // ---------- ambulance ----------
  callAmbulance(p) {
    const t = now();
    if (p.status !== 'alive' || this.m.chatting(p)) return;
    if (p.veh != null) return this.m.toast(p, 'Comot from the motor first make the ambulance see you.', 'bad');
    if (this.ambulances.some((a) => a.pid === p.id)) return this.m.toast(p, 'Ambulance don already dey come. Hold on!', 'info');
    if (p.health > PLAYER.maxHealth - AMBULANCE.minMissing) return this.m.toast(p, 'You never wound reach to call ambulance.', 'bad');
    if (t < (p.ambReady || 0)) return this.m.toast(p, `Ambulance still dey another call. Try again in ${Math.ceil((p.ambReady - t) / 1000)}s.`, 'bad');
    if (p.money < AMBULANCE.fee) return this.m.toast(p, `Ambulance na ₦${AMBULANCE.fee.toLocaleString()}. Your money no reach.`, 'bad');
    const base = this.map.bases[p.side].spawns[0];
    let path = findPath(this.map.nav, base.x, base.z, p.x, p.z) || [[p.x, p.z]];
    // Drop most points (the client smooths the curve), keep the start and end.
    path = [[base.x, base.z], ...path.filter((_, k) => k % 3 === 2 || k === path.length - 1)];
    let len = 0;
    for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    const travel = Math.max(AMBULANCE.minMs, Math.min(AMBULANCE.maxMs, (len / AMBULANCE.speed) * 1000));
    p.money -= AMBULANCE.fee;
    p.ambReady = t + AMBULANCE.cooldownMs;
    const a = { id: ++this.seq, pid: p.id, side: p.side, path: path.map(([x, z]) => [r2(x), r2(z)]), start: t, at: t + travel, leave: t + travel + AMBULANCE.stayMs, done: false };
    this.ambulances.push(a);
    this.m.broadcast({ t: 'amb', id: a.id, pid: p.id, side: p.side, path: a.path, start: a.start, at: a.at, leave: a.leave });
    this.m.toast(p, `🚑 Ambulance dey come (${Math.round(travel / 1000)}s). Stay where you dey.`, 'info');
    this.m.syncMe(p);
  }

  // ---------- every tick ----------
  tick(dt) {
    const t = now();
    const players = this.m.players;
    for (const v of this.vehicles) {
      const d = VEHICLES[v.type];
      if (v.driver) {
        const p = players.get(v.driver);
        if (!p || p.status !== 'alive' || p.veh !== v.i) {
          v.driver = null;
          v.speed = 0;
          if (p && p.veh === v.i) p.veh = null;
          this.m.broadcast({ t: 'vseat', i: v.i, id: null });
        } else if (Math.abs(v.speed) > WRECK.runOverMin) {
          // Running people over.
          for (const o of players.values()) {
            if (o === p || o.veh != null || (o.status !== 'alive' && o.status !== 'downed') || o.y > 1.4 || o.y < -1) continue;
            if (!insideVehicle(v.type, v.x, v.z, v.yaw, o.x, o.z, 0.35)) continue;
            if (t - (o.runOverAt || 0) < 700) continue;
            o.runOverAt = t;
            this.m.damage(o, p, Math.abs(v.speed) * WRECK.runOverDmg, { weapon: 'vehicle', melee: true, from: [v.x, 1, v.z] });
          }
        }
        if (v.driver && t - v.lastMove > 1500) v.speed = 0;
      }
      if (v.state === FIRE) {
        v.hp -= d.hp * WRECK.fireDrainPerSec * dt;
        if (v.hp <= 0) this.destroyVehicle(v);
      } else if (v.state === BURNING) {
        if (t >= v.burnUntil) {
          v.state = ASH;
          this.m.broadcast({ t: 'vstate', i: v.i, s: ASH });
        } else this.scorch(v.x, v.z, WRECK.burnRadius, 2.2, null);
      }
    }
    for (const [k, h] of this.houses.entries()) {
      if (h.state !== BURNING) continue;
      const H = this.map.houses[k];
      if (t >= h.until) {
        h.state = ASH;
        this.m.broadcast({ t: 'house', i: h.i, s: ASH });
        continue;
      }
      // Anyone inside a burning house catches fire.
      for (const o of players.values()) {
        if (o.status !== 'alive' || o.y > H.h || o.y < -1) continue;
        if (Math.abs(o.x - H.x) < H.w / 2 && Math.abs(o.z - H.z) < H.d / 2) this.ignite(o, h.lastHit);
      }
    }
    // C4 going off.
    if (this.charges.some((c) => c.at && c.at <= t)) {
      const due = this.charges.filter((c) => c.at && c.at <= t);
      this.charges = this.charges.filter((c) => !(c.at && c.at <= t));
      for (const c of due) {
        const [x, y, z] = this.chargePos(c);
        this.m.broadcast({ t: 'c4', a: 'gone', id: c.id });
        this.m.explode(x, y, z, C4.blast, C4.dmg, players.get(c.owner) || null, 'c4');
      }
    }
    // Digging: keep still until it is done.
    for (const p of players.values()) {
      if (!p.dig) continue;
      const G = this.map.graves[p.dig.i];
      if (p.status !== 'alive' || p.veh != null || this.m.chatting(p) || Math.hypot(p.x - p.dig.x, p.z - p.dig.z) > 0.9) {
        this.stopDig(p, 'moved');
        continue;
      }
      if (t - p.dig.since >= (G.kind === 'tomb' ? DIG.tombSecs : DIG.graveSecs) * 1000) this.finishDig(p);
    }
    // Ambulances arriving.
    for (const a of this.ambulances) {
      if (a.done || t < a.at) continue;
      a.done = true;
      const p = players.get(a.pid);
      const [ex, ez] = a.path[a.path.length - 1];
      if (p && p.status === 'alive' && p.veh == null && Math.hypot(p.x - ex, p.z - ez) <= AMBULANCE.reach) {
        p.health = PLAYER.maxHealth;
        p.armor = Math.min(100, (p.armor || 0) + AMBULANCE.armor);
        p.burnUntil = 0;
        p.pillUntil = 0;
        this.m.toast(p, '🚑 Paramedics don patch you up. Full health!', 'good');
        this.m.broadcast({ t: 'ambHeal', id: a.id, pid: p.id });
        this.m.syncMe(p);
      } else if (p) {
        p.money += Math.round(AMBULANCE.fee / 2);
        this.m.toast(p, `Ambulance reach but you no dey there. Half your money (₦${Math.round(AMBULANCE.fee / 2).toLocaleString()}) don come back.`, 'bad');
        this.m.syncMe(p);
      }
    }
    this.ambulances = this.ambulances.filter((a) => t < a.leave + 8000);
  }

  scorch(x, z, r, secs, by) {
    for (const o of this.m.players.values()) {
      if (o.status !== 'alive' || o.veh != null || o.y > 2.5 || o.y < -1) continue;
      if (Math.hypot(o.x - x, o.z - z) < r) this.ignite(o, by, secs);
    }
  }

  ignite(o, byId, secs = 1.4) {
    if (o.y < 0.2 && inWater(this.map, o.x, o.z)) return;
    const t = now();
    o.burnUntil = Math.max(o.burnUntil || 0, t + secs * 1000);
    o.burnAcc ||= 0;
    const by = byId && this.m.players.get(byId);
    o.burnBy = by && by.side !== o.side ? by.id : o.burnBy || null;
  }
}
