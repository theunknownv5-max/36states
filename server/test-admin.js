// End-to-end test of the super admin panel API and push notifications: runs the real server,
// a stand-in Web Push service (which decrypts what it gets, like a browser would) and a game
// client over WebSocket. `npm run test:admin`
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createECDH, createPublicKey, hkdfSync, createDecipheriv, randomBytes, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptWebPush } from './push.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (cond, msg) => {
  if (cond) passed++;
  else {
    failed++;
    console.log('  ✗', msg);
  }
};
const section = (name) => console.log(`• ${name}`);
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// A browser's side of Web Push: its keys, and decryption (RFC 8291).
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  const pub = ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, keys: { p256dh: b64u(pub), auth: b64u(auth) } };
}
function decrypt(bk, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const ua = unb64u(bk.keys.p256dh);
  const secret = bk.ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, unb64u(bk.keys.auth), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  check(plain[end] === 2, 'last record ends with the 0x02 delimiter');
  return plain.subarray(0, end).toString();
}
function vapidOk(header, aud) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || '');
  if (!m) return false;
  const [h, p, s] = m[1].split('.');
  const pt = unb64u(m[2]);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pt.subarray(1, 33)), y: b64u(pt.subarray(33, 65)) }, format: 'jwk' });
  const claims = JSON.parse(unb64u(p).toString());
  return claims.aud === aud && claims.exp > Date.now() / 1000 && verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(s));
}

section('Web Push encryption (unit)');
{
  const bk = browserKeys();
  const text = JSON.stringify({ title: 'Double XP', body: 'All weekend 🔥' });
  const enc = encryptWebPush({ keys: bk.keys }, text);
  check(enc.readUInt32BE(16) === 4096 && enc[20] === 65, 'aes128gcm header (record size, key id length)');
  check(decrypt(bk, enc) === text, 'a browser can decrypt the message');
  const other = browserKeys();
  let threw = false;
  try {
    decrypt(other, enc);
  } catch {
    threw = true;
  }
  check(threw, 'another device cannot read it');
}

// ---------- stand-in push service ----------
const received = [];
const pushSrv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.includes('gone') ? 410 : 201);
    res.end();
  });
});
await new Promise((r) => pushSrv.listen(0, '127.0.0.1', r));
const PUSH = `http://127.0.0.1:${pushSrv.address().port}`;

// ---------- the real game server ----------
const PORT = 2900 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const proc = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ADMIN_KEY: 'superkey', DATA_DIR: mkdtempSync(join(tmpdir(), 'pod-admin-')), SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', PAYSTACK_SECRET_KEY: '', FIREBASE_SERVICE_ACCOUNT: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));
for (let i = 0; i < 100 && !/server on/.test(log); i++) await new Promise((r) => setTimeout(r, 150));
if (!/server on/.test(log)) throw new Error('server did not start:\n' + log);

const call = async (method, path, body, key = 'superkey') => {
  const r = await fetch(BASE + '/api/admin/' + path, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j = {};
  try {
    j = JSON.parse(text);
  } catch {
    j = { text };
  }
  return { code: r.status, ...j };
};

// A game client.
function client(hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  const c = {
    ws,
    got,
    closed: false,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor: (t, ms = 4000, pred = () => true) =>
      new Promise((res, rej) => {
        const start = Date.now();
        const iv = setInterval(() => {
          const i = got.findIndex((m) => m.t === t && pred(m));
          if (i >= 0) {
            clearInterval(iv);
            res(got.splice(i, 1)[0]);
          } else if (Date.now() - start > ms) {
            clearInterval(iv);
            rej(new Error(`no ${t}`));
          }
        }, 20);
      })
  };
  ws.onclose = () => (c.closed = true);
  c.ready = new Promise((r) => (ws.onopen = r)).then(() => c.send({ t: 'hello', ...hello }));
  return c;
}

try {
  section('Access');
  check((await call('GET', 'me', undefined, null)).code === 401, 'no key: refused');
  check((await call('GET', 'me', undefined, 'wrong')).code === 401, 'wrong key: refused');
  const me = await call('GET', 'me');
  check(me.role === 'super', 'ADMIN_KEY is the owner (super)');

  section('Player signs in and turns on notifications');
  const ada = client({ name: 'Ada' });
  await ada.ready;
  const wel = await ada.waitFor('welcome');
  check(!!wel.push?.vapid && wel.push.on === false && wel.push.fcm === false, 'welcome carries the push key and state');
  check(Array.isArray(wel.control?.notices) && wel.control.maintenance === null, 'welcome carries news and maintenance state');
  const bk = browserKeys();
  ada.send({ t: 'pushSub', kind: 'web', sub: { endpoint: `${PUSH}/dev/ada`, keys: bk.keys } });
  check((await ada.waitFor('pushState')).on === true, 'push subscription saved');
  ada.send({ t: 'pushSub', kind: 'web', sub: { endpoint: `${PUSH}/dev/x` } });
  check((await ada.waitFor('pushState')).on === false, 'a broken subscription is refused');
  // A second, dead device of hers.
  const bk2 = browserKeys();
  ada.send({ t: 'pushSub', kind: 'web', sub: { endpoint: `${PUSH}/gone/old-phone`, keys: bk2.keys } });
  await ada.waitFor('pushState');
  const dash = await call('GET', 'dashboard');
  check(dash.push?.web === 2 && dash.push.players === 1, 'dashboard counts push devices');
  check(typeof dash.today === 'object' || typeof dash.kpis === 'object' || dash.code === 200, 'dashboard answers');

  section('Push + in-app notification to everyone');
  const n = await call('POST', 'notify', { title: 'Update don land', body: 'New guns for Lagos', url: '/', target: 'all' });
  check(n.sent === 1 && n.failed === 1 && n.inApp === 1, `one device got it, the dead one failed, one in-app (${JSON.stringify(n)})`);
  const got = received.find((r) => r.path === '/dev/ada');
  check(!!got && got.headers['content-encoding'] === 'aes128gcm', 'push service got an encrypted message');
  check(got && vapidOk(got.headers.authorization, PUSH), 'VAPID signature is valid for the push service');
  const payload = got ? JSON.parse(decrypt(bk, got.body)) : {};
  check(payload.title === 'Update don land' && payload.body === 'New guns for Lagos', 'the phone decrypts the right title and message');
  const live = await ada.waitFor('notice');
  check(live.title === 'Update don land' && !!live.id, 'player online sees it in the game too');
  check((await call('GET', 'dashboard')).push.web === 1, 'the dead device (410) is removed');
  const hist = await call('GET', 'notify');
  check(hist.history?.[0]?.title === 'Update don land', 'notification history kept');
  check((await call('POST', 'notify', { title: '', body: '' })).code === 400, 'empty notification refused');

  section('Players');
  const list = await call('GET', 'players?q=ada');
  const row = list.players?.[0];
  check(row?.name === 'Ada' && row.online === true, 'search finds the player, online');
  const pid = row.pid;
  const detail = await call('GET', `players/${pid}`);
  check(detail.pushDevices === 1 && detail.name === 'Ada', 'player detail');
  await call('POST', `players/${pid}/grant`, { gems: 5, xp: 300, note: 'Thanks' });
  const gift = await ada.waitFor('notice', 4000, (m) => /Gift/.test(m.title));
  check(/\+5 💎/.test(gift.body), 'gift arrives in the game');
  check((await call('GET', `players/${pid}`)).gems >= 5, 'gems added');
  check((await call('POST', `players/${pid}/grant`, { gems: 99999 })).code === 400, 'huge grant refused');
  await call('POST', `players/${pid}/mute`, { hours: 1 });
  check((await call('GET', 'players?filter=muted')).players.some((p) => p.pid === pid), 'mute shows in the muted filter');
  await call('POST', `players/${pid}/unmute`);
  await call('POST', `players/${pid}/rename`, { name: 'Ada Lagos' });
  check((await call('GET', `players/${pid}`)).name === 'Ada Lagos', 'rename');
  await call('POST', `players/${pid}/message`, { title: 'Hi Ada', body: 'Thanks for playing' });
  check((await ada.waitFor('notice', 4000, (m) => m.title === 'Hi Ada')).body === 'Thanks for playing', 'direct message reaches the player');
  const csv = await call('GET', 'export/players.csv');
  check(/Ada Lagos/.test(csv.text || ''), 'CSV export');

  section('Ban and unban');
  await call('POST', `players/${pid}/ban`, { reason: 'Cheating', hours: 24 });
  await new Promise((r) => setTimeout(r, 300));
  check(ada.closed, 'banned player is disconnected');
  const again = client({ name: 'Ada', token: wel.token });
  await again.ready;
  const ae = await again.waitFor('authError');
  check(ae.banned && /Cheating/.test(ae.error), 'banned player cannot come back');
  check((await call('GET', 'players?filter=banned')).players.length === 1, 'banned filter');
  await call('POST', `players/${pid}/unban`);
  const ok = client({ name: 'Ada', token: wel.token });
  await ok.ready;
  check((await ok.waitFor('welcome')).profile.name === 'Ada Lagos', 'unbanned player is back with the new name');

  section('Game settings');
  const cfg = await call('GET', 'config');
  check(cfg.tunables?.some((t) => t.key === 'HEALTH.regenPerSec'), 'tunables listed');
  await call('PUT', 'config', { overrides: { 'HEALTH.regenPerSec': 12 } });
  check((await call('GET', 'config')).tunables.find((t) => t.key === 'HEALTH.regenPerSec').value === 12, 'tunable changed live');
  check((await call('PUT', 'config', { overrides: { 'HEALTH.regenPerSec': 999 } })).code >= 400, 'out-of-range value refused');
  await call('PUT', 'config', { overrides: { 'HEALTH.regenPerSec': null } });
  check((await call('GET', 'config')).tunables.find((t) => t.key === 'HEALTH.regenPerSec').value === 14, 'reset to default');
  await call('PUT', 'config', { event: { name: 'Double XP', xpMult: 2, moneyMult: 1, hours: 24 } });
  const ctl = await ok.waitFor('control', 4000, (m) => !!m.event);
  check(ctl.event?.xpMult === 2, 'event reaches players live');
  await call('PUT', 'announcement', { text: 'Server go restart by 9pm', hours: 2 });
  check((await ok.waitFor('control', 4000, (m) => !!m.announcement)).announcement.text === 'Server go restart by 9pm', 'announcement reaches players live');
  await call('POST', 'broadcast', { text: 'Hello soldiers' });
  check((await ok.waitFor('broadcast')).text === 'Hello soldiers', 'broadcast');
  await call('PUT', 'config', { maintenance: { on: true, message: 'Upgrade dey go on' } });
  check((await ok.waitFor('control', 4000, (m) => !!m.maintenance)).maintenance === 'Upgrade dey go on', 'maintenance reaches players');
  ok.send({ t: 'join', state: 'lagos', faction: 'police', mode: 'tdm' });
  check((await ok.waitFor('joinError')).error === 'Upgrade dey go on', 'nobody can start a battle in maintenance');
  await call('PUT', 'config', { maintenance: { on: false } });
  await call('PUT', 'config', { minBuild: 50, updateUrl: 'https://example.com/pod.apk' });
  const old = client({ name: 'Old Phone', app: true, build: 10 });
  await old.ready;
  check((await old.waitFor('welcome')).needUpdate === true, 'old app build is asked to update');
  const fresh = client({ name: 'New Phone', app: true, build: 60 });
  await fresh.ready;
  check(!(await fresh.waitFor('welcome')).needUpdate, 'new app build is fine');
  const web = client({ name: 'Browser' });
  await web.ready;
  check(!(await web.waitFor('welcome')).needUpdate, 'website players are never asked to update');

  section('Team roles and audit');
  const mod = await call('POST', 'team', { name: 'Kemi', role: 'moderator' });
  check(/^pod_/.test(mod.admin?.key || '') && !mod.admin.keyHash, 'moderator key shown once, no hash leaked');
  const mk = await call('POST', 'team', { name: 'Obi', role: 'marketing' });
  check((await call('GET', 'me', undefined, mod.admin.key)).role === 'moderator', 'moderator signs in with own key');
  check((await call('GET', 'players', undefined, mod.admin.key)).code === 200, 'moderator can see players');
  check((await call('PUT', 'config', { minBuild: 0 }, mod.admin.key)).code === 403, 'moderator cannot change game settings');
  check((await call('POST', `players/${pid}/grant`, { gems: 1 }, mod.admin.key)).code === 403, 'moderator cannot give gems');
  check((await call('GET', 'overview', undefined, mod.admin.key)).code === 403, 'moderator cannot see ad money');
  check((await call('GET', 'team', undefined, mod.admin.key)).code === 403, 'moderator cannot manage the team');
  check((await call('GET', 'players', undefined, mk.admin.key)).code === 403, 'marketing cannot see players');
  check((await call('POST', 'broadcast', { text: 'x' }, mk.admin.key)).code === 200, 'marketing can broadcast');
  check((await call('GET', 'overview', undefined, mk.admin.key)).code === 200, 'marketing can see ads');
  const team = await call('GET', 'team');
  check(team.admins.length === 2 && team.admins.every((a) => !a.keyHash), 'team list (no key hashes)');
  check(team.audit.some((a) => /ban/.test(a.action)) && team.audit.some((a) => /admin added/.test(a.action)), 'audit log records bans and team changes');
  await call('DELETE', `team/${mod.admin.id}`);
  check((await call('GET', 'me', undefined, mod.admin.key)).code === 401, 'removed member is locked out');

  section('Reports and moderation');
  check((await call('GET', 'reports')).code === 200, 'reports list');
  check((await call('GET', 'chat')).code === 200, 'chat log');
  check((await call('GET', 'conversations')).code === 200, 'business conversations');
  check((await call('GET', 'battles')).code === 200, 'live battles');
  await call('PUT', 'config', { minBuild: 0, event: null });
  await call('PUT', 'announcement', { text: '' });
  await call('POST', `players/${pid}/delete`);
  check((await call('GET', `players/${pid}`)).code === 404, 'delete player');
  for (const c of [ada, again, ok, old, fresh, web]) c.ws.close();
} catch (e) {
  failed++;
  console.log('  ✗ crashed:', e.message);
  console.log(log.slice(-2000));
} finally {
  proc.kill('SIGTERM');
  pushSrv.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
