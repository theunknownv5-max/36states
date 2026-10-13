// Background music, played with the device's own media player (<audio> elements) rather
// than the game's Web Audio sound engine. The media player runs on its own, so heavy
// gunfire, explosions or a busy phone can no longer make the music crackle, stutter or cut out.
// - Menus: the POD menu theme (client/public/audio/pod-menu.*)
// - Battle: the Proof of Duty theme (client/public/audio/pod-theme.*)
// Each theme loops with two players crossfading at the loop point, so there is no gap.
// A watchdog restarts playback after anything that stops it (a call, the screen locking,
// the app going to the background, the browser pausing media).
import { audio } from './audio.js';
import { api } from './server.js';

const TRACKS = {
  menu: { file: 'pod-menu', gain: 1 },
  battle: { file: 'pod-theme', gain: 0.72 }
};
const XFADE = 1.6; // seconds of overlap at the loop point and between themes

const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
const canOgg = !!probe?.canPlayType?.('audio/ogg; codecs="opus"');
// iPhones and some Android browsers say "maybe" to Opus but fail; m4a is the safe fallback.

class Deck {
  // Two <audio> players for one theme, taking turns so the loop never has a gap.
  constructor(name, onFail) {
    this.name = name;
    this.ext = canOgg ? 'ogg' : 'm4a';
    this.players = [this.make(), this.make()];
    this.active = 0;
    this.level = 0; // 0..1 fade level of this theme
    this.target = 0;
    this.onFail = onFail;
  }

  make() {
    const a = new Audio();
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.setAttribute('playsinline', '');
    a.src = api(`/audio/${TRACKS[this.name].file}.${this.ext}`);
    a.addEventListener('error', () => this.fallback());
    a.volume = 0;
    return a;
  }

  fallback() {
    if (this.ext === 'm4a') return this.onFail?.(this.name);
    this.ext = 'm4a';
    for (const a of this.players) {
      const was = !a.paused;
      a.src = api(`/audio/${TRACKS[this.name].file}.m4a`);
      if (was) a.play().catch(() => {});
    }
  }

  get current() {
    return this.players[this.active];
  }

  start() {
    const a = this.current;
    if (a.paused) a.play().catch(() => {});
  }

  pause() {
    for (const a of this.players) if (!a.paused) a.pause();
  }

  // Called ~10 times a second.
  tick(dt, volume) {
    const speed = dt / XFADE;
    this.level += Math.max(-speed, Math.min(speed, this.target - this.level));
    const a = this.current;
    const b = this.players[1 - this.active];
    const dur = a.duration;
    // Loop: start the other player a little before the end and crossfade.
    if (dur && isFinite(dur) && !a.paused && a.currentTime > dur - XFADE) {
      b.currentTime = 0;
      b.play().catch(() => {});
      this.active = 1 - this.active;
      this.handoff = { from: a, t: 0 };
    }
    let fadeIn = 1;
    if (this.handoff) {
      this.handoff.t += dt;
      const k = Math.min(1, this.handoff.t / XFADE);
      fadeIn = k;
      this.handoff.from.volume = clamp01(volume * this.level * TRACKS[this.name].gain * (1 - k));
      if (k >= 1) {
        this.handoff.from.pause();
        this.handoff = null;
      }
    }
    this.current.volume = clamp01(volume * this.level * TRACKS[this.name].gain * fadeIn);
    if (this.level <= 0.001 && this.target === 0) this.pause();
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Music {
  constructor() {
    this.volume = 0.45;
    this.enabled = true;
    this.theme = null;
    this.decks = {};
    this.unlocked = false;
    this.hidden = false;
    this.last = performance.now();
    this.timer = null;
  }

  deck(name) {
    if (!this.decks[name]) this.decks[name] = new Deck(name, () => {});
    return this.decks[name];
  }

  // Start the loop timer and the recovery hooks (once).
  boot() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 100);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      if (this.hidden) for (const d of Object.values(this.decks)) d.pause();
      else this.resume();
    });
    // Any touch or key brings the music back if the system stopped it.
    const kick = () => this.resume();
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, kick, { passive: true });
  }

  // Must be called from a tap or click once, so the browser allows audio.
  unlock() {
    this.boot();
    if (this.unlocked) return;
    this.unlocked = true;
    // Prime both players of both themes inside the user gesture.
    for (const name of Object.keys(TRACKS)) {
      for (const a of this.deck(name).players) {
        a.muted = true;
        a.play()
          .then(() => {
            if (!(name === this.theme && a === this.deck(name).current)) a.pause();
            a.muted = false;
          })
          .catch(() => (a.muted = false));
      }
    }
    this.resume();
  }

  resume() {
    if (this.hidden || !this.enabled || !this.theme) return;
    const d = this.decks[this.theme];
    if (d && d.target > 0) d.start();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    if (this.hidden) return;
    for (const [name, d] of Object.entries(this.decks)) {
      d.target = this.enabled && name === this.theme ? 1 : 0;
      if (d.target > 0 && d.current.paused && d.current.readyState >= 2) d.start(); // watchdog
      d.tick(dt, this.volume);
    }
  }

  // Kept for callers; the media files load on demand.
  loadTrack() {
    this.deck('menu');
    this.deck('battle');
  }

  setVolume(v) {
    this.volume = v;
  }

  // Music on/off from Settings.
  setEnabled(on) {
    this.enabled = on;
    if (on) this.resume();
  }

  play(name) {
    this.boot();
    if (!TRACKS[name]) return;
    this.theme = name;
    const d = this.deck(name);
    if (this.enabled && !this.hidden) d.start();
  }

  stop() {
    this.theme = null;
  }

  // The old live-composed score reacted to combat; the recorded themes don't need to.
  excite() {}
  calm() {}

  // Short victory / defeat stinger (a few Web Audio notes, very light).
  sting(win) {
    const ctx = audio.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.05;
    const notes = win ? [0, 4, 7, 12, 16] : [12, 10, 7, 3, 0];
    notes.forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 220 * Math.pow(2, n / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12 * this.volume * 2, t + i * 0.14 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.9);
      o.connect(g).connect(audio.ui || ctx.destination);
      o.start(t + i * 0.14);
      o.stop(t + i * 0.14 + 1);
    });
    // Duck the theme briefly under the stinger.
    const d = this.decks[this.theme];
    if (d) {
      d.level = Math.min(d.level, 0.35);
    }
  }
}

export const music = new Music();
