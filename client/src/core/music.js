// Background music.
// - In battle: the Proof of Duty theme (client/public/audio/pod-theme.*), looped
//   seamlessly with Web Audio so there is no gap at the loop point.
// - Menus: a slow cinematic theme composed live (talking drum, shekere, kalimba, pads).
// - Stingers for victory and defeat.
import { audio } from './audio.js';
import { api } from './server.js';

const A4 = 440;
const hz = (semi) => A4 * Math.pow(2, semi / 12); // semitones from A4

const THEMES = {
  menu: {
    bpm: 88,
    root: -12, // A3
    // i - VI - III - VII  (Am F C G), two bars each
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [3, 7, 10],
      [-2, 2, 5]
    ],
    scale: [0, 3, 5, 7, 10, 12, 15],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    talk: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    conga: [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1],
    shaker: 0.5,
    bass: false,
    pad: 0.11,
    pluck: 0.6
  },
  battle: {
    bpm: 112,
    root: -7, // D4 region
    // i - VI - VII - i  (Dm Bb C Dm)
    chords: [
      [0, 3, 7],
      [-4, 0, 3],
      [-2, 2, 5],
      [0, 3, 7]
    ],
    scale: [0, 3, 5, 7, 8, 10, 12],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    talk: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    conga: [0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1],
    shaker: 1,
    bass: true,
    pad: 0.07,
    pluck: 0.25
  }
};

export class Music {
  constructor() {
    this.volume = 0.45;
    this.enabled = true;
    this.trackBuf = null;
    this.trackSrc = null;
    this.theme = null;
    this.intensity = 0.2;
    this.target = 0.2;
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.timer = null;
    this.seed = 7;
  }

  ensure() {
    const ctx = audio.ctx;
    if (!ctx) return false;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = this.volume;
      // Gentle low-pass "room" so the music sits under the gunfire.
      this.tone = ctx.createBiquadFilter();
      this.tone.type = 'lowpass';
      this.tone.frequency.value = 9000;
      this.bus.connect(this.tone).connect(audio.master);
      this.verb = ctx.createGain();
      this.verb.gain.value = 0.35;
      this.verb.connect(audio.reverb);
    }
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.bus) this.bus.gain.setTargetAtTime(this.enabled ? v : 0, audio.ctx.currentTime, 0.1);
  }

  // Music on/off from Settings.
  setEnabled(on) {
    this.enabled = on;
    if (!this.bus) return;
    this.bus.gain.setTargetAtTime(on ? this.volume : 0, audio.ctx.currentTime, 0.15);
    if (on && this.theme) {
      const name = this.theme;
      this.theme = null;
      this.play(name);
    } else if (!on) {
      clearInterval(this.timer);
      this.stopTrack();
    }
  }

  // Fetch and decode the battle theme once (ogg/opus, or m4a where opus is not supported).
  async loadTrack() {
    if (this.trackBuf || this.loading) return this.loading;
    if (!audio.ctx) return;
    const probe = document.createElement('audio');
    const ext = probe.canPlayType('audio/ogg; codecs="opus"') ? 'ogg' : 'm4a';
    this.loading = fetch(api(`/audio/pod-theme.${ext}`))
      .then((r) => r.arrayBuffer())
      .then((b) => audio.ctx.decodeAudioData(b))
      .then((buf) => {
        this.trackBuf = buf;
        if (this.theme === 'battle' && this.enabled) this.startTrack();
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  startTrack() {
    if (!this.trackBuf || this.trackSrc) return;
    const ctx = audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.trackBuf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 1.5);
    src.connect(g).connect(this.bus);
    src.start();
    this.trackSrc = src;
    this.trackGain = g;
  }

  stopTrack(fade = 0.8) {
    if (!this.trackSrc) return;
    const ctx = audio.ctx;
    const src = this.trackSrc;
    const g = this.trackGain;
    this.trackSrc = null;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + fade);
    src.stop(ctx.currentTime + fade + 0.05);
  }

  play(name) {
    if (!this.ensure() || this.theme === name) return;
    const ctx = audio.ctx;
    const switching = !!this.theme;
    this.theme = name;
    clearInterval(this.timer);
    if (name === 'battle') {
      // Battle: the POD theme on a loop.
      this.stopTrack(0.3);
      if (!this.enabled) return;
      if (this.trackBuf) this.startTrack();
      else this.loadTrack();
      return;
    }
    this.stopTrack();
    if (!this.enabled) return;
    this.step = 0;
    this.bar = 0;
    this.nextTime = ctx.currentTime + (switching ? 0.6 : 0.1);
    if (switching) {
      // Quick dip between themes.
      this.bus.gain.cancelScheduledValues(ctx.currentTime);
      this.bus.gain.setValueAtTime(this.bus.gain.value, ctx.currentTime);
      this.bus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      this.bus.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 2.5);
    }
    this.intensity = this.target = name === 'battle' ? 0.25 : 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 90);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.theme = null;
  }

  // Combat pushes the battle music up; it relaxes on its own.
  excite(amount) {
    this.target = Math.min(1, this.target + amount);
  }

  // Mid-fight calm (death, menus).
  calm() {
    this.target = Math.min(this.target, 0.15);
  }

  schedule() {
    const ctx = audio.ctx;
    if (!ctx || !this.theme || ctx.state !== 'running') return;
    const th = THEMES[this.theme];
    if (!th) return;
    const sixteenth = 60 / th.bpm / 4;
    // If the browser paused our timer (tab in background), skip ahead instead of
    // firing a burst of late notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    // Relax intensity slowly; rise quickly.
    this.target = Math.max(0.12, this.target - 0.004);
    this.intensity += (this.target - this.intensity) * (this.target > this.intensity ? 0.25 : 0.03);
    while (this.nextTime < ctx.currentTime + 0.35) {
      this.playStep(th, this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  playStep(th, s, t, sx) {
    const I = this.theme === 'battle' ? this.intensity : 0.5;
    const chord = th.chords[Math.floor(this.bar / 2) % th.chords.length];
    const root = th.root;
    // Pad: a new chord every two bars.
    if (s === 0 && this.bar % 2 === 0) this.pad(chord.map((n) => hz(root + n)), t, sx * 32, th.pad * (this.theme === 'battle' ? 0.6 + I * 0.4 : 1));
    // Cinematic low hit at the top of every 4 bars.
    if (s === 0 && this.bar % 4 === 0) this.boom(t, this.theme === 'battle' ? 0.5 + I * 0.4 : 0.45);
    // Kick / big drum.
    if (th.kick[s] && (this.theme === 'menu' || I > 0.15)) this.drum(t, 62, 0.42 * (this.theme === 'battle' ? 0.6 + I * 0.5 : 0.8));
    // Talking drum: pitch bends down like the real thing.
    if (th.talk[s] && I > 0.25) this.talk(t, s % 8 === 4 ? 220 : 180, 0.16 + I * 0.08);
    // Congas / djembe.
    if (th.conga[s] && I > (this.theme === 'battle' ? 0.35 : 0)) this.conga(t, s % 3 === 0 ? 330 : 250, 0.1 + I * 0.06);
    // Shekere (shaker) sixteenths with accents.
    if (I > 0.3 || this.theme === 'menu') this.shaker(t, (s % 4 === 2 ? 0.07 : 0.035) * th.shaker * (0.6 + I * 0.6));
    // Bass ostinato in battle.
    if (th.bass && I > 0.2 && [0, 3, 6, 8, 11, 14].includes(s)) {
      const n = s === 6 || s === 14 ? chord[2] - 12 : chord[0] - 12;
      this.bass(hz(root + n - 12), t, sx * 1.6, 0.2 + I * 0.15);
    }
    // Battle stabs at high intensity.
    if (this.theme === 'battle' && I > 0.7 && (s === 0 || s === 10) && this.bar % 2 === 1) this.stab(chord.map((n) => hz(root + n)), t, 0.06 + (I - 0.7) * 0.2);
    // Kalimba melody from the pentatonic scale.
    if ((s % 2 === 0 && this.rand() < th.pluck * (this.theme === 'battle' ? 0.5 : 1)) || s === 0) {
      const note = th.scale[Math.floor(this.rand() * th.scale.length)] + (this.rand() < 0.3 ? 12 : 0);
      this.pluck(hz(root + 12 + note), t, this.theme === 'battle' ? 0.035 : 0.06);
    }
  }

  // ---------- instruments ----------
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  pad(freqs, t, dur, vol) {
    const ctx = audio.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(600, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g);
    g.connect(this.bus);
    g.connect(this.verb);
    for (const fr of freqs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.25;
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  boom(t, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, 1.8);
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.verb);
    o.start(t);
    o.stop(t + 2);
  }

  drum(t, f, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, 0.35);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.45);
  }

  talk(t, f, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.22);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, 0.28);
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.verb);
    o.start(t);
    o.stop(t + 0.35);
  }

  conga(t, f, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, 0.16);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.2);
    audio.noiseHit(this.bus, t, { dur: 0.03, gain: vol * 0.5, f: 1800, q: 1.5 });
  }

  shaker(t, vol) {
    audio.noiseHit(this.bus, t, { dur: 0.06, gain: vol, type: 'highpass', f: 6000, attack: 0.012 });
  }

  bass(f, t, dur, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(filt).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  stab(freqs, t, vol) {
    const ctx = audio.ctx;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    f.connect(g);
    g.connect(this.bus);
    g.connect(this.verb);
    for (const fr of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr / 2;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.6);
    }
  }

  pluck(f, t, vol) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 3.01;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, 0.9);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.002, vol * 0.3, 0.15);
    o.connect(g);
    o2.connect(g2);
    g.connect(this.bus);
    g2.connect(this.bus);
    g.connect(this.verb);
    o.start(t);
    o2.start(t);
    o.stop(t + 1);
    o2.stop(t + 0.2);
  }

  // ---------- stingers ----------
  sting(win) {
    if (!this.ensure() || !this.enabled) return;
    const t = audio.ctx.currentTime + 0.05;
    const notes = win ? [0, 4, 7, 12, 16] : [12, 10, 7, 3, 0];
    notes.forEach((n, i) => this.pluck(hz(-12 + n), t + i * 0.14, 0.12));
    this.pad((win ? [0, 4, 7] : [0, 3, 7]).map((n) => hz(-12 + n)), t + 0.6, 3.5, 0.14);
    this.boom(t, 0.7);
  }
}

export const music = new Music();
