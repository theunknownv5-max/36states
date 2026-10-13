// Client side of the game modes: the mode bar, round/bomb/wave timers, the bomb in the
// world (planted with a blinking light and beeps, or dropped), plant/defuse with E,
// buy-time freeze, and end-of-stage choices.
import * as THREE from 'three';
import { MODES, BOMB, STAGES } from '../../shared/config.js';
import { audio } from './core/audio.js';
import { softDot } from './core/textures.js';

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function bombModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: '#3a3528', roughness: 0.7 }));
  body.position.y = 0.06;
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), new THREE.MeshStandardMaterial({ color: '#7a6a4a', roughness: 0.5, metalness: 0.3 }));
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 0.15, -0.07 + i * 0.07);
    g.add(pipe);
  }
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#103010', emissiveIntensity: 1 }));
  pad.position.set(0.06, 0.13, 0.12);
  g.add(pad);
  for (const [c, x] of [
    ['#c0392b', -0.1],
    ['#2471a3', -0.06],
    ['#f1c40f', -0.02]
  ]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 4, 10, Math.PI), new THREE.MeshStandardMaterial({ color: c }));
    w.position.set(x, 0.2, 0);
    g.add(w);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
  led.position.set(0.14, 0.14, 0.1);
  g.add(led);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ff3020', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(0.6);
  glow.position.copy(led.position);
  g.add(glow);
  g.userData = { led, glow };
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return g;
}

const QUICK = ['Follow me!', 'Enemy dey here!', 'I need help o!', 'Cover me!', 'Hold this place!', 'Well done, my guy!'];

export class ModeClient {
  constructor(game) {
    this.game = game;
  }

  start(info) {
    this.id = info.mode || 'conquest';
    this.def = MODES[this.id];
    this.st = info.modeState || { mode: this.id };
    this.game.hud.noRespawn = !this.def.respawn;
    this.bomb = null;
    this.nextBeep = 0;
    this.myAct = null;
    this.buildQuickChat();
  }

  apply(state) {
    if (state) this.st = state;
  }

  subscribe(on) {
    const g = this.game;
    on('round', (m) => {
      this.st = { ...this.st, round: m.round, phase: m.phase, phaseEnds: m.ends, carrier: m.carrier, planted: null, dropped: null };
      if (m.phase === 'freeze') {
        this.clearBomb();
        g.hud.callout(`ROUND ${m.round}`);
        g.hud.banner(`Buy time — round ${m.round}. ${g.side === 'out' ? 'Plant the bomb for A or B!' : 'Guard A and B!'}`, 3500);
      } else {
        g.hud.callout('GO! GO! GO!');
        audio.alert();
      }
    });
    on('roundEnd', (m) => {
      this.st = { ...this.st, phase: 'post' };
      const ours = m.winner === g.side;
      const why = { defused: 'Bomb don defuse', exploded: 'Bomb don burst', eliminated: 'Everybody don fall', time: 'Time don finish' }[m.why] || '';
      g.hud.callout(ours ? 'ROUND WIN!' : 'ROUND LOSS');
      g.hud.banner(`${why} · ${m.winner === 'sec' ? 'Security' : 'Outlaws'} take round ${m.round}`, 4500);
      this.myAct = null;
    });
    on('planted', (m) => {
      this.st = { ...this.st, phase: 'planted', planted: { x: m.x, z: m.z, site: m.site, explodeAt: m.explodeAt }, carrier: null, dropped: null };
      this.placeBomb(m.x, m.z, true);
      g.hud.banner(`💣 BOMB DON PLANT FOR ${m.site}!`, 4000);
      audio.alert();
    });
    on('defused', (m) => {
      if (this.bomb) this.bomb.planted = false;
      g.hud.toast(`${m.by} don defuse the bomb!`, 'good');
    });
    on('bombDrop', (m) => {
      this.st = { ...this.st, carrier: null, dropped: { x: m.x, z: m.z } };
      this.placeBomb(m.x, m.z, false);
      if (g.side === 'out') g.hud.toast('Bomb don fall! Go carry am.', 'bad');
    });
    on('bombPick', (m) => {
      this.st = { ...this.st, carrier: m.id, dropped: null };
      this.clearBomb();
    });
    on('act', (m) => {
      if (m.pid === g.myId) this.myAct = m.kind ? { kind: m.kind, start: m.start, dur: m.dur } : null;
      if (m.kind === 'defuse' && m.pid !== g.myId && g.side === 'out') g.hud.toast('Dem dey defuse the bomb!', 'bad', 2000);
    });
    on('wave', (m) => {
      this.st = { ...this.st, wave: m.wave, waves: m.waves, enemiesLeft: m.enemies, nextWaveAt: 0 };
      g.hud.callout(m.wave === m.waves ? 'LAST WAVE!' : `WAVE ${m.wave}`);
      audio.alert();
    });
    on('waveClear', (m) => {
      this.st = { ...this.st, nextWaveAt: m.next };
      g.hud.banner(`Wave ${m.wave} clear! Next one dey come…`, 4000);
    });
  }

  introTip() {
    const touch = this.game.touch;
    const buy = touch ? 'Tap ₦' : 'Press B';
    switch (this.id) {
      case 'tdm':
        return `Gbas Gbos! First team to ${this.def.scoreLimit} kills win. ${buy} to buy weapon.`;
      case 'bomb':
        return this.game.side === 'out' ? `Outlaws: carry the 💣 go A or B and hold E to plant. ${buy} to buy.` : `Security: stop dem or hold E for the bomb to defuse. ${buy} to buy.`;
      case 'stage': {
        const st = STAGES[this.st.stage || 0];
        return `${st.title}: ${st.story}`;
      }
      case 'practice':
        return `${buy} to pick any gun (all free here) · shoot the dummies · swim near the bank and sprint to train.`;
      default:
        return `${buy} to buy weapon · pick 💎 for advert walls · hold A, B and C`;
    }
  }

  frozen() {
    return this.id === 'bomb' && this.st.phase === 'freeze';
  }

  // E pressed or released. Returns true if the mode used it.
  useAction(down) {
    const g = this.game;
    if (this.id !== 'bomb') return false;
    if (!down) {
      if (this.myAct) g.net.send({ t: 'actStop' });
      this.myAct = null;
      return false;
    }
    const kind = this.availableAction();
    if (!kind) return false;
    g.net.send({ t: 'act', kind });
    return true;
  }

  availableAction() {
    const g = this.game;
    if (this.id !== 'bomb' || g.status !== 'alive' || this.frozen()) return null;
    const b = g.body;
    if (this.st.carrier === g.myId && !this.st.planted) {
      const site = (g.sites || []).find((s) => s.bomb && Math.hypot(b.x - s.x, b.z - s.z) <= s.r);
      if (site) return 'plant';
    }
    if (g.side === 'sec' && this.st.planted && Math.hypot(b.x - this.st.planted.x, b.z - this.st.planted.z) < BOMB.actionRange * 0.9) return 'defuse';
    return null;
  }

  prompt() {
    const k = this.availableAction();
    const key = this.game.touch ? '✚' : 'E';
    if (k === 'plant') return `<kbd>${key}</kbd> Hold make you plant bomb`;
    if (k === 'defuse') return `<kbd>${key}</kbd> Hold make you defuse bomb`;
    if (this.id === 'bomb' && this.st.carrier === this.game.myId) return '💣 You carry the bomb — go A or B';
    return null;
  }

  // Progress bar for my plant/defuse.
  progress(sNow) {
    if (!this.myAct) return null;
    const k = Math.min(1, (sNow - this.myAct.start) / this.myAct.dur);
    return [k, this.myAct.kind === 'plant' ? 'Dey plant bomb…' : 'Dey defuse bomb…'];
  }

  placeBomb(x, z, planted) {
    this.clearBomb();
    const m = bombModel();
    m.position.set(x, 0, z);
    m.rotation.y = Math.random() * 6;
    this.game.scene.add(m);
    this.bomb = { mesh: m, planted };
  }

  clearBomb() {
    if (this.bomb) this.game.scene?.remove(this.bomb.mesh);
    this.bomb = null;
  }

  // Per frame: mode bar, timers, bomb light and beeps.
  update(dt, sNow) {
    const g = this.game;
    const st = this.st;
    let bar = null;
    if (this.id === 'bomb') {
      const rounds = (st.history || []).map((w) => `<i class="${w}"></i>`).join('');
      const bomb = st.planted ? `<span class="bomb tick">💣 ${fmtTime(st.planted.explodeAt - sNow)}</span>` : st.carrier ? '<span>💣 carried</span>' : st.dropped ? '<span class="bomb">💣 for ground</span>' : '';
      bar = `<span>Round ${st.round || 1} · first to ${this.def.scoreLimit}</span><span class="rounds">${rounds}</span>${bomb}`;
      const t = st.phase === 'freeze' ? `BUY ${fmtTime(st.phaseEnds - sNow)}` : st.phase === 'planted' && st.planted ? fmtTime(st.planted.explodeAt - sNow) : st.phase === 'post' ? '—' : fmtTime((st.phaseEnds || sNow) - sNow);
      document.getElementById('timer').textContent = t;
      document.getElementById('timer').style.color = st.phase === 'planted' ? '#ff6a4a' : '';
    } else if (this.id === 'stage') {
      const next = st.nextWaveAt ? ` · next wave ${Math.max(0, Math.ceil((st.nextWaveAt - sNow) / 1000))}s` : '';
      bar = `<span>🎖 Stage ${(st.stage || 0) + 1}</span><span>🌊 Wave ${st.wave || 0}/${st.waves || '?'}</span><span>☠ ${st.enemiesLeft ?? 0} left</span><span>❤ ${st.livesLeft ?? '-'}</span>${next}`;
    } else if (this.id === 'tdm') bar = `<span>💥 Gbas Gbos · first to ${this.def.scoreLimit} kills</span>`;
    g.hud.modebar(bar);
    // Planted bomb: blinking light and beeps that speed up.
    if (this.bomb?.planted && st.planted) {
      const left = (st.planted.explodeAt - sNow) / 1000;
      const interval = Math.max(0.12, Math.min(1, left / 40));
      const { led, glow } = this.bomb.mesh.userData;
      const on = (sNow / 1000) % interval < interval * 0.35;
      led.visible = glow.visible = on;
      if (sNow >= this.nextBeep) {
        this.nextBeep = sNow + interval * 1000;
        audio.beep({ x: st.planted.x, y: 0.3, z: st.planted.z }, left < 5 ? 1400 : 1000);
      }
    }
  }

  // World labels: bomb carrier for teammates, dropped / planted bomb.
  labels(items) {
    const g = this.game;
    if (this.id !== 'bomb') return;
    const st = this.st;
    if (st.carrier && st.carrier !== g.myId && g.side === 'out') {
      const s = g.soldiers.get(st.carrier);
      if (s?.state) items.push({ x: s.state.x, y: s.state.y + 2.4, z: s.state.z, cls: 'gemmark', html: '💣' });
    }
    const b = st.planted || st.dropped;
    if (b) items.push({ x: b.x, y: 0.9, z: b.z, cls: 'site', html: `<span style="color:#ff6a4a">💣</span><small>${Math.round(Math.hypot(b.x - g.body.x, b.z - g.body.z))} m</small>`, clamp: true });
  }

  // Buttons on the end screen.
  endActions(m) {
    const g = this.game;
    const lobby = { label: 'Back to lobby', run: () => g.leave() };
    if (this.id !== 'stage') return [lobby];
    const i = m.modeState?.stage ?? this.st.stage ?? 0;
    const won = m.winner === 'sec';
    const acts = [];
    if (won && i + 1 < STAGES.length) acts.push({ label: `Next stage ▶`, primary: true, run: () => g.nextStage(i + 1) });
    acts.push({ label: won ? 'Play again' : 'Try again', primary: !won, run: () => g.nextStage(i) });
    acts.push(lobby);
    return acts;
  }

  buildQuickChat() {
    const box = document.getElementById('quickchat');
    box.innerHTML = '';
    QUICK.forEach((q, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${i + 1}</kbd>${q}`;
      b.onclick = () => this.sendQuick(i);
      box.appendChild(b);
    });
  }

  toggleQuick(on = document.getElementById('quickchat').hidden) {
    document.getElementById('quickchat').hidden = !on;
    this.quickOpen = on;
  }

  sendQuick(i) {
    this.game.net.send({ t: 'chat', text: QUICK[i], team: true });
    this.toggleQuick(false);
  }

  stop() {
    this.clearBomb();
    this.toggleQuick(false);
    this.game.hud.modebar(null);
    document.getElementById('timer').style.color = '';
  }
}
