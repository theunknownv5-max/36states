// Battlefield sound, synthesised live with Web Audio: every gun, footsteps on each
// surface, grenades, artillery whistles, drones, helicopters and the ambience of each
// biome. Sounds are placed in 3D (HRTF), muffled with distance and delayed by the
// speed of sound, so a far-off PKM is a dull thud you hear a beat after the flash.
//
// Real recordings: put files in client/public/sounds/ and list them in
// client/public/sounds/manifest.json, e.g. { "rifle": ["ak1.ogg", "ak2.ogg"], "explosion": ["boom.ogg"] }.
// Any key found there replaces the synthesised version automatically.

const SPEED_OF_SOUND = 343;

const GUNS = {
  pistol: { crack: 2600, q: 0.9, thump: 150, thumpDur: 0.07, body: 0.12, tail: 0.45, gain: 0.8 },
  magnum: { crack: 1800, q: 0.8, thump: 95, thumpDur: 0.12, body: 0.18, tail: 0.8, gain: 1.05 },
  smg: { crack: 3000, q: 1, thump: 160, thumpDur: 0.05, body: 0.08, tail: 0.35, gain: 0.7 },
  rifle: { crack: 1900, q: 0.7, thump: 110, thumpDur: 0.1, body: 0.14, tail: 1.0, gain: 1.0 },
  battle: { crack: 1500, q: 0.7, thump: 90, thumpDur: 0.12, body: 0.16, tail: 1.1, gain: 1.1 },
  mg: { crack: 1700, q: 0.75, thump: 100, thumpDur: 0.1, body: 0.13, tail: 0.9, gain: 1.0 },
  shotgun: { crack: 900, q: 0.6, thump: 70, thumpDur: 0.16, body: 0.25, tail: 1.2, gain: 1.2 },
  sniper: { crack: 2400, q: 0.6, thump: 80, thumpDur: 0.14, body: 0.16, tail: 2.2, gain: 1.25 }
};

const FOOT = {
  sand: { f: 900, q: 0.7, dur: 0.11, gain: 0.35, grit: 0.4 },
  dirt: { f: 600, q: 0.9, dur: 0.09, gain: 0.45, grit: 0.2 },
  gravel: { f: 1600, q: 0.6, dur: 0.12, gain: 0.45, grit: 1 },
  mud: { f: 350, q: 1.2, dur: 0.14, gain: 0.5, grit: 0, wet: true },
  concrete: { f: 1200, q: 1.4, dur: 0.06, gain: 0.5, grit: 0.1, click: true },
  wood: { f: 420, q: 2, dur: 0.09, gain: 0.6, knock: 190 },
  metal: { f: 2400, q: 6, dur: 0.12, gain: 0.45, ring: 780 },
  water: { f: 700, q: 0.6, dur: 0.22, gain: 0.55, wet: true, splash: true }
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
    this.samples = new Map();
    this.loops = new Map();
    this.listener = { x: 0, y: 0, z: 0 };
    this.hrtf = true;
    this.gunsOn = true; // Settings: gun sounds on/off
  }

  // Browsers need a user gesture before audio can start.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.enabled = false;
      return;
    }
    // Phones: a slightly larger audio buffer and cheaper 3D panning, so heavy gunfights
    // never overload the audio thread (that is what made sound crackle and stutter).
    this.mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    let ctx;
    try {
      ctx = new AC({ latencyHint: this.mobile ? 'balanced' : 'interactive' });
    } catch {
      ctx = new AC();
    }
    this.ctx = ctx;
    this.hrtf = !this.mobile;
    this.voices = [];
    this.maxVoices = this.mobile ? 22 : 48;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // Gentle bus compression keeps gunfights loud without clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.55;
    this.amb.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.gain.value = 0.7;
    this.ui.connect(this.master);
    // Reverb send (outdoor slap / urban canyons).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(this.mobile ? 1.3 : 2.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.noiseBuffer(2, 'white');
    this.brown = this.noiseBuffer(4, 'brown');
    this.loadSamples();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setBiome(biome) {
    this.biome = biome;
    if (this.reverbSend) this.reverbSend.gain.value = biome === 'urban' ? 0.5 : biome === 'rainforest' ? 0.38 : 0.26;
  }

  async loadSamples() {
    try {
      const r = await fetch('/sounds/manifest.json');
      if (!r.ok) return;
      const manifest = await r.json();
      for (const [key, files] of Object.entries(manifest)) {
        const list = [];
        for (const f of [].concat(files)) {
          try {
            const buf = await (await fetch(`/sounds/${f}`)).arrayBuffer();
            list.push(await this.ctx.decodeAudioData(buf));
          } catch {
            /* skip bad file */
          }
        }
        if (list.length) this.samples.set(key, list);
      }
    } catch {
      /* no manifest: synthesis only */
    }
  }

  noiseBuffer(seconds, colour) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (colour === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Early reflections then a diffuse tail.
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 1 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * 0.6;
      }
    }
    return buf;
  }

  setListener(pos, fwd, up) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  // A chain ending in 3D space (or straight to a bus when pos is null).
  // Returns { input, when, dist } — 'when' already includes the speed-of-sound delay.
  out(pos, { bus = this.sfx, ref = 6, rolloff = 1.1, max = 2000, reverb = 0.35 } = {}) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    let dist = 0;
    let when = ctx.currentTime + 0.005;
    // Voice budget: when too many sounds are playing, quietly skip far-away ones
    // (an unconnected chain costs nothing to render).
    const now = ctx.currentTime;
    if (this.voices.length > 64) this.voices = this.voices.filter((t) => t > now);
    const busy = this.voices.reduce((n, t) => n + (t > now ? 1 : 0), 0);
    const far = pos ? Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) : 0;
    if (busy >= this.maxVoices && far > 12) return { input, when, dist: far, skipped: true };
    this.voices.push(now + 1.5);
    if (pos) {
      dist = far;
      when += Math.min(1.2, dist / SPEED_OF_SOUND);
      // Air absorbs high frequencies over distance.
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(500, 18000 / (1 + dist / 35));
      const pan = ctx.createPanner();
      pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = ref;
      pan.rolloffFactor = rolloff;
      pan.maxDistance = max;
      if (pan.positionX) {
        pan.positionX.value = pos.x;
        pan.positionY.value = pos.y;
        pan.positionZ.value = pos.z;
      } else pan.setPosition(pos.x, pos.y, pos.z);
      input.connect(air).connect(pan).connect(bus);
      const send = ctx.createGain();
      send.gain.value = reverb * Math.min(1.6, 0.4 + dist / 60);
      air.connect(send).connect(this.reverbSend);
    } else {
      input.connect(bus);
      const send = ctx.createGain();
      send.gain.value = reverb * 0.5;
      input.connect(send).connect(this.reverbSend);
    }
    return { input, when, dist };
  }

  // ---------- building blocks ----------
  noiseHit(dest, when, { dur, gain, type = 'bandpass', f = 1000, q = 1, f2 = null, attack = 0.002, buffer = this.noise, offset = Math.random() }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, when);
    if (f2) filt.frequency.exponentialRampToValueAtTime(f2, when + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    if (dur > buffer.duration - 0.1) src.loop = true;
    src.connect(filt).connect(g).connect(dest);
    src.start(when, offset * (buffer.duration - dur - 0.05 > 0 ? buffer.duration - dur - 0.05 : 0));
    src.stop(when + dur + 0.05);
  }

  tone(dest, when, { f, f2 = null, dur, gain, type = 'sine', attack = 0.003 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, when);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  sample(key, dest, when, gain = 1, rate = 1) {
    const list = this.samples.get(key);
    if (!list) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(when);
    return true;
  }

  // ---------- weapons ----------
  gunshot(kind, pos, local = false) {
    if (!this.ready() || !this.gunsOn) return;
    if (kind === 'rpg') return this.rocketLaunch(pos, local);
    const p = GUNS[kind] || GUNS.rifle;
    const o = this.out(local ? null : pos, { ref: 10, rolloff: 0.9, reverb: 0.45 });
    const far = o.dist > 120;
    const g = p.gain * (local ? 0.9 : 1.6);
    const w = o.when;
    if (this.sample(kind, o.input, w, g)) return;
    // Supersonic crack / muzzle blast.
    if (!far) this.noiseHit(o.input, w, { dur: 0.05 + p.body * 0.3, gain: g * 0.9, f: p.crack, q: p.q, attack: 0.0008 });
    this.noiseHit(o.input, w, { dur: p.body, gain: g * 0.8, type: 'lowpass', f: far ? 900 : 5000, f2: 300, attack: 0.001 });
    // Low thump of the expanding gas.
    this.tone(o.input, w, { f: p.thump * 1.6, f2: p.thump * 0.6, dur: p.thumpDur + 0.06, gain: g * 0.9, type: 'sine', attack: 0.001 });
    // Rolling tail (echo off the land).
    this.noiseHit(o.input, w + 0.03, { dur: p.tail * (far ? 1.4 : 1), gain: g * 0.18, type: 'lowpass', f: far ? 600 : 1400, f2: 150, attack: 0.02, buffer: this.brown });
    // Mechanical clack for your own gun.
    if (local) this.noiseHit(o.input, w + 0.035, { dur: 0.03, gain: 0.25, f: 4200, q: 3 });
  }

  rocketLaunch(pos, local) {
    if (!this.gunsOn) return;
    const o = this.out(local ? null : pos, { ref: 10, reverb: 0.5 });
    if (this.sample('rpg', o.input, o.when, 1.4)) return;
    this.tone(o.input, o.when, { f: 120, f2: 40, dur: 0.25, gain: 1.2 });
    this.noiseHit(o.input, o.when, { dur: 1.1, gain: 0.9, type: 'bandpass', f: 600, f2: 3000, q: 0.5, attack: 0.01 });
    this.noiseHit(o.input, o.when, { dur: 0.6, gain: 0.6, type: 'lowpass', f: 2500, f2: 200, buffer: this.brown });
  }

  dryFire() {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.sfx, reverb: 0 });
    this.noiseHit(o.input, o.when, { dur: 0.03, gain: 0.35, f: 3200, q: 4 });
  }

  reload(kind, pos = null) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 3, reverb: 0.1 });
    if (this.sample('reload-' + kind, o.input, o.when)) return;
    const w = o.when;
    const k = (t, f, g = 0.35) => this.noiseHit(o.input, w + t, { dur: 0.035, gain: g, f, q: 3 });
    if (kind === 'danegun') {
      k(0.2, 900);
      k(0.9, 2000);
      k(1.4, 3000, 0.45);
      return;
    }
    if (kind === 'rpg') {
      k(0.4, 700, 0.5);
      k(2.6, 1500, 0.5);
      k(3.2, 2500);
      return;
    }
    k(0.15, 1800); // mag release
    k(0.35, 900, 0.25); // mag out
    k(kind === 'pkm' ? 3.2 : 1.2, 1400, 0.45); // mag in
    k(kind === 'pkm' ? 4.2 : 1.7, 2600, 0.5); // charging handle
    k(kind === 'pkm' ? 4.3 : 1.8, 3400, 0.4);
  }

  swing(pos = null) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 3, reverb: 0.05 });
    this.noiseHit(o.input, o.when, { dur: 0.22, gain: 0.4, f: 800, f2: 3000, q: 1.5, attack: 0.04 });
  }

  // ---------- impacts ----------
  impact(surface, pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 2, rolloff: 1.4, reverb: 0.15 });
    const f = { metal: 3500, wood: 900, concrete: 2200, water: 600, flesh: 400 }[surface] || 1500;
    this.noiseHit(o.input, o.when, { dur: surface === 'water' ? 0.18 : 0.06, gain: 0.5, f, q: surface === 'metal' ? 8 : 1.5 });
    if (surface === 'metal' && Math.random() < 0.4) this.tone(o.input, o.when, { f: 2200 + Math.random() * 1500, f2: 900, dur: 0.35, gain: 0.12 }); // ricochet
  }

  whiz(pos) {
    // A round cracking past your head.
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 1, reverb: 0 });
    this.noiseHit(o.input, o.when, { dur: 0.09, gain: 0.5, f: 5000, f2: 2500, q: 2 });
  }

  explosion(pos, size = 1) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 14, rolloff: 0.7, reverb: 0.7, max: 4000 });
    const w = o.when;
    if (this.sample('explosion', o.input, w, 1.5 * size)) return;
    const far = o.dist > 80;
    this.tone(o.input, w, { f: 70, f2: 22, dur: 1.4 * size, gain: 1.6 * size, attack: 0.004 });
    this.noiseHit(o.input, w, { dur: 1.8 * size, gain: 1.4 * size, type: 'lowpass', f: far ? 700 : 3000, f2: 120, attack: 0.002, buffer: this.brown });
    if (!far) this.noiseHit(o.input, w, { dur: 0.25, gain: 1.0 * size, type: 'highpass', f: 1500, attack: 0.001 });
    // Falling debris crackle.
    for (let i = 0; i < 10 * size; i++) this.noiseHit(o.input, w + 0.25 + Math.random() * 1.6, { dur: 0.03, gain: 0.08 + Math.random() * 0.1, f: 1500 + Math.random() * 3000, q: 2 });
  }

  // A helicopter or jet passing over the battlefield (position updated every frame).
  flyover(heli, dur) {
    if (!this.ready()) return;
    this.stopLoop('flyover', 0.1);
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = heli ? 30 : 60;
    pan.rolloffFactor = 1;
    pan.maxDistance = 3000;
    pan.connect(this.amb);
    this.flyPan = pan;
    this.loop('flyover', () => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(heli ? 1.4 : 1.8, ctx.currentTime + 2);
      gain.connect(pan);
      const stop = heli
        ? this.noiseLoop(gain, { buffer: this.brown, f: 320, gain: 1, lfo: 11, lfoDepth: 0.9 })
        : [...this.noiseLoop(gain, { buffer: this.brown, f: 700, gain: 1.1 }), ...this.noiseLoop(gain, { type: 'bandpass', f: 2600, q: 2, gain: 0.25 })];
      return { gain, stop };
    });
    clearTimeout(this.flyTimer);
    this.flyTimer = setTimeout(() => this.stopLoop('flyover', 1.5), Math.max(1, dur - 1.5) * 1000);
  }

  moveFlyover(p) {
    const pan = this.flyPan;
    if (!pan || !this.ctx) return;
    if (pan.positionX) {
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
    } else pan.setPosition(p.x, p.y, p.z);
  }

  // Train on the viaduct: a rumbling, clattering loop that follows the train, plus the horn.
  train(on) {
    if (!on) return this.stopLoop('train', 2);
    if (!this.ready() || this.loops.has('train')) return;
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 40;
    pan.rolloffFactor = 1;
    pan.maxDistance = 3000;
    pan.connect(this.amb);
    this.trainPan = pan;
    this.loop('train', () => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(1.6, ctx.currentTime + 2.5);
      gain.connect(pan);
      const stop = [...this.noiseLoop(gain, { buffer: this.brown, f: 220, gain: 1.2, lfo: 6.5, lfoDepth: 0.45 }), ...this.noiseLoop(gain, { type: 'bandpass', f: 1800, q: 3, gain: 0.12, lfo: 13, lfoDepth: 0.9 })];
      return { gain, stop };
    });
  }

  moveTrain(p) {
    const pan = this.trainPan;
    if (!pan || !this.ctx) return;
    if (pan.positionX) {
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
    } else pan.setPosition(p.x, p.y, p.z);
  }

  horn(pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 60, rolloff: 0.6, reverb: 0.6, max: 4000 });
    for (const [f, t] of [
      [233, 0],
      [294, 0],
      [233, 1.1],
      [294, 1.1]
    ])
      this.tone(o.input, o.when + t, { f, dur: 0.9, gain: 0.16, type: 'sawtooth', attack: 0.05 });
  }

  // Punch: a dull body thud; heavy ones with a crack.
  punch(pos, heavy) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 3, reverb: 0.1 });
    this.tone(o.input, o.when, { f: heavy ? 110 : 150, f2: 50, dur: 0.14, gain: heavy ? 0.8 : 0.55 });
    this.noiseHit(o.input, o.when, { dur: 0.06, gain: heavy ? 0.6 : 0.35, type: 'lowpass', f: 1400, f2: 300 });
  }

  // Gemstone or blood pill: a bright shimmer.
  heal(pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 4, reverb: 0.4 });
    [880, 1175, 1568].forEach((f, i) => this.tone(o.input, o.when + i * 0.07, { f, dur: 0.5, gain: 0.12, type: 'triangle' }));
  }

  // Bomb timer beep.
  beep(pos, f = 1000) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 6, rolloff: 1, reverb: 0.1 });
    this.tone(o.input, o.when, { f, dur: 0.08, gain: 0.35, type: 'square', attack: 0.002 });
  }

  // Burning fuel: a roar with crackles, for a few seconds.
  fire(pos, secs) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 5, rolloff: 1.2, reverb: 0.2 });
    const t = o.when;
    this.noiseHit(o.input, t, { dur: secs, gain: 0.5, type: 'lowpass', f: 900, attack: 0.3, buffer: this.brown });
    for (let i = 0; i < secs * 6; i++) this.noiseHit(o.input, t + Math.random() * secs, { dur: 0.02, gain: 0.1 + Math.random() * 0.15, f: 2000 + Math.random() * 3000, q: 3 });
  }

  incoming(pos) {
    // Shell whistle in the last second and a half.
    if (!this.ready()) return;
    const o = this.out({ x: pos.x, y: 40, z: pos.z }, { ref: 30, rolloff: 0.5, reverb: 0.2 });
    this.tone(o.input, this.ctx.currentTime, { f: 2100, f2: 380, dur: 1.3, gain: 0.35, type: 'sine', attack: 0.2 });
  }

  grenadeThrow() {
    if (!this.ready()) return;
    const o = this.out(null, { reverb: 0 });
    this.noiseHit(o.input, o.when, { dur: 0.04, gain: 0.3, f: 3000, q: 5 }); // pin
    this.noiseHit(o.input, o.when + 0.3, { dur: 0.25, gain: 0.25, f: 600, f2: 1800, q: 1, attack: 0.05 });
  }

  bounce(pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 2, reverb: 0.1 });
    this.noiseHit(o.input, o.when, { dur: 0.05, gain: 0.3, f: 1800, q: 4 });
  }

  flashbang(pos, strength) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 12, reverb: 0.6 });
    this.noiseHit(o.input, o.when, { dur: 0.6, gain: 1.4, type: 'highpass', f: 800, attack: 0.001 });
    if (strength > 0.2) {
      // Tinnitus ringing; everything else ducks.
      const r = this.out(null, { bus: this.master, reverb: 0 });
      this.tone(r.input, r.when, { f: 3600, dur: 1 + strength * 4, gain: 0.12 * strength, attack: 0.05 });
      this.sfx.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sfx.gain.setValueAtTime(0.15, this.ctx.currentTime);
      this.sfx.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1 + strength * 3.5);
    }
  }

  smoke(pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 5 });
    this.noiseHit(o.input, o.when, { dur: 2.5, gain: 0.35, type: 'bandpass', f: 1800, q: 0.5, attack: 0.1 });
  }

  // ---------- movement ----------
  footstep(surface, pos, loud = 1) {
    if (!this.ready()) return;
    const s = FOOT[surface] || FOOT.dirt;
    const o = this.out(pos, { ref: 2.2, rolloff: 1.3, reverb: 0.08 });
    if (this.sample('step-' + surface, o.input, o.when, s.gain * loud)) return;
    const g = s.gain * loud * (0.8 + Math.random() * 0.4);
    const w = o.when;
    this.noiseHit(o.input, w, { dur: s.dur, gain: g, f: s.f * (0.85 + Math.random() * 0.3), q: s.q, type: s.wet ? 'lowpass' : 'bandpass' });
    if (s.grit) for (let i = 0; i < 3; i++) this.noiseHit(o.input, w + Math.random() * s.dur, { dur: 0.012, gain: g * s.grit * 0.5, f: 3000 + Math.random() * 3000, q: 3 });
    if (s.click) this.noiseHit(o.input, w, { dur: 0.015, gain: g * 0.6, f: 4000, q: 4 });
    if (s.knock) this.tone(o.input, w, { f: s.knock, f2: s.knock * 0.7, dur: 0.08, gain: g * 0.8 });
    if (s.ring) this.tone(o.input, w, { f: s.ring, dur: 0.18, gain: g * 0.25, type: 'triangle' });
    if (s.splash) this.noiseHit(o.input, w + 0.04, { dur: 0.25, gain: g * 0.6, type: 'bandpass', f: 1500, f2: 500, q: 0.7 });
    // Gear rattle.
    if (loud > 0.8 && Math.random() < 0.5) this.noiseHit(o.input, w + 0.03, { dur: 0.03, gain: g * 0.15, f: 5000, q: 6 });
  }

  land(surface, pos) {
    this.footstep(surface, pos, 1.6);
  }

  jumpGrunt() {
    if (!this.ready()) return;
    const o = this.out(null, { reverb: 0 });
    this.noiseHit(o.input, o.when, { dur: 0.12, gain: 0.12, f: 500, q: 1.5 });
  }

  // ---------- feedback ----------
  hitmarker(head, kill) {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.ui, reverb: 0 });
    if (head) this.tone(o.input, o.when, { f: 2300, dur: 0.35, gain: 0.35, type: 'triangle', attack: 0.001 });
    else this.noiseHit(o.input, o.when, { dur: 0.04, gain: 0.4, f: 2800, q: 3 });
    if (kill) {
      this.tone(o.input, o.when + 0.05, { f: 520, dur: 0.12, gain: 0.25, type: 'square' });
      this.tone(o.input, o.when + 0.14, { f: 780, dur: 0.16, gain: 0.25, type: 'square' });
    }
  }

  hurt(dmg) {
    if (!this.ready()) return;
    const o = this.out(null, { reverb: 0 });
    this.tone(o.input, o.when, { f: 90, f2: 50, dur: 0.18, gain: Math.min(0.9, 0.2 + dmg / 80) });
    this.noiseHit(o.input, o.when, { dur: 0.08, gain: 0.3, f: 500, q: 1 });
  }

  heartbeat(rate) {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.ui, reverb: 0 });
    this.tone(o.input, o.when, { f: 55, f2: 40, dur: 0.12, gain: 0.5 * rate });
    this.tone(o.input, o.when + 0.18, { f: 50, f2: 38, dur: 0.12, gain: 0.35 * rate });
  }

  gem() {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.ui, reverb: 0.4 });
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(o.input, o.when + i * 0.07, { f, dur: 0.6, gain: 0.18, type: 'triangle' }));
  }

  click() {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.ui, reverb: 0 });
    this.tone(o.input, o.when, { f: 1200, dur: 0.05, gain: 0.15, type: 'square' });
  }

  alert() {
    if (!this.ready()) return;
    const o = this.out(null, { bus: this.ui, reverb: 0.2 });
    this.tone(o.input, o.when, { f: 660, dur: 0.18, gain: 0.2, type: 'square' });
    this.tone(o.input, o.when + 0.2, { f: 880, dur: 0.25, gain: 0.2, type: 'square' });
  }

  // ---------- loops (ambience, drone, medevac, machinery) ----------
  loop(key, build) {
    if (!this.ready() || this.loops.has(key)) return;
    const nodes = build();
    this.loops.set(key, nodes);
  }

  stopLoop(key, fade = 0.6) {
    const l = this.loops.get(key);
    if (!l) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(l.gain.gain.value, t);
    l.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => l.stop.forEach((s) => s.stop()), fade * 1000 + 100);
  }

  noiseLoop(dest, { buffer = this.noise, type = 'lowpass', f = 500, q = 0.7, gain = 0.2, lfo = 0, lfoDepth = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = f;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(dest);
    const stops = [src];
    if (lfo) {
      const o = ctx.createOscillator();
      o.frequency.value = lfo;
      const d = ctx.createGain();
      d.gain.value = lfoDepth;
      o.connect(d).connect(g.gain);
      o.start();
      stops.push(o);
    }
    src.start(0, Math.random() * buffer.duration);
    return stops;
  }

  ambience(biome, raining) {
    if (!this.ready()) return;
    this.loop('ambience', () => {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 3);
      gain.connect(this.amb);
      const stop = [];
      // Wind.
      stop.push(...this.noiseLoop(gain, { buffer: this.brown, f: biome === 'sahel' ? 700 : 380, gain: biome === 'sahel' ? 0.35 : 0.2, lfo: 0.08, lfoDepth: 0.12 }));
      if (biome === 'rainforest' || biome === 'creeks' || biome === 'savanna') stop.push(...this.noiseLoop(gain, { type: 'bandpass', f: 5200, q: 6, gain: 0.03, lfo: 7, lfoDepth: 0.025 })); // insects
      if (biome === 'creeks') stop.push(...this.noiseLoop(gain, { buffer: this.brown, f: 300, gain: 0.25, lfo: 0.3, lfoDepth: 0.15 })); // water lapping
      if (biome === 'urban') stop.push(...this.noiseLoop(gain, { buffer: this.brown, f: 180, gain: 0.4, lfo: 0.05, lfoDepth: 0.1 })); // distant traffic
      if (raining) stop.push(...this.noiseLoop(gain, { type: 'bandpass', f: 2600, q: 0.4, gain: 0.22, lfo: 0.2, lfoDepth: 0.04 }));
      return { gain, stop };
    });
    clearInterval(this.ambTimer);
    // Occasional birds, a distant horn or a cockerel.
    this.ambTimer = setInterval(() => {
      if (!this.ready()) return;
      const o = this.out({ x: this.listener.x + (Math.random() - 0.5) * 120, y: 8, z: this.listener.z + (Math.random() - 0.5) * 120 }, { bus: this.amb, ref: 20, reverb: 0.3 });
      if (biome === 'urban' && Math.random() < 0.5) {
        this.tone(o.input, o.when, { f: 420, dur: 0.35, gain: 0.12, type: 'square' });
        this.tone(o.input, o.when + 0.45, { f: 420, dur: 0.6, gain: 0.12, type: 'square' });
        return;
      }
      const base = 2000 + Math.random() * 2500;
      const n = 2 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) this.tone(o.input, o.when + i * 0.13, { f: base * (1 + Math.random() * 0.3), f2: base * (0.7 + Math.random() * 0.6), dur: 0.09, gain: 0.08 });
    }, 4500);
  }

  stopAmbience() {
    clearInterval(this.ambTimer);
    this.stopLoop('ambience', 1);
    for (const k of [...this.loops.keys()]) this.stopLoop(k, 0.3);
    this.humPans?.clear();
    this.sirenPans?.clear();
    this.engineNodes = null;
  }

  // Looping positional sources: gas flares roar, waterfalls, pumpjacks.
  placeLoops(list) {
    if (!this.ready()) return;
    list.forEach((s, i) => {
      this.loop('pos' + i, () => {
        const gain = this.ctx.createGain();
        gain.gain.value = 1;
        const o = this.out(s, { bus: this.amb, ref: s.kind === 'flare' ? 8 : 5, rolloff: 1.4, reverb: 0.2 });
        gain.connect(o.input);
        let stop;
        if (s.kind === 'flare') stop = this.noiseLoop(gain, { buffer: this.brown, f: s.small ? 500 : 900, gain: s.small ? 0.5 : 1.2, lfo: 3, lfoDepth: 0.15 });
        else if (s.kind === 'waterfall') stop = this.noiseLoop(gain, { f: 1600, type: 'lowpass', gain: 0.6 });
        else stop = this.noiseLoop(gain, { type: 'bandpass', f: 220, q: 3, gain: 0.5, lfo: 0.21, lfoDepth: 0.4 });
        return { gain, stop };
      });
    });
  }

  drone(on) {
    if (!on) return this.stopLoop('drone');
    this.loop('drone', () => {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 1);
      gain.connect(this.sfx);
      const stop = [];
      for (const f of [178, 181, 356]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 900;
        o.connect(filt).connect(gain);
        o.start();
        stop.push(o);
      }
      return { gain, stop };
    });
  }

  // ---------- vehicles ----------
  // Your own engine: two detuned saws through a lowpass plus a rumble; pitch follows speed.
  engine(on, type = 'sedan') {
    if (!on) {
      this.engineNodes = null;
      return this.stopLoop('engine', 0.5);
    }
    if (!this.ready() || this.loops.has('engine')) return;
    const ctx = this.ctx;
    const big = type === 'lorry' || type === 'apc' || type === 'danfo';
    const small = type === 'okada' || type === 'keke';
    this.engineBase = big ? 32 : small ? 62 : 44;
    this.loop('engine', () => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(small ? 0.09 : 0.13, ctx.currentTime + 0.6);
      gain.connect(this.sfx);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 500;
      filt.Q.value = 2;
      filt.connect(gain);
      const oscs = [0, 7].map((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.engineBase;
        o.detune.value = det;
        o.connect(filt);
        o.start();
        return o;
      });
      const rumble = this.noiseLoop(gain, { buffer: this.brown, f: big ? 140 : 220, gain: big ? 0.9 : 0.5 });
      this.engineNodes = { oscs, filt };
      return { gain, stop: [...oscs, ...rumble] };
    });
    // A quick crank as it starts.
    const o = this.out(null, { reverb: 0.05 });
    this.noiseHit(o.input, o.when, { dur: 0.45, gain: 0.25, type: 'lowpass', f: 400, buffer: this.brown });
  }

  setEngine(load, throttle) {
    const n = this.engineNodes;
    if (!n || !this.ctx) return;
    const t = this.ctx.currentTime;
    // Fake gears: revs climb, drop at each shift, climb again.
    const gear = Math.min(4, Math.floor(load * 4));
    const rev = load * 4 - gear;
    const f = this.engineBase * (1 + rev * 1.6 + gear * 0.25 + throttle * 0.15);
    for (const o of n.oscs) o.frequency.setTargetAtTime(f, t, 0.08);
    n.filt.frequency.setTargetAtTime(380 + rev * 900 + throttle * 500, t, 0.1);
  }

  crash(impact) {
    if (!this.ready()) return;
    const o = this.out(null, { reverb: 0.2 });
    const g = Math.min(1, impact / 18);
    this.noiseHit(o.input, o.when, { dur: 0.35, gain: 0.8 * g, type: 'lowpass', f: 1800, f2: 300 });
    this.noiseHit(o.input, o.when + 0.02, { dur: 0.25, gain: 0.4 * g, type: 'bandpass', f: 3200, q: 2 });
    this.tone(o.input, o.when, { f: 90, f2: 40, dur: 0.3, gain: 0.5 * g });
  }

  // Other moving vehicles: up to two positional engine hums (the nearest ones).
  hums(list) {
    if (!this.ready()) return;
    this.humPans ||= new Map();
    const keep = new Set(list.slice(0, 2).map((v) => v.id));
    for (const id of [...this.humPans.keys()])
      if (!keep.has(id)) {
        this.stopLoop(`hum${id}`, 0.6);
        this.humPans.delete(id);
      }
    for (const v of list.slice(0, 2)) {
      if (!this.humPans.has(v.id)) {
        const ctx = this.ctx;
        const pan = ctx.createPanner();
        pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
        pan.distanceModel = 'inverse';
        pan.refDistance = 6;
        pan.rolloffFactor = 1.2;
        pan.connect(this.sfx);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 420;
        this.loop(`hum${v.id}`, () => {
          const gain = ctx.createGain();
          gain.gain.value = 0.1;
          o.connect(filt).connect(gain).connect(pan);
          o.start();
          const rumble = this.noiseLoop(gain, { buffer: this.brown, f: 180, gain: 0.7 });
          return { gain, stop: [o, ...rumble] };
        });
        this.humPans.set(v.id, { pan, o });
      }
      const h = this.humPans.get(v.id);
      if (h.pan.positionX) {
        h.pan.positionX.value = v.x;
        h.pan.positionY.value = 0.8;
        h.pan.positionZ.value = v.z;
      } else h.pan.setPosition(v.x, 0.8, v.z);
      h.o.frequency.setTargetAtTime(40 + Math.abs(v.speed) * 4.5, this.ctx.currentTime, 0.1);
    }
  }

  // Ambulance siren (two-tone, Nigerian style), following the ambulance.
  sirens(list) {
    if (!this.ready()) return;
    this.sirenPans ||= new Map();
    const keep = new Set(list.filter((a) => a.siren).map((a) => a.id));
    for (const id of [...this.sirenPans.keys()])
      if (!keep.has(id)) {
        this.stopLoop(`siren${id}`, 1);
        this.sirenPans.delete(id);
      }
    for (const a of list) {
      if (!a.siren) continue;
      if (!this.sirenPans.has(a.id)) {
        const ctx = this.ctx;
        const pan = ctx.createPanner();
        pan.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
        pan.distanceModel = 'inverse';
        pan.refDistance = 14;
        pan.rolloffFactor = 0.9;
        pan.connect(this.sfx);
        this.loop(`siren${a.id}`, () => {
          const gain = ctx.createGain();
          gain.gain.value = 0.09;
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = 760;
          const lfo = ctx.createOscillator();
          lfo.type = 'square';
          lfo.frequency.value = 1.3;
          const depth = ctx.createGain();
          depth.gain.value = 170;
          lfo.connect(depth).connect(o.frequency);
          const filt = ctx.createBiquadFilter();
          filt.type = 'lowpass';
          filt.frequency.value = 2400;
          o.connect(filt).connect(gain).connect(pan);
          o.start();
          lfo.start();
          return { gain, stop: [o, lfo] };
        });
        this.sirenPans.set(a.id, pan);
      }
      const pan = this.sirenPans.get(a.id);
      if (pan.positionX) {
        pan.positionX.value = a.x;
        pan.positionY.value = 2;
        pan.positionZ.value = a.z;
      } else pan.setPosition(a.x, 2, a.z);
    }
  }

  // C4 armed: two short high beeps.
  c4(pos) {
    if (!this.ready()) return;
    const o = this.out(pos, { ref: 4, reverb: 0.1 });
    this.tone(o.input, o.when, { f: 1900, dur: 0.06, gain: 0.25, type: 'square' });
    this.tone(o.input, o.when + 0.12, { f: 1900, dur: 0.06, gain: 0.25, type: 'square' });
  }

  helicopter(on) {
    if (!on) return this.stopLoop('heli', 2);
    this.loop('heli', () => {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 4);
      gain.connect(this.sfx);
      const stop = this.noiseLoop(gain, { buffer: this.brown, f: 260, gain: 0.9, lfo: 5.5, lfoDepth: 0.85 });
      return { gain, stop };
    });
  }

  spirit(on) {
    // Underwater-style muffle while you are a spirit.
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!this.muffle) {
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.sfx.disconnect();
      this.sfx.connect(this.muffle).connect(this.master);
    }
    this.muffle.frequency.setTargetAtTime(on ? 700 : 20000, t, 0.3);
    if (on)
      this.loop('spiritHum', () => {
        const gain = this.ctx.createGain();
        gain.gain.value = 0.05;
        gain.connect(this.ui);
        const o = this.ctx.createOscillator();
        o.frequency.value = 110;
        const o2 = this.ctx.createOscillator();
        o2.frequency.value = 164.8;
        o.connect(gain);
        o2.connect(gain);
        o.start();
        o2.start();
        return { gain, stop: [o, o2] };
      });
    else this.stopLoop('spiritHum');
  }
}

export const audio = new AudioEngine();
