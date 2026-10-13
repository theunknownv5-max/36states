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
const store = new JsonStore('players.json', { profiles: {}, accounts: {} });
await ads.load();
await advertisers.load();
await store.load();
const saveProfile = () => store.markDirty();

const matches = new Map(); // "mode:state" (or "stage:<player>") -> Match
function matchFor(stateId, mode = 'conquest', key = `${mode}:${stateId}`, opts = {}) {
  if (!matches.has(key)) {
    const m = new Match(stateId, { ads, saveProfile }, mode, opts);
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
  store.data.profiles[token].name = name;
  return { token, name, account: false };
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
    for (const id of Object.keys(MODES)) {
      if (MODES[id].solo) continue;
      const m = matches.get(`${id}:${s.id}`);
      if (!m) continue;
      const h = m.humans().length;
      modes[id] = h;
      humans += h;
      bots += m.players.size - h;
      if (h && (!score || id === 'conquest')) score = m.score;
    }
    return { id: s.id, humans, bots, sec: score?.sec || 0, out: score?.out || 0, live: humans > 0, modes };
  });
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
  return JSON.parse((await readRaw(req, limit)).toString('utf8') || '{}');
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

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const want = Buffer.from(ADMIN_KEY);
  return given.length === want.length && timingSafeEqual(given, want);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/health') return json(res, 200, { ok: true, game: GAME.name, version: GAME.version, matches: matches.size, players: [...matches.values()].reduce((n, m) => n + m.humans().length, 0) });
    if (path === '/api/lobby') return json(res, 200, { states: lobby() });
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
      if (!isAdmin(req)) return json(res, 401, { error: 'Wrong admin key' });
      const route = path.slice('/api/admin/'.length);
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
      conn.profile = store.data.profiles[r.token] || (store.data.profiles[r.token] = newProfile(r.token, r.name));
      saveProfile();
      return send({ t: 'welcome', token: r.token, account: r.account, profile: profilePublic(conn.profile), lobby: lobby() });
    }
    if (!conn.profile) return;
    if (msg.t === 'lobby') return send({ t: 'lobby', states: lobby(), profile: profilePublic(conn.profile) });
    if (msg.t === 'join') {
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
      const match = matchFor(state, mode, key || `${mode}:${state}`, opts);
      const r = match.addHuman(ws, faction, conn.profile);
      if (r.error) return send({ t: 'joinError', error: r.error });
      conn.match = match;
      conn.player = r.player;
      send(match.info(r.player));
      match.syncMe(r.player);
      return;
    }
    if (msg.t === 'leave') {
      if (conn.match) conn.match.removePlayer(conn.player.id);
      conn.match = conn.player = null;
      return send({ t: 'lobby', states: lobby(), profile: profilePublic(conn.profile) });
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
}, 15000);
// Unique-viewer lists are bigger and change often: save them less frequently.
setInterval(() => ads.uniqueStore.save(), 120000);
setInterval(() => ads.housekeeping().catch((e) => console.error('ad housekeeping', e.message)), 60000);

async function shutdown() {
  await Promise.all([store.save(true), ads.store.save(true), ads.uniqueStore.save(true), advertisers.store.save(true)]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`${GAME.name} ${GAME.version} server on http://localhost:${PORT}  (game /ws, ad portal /advertise, admin /admin)`);
  console.log(`Storage: ${SUPABASE ? 'Supabase' : 'local files (set SUPABASE_URL + SUPABASE_SERVICE_KEY to keep data across restarts)'}. Payments: Paystack ${paystack.paystackMode()}.`);
  if (ADMIN_KEY === 'change-me') console.log('Set ADMIN_KEY before going live.');
});
