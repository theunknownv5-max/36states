// Proof of Duty game server: static hosting, accounts, the state lobby, live matches,
// the ad feed, and the advertiser/admin API.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { STATES, STATE_BY_ID } from '../shared/states.js';
import { FACTIONS, GEMS, NET, rankFor, MATCH, MODES, STAGES, GAME } from '../shared/config.js';
import { generateMap } from '../shared/map.js';
import { Match } from './match.js';
import { AdManager, lagosToday } from './ads.js';
import { JsonStore, SUPABASE } from './store.js';
import { media } from './media.js';
import { Advertisers } from './advertisers.js';
import { Inbox } from './inbox.js';
import { Daily } from './daily.js';
import { Social } from './social.js';
import { Control, pidOf } from './control.js';
import { Push } from './push.js';
import { adminRoutes } from './admin-routes.js';
import * as paystack from './paystack.js';
import { boardsFor, BOARD_TYPES, tierFor } from '../shared/billboards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 2567;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';

// Billboards per state (maps are deterministic, so build the catalogue once at boot).
const catalogue = {};
const mapOutline = {};
for (const s of STATES) {
  const map = generateMap(s.id);
  catalogue[s.id] = boardsFor(map);
  mapOutline[s.id] = {
    half: map.half,
    sites: map.sites.map((x) => ({ id: x.id, x: x.x, z: x.z, label: x.label })),
    bases: { sec: { x: map.bases.sec.x, z: 0 }, out: { x: map.bases.out.x, z: 0 } },
    landmark: { x: map.landmark.x, z: map.landmark.z, name: map.landmark.name },
    water: map.water.map((w) => [w.x0, w.z0, w.x1, w.z1]),
    buildings: map.buildings.map((b) => [b.x0 ?? b.x - b.w / 2, b.z0 ?? b.z - b.d / 2, b.x1 ?? b.x + b.w / 2, b.z1 ?? b.z + b.d / 2])
  };
}

await media.init();
const ads = new AdManager(catalogue);
const advertisers = new Advertisers();
const inbox = new Inbox();
const control = new Control();
const push = new Push();
const tokenConns = new Map(); // player token -> Set of live connections (for reply notifications)
const store = new JsonStore('players.json', { profiles: {}, accounts: {} });
await ads.load();
await advertisers.load();
await inbox.load();
await control.load();
await push.load();
await store.load();
const saveProfile = () => store.markDirty();
const daily = new Daily(saveProfile);
// Where a real player is right now (for friends and crews).
function presence(token) {
  const conns = tokenConns.get(token);
  if (!conns || !conns.size) return { online: false, where: null };
  for (const c of conns) {
    const m = c.match;
    if (m && c.player && !m.mode.def.solo) return { online: true, where: { state: m.stateId, mode: m.modeId, side: c.player.side, faction: c.player.faction, real: !!m.opts.noBots } };
  }
  return { online: true, where: null };
}
const social = new Social(store, saveProfile, presence);
const threadView = (th) => inbox.playerView(th, (f) => media.url(f));
function notifyPlayer(token, msg) {
  for (const c of tokenConns.get(token) || []) if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

const matches = new Map(); // "mode:state" (or "stage:<player>") -> Match
function matchFor(stateId, mode = 'conquest', key = `${mode}:${stateId}`, opts = {}) {
  if (!matches.has(key)) {
    const m = new Match(stateId, { ads, saveProfile, daily, social, control, pidOf }, mode, opts);
    m.key = key;
    matches.set(key, m);
  }
  return matches.get(key);
}

// ---------- accounts ----------
function newProfile(token, name) {
  return { token, name, gems: GEMS.startingGems, xp: 0, kills: 0, deaths: 0, wins: 0, matches: 0, stage: 0, stageStars: {}, created: Date.now() };
}

function authenticate(msg) {
  const accounts = store.data.accounts;
  if (msg.mode === 'register' || msg.mode === 'login') {
    const u = String(msg.username || '').trim();
    const key = u.toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(u)) return { error: 'Username: 3-16 letters, numbers or _ only' };
    if (typeof msg.password !== 'string' || msg.password.length < 6 || msg.password.length > 64) return { error: 'Password suppose reach at least 6 characters' };
    if (msg.mode === 'register') {
      if (accounts[key]) return { error: 'Person don already take that username' };
      const salt = randomBytes(16).toString('hex');
      const token = randomUUID();
      accounts[key] = { username: u, salt, hash: scryptSync(msg.password, salt, 32).toString('hex'), token, created: Date.now() };
      store.data.profiles[token] = newProfile(token, u);
      saveProfile();
      return { token, name: u, account: true };
    }
    const acc = accounts[key];
    if (!acc) return { error: 'No account get that username' };
    if (!timingSafeEqual(scryptSync(msg.password, acc.salt, 32), Buffer.from(acc.hash, 'hex'))) return { error: 'Password no correct' };
    return { token: acc.token, name: acc.username, account: true };
  }
  // Guest: keep the device token, unless it belongs to an account.
  let token = typeof msg.token === 'string' && /^[a-f0-9-]{16,40}$/.test(msg.token) ? msg.token : randomUUID();
  if (Object.values(accounts).some((a) => a.token === token)) return { error: 'Abeg log in to this account.' };
  const name = String(msg.name || '').replace(/[^\w .'-]/g, '').trim().slice(0, 18) || `Soldier${Math.floor(Math.random() * 9000 + 1000)}`;
  if (!store.data.profiles[token]) store.data.profiles[token] = newProfile(token, name);
  // A name the admin set (e.g. to replace an offensive one) sticks.
  const p = store.data.profiles[token];
  if (!p.nameLock) p.name = name;
  return { token, name: p.name, account: false };
}

function profilePublic(p) {
  return { name: p.name, gems: p.gems, xp: p.xp, rank: rankFor(p.xp), kills: p.kills, deaths: p.deaths, wins: p.wins, matches: p.matches, stage: p.stage || 0, stageStars: p.stageStars || {} };
}

// Live players per state, with a breakdown per mode (campaign stages are private).
function lobby() {
  return STATES.map((s) => {
    const modes = {};
    let humans = 0;
    let bots = 0;
    let score = null;
    let real = 0;
    const realModes = {};
    for (const id of Object.keys(MODES)) {
      if (MODES[id].solo || MODES[id].private) continue;
      for (const key of [`${id}:${s.id}`, `${id}:${s.id}:real`]) {
        const m = matches.get(key);
        if (!m) continue;
        const h = m.humans().length;
        if (key.endsWith(':real')) {
          real += h;
          realModes[id] = (realModes[id] || 0) + h;
        }
        modes[id] = (modes[id] || 0) + h;
        humans += h;
        bots += m.players.size - h;
        if (h && (!score || id === 'conquest')) score = m.score;
      }
    }
    return { id: s.id, humans, bots, real, realModes, sec: score?.sec || 0, out: score?.out || 0, live: humans > 0, modes };
  });
}

// Soldiers connected right now (in the lobby or in battle).
function onlineCount() {
  let n = 0;
  for (const set of tokenConns.values()) if (set.size) n++;
  return n;
}

// Top soldiers by experience (names and totals only).
function leaderboard() {
  return Object.values(store.data.profiles)
    .filter((p) => p.xp > 0 || p.kills > 0)
    .sort((a, b) => b.xp - a.xp || b.kills - a.kills)
    .slice(0, 30)
    .map((p) => ({ name: p.name, xp: p.xp, rank: rankFor(p.xp).name, kills: p.kills, deaths: p.deaths, wins: p.wins, stage: p.stage || 0 }));
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2'
};

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Upload too large (max 6 MB image)');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readBody(req, limit = 10 * 1024 * 1024) {
  // Read once; later handlers for the same request get the same body.
  if (req._body === undefined) req._body = JSON.parse((await readRaw(req, limit)).toString('utf8') || '{}');
  return req._body;
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const publicOrigin = (req) => (process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');

// ---------- ad portal helpers ----------
function boardView(b, now = Date.now()) {
  const stateId = b.id.split(':')[0];
  const today = lagosToday(now);
  const shared = ads.availability(b.id, today, 1, false);
  return { ...b, state: stateId, estViews: ads.estViews(b.id, now), usedToday: shared.used, shares: shared.shares, exclusiveToday: !shared.ok && shared.used >= shared.shares };
}

async function startPayment(req, ad, account) {
  const reference = ads.newReference(ad);
  const tx = await paystack.initialize({
    email: account.email,
    amountKobo: ad.priceNaira * 100,
    reference,
    callbackUrl: `${publicOrigin(req)}/advertise?paid=${encodeURIComponent(reference)}`,
    metadata: { bookingId: ad.id, billboard: ad.boardCode, business: account.business, custom_fields: [{ display_name: 'Billboard', variable_name: 'billboard', value: ad.boardCode }] }
  });
  ads.store.save();
  return { authorization_url: tx.authorization_url, reference };
}

async function confirmPayment(reference) {
  const ad = ads.byReference(reference);
  if (!ad) throw new Error('Unknown payment reference');
  if (ad.status !== 'unpaid') return ad;
  const tx = await paystack.verify(reference);
  return ads.markPaid(reference, tx);
}

async function advRoute(req, res, route, url) {
  const ip = clientIp(req);
  if (route === 'config' && req.method === 'GET') {
    return json(res, 200, {
      game: GAME,
      payments: paystack.paystackMode(),
      storage: SUPABASE ? 'supabase' : 'local',
      types: BOARD_TYPES,
      pricing: ads.pricing,
      today: lagosToday(),
      states: STATES.map((s) => ({ id: s.id, name: s.name, zone: s.zone, biome: s.biome, tier: tierFor(ads.pricing, s.id).name, boards: catalogue[s.id].length, players: lobby().find((l) => l.id === s.id)?.humans || 0 }))
    });
  }
  if (route === 'boards' && req.method === 'GET') {
    const st = url.searchParams.get('state');
    if (!catalogue[st]) return json(res, 400, { error: 'Unknown state' });
    return json(res, 200, { state: st, map: mapOutline[st], boards: catalogue[st].map((b) => boardView(b)) });
  }
  if (route === 'quote' && req.method === 'POST') {
    const b = await readBody(req, 64 * 1024);
    const { q, avail } = ads.checkRequest({ boardId: b.boardId, days: b.days, exclusive: b.exclusive, startDay: b.startDay });
    return json(res, 200, { quote: q, availability: avail });
  }
  if (route === 'register' && req.method === 'POST') return json(res, 200, advertisers.register(await readBody(req, 64 * 1024), ip));
  if (route === 'login' && req.method === 'POST') return json(res, 200, advertisers.login(await readBody(req, 64 * 1024), ip));
  if (route === 'verify' && req.method === 'GET') {
    const ad = await confirmPayment(String(url.searchParams.get('reference') || ''));
    return json(res, 200, { booking: ads.publicBooking(ad) });
  }
  // Everything below needs a signed-in advertiser.
  const acc = advertisers.fromRequest(req);
  if (!acc) return json(res, 401, { error: 'Please log in again' });
  if (route === 'logout' && req.method === 'POST') {
    advertisers.logout(req);
    return json(res, 200, { ok: true });
  }
  if (route === 'me' && req.method === 'GET') {
    const mine = ads.ads.filter((a) => a.kind === 'paid' && a.advertiserId === acc.id).sort((a, b) => b.created - a.created);
    return json(res, 200, { account: advertisers.public(acc), bookings: mine.map((a) => ads.publicBooking(a)) });
  }
  if (route === 'me' && req.method === 'PATCH') return json(res, 200, { account: advertisers.update(acc, await readBody(req, 64 * 1024)) });
  if (route === 'inbox' && req.method === 'GET') {
    const list = inbox.forBusiness(acc.id).map((t) => inbox.businessView(t));
    return json(res, 200, { threads: list, unread: list.reduce((n, t) => n + t.unread, 0) });
  }
  const ib = /^inbox\/([a-z0-9-]+)\/(reply|read|block|unblock)$/.exec(route);
  if (ib && req.method === 'POST') {
    let th;
    if (ib[2] === 'reply') {
      th = inbox.fromBusiness(acc.id, ib[1], (await readBody(req, 64 * 1024)).text);
      notifyPlayer(th.player, { t: 'inboxNew', thread: threadView(th), unread: inbox.unreadFor(th.player) });
    } else if (ib[2] === 'read') th = inbox.readBy(ib[1], 'business', acc.id);
    else th = inbox.block(acc.id, ib[1], ib[2] === 'block');
    if (!th) return json(res, 404, { error: 'Conversation not found' });
    return json(res, 200, { thread: inbox.businessView(th) });
  }
  if (route === 'bookings' && req.method === 'POST') {
    if (!paystack.paystackReady()) return json(res, 503, { error: 'Payments are not switched on yet. Please try again later.' });
    const ad = await ads.createBooking(acc, await readBody(req));
    try {
      return json(res, 200, { booking: ads.publicBooking(ad), ...(await startPayment(req, ad, acc)) });
    } catch (e) {
      return json(res, 502, { error: `Could not start the payment: ${e.message}`, booking: ads.publicBooking(ad) });
    }
  }
  const m = /^bookings\/([a-z0-9-]+)\/(pay|renew|cancel)$/.exec(route);
  if (m && req.method === 'POST') {
    const ad = ads.ads.find((a) => a.id === m[1] && a.kind === 'paid' && a.advertiserId === acc.id);
    if (!ad) return json(res, 404, { error: 'Booking not found' });
    if (m[2] === 'pay') {
      if (ad.status !== 'unpaid') return json(res, 400, { error: 'This booking is already paid' });
      const avail = ads.availability(ad.board, ad.startDay, ad.days, ad.exclusive, ad.id);
      if (!avail.ok) return json(res, 409, { error: avail.reason });
      if (ad.startDay < lagosToday()) return json(res, 400, { error: 'The start date has passed. Make a new booking.' });
      return json(res, 200, await startPayment(req, ad, acc));
    }
    if (m[2] === 'cancel') {
      if (ad.status !== 'unpaid') return json(res, 400, { error: 'Only unpaid bookings can be cancelled here. Contact us about paid ones.' });
      await ads.remove(ad.id);
      return json(res, 200, { ok: true });
    }
    // Renew: same artwork and billboard, starting when the current run ends (or today).
    const body = await readBody(req, 64 * 1024);
    const from = ad.endMs && ad.endMs > Date.now() ? lagosToday(ad.endMs) : lagosToday();
    const copy = await ads.createBooking(acc, { boardId: ad.board, days: body.days || ad.days, exclusive: ad.exclusive, startDay: body.startDay || from, link: ad.link, title: ad.title, copyFrom: ad });
    try {
      return json(res, 200, { booking: ads.publicBooking(copy), ...(await startPayment(req, copy, acc)) });
    } catch (e) {
      return json(res, 502, { error: `Could not start the payment: ${e.message}`, booking: ads.publicBooking(copy) });
    }
  }
  return json(res, 404, { error: 'Unknown route' });
}

// Super admin (ADMIN_KEY) or a team member's own key with a role.
function adminOf(req) {
  return control.roleFor(req.headers['x-admin-key'], ADMIN_KEY);
}
let superAdmin;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/health') return json(res, 200, { ok: true, game: GAME.name, version: GAME.version, matches: matches.size, players: [...matches.values()].reduce((n, m) => n + m.humans().length, 0) });
    if (path === '/api/lobby') return json(res, 200, { states: lobby(), online: onlineCount() });
    if (path === '/api/leaderboard') return json(res, 200, { top: leaderboard() });
    if (path === '/api/ads') {
      const state = url.searchParams.get('state');
      if (!STATE_BY_ID[state]) return json(res, 400, { error: 'unknown state' });
      return json(res, 200, ads.slotsFor(state));
    }
    if (path.startsWith('/ads/')) {
      const img = await ads.image(path.slice(5));
      if (!img) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'image/png', 'cache-control': 'public, max-age=604800, immutable', 'access-control-allow-origin': '*' });
      return res.end(img);
    }
    if (path === '/advertise' || path === '/advertise/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(await readFile(join(__dirname, 'advertise.html')));
    }
    if (path === '/shared/billboards.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' });
      return res.end(await readFile(join(__dirname, '..', 'shared', 'billboards.js')));
    }
    if (path === '/api/paystack/webhook' && req.method === 'POST') {
      const raw = await readRaw(req, 256 * 1024);
      if (!paystack.validSignature(raw, req.headers['x-paystack-signature'])) return json(res, 401, { error: 'bad signature' });
      const ev = JSON.parse(raw.toString('utf8'));
      try {
        if (ev.event === 'charge.success' && ev.data?.reference) await confirmPayment(ev.data.reference);
        if (/^refund\./.test(ev.event)) {
          const ref = ev.data?.transaction_reference || ev.data?.transaction?.reference;
          const ad = ref && ads.byReference(ref);
          if (ad) {
            ad.refund = { ...(ad.refund || {}), status: ev.data.status || ev.event.split('.')[1] };
            ads.store.markDirty();
          }
        }
      } catch (e) {
        console.error('paystack webhook', ev.event, e.message);
      }
      return json(res, 200, { ok: true });
    }
    if (path.startsWith('/api/adv/')) return await advRoute(req, res, path.slice('/api/adv/'.length), url);
    if (path === '/admin') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(join(__dirname, 'admin.html')));
    }
    if (path.startsWith('/api/admin/')) {
      const who = adminOf(req);
      if (!who) return json(res, 401, { error: 'Wrong admin key' });
      const route = path.slice('/api/admin/'.length);
      superAdmin ||= adminRoutes({ control, store, matches, tokenConns, push, inbox, social, json, readBody, profilePublic, saveProfile });
      if (await superAdmin(req, res, route, who)) return;
      // Ads, billboards, prices and advertisers: owner and marketing team.
      if (who.role === 'moderator') return json(res, 403, { error: "Your role (moderator) can't manage ads." });
      if (route === 'overview' && req.method === 'GET') {
        const now = Date.now();
        return json(res, 200, {
          states: STATES.map((s) => ({ id: s.id, name: s.name, walls: catalogue[s.id].filter((b) => b.type === 'wall').length, boards: catalogue[s.id].length })),
          lobby: lobby(),
          ads: ads.ads.map((a) => ({ ...a, liveStatus: ads.status(a, now), image: media.url(a.file), preview: `/ads/${a.file}`, boardLabel: a.board ? catalogue[a.board.split(':')[0]].find((b) => b.id === a.board)?.label : null })),
          pricing: ads.pricing,
          types: BOARD_TYPES,
          advertisers: advertisers.list(),
          payments: paystack.paystackMode(),
          storage: SUPABASE ? 'supabase' : 'local'
        });
      }
      if (route === 'pricing' && req.method === 'PUT') return json(res, 200, { pricing: ads.setPricing(await readBody(req, 64 * 1024)) });
      if (route === 'reset-password' && req.method === 'POST') {
        const b = await readBody(req, 64 * 1024);
        return json(res, 200, { account: advertisers.resetPassword(b.email, b.password) });
      }
      const bk = /^bookings\/([a-z0-9-]+)\/(approve|reject|verify)$/.exec(route);
      if (bk && req.method === 'POST') {
        const ad = ads.find(bk[1]);
        if (bk[2] === 'approve') return json(res, 200, { ad: ads.approve(ad.id) });
        if (bk[2] === 'verify') {
          if (!ad.reference) throw new Error('No payment started for this booking');
          return json(res, 200, { ad: await confirmPayment(ad.reference) });
        }
        const b = await readBody(req, 64 * 1024);
        if (!['review', 'approved'].includes(ad.status)) throw new Error('Only paid bookings can be rejected and refunded');
        let refund = { status: 'not needed' };
        if (ad.paidAt) {
          try {
            const r = await paystack.refund(ad.reference);
            refund = { status: r.status || 'pending', id: r.id || null, at: Date.now() };
          } catch (e) {
            return json(res, 502, { error: `Paystack refund failed: ${e.message}. Nothing was changed; try again or refund from the Paystack dashboard.` });
          }
        }
        return json(res, 200, { ad: ads.reject(ad.id, b.reason, refund) });
      }
      if (route === 'ads' && req.method === 'POST') return json(res, 200, { ad: await ads.create(await readBody(req)) });
      if (route === 'report.csv') {
        res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="pod-ad-report.csv"' });
        return res.end(ads.csv());
      }
      const m = /^ads\/([a-z0-9-]+)$/.exec(route);
      if (m && req.method === 'PATCH') return json(res, 200, { ad: await ads.update(m[1], await readBody(req)) });
      if (m && req.method === 'DELETE') {
        await ads.remove(m[1]);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Unknown admin route' });
    }
    let file = normalize(join(DIST, decodeURIComponent(path)));
    if (!file.startsWith(DIST)) return json(res, 403, { error: 'forbidden' });
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = join(DIST, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found. Run "npm run build" first, or use "npm run dev" for development.');
    }
    json(res, 400, { error: e.message });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });
wss.on('connection', (ws) => {
  const conn = { ws, profile: null, match: null, player: null };
  let count = 0;
  let windowStart = Date.now();
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.on('message', (raw) => {
    const t = Date.now();
    if (t - windowStart > 1000) {
      windowStart = t;
      count = 0;
    }
    if (++count > 90) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return send({ t: 'pong', c: msg.c, s: Date.now() });
    if (msg.t === 'hello') {
      const r = authenticate(msg);
      if (r.error) return send({ t: 'authError', error: r.error });
      const fresh = !store.data.profiles[r.token];
      conn.profile = store.data.profiles[r.token] || (store.data.profiles[r.token] = newProfile(r.token, r.name));
      const ban = control.banInfo(conn.profile);
      if (ban) {
        conn.profile = null;
        return send({ t: 'authError', error: `You don collect ban${ban.until ? ` till ${new Date(ban.until).toLocaleString('en-NG')}` : ''}: ${ban.reason}`, banned: true });
      }
      if (fresh) control.track('newPlayer');
      conn.profile.lastSeen = Date.now();
      if (r.account) conn.profile.account = true;
      saveProfile();
      if (conn.token) tokenConns.get(conn.token)?.delete(conn);
      conn.token = r.token;
      if (!tokenConns.has(r.token)) tokenConns.set(r.token, new Set());
      tokenConns.get(r.token).add(conn);
      // Old app build below the minimum the admin set: ask to update.
      const ctl = control.publicState();
      const needUpdate = msg.app && ctl.minBuild && (Number(msg.build) || 0) < ctl.minBuild;
      return send({ t: 'welcome', token: r.token, account: r.account, profile: profilePublic(conn.profile), lobby: lobby(), online: onlineCount(), inboxUnread: inbox.unreadFor(r.token), daily: daily.view(conn.profile), control: ctl, push: { vapid: push.publicKey, fcm: push.fcmReady(), on: !!push.store.data.subs[r.token] }, needUpdate });
    }
    if (!conn.profile) return;
    if (msg.t === 'lobby') return send({ t: 'lobby', states: lobby(), profile: profilePublic(conn.profile), online: onlineCount() });
    if (msg.t === 'join') {
      if (control.store.data.maintenance.on) return send({ t: 'joinError', error: control.store.data.maintenance.message });
      const mode = MODES[msg.mode] ? msg.mode : 'conquest';
      let state = msg.state;
      let faction = msg.faction;
      let key;
      let opts = {};
      if (mode === 'stage') {
        const i = Math.max(0, Math.min(STAGES.length - 1, msg.stage | 0));
        if (i > (conn.profile.stage || 0)) return send({ t: 'joinError', error: 'You never open this stage. Clear the one before am first.' });
        state = STAGES[i].state;
        faction = STAGES[i].ally;
        key = `stage:${conn.profile.token}`;
        opts = { stage: i };
      }
      if (!STATE_BY_ID[state] || !FACTIONS[faction]) return send({ t: 'joinError', error: 'Pick state and side first.' });
      if (conn.match) conn.match.removePlayer(conn.player.id);
      // One live session per profile.
      for (const m of matches.values()) for (const p of m.humans()) if (p.profile === conn.profile) m.removePlayer(p.id);
      // A fresh campaign match every time you start a stage.
      if (key) matches.delete(key);
      // Practice Range: private to you, or to your crew if you have one.
      if (mode === 'practice') {
        const crew = social.crewOf(conn.profile);
        key = `practice:${state}:${crew ? `c${crew.id}` : `t${conn.profile.token}`}`;
        opts = { practice: true };
      } else if (mode !== 'stage' && msg.bots === false) {
        // Real players only: a room with no bots at all.
        key = `${mode}:${state}:real`;
        opts = { noBots: true };
      }
      const match = matchFor(state, mode, key || `${mode}:${state}`, opts);
      const r = match.addHuman(ws, faction, conn.profile);
      if (r.error) return send({ t: 'joinError', error: r.error });
      conn.match = match;
      conn.player = r.player;
      control.track('join', { mode, state });
      send(match.info(r.player));
      match.syncMe(r.player);
      return;
    }
    // ---------- chat with businesses on the billboards ----------
    if (msg.t === 'adChatOpen') {
      const ad = ads.ads.find((a) => a.id === msg.adId && a.kind === 'paid' && a.advertiserId && ads.isLive(a));
      if (!ad) return send({ t: 'adChat', ok: false, reason: 'This advert no get chat.' });
      let r = { ok: true, paused: false };
      if (conn.match && conn.player) r = conn.match.setChat(conn.player, true);
      if (!r.ok) return send({ t: 'adChat', ok: false, reason: r.reason });
      const th = inbox.find(ad.advertiserId, conn.profile.token);
      if (th) inbox.readBy(th.id, 'player', conn.profile.token);
      return send({ t: 'adChat', ok: true, paused: !!r.paused, until: r.until || 0, ad: { id: ad.id, business: ad.advertiser, image: media.url(ad.file), link: ad.link || null }, thread: th ? threadView(th) : null });
    }
    if (msg.t === 'adChatClose') {
      if (conn.match && conn.player) conn.match.setChat(conn.player, false);
      return;
    }
    if (msg.t === 'adMsg') {
      try {
        let ad;
        if (msg.threadId) {
          const th = inbox.threads[msg.threadId];
          if (!th || th.player !== conn.profile.token) throw new Error('Conversation not found');
          ad = { advertiserId: th.advertiserId, advertiser: th.business, id: th.adId, boardCode: th.boardCode, file: th.image, link: th.link };
        } else {
          ad = ads.ads.find((a) => a.id === msg.adId && a.kind === 'paid' && a.advertiserId);
          if (!ad) throw new Error('This advert no get chat.');
        }
        const th = inbox.fromPlayer({ token: conn.profile.token, name: conn.profile.name }, ad, msg.text);
        return send({ t: 'thread', thread: threadView(th) });
      } catch (e) {
        return send({ t: 'adChatError', error: e.message });
      }
    }
    if (msg.t === 'inbox') {
      const list = inbox.forPlayer(conn.profile.token).map(threadView);
      return send({ t: 'inbox', threads: list, unread: inbox.unreadFor(conn.profile.token) });
    }
    if (msg.t === 'threadRead') {
      inbox.readBy(String(msg.id || ''), 'player', conn.profile.token);
      return send({ t: 'inboxUnread', unread: inbox.unreadFor(conn.profile.token) });
    }
    // ---------- push notifications and reports ----------
    if (msg.t === 'pushSub') {
      try {
        push.subscribe(conn.profile.token, msg.kind === 'fcm' ? { kind: 'fcm', token: String(msg.token || '') } : { kind: 'web', sub: msg.sub });
        return send({ t: 'pushState', on: true });
      } catch (e) {
        return send({ t: 'pushState', on: false, error: e.message });
      }
    }
    if (msg.t === 'pushOff') {
      push.unsubscribe(conn.profile.token);
      return send({ t: 'pushState', on: false });
    }
    if (msg.t === 'report') {
      const target = conn.match?.players.get(String(msg.id || ''));
      if (!target?.human || target === conn.player) return send({ t: 'notice', title: 'Report', body: 'You fit report only real players for this battle.' });
      control.report({ reporter: { pid: pidOf(conn.profile.token), name: conn.profile.name }, target: { pid: pidOf(target.profile.token), name: target.profile.name }, reason: msg.reason, state: conn.match.stateId, mode: conn.match.modeId });
      return send({ t: 'notice', title: 'Report don reach', body: `Thank you. The POD team go check ${target.profile.name}.` });
    }
    // ---------- friends, crews, rivals ----------
    const socialReply = (extra = {}) => send({ t: 'social', social: social.view(conn.profile), ...extra });
    const pingSocial = (token) => {
      const p = store.data.profiles[token];
      if (p) notifyPlayer(token, { t: 'social', social: social.view(p) });
    };
    if (msg.t === 'social') return socialReply();
    try {
      if (msg.t === 'friendAdd') {
        const r = social.addFriend(conn.profile, msg.code);
        pingSocial(r.to);
        return socialReply({ note: r.sent ? `Friend request don go to ${r.sent}.` : `You and ${r.friend} don be friends now.` });
      }
      if (msg.t === 'friendAccept') {
        const r = social.accept(conn.profile, msg.code);
        pingSocial(r.to);
        return socialReply({ note: `You and ${r.friend} don be friends now.` });
      }
      if (msg.t === 'friendDecline') {
        social.decline(conn.profile, msg.code);
        return socialReply();
      }
      if (msg.t === 'friendRemove') {
        social.removeFriend(conn.profile, msg.code);
        return socialReply();
      }
      if (msg.t === 'crewCreate') {
        const c = social.createCrew(conn.profile, msg.name, msg.tag);
        return socialReply({ note: `Crew [${c.tag}] ${c.name} don start. Share the code make your people join.` });
      }
      if (msg.t === 'crewJoin') {
        const c = social.joinCrew(conn.profile, msg.code);
        for (const t of c.members) if (t !== conn.profile.token) pingSocial(t);
        return socialReply({ note: `Welcome to [${c.tag}] ${c.name}!` });
      }
      if (msg.t === 'crewLeave') {
        social.leaveCrew(conn.profile);
        return socialReply({ note: 'You don comot from the crew.' });
      }
      if (msg.t === 'crewChat') {
        if (control.muted(conn.profile)) return socialReply({ error: 'Admin don mute your chat for now.' });
        const { crew, msg: m } = social.crewChat(conn.profile, msg.text);
        control.logChat({ pid: pidOf(conn.profile.token), name: conn.profile.name, text: m.text, team: true, state: `crew ${crew.tag}`, mode: 'crew' });
        for (const t of crew.members) {
          const p = store.data.profiles[t];
          if (!p) continue;
          notifyPlayer(t, { t: 'crewMsg', msg: { at: m.at, from: m.from, mine: t === conn.profile.token, text: m.text }, tag: crew.tag });
        }
        return;
      }
      if (msg.t === 'crewPlan') {
        const crew = social.crewPlan(conn.profile, msg.text);
        for (const t of crew.members) if (t !== conn.profile.token) pingSocial(t);
        return socialReply({ note: 'Tactics plan don save. Your crew go see am.' });
      }
      if (msg.t === 'joinFriend') {
        const f = social.byCode(msg.code);
        const where = f && presence(f.token).where;
        if (!where) return socialReply({ note: 'Your friend no dey any battle now.' });
        return send({ t: 'friendWhere', ...where, name: f.name });
      }
    } catch (e) {
      return socialReply({ error: e.message });
    }
    // ---------- daily rewards and missions ----------
    if (msg.t === 'daily') return send({ t: 'daily', daily: daily.view(conn.profile), profile: profilePublic(conn.profile) });
    if (msg.t === 'dailyClaim') {
      const r = daily.claimLogin(conn.profile);
      return send({ t: 'daily', daily: daily.view(conn.profile), profile: profilePublic(conn.profile), claimed: r });
    }
    if (msg.t === 'missionClaim') {
      const r = daily.claimMission(conn.profile, String(msg.id || ''));
      return send({ t: 'daily', daily: daily.view(conn.profile), profile: profilePublic(conn.profile), claimed: r });
    }
    if (msg.t === 'leave') {
      if (conn.match) conn.match.removePlayer(conn.player.id);
      conn.match = conn.player = null;
      return send({ t: 'lobby', states: lobby(), profile: profilePublic(conn.profile), online: onlineCount() });
    }
    if (conn.match && conn.player) {
      try {
        conn.match.handle(conn.player, msg);
      } catch (e) {
        console.error('match handler error', msg.t, e);
      }
    }
  });
  ws.on('close', () => {
    if (conn.token) tokenConns.get(conn.token)?.delete(conn);
    if (conn.match && conn.player) conn.match.removePlayer(conn.player.id);
  });
});

// ---------- simulation loop ----------
let last = Date.now();
setInterval(() => {
  const t = Date.now();
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  for (const [id, m] of matches) {
    if (!m.humans().length && m.emptySince && t - m.emptySince > MATCH.idleCloseMs) {
      matches.delete(id);
      continue;
    }
    try {
      m.tick(dt);
    } catch (e) {
      console.error('tick error', id, e);
    }
  }
}, 1000 / NET.tickHz);

setInterval(() => {
  store.save();
  ads.store.save();
  advertisers.store.save();
  inbox.store.save();
  control.store.save();
  push.store.save();
  let on = 0;
  for (const set of tokenConns.values()) if (set.size) on++;
  control.track('online', { n: on });
}, 15000);
// Unique-viewer lists are bigger and change often: save them less frequently.
setInterval(() => ads.uniqueStore.save(), 120000);
setInterval(() => ads.housekeeping().catch((e) => console.error('ad housekeeping', e.message)), 60000);

async function shutdown() {
  await Promise.all([store.save(true), ads.store.save(true), ads.uniqueStore.save(true), advertisers.store.save(true), inbox.store.save(true), control.store.save(true), push.store.save(true)]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`${GAME.name} ${GAME.version} server on http://localhost:${PORT}  (game /ws, ad portal /advertise, admin /admin)`);
  console.log(`Storage: ${SUPABASE ? 'Supabase' : 'local files (set SUPABASE_URL + SUPABASE_SERVICE_KEY to keep data across restarts)'}. Payments: Paystack ${paystack.paystackMode()}.`);
  if (ADMIN_KEY === 'change-me') console.log('Set ADMIN_KEY before going live.');
});
