// End-to-end test of the paid ad portal: runs the real server against stand-in Paystack and
// Supabase servers, then books, pays, approves, rejects/refunds and restarts. `npm run test:ads`
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'sk_test_pod_mock';
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

// ---------- a real (tiny-file) PNG of any size ----------
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 0x80);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (w, h) => 'data:image/png;base64,' + png(w, h).toString('base64');

// ---------- stand-in Paystack + Supabase ----------
const db = new Map();
const objects = new Map();
let bucket = null;
const txs = new Map();
const refunds = [];
const stripeSessions = new Map();
const stripeRefunds = [];
const STRIPE_KEY = 'sk_test_stripe_mock';
const STRIPE_HOOK = 'whsec_mock';
let badKeyHeader = 0;
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  const send = (code, obj, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
  };
  const p = url.pathname;
  // Paystack
  if (p.startsWith('/transaction') || p.startsWith('/refund') || p.startsWith('/pay/')) {
    if (!p.startsWith('/pay/') && req.headers.authorization !== `Bearer ${SECRET}`) return send(401, { status: false, message: 'Invalid key' });
    if (p === '/transaction/initialize') {
      const b = JSON.parse(body);
      txs.set(b.reference, { ...b, status: 'abandoned' });
      return send(200, { status: true, data: { authorization_url: `${MOCK}/pay/${b.reference}`, reference: b.reference } });
    }
    if (p.startsWith('/pay/')) {
      const ref = decodeURIComponent(p.slice(5));
      const t = txs.get(ref);
      if (t) t.status = 'success';
      return send(200, { ok: !!t });
    }
    if (p.startsWith('/transaction/verify/')) {
      const ref = decodeURIComponent(p.slice('/transaction/verify/'.length));
      const t = txs.get(ref);
      if (!t) return send(400, { status: false, message: 'Transaction reference not found' });
      return send(200, { status: true, data: { reference: ref, status: t.status, amount: t.amount, currency: t.currency, channel: 'card' } });
    }
    if (p === '/refund') {
      refunds.push(JSON.parse(body));
      return send(200, { status: true, data: { status: 'pending', id: refunds.length } });
    }
  }
  // Stripe
  if (p.startsWith('/v1/') || p.startsWith('/checkout/')) {
    if (p.startsWith('/checkout/')) {
      const cs = stripeSessions.get(p.slice(10));
      if (cs) cs.payment_status = 'paid';
      return send(200, { ok: !!cs });
    }
    if (req.headers.authorization !== `Bearer ${STRIPE_KEY}`) return send(401, { error: { message: 'Invalid API key' } });
    const f = new URLSearchParams(body.toString());
    if (p === '/v1/checkout/sessions' && req.method === 'POST') {
      const id = `cs_test_${stripeSessions.size + 1}`;
      const cs = { id, url: `${MOCK}/checkout/${id}`, client_reference_id: f.get('client_reference_id'), amount_total: Number(f.get('line_items[0][price_data][unit_amount]')), currency: f.get('line_items[0][price_data][currency]'), payment_status: 'unpaid', payment_intent: `pi_${id}`, success_url: f.get('success_url'), email: f.get('customer_email') };
      stripeSessions.set(id, cs);
      return send(200, cs);
    }
    if (p.startsWith('/v1/checkout/sessions/')) {
      const cs = stripeSessions.get(decodeURIComponent(p.slice(22)));
      return cs ? send(200, cs) : send(404, { error: { message: 'No such session' } });
    }
    if (p === '/v1/refunds') {
      stripeRefunds.push(Object.fromEntries(f));
      return send(200, { id: `re_${stripeRefunds.length}`, status: 'pending' });
    }
  }
  // Supabase
  if (req.headers.apikey !== 'sb_secret_mock' && !p.includes('/object/public/')) badKeyHeader++;
  if (p === '/rest/v1/pod_store' && req.method === 'GET') {
    const key = url.searchParams.get('key').replace(/^eq\./, '');
    return send(200, db.has(key) ? [{ value: db.get(key) }] : []);
  }
  if (p === '/rest/v1/pod_store' && req.method === 'POST') {
    const row = JSON.parse(body);
    db.set(row.key, row.value);
    return send(201, '');
  }
  if (p === '/storage/v1/bucket/pod-ads' && req.method === 'GET') return bucket ? send(200, bucket) : send(404, { error: 'not found' });
  if (p === '/storage/v1/bucket' && req.method === 'POST') {
    bucket = JSON.parse(body);
    return send(200, { name: bucket.name });
  }
  let m = /^\/storage\/v1\/object\/(public\/)?pod-ads\/(.+)$/.exec(p);
  if (m) {
    if (req.method === 'POST') {
      objects.set(m[2], { body, type: req.headers['content-type'] });
      return send(200, { Key: m[2] });
    }
    if (req.method === 'DELETE') {
      objects.delete(m[2]);
      return send(200, {});
    }
    const o = objects.get(m[2]);
    return o ? send(200, o.body, o.type) : send(404, { error: 'not found' });
  }
  send(404, { error: `mock: no route ${req.method} ${p}` });
});
await new Promise((r) => mock.listen(0, r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;

// ---------- the real game server ----------
const PORT = 2700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
async function startServer() {
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ADMIN_KEY: 'adminkey', DATA_DIR: mkdtempSync(join(tmpdir(), 'pod-ads-')), SUPABASE_URL: MOCK, SUPABASE_SERVICE_KEY: 'sb_secret_mock', PAYSTACK_BASE: MOCK, PAYSTACK_SECRET_KEY: SECRET, STRIPE_BASE: MOCK, STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: STRIPE_HOOK, PUBLIC_URL: 'https://pod.example' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (/server on/.test(log)) return;
    if (proc.exitCode !== null) break;
  }
  throw new Error('server did not start:\n' + log);
}
async function stopServer() {
  proc.kill('SIGTERM');
  await new Promise((r) => proc.on('exit', r));
}
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { code: r.status, ...j };
};
const admin = { 'x-admin-key': 'adminkey' };

try {
  await startServer();
  section('Setup');
  const cfg = await call('GET', '/api/adv/config');
  check(cfg.payments === 'test' && cfg.storage === 'supabase', `portal reports test payments and Supabase storage (${cfg.payments}, ${cfg.storage})`);
  check(bucket?.public === true, 'public image bucket created automatically');
  const html = await fetch(BASE + '/advertise');
  check(html.ok && (await html.text()).includes('Proof of Duty'), 'portal page is served');
  const js = await fetch(BASE + '/shared/billboards.js');
  check(js.ok && (await js.text()).includes('export function quote'), 'pricing module is served to the portal');
  const lag = await call('GET', '/api/adv/boards?state=lagos');
  const sky = lag.boards.find((b) => b.type === 'sky');
  const led = lag.boards.find((b) => b.type === 'led');
  const wall = lag.boards.find((b) => b.type === 'wall');
  check(sky && led && wall && lag.map.sites.length === 3, 'Lagos lists sky, LED and wall billboards with a map outline');

  section('Accounts');
  check((await call('POST', '/api/adv/register', { email: 'bad', password: 'password1', business: 'X', phone: '08030000000' })).error, 'invalid email refused');
  const reg = await call('POST', '/api/adv/register', { email: 'chidi@example.com', password: 'jollof-2026', business: 'Mama Chidi Kitchen', phone: '0803 000 1111' });
  check(reg.token && reg.account.business === 'Mama Chidi Kitchen', 'advertiser registers');
  check((await call('POST', '/api/adv/register', { email: 'chidi@example.com', password: 'jollof-2026', business: 'Again', phone: '08030001111' })).error, 'duplicate email refused');
  check((await call('POST', '/api/adv/login', { email: 'chidi@example.com', password: 'wrong-pass' })).error, 'wrong password refused');
  const login = await call('POST', '/api/adv/login', { email: 'CHIDI@example.com', password: 'jollof-2026' });
  check(!!login.token, 'login works (email not case-sensitive)');
  const auth = { authorization: `Bearer ${login.token}` };
  check((await call('GET', '/api/adv/me')).code === 401, 'bookings need login');

  section('Pricing and checks');
  const q = await call('POST', '/api/adv/quote', { boardId: sky.id, days: 7, exclusive: false, startDay: cfg.today });
  const expect = Math.round((25000 * 1.5 * 7 * 0.9) / 100) * 100;
  check(q.quote.total === expect && q.quote.discountPct === 10, `7 days on a Lagos sky billboard: ₦${q.quote.total} (expected ₦${expect}, 10% off)`);
  const qx = await call('POST', '/api/adv/quote', { boardId: sky.id, days: 7, exclusive: true, startDay: cfg.today });
  check(qx.quote.total === Math.round((25000 * 1.5 * 3 * 7 * 0.9) / 100) * 100, 'exclusive costs 3 slots');
  check((await call('POST', '/api/adv/quote', { boardId: sky.id, days: 7, startDay: '2020-01-01' })).error, 'past start date refused');
  check((await call('POST', '/api/adv/bookings', { boardId: sky.id, days: 3, startDay: cfg.today, imageDataUrl: dataUrl(1280, 720) }, auth)).error?.includes('too small'), 'image below HD minimum refused');
  check((await call('POST', '/api/adv/bookings', { boardId: sky.id, days: 3, startDay: cfg.today, imageDataUrl: dataUrl(2000, 2000) }, auth)).error?.includes('16:9'), 'wrong shape refused');
  check((await call('POST', '/api/adv/bookings', { boardId: sky.id, days: 3, startDay: cfg.today, imageDataUrl: dataUrl(5120, 2880) }, auth)).error?.includes('too large'), 'oversized image refused');

  section('Book and pay');
  const bk = await call('POST', '/api/adv/bookings', { boardId: sky.id, days: 7, startDay: cfg.today, imageDataUrl: dataUrl(1920, 1080), link: 'https://example.com', title: 'Party Jollof' }, auth);
  check(bk.authorization_url?.startsWith(MOCK + '/pay/') && bk.booking.status === 'unpaid', 'booking created and sent to Paystack checkout');
  const tx = txs.get(bk.reference);
  check(tx && tx.amount === expect * 100 && tx.currency === 'NGN' && tx.callback_url === `https://pod.example/advertise?paid=${encodeURIComponent(bk.reference)}`, 'Paystack gets the right kobo amount, NGN and callback');
  check([...objects.keys()].length === 1, 'artwork stored in Supabase Storage');
  const early = await call('GET', `/api/adv/verify?reference=${bk.reference}`);
  check(early.error, 'not marked paid before paying');
  await fetch(bk.authorization_url);
  const ver = await call('GET', `/api/adv/verify?reference=${bk.reference}`);
  check(ver.booking?.status === 'review', `paid booking waits for review (${ver.booking?.status})`);
  // Webhook: forged signature refused, real one accepted (and idempotent).
  const evt = JSON.stringify({ event: 'charge.success', data: { reference: bk.reference } });
  check((await call('POST', '/api/paystack/webhook', evt, { 'x-paystack-signature': 'nope' })).code === 401, 'forged webhook refused');
  const sig = createHmac('sha512', SECRET).update(evt).digest('hex');
  check((await call('POST', '/api/paystack/webhook', evt, { 'x-paystack-signature': sig })).ok, 'signed webhook accepted');
  let feed = await call('GET', '/api/ads?state=lagos');
  check(!feed.slots[sky.id], 'not shown in the game before approval');

  section('Availability');
  check((await call('POST', '/api/adv/quote', { boardId: sky.id, days: 3, exclusive: true, startDay: cfg.today })).availability.ok === false, 'cannot book exclusive over a shared booking');
  const ledBookings = [];
  for (let i = 0; i < 4; i++) ledBookings.push(await call('POST', '/api/adv/bookings', { boardId: led.id, days: 2, startDay: cfg.today, imageDataUrl: dataUrl(1280, 720) }, auth));
  check(ledBookings.every((b) => b.authorization_url), 'four advertisers can share one LED screen');
  check((await call('POST', '/api/adv/bookings', { boardId: led.id, days: 2, startDay: cfg.today, imageDataUrl: dataUrl(1280, 720) }, auth)).error?.includes('booked'), 'a fifth is refused when all slots are taken');
  const cancel = await call('POST', `/api/adv/bookings/${ledBookings[3].booking.id}/cancel`, {}, auth);
  check(cancel.ok, 'unpaid booking can be cancelled');

  section('Admin review');
  const ov = await call('GET', '/api/admin/overview', undefined, admin);
  check(ov.ads.some((a) => a.id === bk.booking.id && a.liveStatus === 'review'), 'admin sees the booking waiting for review');
  const ap = await call('POST', `/api/admin/bookings/${bk.booking.id}/approve`, {}, admin);
  check(ap.ad?.status === 'approved', 'admin approves');
  feed = await call('GET', '/api/ads?state=lagos');
  const slot = feed.slots[sky.id]?.[0];
  check(slot && slot.image.startsWith(`${MOCK}/storage/v1/object/public/pod-ads/`), 'live in the game, served from the public CDN URL');
  check((await fetch(slot.image)).ok, 'artwork downloadable from storage');
  check(feed.rotateMs === 12000, 'rotation clock sent to clients');
  // Second booking on the same sky board: paid, then rejected with refund.
  const bk2 = await call('POST', '/api/adv/bookings', { boardId: sky.id, days: 1, startDay: cfg.today, imageDataUrl: dataUrl(1920, 1080) }, auth);
  await fetch(bk2.authorization_url);
  await call('GET', `/api/adv/verify?reference=${bk2.reference}`);
  const rj = await call('POST', `/api/admin/bookings/${bk2.booking.id}/reject`, { reason: 'Artwork breaks the rules' }, admin);
  check(rj.ad?.status === 'rejected' && refunds.at(-1)?.transaction === bk2.reference, 'reject refunds through Paystack');
  const me = await call('GET', '/api/adv/me', undefined, auth);
  check(me.bookings.find((b) => b.id === bk2.booking.id)?.rejectReason === 'Artwork breaks the rules', 'advertiser sees why it was rejected');
  check(me.bookings.find((b) => b.id === bk.booking.id)?.status === 'live', 'advertiser sees the approved booking live');
  const pr = await call('PUT', '/api/admin/pricing', { ...ov.pricing, daily: { ...ov.pricing.daily, wall: 6000 } }, admin);
  check(pr.pricing?.daily.wall === 6000, 'admin can change prices');
  check((await call('GET', '/api/admin/overview')).code === 401, 'admin API needs the admin key');

  section('Countries: regions, targeted adverts, Stripe outside Africa');
  check(cfg.countries.length > 200 && cfg.countries.find((c) => c.cc === 'GH')?.pay === 'paystack' && cfg.countries.find((c) => c.cc === 'US')?.pay === 'stripe', 'portal lists every country with its payment provider');
  check(cfg.payMethods?.stripe === 'test' && cfg.payMethods?.paystack === 'test', 'both payment providers are on (test mode)');
  const usr = await call('GET', '/api/adv/regions?cc=US');
  check(usr.pay === 'stripe' && usr.regions.some((r) => r.id === 'us.texas'), 'regions of a country (United States)');
  const tx2 = await call('GET', '/api/adv/boards?state=us.texas');
  const txSky = tx2.boards?.find((b) => b.type === 'sky');
  check(!!txSky && tx2.map.sites.length === 3, 'billboards in Texas are built on first use');
  const uq = await call('POST', '/api/adv/quote', { boardId: txSky.id, days: 2, startDay: cfg.today });
  check(uq.quote.provider === 'stripe' && uq.quote.usd === Math.max(5, Math.ceil(uq.quote.total / 1550)), `Texas is paid in dollars with Stripe ($${uq.quote.usd})`);
  const ghr = await call('GET', '/api/adv/regions?cc=GH');
  const gh = await call('GET', `/api/adv/boards?state=${ghr.regions[0].id}`);
  const gq = await call('POST', '/api/adv/quote', { boardId: gh.boards[0].id, days: 2, startDay: cfg.today });
  check(gq.quote.provider === 'paystack', 'Ghana is paid with Paystack');
  const sb = await call('POST', '/api/adv/bookings', { boardId: txSky.id, days: 2, startDay: cfg.today, imageDataUrl: dataUrl(1920, 1080), title: 'Texas BBQ' }, auth);
  const cs = [...stripeSessions.values()].at(-1);
  check(sb.authorization_url === cs?.url && cs.amount_total === uq.quote.usd * 100 && cs.currency === 'usd' && cs.email === 'chidi@example.com', 'booking goes to Stripe Checkout with the dollar amount');
  check(cs.success_url === `https://pod.example/advertise?paid=${encodeURIComponent(sb.reference)}`, 'Stripe sends the advertiser back to the portal');
  check((await call('GET', `/api/adv/verify?reference=${sb.reference}`)).error, 'not paid before checkout completes');
  await fetch(sb.authorization_url);
  const sv = await call('GET', `/api/adv/verify?reference=${sb.reference}`);
  check(sv.booking?.status === 'review' && sv.booking.provider === 'stripe', 'paid by card, waiting for review');
  const sevt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: sb.reference } } });
  const t = Math.floor(Date.now() / 1000);
  const ssig = `t=${t},v1=${createHmac('sha256', STRIPE_HOOK).update(`${t}.${sevt}`).digest('hex')}`;
  check((await call('POST', '/api/stripe/webhook', sevt, { 'stripe-signature': `t=${t},v1=bad` })).code === 401, 'forged Stripe webhook refused');
  check((await call('POST', '/api/stripe/webhook', sevt, { 'stripe-signature': ssig })).received, 'signed Stripe webhook accepted');
  const srj = await call('POST', `/api/admin/bookings/${sb.booking.id}/reject`, { reason: 'Wrong size text' }, admin);
  check(srj.ad?.status === 'rejected' && stripeRefunds.at(-1)?.payment_intent === cs.payment_intent, 'reject refunds through Stripe');
  // A house advert for one whole country shows there and nowhere else.
  const house = await call('POST', '/api/admin/ads', { advertiser: 'Ghana Malt', title: 'Ghana only', imageDataUrl: dataUrl(1920, 1080), states: ['country:gh'], start: cfg.today, end: cfg.today }, admin);
  check(house.ad?.states?.[0] === 'country:GH', 'admin can target a whole country');
  const ghFeed = await call('GET', `/api/ads?state=${ghr.regions[0].id}`);
  const usFeed = await call('GET', '/api/ads?state=us.texas');
  const has = (f) => Object.values(f.slots || {}).some((l) => l.some((x) => x.adId === house.ad.id));
  check(has(ghFeed) && !has(usFeed), 'country advert shows in Ghana, not in Texas');
  const w = await fetch(BASE + '/api/world/gh');
  const wj = await w.json();
  check(w.ok && wj.cc === 'GH' && wj.regions.length > 5 && wj.regions[0].poly, 'country map data served to the apps');
  check((await fetch(BASE + '/api/world/zz1')).status === 404 && (await fetch(BASE + '/api/world/qq')).status === 404, 'world endpoint only serves country files');

  section('Players chat with the business');
  {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const got = [];
    const waitFor = (t, ms = 4000) =>
      new Promise((res, rej) => {
        const start = Date.now();
        const iv = setInterval(() => {
          const i = got.findIndex((m) => m.t === t);
          if (i >= 0) {
            clearInterval(iv);
            res(got.splice(i, 1)[0]);
          } else if (Date.now() - start > ms) {
            clearInterval(iv);
            rej(new Error(`no ${t}`));
          }
        }, 20);
      });
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ t: 'hello', mode: 'guest', name: 'Sgt Tunde' }));
    const wel = await waitFor('welcome');
    check(wel.inboxUnread === 0 && wel.daily?.missions?.length === 3, 'welcome carries inbox count and three daily missions');
    const slotAd = (await call('GET', '/api/ads?state=lagos')).slots[sky.id][0];
    check(slotAd.chat === true, 'paid adverts are marked as chat-able for the game');
    ws.send(JSON.stringify({ t: 'adChatOpen', adId: slotAd.adId }));
    const open = await waitFor('adChat');
    check(open.ok && open.ad.business === 'Mama Chidi Kitchen', 'player opens a chat from the billboard');
    ws.send(JSON.stringify({ t: 'adMsg', adId: slotAd.adId, text: 'How much be one plate of jollof?' }));
    const th = await waitFor('thread');
    check(th.thread.msgs.length === 1 && th.thread.msgs[0].me, 'message saved to the conversation');
    ws.send(JSON.stringify({ t: 'adMsg', adId: slotAd.adId, text: 'too fast' }));
    check((await waitFor('adChatError')).error, 'players are rate-limited');
    const ib = await call('GET', '/api/adv/inbox', undefined, auth);
    check(ib.unread === 1 && ib.threads[0].player === 'Sgt Tunde' && !JSON.stringify(ib).includes(wel.token), 'business sees the soldier name only (no player token)');
    const rep = await call('POST', `/api/adv/inbox/${ib.threads[0].id}/reply`, { text: 'N1,500 boss. Order: https://example.com/order' }, auth);
    check(rep.thread?.msgs.length === 2, 'business replies from the portal');
    const note = await waitFor('inboxNew');
    check(note.unread === 1 && note.thread.msgs[1].text.includes('1,500') && !note.thread.msgs[1].me, 'reply pushed live to the player');
    ws.send(JSON.stringify({ t: 'inbox' }));
    const box = await waitFor('inbox');
    check(box.threads.length === 1 && !JSON.stringify(box).includes('chidi@example.com'), "player's inbox lists it without the business's email");
    await call('POST', `/api/adv/inbox/${ib.threads[0].id}/block`, {}, auth);
    await new Promise((r) => setTimeout(r, 1300));
    ws.send(JSON.stringify({ t: 'adMsg', threadId: ib.threads[0].id, text: 'hello?' }));
    check((await waitFor('adChatError')).error.includes('no longer accepting'), 'business can block a player');
    ws.send(JSON.stringify({ t: 'dailyClaim' }));
    const d1 = await waitFor('daily');
    check(d1.claimed?.reward?.gems === 1 && d1.profile.gems === wel.profile.gems + 1, 'daily login reward: day 1 gives a gem');
    ws.send(JSON.stringify({ t: 'dailyClaim' }));
    check((await waitFor('daily')).claimed === null, 'daily reward only once per day');
    ws.close();
  }

  section('Survives a restart');
  const meBefore = await call('GET', '/api/adv/me', undefined, auth);
  await stopServer();
  await startServer();
  const me2 = await call('GET', '/api/adv/me', undefined, auth);
  check(me2.bookings?.length === meBefore.bookings.length, 'accounts, sessions and bookings reloaded from Supabase');
  check((await call('GET', '/api/adv/inbox', undefined, auth)).threads?.length === 1, 'conversations kept');
  feed = await call('GET', '/api/ads?state=lagos');
  check(!!feed.slots[sky.id], 'live advert still on its billboard after restart');
  check((await call('GET', '/api/adv/config')).pricing.daily.wall === 6000, 'prices kept');
  check(badKeyHeader === 0, 'every Supabase call sends the apikey header');
} catch (e) {
  failed++;
  console.log('  ✗ crashed:', e.message);
} finally {
  if (proc && proc.exitCode === null) await stopServer();
  mock.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
