// Advertising on battlefield walls. Advertisers target states; the server spreads
// their creatives over the walls of those states and records who-saw-what as
// aggregated statistics (views, unique players, gem pickups, by state, side, faction and hour).
// Individual players are never exposed to advertisers: unique viewers are counted with salted hashes.
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { JsonStore, DATA_DIR } from './store.js';
import { ADS } from '../shared/config.js';
import { STATES } from '../shared/states.js';

const AD_DIR = join(DATA_DIR, 'ads');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_UNIQUES = 200000;

function emptyStats() {
  return { views: 0, uniques: 0, gems: 0, spiritGems: 0, byState: {}, bySide: {}, byFaction: {}, byHour: new Array(24).fill(0), byDay: {} };
}

export class AdManager {
  constructor(slotCounts) {
    this.slotCounts = slotCounts; // stateId -> number of ad walls
    this.store = new JsonStore('ads.json', { ads: [], version: 1, salt: randomBytes(16).toString('hex') });
    this.uniqueStore = new JsonStore('ad-uniques.json', {});
    this.seen = new Map(); // `${player}:${slot}` -> last counted time
    this.onChange = null;
    this.cache = new Map(); // stateId -> slot map
  }

  async load() {
    await this.store.load();
    await this.uniqueStore.load();
    this.store.data.salt ||= randomBytes(16).toString('hex');
    await mkdir(AD_DIR, { recursive: true });
    this.uniques = new Map(Object.entries(this.uniqueStore.data).map(([id, arr]) => [id, new Set(arr)]));
  }

  get ads() {
    return this.store.data.ads;
  }

  isLive(ad, now = Date.now()) {
    return !ad.paused && (!ad.start || now >= Date.parse(ad.start)) && (!ad.end || now <= Date.parse(ad.end) + 86400000);
  }

  // Which advert shows on each wall of a state.
  slotsFor(stateId) {
    if (this.cache.has(stateId)) return this.cache.get(stateId);
    const live = this.ads
      .filter((a) => this.isLive(a) && (a.states.includes('all') || a.states.includes(stateId)))
      .sort((a, b) => a.created - b.created);
    const n = this.slotCounts[stateId] || 0;
    const slots = {};
    if (live.length) {
      for (let i = 0; i < n; i++) {
        const ad = live[i % live.length];
        slots[`${stateId}:${i}`] = { adId: ad.id, image: `/ads/${ad.file}`, advertiser: ad.advertiser, link: ad.link || null };
      }
    }
    const result = { version: this.store.data.version, slots };
    this.cache.set(stateId, result);
    return result;
  }

  adForSlot(slotId) {
    const stateId = slotId.split(':')[0];
    return this.slotsFor(stateId).slots[slotId] || null;
  }

  async create({ advertiser, title, imageDataUrl, states, start, end, priceNaira, link }) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(imageDataUrl || '');
    if (!m) throw new Error('Image must be PNG, JPEG or WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > ADS.maxImageBytes) throw new Error('Image is larger than 2 MB');
    const valid = new Set(['all', ...STATES.map((s) => s.id)]);
    const targets = (Array.isArray(states) ? states : ['all']).filter((s) => valid.has(s));
    if (!targets.length) throw new Error('Choose at least one state');
    const id = randomUUID().slice(0, 8);
    const file = `${id}.${IMAGE_TYPES[m[1]]}`;
    await writeFile(join(AD_DIR, file), buf);
    const ad = {
      id,
      advertiser: String(advertiser || 'Advertiser').slice(0, 80),
      title: String(title || '').slice(0, 120),
      file,
      link: /^https?:\/\//.test(link || '') ? String(link).slice(0, 300) : null,
      states: targets,
      start: start || null,
      end: end || null,
      priceNaira: Number(priceNaira) || 0,
      paused: false,
      created: Date.now(),
      stats: emptyStats()
    };
    this.ads.push(ad);
    this.bump();
    return ad;
  }

  async update(id, patch) {
    const ad = this.ads.find((a) => a.id === id);
    if (!ad) throw new Error('Ad not found');
    for (const k of ['advertiser', 'title', 'start', 'end', 'paused', 'priceNaira', 'link']) if (k in patch) ad[k] = patch[k];
    if (Array.isArray(patch.states) && patch.states.length) ad.states = patch.states.map(String);
    this.bump();
    return ad;
  }

  async remove(id) {
    const i = this.ads.findIndex((a) => a.id === id);
    if (i < 0) throw new Error('Ad not found');
    const [ad] = this.ads.splice(i, 1);
    await unlink(join(AD_DIR, ad.file)).catch(() => {});
    this.uniques.delete(id);
    delete this.uniqueStore.data[id];
    this.uniqueStore.markDirty();
    this.bump();
  }

  bump() {
    this.store.data.version++;
    this.cache.clear();
    this.store.markDirty();
    this.store.save();
    this.onChange?.();
  }

  hashPlayer(token) {
    return createHash('sha256').update(this.store.data.salt + token).digest('base64').slice(0, 16);
  }

  // A player's client reports the ad walls in view. Each wall counts once per player per minute.
  recordViews(player, stateId, slotIds) {
    if (!Array.isArray(slotIds)) return;
    const now = Date.now();
    const hour = new Date(now).getHours();
    const day = new Date(now).toISOString().slice(0, 10);
    const who = this.hashPlayer(player.token || player.id);
    for (const slot of slotIds.slice(0, 20)) {
      if (typeof slot !== 'string' || !slot.startsWith(`${stateId}:`)) continue;
      const key = `${who}:${slot}`;
      if ((this.seen.get(key) || 0) > now - ADS.viewDedupeMs) continue;
      this.seen.set(key, now);
      const a = this.adForSlot(slot);
      if (!a) continue;
      const ad = this.ads.find((x) => x.id === a.adId);
      if (!ad) continue;
      const s = (ad.stats ||= emptyStats());
      s.views++;
      s.byState[stateId] = (s.byState[stateId] || 0) + 1;
      s.bySide[player.side] = (s.bySide[player.side] || 0) + 1;
      s.byFaction[player.faction] = (s.byFaction[player.faction] || 0) + 1;
      s.byHour[hour]++;
      s.byDay[day] = (s.byDay[day] || 0) + 1;
      let set = this.uniques.get(ad.id);
      if (!set) this.uniques.set(ad.id, (set = new Set()));
      if (!set.has(who) && set.size < MAX_UNIQUES) {
        set.add(who);
        s.uniques = set.size;
        this.uniqueStore.data[ad.id] = [...set];
        this.uniqueStore.markDirty();
      }
      this.store.markDirty();
    }
    if (this.seen.size > 200000) this.seen.clear();
  }

  recordGem(slotId, spirit) {
    const a = this.adForSlot(slotId);
    if (!a) return;
    const ad = this.ads.find((x) => x.id === a.adId);
    if (!ad) return;
    const s = (ad.stats ||= emptyStats());
    if (spirit) s.spiritGems++;
    else s.gems++;
    this.store.markDirty();
  }

  async image(file) {
    if (!/^[a-z0-9-]+\.(png|jpg|webp)$/.test(file)) return null;
    try {
      return await readFile(join(AD_DIR, file));
    } catch {
      return null;
    }
  }

  csv() {
    const rows = [['Advertiser', 'Campaign', 'States', 'Start', 'End', 'Paid (NGN)', 'Views', 'Unique players', 'Gem pickups', 'Spirit revivals', 'Top state', 'Security views', 'Outlaw views']];
    for (const a of this.ads) {
      const s = a.stats || emptyStats();
      const top = Object.entries(s.byState).sort((x, y) => y[1] - x[1])[0];
      rows.push([a.advertiser, a.title, a.states.join(' '), a.start, a.end, a.priceNaira, s.views, s.uniques, s.gems, s.spiritGems, top ? `${top[0]} (${top[1]})` : '', s.bySide.sec || 0, s.bySide.out || 0]);
    }
    return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  }
}
