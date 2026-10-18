// Game modes. Each mode plugs into a Match and decides scoring, respawning,
// rounds, objectives, how many bots there are and where bots go.
//   conquest  Hold Ground: capture A/B/C (the original mode)
//   tdm       Gbas Gbos: team deathmatch
//   bomb      Plant & Defuse: rounds, one life, outlaws plant at A or B
//   stage     Campaign: solo waves of enemies, unlocks the next stage
import { MODES, BOMB, STAGES, WAVE, MATCH, MONEY, RESPAWN, PLAYER } from '../shared/config.js';
import { botName } from './bots.js';

const now = () => Date.now();
const alive = (p) => p.status === 'alive' || p.status === 'downed';

class BaseMode {
  constructor(match, id) {
    this.match = match;
    this.id = id;
    this.def = MODES[id];
  }
  reset() {}
  tick() {}
  // Team points for a kill (conquest gives points, tdm counts kills).
  killPoints(killer, headshot) {
    return MATCH.killPoints + (headshot ? MATCH.headshotBonus : 0);
  }
  onKill() {}
  canRespawn() {
    return true;
  }
  botRespawnMs() {
    return RESPAWN.botRespawnMs;
  }
  frozen() {
    return false;
  }
  usesSites() {
    return this.def.sites && this.id === 'conquest';
  }
  wantBots(side) {
    return Math.max(0, MATCH.minPerSide - this.match.sideCount(side, true));
  }
  isWinner(p, winner) {
    return p.side === winner;
  }
  botGoal() {
    return false;
  }
  handle() {
    return false;
  }
  checkEnd() {
    const m = this.match;
    return m.score.sec >= this.def.scoreLimit || m.score.out >= this.def.scoreLimit || now() - m.startedAt >= this.def.timeLimitMs;
  }
  winner() {
    const s = this.match.score;
    return s.sec === s.out ? null : s.sec > s.out ? 'sec' : 'out';
  }
  state() {
    return { mode: this.id };
  }
}

class ConquestMode extends BaseMode {}

class TdmMode extends BaseMode {
  killPoints() {
    return 1;
  }
  // Bots go looking for the enemy: last place an enemy was seen, else near a random enemy.
  botGoal(brain, p) {
    const m = this.match;
    if (brain.goal && now() < brain.goal.until && brain.path?.length) return true;
    const enemies = [...m.players.values()].filter((o) => o.side !== p.side && o.status === 'alive');
    if (!enemies.length) return false;
    const e = enemies[Math.floor(Math.random() * enemies.length)];
    brain.setGoal(p, e.x + (Math.random() - 0.5) * 30, e.z + (Math.random() - 0.5) * 30, 'roam');
    brain.goal.until = now() + 8000 + Math.random() * 8000;
    return true;
  }
}

// ---------- Plant & Defuse ----------
class BombMode extends BaseMode {
  reset() {
    this.round = 0;
    this.history = [];
    this.startRound(true);
  }

  sitesForBomb() {
    return this.match.sites.filter((s) => this.def.bombSites.includes(s.id));
  }

  startRound(first = false) {
    const m = this.match;
    const t = now();
    this.round++;
    this.phase = 'freeze';
    this.phaseEnds = t + BOMB.freezeMs;
    this.action = null;
    this.planted = null;
    this.dropped = null;
    this.result = null;
    // Pick which site the outlaw bots will hit this round.
    const ss = this.sitesForBomb();
    this.target = ss[Math.floor(Math.random() * ss.length)]?.id || 'A';
    for (const p of m.players.values()) {
      const keep = !first && p.status === 'alive';
      m.spawn(p, first, keep);
      p.protectUntil = this.phaseEnds;
      if (!p.human) p.bot.respawnAt = Infinity;
    }
    const outs = [...m.players.values()].filter((p) => p.side === 'out');
    const humans = outs.filter((p) => p.human);
    const pool = humans.length && Math.random() < 0.6 ? humans : outs;
    this.carrier = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
    m.broadcast({ t: 'round', round: this.round, phase: 'freeze', ends: this.phaseEnds, carrier: this.carrier, score: m.score });
    const c = m.players.get(this.carrier);
    if (c) m.toast(c, '💣 You have the bomb! Plant it at A or B (hold E).', 'streak');
  }

  frozen() {
    return this.phase === 'freeze';
  }

  canRespawn() {
    return false;
  }

  botRespawnMs() {
    return Infinity;
  }

  killPoints() {
    return 0;
  }

  wantBots(side) {
    return Math.max(0, MATCH.minPerSide - this.match.sideCount(side, true));
  }
  isWinner(p, winner) {
    return p.side === winner;
  }

  onKill(v) {
    if (v.id === this.carrier) {
      this.carrier = null;
      this.dropped = { x: v.x, z: v.z };
      this.match.broadcast({ t: 'bombDrop', x: +v.x.toFixed(2), z: +v.z.toFixed(2) });
    }
    if (this.action?.pid === v.id) this.action = null;
  }

  handle(p, m) {
    if (m.t === 'act') {
      this.startAction(p, m.kind);
      return true;
    }
    if (m.t === 'actStop') {
      if (this.action?.pid === p.id) this.cancelAction('stopped');
      return true;
    }
    return false;
  }

  siteAt(p) {
    return this.sitesForBomb().find((s) => Math.hypot(p.x - s.x, p.z - s.z) <= s.r && p.y > -1);
  }

  startAction(p, kind) {
    const m = this.match;
    if (p.status !== 'alive' || this.phase === 'freeze' || this.phase === 'post' || this.action) return;
    if (kind === 'plant') {
      if (p.id !== this.carrier || this.planted) return;
      const site = this.siteAt(p);
      if (!site) return p.human && m.toast(p, 'You must be inside A or B to plant.', 'bad');
      this.action = { pid: p.id, kind, start: now(), x: p.x, z: p.z, dur: BOMB.plantSecs * 1000, site: site.id };
    } else if (kind === 'defuse') {
      if (p.side !== 'sec' || !this.planted) return;
      if (Math.hypot(p.x - this.planted.x, p.z - this.planted.z) > BOMB.actionRange) return;
      this.action = { pid: p.id, kind, start: now(), x: p.x, z: p.z, dur: BOMB.defuseSecs * 1000 };
    } else return;
    m.broadcast({ t: 'act', pid: p.id, kind, start: this.action.start, dur: this.action.dur });
  }

  cancelAction(why) {
    if (!this.action) return;
    this.match.broadcast({ t: 'act', pid: this.action.pid, kind: null, why });
    this.action = null;
  }

  endRound(winner, why) {
    const m = this.match;
    if (this.phase === 'post') return;
    this.phase = 'post';
    this.phaseEnds = now() + BOMB.postMs;
    this.action = null;
    m.score[winner]++;
    this.result = { winner, why };
    this.history.push(winner);
    for (const p of m.players.values()) {
      p.money = Math.min(MONEY.max, p.money + (p.side === winner ? BOMB.winMoney : BOMB.lossMoney));
      if (p.side === winner && p.human) m.addXP(p, 120);
      m.syncMe(p);
    }
    m.broadcast({ t: 'roundEnd', winner, why, score: m.score, round: this.round });
  }

  tick() {
    const m = this.match;
    const t = now();
    if (this.phase === 'freeze' && t >= this.phaseEnds) {
      this.phase = 'live';
      this.phaseEnds = t + BOMB.roundMs;
      m.broadcast({ t: 'round', round: this.round, phase: 'live', ends: this.phaseEnds, carrier: this.carrier, score: m.score });
    }
    if (this.phase === 'post') {
      if (t >= this.phaseEnds) {
        if (m.score.sec >= this.def.scoreLimit || m.score.out >= this.def.scoreLimit) m.endMatch();
        else this.startRound();
      }
      return;
    }
    // Bomb pickup.
    if (this.dropped && !this.carrier) {
      for (const p of m.players.values()) {
        if (p.side !== 'out' || p.status !== 'alive') continue;
        if (Math.hypot(p.x - this.dropped.x, p.z - this.dropped.z) < 1.6) {
          this.carrier = p.id;
          this.dropped = null;
          m.broadcast({ t: 'bombPick', id: p.id });
          if (p.human) m.toast(p, '💣 You picked up the bomb. Go plant it!', 'streak');
          break;
        }
      }
    }
    // Plant / defuse in progress.
    if (this.action) {
      const a = this.action;
      const p = m.players.get(a.pid);
      if (!p || p.status !== 'alive' || Math.hypot(p.x - a.x, p.z - a.z) > 0.9 || t - p.firedAt < 200) this.cancelAction('moved');
      else if (t - a.start >= a.dur) {
        this.action = null;
        if (a.kind === 'plant') {
          this.planted = { x: p.x, z: p.z, site: a.site, at: t, explodeAt: t + BOMB.fuseMs };
          this.carrier = null;
          this.phase = 'planted';
          p.money = Math.min(MONEY.max, p.money + BOMB.plantMoney);
          m.syncMe(p);
          m.broadcast({ t: 'planted', x: +p.x.toFixed(2), z: +p.z.toFixed(2), site: a.site, explodeAt: this.planted.explodeAt, by: p.name });
        } else {
          m.broadcast({ t: 'defused', by: p.name });
          this.planted.defused = true;
          return this.endRound('sec', 'defused');
        }
      }
    }
    // Explosion.
    if (this.planted && !this.planted.defused && t >= this.planted.explodeAt) {
      const b = this.planted;
      this.planted = null;
      m.explode(b.x, 0.6, b.z, BOMB.blast, BOMB.dmg, null, 'bomb', true);
      return this.endRound('out', 'exploded');
    }
    // Eliminations and time.
    const players = [...m.players.values()];
    const secAlive = players.some((p) => p.side === 'sec' && alive(p));
    const outAlive = players.some((p) => p.side === 'out' && alive(p));
    if (!secAlive && players.some((p) => p.side === 'sec')) return this.endRound('out', 'eliminated');
    if (!outAlive && !this.planted && players.some((p) => p.side === 'out')) return this.endRound('sec', 'eliminated');
    if (this.phase === 'live' && t >= this.phaseEnds) return this.endRound('sec', 'time');
  }

  checkEnd() {
    return now() - this.match.startedAt >= this.def.timeLimitMs;
  }

  // Bots carrying, fetching or defusing the bomb stick to the job instead of chasing noises.
  priority(p) {
    if (p.id === this.carrier) return true;
    if (this.planted && p.side === 'sec') return true;
    return !!(this.dropped && p.side === 'out' && this.fetcher === p.id);
  }

  // Bot plans: outlaws escort the bomb to the target site; security guards sites, then defuses.
  botGoal(brain, p) {
    const m = this.match;
    if (this.phase === 'freeze' || this.phase === 'post') {
      brain.path = null;
      return true;
    }
    const site = this.sitesForBomb().find((s) => s.id === this.target) || this.sitesForBomb()[0];
    if (!site) return false;
    const go = (x, z, kind, spread = 3) => {
      if (brain.goal?.kind === kind && Math.hypot(brain.goal.x - x, brain.goal.z - z) < spread + 2 && brain.path?.length) return;
      brain.setGoal(p, x + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread, kind);
    };
    if (p.side === 'out') {
      if (this.planted) return go(this.planted.x, this.planted.z, 'guardBomb', 10), true;
      if (this.dropped) {
        // Closest outlaw fetches the bomb.
        const outs = [...m.players.values()].filter((o) => o.side === 'out' && o.status === 'alive');
        outs.sort((a, b) => Math.hypot(a.x - this.dropped.x, a.z - this.dropped.z) - Math.hypot(b.x - this.dropped.x, b.z - this.dropped.z));
        this.fetcher = outs[0]?.id;
        if (outs[0] === p) return go(this.dropped.x, this.dropped.z, 'fetch', 0), true;
      }
      if (p.id === this.carrier) {
        // Let the escorts go first and clear the way.
        if (now() < this.phaseEnds - BOMB.roundMs + 5000) {
          brain.path = null;
          return true;
        }
        if (Math.hypot(p.x - site.x, p.z - site.z) < site.r * 0.6 && !brain.target) {
          brain.path = null;
          this.startAction(p, 'plant');
          return true;
        }
        return go(site.x, site.z, 'plant', 2), true;
      }
      return go(site.x, site.z, 'escort', site.r), true;
    }
    // Security.
    if (this.planted) {
      const d = Math.hypot(p.x - this.planted.x, p.z - this.planted.z);
      if (d < BOMB.actionRange * 0.8 && !brain.target) {
        brain.path = null;
        this.startAction(p, 'defuse');
        return true;
      }
      return go(this.planted.x, this.planted.z, 'defuse', 0.5), true;
    }
    const ss = this.sitesForBomb();
    const idx = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % ss.length;
    const s = ss[idx];
    return go(s.x, s.z, 'guard', s.r), true;
  }

  state() {
    return {
      mode: this.id,
      round: this.round,
      phase: this.phase,
      phaseEnds: this.phaseEnds,
      carrier: this.carrier,
      dropped: this.dropped,
      planted: this.planted && { x: this.planted.x, z: this.planted.z, site: this.planted.site, explodeAt: this.planted.explodeAt },
      action: this.action && { pid: this.action.pid, kind: this.action.kind, start: this.action.start, dur: this.action.dur },
      history: this.history
    };
  }
}

// ---------- Campaign stage (solo waves) ----------
class StageMode extends BaseMode {
  constructor(match, id, opts) {
    super(match, id);
    this.index = Math.max(0, Math.min(STAGES.length - 1, opts.stage | 0));
    this.stage = STAGES[this.index];
  }

  reset() {
    this.wave = 0;
    this.livesUsed = 0;
    this.result = null;
    this.nextWaveAt = now() + 4000;
    this.enemyIds = new Set();
    this.killsThisStage = 0;
  }

  wantBots(side) {
    // Allies only; enemies are spawned in waves.
    return side === 'sec' ? Math.max(0, WAVE.allies) : -1;
  }

  enemyCount() {
    return Math.round(WAVE.base + (this.wave - 1) * WAVE.perWave + this.index * WAVE.perStage);
  }

  spawnWave() {
    const m = this.match;
    this.wave++;
    for (const id of this.enemyIds) m.players.delete(id);
    this.enemyIds.clear();
    const n = this.enemyCount();
    for (let i = 0; i < n; i++) {
      const bot = m.newPlayer({ human: false, faction: this.stage.enemy, name: botName(m.rng, 'out') });
      bot.bot.skill = Math.min(0.98, 0.25 + this.stage.diff * 0.7 + Math.random() * 0.12);
      m.players.set(bot.id, bot);
      m.spawn(bot, true);
      bot.protectUntil = 0;
      this.enemyIds.add(bot.id);
    }
    m.broadcast({ t: 'wave', wave: this.wave, waves: this.stage.waves, enemies: n });
  }

  botRespawnMs(p) {
    return this.enemyIds.has(p.id) ? Infinity : RESPAWN.botRespawnMs;
  }

  killPoints(killer) {
    return killer.side === 'sec' ? 1 : 0;
  }

  onKill(v) {
    if (v.human) {
      this.livesUsed++;
      if (this.livesUsed >= this.stage.lives) this.finish(false);
      else this.match.toast(v, `Lives remain: ${this.stage.lives - this.livesUsed}`, 'bad');
    }
  }

  tick() {
    const m = this.match;
    const t = now();
    if (this.result) return;
    const left = [...this.enemyIds].filter((id) => m.players.get(id)?.status === 'alive' || m.players.get(id)?.status === 'downed').length;
    if (this.wave > 0 && left === 0 && !this.nextWaveAt) {
      if (this.wave >= this.stage.waves) return this.finish(true);
      this.nextWaveAt = t + WAVE.gapMs;
      m.broadcast({ t: 'waveClear', wave: this.wave, next: this.nextWaveAt });
    }
    if (this.nextWaveAt && t >= this.nextWaveAt) {
      this.nextWaveAt = 0;
      this.spawnWave();
    }
  }

  finish(won) {
    const m = this.match;
    if (this.result) return;
    this.result = { won };
    m.score[won ? 'sec' : 'out'] = 1;
    if (won) {
      for (const p of m.humans()) {
        const pr = p.profile;
        pr.stageStars ||= {};
        const stars = this.livesUsed === 0 ? 3 : this.livesUsed === 1 ? 2 : 1;
        const first = !pr.stageStars[this.index];
        pr.stageStars[this.index] = Math.max(pr.stageStars[this.index] || 0, stars);
        pr.stage = Math.max(pr.stage || 0, this.index + 1);
        if (first) pr.gems += 1;
        m.addXP(p, 300 + this.index * 60);
        m.toast(p, first ? `Stage clear! +1 life gem 💎 · ${'★'.repeat(stars)}` : `Stage clear! ${'★'.repeat(stars)}`, 'gem');
      }
      m.hooks.saveProfile();
    }
    m.endMatch();
  }

  checkEnd() {
    return now() - this.match.startedAt >= this.def.timeLimitMs;
  }

  winner() {
    return this.result?.won ? 'sec' : 'out';
  }

  // Enemies hunt the player; allies stick near the player.
  botGoal(brain, p) {
    const m = this.match;
    const human = m.humans().find((h) => h.status === 'alive');
    if (!human) return false;
    if (brain.goal && now() < brain.goal.until && brain.path?.length) return true;
    const r = p.side === 'sec' ? 8 : 20;
    brain.setGoal(p, human.x + (Math.random() - 0.5) * r, human.z + (Math.random() - 0.5) * r, p.side === 'sec' ? 'follow' : 'hunt');
    brain.goal.until = now() + 5000 + Math.random() * 4000;
    return true;
  }

  state() {
    const m = this.match;
    const left = [...this.enemyIds].filter((id) => alive(m.players.get(id) || {})).length;
    return { mode: this.id, stage: this.index, title: this.stage.title, story: this.stage.story, wave: this.wave, waves: this.stage.waves, enemiesLeft: left, livesLeft: this.stage.lives - this.livesUsed, nextWaveAt: this.nextWaveAt };
  }
}

// ---------- Practice Range ----------
// A private room for one soldier or one crew: target dummies that walk about and never shoot
// back, free kit, instant respawns, skills train 3x faster, nothing counts for your record.
class PracticeMode extends BaseMode {
  humanSide() {
    for (const p of this.match.players.values()) if (p.human) return p.side;
    return 'sec';
  }
  wantBots(side) {
    return side === this.humanSide() ? 0 : 6;
  }
  killPoints() {
    return 0;
  }
  botRespawnMs() {
    return 2500;
  }
  checkEnd() {
    return now() - this.match.startedAt >= this.def.timeLimitMs;
  }
  // Dummies stand on the range in front of your base, not at the far end of the map.
  spawnPoint(p) {
    if (p.human) return null;
    const m = this.match;
    const base = m.map.bases[this.humanSide()];
    const dir = base.x < 0 ? 1 : -1;
    for (let k = 0; k < 40; k++) {
      const x = base.x + dir * (22 + m.rng() * 45);
      const z = (m.rng() - 0.5) * 60;
      if (!m.freeSpot(x, z)) continue;
      return { x, z, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
    }
    return null;
  }
  state() {
    return { mode: this.id, practice: true };
  }
}

// ---------- BRD: Butcher, Raid, Destroy ----------
// Free-for-all assassin mode seen from above: everyone is an enemy, blades and pistols only,
// first-aid boxes to raid, quick respawns, first to the kill target wins.
class BrdMode extends BaseMode {
  reset() {
    const m = this.match;
    this.aid = [];
    for (let k = 0; k < 400 && this.aid.length < this.def.aidBoxes; k++) {
      const x = (m.rng() - 0.5) * (m.map.half * 1.5);
      const z = (m.rng() - 0.5) * (m.map.half * 1.5);
      if (!m.freeSpot(x, z) || this.aid.some((a) => Math.hypot(a.x - x, a.z - z) < 22)) continue;
      this.aid.push({ x: +x.toFixed(2), z: +z.toFixed(2), on: true, back: 0 });
    }
  }
  killPoints() {
    return 0;
  }
  wantBots(side) {
    const m = this.match;
    const bots = Math.max(0, this.def.fighters - m.humans().length);
    return side === 'sec' ? Math.floor(bots / 2) : Math.ceil(bots / 2);
  }
  botRespawnMs() {
    return this.def.autoRespawnMs;
  }
  // Spawn somewhere quiet: the free spot furthest from everyone alive.
  spawnPoint(p) {
    const m = this.match;
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 30; k++) {
      const x = (m.rng() - 0.5) * (m.map.half * 1.6);
      const z = (m.rng() - 0.5) * (m.map.half * 1.6);
      if (!m.freeSpot(x, z)) continue;
      let d = 60;
      for (const o of m.players.values()) if (o !== p && o.status === 'alive') d = Math.min(d, Math.hypot(o.x - x, o.z - z));
      if (d > bestD) {
        bestD = d;
        best = { x, z, yaw: m.rng() * Math.PI * 2 };
      }
    }
    return best;
  }
  // Blades and a pistol; light armour for everyone.
  loadout(p) {
    const m = this.match;
    p.weapons = { primary: null, secondary: 'p9', melee: 'knife' };
    p.ammo = {};
    m.giveWeapon(p, 'p9');
    p.ammo.knife = { mag: 0, reserve: 0 };
    p.slot = p.human ? 'melee' : m.rng() < 0.6 ? 'melee' : 'secondary';
    p.armor = 25;
    p.frag = 0;
    p.smoke = 1;
  }
  canBuy() {
    return false;
  }
  tick() {
    const m = this.match;
    const t = now();
    this.aid.forEach((a, i) => {
      if (!a.on) {
        if (t >= a.back) {
          a.on = true;
          m.broadcast({ t: 'aid', i, on: true });
        }
        return;
      }
      for (const p of m.players.values()) {
        if (p.status !== 'alive' || p.health >= PLAYER.maxHealth || Math.hypot(p.x - a.x, p.z - a.z) > 1.7) continue;
        p.health = Math.min(PLAYER.maxHealth, p.health + this.def.aidHeal);
        a.on = false;
        a.back = t + this.def.aidRespawnMs;
        m.broadcast({ t: 'aid', i, on: false, by: p.id });
        if (p.human) m.syncMe(p);
        break;
      }
    });
  }
  // Bots hunt the nearest soldier, or the nearest first-aid box when hurt.
  botGoal(brain, p) {
    const m = this.match;
    if (brain.goal && now() < brain.goal.until && brain.path?.length) return true;
    if (p.health < 50) {
      const box = this.aid.filter((a) => a.on).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (box) {
        brain.setGoal(p, box.x, box.z, 'aid');
        brain.goal.until = now() + 9000;
        return true;
      }
    }
    const others = [...m.players.values()].filter((o) => o !== p && o.status === 'alive').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const e = others[Math.floor(Math.random() * Math.min(2, others.length))];
    if (!e) return false;
    brain.setGoal(p, e.x + (Math.random() - 0.5) * 8, e.z + (Math.random() - 0.5) * 8, 'hunt');
    brain.goal.until = now() + 5000 + Math.random() * 4000;
    return true;
  }
  leader() {
    let top = null;
    for (const p of this.match.players.values()) if (!top || p.kills > top.kills) top = p;
    return top;
  }
  checkEnd() {
    const top = this.leader();
    return (top && top.kills >= this.def.scoreLimit) || now() - this.match.startedAt >= this.def.timeLimitMs;
  }
  winner() {
    const list = [...this.match.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (!list.length || !list[0].kills || (list[1] && list[1].kills === list[0].kills && list[1].deaths === list[0].deaths)) return null;
    return list[0].id;
  }
  isWinner(p, winner) {
    return !!winner && p.id === winner;
  }
  state() {
    const top = this.leader();
    return { mode: this.id, ffa: true, target: this.def.scoreLimit, aid: this.aid.map((a) => [a.x, a.z, a.on ? 1 : 0]), leader: top ? { id: top.id, name: top.name, kills: top.kills } : null };
  }
}

export function createMode(id, match, opts = {}) {
  switch (id) {
    case 'brd':
      return new BrdMode(match, 'brd');
    case 'practice':
      return new PracticeMode(match, 'practice');
    case 'tdm':
      return new TdmMode(match, 'tdm');
    case 'bomb':
      return new BombMode(match, 'bomb');
    case 'stage':
      return new StageMode(match, 'stage', opts);
    default:
      return new ConquestMode(match, 'conquest');
  }
}
