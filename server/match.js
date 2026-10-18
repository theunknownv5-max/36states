// One live battle in one state. The server decides every hit, death, revive,
// gem pickup, capture, explosion and payout. Bots fill empty slots.
import { awards, debrief } from './tour.js';
import { randomUUID } from 'node:crypto';
import { WEAPONS, GEAR, FACTIONS, SIDES, KILLSTREAKS, GEMS, RESPAWN, MATCH, MONEY, PLAYER, XP, NET, DRUMS, TANKS, HEALTH, PUNCH, TILE_GEMS, MODES, priceFor, rankFor } from '../shared/config.js';
import { generateMap, inWater, tileGemSpots } from '../shared/map.js';
import { raycast, hitSoldier, lineBlocked, insideAnyBox, spreadDir, normalise, holeAt } from '../shared/physics.js';
import { RESOURCES } from '../shared/states.js';
import { regionById } from '../shared/regions.js';
import { mulberry32 } from '../shared/rng.js';
import { BotBrain, botName, botLoadout } from './bots.js';
import { createMode } from './modes.js';
import { WorldState } from './world-state.js';
import { Wildlife } from './wildlife.js';
import { VEHICLES, WRECK } from '../shared/vehicles.js';

export const WEAPON_IDS = Object.keys(WEAPONS);
const now = () => Date.now();
const DISCOVERY_RES = ['gold', 'lithium', 'crude', 'gemstones', 'tin', 'gas', 'tantalite', 'bitumen'];

export class Match {
  constructor(stateId, hooks, modeId = 'conquest', opts = {}) {
    this.stateId = stateId;
    this.modeId = modeId;
    this.opts = opts;
    this.mode = createMode(modeId, this, opts);
    this.practice = !!MODES[modeId]?.practice; // nothing here counts for anyone's record
    this.hooks = hooks; // { profileOf(token), saveProfile(), ads }
    this.map = generateMap(stateId);
    this.players = new Map();
    this.projectiles = [];
    this.smokes = [];
    this.artillery = [];
    this.uav = { sec: 0, out: 0 };
    this.gems = this.map.adWalls.map(() => 0); // available-at time for each wall's gem
    // Healing gemstones on the ground advert tiles.
    this.tileGems = tileGemSpots(this.map).map((g) => ({ ...g, type: 'ruby', at: 0 }));
    this.rng = mulberry32((Date.now() & 0xffff) ^ 0x5eed);
    for (const g of this.tileGems) g.type = this.pickGemType();
    // Vehicles, burning houses, C4 and the ambulance.
    this.world = new WorldState(this);
    this.wildlife = new Wildlife(this); // crocodiles, swimming and fitness
    this.emptySince = now();
    this.reset();
  }

  reset() {
    this.score = { sec: 0, out: 0 };
    this.startedAt = now();
    this.ended = false;
    this.endsAt = 0;
    this.sites = this.map.sites.map((s) => ({ ...s, progress: 0, owner: null, contested: false }));
    this.discovery = null;
    this.nextDiscoveryAt = now() + MATCH.discoveryEveryMs;
    if (this.mode.id !== 'bomb') this.mode.reset();
    this.projectiles = [];
    this.smokes = [];
    this.artillery = [];
    this.uav = { sec: 0, out: 0 };
    // Every drum and fuel tank is back, full, at the start of a round.
    for (const bi of [...this.map.drums, ...(this.map.tanks || [])]) {
      const b = this.map.boxes[bi];
      if (b.oy1 !== undefined) {
        b.y0 = b.oy0;
        b.y1 = b.oy1;
      }
    }
    this.world.reset();
    this.drumHp = this.map.drums.map(() => DRUMS.health);
    this.tankHp = (this.map.tanks || []).map(() => TANKS.health);
    this.tanksDead = [];
    this.drumsDead = [];
    this.drumQueue = [];
    for (const p of this.players.values()) {
      p.money = MONEY.start;
      p.kills = p.deaths = p.assists = p.points = p.headshots = p.shots = p.hits = 0;
      p.streak = 0;
      p.streaksAvail = {};
      this.spawn(p, true);
    }
    this.balanceBots();
    // Modes with rounds (bomb) start their first round once everyone is in.
    if (this.mode.id === 'bomb') this.mode.reset();
  }

  // ---------- players ----------
  humans() {
    return [...this.players.values()].filter((p) => p.human);
  }

  sideCount(side, humansOnly = false) {
    return [...this.players.values()].filter((p) => p.side === side && (!humansOnly || p.human)).length;
  }

  addHuman(conn, faction, profile) {
    if (!FACTIONS[faction]) faction = 'police';
    if (this.humans().length >= MATCH.maxHumans) return { error: 'This battle is full. Pick another region.' };
    const side = FACTIONS[faction].side;
    // Auto-balance real players: no side may have 2+ more humans than the other.
    const other = side === 'sec' ? 'out' : 'sec';
    if (!this.mode.def.solo && this.sideCount(side, true) - this.sideCount(other, true) >= 2) {
      return { error: `${SIDES[side].label} already has too many players here. Join ${SIDES[other].label}.` };
    }
    const tag = this.hooks.social?.tagOf(profile);
    const p = this.newPlayer({ human: true, conn, profile, faction, name: tag ? `[${tag}] ${profile.name}` : profile.name });
    this.players.set(p.id, p);
    this.spawn(p, true);
    this.balanceBots();
    // Joining a round in progress: wait for the next one.
    if (this.mode.id === 'bomb' && this.mode.phase !== 'freeze') {
      p.status = 'dead';
      p.deadAt = now();
      this.toast(p, 'The round has already started. You will join the next round.', 'info');
      this.syncMe(p);
    }
    this.emptySince = 0;
    this.broadcast({ t: 'joined', id: p.id, name: p.name, side: p.side, humans: this.humans().length }, (o) => o !== p);
    return { player: p };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.veh != null) this.world.exit(p, true);
    this.world.stopDig(p, 'left');
    this.world.dropCharges(id);
    this.players.delete(id);
    if (p.human) this.hooks.saveProfile();
    this.balanceBots();
    if (!this.humans().length) this.emptySince = now();
    this.broadcast({ t: 'left', id, name: p.human ? p.name : undefined, humans: this.humans().length });
  }

  newPlayer({ human, conn = null, profile = null, faction, name }) {
    return {
      id: randomUUID().slice(0, 6),
      human,
      conn,
      profile,
      name,
      faction,
      side: FACTIONS[faction].side,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      crouch: false,
      ads: false,
      sprint: false,
      vy: 0,
      onGround: true,
      health: 100,
      armor: 0,
      helmet: false,
      status: 'alive',
      money: MONEY.start,
      weapons: { primary: null, secondary: 'p9', melee: 'knife' },
      ammo: {},
      slot: 'secondary',
      frag: 0,
      smoke: 0,
      flash: 0,
      medkit: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      points: 0,
      headshots: 0,
      shots: 0,
      hits: 0,
      streak: 0,
      streaksAvail: {},
      lastFire: 0,
      firedAt: 0,
      reloadUntil: 0,
      healAt: 0,
      history: [],
      damagers: new Map(),
      lastState: now(),
      spawnAt: 0,
      blindUntil: 0,
      bot: human ? null : new BotBrain(this),
      xp: 0
    };
  }

  // Keep each side at MATCH.minPerSide fighters by adding or removing bots.
  balanceBots() {
    for (const side of ['sec', 'out']) {
      let want = this.mode.wantBots(side);
      if (want < 0) continue; // the mode manages this side's bots itself (campaign waves)
      if (this.opts.noBots) want = 0; // "real players only" rooms
      const bots = [...this.players.values()].filter((p) => !p.human && p.side === side);
      for (let i = bots.length; i < want; i++) {
        const factions = Object.keys(FACTIONS).filter((f) => FACTIONS[f].side === side);
        const faction = factions[Math.floor(this.rng() * factions.length)];
        const bot = this.newPlayer({ human: false, faction, name: botName(this.rng, side) });
        this.players.set(bot.id, bot);
        this.spawn(bot, true);
        // Bots joining a bomb round in progress wait for the next round.
        if (this.mode.id === 'bomb' && this.mode.phase && this.mode.phase !== 'freeze') {
          bot.status = 'dead';
          bot.bot.respawnAt = Infinity;
        }
      }
      for (let i = bots.length - 1; i >= want; i--) this.players.delete(bots[i].id);
    }
  }

  giveWeapon(p, id) {
    const w = WEAPONS[id];
    p.weapons[w.slot] = id;
    p.ammo[id] = { mag: w.mag ?? 0, reserve: w.reserve ?? 0 };
  }

  spawn(p, first = false, keepKit = false) {
    const kit = keepKit ? { weapons: { ...p.weapons }, ammo: JSON.parse(JSON.stringify(p.ammo)), armor: p.armor, helmet: p.helmet, frag: p.frag, smoke: p.smoke, flash: p.flash, medkit: p.medkit, bloodpill: p.bloodpill, c4: p.c4, slot: p.slot } : null;
    if (p.veh != null) {
      if (this.world.seatOf(p)?.driver === p.id) this.world.exit(p, true);
      p.veh = null;
    }
    const base = this.map.bases[p.side];
    // Pick the spawn point furthest from enemies.
    let best = base.spawns[0];
    let bestD = -1;
    for (const s of base.spawns) {
      let d = Infinity;
      for (const o of this.players.values()) if (o.side !== p.side && o.status === 'alive') d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
      d += this.rng() * 6;
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    const custom = this.mode.spawnPoint?.(p);
    if (custom) best = custom;
    else if (p.human && !first && p.comeBack !== 'base' && p.fellAt) {
      const here = this.safeSpotNear(p, p.fellAt.x, p.fellAt.z);
      if (here) best = { x: here.x, z: here.z, yaw: p.yaw };
    }
    p.fellAt = null;
    Object.assign(p, { x: best.x, y: 0, z: best.z, yaw: best.yaw, pitch: 0, vy: 0, onGround: true, crouch: false });
    p.anchor = { x: best.x, z: best.z };
    p.health = PLAYER.maxHealth;
    p.armor = FACTIONS[p.faction].perks.startVest ? 100 : 0;
    p.helmet = false;
    p.status = 'alive';
    p.weapons = { primary: null, secondary: 'p9', melee: 'knife' };
    p.ammo = {};
    this.giveWeapon(p, 'p9');
    p.ammo.knife = { mag: 0, reserve: 0 };
    p.slot = 'secondary';
    p.frag = p.smoke = p.flash = p.medkit = p.c4 = 0;
    p.bloodpill = 0;
    p.pillUntil = 0;
    p.secondWindUsed = false;
    if (p.human) {
      p.armor = Math.max(p.armor, HEALTH.startArmor);
      p.bloodpill = HEALTH.startPills;
    }
    if (!p.human) {
      const lo = botLoadout(p.faction, this.rng);
      this.giveWeapon(p, lo);
      p.slot = 'primary';
      p.armor = 100;
      if (this.rng() < 0.4) p.frag = 1;
    }
    if (kit) Object.assign(p, kit);
    if (first) p.money = Math.max(p.money, MONEY.start);
    if (this.practice && p.human) p.money = MONEY.max; // practice: everything free to try
    p.spawnAt = now();
    p.protectUntil = p.spawnAt + RESPAWN.protectMs;
    p.reloadUntil = 0;
    p.healAt = 0;
    p.history = [];
    p.damagers.clear();
    p.burnUntil = 0;
    p.burnAcc = 0;
    p.downedAt = p.deadAt = p.spiritUntil = p.medevacAt = 0;
    p.lastState = now();
    p.reviver = null;
    p.bot?.onSpawn(p);
    if (p.human) {
      this.send(p, { t: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw });
      this.syncMe(p);
    }
  }

  // Who can hurt whom: the other side, or everyone in a free-for-all mode.
  enemies(a, b) {
    return !!a && !!b && a !== b && (this.mode.def.ffa || a.side !== b.side);
  }

  protectedNow(p) {
    return now() < (p.protectUntil || 0);
  }

  // ---------- networking helpers ----------
  send(p, msg) {
    if (p.human && p.conn?.readyState === 1) p.conn.send(JSON.stringify(msg));
  }

  broadcast(msg, filter = () => true) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.human && p.conn?.readyState === 1 && filter(p)) p.conn.send(s);
  }

  toast(p, text, kind = 'info') {
    this.send(p, { t: 'toast', text, kind });
  }

  syncMe(p) {
    if (!p.human) return;
    this.send(p, {
      t: 'me',
      health: Math.max(0, Math.round(p.health)),
      armor: Math.round(p.armor),
      helmet: p.helmet,
      money: p.money,
      weapons: p.weapons,
      ammo: p.ammo,
      slot: p.slot,
      frag: p.frag,
      smoke: p.smoke,
      flash: p.flash,
      medkit: p.medkit,
      bloodpill: p.bloodpill || 0,
      c4: p.c4 || 0,
      veh: p.veh ?? null,
      vhp: p.veh != null ? Math.max(0, Math.round((this.world.vehicles[p.veh].hp / VEHICLES[this.world.vehicles[p.veh].type].hp) * 100)) : 0,
      ambReady: p.ambReady || 0,
      skills: { swim: Math.floor(p.profile.skills?.swim || 0), fitness: Math.floor(p.profile.skills?.fitness || 0) },
      level: p.human ? rankFor(p.profile.xp).level : 1,
      rival: this.hooks.social?.rivalOf(p.profile)?.name || null,
      status: p.status,
      gems: p.profile.gems,
      streak: p.streak,
      streaksAvail: p.streaksAvail,
      kills: p.kills,
      deaths: p.deaths,
      side: p.side,
      faction: p.faction,
      downedAt: p.downedAt,
      spiritUntil: p.spiritUntil,
      medevacAt: p.medevacAt,
      buyUntil: p.spawnAt + MONEY.buyWindowMs,
      reloadUntil: p.reloadUntil,
      xp: p.profile.xp
    });
  }

  // The region being fought over (without its map shape), so any client can build the battlefield.
  regionView() {
    const r = regionById(this.stateId);
    if (!r) return null;
    const { poly, ...rest } = r;
    return rest;
  }

  // Everything a newly joined player needs to know about the match.
  info(p) {
    return {
      t: 'matchInfo',
      state: this.stateId,
      region: this.regionView(),
      you: p.id,
      side: p.side,
      faction: p.faction,
      score: this.score,
      startedAt: this.startedAt,
      timeLimit: this.mode.def.timeLimitMs,
      scoreLimit: this.mode.def.scoreLimit,
      mode: this.modeId,
      modeState: this.mode.state(),
      sites: this.siteView(),
      gems: this.gems,
      tileGems: this.tileGemView(),
      drums: this.drumsDead,
      tanks: this.tanksDead,
      world: this.world.view(),
      crocs: this.wildlife.view(),
      dogs: this.wildlife.dogView(),
      discovery: this.discovery,
      roster: this.roster(),
      serverTime: now()
    };
  }

  roster() {
    return [...this.players.values()].map((o) => ({ id: o.id, name: o.name, side: o.side, faction: o.faction, bot: !o.human, kills: o.kills, deaths: o.deaths, assists: o.assists, points: o.points, hs: o.headshots, acc: o.shots ? Math.round((o.hits / o.shots) * 100) : 0 }));
  }

  siteView() {
    if (this.mode.id === 'bomb') return this.mode.sitesForBomb().map((s) => ({ id: s.id, label: s.label, resource: s.resource, x: s.x, z: s.z, r: s.r, progress: 0, owner: null, contested: false, bomb: true }));
    if (!this.mode.usesSites()) return [];
    const list = this.sites.map((s) => ({ id: s.id, label: s.label, resource: s.resource, x: s.x, z: s.z, r: s.r, progress: +s.progress.toFixed(3), owner: s.owner, contested: s.contested }));
    if (this.discovery) list.push({ id: 'D', label: this.discovery.label, resource: this.discovery.resource, x: this.discovery.x, z: this.discovery.z, r: this.discovery.r, progress: +this.discovery.progress.toFixed(3), owner: this.discovery.owner, contested: this.discovery.contested, until: this.discovery.until });
    return list;
  }

  // ---------- inputs from human players ----------
  handle(p, m) {
    if (this.mode.handle(p, m)) return;
    if (this.world.handle(p, m)) return;
    switch (m.t) {
      case 'st':
        return this.onState(p, m);
      case 'fire':
        return this.onFire(p, m);
      case 'melee':
        return this.onMelee(p, m);
      case 'reload':
        return this.startReload(p);
      case 'slot':
        if (['primary', 'secondary', 'melee'].includes(m.slot) && p.weapons[m.slot]) {
          p.slot = m.slot;
          p.reloadUntil = 0;
          this.syncMe(p);
        }
        return;
      case 'buy':
        return this.onBuy(p, m.item);
      case 'throw':
        return this.onThrow(p, m);
      case 'medkit':
        return this.onMedkit(p);
      case 'pill':
        return this.onPill(p);
      case 'revive':
        return this.onRevive(p, m.target);
      case 'streak':
        return this.onStreak(p, m);
      case 'respawn':
        return this.onRespawn(p, m.mode, m.at);
      case 'views':
        return this.hooks.ads.recordViews({ token: p.profile.token, side: p.side, faction: p.faction }, this.stateId, m.slots);
      case 'chat': {
        const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        if (!text) return;
        if (this.hooks.control?.muted(p.profile)) return this.toast(p, 'An admin has muted your chat for now.', 'bad');
        p.chatTimes = (p.chatTimes || []).filter((x) => x > now() - 30000);
        if (p.chatTimes.length >= 8) return;
        p.chatTimes.push(now());
        const team = !!m.team;
        this.hooks.control?.logChat({ pid: this.hooks.pidOf?.(p.profile.token) || null, name: p.name, text, team, state: this.stateId, mode: this.modeId });
        return this.broadcast({ t: 'chat', id: p.id, name: p.name, side: p.side, text, team }, (o) => !team || o.side === p.side);
      }
      default:
    }
  }

  onState(p, m) {
    const t = now();
    if (![m.x, m.y, m.z, m.yaw, m.pitch].every(Number.isFinite)) return;
    const dt = Math.max(0.03, (t - p.lastState) / 1000);
    p.lastState = t;
    p.yaw = m.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, m.pitch));
    p.crouch = !!m.c;
    p.ads = !!m.a;
    p.sprint = !!m.r;
    if (p.status === 'downed' || p.status === 'dead' || p.status === 'medevac') return;
    // Driving: the vehicle's pose comes in m.v and the server checks it.
    if (p.veh != null) {
      if (Array.isArray(m.v) && m.v.length >= 4 && m.v.slice(0, 4).every(Number.isFinite)) this.world.drive(p, m.v, t);
      return;
    }
    // Walking away ends a chat with a business.
    if (this.chatting(p) && p.chatAt && Math.hypot(m.x - p.chatAt.x, m.z - p.chatAt.z) > 1.5) this.endChat(p, 'moved');
    // Buy time at the start of a bomb round: nobody moves off the spawn.
    if (this.mode.frozen() && Math.hypot(m.x - p.x, m.z - p.z) > 0.05) {
      this.send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
      return;
    }
    const spirit = p.status === 'spirit';
    const maxSpeed = spirit ? RESPAWN.spiritSpeed : PLAYER.run * (FACTIONS[p.faction].perks.speedMult || 1);
    const moved = Math.hypot(m.x - p.x, m.z - p.z);
    const lim = this.map.half - 1;
    if (moved > maxSpeed * NET.speedTolerance * dt + 1.2 || Math.abs(m.x) > lim || Math.abs(m.z) > lim || m.y > 40 || m.y < -6) {
      this.send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
      return;
    }
    // (Vehicle boxes are skipped: a car rolling onto you must not pin you in place.)
    if (!spirit && insideAnyBox(this.map.index, m.x, m.y, m.z, p.crouch, (b) => b.veh !== undefined)) {
      this.send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });
      return;
    }
    p.x = m.x;
    p.y = m.y;
    p.z = m.z;
  }

  canAct(p) {
    return p.status === 'alive' && !this.mode.frozen() && !this.chatting(p);
  }

  // ---------- chatting with an advertiser ----------
  // While a soldier chats with a business they are protected: no one can hurt them, bots
  // ignore them, and they can't shoot or move. In a solo campaign stage the battle pauses.
  chatting(p) {
    return (p.chatUntil || 0) > now();
  }

  setChat(p, on) {
    const t = now();
    if (!on) {
      if (p.chatUntil) {
        p.chatUntil = 0;
        p.protectUntil = Math.max(p.protectUntil || 0, t + 1500); // a moment to get your bearings
      }
      return { ok: true };
    }
    if (p.status !== 'alive') return { ok: false, reason: 'You can only chat while you are alive. Use the Inbox from the menu.' };
    if (this.mode.frozen()) return { ok: false, reason: 'Wait make the round start first.' };
    if (t - (p.hurtAt || 0) < 5000) return { ok: false, reason: 'You were just shot! Find cover first, then chat.' };
    if (t - (p.firedAt || 0) < 3000) return { ok: false, reason: 'You just fire gun. Wait small, then chat.' };
    if (this.mode.carrier === p.id || this.mode.action?.pid === p.id) return { ok: false, reason: 'You are carrying the bomb. Pass it on or finish the job first.' };
    p.chatUntil = t + MATCH.chatMs;
    p.chatAt = { x: p.x, z: p.z };
    p.reloadUntil = 0;
    return { ok: true, paused: !!this.mode.def.solo, until: p.chatUntil };
  }

  endChat(p, reason) {
    if (!p.chatUntil) return;
    this.setChat(p, false);
    this.send(p, { t: 'chatEnded', reason });
  }

  ammoOf(p, id) {
    const a = p.ammo[id];
    // Finish a reload lazily once its time is up.
    if (a && p.reloadUntil && now() >= p.reloadUntil && p.reloading === id) {
      const w = WEAPONS[id];
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take;
      a.reserve -= take;
      p.reloadUntil = 0;
      p.reloading = null;
    }
    return a;
  }

  startReload(p) {
    if (!this.canAct(p)) return;
    const id = p.weapons[p.slot];
    const w = WEAPONS[id];
    const a = this.ammoOf(p, id);
    if (!w || w.melee || !a || a.mag >= w.mag || a.reserve <= 0 || p.reloadUntil) return;
    p.reloadUntil = now() + w.reload * 1000;
    p.reloading = id;
    this.broadcastNear(p, { t: 'reload', id: p.id, w: id }, 40);
    this.syncMe(p);
  }

  // Positions of a soldier at an earlier time (lag compensation).
  positionAt(o, t) {
    const h = o.history;
    if (!h.length || t >= h[h.length - 1].t) return o;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      const b = h[i];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: b.crouch, downed: b.downed };
      }
    }
    return h[0];
  }

  onFire(p, m) {
    if (!this.canAct(p)) return;
    const id = p.weapons[p.slot];
    const w = WEAPONS[id];
    if (!w || w.melee || m.w !== id) return;
    const t = now();
    const a = this.ammoOf(p, id);
    if (p.reloadUntil && t < p.reloadUntil) return;
    if (!a || a.mag <= 0) return;
    if (t - p.lastFire < (60000 / w.rpm) * 0.85) return;
    if (!Array.isArray(m.o) || !Array.isArray(m.d) || ![...m.o, ...m.d].every(Number.isFinite)) return;
    // The shot must start near the shooter's eyes.
    const vo = this.world.shotOrigin(p);
    if (vo) {
      if (Math.hypot(m.o[0] - vo[0], m.o[1] - vo[1], m.o[2] - vo[2]) > 2.6) return;
    } else {
      const eyeY = p.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye);
      if (Math.hypot(m.o[0] - p.x, m.o[1] - eyeY, m.o[2] - p.z) > 1.6) return;
    }
    p.lastFire = t;
    p.firedAt = t;
    p.shots++;
    a.mag--;
    p.protectUntil = 0; // shooting ends spawn protection
    const d = normalise(m.d);
    const rewind = Math.max(t - NET.maxRewindMs, Math.min(t, Number(m.ts) || t));
    if (w.projectile) this.launchRocket(p, m.o, d, id);
    else this.hitscan(p, m.o, d, id, rewind);
    if (a.mag === 0 && a.reserve > 0) this.startReload(p);
    this.syncMe(p);
  }

  // Bullets: walls, thin-wall penetration, rewound hitboxes, damage falloff.
  hitscan(p, o, d, id, rewindT = now()) {
    const w = WEAPONS[id];
    const pellets = w.pellets || 1;
    // Nobody can shoot someone sitting inside an armoured carrier.
    const targets = [...this.players.values()].filter((x) => x !== p && (x.status === 'alive' || x.status === 'downed') && !this.world.armoredSeat(x));
    const ignore = this.world.seatOf(p)?.box ?? -1; // shooting out of your own vehicle
    const ends = [];
    for (let k = 0; k < pellets; k++) {
      const dir = pellets > 1 ? spreadDir(d, w.spread, this.rng) : d;
      let ox = o[0];
      let oy = o[1];
      let oz = o[2];
      let travelled = 0;
      let mult = 1;
      let penetrations = 0;
      let vpass = 0;
      let end = null;
      for (;;) {
        const remaining = w.range - travelled;
        if (remaining <= 0) break;
        const wall = raycast(this.map.index, ox, oy, oz, dir[0], dir[1], dir[2], remaining, ignore);
        const box = wall.box >= 0 ? this.map.boxes[wall.box] : null;
        const veh = this.world.vehicleOfBox(box);
        const vdef = veh ? VEHICLES[veh.type] : null;
        // Someone sitting in a car can be hit through the door or window.
        const softCar = veh && !vdef.armored && veh.state < 2;
        const reach = softCar ? wall.exitT : wall.t;
        // Smoke does not stop bullets, only sight.
        let best = null;
        for (const tgt of targets) {
          const pos = tgt.human ? this.positionAt(tgt, rewindT) : tgt;
          const h = hitSoldier(ox, oy, oz, dir[0], dir[1], dir[2], { x: pos.x, y: pos.y, z: pos.z, crouch: pos.crouch, downed: tgt.status === 'downed' });
          if (h && h.t < reach && (!best || h.t < best.h.t)) best = { tgt, h };
        }
        // Crocodiles and dogs take bullets too.
        const croc = this.wildlife.rayHit(ox, oy, oz, dir[0], dir[1], dir[2], Math.min(remaining, reach, best ? best.h.t : Infinity));
        if (croc) {
          end = [ox + dir[0] * croc.t, oy + dir[1] * croc.t, oz + dir[2] * croc.t];
          this.wildlife.hurt(croc.c, w.dmg * mult, p);
          break;
        }
        if (best) {
          const dist = travelled + best.h.t;
          const [f0, f1] = w.falloff || [w.range, w.range];
          const fall = dist <= f0 ? 1 : dist >= f1 ? 0.55 : 1 - ((dist - f0) / (f1 - f0)) * 0.45;
          let dmg = w.dmg * fall * mult;
          if (softCar && best.h.t > wall.t) dmg *= this.world.bulletHit(box, w.dmg * mult, p, id);
          if (best.h.zone === 'head') dmg *= w.head || 1;
          if (best.h.zone === 'leg') dmg *= w.legMult || 0.75;
          end = [ox + dir[0] * best.h.t, oy + dir[1] * best.h.t, oz + dir[2] * best.h.t];
          this.damage(best.tgt, p, dmg, { zone: best.h.zone, weapon: id, wall: penetrations > 0, from: o });
          // A bullet stops in the body.
          break;
        }
        if (wall.t >= remaining) {
          end = [ox + dir[0] * remaining, oy + dir[1] * remaining, oz + dir[2] * remaining];
          break;
        }
        end = [ox + dir[0] * wall.t, oy + dir[1] * wall.t, oz + dir[2] * wall.t];
        if (box?.fuel) this.hitDrum(wall.box, w.dmg * mult, p);
        if (box?.tank !== undefined) this.hitTank(box.tank, w.dmg * mult * TANKS.bulletMult, p);
        // Vehicles: bullets dent cars and go through them; armour stops them cold.
        if (veh) {
          const carry = this.world.bulletHit(box, w.dmg * mult, p, id);
          if (carry > 0 && vpass < 1) {
            vpass++;
            mult *= carry;
            travelled += wall.exitT + 0.01;
            ox = o[0] + dir[0] * travelled;
            oy = o[1] + dir[1] * travelled;
            oz = o[2] + dir[2] * travelled;
            continue;
          }
          break;
        }
        // Thin walls (mud, plank, zinc, crates) can be shot through by powerful rounds.
        const thick = box ? wall.exitT - wall.t : Infinity;
        if (box && box.pen && thick < 0.55 && w.pen > 0 && penetrations < 1) {
          penetrations++;
          mult *= w.pen * (1 - thick);
          travelled += wall.exitT + 0.01;
          ox = o[0] + dir[0] * travelled;
          oy = o[1] + dir[1] * travelled;
          oz = o[2] + dir[2] * travelled;
          // Keep the origin anchored to the real start for distance falloff.
          continue;
        }
        break;
      }
      ends.push(end ? end.map((v) => +v.toFixed(2)) : null);
    }
    this.broadcastNear(p, { t: 'shot', id: p.id, w: id, o: o.map((v) => +v.toFixed(2)), e: ends }, 400);
    this.wildlife.scare(o[0], o[2], 30, p);
  }

  onMelee(p, m) {
    if (!this.canAct(p)) return;
    const t = now();
    const punch = m?.kind === 'punch';
    if (punch) {
      if (t - (p.lastPunch || 0) < PUNCH.cooldownMs || t - p.lastFire < 250) return;
      p.lastPunch = t;
    } else {
      if (t - p.lastFire < 500) return;
      p.lastFire = t;
    }
    const w = punch ? { range: PUNCH.range, dmg: PUNCH.dmg, backstab: PUNCH.backstab, lunge: PUNCH.lunge } : WEAPONS.knife;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    // A swing reaches a little further with a lunge: you close the last step onto someone
    // you're facing, so hand-to-hand fights actually connect.
    const reach = w.range + (w.lunge || 0);
    let best = null;
    for (const o of this.players.values()) {
      if (!this.enemies(p, o) || (o.status !== 'alive' && o.status !== 'downed')) continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach || Math.abs(o.y - p.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / (dist || 1) < (dist <= w.range ? 0.45 : 0.75)) continue;
      if (dist > w.range && lineBlocked(this.map.index, p.x, p.y + 1, p.z, o.x, o.y + 1, o.z)) continue;
      if (!best || dist < best.dist) best = { o, dist, dx, dz };
    }
    this.broadcastNear(p, { t: 'swing', id: p.id, punch }, 30);
    if (!best) {
      // Dogs and crocodiles can be fought hand to hand too.
      this.wildlife.melee(p, fx, fz, reach, punch ? PUNCH.dmg : w.dmg);
      return;
    }
    if (best.dist > w.range) {
      const k = (best.dist - w.range * 0.65) / best.dist;
      const nx = p.x + best.dx * k;
      const nz = p.z + best.dz * k;
      if (!insideAnyBox(this.map.index, nx, p.y, nz, p.crouch, (b) => b.veh !== undefined)) {
        p.x = nx;
        p.z = nz;
        this.send(p, { t: 'lunge', x: +nx.toFixed(2), z: +nz.toFixed(2) });
      }
    }
    // Backstab: attacker is behind the victim.
    const vfx = -Math.sin(best.o.yaw);
    const vfz = -Math.cos(best.o.yaw);
    const behind = best.dx * vfx + best.dz * vfz > 0;
    let dmg = behind ? w.backstab : w.dmg;
    if (punch) {
      // Combo: keep landing punches on the same person for a heavy blow.
      const c = p.combo && p.combo.id === best.o.id && t - p.combo.t < PUNCH.comboWindowMs ? p.combo.n + 1 : 1;
      p.combo = { id: best.o.id, n: c, t };
      if (c >= PUNCH.combo) {
        dmg += PUNCH.comboBonus;
        p.combo.n = 0;
        this.send(p, { t: 'combo' });
      }
    }
    this.damage(best.o, p, dmg, { zone: 'body', weapon: punch ? 'fist' : 'knife', melee: true, from: [p.x, p.y + 1.4, p.z] });
    this.broadcastNear(best.o, { t: 'punchHit', id: best.o.id, by: p.id, heavy: punch && p.combo.n === 0 }, 30);
  }

  // ---------- damage, downs, deaths ----------
  damage(v, attacker, amount, { zone = 'body', weapon, explosive = false, melee = false, from = null, wall = false } = {}) {
    if (v.status === 'downed') {
      if (attacker && attacker.side !== v.side) this.kill(v, attacker, weapon, zone === 'head');
      return;
    }
    if (v.status !== 'alive') return;
    if (attacker && attacker !== v && attacker.side === v.side) return; // no friendly fire
    if (this.protectedNow(v) && attacker !== v) return;
    if (this.chatting(v) && attacker !== v) return;
    if (this.world.armoredSeat(v) && attacker !== v) return; // safe inside the APC
    v.hurtAt = now();
    // Bots hit human players softer, so a fight is about skill and not getting melted.
    if (attacker && !attacker.human && v.human) {
      amount *= HEALTH.botDamageToHumans;
      if (!explosive) amount = Math.min(amount, HEALTH.botMaxHit);
    }
    let hp = amount;
    const w = WEAPONS[weapon] || {};
    const pen = w.armorPen ?? 0.6;
    if (explosive) {
      if (v.armor > 0) {
        hp = amount * 0.6;
        v.armor = Math.max(0, v.armor - amount * 0.3);
      }
    } else if (!melee && zone !== 'leg' && v.armor > 0 && (zone !== 'head' || v.helmet)) {
      hp = amount * pen;
      v.armor = Math.max(0, v.armor - amount * (1 - pen) * 0.5);
    }
    v.health -= hp;
    if (attacker && attacker !== v) {
      const rec = v.damagers.get(attacker.id) || { dmg: 0, t: 0 };
      rec.dmg += hp;
      rec.t = now();
      v.damagers.set(attacker.id, rec);
      if (!explosive && !melee && weapon !== 'fire') attacker.hits++;
      this.send(attacker, { t: 'hit', head: zone === 'head', kill: v.health <= 0, wall });
    }
    const dir = from || (attacker ? [attacker.x, attacker.y + 1.4, attacker.z] : null);
    this.send(v, { t: 'hurt', dmg: Math.round(hp), from: dir, zone });
    v.bot?.onHurt(attacker);
    // Second wind: once per life a human survives a killing blow on a little health.
    if (v.health <= 0 && v.human && attacker && !attacker.human && !v.secondWindUsed && v.status === 'alive') {
      v.secondWindUsed = true;
      v.health = HEALTH.secondWindHp;
      v.protectUntil = now() + HEALTH.secondWindMs;
      v.hurtAt = now();
      this.send(v, { t: 'secondWind' });
      this.syncMe(v);
      return;
    }
    if (v.health <= 0) {
      const instant = !v.human || zone === 'head' || explosive || melee;
      const teammateAlive = [...this.players.values()].some((o) => o !== v && o.human && o.side === v.side && o.status === 'alive');
      if (!instant && teammateAlive) this.down(v, attacker, weapon);
      else this.kill(v, attacker, weapon, zone === 'head');
    } else this.syncMe(v);
  }

  down(v, attacker, weapon) {
    if (v.veh != null) this.world.exit(v);
    v.status = 'downed';
    v.health = 0;
    v.downedAt = now();
    v.downedBy = attacker?.id || null;
    v.downedWeapon = weapon;
    this.broadcast({ t: 'down', id: v.id, by: attacker?.id || null });
    this.syncMe(v);
  }

  kill(v, killer, weapon, headshot = false) {
    if (v.status === 'dead' || v.status === 'spirit' || v.status === 'medevac') return;
    const t = now();
    if (v.veh != null) this.world.exit(v, true);
    v.status = 'dead';
    v.health = 0;
    v.deadAt = t;
    if (v.y > -0.5) v.fellAt = { x: v.x, z: v.z };
    v.deaths++;
    v.streak = 0;
    v.reviver = null;
    // Lose bought kit on death (money stays).
    v.weapons.primary = null;
    v.slot = 'secondary';
    if (killer && killer !== v && killer.side !== v.side) {
      killer.kills++;
      killer.streak++;
      if (headshot) killer.headshots++;
      const reward = Math.round((WEAPONS[weapon]?.kill ?? 300) * (this.hooks.control?.eventMult('money') || 1));
      killer.money = Math.min(MONEY.max, killer.money + reward);
      killer.points += MATCH.killPoints + (headshot ? MATCH.headshotBonus : 0);
      this.score[killer.side] += this.mode.killPoints(killer, headshot);
      this.addXP(killer, XP.kill + (headshot ? XP.headshot : 0));
      // Killstreak rewards.
      const artilleryAt = FACTIONS[killer.faction].perks.artilleryAt || KILLSTREAKS.artillery.kills;
      if (killer.streak === KILLSTREAKS.uav.kills) this.grantStreak(killer, 'uav');
      if (killer.streak === artilleryAt) this.grantStreak(killer, 'artillery');
      this.syncMe(killer);
      // Rivalries between real people.
      if (killer.human && v.human && this.hooks.social && !this.practice) {
        const r = this.hooks.social.recordKill(killer.profile, v.profile);
        if (r.revenge) {
          this.addXP(killer, 150);
          this.send(killer, { t: 'revenge', name: v.profile.name });
        }
        const rival = this.hooks.social.rivalOf(v.profile);
        if (rival && rival.token === killer.profile.token) this.toast(v, `Your rival ${killer.profile.name} again! Pay them back.`, 'bad');
      }
      if (killer.human && !this.practice) {
        this.hooks.control?.track('kill');
        killer.profile.kills++;
        this.mission(killer, 'kills');
        if (headshot) this.mission(killer, 'headshots');
      }
    }
    // Assists.
    for (const [id, rec] of v.damagers) {
      if (killer && id === killer.id) continue;
      const o = this.players.get(id);
      if (!o || o.side === v.side || rec.dmg < 35 || t - rec.t > 10000) continue;
      o.assists++;
      o.money = Math.min(MONEY.max, o.money + MONEY.assist);
      o.points += 3;
      this.syncMe(o);
    }
    if (v.human && !this.practice) v.profile.deaths++;
    this.broadcast({ t: 'kill', killer: killer?.id || null, victim: v.id, w: weapon, head: headshot, kn: killer?.name, vn: v.name, ks: killer?.side, vs: v.side });
    if (!v.human) v.bot.respawnAt = t + this.mode.botRespawnMs(v);
    this.mode.onKill(v, killer, weapon, headshot);
    this.syncMe(v);
  }

  grantStreak(p, kind) {
    p.streaksAvail[kind] = true;
    this.toast(p, `${KILLSTREAKS[kind].name} is ready! Press ${kind === 'uav' ? '5' : '6'} to call it in.`, 'streak');
    if (!p.human) p.bot.useStreak(kind);
  }

  // Daily mission progress (humans only).
  mission(p, kind, n = 1) {
    if (!p.human || !this.hooks.daily || this.practice) return;
    const done = this.hooks.daily.progress(p.profile, kind, n);
    for (const m of done) this.toast(p, `Mission complete: ${m.title}! Claim it in 🎁 Daily.`, 'streak');
  }

  addXP(p, n) {
    if (!p.human || this.practice) return;
    n = Math.round(n * (this.hooks.control?.eventMult('xp') || 1)); // admin events (double XP weekend)
    const before = Math.floor(p.profile.xp / XP.levelEvery);
    p.profile.xp += n;
    p.xp += n;
    const after = Math.floor(p.profile.xp / XP.levelEvery);
    if (after > before) {
      p.profile.gems += GEMS.levelUpGems;
      this.toast(p, `Promoted! +${GEMS.levelUpGems} life gems 💎`, 'gem');
    }
  }

  // ---------- respawning ----------
  onRespawn(p, mode, at) {
    // Come back where you fell (if it's safe) or fresh at your base: the player chooses.
    if (at === 'here' || at === 'base') p.comeBack = at;
    if (!['dead', 'spirit'].includes(p.status)) return;
    if (this.practice) return this.spawn(p);
    if (!this.mode.canRespawn(p)) return this.toast(p, 'No respawn in this mode. You will join the next round.', 'info');
    if (mode === 'gem') {
      if (p.profile.gems < RESPAWN.gemCost) return this.toast(p, 'You have no life gems. Try a Spirit Run or wait for medevac.', 'bad');
      p.profile.gems -= RESPAWN.gemCost;
      this.hooks.saveProfile();
      this.spawn(p);
      this.toast(p, 'Life gem used. Back to the front!', 'gem');
    } else if (mode === 'spirit' && p.status === 'dead') {
      p.status = 'spirit';
      p.spiritUntil = now() + RESPAWN.spiritMs;
      p.y = Math.max(p.y, 0);
      this.send(p, { t: 'spirit', x: p.x, y: p.y, z: p.z, until: p.spiritUntil });
      this.syncMe(p);
    } else if (mode === 'medevac') {
      p.status = 'medevac';
      p.medevacAt = now() + RESPAWN.medevacMs;
      this.syncMe(p);
    }
  }

  // Near where you fell, but not in sight of the enemy who got you: a free spot with no living
  // enemy within 16 m. Null when nowhere close is safe (then you start at base).
  safeSpotNear(p, x, z) {
    for (let r = 0; r <= 8; r += 2) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = (k / 8) * Math.PI * 2;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        if (!this.freeSpot(sx, sz)) continue;
        let safe = true;
        for (const o of this.players.values()) {
          if (this.enemies(p, o) && o.status === 'alive' && Math.hypot(o.x - sx, o.z - sz) < 16) {
            safe = false;
            break;
          }
        }
        if (safe) return { x: sx, z: sz };
      }
    }
    return null;
  }

  // Somewhere a soldier can stand (not inside a wall, not in water, not over a stairwell).
  freeSpot(x, z) {
    const lim = this.map.half - 4;
    return Math.abs(x) < lim && Math.abs(z) < lim && !insideAnyBox(this.map.index, x, 0, z) && !inWater(this.map, x, z) && !holeAt(this.map.index, x, z);
  }

  // ---------- buying ----------
  inBuyZone(p) {
    if (this.practice) return true;
    const b = this.map.bases[p.side];
    return Math.hypot(p.x - b.x, p.z - b.z) < MONEY.buyZoneRadius || now() < p.spawnAt + MONEY.buyWindowMs;
  }

  onBuy(p, item) {
    if (p.status !== 'alive') return;
    if (!this.inBuyZone(p)) return this.toast(p, 'You can only buy at your base or right after you deploy.', 'bad');
    const price = priceFor(item, p.faction);
    const w = WEAPONS[item];
    const g = GEAR[item];
    if (!w && !g) return;
    if (w && (w.melee || item === 'p9' || w.loot)) return;
    if (w?.unlockLevel && rankFor(p.profile.xp).level < w.unlockLevel) return this.toast(p, `${w.name} unlocks at rank level ${w.unlockLevel}.`, 'bad');
    if (p.money < price) return this.toast(p, 'Your money no reach.', 'bad');
    if (w) {
      if (p.weapons[w.slot] === item) {
        // Buying the same gun again refills ammo.
        p.ammo[item] = { mag: w.mag, reserve: w.reserve };
      } else this.giveWeapon(p, item);
      p.slot = w.slot;
      p.reloadUntil = 0;
    } else if (item === 'vest' || item === 'helmet') {
      if (p.armor >= 100 && (p.helmet || item === 'vest')) return this.toast(p, 'You already have it.', 'bad');
      p.armor = 100;
      if (item === 'helmet') p.helmet = true;
    } else if (item === 'medkit') {
      if (p.medkit >= g.max) return this.toast(p, 'You can only carry one.', 'bad');
      p.medkit++;
    } else if (item === 'bloodpill') {
      if ((p.bloodpill || 0) >= g.max) return this.toast(p, `You can only carry ${g.max} pills.`, 'bad');
      p.bloodpill = (p.bloodpill || 0) + 1;
    } else {
      if (p[item] >= g.max) return this.toast(p, `You can only carry ${g.max}.`, 'bad');
      p[item]++;
    }
    p.money -= price;
    this.send(p, { t: 'bought', item });
    this.syncMe(p);
  }

  // Blood pill: heals over a few seconds, and you can keep moving and fighting.
  onPill(p) {
    if (p.status !== 'alive' || this.chatting(p) || !(p.bloodpill > 0) || p.health >= PLAYER.maxHealth || p.pillUntil > now()) return;
    p.bloodpill--;
    p.pillUntil = now() + GEAR.bloodpill.secs * 1000;
    this.broadcastNear(p, { t: 'pill', id: p.id }, 15);
    this.syncMe(p);
  }

  pickGemType() {
    const types = Object.entries(TILE_GEMS.types);
    let r = this.rng() * types.reduce((n, [, t]) => n + t.weight, 0);
    for (const [id, t] of types) if ((r -= t.weight) <= 0) return id;
    return 'ruby';
  }

  tileGemView() {
    return this.tileGems.map((g) => [g.type, g.at]);
  }

  // Walk over a gemstone on a ground advert tile to heal up.
  stepTileGems(t) {
    this.tileGems.forEach((g, i) => {
      if (g.at > t) return;
      for (const p of this.players.values()) {
        if (!p.human || p.status !== 'alive') continue;
        if (Math.hypot(p.x - g.x, p.z - g.z) > TILE_GEMS.radius || p.y > 1.5 || p.y < -1) continue;
        const def = TILE_GEMS.types[g.type];
        const needHeal = def.heal && p.health < PLAYER.maxHealth;
        const needArmor = def.armor && p.armor < 100;
        if (!needHeal && !needArmor) continue; // leave it for someone who needs it
        if (def.heal) p.health = Math.min(PLAYER.maxHealth, p.health + def.heal);
        if (def.armor) p.armor = Math.min(100, p.armor + def.armor);
        const was = g.type;
        g.at = t + TILE_GEMS.respawnMs;
        g.type = this.pickGemType();
        this.broadcast({ t: 'tgem', i, at: g.at, type: g.type, took: was, by: p.name, id: p.id });
        this.hooks.ads.recordGem(g.tile, false);
        this.mission(p, 'gems');
        this.syncMe(p);
        break;
      }
    });
  }

  onMedkit(p) {
    if (!this.canAct(p) || p.medkit <= 0 || p.health >= 100 || p.healAt) return;
    p.medkit--;
    p.healAt = now() + GEAR.medkit.useTime * 1000;
    this.syncMe(p);
  }

  // ---------- grenades, rockets, explosions ----------
  onThrow(p, m) {
    if (!this.canAct(p) || !['frag', 'smoke', 'flash'].includes(m.kind) || p[m.kind] <= 0) return;
    if (!Array.isArray(m.o) || !Array.isArray(m.v) || ![...m.o, ...m.v].every(Number.isFinite)) return;
    const speed = Math.hypot(...m.v);
    const v = speed > 22 ? m.v.map((c) => (c / speed) * 22) : m.v;
    p[m.kind]--;
    this.throwGrenade(p, m.kind, m.o, v);
    this.syncMe(p);
  }

  throwGrenade(p, kind, o, v) {
    this.projectiles.push({ id: randomUUID().slice(0, 6), kind, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], owner: p.id, side: p.side, fuse: GEAR[kind].fuse, rest: false });
    this.broadcastNear(p, { t: 'throw', id: p.id, kind }, 60);
  }

  launchRocket(p, o, d, id) {
    const w = WEAPONS[id];
    this.projectiles.push({ id: randomUUID().slice(0, 6), kind: 'rocket', x: o[0] + d[0] * 0.8, y: o[1] + d[1] * 0.8, z: o[2] + d[2] * 0.8, vx: d[0] * w.rocketSpeed, vy: d[1] * w.rocketSpeed, vz: d[2] * w.rocketSpeed, owner: p.id, side: p.side, fuse: 6, weapon: id, ignore: this.world.seatOf(p)?.box ?? -1 });
    this.broadcastNear(p, { t: 'shot', id: p.id, w: id, o, e: [null] }, 400);
  }

  stepProjectiles(dt) {
    const keep = [];
    for (const pr of this.projectiles) {
      pr.fuse -= dt;
      const owner = this.players.get(pr.owner);
      if (pr.kind === 'rocket') {
        const RW = WEAPONS[pr.weapon] || WEAPONS.rpg;
        pr.vy -= (RW.gravity ?? 2.5) * dt;
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        const d = [pr.vx / sp, pr.vy / sp, pr.vz / sp];
        const len = sp * dt;
        const wall = raycast(this.map.index, pr.x, pr.y, pr.z, d[0], d[1], d[2], len, pr.ignore ?? -1);
        let hitT = wall.t < len ? wall.t : Infinity;
        for (const o of this.players.values()) {
          if (o.id === pr.owner || o.status !== 'alive') continue;
          const h = hitSoldier(pr.x, pr.y, pr.z, d[0], d[1], d[2], o);
          if (h && h.t < hitT && h.t <= len) hitT = h.t;
        }
        if (hitT !== Infinity || pr.fuse <= 0) {
          const t = hitT === Infinity ? len : hitT;
          this.explode(pr.x + d[0] * t, pr.y + d[1] * t, pr.z + d[2] * t, RW.blast, RW.dmg, owner, pr.weapon || 'rpg');
          continue;
        }
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.z += pr.vz * dt;
        keep.push(pr);
        continue;
      }
      // Grenades: gravity, bounces off walls and the ground.
      if (!pr.rest) {
        pr.vy -= PLAYER.gravity * dt;
        const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
        if (sp > 0.01) {
          const d = [pr.vx / sp, pr.vy / sp, pr.vz / sp];
          const len = sp * dt;
          const wall = raycast(this.map.index, pr.x, pr.y, pr.z, d[0], d[1], d[2], len + 0.05);
          if (wall.box !== -1 && wall.t <= len + 0.05) {
            // Bounce: figure out which face was hit from the box or the ground.
            pr.x += d[0] * Math.max(0, wall.t - 0.06);
            pr.y += d[1] * Math.max(0, wall.t - 0.06);
            pr.z += d[2] * Math.max(0, wall.t - 0.06);
            if (wall.box === -2) {
              pr.vy = -pr.vy * 0.35;
              pr.vx *= 0.6;
              pr.vz *= 0.6;
              pr.y = Math.max(pr.y, 0.06);
            } else {
              const b = this.map.boxes[wall.box];
              const hx = pr.x + d[0] * 0.07;
              const hz = pr.z + d[2] * 0.07;
              const dxm = Math.min(Math.abs(hx - b.x0), Math.abs(hx - b.x1));
              const dzm = Math.min(Math.abs(hz - b.z0), Math.abs(hz - b.z1));
              const dym = Math.abs(pr.y - b.y1);
              if (dym < 0.15 && pr.vy < 0) pr.vy = -pr.vy * 0.35;
              else if (dxm < dzm) pr.vx = -pr.vx * 0.45;
              else pr.vz = -pr.vz * 0.45;
            }
            if (Math.hypot(pr.vx, pr.vy, pr.vz) < 1.2 && pr.y < 3) pr.rest = true;
          } else {
            pr.x += pr.vx * dt;
            pr.y += pr.vy * dt;
            pr.z += pr.vz * dt;
          }
        }
      }
      if (pr.fuse <= 0) {
        if (pr.kind === 'frag') this.explode(pr.x, Math.max(0.2, pr.y), pr.z, GEAR.frag.blast, GEAR.frag.dmg, owner, 'frag');
        else if (pr.kind === 'smoke') {
          this.smokes.push({ x: pr.x, z: pr.z, r: GEAR.smoke.radius, until: now() + GEAR.smoke.duration * 1000 });
          this.broadcast({ t: 'smoke', x: pr.x, z: pr.z, r: GEAR.smoke.radius, dur: GEAR.smoke.duration });
        } else this.flashbang(pr);
        continue;
      }
      keep.push(pr);
    }
    this.projectiles = keep;
  }

  // env: a burst fuel drum hurts everyone nearby, teammates of the shooter included.
  explode(x, y, z, radius, dmg, owner, weapon, env = false) {
    this.broadcast({ t: 'boom', x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), r: radius, w: weapon });
    for (const o of this.players.values()) {
      if (o.status !== 'alive' && o.status !== 'downed') continue;
      const cy = o.y + 0.9;
      const dist = Math.hypot(o.x - x, cy - y, o.z - z);
      if (dist > radius) continue;
      if (!env && owner && o !== owner && o.side === owner.side) continue;
      const blocked = lineBlocked(this.map.index, x, y + 0.25, z, o.x, cy, o.z);
      let hp = dmg * Math.pow(1 - dist / radius, 1.2) * (blocked ? 0.2 : 1);
      if (o === owner) hp *= 0.5;
      if (hp < 1) continue;
      const attacker = owner && o !== owner && o.side === owner.side ? null : owner;
      this.damage(o, attacker, hp, { zone: 'body', weapon, explosive: true, from: [x, y, z] });
    }
    // Blasts set off fuel drums caught in them.
    for (const bi of this.map.drums) {
      const b = this.map.boxes[bi];
      if (!b.fuel || this.drumsDead.includes(b.drum)) continue;
      const d = Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z);
      if (d < radius * 0.85) this.hitDrum(bi, dmg * (1.2 - d / radius), owner);
    }
    // Fuel tanks caught in a blast.
    (this.map.tanks || []).forEach((bi, ti) => {
      const b = this.map.boxes[bi];
      if (this.tanksDead.includes(ti) || weapon === 'tank' && Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z) < 1) return;
      const d = Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z) - (b.x1 - b.x0) / 2;
      if (d < radius) this.hitTank(ti, dmg * Math.max(0.3, 1.3 - d / radius), owner);
    });
    // Vehicles and houses caught in the blast.
    this.world.onBlast(x, y, z, radius, dmg, owner, weapon);
    this.wildlife.onBlast(x, y, z, radius, dmg, owner);
  }

  // ---------- fuel tanks ----------
  hitTank(ti, dmg, by) {
    if (this.tanksDead.includes(ti) || !(dmg > 0)) return;
    this.tankHp[ti] -= dmg;
    if (this.tankHp[ti] > 0) return;
    this.tanksDead.push(ti);
    const b = this.map.boxes[this.map.tanks[ti]];
    const x = (b.x0 + b.x1) / 2;
    const z = (b.z0 + b.z1) / 2;
    b.oy0 = b.y0;
    b.oy1 = b.y1;
    b.y0 = -3;
    b.y1 = -2.5;
    this.broadcast({ t: 'tank', i: ti, x: +x.toFixed(2), z: +z.toFixed(2), by: by?.name || null });
    // A little later than the hit, so chains of tanks go up one after another.
    setTimeout(() => {
      if (!this.players) return;
      this.explode(x, 2, z, TANKS.blast, TANKS.dmg, by && by.status !== undefined ? by : null, 'tank', true);
      const t = now();
      for (const o of this.players.values()) {
        if (o.status !== 'alive' || Math.hypot(o.x - x, o.z - z) > TANKS.burnRadius || o.y > 4) continue;
        o.burnUntil = Math.max(o.burnUntil || 0, t + TANKS.burnSecs * 1000);
        o.burnBy = by && by.side !== o.side ? by.id : null;
        o.burnAcc = o.burnAcc || 0;
      }
    }, 120);
  }

  // ---------- fuel drums ----------
  hitDrum(bi, dmg, by) {
    const b = this.map.boxes[bi];
    if (!b?.fuel || this.drumsDead.includes(b.drum)) return;
    this.drumHp[b.drum] -= dmg;
    if (this.drumHp[b.drum] <= 0 && !this.drumQueue.some((q) => q.bi === bi)) this.drumQueue.push({ bi, at: now() + (dmg > 100 ? DRUMS.chainDelayMs : 0), by: by?.id || null });
  }

  detonateDrum(bi, byId) {
    const b = this.map.boxes[bi];
    if (this.drumsDead.includes(b.drum)) return;
    this.drumsDead.push(b.drum);
    const x = (b.x0 + b.x1) / 2;
    const z = (b.z0 + b.z1) / 2;
    // The drum is gone: sink its collision box below the ground.
    b.oy0 = b.y0;
    b.oy1 = b.y1;
    b.y0 = -3;
    b.y1 = -2.5;
    const by = byId ? this.players.get(byId) || null : null;
    this.broadcast({ t: 'drum', i: b.drum, x: +x.toFixed(2), z: +z.toFixed(2), by: by?.name || null });
    this.explode(x, 0.6, z, DRUMS.blast, DRUMS.dmg, by, 'drum', true);
    // Burning fuel splashes over anyone close: the closer, the longer they burn.
    const t = now();
    for (const o of this.players.values()) {
      if (o.status !== 'alive') continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d > DRUMS.burnRadius || o.y > 2.5) continue;
      if (lineBlocked(this.map.index, x, 0.8, z, o.x, o.y + 0.9, o.z)) continue;
      const secs = DRUMS.burnSecs * (1.15 - (d / DRUMS.burnRadius) * 0.6);
      o.burnUntil = Math.max(o.burnUntil || 0, t + secs * 1000);
      o.burnBy = by && by.side !== o.side ? by.id : null;
      o.burnAcc = o.burnAcc || 0;
    }
  }

  stepDrums(dt) {
    const t = now();
    if (this.drumQueue.length) {
      const due = this.drumQueue.filter((q) => q.at <= t);
      this.drumQueue = this.drumQueue.filter((q) => q.at > t);
      for (const q of due) this.detonateDrum(q.bi, q.by);
    }
    for (const p of this.players.values()) {
      if (!(p.burnUntil > t)) continue;
      if (p.status !== 'alive' || (p.y < 0.2 && inWater(this.map, p.x, p.z))) {
        p.burnUntil = 0; // water (or going down) puts the flames out
        continue;
      }
      p.burnAcc += DRUMS.burnDps * dt;
      if (p.burnAcc >= 3) {
        const hp = Math.floor(p.burnAcc);
        p.burnAcc -= hp;
        this.damage(p, (p.burnBy && this.players.get(p.burnBy)) || null, hp, { zone: 'body', weapon: 'fire', explosive: true });
      }
    }
  }

  flashbang(pr) {
    this.broadcast({ t: 'flashbang', x: pr.x, y: pr.y, z: pr.z });
    for (const o of this.players.values()) {
      if (o.status !== 'alive') continue;
      const ey = o.y + PLAYER.eye;
      const dist = Math.hypot(o.x - pr.x, ey - pr.y, o.z - pr.z);
      if (dist > GEAR.flash.radius || lineBlocked(this.map.index, pr.x, pr.y + 0.1, pr.z, o.x, ey, o.z)) continue;
      const fx = -Math.sin(o.yaw);
      const fz = -Math.cos(o.yaw);
      const facing = ((pr.x - o.x) * fx + (pr.z - o.z) * fz) / (dist || 1);
      const strength = Math.max(0, (1 - dist / GEAR.flash.radius) * (facing > 0 ? 1 : 0.35));
      if (strength < 0.05) continue;
      if (o.human) this.send(o, { t: 'flashed', s: +strength.toFixed(2) });
      else o.blindUntil = now() + strength * 3500;
    }
  }

  // ---------- killstreaks ----------
  onStreak(p, m) {
    if (!this.canAct(p) || !p.streaksAvail[m.kind]) return;
    if (m.kind === 'uav') {
      p.streaksAvail.uav = false;
      this.uav[p.side] = now() + KILLSTREAKS.uav.duration * 1000;
      this.broadcast({ t: 'uav', side: p.side, until: this.uav[p.side], by: p.name });
    } else if (m.kind === 'artillery') {
      if (![m.x, m.z].every(Number.isFinite)) return;
      const lim = this.map.half - 4;
      const x = Math.max(-lim, Math.min(lim, m.x));
      const z = Math.max(-lim, Math.min(lim, m.z));
      p.streaksAvail.artillery = false;
      this.callArtillery(p, x, z);
    }
    this.syncMe(p);
  }

  callArtillery(p, x, z) {
    const a = KILLSTREAKS.artillery;
    const t = now();
    const shells = [];
    for (let i = 0; i < a.shells; i++) {
      const ang = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * a.spread;
      shells.push({ x: x + Math.cos(ang) * r, z: z + Math.sin(ang) * r, at: t + (a.delay + i * a.interval) * 1000, warned: false });
    }
    this.artillery.push({ owner: p.id, side: p.side, shells });
    this.broadcast({ t: 'artillery', x, z, by: p.name, side: p.side, delay: a.delay });
  }

  stepArtillery() {
    const t = now();
    for (const strike of this.artillery) {
      const owner = this.players.get(strike.owner);
      for (const s of strike.shells) {
        if (!s.warned && t >= s.at - 1300) {
          s.warned = true;
          this.broadcast({ t: 'incoming', x: s.x, z: s.z, in: 1.3 });
        }
        if (!s.done && t >= s.at) {
          s.done = true;
          this.explode(s.x, 0.3, s.z, KILLSTREAKS.artillery.blast, KILLSTREAKS.artillery.dmg, owner || null, 'artillery');
        }
      }
    }
    this.artillery = this.artillery.filter((a) => a.shells.some((s) => !s.done));
  }

  // ---------- reviving teammates ----------
  onRevive(p, targetId) {
    const v = this.players.get(targetId);
    if (!this.canAct(p) || !v || v.status !== 'downed' || v.side !== p.side) return;
    if (Math.hypot(v.x - p.x, v.z - p.z) > 2.4) return;
    v.reviver = { id: p.id, since: now() };
    this.broadcastNear(p, { t: 'reviving', id: p.id, target: v.id }, 40);
  }

  // ---------- sites ----------
  stepSites(dt) {
    const all = this.discovery ? [...this.sites, this.discovery] : this.sites;
    for (const s of all) {
      let secPower = 0;
      let outPower = 0;
      for (const o of this.players.values()) {
        if (o.status !== 'alive' || o.y > 3) continue;
        if (Math.hypot(o.x - s.x, o.z - s.z) > s.r || o.y < -1) continue; // not from the tunnel below
        const mult = FACTIONS[o.faction].perks.captureMult || 1;
        if (o.side === 'sec') secPower += mult;
        else outPower += mult;
      }
      s.contested = secPower > 0 && outPower > 0;
      if (s.contested || (!secPower && !outPower)) continue;
      const dir = secPower ? 1 : -1;
      const power = Math.min(2.5, secPower || outPower);
      const before = s.progress;
      s.progress = Math.max(-1, Math.min(1, s.progress + (dir * power * dt) / MATCH.captureTime));
      if (s.owner && Math.sign(s.progress) !== (s.owner === 'sec' ? 1 : -1) && s.progress !== 0) {
        s.owner = null;
        this.broadcast({ t: 'site', id: s.id, owner: null, label: s.label, neutral: true });
      }
      const newOwner = s.progress >= 1 ? 'sec' : s.progress <= -1 ? 'out' : null;
      if (newOwner && newOwner !== s.owner && before !== s.progress) {
        s.owner = newOwner;
        const capturers = [...this.players.values()].filter((o) => o.side === newOwner && o.status === 'alive' && Math.hypot(o.x - s.x, o.z - s.z) <= s.r && o.y > -1);
        for (const c of capturers) {
          c.money = Math.min(MONEY.max, c.money + MONEY.capture);
          c.points += 15;
          this.addXP(c, XP.capture);
          this.mission(c, 'captures');
          this.syncMe(c);
        }
        this.score[newOwner] += 20;
        this.broadcast({ t: 'site', id: s.id, owner: newOwner, label: s.label, by: capturers.map((c) => c.name) });
      }
    }
  }

  // Once a second: points and income for every site held.
  payIncome() {
    const all = this.discovery ? [...this.sites, this.discovery] : this.sites;
    for (const s of all) {
      if (!s.owner) continue;
      const mult = s === this.discovery ? MATCH.discoveryPointsMult : 1;
      this.score[s.owner] += MATCH.sitePointsPerSec * mult;
      for (const o of this.players.values()) {
        if (o.side !== s.owner) continue;
        const inc = MONEY.incomePerSec * mult * (FACTIONS[o.faction].perks.incomeMult || 1);
        o.money = Math.min(MONEY.max, o.money + Math.round(inc));
      }
    }
  }

  stepDiscovery() {
    const t = now();
    if (this.discovery && t > this.discovery.until) {
      this.broadcast({ t: 'discoveryEnd', label: this.discovery.label });
      this.discovery = null;
    }
    if (!this.discovery && t > this.nextDiscoveryAt && this.map.discoverySpots.length) {
      this.nextDiscoveryAt = t + MATCH.discoveryEveryMs;
      const spot = this.map.discoverySpots[Math.floor(this.rng() * this.map.discoverySpots.length)];
      const pool = [...new Set([...this.map.state.resources, ...DISCOVERY_RES])];
      const res = pool[Math.floor(this.rng() * pool.length)];
      this.discovery = { id: 'D', resource: res, label: `New ${RESOURCES[res].label.toLowerCase()} deposit`, x: spot.x, z: spot.z, r: 8, progress: 0, owner: null, contested: false, until: t + MATCH.discoveryDurationMs };
      this.broadcast({ t: 'discovery', ...this.discovery });
    }
  }

  // ---------- life gems on advert walls ----------
  stepGems() {
    const t = now();
    this.map.adWalls.forEach((a, i) => {
      if (this.gems[i] > t) return;
      for (const p of this.players.values()) {
        if (!p.human) continue;
        const spirit = p.status === 'spirit';
        if (p.status !== 'alive' && !spirit) continue;
        if (Math.hypot(p.x - a.gem.x, p.z - a.gem.z) > GEMS.pickupRadius || p.y > a.gem.y + 1.5 || p.y < a.gem.y - 2.5) continue;
        // Collected: nobody can take this wall's gem for 2 minutes.
        this.gems[i] = t + GEMS.cooldownMs;
        this.broadcast({ t: 'gem', i, until: this.gems[i], by: p.name, spirit });
        this.hooks.ads.recordGem(a.id, spirit);
        this.mission(p, 'gems');
        if (spirit) {
          // The spirit comes back to life right at the gem it reached.
          const pref = p.comeBack;
          p.fellAt = { x: p.x, z: p.z };
          p.comeBack = 'here';
          this.spawn(p);
          p.comeBack = pref;
          this.toast(p, 'The gem pulled your spirit back!', 'gem');
        } else {
          p.profile.gems++;
          p.health = Math.min(PLAYER.maxHealth, p.health + GEMS.heal);
          this.toast(p, `+1 life gem 💎 (${p.profile.gems})`, 'gem');
          this.syncMe(p);
        }
        this.hooks.saveProfile();
        break;
      }
    });
  }

  // ---------- main tick ----------
  tick(dt) {
    const t = now();
    if (this.ended) {
      if (this.mode.def.solo) return; // campaign: the player chooses next stage / retry
      if (t >= this.endsAt) {
        this.reset();
        for (const p of this.humans()) this.send(p, this.info(p));
      }
      return;
    }
    // Campaign stage: the battle waits while you chat with a business.
    const paused = this.mode.def.solo && this.humans().some((h) => this.chatting(h));
    for (const p of this.players.values()) {
      if (p.chatUntil && t >= p.chatUntil) this.endChat(p, 'time');
      if (paused) continue;
      // Lag-compensation history (last ~1 s).
      p.history.push({ t, x: p.x, y: p.y, z: p.z, crouch: p.crouch, downed: p.status === 'downed' });
      if (p.history.length > NET.tickHz) p.history.shift();
      if (p.reloadUntil && t >= p.reloadUntil) {
        this.ammoOf(p, p.reloading);
        this.syncMe(p);
      }
      // Health comes back on its own a few seconds after the last hit (humans).
      if (p.human && p.status === 'alive' && p.health < PLAYER.maxHealth) {
        let gain = 0;
        if (t - (p.hurtAt || 0) > HEALTH.regenDelayMs) gain += HEALTH.regenPerSec * dt;
        if (p.pillUntil > t) gain += (GEAR.bloodpill.heal / GEAR.bloodpill.secs) * dt;
        if (gain) p.health = Math.min(PLAYER.maxHealth, p.health + gain);
      }
      if (p.healAt && t >= p.healAt) {
        p.healAt = 0;
        if (p.status === 'alive') p.health = Math.min(PLAYER.maxHealth, p.health + GEAR.medkit.heal);
        this.syncMe(p);
      }
      if (p.status === 'downed') {
        const r = p.reviver && this.players.get(p.reviver.id);
        if (r && r.status === 'alive' && Math.hypot(r.x - p.x, r.z - p.z) <= 2.6) {
          if (t - p.reviver.since >= RESPAWN.reviveTime * 1000) {
            p.status = 'alive';
            p.health = RESPAWN.reviveHealth;
            p.reviver = null;
            r.money = Math.min(MONEY.max, r.money + MONEY.revive);
            r.points += 5;
            this.addXP(r, XP.revive);
            this.mission(r, 'revives');
            this.broadcast({ t: 'revived', id: p.id, by: r.name });
            this.syncMe(p);
            this.syncMe(r);
          }
        } else if (p.reviver) p.reviver = null;
        if (p.status === 'downed' && t - p.downedAt > RESPAWN.downedMs) this.kill(p, this.players.get(p.downedBy) || null, p.downedWeapon || 'bleed');
      }
      if (p.status === 'spirit' && t > p.spiritUntil) {
        p.status = 'dead';
        p.deadAt = t;
        this.toast(p, 'Your spirit has faded. Use a gem or wait for medevac.', 'bad');
        this.syncMe(p);
      }
      if (p.status === 'medevac' && t >= p.medevacAt) {
        p.money = Math.max(0, p.money - RESPAWN.medevacFee);
        this.spawn(p);
        this.toast(p, `Medevac brought you back. Fee ₦${RESPAWN.medevacFee.toLocaleString()}.`, 'info');
      }
      if (this.practice && p.human && p.status === 'dead' && t - p.deadAt > 3000) this.spawn(p);
      // A human who leaves the death screen alone too long gets the medevac.
      if (p.human && p.status === 'dead' && t - p.deadAt > 60000 && this.mode.canRespawn(p)) this.onRespawn(p, 'medevac');
      if (!p.human) p.bot.tick(p, dt);
    }
    if (paused) {
      this.sendSnapshots();
      return;
    }
    this.stepProjectiles(dt);
    this.stepArtillery();
    this.smokes = this.smokes.filter((s) => s.until > t);
    this.stepDrums(dt);
    this.world.tick(dt);
    this.wildlife.tick(dt);
    if (this.mode.usesSites()) this.stepSites(dt);
    this.stepGems();
    this.stepTileGems(t);
    if (this.mode.usesSites()) this.stepDiscovery();
    this.mode.tick(dt);
    if (this.ended) return;
    this.secTimer = (this.secTimer || 0) + dt;
    if (this.secTimer >= 1) {
      this.secTimer -= 1;
      if (this.mode.usesSites()) this.payIncome();
      for (const p of this.humans()) this.syncMe(p);
      // The roster rides along so names, factions and the scoreboard stay current.
      this.broadcast({ t: 'score', score: this.score, sites: this.siteView(), roster: this.roster(), humans: this.humans().length, left: Math.max(0, this.mode.def.timeLimitMs - (t - this.startedAt)), modeState: this.mode.state() });
    }
    if (this.mode.checkEnd()) this.endMatch();
    this.sendSnapshots();
  }

  endMatch() {
    if (this.ended) return;
    const winner = this.mode.winner();
    this.ended = true;
    this.endsAt = now() + MATCH.endScreenMs;
    const roster = this.roster().sort((a, b) => b.points - a.points);
    const mvp = roster.find((r) => !r.bot && r.points > 0) || roster[0];
    for (const p of this.humans()) {
      if (this.practice) continue;
      p.profile.matches++;
      this.mission(p, 'matches');
      if (p.side === winner) {
        p.profile.wins++;
        this.addXP(p, XP.win);
        this.mission(p, 'wins');
      }
    }
    const medals = awards(roster);
    this.broadcast({ t: 'matchEnd', winner, score: this.score, roster, mvp: mvp?.name, next: MATCH.endScreenMs, mode: this.modeId, modeState: this.mode.state(), medals: medals.map((a) => ({ id: a.id, medal: a.medal })) });
    // Each real soldier gets their own debrief: medals, rewards, Tour of Duty and new orders.
    if (!this.practice && this.modeId !== 'stage') for (const p of this.humans()) this.send(p, debrief(this, p, winner, roster, medals));
    this.hooks.saveProfile();
    this.hooks.control?.track('match');
  }

  broadcastNear(p, msg, radius) {
    this.broadcast(msg, (o) => Math.hypot(o.x - p.x, o.z - p.z) <= radius);
  }

  // 20 Hz state of every fighter, projectile and smoke.
  sendSnapshots() {
    const t = now();
    const projectiles = this.projectiles.map((p) => [p.kind, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
    const smokes = this.smokes.map((s) => [+s.x.toFixed(1), +s.z.toFixed(1), s.r]);
    const vehicles = this.world.snapshot();
    const crocs = this.wildlife.crocs.length ? this.wildlife.view() : undefined;
    const dogs = this.wildlife.dogs.length ? this.wildlife.dogView() : undefined;
    for (const me of this.humans()) {
      const uav = this.uav[me.side] > t;
      const list = [];
      for (const o of this.players.values()) {
        // Spirits are invisible to the enemy.
        if (o !== me && o.status === 'spirit' && o.side !== me.side) continue;
        const flags =
          (o.crouch ? 1 : 0) |
          (o.status === 'downed' ? 2 : 0) |
          (o.status === 'spirit' ? 4 : 0) |
          (t - o.firedAt < 1500 ? 8 : 0) |
          (o.ads ? 16 : 0) |
          (this.protectedNow(o) ? 32 : 0) |
          (o.reloadUntil > t ? 64 : 0) |
          (o.sprint ? 128 : 0) |
          (o.status === 'dead' || o.status === 'medevac' ? 256 : 0) |
          (uav && o.side !== me.side ? 512 : 0) |
          (o.burnUntil > t ? 1024 : 0) |
          (this.chatting(o) ? 2048 : 0) |
          (o.veh != null ? 4096 : 0);
        list.push([o.id, +o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2), +o.yaw.toFixed(3), +o.pitch.toFixed(3), flags, WEAPON_IDS.indexOf(o.weapons[o.slot]), o.side === me.side ? Math.round(o.health) : -1]);
      }
      this.send(me, { t: 's', ts: t, p: list, pr: projectiles, sm: smokes, vh: vehicles, ck: crocs, dg: dogs });
    }
  }
}

export { inWater };
