// Advertising on battlefield billboards (skyline billboards, LED road screens, wall banners).
// Two kinds of advert:
//  - house: added by the admin, targets whole states (fills every billboard there).
//  - paid:  booked and paid for by an advertiser in the portal, for one billboard, a start
//           date and a number of days; goes live only after the admin approves it.
// Ads on one billboard rotate on a clock shared by server and clients, so everyone sees the
// same advert at the same moment and views are credited to the advert actually on screen.
// Players are never exposed to advertisers: unique viewers are counted with salted hashes.
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { JsonStore } from './store.js';
import { media, imageSize, IMAGE_TYPES } from './media.js';
import { ADS } from '../shared/config.js';
import { regionById, ccOf, COUNTRY_BY_CC, payProvider } from '../shared/regions.js';
import { BOARD_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PX, ratioOk, mergePricing, quote, toUsd } from '../shared/billboards.js';

const MAX_UNIQUES = 100000;
const DAY = 86400000;
const UNPAID_HOLD_MS = 2 * 3600000; // an unpaid booking holds its slot this long
const ACTIVE = new Set(['unpaid', 'review', 'approved']);

function emptyStats() {
  return { views: 0, uniques: 0, gems: 0, spiritGems: 0, byState: {}, bySide: {}, byFaction: {}, byHour: new Array(24).fill(0), byDay: {} };
}

// Start of a calendar day in Nigeria (UTC+1).
export const lagosDayMs = (day) => Date.parse(`${day}T00:00:00+01:00`);
export const lagosToday = (now = Date.now()) => new Date(now + 3600000).toISOString().slice(0, 10);

export function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Image must be PNG, JPEG or WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / 1048576} MB`);
  const size = imageSize(buf);
  if (!size || !size.w || !size.h) throw new Error('Could not read the image size. Use PNG, JPEG or WEBP.');
  return { buf, ext: IMAGE_TYPES[m[1]], ...size };
}

export class AdManager {
  constructor(catalogue, ensure = null) {
    // catalogue: regionId -> [{ id, type, code, label, x, z }]. Regions outside Nigeria are
    // generated on first use: ensure(regionId) builds that region's billboards.
    this.catalogue = catalogue;
    this.ensure = ensure;
    this.boards = new Map();
    for (const list of Object.values(catalogue)) this.addBoards(list);
    this.store = new JsonStore('ads.json', { ads: [], version: 1, salt: randomBytes(16).toString('hex') });
    this.uniqueStore = new JsonStore('ad-uniques.json', {});
    this.seen = new Map(); // `${player}:${slot}` -> last counted time
    this.onChange = null;
    this.cache = new Map(); // stateId -> { at, result }
  }

  addBoards(list) {
    for (const b of list || []) this.boards.set(b.id, b);
  }

  boardsOf(regionId) {
    if (!this.catalogue[regionId] && this.ensure) this.ensure(regionId);
    return this.catalogue[regionId] || [];
  }

  board(boardId) {
    if (typeof boardId !== 'string') return null;
    if (!this.boards.has(boardId)) this.boardsOf(boardId.split(':')[0]);
    return this.boards.get(boardId) || null;
  }

  async load() {
    await this.store.load();
    await this.uniqueStore.load();
    const d = this.store.data;
    d.salt ||= randomBytes(16).toString('hex');
    d.boardViews ||= {};
    for (const a of d.ads) a.kind ||= 'house';
    this.uniques = new Map(Object.entries(this.uniqueStore.data).map(([id, arr]) => [id, new Set(arr)]));
  }

  get ads() {
    return this.store.data.ads;
  }

  get pricing() {
    return mergePricing(this.store.data.pricing);
  }

  setPricing(p) {
    const merged = mergePricing(p);
    for (const t of Object.keys(BOARD_TYPES)) if (!(merged.daily[t] > 0)) throw new Error(`Daily price for ${t} must be above 0`);
    if (!(merged.shares >= 1 && merged.shares <= 12)) throw new Error('Shares must be between 1 and 12');
    if (!(merged.rotateSecs >= 5 && merged.rotateSecs <= 120)) throw new Error('Rotation must be 5 to 120 seconds');
    this.store.data.pricing = merged;
    this.bump();
    return merged;
  }

  isLive(ad, now = Date.now()) {
    if (ad.paused) return false;
    if (ad.kind === 'paid') return ad.status === 'approved' && now >= ad.startMs && now < ad.endMs;
    // Plain dates are whole days on the Lagos clock (the admin's calendar), not UTC midnight.
    const at = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? lagosDayMs(d) : Date.parse(d));
    return (!ad.start || now >= at(ad.start)) && (!ad.end || now < at(ad.end) + DAY);
  }

  status(ad, now = Date.now()) {
    if (ad.kind !== 'paid') return ad.paused ? 'paused' : this.isLive(ad, now) ? 'live' : 'off';
    if (ad.status === 'approved') return now < ad.startMs ? 'scheduled' : now < ad.endMs ? (ad.paused ? 'paused' : 'live') : 'ended';
    return ad.status;
  }

  // Adverts rotating on one billboard right now.
  liveFor(board, now = Date.now()) {
    const stateId = board.id.split(':')[0];
    const paid = this.ads.filter((a) => a.kind === 'paid' && a.board === board.id && this.isLive(a, now)).sort((a, b) => a.startMs - b.startMs);
    const exclusive = paid.find((a) => a.exclusive);
    if (exclusive) return [exclusive];
    const house = this.ads.filter((a) => a.kind !== 'paid' && this.isLive(a, now) && (a.states.includes('all') || a.states.includes(stateId) || a.states.includes(`country:${ccOf(stateId)}`))).sort((a, b) => a.created - b.created);
    if (!paid.length) {
      // House adverts spread over the billboards (as before), so walls show different brands.
      if (!house.length) return [];
      const idx = this.boardsOf(stateId).indexOf(board);
      return [house[Math.max(0, idx) % house.length]];
    }
    return [...paid, ...house.slice(0, Math.max(0, this.pricing.shares - paid.length))];
  }

  slotsFor(stateId) {
    const now = Date.now();
    const c = this.cache.get(stateId);
    if (c && now - c.at < 30000) return c.result;
    const slots = {};
    for (const b of this.boardsOf(stateId)) {
      const live = this.liveFor(b, now);
      if (live.length) slots[b.id] = live.map((ad) => ({ adId: ad.id, image: media.url(ad.file), advertiser: ad.advertiser, link: ad.link || null, chat: ad.kind === 'paid' && !!ad.advertiserId }));
    }
    const result = { version: this.store.data.version, rotateMs: this.pricing.rotateSecs * 1000, slots };
    this.cache.set(stateId, { at: now, result });
    return result;
  }

  // The advert on screen on a billboard at a given moment (same clock as the clients).
  adForSlot(slotId, now = Date.now()) {
    const stateId = slotId.split(':')[0];
    const { slots, rotateMs } = this.slotsFor(stateId);
    const list = slots[slotId];
    if (!list?.length) return null;
    return list[Math.floor(now / rotateMs) % list.length];
  }

  // ---------- house adverts (admin) ----------
  async create({ advertiser, title, imageDataUrl, states, start, end, priceNaira, link }) {
    const img = decodeImage(imageDataUrl);
    // Targets: 'all', whole countries ('country:GH') or single regions.
    const ok = (s) => s === 'all' || (typeof s === 'string' && s.startsWith('country:') && !!COUNTRY_BY_CC[s.slice(8).toUpperCase()]) || !!regionById(s);
    const targets = (Array.isArray(states) ? states : ['all']).map((s) => (String(s).startsWith('country:') ? `country:${String(s).slice(8).toUpperCase()}` : s)).filter(ok);
    if (!targets.length) throw new Error('Choose at least one country or region');
    const id = randomUUID().slice(0, 8);
    const file = `${id}.${img.ext}`;
    await media.put(file, img.buf);
    const ad = {
      id,
      kind: 'house',
      advertiser: String(advertiser || 'Advertiser').slice(0, 80),
      title: String(title || '').slice(0, 120),
      file,
      size: { w: img.w, h: img.h },
      link: cleanLink(link),
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
    const ad = this.find(id);
    for (const k of ['advertiser', 'title', 'paused', 'link']) if (k in patch) ad[k] = k === 'paused' ? !!patch[k] : k === 'link' ? cleanLink(patch[k]) : String(patch[k]).slice(0, 120);
    if (ad.kind !== 'paid') {
      for (const k of ['start', 'end', 'priceNaira']) if (k in patch) ad[k] = patch[k];
      if (Array.isArray(patch.states) && patch.states.length) ad.states = patch.states.map(String);
    }
    this.bump();
    return ad;
  }

  async remove(id) {
    const i = this.ads.findIndex((a) => a.id === id);
    if (i < 0) throw new Error('Ad not found');
    const [ad] = this.ads.splice(i, 1);
    if (!this.ads.some((a) => a.file === ad.file)) await media.del(ad.file);
    this.uniques.delete(id);
    delete this.uniqueStore.data[id];
    this.uniqueStore.markDirty();
    this.bump();
  }

  find(id) {
    const ad = this.ads.find((a) => a.id === id);
    if (!ad) throw new Error('Ad not found');
    return ad;
  }

  // ---------- paid bookings ----------
  // Bookings that hold a share of a billboard during [from, to).
  overlapping(boardId, from, to, ignoreId, now = Date.now()) {
    return this.ads.filter((a) => {
      if (a.kind !== 'paid' || a.board !== boardId || a.id === ignoreId || !ACTIVE.has(a.status)) return false;
      if (a.status === 'unpaid' && now - a.created > UNPAID_HOLD_MS) return false;
      const s = a.startMs ?? lagosDayMs(a.startDay);
      const e = a.endMs ?? s + a.days * DAY;
      return s < to && e > from;
    });
  }

  availability(boardId, startDay, days, exclusive, ignoreId) {
    const from = lagosDayMs(startDay);
    const to = from + days * DAY;
    const others = this.overlapping(boardId, from, to, ignoreId);
    const shares = this.pricing.shares;
    if (others.some((a) => a.exclusive)) return { ok: false, reason: 'Another advertiser has this billboard to themselves on those dates.', used: shares, shares };
    if (exclusive && others.length) return { ok: false, reason: `${others.length} advertiser(s) already share this billboard on those dates, so it can't be exclusive. Pick other dates or a shared slot.`, used: others.length, shares };
    if (others.length >= shares) return { ok: false, reason: 'All slots on this billboard are booked for those dates.', used: others.length, shares };
    return { ok: true, used: others.length, shares };
  }

  checkRequest({ boardId, days, exclusive, startDay }) {
    const board = this.board(boardId);
    if (!board) throw new Error('Pick a billboard');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay || '') || Number.isNaN(lagosDayMs(startDay))) throw new Error('Pick a start date');
    if (startDay < lagosToday()) throw new Error('The start date has passed');
    if (lagosDayMs(startDay) > Date.now() + 180 * DAY) throw new Error('Book at most 6 months ahead');
    const regionId = boardId.split(':')[0];
    const q = quote(this.pricing, { type: board.type, stateId: regionId, days, exclusive: !!exclusive });
    // Paystack (naira) for billboards in Africa, Stripe (US dollars) everywhere else.
    q.provider = payProvider(ccOf(regionId));
    q.usd = toUsd(this.pricing, q.total);
    q.country = ccOf(regionId);
    return { board, q, avail: this.availability(boardId, startDay, q.days, !!exclusive) };
  }

  async createBooking(account, { boardId, days, exclusive, startDay, imageDataUrl, link, title, copyFrom }) {
    const { board, q, avail } = this.checkRequest({ boardId, days, exclusive, startDay });
    if (!avail.ok) throw new Error(avail.reason);
    let file;
    let size;
    if (copyFrom) {
      file = copyFrom.file;
      size = copyFrom.size;
    } else {
      const img = decodeImage(imageDataUrl);
      const spec = BOARD_TYPES[board.type];
      if (!ratioOk(board.type, img.w, img.h)) throw new Error(`This billboard needs a ${spec.ratio.join(':')} image. Yours is ${img.w}×${img.h}.`);
      if (img.w < spec.minW || img.h < spec.minH) throw new Error(`Image too small for HD: at least ${spec.minW}×${spec.minH} pixels. Yours is ${img.w}×${img.h}.`);
      if (img.w > MAX_IMAGE_PX || img.h > MAX_IMAGE_PX) throw new Error(`Image too large: at most ${MAX_IMAGE_PX} pixels wide or high. Yours is ${img.w}×${img.h}.`);
      file = `${randomUUID().slice(0, 12)}.${img.ext}`;
      await media.put(file, img.buf);
      size = { w: img.w, h: img.h };
    }
    const id = randomUUID().slice(0, 10);
    const ad = {
      id,
      kind: 'paid',
      advertiserId: account.id,
      advertiser: account.business,
      email: account.email,
      title: String(title || '').slice(0, 120),
      file,
      size,
      link: cleanLink(link),
      board: board.id,
      boardCode: board.code,
      boardType: board.type,
      states: [board.id.split(':')[0]],
      exclusive: !!exclusive,
      days: q.days,
      startDay,
      quote: q,
      priceNaira: q.total,
      provider: q.provider,
      priceUsd: q.usd,
      country: q.country,
      status: 'unpaid',
      reference: null,
      payments: [],
      paused: false,
      created: Date.now(),
      stats: emptyStats()
    };
    this.ads.push(ad);
    this.store.markDirty();
    this.store.save();
    return ad;
  }

  newReference(ad) {
    ad.reference = `POD-${ad.id}-${randomBytes(3).toString('hex')}`;
    ad.payments.push({ reference: ad.reference, at: Date.now() });
    this.store.markDirty();
    return ad.reference;
  }

  byReference(reference) {
    return this.ads.find((a) => a.kind === 'paid' && (a.reference === reference || a.payments?.some((p) => p.reference === reference)));
  }

  // Paystack confirmed a payment (from verify or the webhook). Idempotent.
  markPaid(reference, tx) {
    const ad = this.byReference(reference);
    if (!ad) throw new Error('Unknown payment reference');
    if (ad.status !== 'unpaid') return ad;
    if (tx.status !== 'success') throw new Error(`Payment not successful (${tx.status})`);
    if (ad.provider === 'stripe') {
      if (String(tx.currency).toUpperCase() !== 'USD' || Number(tx.amount) < ad.priceUsd * 100) throw new Error('Paid amount does not match the price');
      ad.paymentIntent = tx.paymentIntent || null;
      ad.paidCents = Number(tx.amount);
    } else if (tx.currency !== 'NGN' || Number(tx.amount) < ad.priceNaira * 100) throw new Error('Paid amount does not match the price');
    ad.status = 'review';
    ad.reference = reference;
    ad.paidAt = Date.now();
    if (ad.provider !== 'stripe') ad.paidKobo = Number(tx.amount);
    ad.channel = tx.channel || null;
    this.bump();
    return ad;
  }

  approve(id, now = Date.now()) {
    const ad = this.find(id);
    if (ad.kind !== 'paid' || ad.status !== 'review') throw new Error('Only paid adverts waiting for review can be approved');
    const start = Math.max(lagosDayMs(ad.startDay), now);
    ad.startMs = start;
    ad.endMs = start + ad.days * DAY;
    ad.status = 'approved';
    ad.approvedAt = now;
    this.bump();
    return ad;
  }

  reject(id, reason, refundResult) {
    const ad = this.find(id);
    ad.status = 'rejected';
    ad.rejectReason = String(reason || '').slice(0, 300);
    ad.refund = refundResult;
    this.bump();
    return ad;
  }

  // Drop abandoned unpaid bookings, close finished ones.
  async housekeeping(now = Date.now()) {
    let changed = false;
    for (const ad of [...this.ads]) {
      if (ad.kind !== 'paid') continue;
      if (ad.status === 'unpaid' && now - ad.created > UNPAID_HOLD_MS * 12) {
        this.ads.splice(this.ads.indexOf(ad), 1);
        if (!this.ads.some((a) => a.file === ad.file)) await media.del(ad.file);
        changed = true;
      } else if (ad.status === 'approved' && now >= ad.endMs && !ad.ended) {
        ad.ended = now;
        changed = true;
      }
    }
    // Keep billboard view history to 60 days.
    const cutoff = lagosToday(now - 60 * DAY);
    for (const days of Object.values(this.store.data.boardViews)) for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
    if (changed) this.bump();
  }

  // Average daily views of a billboard over the last 7 days (for the portal).
  estViews(boardId, now = Date.now()) {
    const days = this.store.data.boardViews[boardId] || {};
    let sum = 0;
    for (let i = 1; i <= 7; i++) sum += days[lagosToday(now - i * DAY)] || 0;
    return Math.round(sum / 7);
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

  // A player's client reports the billboards in view. Each counts once per player per minute.
  recordViews(player, stateId, slotIds, now = Date.now()) {
    if (!Array.isArray(slotIds)) return;
    const hour = new Date(now + 3600000).getUTCHours();
    const day = lagosToday(now);
    const who = this.hashPlayer(player.token || player.id);
    for (const slot of slotIds.slice(0, 30)) {
      if (typeof slot !== 'string' || !slot.startsWith(`${stateId}:`) || !this.board(slot)) continue;
      const key = `${who}:${slot}`;
      if ((this.seen.get(key) || 0) > now - ADS.viewDedupeMs) continue;
      this.seen.set(key, now);
      const bv = (this.store.data.boardViews[slot] ||= {});
      bv[day] = (bv[day] || 0) + 1;
      this.store.markDirty();
      const a = this.adForSlot(slot, now);
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

  image(file) {
    return media.get(file);
  }

  // What an advertiser sees about one of their bookings.
  publicBooking(ad, now = Date.now()) {
    const s = ad.stats || emptyStats();
    return {
      id: ad.id,
      title: ad.title,
      image: `/ads/${ad.file}`,
      size: ad.size,
      link: ad.link,
      board: ad.board,
      boardCode: ad.boardCode,
      boardType: ad.boardType,
      boardLabel: this.board(ad.board)?.label || '',
      state: ad.states[0],
      exclusive: ad.exclusive,
      days: ad.days,
      startDay: ad.startDay,
      startMs: ad.startMs || null,
      endMs: ad.endMs || null,
      priceNaira: ad.priceNaira,
      priceUsd: ad.priceUsd || null,
      provider: ad.provider || 'paystack',
      country: ad.country || 'NG',
      quote: ad.quote,
      status: this.status(ad, now),
      rejectReason: ad.rejectReason || null,
      refund: ad.refund ? { status: ad.refund.status || 'requested' } : null,
      created: ad.created,
      paidAt: ad.paidAt || null,
      stats: { views: s.views, uniques: s.uniques, gems: s.gems + s.spiritGems, bySide: s.bySide, byDay: s.byDay, byHour: s.byHour }
    };
  }

  csv() {
    const rows = [['Kind', 'Status', 'Advertiser', 'Email', 'Campaign', 'Billboard', 'States', 'Start', 'End', 'Paid (NGN)', 'Reference', 'Views', 'Unique players', 'Gem pickups', 'Spirit revivals', 'Security views', 'Outlaw views']];
    for (const a of this.ads) {
      const s = a.stats || emptyStats();
      const start = a.kind === 'paid' ? (a.startMs ? new Date(a.startMs).toISOString() : a.startDay) : a.start;
      const end = a.kind === 'paid' ? (a.endMs ? new Date(a.endMs).toISOString() : '') : a.end;
      rows.push([a.kind, this.status(a), a.advertiser, a.email || '', a.title, a.boardCode || '', a.states.join(' '), start, end, a.priceNaira, a.reference || '', s.views, s.uniques, s.gems, s.spiritGems, s.bySide.sec || 0, s.bySide.out || 0]);
    }
    return rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  }
}

function cleanLink(link) {
  return /^https?:\/\/[^\s<>"]+$/.test(link || '') ? String(link).slice(0, 300) : null;
}
