// Conversations between players and the businesses on the billboards.
// One thread per (advertiser, player). Players see only the business name; businesses see
// only the player's soldier name. Nobody sees the other's account, email or phone.
import { randomUUID } from 'node:crypto';
import { JsonStore } from './store.js';

const MAX_MSGS = 200;
const MAX_LEN = 400;

const clean = (text) =>
  String(text || '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_LEN);

export class Inbox {
  constructor() {
    this.store = new JsonStore('inbox.json', { threads: {} });
    this.rate = new Map(); // who -> last message time
  }

  async load() {
    await this.store.load();
    this.store.data.threads ||= {};
  }

  get threads() {
    return this.store.data.threads;
  }

  find(advertiserId, token) {
    return Object.values(this.threads).find((t) => t.advertiserId === advertiserId && t.player === token);
  }

  // Player writes to a business (starts the thread if needed).
  fromPlayer({ token, name }, ad, text) {
    text = clean(text);
    if (!text) throw new Error('Type message first');
    this.limit(`p:${token}`);
    let th = this.find(ad.advertiserId, token);
    if (!th) {
      th = { id: randomUUID().slice(0, 12), advertiserId: ad.advertiserId, business: ad.advertiser, player: token, playerName: name, adId: ad.id, boardCode: ad.boardCode, image: ad.file, link: ad.link || null, msgs: [], unreadPlayer: 0, unreadBusiness: 0, blocked: false, created: Date.now() };
      this.threads[th.id] = th;
    }
    if (th.blocked) throw new Error('This business is no longer accepting messages from you.');
    Object.assign(th, { playerName: name, adId: ad.id, boardCode: ad.boardCode, image: ad.file, link: ad.link || th.link, business: ad.advertiser });
    th.msgs.push({ from: 'player', text, at: Date.now() });
    if (th.msgs.length > MAX_MSGS) th.msgs.splice(0, th.msgs.length - MAX_MSGS);
    th.unreadBusiness++;
    th.updated = Date.now();
    this.store.markDirty();
    return th;
  }

  // Business replies from the ad portal.
  fromBusiness(advertiserId, threadId, text) {
    const th = this.threads[threadId];
    if (!th || th.advertiserId !== advertiserId) throw new Error('Conversation not found');
    text = clean(text);
    if (!text) throw new Error('Type a reply first');
    this.limit(`b:${advertiserId}`, 500);
    th.msgs.push({ from: 'business', text, at: Date.now() });
    if (th.msgs.length > MAX_MSGS) th.msgs.splice(0, th.msgs.length - MAX_MSGS);
    th.unreadPlayer++;
    th.unreadBusiness = 0;
    th.updated = Date.now();
    this.store.markDirty();
    return th;
  }

  limit(who, ms = 1200) {
    const t = Date.now();
    if (t - (this.rate.get(who) || 0) < ms) throw new Error('Slow down small, then send again.');
    this.rate.set(who, t);
    if (this.rate.size > 50000) this.rate.clear();
  }

  readBy(threadId, side, owner) {
    const th = this.threads[threadId];
    if (!th) return null;
    if (side === 'player' && th.player !== owner) return null;
    if (side === 'business' && th.advertiserId !== owner) return null;
    if (side === 'player') th.unreadPlayer = 0;
    else th.unreadBusiness = 0;
    this.store.markDirty();
    return th;
  }

  block(advertiserId, threadId, on) {
    const th = this.threads[threadId];
    if (!th || th.advertiserId !== advertiserId) throw new Error('Conversation not found');
    th.blocked = !!on;
    this.store.markDirty();
    return th;
  }

  forPlayer(token) {
    return Object.values(this.threads)
      .filter((t) => t.player === token)
      .sort((a, b) => b.updated - a.updated);
  }

  forBusiness(advertiserId) {
    return Object.values(this.threads)
      .filter((t) => t.advertiserId === advertiserId)
      .sort((a, b) => b.updated - a.updated);
  }

  unreadFor(token) {
    return this.forPlayer(token).reduce((n, t) => n + (t.unreadPlayer || 0), 0);
  }

  // What the player's game sees.
  playerView(th, imageUrl) {
    return { id: th.id, business: th.business, adId: th.adId, image: imageUrl(th.image), link: th.link, unread: th.unreadPlayer, updated: th.updated, blocked: th.blocked, msgs: th.msgs.map((m) => ({ me: m.from === 'player', text: m.text, at: m.at })) };
  }

  // What the business sees in the portal.
  businessView(th) {
    return { id: th.id, player: th.playerName, boardCode: th.boardCode, unread: th.unreadBusiness, updated: th.updated, blocked: th.blocked, msgs: th.msgs.map((m) => ({ me: m.from === 'business', text: m.text, at: m.at })) };
  }
}
