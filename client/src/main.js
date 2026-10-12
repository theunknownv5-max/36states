// Boot → sign in → war map → battle. Wires the network, settings and screens together.
import * as THREE from 'three';
import { Boot } from './ui/boot.js';
import { WarMap } from './ui/warmap.js';
import { Net } from './core/net.js';
import { Input, isTouch } from './core/input.js';
import { audio } from './core/audio.js';
import { PRESETS, detectQuality, saveQuality } from './core/quality.js';
import * as T from './core/textures.js';
import { Game } from './game.js';
import { STATE_BY_ID } from '../../shared/states.js';
import { FACTIONS, RESPAWN, GEMS } from '../../shared/config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }
};

const qualityName = detectQuality();
const settings = {
  sensitivity: +store.get('36s.sens', isTouch() ? 1.3 : 1),
  fov: +store.get('36s.fov', 80),
  volume: +store.get('36s.vol', 0.8),
  quality: qualityName,
  invertY: store.get('36s.invert') === '1'
};

const boot = new Boot();
const net = new Net();
let renderer;
let game;
let warmap;
let lastJoin = null;
let lastSpawn = null;
let inGame = false;

function modal(html) {
  $('modal-card').innerHTML = html + '<p style="text-align:right;margin:16px 0 0"><button class="btn primary" id="modal-ok">OK</button></p>';
  $('modal').hidden = false;
  $('modal-ok').onclick = () => ($('modal').hidden = true);
}

function howToPlay() {
  modal(`<h2>How to play 36 States</h2>
  <p><b>Pick a state, pick what you are.</b> Security Forces (Police, Army, Civil Defence, Vigilante Hunters) fight the Outlaws (Bandits, Creek Militants, Smugglers). Bots fill each side up to five fighters, so every state is always at war.</p>
  <p><b>Hold the resources.</b> Each state has three sites — A, B and C — built from its real natural resources. Stand in a site to capture it. Held sites earn points and money every second. Mid-match, new deposits are discovered and are worth double.</p>
  <p><b>💎 Life gems.</b> Every advert wall carries a glowing gem. Walk into it for +1 life gem and some health. Once anyone takes it, that wall's gem is gone for <b>${GEMS.cooldownMs / 60000} minutes</b> for everybody.</p>
  <p><b>When you fall</b> you are first <b>downed</b> — a teammate has ${RESPAWN.downedMs / 1000} s to revive you. If you die, choose how to return to the war front:</p>
  <ul><li><b>Life gem</b> — spend 1 gem, redeploy instantly.</li><li><b>Spirit run</b> — ${RESPAWN.spiritMs / 1000} s as an invisible spirit; touch a glowing gem on any advert wall to come back free (it uses that gem up).</li><li><b>Medevac</b> — wait ${RESPAWN.medevacMs / 1000} s and pay ₦${RESPAWN.medevacFee.toLocaleString()}.</li></ul>
  <p><b>Controls:</b> WASD move · Shift sprint · Ctrl crouch · Z quiet walk · Space jump · Mouse fire/aim · R reload · 1/2/3 weapons · B buy · G grenade (4 to pick) · X first aid · E revive · 5 drone · 6 artillery · Tab scores · Y/U chat · Esc menu.</p>`);
}

async function preload() {
  boot.set(0.08, null);
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: PRESETS[settings.quality].antialias, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (e) {
    modal('<h2>3D graphics unavailable</h2><p>Your browser could not start WebGL. Try Chrome, Edge or Firefox with hardware acceleration switched on.</p>');
    throw e;
  }
  boot.set(0.2, null);
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))]);
  boot.set(0.35, null);
  // Warm the texture cache so the first battle opens faster.
  T.setTextureSize(PRESETS[settings.quality].textureSize >= 1024 ? 512 : 256);
  const steps = [T.concreteTexture, T.mudTexture, T.plasterTexture, T.sandbagTexture, T.zincTexture, T.crateTexture, T.rockTexture, T.barkTexture];
  for (let i = 0; i < steps.length; i++) {
    steps[i]();
    boot.set(0.35 + (i / steps.length) * 0.45, null);
    await new Promise((r) => setTimeout(r, 0));
  }
  try {
    const r = await fetch('/api/lobby');
    if (r.ok) boot.lobby = (await r.json()).states;
  } catch {
    /* server offline, will retry on connect */
  }
  boot.set(0.95, null);
}

// ---------- sign in ----------
function showAuth() {
  $('auth').hidden = false;
  let mode = store.get('36s.account') ? 'login' : 'guest';
  const setTab = (m) => {
    mode = m;
    for (const b of $('auth-tabs').children) b.classList.toggle('on', b.dataset.tab === m);
    for (const el of document.querySelectorAll('[data-for="guest"]')) el.hidden = m !== 'guest';
    for (const el of document.querySelectorAll('[data-for="account"]')) el.hidden = m === 'guest';
    $('acc-pass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('auth-go').textContent = m === 'register' ? 'Create account' : m === 'login' ? 'Log in' : 'Continue';
  };
  for (const b of $('auth-tabs').children) b.onclick = () => setTab(b.dataset.tab);
  setTab(mode);
  $('guest-name').value = store.get('36s.name', '');
  $('acc-user').value = store.get('36s.user', '');
  return new Promise((resolve) => {
    $('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      audio.unlock();
      $('auth-error').hidden = true;
      const hello =
        mode === 'guest'
          ? { name: $('guest-name').value.trim(), token: store.get('36s.token') || undefined }
          : { mode, username: $('acc-user').value.trim(), password: $('acc-pass').value };
      $('auth-go').disabled = true;
      const ok = await net.connect(hello);
      $('auth-go').disabled = false;
      if (!ok) {
        $('auth-error').textContent = 'Could not reach the game server. Check your connection and try again.';
        $('auth-error').hidden = false;
        return;
      }
      const off1 = net.on('welcome', (m) => {
        off1();
        off2();
        if (mode === 'guest') {
          store.set('36s.token', m.token);
          store.set('36s.name', m.profile.name);
        } else {
          store.set('36s.account', '1');
          store.set('36s.user', hello.username);
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
  $('p-name').textContent = p.name;
  $('p-rank').textContent = `${p.rank.name} · Lv ${p.rank.level}`;
  $('p-gems').textContent = p.gems;
  $('p-k').textContent = p.kills;
  $('p-d').textContent = p.deaths;
  $('p-w').textContent = p.wins;
}

let lobbyTimer;
function showLobby() {
  inGame = false;
  $('game').hidden = true;
  $('lobby').hidden = false;
  net.send({ t: 'lobby' });
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(() => !inGame && net.send({ t: 'lobby' }), 4000);
}

function deploy(state, faction) {
  audio.unlock();
  $('join-error').hidden = true;
  $('btn-deploy').disabled = true;
  $('btn-deploy').textContent = 'DEPLOYING…';
  lastJoin = { state, faction };
  lastSpawn = null;
  net.send({ t: 'join', state, faction });
}

function bindSettings() {
  const save = () => {
    store.set('36s.sens', settings.sensitivity);
    store.set('36s.fov', settings.fov);
    store.set('36s.vol', settings.volume);
    store.set('36s.invert', settings.invertY ? '1' : '');
  };
  $('set-sens').oninput = (e) => {
    settings.sensitivity = +e.target.value;
    input.sensitivity = settings.sensitivity;
    save();
  };
  $('set-fov').oninput = (e) => {
    settings.fov = +e.target.value;
    save();
  };
  $('set-vol').oninput = (e) => {
    settings.volume = +e.target.value;
    audio.setVolume(settings.volume);
    save();
  };
  $('set-invert').onchange = (e) => {
    settings.invertY = e.target.checked;
    input.invertY = settings.invertY;
    save();
  };
  $('set-quality').onchange = (e) => {
    settings.quality = e.target.value;
    saveQuality(settings.quality);
    if (game) game.quality = PRESETS[settings.quality];
    game?.hud.toast('Graphics change applies from your next deployment', 'info');
  };
  $('btn-how').onclick = howToPlay;
  $('btn-settings-lobby').onclick = () => {
    modal(`<h2>Settings</h2>
      <p><label>Mouse sensitivity <input type="range" id="ls-sens" min="0.2" max="3" step="0.05" value="${settings.sensitivity}"></label></p>
      <p><label>Volume <input type="range" id="ls-vol" min="0" max="1" step="0.05" value="${settings.volume}"></label></p>
      <p><label>Graphics <select id="ls-q">${Object.keys(PRESETS).map((k) => `<option value="${k}" ${k === settings.quality ? 'selected' : ''}>${PRESETS[k].name}</option>`).join('')}</select></label></p>`);
    $('ls-sens').oninput = (e) => {
      settings.sensitivity = +e.target.value;
      input.sensitivity = settings.sensitivity;
      save();
    };
    $('ls-vol').oninput = (e) => {
      settings.volume = +e.target.value;
      audio.setVolume(settings.volume);
      save();
    };
    $('ls-q').onchange = (e) => {
      settings.quality = e.target.value;
      saveQuality(settings.quality);
      if (game) game.quality = PRESETS[settings.quality];
    };
  };
}

const input = new Input($('view'));
input.sensitivity = settings.sensitivity;
input.invertY = settings.invertY;
audio.setVolume(settings.volume);

(async () => {
  await preload();
  await boot.ready();
  audio.unlock();
  boot.hide();
  bindSettings();
  warmap = new WarMap({ onDeploy: deploy });
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
    onLeave: () => showLobby()
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
    $('join-error').textContent = m.error;
    $('join-error').hidden = false;
    warmap.renderInfo();
  });
  net.on('spawn', (m) => (lastSpawn = m));
  net.on('matchInfo', (m) => {
    if (inGame && game.stateId === m.state) return; // a new round in the same battle
    inGame = true;
    clearInterval(lobbyTimer);
    $('lobby').hidden = true;
    $('game').hidden = false;
    game.quality = PRESETS[settings.quality];
    game.start(m);
    if (lastSpawn) game.onSpawn(lastSpawn);
    warmap.renderInfo();
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
  // Deep link: ?state=lagos&as=police deploys straight away.
  const qs = new URLSearchParams(location.search);
  const st = qs.get('state');
  if (st && STATE_BY_ID[st]) {
    warmap.select(st);
    const as = qs.get('as');
    if (as && FACTIONS[as]) {
      warmap.faction = as;
      warmap.renderInfo();
      deploy(st, as);
    }
  }
  if (!store.get('36s.seenHelp') && !lastJoin) {
    store.set('36s.seenHelp', '1');
    howToPlay();
  }
})();
