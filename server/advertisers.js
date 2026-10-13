// Advertiser accounts for the ad portal (separate from player accounts).
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonStore } from './store.js';

const SESSION_MS = 30 * 86400000;

export class Advertisers {
  constructor() {
    this.store = new JsonStore('advertisers.json', { accounts: {}, byEmail: {}, sessions: {} });
    this.attempts = new Map(); // ip -> { n, t }
  }

  async load() {
    await this.store.load();
    const d = this.store.data;
    d.accounts ||= {};
    d.byEmail ||= {};
    d.sessions ||= {};
  }

  limit(ip) {
    const now = Date.now();
    const a = this.attempts.get(ip) || { n: 0, t: now };
    if (now - a.t > 15 * 60000) {
      a.n = 0;
      a.t = now;
    }
    a.n++;
    this.attempts.set(ip, a);
    if (a.n > 20) throw new Error('Too many attempts. Wait 15 minutes and try again.');
  }

  register({ email, password, business, phone }, ip) {
    this.limit(ip);
    email = String(email || '').trim().toLowerCase();
    business = String(business || '').trim().slice(0, 80);
    phone = String(phone || '').replace(/[^\d+ ]/g, '').trim().slice(0, 20);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Enter a valid email address');
    if (typeof password !== 'string' || password.length < 8 || password.length > 100) throw new Error('Password must be at least 8 characters');
    if (business.length < 2) throw new Error('Enter your business or brand name');
    if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter a phone number we can reach you on');
    const d = this.store.data;
    if (d.byEmail[email]) throw new Error('An account with this email already exists. Log in instead.');
    const id = randomUUID().slice(0, 12);
    const salt = randomBytes(16).toString('hex');
    d.accounts[id] = { id, email, business, phone, salt, hash: scryptSync(password, salt, 32).toString('hex'), created: Date.now() };
    d.byEmail[email] = id;
    return this.session(id);
  }

  login({ email, password }, ip) {
    this.limit(ip);
    const d = this.store.data;
    const id = d.byEmail[String(email || '').trim().toLowerCase()];
    const acc = id && d.accounts[id];
    if (!acc || typeof password !== 'string' || !timingSafeEqual(scryptSync(password, acc.salt, 32), Buffer.from(acc.hash, 'hex'))) throw new Error('Wrong email or password');
    this.attempts.delete(ip);
    return this.session(id);
  }

  session(id) {
    const d = this.store.data;
    const token = randomBytes(24).toString('hex');
    d.sessions[token] = { id, exp: Date.now() + SESSION_MS };
    // Prune expired sessions.
    const now = Date.now();
    for (const [k, s] of Object.entries(d.sessions)) if (s.exp < now) delete d.sessions[k];
    this.store.markDirty();
    this.store.save();
    return { token, account: this.public(d.accounts[id]) };
  }

  fromRequest(req) {
    const m = /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const s = this.store.data.sessions[m[1]];
    if (!s || s.exp < Date.now()) return null;
    return this.store.data.accounts[s.id] || null;
  }

  logout(req) {
    const m = /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '');
    if (m) delete this.store.data.sessions[m[1]];
    this.store.markDirty();
  }

  update(acc, { business, phone, password }) {
    if (business !== undefined) acc.business = String(business).trim().slice(0, 80) || acc.business;
    if (phone !== undefined) acc.phone = String(phone).replace(/[^\d+ ]/g, '').trim().slice(0, 20) || acc.phone;
    if (password) {
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      acc.salt = randomBytes(16).toString('hex');
      acc.hash = scryptSync(password, acc.salt, 32).toString('hex');
    }
    this.store.markDirty();
    return this.public(acc);
  }

  // Admin: set a new password for someone who forgot theirs.
  resetPassword(email, password) {
    const id = this.store.data.byEmail[String(email || '').trim().toLowerCase()];
    if (!id) throw new Error('No advertiser with that email');
    const acc = this.store.data.accounts[id];
    this.update(acc, { password });
    for (const [k, s] of Object.entries(this.store.data.sessions)) if (s.id === id) delete this.store.data.sessions[k];
    this.store.save();
    return this.public(acc);
  }

  public(acc) {
    return { id: acc.id, email: acc.email, business: acc.business, phone: acc.phone, created: acc.created };
  }

  list() {
    return Object.values(this.store.data.accounts).map((a) => this.public(a));
  }
}
