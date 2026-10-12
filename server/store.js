// Tiny JSON-file persistence so players keep their money, cars and homes between sessions.
// Swap for Postgres (Supabase) in Phase 2 without changing the game logic.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');

export class JsonStore {
  constructor(name, fallback) {
    this.file = join(DATA_DIR, name);
    this.data = fallback;
    this.dirty = false;
    this.saving = false;
  }

  async load() {
    await mkdir(DATA_DIR, { recursive: true });
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(await readFile(this.file, 'utf8'));
      } catch (e) {
        console.error(`Could not read ${this.file}:`, e.message);
      }
    }
    return this.data;
  }

  markDirty() {
    this.dirty = true;
  }

  async save(force = false) {
    if ((!this.dirty && !force) || this.saving) return;
    this.saving = true;
    this.dirty = false;
    try {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.file);
    } catch (e) {
      console.error(`Could not save ${this.file}:`, e.message);
      this.dirty = true;
    } finally {
      this.saving = false;
    }
  }
}
