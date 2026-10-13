// Proof of Duty — boot → sign in → lobby (modes, war map, campaign) → battle.
// Wires the network, settings, music and screens together.
import * as THREE from 'three';
import { Boot } from './ui/boot.js';
import { WarMap } from './ui/warmap.js';
import { Net } from './core/net.js';
import { Input, isTouch } from './core/input.js';
import { audio } from './core/audio.js';
import { music } from './core/music.js';
import { PRESETS, detectQuality, saveQuality } from './core/quality.js';
import * as T from './core/textures.js';
import { Game } from './game.js';
import { api, IS_APP } from './core/server.js';
import { STATE_BY_ID } from '../../shared/states.js';
import { FACTIONS, RESPAWN, GEMS, GAME, MODES, BOMB } from '../../shared/config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Settings and identity live in localStorage (older "36s." keys are still read).
const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(`pod.${k}`) ?? localStorage.getItem(`36s.${k}`) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`pod.${k}`, v);
    } catch {
      /* storage blocked */
    }
  }
};

const settings = {
  sensitivity: +store.get('sens', isTouch() ? 1.3 : 1),
  fov: +store.get('fov', 80),
  volume: +store.get('vol', 0.8),
  music: +store.get('music', 0.5),
  musicOn: store.get('musicOn', '1') === '1',
  gunsOn: store.get('gunsOn', '1') === '1',
  touchSens: +store.get('touch', 1),
  quality: detectQuality(),
  invertY: store.get('invert') === '1'
};

document.title = `${GAME.name}`;
const boot = new Boot();
const net = new Net();
let renderer;
let game;
let warmap;
let lastJoin = null;
let lastSpawn = null;
let inGame = false;
let profile = null;

function modal(html) {
  $('modal-card').innerHTML = html + '<p style="text-align:right;margin:16px 0 0"><button class="btn primary" id="modal-ok">I don hear</button></p>';
  $('modal').hidden = false;
  $('modal-ok').onclick = () => ($('modal').hidden = true);
}

function howToPlay() {
  modal(`<h2>How to play Proof of Duty</h2>
  <p><b>Pick mode, pick state, pick wetin you be.</b> Security Forces (Police, Army, Civil Defence, Vigilante Hunters) dey fight Outlaws (Bandits, Creek Militants, Smugglers). Bots go fill each side so war always dey.</p>
  <p><b>Game modes:</b></p>
  <ul>
    <li>${MODES.conquest.icon} <b>${MODES.conquest.label}</b> — ${esc(MODES.conquest.blurb)}</li>
    <li>${MODES.tdm.icon} <b>${MODES.tdm.label}</b> — ${esc(MODES.tdm.blurb)}</li>
    <li>${MODES.bomb.icon} <b>${MODES.bomb.label}</b> — ${esc(MODES.bomb.blurb)} Hold <b>E</b> to plant (${BOMB.plantSecs}s) or defuse (${BOMB.defuseSecs}s).</li>
    <li>${MODES.stage.icon} <b>${MODES.stage.label}</b> — ${esc(MODES.stage.blurb)}</li>
  </ul>
  <p><b>💎 Life gems.</b> Every advert wall get gem wey dey shine. Waka enter am: +1 life gem and small health. Once person take am, nobody fit take that one again for <b>${GEMS.cooldownMs / 60000} minutes</b>.</p>
  <p><b>If you fall</b>, your person get ${RESPAWN.downedMs / 1000} seconds to revive you. If you die, choose how you go come back:</p>
  <ul><li><b>Life gem</b> — use 1 gem, land back sharp sharp.</li><li><b>Spirit run</b> — ${RESPAWN.spiritMs / 1000} seconds as invisible spirit; touch any gem wey dey shine make you come back free.</li><li><b>Medevac</b> — wait ${RESPAWN.medevacMs / 1000} seconds, pay ₦${RESPAWN.medevacFee.toLocaleString()}.</li></ul>
  <p><b>Fuel drums:</b> red drum wey write PMS go burst if you shoot am. Anybody wey dey near go chop am.</p>
  <p><b>Controls:</b> WASD waka · Shift run · Ctrl bend down · Z waka quiet · Space jump · Mouse shoot/aim · R reload · 1/2/3 weapons · B buy · G grenade (4 to pick) · X first aid · E revive/plant/defuse · V quick talk · 5 drone · 6 artillery · Tab scores · Y/U chat · Esc menu. For phone, the buttons dey for screen.</p>`);
}

function showSheet(id, on = true) {
  $(id).hidden = !on;
}
for (const b of document.querySelectorAll('[data-close-sheet]')) b.onclick = () => showSheet(b.dataset.closeSheet, false);
for (const s of document.querySelectorAll('.sheet')) s.addEventListener('click', (e) => e.target === s && showSheet(s.id, false));

function openAbout() {
  $('about-text').textContent = GAME.about;
  $('about-version').textContent = GAME.version;
  showSheet('about');
}

async function openLeaderboard() {
  showSheet('top');
  const t = $('top-table');
  t.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  try {
    const r = await fetch(api('/api/leaderboard'));
    const { top } = await r.json();
    t.innerHTML =
      '<tr><th>#</th><th>Soldier</th><th>Rank</th><th>XP</th><th>Kills</th><th>Wins</th></tr>' +
      (top.length
        ? top.map((p, i) => `<tr class="${p.name === profile?.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.rank)}</td><td>${p.xp.toLocaleString()}</td><td>${p.kills}</td><td>${p.wins}</td></tr>`).join('')
        : '<tr><td colspan="6">Nobody never enter list yet. Na your chance be this!</td></tr>');
  } catch {
    t.innerHTML = '<tr><td colspan="6">Network wahala. Try again.</td></tr>';
  }
}

// ---------- settings (one panel for lobby and pause menu) ----------
function saveSettings() {
  store.set('sens', settings.sensitivity);
  store.set('fov', settings.fov);
  store.set('vol', settings.volume);
  store.set('invert', settings.invertY ? '1' : '');
  store.set('music', settings.music);
  store.set('musicOn', settings.musicOn ? '1' : '0');
  store.set('gunsOn', settings.gunsOn ? '1' : '0');
  store.set('touch', settings.touchSens);
}

function openSettings() {
  $('set-music-on').checked = settings.musicOn;
  $('set-music').value = settings.music;
  $('set-guns-on').checked = settings.gunsOn;
  $('set-vol').value = settings.volume;
  $('set-sens').value = settings.sensitivity;
  $('set-touch').value = settings.touchSens;
  $('set-invert').checked = settings.invertY;
  $('set-quality').value = settings.quality;
  $('set-fov').value = settings.fov;
  $('set-note').textContent = '';
  showSheet('settings');
}

function bindSettings() {
  const on = (id, ev, fn) =>
    $(id).addEventListener(ev, (e) => {
      fn(e.target);
      saveSettings();
    });
  on('set-music-on', 'change', (t) => {
    settings.musicOn = t.checked;
    music.setEnabled(t.checked);
  });
  on('set-music', 'input', (t) => {
    settings.music = +t.value;
    music.setVolume(settings.music);
  });
  on('set-guns-on', 'change', (t) => {
    settings.gunsOn = t.checked;
    audio.gunsOn = t.checked;
  });
  on('set-vol', 'input', (t) => {
    settings.volume = +t.value;
    audio.setVolume(settings.volume);
  });
  on('set-sens', 'input', (t) => {
    settings.sensitivity = +t.value;
    input.sensitivity = settings.sensitivity;
  });
  on('set-touch', 'input', (t) => {
    settings.touchSens = +t.value;
    input.touchSens = settings.touchSens;
  });
  on('set-invert', 'change', (t) => {
    settings.invertY = t.checked;
    input.invertY = settings.invertY;
  });
  on('set-fov', 'input', (t) => {
    settings.fov = +t.value;
  });
  on('set-quality', 'change', (t) => {
    settings.quality = t.value;
    saveQuality(settings.quality);
    if (game) game.quality = PRESETS[settings.quality];
    $('set-note').textContent = inGame ? 'New graphics go start from your next deploy.' : 'Saved.';
  });
  $('btn-how').onclick = howToPlay;
  $('btn-about').onclick = openAbout;
  $('btn-top').onclick = openLeaderboard;
  $('btn-settings-lobby').onclick = openSettings;
  $('btn-settings-game').onclick = openSettings;
}

async function preload() {
  boot.set(0.06);
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: PRESETS[settings.quality].antialias, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (e) {
    modal('<h2>3D graphics no dey work</h2><p>Your browser no fit start WebGL. Try Chrome, Edge or Firefox, and make sure hardware acceleration dey on.</p>');
    throw e;
  }
  boot.set(0.15);
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
  boot.set(0.3);
  // Warm the texture cache so the first battle opens faster.
  const q = PRESETS[settings.quality];
  T.setTextureSize(q.textureSize >= 2048 ? 1024 : q.textureSize >= 1024 ? 512 : 256);
  const steps = [T.concreteTexture, T.mudTexture, T.plasterTexture, T.sandbagTexture, T.zincTexture, T.crateTexture, T.rockTexture, T.barkTexture, T.fuelDrumTexture, T.waterDrumTexture];
  for (let i = 0; i < steps.length; i++) {
    steps[i]();
    boot.set(0.3 + (i / steps.length) * 0.5);
    await new Promise((r) => setTimeout(r, 0));
  }
  try {
    const r = await fetch(api('/api/lobby'));
    if (r.ok) boot.lobby = (await r.json()).states;
  } catch {
    /* server offline, will retry on connect */
  }
  // Let the cinematic play for at least a few seconds.
  const minShow = 3800 - (performance.now() - boot.t0);
  if (minShow > 0) {
    boot.set(0.9);
    await new Promise((r) => setTimeout(r, minShow));
  }
}

// ---------- sign in ----------
function showAuth() {
  $('auth').hidden = false;
  let mode = store.get('account') ? 'login' : 'guest';
  const setTab = (m) => {
    mode = m;
    for (const b of $('auth-tabs').children) b.classList.toggle('on', b.dataset.tab === m);
    for (const el of document.querySelectorAll('[data-for="guest"]')) el.hidden = m !== 'guest';
    for (const el of document.querySelectorAll('[data-for="account"]')) el.hidden = m === 'guest';
    $('acc-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('auth-go').textContent = m === 'register' ? 'Open account' : m === 'login' ? 'Log in' : 'Continue';
  };
  for (const b of $('auth-tabs').children) b.onclick = () => setTab(b.dataset.tab);
  setTab(mode);
  $('guest-name').value = store.get('name', '');
  $('acc-user').value = store.get('user', '');
  return new Promise((resolve) => {
    $('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      audio.unlock();
      $('auth-error').hidden = true;
      const hello =
        mode === 'guest'
          ? { name: $('guest-name').value.trim(), token: store.get('token') || undefined }
          : { mode, username: $('acc-user').value.trim(), password: $('acc-pass').value };
      $('auth-go').disabled = true;
      const ok = await net.connect(hello);
      $('auth-go').disabled = false;
      if (!ok) {
        $('auth-error').textContent = 'We no fit reach the game server. Check your network and try again.';
        $('auth-error').hidden = false;
        return;
      }
      const off1 = net.on('welcome', (m) => {
        off1();
        off2();
        if (mode === 'guest') {
          store.set('token', m.token);
          store.set('name', m.profile.name);
        } else {
          store.set('account', '1');
          store.set('user', hello.username);
        }
        $('auth').hidden = true;
        resolve(m);
      });
      const off2 = net.on('authError', (m) => {
        off1();
        off2();
        $('auth-error').textContent = m.error;
        $('auth-error').hidden = false;
        net.close();
      });
    };
  });
}

// ---------- lobby ----------
function showProfile(p) {
  if (!p) return;
  profile = p;
  $('p-name').textContent = p.name;
  $('p-rank').textContent = `${p.rank.name} · Lv ${p.rank.level}`;
  $('p-gems').textContent = p.gems;
  $('p-k').textContent = p.kills;
  $('p-d').textContent = p.deaths;
  $('p-w').textContent = p.wins;
  warmap?.setProfile(p);
}

let lobbyTimer;
function showLobby() {
  inGame = false;
  $('game').hidden = true;
  $('lobby').hidden = false;
  music.play('menu');
  net.send({ t: 'lobby' });
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(() => !inGame && net.send({ t: 'lobby' }), 4000);
  if (warmap?.selected) warmap.renderInfo();
}

// On phones (in the browser) go full screen and hold landscape, like a real mobile shooter.
function goFullscreen() {
  if (!isTouch() || IS_APP) return;
  const el = document.documentElement;
  const p = el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.();
  Promise.resolve(p)
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

function join(msg) {
  audio.unlock();
  goFullscreen();
  music.loadTrack();
  lastJoin = msg;
  lastSpawn = null;
  net.send({ t: 'join', ...msg });
}

function deploy(state, faction, mode) {
  $('join-error').hidden = true;
  $('btn-deploy').disabled = true;
  $('btn-deploy').textContent = 'DEPLOYING…';
  join({ state, faction, mode });
}

function startStage(stage) {
  $('stage-error').hidden = true;
  $('btn-stage').disabled = true;
  $('btn-stage').textContent = 'LOADING STAGE…';
  join({ mode: 'stage', stage });
}

const input = new Input($('view'));
input.sensitivity = settings.sensitivity;
input.invertY = settings.invertY;
input.touchSens = settings.touchSens;
audio.setVolume(settings.volume);
audio.gunsOn = settings.gunsOn;

// Pause all sound when the app or tab goes to the background.
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.ctx.resume();
});

(async () => {
  await preload();
  await boot.ready();
  audio.unlock();
  music.setVolume(settings.music);
  music.setEnabled(settings.musicOn);
  music.play('menu');
  music.loadTrack();
  boot.hide();
  bindSettings();
  warmap = new WarMap({ onDeploy: deploy, onStage: startStage });
  if (boot.lobby) warmap.setLobby(boot.lobby);
  const welcome = await showAuth();
  showProfile(welcome.profile);
  warmap.setLobby(welcome.lobby);
  game = new Game({
    renderer,
    net,
    input,
    quality: PRESETS[settings.quality],
    settings,
    onLeave: () => showLobby(),
    onNextStage: (i) => startStage(i)
  });
  if (new URLSearchParams(location.search).has('debug')) {
    window.__game = game;
    window.__THREE = THREE;
    import('../../shared/map.js').then((m) => (window.__findPath = m.findPath));
  }
  net.on('lobby', (m) => {
    warmap.setLobby(m.states);
    showProfile(m.profile);
  });
  net.on('joinError', (m) => {
    const id = lastJoin?.mode === 'stage' ? 'stage-error' : 'join-error';
    $(id).textContent = m.error;
    $(id).hidden = false;
    $('btn-stage').disabled = false;
    if (warmap.mode === 'stage') warmap.renderStages();
    else warmap.renderInfo();
  });
  net.on('spawn', (m) => (lastSpawn = m));
  net.on('matchInfo', (m) => {
    // A new round of the same battle: the game handles it.
    if (inGame && game.stateId === m.state && game.modeId === m.mode && !game.restart) return;
    game.restart = false;
    inGame = true;
    clearInterval(lobbyTimer);
    for (const s of document.querySelectorAll('.sheet')) s.hidden = true;
    $('lobby').hidden = true;
    $('game').hidden = false;
    $('btn-stage').disabled = false;
    game.quality = PRESETS[settings.quality];
    game.start(m);
    music.play('battle');
    if (lastSpawn) game.onSpawn(lastSpawn);
  });
  // After a dropped connection, rejoin the same battle.
  net.on('welcome', (m) => {
    showProfile(m.profile);
    if (inGame && lastJoin) {
      inGame = false;
      net.send({ t: 'join', ...lastJoin });
    }
  });
  net.on('status', (online) => game?.hud.net(net.rtt | 0, online));
  net.on('ping', (rtt) => game?.hud.net(rtt, true));
  showLobby();
  // Deep link: ?state=lagos&as=police[&mode=tdm] deploys straight away; ?stage=1 starts a stage.
  const qs = new URLSearchParams(location.search);
  const st = qs.get('state');
  if (qs.has('stage')) startStage(+qs.get('stage') || 0);
  else if (st && STATE_BY_ID[st]) {
    const mode = MODES[qs.get('mode')] ? qs.get('mode') : warmap.mode === 'stage' ? 'conquest' : warmap.mode;
    warmap.setMode(mode);
    warmap.select(st);
    const as = qs.get('as');
    if (as && FACTIONS[as]) {
      warmap.faction = as;
      warmap.renderInfo();
      deploy(st, as, mode);
    }
  }
  if (!store.get('seenHelp') && !lastJoin) {
    store.set('seenHelp', '1');
    howToPlay();
  }
})();
