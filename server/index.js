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
import { AdManager } from './ads.js';
import { JsonStore } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT) || 2567;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';

// Ad walls per state (maps are deterministic, so count once at boot).
const slotCounts = {};
for (const s of STATES) slotCounts[s.id] = generateMap(s.id).adWalls.length;

const ads = new AdManager(slotCounts);
const store = new JsonStore('players.json', { profiles: {}, accounts: {} });
await ads.load();
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

async function readBody(req, limit = 4 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
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
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'image/png', 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' });
      return res.end(img);
    }
    if (path === '/admin') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(join(__dirname, 'admin.html')));
    }
    if (path.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Wrong admin key' });
      const route = path.slice('/api/admin/'.length);
      if (route === 'overview' && req.method === 'GET') {
        return json(res, 200, { states: STATES.map((s) => ({ id: s.id, name: s.name, walls: slotCounts[s.id] })), lobby: lobby(), ads: ads.ads });
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
  ads.uniqueStore.save();
}, 15000);

async function shutdown() {
  await store.save(true);
  await ads.store.save(true);
  await ads.uniqueStore.save(true);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`${GAME.name} ${GAME.version} server on http://localhost:${PORT}  (game /ws, advertiser dashboard /admin)`);
  if (ADMIN_KEY === 'change-me') console.log('Set ADMIN_KEY before going live.');
});
