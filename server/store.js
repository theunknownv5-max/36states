// Persistence. With SUPABASE_URL and SUPABASE_SERVICE_KEY set, every store is a row in the
// Supabase table `pod_store` (key text primary key, value jsonb), so accounts, profiles,
// adverts and bookings survive restarts and redeploys. Without them, JSON files in DATA_DIR.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');

const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const TABLE = process.env.SUPABASE_TABLE || 'pod_store';
export const SUPABASE = SB_URL && SB_KEY ? { url: SB_URL, table: TABLE } : null;

// Secret keys (sb_secret_...) go in the apikey header; legacy service_role JWTs also as Bearer.
export function sbHeaders(extra = {}) {
  const h = { apikey: SB_KEY, ...extra };
  if (SB_KEY.startsWith('eyJ')) h.authorization = `Bearer ${SB_KEY}`;
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class JsonStore {
  constructor(name, fallback) {
    this.name = name;
    this.file = join(DATA_DIR, name);
    this.data = fallback;
    this.dirty = false;
    this.saving = false;
    this.loaded = false;
  }

  async load() {
    if (SUPABASE) {
      // Never start with empty data if the database is unreachable: that would overwrite it.
      let lastErr;
      for (let i = 0; i < 6; i++) {
        try {
          const r = await fetch(`${SB_URL}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(this.name)}&select=value`, { headers: sbHeaders() });
          if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
          const rows = await r.json();
          if (rows[0]?.value) this.data = rows[0].value;
          else if (existsSync(this.file)) {
            // First run on Supabase: carry over the local file.
            this.data = JSON.parse(await readFile(this.file, 'utf8'));
            this.dirty = true;
          }
          this.loaded = true;
          return this.data;
        } catch (e) {
          lastErr = e;
          await sleep(1000 * (i + 1));
        }
      }
      throw new Error(`Could not load ${this.name} from Supabase (${lastErr?.message}). Check SUPABASE_URL, SUPABASE_SERVICE_KEY and that the pod_store table exists.`);
    }
    await mkdir(DATA_DIR, { recursive: true });
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch (e) {
        console.error(`Could not read ${this.file}:`, e.message);
      }
    }
    this.loaded = true;
    return this.data;
  }

  markDirty() {
    this.dirty = true;
  }

  async save(force = false) {
    if ((!this.dirty && !force) || this.saving || !this.loaded) return;
    this.saving = true;
    this.dirty = false;
    try {
      if (SUPABASE) {
        const r = await fetch(`${SB_URL}/rest/v1/${TABLE}`, {
          method: 'POST',
          headers: sbHeaders({ 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify({ key: this.name, value: this.data, updated_at: new Date().toISOString() })
        });
        if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
      } else {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(this.data));
        await rename(tmp, this.file);
      }
    } catch (e) {
      console.error(`Could not save ${this.name}:`, e.message);
      this.dirty = true;
    } finally {
      this.saving = false;
    }
  }
}
