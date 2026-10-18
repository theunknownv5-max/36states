// The super admin control centre: live game tuning, maintenance, announcements, events,
// app version gate, moderation (bans, mutes, kicks, chat log, player reports), statistics,
// push notifications, admin team with roles, and an audit log of every admin action.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonStore } from './store.js';
import { HEALTH, XP, MONEY, GEMS, RESPAWN, TILE_GEMS, MATCH, rankFor } from '../shared/config.js';

const DAY = 86400000;
export const lagosDay = (t = Date.now()) => new Date(t + 3600000).toISOString().slice(0, 10);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const pidOf = (token) => sha(`pid:${token}`).slice(0, 12);

// Everything the admin can tune live, with limits. Values apply to the running game at once.
export const TUNABLES = {
  'HEALTH.regenDelayMs': { obj: HEALTH, key: 'regenDelayMs', label: 'Health regen starts after (ms)', min: 1000, max: 30000, group: 'Survival' },
  'HEALTH.regenPerSec': { obj: HEALTH, key: 'regenPerSec', label: 'Health regen per second', min: 0, max: 50, group: 'Survival' },
  'HEALTH.botDamageToHumans': { obj: HEALTH, key: 'botDamageToHumans', label: 'Bot damage to players (×)', min: 0.1, max: 2, group: 'Survival' },
  'HEALTH.botMaxHit': { obj: HEALTH, key: 'botMaxHit', label: 'Max damage of one bot bullet', min: 10, max: 200, group: 'Survival' },
  'HEALTH.startArmor': { obj: HEALTH, key: 'startArmor', label: 'Armour on landing', min: 0, max: 100, group: 'Survival' },
  'HEALTH.startPills': { obj: HEALTH, key: 'startPills', label: 'Blood pills on landing', min: 0, max: 3, group: 'Survival' },
  'RESPAWN.protectMs': { obj: RESPAWN, key: 'protectMs', label: 'Spawn protection (ms)', min: 0, max: 10000, group: 'Survival' },
  'RESPAWN.medevacFee': { obj: RESPAWN, key: 'medevacFee', label: 'Medevac fee (₦)', min: 0, max: 10000, group: 'Survival' },
  'XP.kill': { obj: XP, key: 'kill', label: 'XP per kill', min: 0, max: 1000, group: 'Progress' },
  'XP.win': { obj: XP, key: 'win', label: 'XP per win', min: 0, max: 5000, group: 'Progress' },
  'XP.levelEvery': { obj: XP, key: 'levelEvery', label: 'XP per rank level', min: 200, max: 20000, group: 'Progress' },
  'GEMS.startingGems': { obj: GEMS, key: 'startingGems', label: 'Gems for new players', min: 0, max: 50, group: 'Progress' },
  'GEMS.levelUpGems': { obj: GEMS, key: 'levelUpGems', label: 'Gems per promotion', min: 0, max: 20, group: 'Progress' },
  'MONEY.start': { obj: MONEY, key: 'start', label: 'Starting money (₦)', min: 0, max: 16000, group: 'Battle economy' },
  'MONEY.incomePerSec': { obj: MONEY, key: 'incomePerSec', label: 'Income per held site per second', min: 0, max: 200, group: 'Battle economy' },
  'MONEY.capture': { obj: MONEY, key: 'capture', label: 'Money per capture', min: 0, max: 5000, group: 'Battle economy' },
  'GEMS.cooldownMs': { obj: GEMS, key: 'cooldownMs', label: 'Wall gem recharge (ms)', min: 10000, max: 600000, group: 'Battle economy' },
  'TILE_GEMS.respawnMs': { obj: TILE_GEMS, key: 'respawnMs', label: 'Floor gemstone recharge (ms)', min: 5000, max: 300000, group: 'Battle economy' },
  'MATCH.minPerSide': { obj: MATCH, key: 'minPerSide', label: 'Bots fill each side up to', min: 0, max: 8, group: 'Matches' },
  'MATCH.maxHumans': { obj: MATCH, key: 'maxHumans', label: 'Max real players per battle', min: 2, max: 32, group: 'Matches' }
};
const DEFAULTS = Object.fromEntries(Object.entries(TUNABLES).map(([k, t]) => [k, t.obj[t.key]]));

export class Control {
  constructor() {
    this.store = new JsonStore('control.json', {});
    this.chat = []; // recent chat across all battles (ring)
    this.started = Date.now();
  }

  async load() {
    await this.store.load();
    const d = this.store.data;
    d.maintenance ||= { on: false, message: 'We are upgrading the battlefield. Come back soon!' };
    d.announcement ||= null;
    d.minBuild ||= 0;
    d.updateUrl ||= '';
    d.event ||= null; // { name, xpMult, moneyMult, until }
    d.overrides ||= {};
    d.admins ||= [];
    d.audit ||= [];
    d.reports ||= [];
    d.notices ||= [];
    d.stats ||= { days: {} };
    d.chatLog ||= [];
    this.chat = d.chatLog;
    this.applyOverrides();
  }

  save() {
    this.store.markDirty();
  }

  // ---------- admin team ----------
  // Super admin = ADMIN_KEY. Others get their own keys with a role.
  roleFor(given, superKey) {
    const g = Buffer.from(String(given || ''));
    const s = Buffer.from(superKey);
    if (g.length === s.length && timingSafeEqual(g, s)) return { role: 'super', name: 'Owner' };
    const h = sha(given);
    const a = this.store.data.admins.find((x) => x.keyHash === h);
    return a ? { role: a.role, name: a.name, id: a.id } : null;
  }

  addAdmin(name, role) {
    if (!['moderator', 'marketing', 'super'].includes(role)) throw new Error('Role must be moderator, marketing or super');
    const key = `pod_${randomBytes(18).toString('hex')}`;
    const a = { id: randomBytes(4).toString('hex'), name: String(name || 'Admin').slice(0, 40), role, keyHash: sha(key), created: Date.now() };
    this.store.data.admins.push(a);
    this.save();
    const { keyHash, ...pub } = a;
    return { ...pub, key };
  }

  removeAdmin(id) {
    this.store.data.admins = this.store.data.admins.filter((a) => a.id !== id);
    this.save();
  }

  audit(who, action, detail = '') {
    this.store.data.audit.unshift({ at: Date.now(), who: who?.name || '?', role: who?.role || '?', action, detail: String(detail).slice(0, 300) });
    if (this.store.data.audit.length > 1000) this.store.data.audit.length = 1000;
    this.save();
  }

  // ---------- live tuning ----------
  applyOverrides() {
    for (const [k, t] of Object.entries(TUNABLES)) t.obj[t.key] = k in this.store.data.overrides ? this.store.data.overrides[k] : DEFAULTS[k];
  }

  setOverrides(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      const t = TUNABLES[k];
      if (!t) continue;
      if (v === null || v === '' || v === DEFAULTS[k]) {
        delete this.store.data.overrides[k];
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < t.min || n > t.max) throw new Error(`${t.label}: between ${t.min} and ${t.max}`);
      this.store.data.overrides[k] = n;
    }
    this.applyOverrides();
    this.save();
  }

  tunablesView() {
    return Object.entries(TUNABLES).map(([k, t]) => ({ key: k, label: t.label, group: t.group, min: t.min, max: t.max, value: t.obj[t.key], default: DEFAULTS[k] }));
  }

  // Double XP weekends and the like.
  eventMult(kind) {
    const e = this.store.data.event;
    if (!e || (e.until && Date.now() > e.until)) return 1;
    return kind === 'xp' ? e.xpMult || 1 : e.moneyMult || 1;
  }

  // ---------- players: bans, mutes ----------
  banInfo(profile) {
    if (!profile?.ban) return null;
    if (profile.ban.until && Date.now() > profile.ban.until) return null;
    return profile.ban;
  }

  muted(profile) {
    return profile?.mutedUntil && Date.now() < profile.mutedUntil;
  }

  // ---------- chat log and reports ----------
  logChat(entry) {
    this.chat.push({ at: Date.now(), ...entry });
    if (this.chat.length > 600) this.chat.splice(0, this.chat.length - 600);
    this.save();
  }

  report({ reporter, target, reason, state, mode }) {
    const recent = this.chat.filter((c) => c.pid === target.pid).slice(-8);
    const r = { id: randomBytes(5).toString('hex'), at: Date.now(), reporter, target, reason: String(reason || '').slice(0, 200), state, mode, chat: recent, status: 'open' };
    this.store.data.reports.unshift(r);
    if (this.store.data.reports.length > 500) this.store.data.reports.length = 500;
    this.save();
    return r;
  }

  // ---------- in-app notices and announcements ----------
  addNotice(n) {
    const notice = { id: randomBytes(4).toString('hex'), at: Date.now(), title: String(n.title || '').slice(0, 80), body: String(n.body || '').slice(0, 400), url: n.url || null };
    this.store.data.notices.unshift(notice);
    if (this.store.data.notices.length > 30) this.store.data.notices.length = 30;
    this.save();
    return notice;
  }

  announcement() {
    const a = this.store.data.announcement;
    if (!a || (a.until && Date.now() > a.until)) return null;
    return a;
  }

  // ---------- statistics ----------
  day(t = Date.now()) {
    const k = lagosDay(t);
    const days = this.store.data.stats.days;
    if (!days[k]) {
      days[k] = { joins: 0, matches: 0, newPlayers: 0, peak: 0, modes: {}, states: {}, kills: 0 };
      const keys = Object.keys(days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - 90))) delete days[old];
    }
    return days[k];
  }

  track(kind, data = {}) {
    const d = this.day();
    if (kind === 'join') {
      d.joins++;
      d.modes[data.mode] = (d.modes[data.mode] || 0) + 1;
      d.states[data.state] = (d.states[data.state] || 0) + 1;
    } else if (kind === 'match') d.matches++;
    else if (kind === 'newPlayer') d.newPlayers++;
    else if (kind === 'online') d.peak = Math.max(d.peak, data.n || 0);
    else if (kind === 'kill') d.kills++;
    this.save();
  }

  dashboard(profiles, online) {
    const now = Date.now();
    const all = Object.values(profiles);
    const seen = (ms) => all.filter((p) => p.lastSeen && now - p.lastSeen < ms).length;
    const days = this.store.data.stats.days;
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const k = lagosDay(now - i * DAY);
      const d = days[k] || {};
      series.push({ day: k, joins: d.joins || 0, matches: d.matches || 0, newPlayers: d.newPlayers || 0, peak: d.peak || 0, active: all.filter((p) => p.lastSeen && lagosDay(p.lastSeen) === k).length });
    }
    const today = days[lagosDay(now)] || {};
    const top = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const ranks = {};
    for (const p of all) {
      const r = rankFor(p.xp || 0).name;
      ranks[r] = (ranks[r] || 0) + 1;
    }
    return {
      online,
      peakToday: Math.max(today.peak || 0, online),
      dau: seen(DAY),
      wau: seen(7 * DAY),
      mau: seen(30 * DAY),
      totalPlayers: all.length,
      registered: all.filter((p) => p.account).length,
      banned: all.filter((p) => this.banInfo(p)).length,
      newToday: today.newPlayers || 0,
      matchesToday: today.matches || 0,
      joinsToday: today.joins || 0,
      killsToday: today.kills || 0,
      topModes: top(today.modes),
      topStates: top(today.states),
      ranks,
      series,
      openReports: this.store.data.reports.filter((r) => r.status === 'open').length,
      uptimeMs: now - this.started,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576)
    };
  }

  // What every client learns on connect.
  publicState() {
    const d = this.store.data;
    const e = d.event && (!d.event.until || Date.now() < d.event.until) ? d.event : null;
    return { maintenance: d.maintenance.on ? d.maintenance.message : null, announcement: this.announcement(), notices: d.notices.slice(0, 15), event: e, minBuild: d.minBuild, updateUrl: d.updateUrl };
  }
}
