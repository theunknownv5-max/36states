// Advert images. Supabase Storage (public bucket "pod-ads", created automatically) when
// Supabase is configured, otherwise files in DATA_DIR/ads. Also reads image sizes so the
// portal can insist on HD artwork.
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, SUPABASE, sbHeaders } from './store.js';

const AD_DIR = join(DATA_DIR, 'ads');
const BUCKET = process.env.SUPABASE_BUCKET || 'pod-ads';
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const CONTENT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const SAFE = /^[a-z0-9-]+\.(png|jpg|webp)$/;

class Media {
  constructor() {
    this.cache = new Map(); // name -> Buffer (small LRU for the /ads proxy)
    this.cacheBytes = 0;
    this.publicBucket = false;
  }

  async init() {
    if (!SUPABASE) {
      await mkdir(AD_DIR, { recursive: true });
      return;
    }
    // Make sure the bucket exists and is public, so the game loads images straight from Supabase's CDN.
    try {
      const r = await fetch(`${SUPABASE.url}/storage/v1/bucket/${BUCKET}`, { headers: sbHeaders() });
      if (r.ok) {
        const b = await r.json();
        this.publicBucket = !!b.public;
        if (!b.public) {
          const u = await fetch(`${SUPABASE.url}/storage/v1/bucket/${BUCKET}`, { method: 'PUT', headers: sbHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) });
          this.publicBucket = u.ok;
        }
      } else {
        const c = await fetch(`${SUPABASE.url}/storage/v1/bucket`, { method: 'POST', headers: sbHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) });
        this.publicBucket = c.ok;
        if (!c.ok) console.error('Could not create Supabase bucket', BUCKET, c.status, (await c.text()).slice(0, 200));
      }
    } catch (e) {
      console.error('Supabase storage check failed:', e.message);
    }
  }

  // Where the game should download an image from.
  url(name) {
    return SUPABASE && this.publicBucket ? `${SUPABASE.url}/storage/v1/object/public/${BUCKET}/${name}` : `/ads/${name}`;
  }

  async put(name, buf) {
    if (!SAFE.test(name)) throw new Error('Bad file name');
    if (SUPABASE) {
      const r = await fetch(`${SUPABASE.url}/storage/v1/object/${BUCKET}/${name}`, {
        method: 'POST',
        headers: sbHeaders({ 'content-type': CONTENT[name.split('.').pop()], 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }),
        body: buf
      });
      if (!r.ok) throw new Error(`Could not store the image (${r.status})`);
    } else {
      await mkdir(AD_DIR, { recursive: true });
      await writeFile(join(AD_DIR, name), buf);
    }
    this.remember(name, buf);
  }

  async get(name) {
    if (!SAFE.test(name)) return null;
    if (this.cache.has(name)) {
      const b = this.cache.get(name);
      this.cache.delete(name);
      this.cache.set(name, b);
      return b;
    }
    try {
      let buf;
      if (SUPABASE) {
        const r = await fetch(`${SUPABASE.url}/storage/v1/object/${BUCKET}/${name}`, { headers: sbHeaders() });
        if (!r.ok) return null;
        buf = Buffer.from(await r.arrayBuffer());
      } else buf = await readFile(join(AD_DIR, name));
      this.remember(name, buf);
      return buf;
    } catch {
      return null;
    }
  }

  async del(name) {
    if (!SAFE.test(name)) return;
    if (this.cache.has(name)) {
      this.cacheBytes -= this.cache.get(name).length;
      this.cache.delete(name);
    }
    if (SUPABASE) await fetch(`${SUPABASE.url}/storage/v1/object/${BUCKET}/${name}`, { method: 'DELETE', headers: sbHeaders() }).catch(() => {});
    else await unlink(join(AD_DIR, name)).catch(() => {});
  }

  remember(name, buf) {
    this.cache.set(name, buf);
    this.cacheBytes += buf.length;
    while (this.cacheBytes > 80 * 1024 * 1024 && this.cache.size > 1) {
      const [k, v] = this.cache.entries().next().value;
      this.cache.delete(k);
      this.cacheBytes -= v.length;
    }
  }
}

export const media = new Media();

// Width and height of a PNG, JPEG or WEBP from its header bytes.
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}
