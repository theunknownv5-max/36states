// Push notifications, with no extra packages:
//  - Web Push (browsers, Android Chrome, desktop): VAPID (ES256) + RFC 8291 aes128gcm
//    encryption, implemented with Node's crypto. Keys are made once and stored.
//  - Android app: Firebase Cloud Messaging (HTTP v1) when FIREBASE_SERVICE_ACCOUNT is set
//    (the service-account JSON from Firebase) and the app was built with google-services.json.
// Players turn notifications on or off in Settings; the admin panel sends them.
import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, hkdfSync, createCipheriv, sign, createSign } from 'node:crypto';
import { JsonStore } from './store.js';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function encryptWebPush(sub, payload) {
  const ua = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const secret = ecdh.computeSecret(ua);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

export class Push {
  constructor() {
    this.store = new JsonStore('push.json', { vapid: null, subs: {}, history: [] });
    this.fcmToken = null;
  }

  async load() {
    await this.store.load();
    const d = this.store.data;
    d.subs ||= {};
    d.history ||= [];
    if (!d.vapid) {
      const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      d.vapid = { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateJwk: privateKey.export({ format: 'jwk' }) };
      this.store.markDirty();
      this.store.save();
    }
  }

  get publicKey() {
    return this.store.data.vapid.publicKey;
  }

  fcmReady() {
    return !!process.env.FIREBASE_SERVICE_ACCOUNT;
  }

  // A player's device: { kind: 'web', sub } or { kind: 'fcm', token }.
  subscribe(playerToken, device) {
    const list = (this.store.data.subs[playerToken] ||= []);
    const key = device.kind === 'web' ? device.sub?.endpoint : device.token;
    if (!key || String(key).length > 2000) throw new Error('Bad subscription');
    if (device.kind === 'web' && !(device.sub?.keys?.p256dh && device.sub?.keys?.auth)) throw new Error('Bad subscription');
    if (!list.some((d) => (d.kind === 'web' ? d.sub.endpoint : d.token) === key)) list.push({ ...device, at: Date.now() });
    if (list.length > 5) list.splice(0, list.length - 5);
    this.store.markDirty();
  }

  unsubscribe(playerToken) {
    delete this.store.data.subs[playerToken];
    this.store.markDirty();
  }

  count() {
    let web = 0;
    let fcm = 0;
    for (const list of Object.values(this.store.data.subs)) for (const d of list) d.kind === 'web' ? web++ : fcm++;
    return { players: Object.keys(this.store.data.subs).length, web, fcm };
  }

  vapidAuth(endpoint) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.PUSH_CONTACT || 'mailto:admin@proofofduty.game' }));
    const key = createPrivateKey({ key: this.store.data.vapid.privateJwk, format: 'jwk' });
    const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${head}.${body}.${b64u(sig)}, k=${this.publicKey}`;
  }

  async sendWeb(sub, payload) {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal', authorization: this.vapidAuth(sub.endpoint) },
      body: encryptWebPush(sub, payload)
    });
    return r.status;
  }

  // OAuth token for FCM from the service account (RS256 JWT exchange).
  async fcmAccess() {
    if (this.fcmToken && this.fcmToken.exp > Date.now() + 60000) return this.fcmToken;
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const tokenUri = process.env.FCM_TOKEN_URI || sa.token_uri || 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUri, iat: now, exp: now + 3600 }));
    const s = createSign('RSA-SHA256');
    s.update(`${head}.${claim}`);
    const jwt = `${head}.${claim}.${b64u(s.sign(sa.private_key))}`;
    const r = await fetch(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}` });
    const j = await r.json();
    if (!r.ok) throw new Error(`FCM auth failed: ${j.error_description || r.status}`);
    this.fcmToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, project: sa.project_id };
    return this.fcmToken;
  }

  async sendFcm(token, msg) {
    const a = await this.fcmAccess();
    const base = process.env.FCM_BASE || 'https://fcm.googleapis.com';
    const r = await fetch(`${base}/v1/projects/${a.project}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { url: msg.url || '' }, android: { priority: 'high', notification: { channel_id: 'pod', icon: 'ic_launcher' } } } })
    });
    return r.status;
  }

  // Send to some players (tokens) or everyone subscribed. Dead subscriptions are dropped.
  async send({ title, body, url, image }, targets = null) {
    const payload = JSON.stringify({ title, body, url: url || '/', icon: '/img/icon-192.png', image: image || undefined });
    const subs = this.store.data.subs;
    const tokens = targets ? targets.filter((t) => subs[t]) : Object.keys(subs);
    let sent = 0;
    let failed = 0;
    const jobs = [];
    for (const t of tokens) {
      for (const d of [...subs[t]]) {
        jobs.push(
          (async () => {
            try {
              const status = d.kind === 'web' ? await this.sendWeb(d.sub, payload) : this.fcmReady() ? await this.sendFcm(d.token, { title, body, url }) : 0;
              if (status >= 200 && status < 300) sent++;
              else {
                failed++;
                if (status === 404 || status === 410) {
                  subs[t] = subs[t].filter((x) => x !== d);
                  if (!subs[t].length) delete subs[t];
                  this.store.markDirty();
                }
              }
            } catch {
              failed++;
            }
          })()
        );
        if (jobs.length >= 50) await Promise.all(jobs.splice(0));
      }
    }
    await Promise.all(jobs);
    return { sent, failed, devices: sent + failed };
  }
}
