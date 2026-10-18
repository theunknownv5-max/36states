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
import { InboxUI, toast } from './ui/chat.js';
import { Notices } from './ui/notices.js';
import { api, IS_APP } from './core/server.js';
import { regionById, ccOf, COUNTRY_BY_CC, flagOf } from '../../shared/regions.js';
import { CountryPicker, loadCountry, savedCountry } from './ui/countries.js';
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
  invertY: store.get('invert') === '1',
  view: store.get('view', 'fp') === 'chase' ? 'chase' : 'fp', // hands only (default) or full body
  bots: store.get('bots', '1') === '1' // off = rooms with real players only
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
  $('modal-card').innerHTML = html + '<p style="text-align:right;margin:16px 0 0"><button class="btn primary" id="modal-ok">Got it</button></p>';
  $('modal').hidden = false;
  $('modal-ok').onclick = () => ($('modal').hidden = true);
}

function howToPlay() {
  modal(`<h2>How to play Proof of Duty</h2>
  <p><b>Pick a mode, pick a region, pick your side.</b> Security Forces (Police, Army, Civil Defence, Vigilante Hunters) fight the Outlaws (Bandits, Creek Militants, Smugglers). Bots fill each side so there is always a battle.</p>
  <p><b>Game modes:</b></p>
  <ul>
    <li>${MODES.conquest.icon} <b>${MODES.conquest.label}</b> — ${esc(MODES.conquest.blurb)}</li>
    <li>${MODES.tdm.icon} <b>${MODES.tdm.label}</b> — ${esc(MODES.tdm.blurb)}</li>
    <li>${MODES.bomb.icon} <b>${MODES.bomb.label}</b> — ${esc(MODES.bomb.blurb)} Hold <b>E</b> to plant (${BOMB.plantSecs}s) or defuse (${BOMB.defuseSecs}s).</li>
    <li>${MODES.stage.icon} <b>${MODES.stage.label}</b> — ${esc(MODES.stage.blurb)}</li>
  </ul>
  <p><b>💎 Life gems.</b> Every advert wall has a glowing gem. Walk into it: +1 life gem and some health. Once someone takes it, nobody else can take that one for <b>${GEMS.cooldownMs / 60000} minutes</b>.</p>
  <p><b>If you fall</b>, a teammate has ${RESPAWN.downedMs / 1000} seconds to revive you. If you die, choose how to come back:</p>
  <ul><li><b>Life gem</b> — use 1 gem and respawn at once.</li><li><b>Spirit run</b> — ${RESPAWN.spiritMs / 1000} seconds as an invisible spirit; touch any glowing gem to come back free.</li><li><b>Medevac</b> — wait ${RESPAWN.medevacMs / 1000} seconds, pay ₦${RESPAWN.medevacFee.toLocaleString()}.</li></ul>
  <p><b>Vehicles and fire:</b> E to enter any car, bus, tricycle or motorbike and drive it. Armoured carriers are rare: bullets cannot reach you inside. RPGs and C4 (P to stick, L to detonate) can burn vehicles and houses to the ground. K calls an ambulance when you are wounded (₦1,500).</p>
  <p><b>Underground and tombs:</b> Find the big dome: stairs inside lead down to a tunnel that reaches the catacomb under the cemetery. Hold E at a grave or tomb to dig it out: the Golden AK, Thunder .50, Drum Launcher, Ancestor's Dane Gun or heavy armour could be inside (or only bones 💀).</p>
  <p><b>Fuel drums:</b> red drums marked PMS explode when shot. Anyone nearby gets caught in the blast.</p>
  <p><b>Controls:</b> WASD move · Shift sprint · Ctrl crouch · Z walk quietly · Space jump · Mouse shoot/aim · R reload · 1/2/3 weapons · B buy · G grenade (4 to pick) · X first aid · E revive/plant/defuse · V quick talk · 5 drone · 6 artillery · Tab scores · Y/U chat · Esc menu. On phones, the buttons are on screen.</p>`);
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
        : '<tr><td colspan="6">Nobody is on the list yet. This is your chance!</td></tr>');
  } catch {
    t.innerHTML = '<tr><td colspan="6">Network problem. Try again.</td></tr>';
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
  store.set('view', settings.view);
  store.set('bots', settings.bots ? '1' : '0');
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
  $('set-view').value = settings.view;
  $('set-bots').checked = settings.bots;
  $('set-note').textContent = '';
  window.__notices?.syncPushSwitch();
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
  on('set-view', 'change', (t) => {
    settings.view = t.value === 'chase' ? 'chase' : 'fp';
    saveSettings();
    game?.cams?.setView(settings.view);
  });
  on('set-bots', 'change', (t) => {
    settings.bots = t.checked;
    saveSettings();
    $('set-note').textContent = settings.bots ? 'Bots will fill empty places in your next battle.' : 'Next battle: real players only. No bots at all.';
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
    $('set-note').textContent = inGame ? 'New graphics apply from your next deploy.' : 'Saved.';
  });
  // One tap back to how the game came out of the box (notifications are left as they are).
  $('set-reset').onclick = () => {
    if (!confirm('Reset sound, controls, camera, bots and graphics to default?')) return;
    try {
      localStorage.removeItem('36s.quality');
    } catch {
      /* storage blocked */
    }
    Object.assign(settings, { sensitivity: isTouch() ? 1.3 : 1, fov: 80, volume: 0.8, music: 0.5, musicOn: true, gunsOn: true, touchSens: 1, invertY: false, view: 'fp', bots: true });
    settings.quality = detectQuality();
    saveSettings();
    audio.setVolume(settings.volume);
    audio.gunsOn = settings.gunsOn;
    music.setVolume(settings.music);
    music.setEnabled(settings.musicOn);
    input.sensitivity = settings.sensitivity;
    input.touchSens = settings.touchSens;
    input.invertY = settings.invertY;
    game?.cams?.setView('fp');
    if (game) game.quality = PRESETS[settings.quality];
    warmap?.renderInfo();
    openSettings();
    $('set-note').textContent = 'All settings are back to default.';
  };
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
    modal('<h2>3D graphics are not working</h2><p>Your browser could not start WebGL. Try Chrome, Edge or Firefox, and make sure hardware acceleration is on.</p>');
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
  // Phones: keep the field you are typing in (and the button) above the keyboard.
  for (const el of document.querySelectorAll('#auth-form input'))
    el.addEventListener('focus', () => setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));
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
        $('auth-error').textContent = 'We cannot reach the game server. Check your network and try again.';
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
// ---------- squad: friends, crew, rivals ----------
let squad = null;
let squadTab = 'friends';
let crewUnread = 0;
function badgeCrew() {
  const n = (squad?.requests?.length || 0) + crewUnread;
  $('squad-badge').hidden = !n;
  $('squad-badge').textContent = n;
}
function setupSquad() {
  const badge = badgeCrew;
  net.on('social', (m) => {
    squad = m.social;
    badge();
    const note = $('squad-note');
    note.hidden = !(m.note || m.error);
    note.className = `squad-note ${m.error ? 'bad' : ''}`;
    note.textContent = m.error || m.note || '';
    if (!$('squad').hidden) renderSquad();
  });
  net.on('crewMsg', (m) => {
    if (squad?.crew) {
      squad.crew.chat = [...(squad.crew.chat || []), m.msg].slice(-60);
      if (!$('squad').hidden && squadTab === 'crew' && crewTab === 'chat') {
        const box = $('crew-chat');
        if (box) {
          box.outerHTML = crewPane(squad).split('<form')[0];
          $('crew-chat').scrollTop = 1e6;
        }
      }
    }
    if (m.msg.mine) return;
    if (inGame && game.running) game.hud.toast(`[${m.tag}] ${m.msg.from}: ${m.msg.text}`, 'info', 4500);
    else if ($('squad').hidden) {
      crewUnread++;
      badgeCrew();
      toast(`💬 [${m.tag}] ${m.msg.from}: ${m.msg.text.slice(0, 80)}`);
    }
  });
  net.on('friendWhere', (m) => {
    showSheet('squad', false);
    warmap.setMode(m.mode);
    warmap.select(m.state);
    toast(`Joining ${m.name}…`);
    join({ state: m.state, faction: m.faction, mode: m.mode, bots: !m.real });
  });
  $('btn-squad').onclick = () => {
    crewUnread = 0;
    badgeCrew();
    showSheet('squad');
    renderSquad();
    net.send({ t: 'social' });
  };
  for (const b of document.querySelectorAll('.squad-tabs button'))
    b.onclick = () => {
      squadTab = b.dataset.tab;
      for (const x of document.querySelectorAll('.squad-tabs button')) x.classList.toggle('on', x === b);
      renderSquad();
    };
  $('squad-body').addEventListener('submit', (e) => {
    if (e.target.id !== 'crew-form') return;
    e.preventDefault();
    const v = $('crew-input').value.trim();
    if (v) net.send({ t: 'crewChat', text: v });
    $('crew-input').value = '';
  });
  $('squad-body').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ct]');
    if (tab) {
      crewTab = tab.dataset.ct;
      renderSquad();
      return;
    }
    const idea = e.target.closest('[data-idea]');
    if (idea) {
      const ta = $('crew-plan');
      ta.value = (ta.value ? ta.value.trimEnd() + '\n' : '') + '• ' + idea.dataset.idea;
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'crewPlan') return net.send({ t: 'crewPlan', text: $('crew-plan').value });
    if (a === 'practice') {
      showSheet('squad', false);
      const st = warmap.selected || 'lagos';
      toast('🎯 Opening the practice range…');
      return join({ mode: 'practice', state: st, faction: warmap.faction || 'police' });
    }
    if (a === 'copy') {
      navigator.clipboard?.writeText(b.dataset.code).catch(() => {});
      return toast(`Copied ${b.dataset.code}`);
    }
    if (a === 'add') return net.send({ t: 'friendAdd', code: $('sq-code').value });
    if (a === 'createCrew') return net.send({ t: 'crewCreate', name: $('sq-crew-name').value, tag: $('sq-crew-tag').value });
    if (a === 'joinCrew') return net.send({ t: 'crewJoin', code: $('sq-crew-code').value });
    if (a === 'crewLeave') return confirm('Leave this crew?') && net.send({ t: 'crewLeave' });
    net.send({ t: a, code: b.dataset.code });
  });
  net.send({ t: 'social' });
}

const MODE_NAMES = { conquest: 'Hold Ground', tdm: 'Team Deathmatch', bomb: 'Plant & Defuse', practice: 'Practice Range' };
let crewTab = 'chat';
const PLAN_IDEAS = ['Rush A together on 3', 'Two snipers on the roofs, rest push B', 'Hold the dome and the tunnel', 'Drive the jeep, drop us by the site', 'Smoke, flash, then entry', 'Everybody stay with the medic'];
const timeAgo = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const bar = (v, mark) => `<span class="skill-bar"><i style="width:${Math.min(100, v)}%"></i>${mark ? `<b style="left:${mark}%"></b>` : ''}</span>`;
function crewPane(s) {
  const c = s.crew;
  if (crewTab === 'chat')
    return `<div class="crew-chat" id="crew-chat">${(c.chat || []).length ? c.chat.map((m) => `<div class="cm ${m.mine ? 'mine' : ''}"><b>${esc(m.from)}</b><span>${esc(m.text)}</span><small>${timeAgo(m.at)}</small></div>`).join('') : '<p class="muted">The crew room is quiet. Talk to your people: plan the next battle, set a time, catch up.</p>'}</div>
      <form class="sq-row" id="crew-form"><input id="crew-input" maxlength="300" placeholder="Talk to your crew…" autocomplete="off"><button class="btn primary">Send</button></form>`;
  if (crewTab === 'plan')
    return `<p class="muted">The crew battle plan. Everyone can see it and edit it.</p>
      <textarea id="crew-plan" maxlength="1200" rows="6" placeholder="Who goes where, who carries what, the signal to move…">${esc(c.plan?.text || '')}</textarea>
      ${c.plan ? `<small class="muted">Last change by ${esc(c.plan.by)} · ${timeAgo(c.plan.at)} ago</small>` : ''}
      <div class="plan-ideas">${PLAN_IDEAS.map((t) => `<button class="btn ghost sm" data-idea="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>
      <button class="btn primary" data-act="crewPlan">Save plan</button>`;
  if (crewTab === 'train')
    return `<div class="train-me">
        <div><b>🏊 Swimming</b> ${s.skills.swim}/100 ${bar(s.skills.swim, 30)}<small>${s.skills.swim >= 70 ? 'Strong swimmer: fast in water.' : s.skills.swim >= 30 ? 'You can swim in deep water.' : 'Under 30 you drown in deep rivers. Swim near the bank to learn.'}</small></div>
        <div><b>💪 Fitness</b> ${s.skills.fitness}/100 ${bar(s.skills.fitness)}<small>Sprint to train. Each point means a longer sprint and a little extra pace.</small></div>
      </div>
      <p class="muted">🎯 <b>Practice Range</b>: private ground for your crew only. Target dummies that never shoot back, all guns free, instant respawn, and training counts <b>3x</b>. Spar with your crew mates too. Nothing counts towards your record.</p>
      <button class="btn primary" data-act="practice">🎯 Open the crew practice range</button>`;
  return c.members
    .sort((a, b) => b.online - a.online)
    .map((f) => `<div class="sq-person"><i class="dot ${f.online ? 'on' : ''}"></i><div><b>${esc(f.name)}</b><small>${esc(f.where ? `⚔ ${MODE_NAMES[f.where.mode] || f.where.mode} · ${regionName(f.where.state)}` : f.online ? 'Online · in the lobby' : 'Offline')} · 🏊 ${f.swim} · 💪 ${f.fitness}</small></div><div class="sq-acts">${f.where && f.code !== s.code ? `<button class="btn primary" data-act="joinFriend" data-code="${f.code}">Join</button>` : ''}</div></div>`)
    .join('') + '<button class="btn danger" data-act="crewLeave" style="margin-top:12px">Leave crew</button>';
}
function renderSquad() {
  const s = squad;
  const body = $('squad-body');
  if (!s) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    return;
  }
  const person = (f, actions) => {
    const where = f.where ? `⚔ ${MODE_NAMES[f.where.mode] || f.where.mode} · ${regionName(f.where.state)}${f.where.real ? ' · real players' : ''}` : f.online ? 'Online · in the lobby' : 'Offline';
    return `<div class="sq-person"><i class="dot ${f.online ? 'on' : ''}"></i><div><b>${f.tag ? `[${esc(f.tag)}] ` : ''}${esc(f.name)}</b><small>${esc(where)}</small></div><div class="sq-acts">${actions}</div></div>`;
  };
  if (squadTab === 'friends') {
    body.innerHTML = `
      <div class="sq-code">Your friend code <b>${esc(s.code)}</b> <button class="btn ghost" data-act="copy" data-code="${esc(s.code)}">Copy</button></div>
      <div class="sq-row"><input id="sq-code" placeholder="Friend code, e.g. POD-7K3QX" maxlength="12" autocomplete="off"><button class="btn primary" data-act="add">Add friend</button></div>
      ${s.requests.length ? `<h4>Requests</h4>${s.requests.map((f) => person(f, `<button class="btn primary" data-act="friendAccept" data-code="${f.code}">Accept</button><button class="btn ghost" data-act="friendDecline" data-code="${f.code}">No</button>`)).join('')}` : ''}
      <h4>Friends (${s.friends.length})</h4>
      ${s.friends.length ? s.friends.sort((a, b) => b.online - a.online).map((f) => person(f, `${f.where ? `<button class="btn primary" data-act="joinFriend" data-code="${f.code}">Join</button>` : ''}<button class="btn ghost" data-act="friendRemove" data-code="${f.code}" title="Remove">✕</button>`)).join('') : '<p class="muted">Share your code with your people. When they add you, you can see when they are fighting and jump into the same battle.</p>'}`;
  } else if (squadTab === 'crew') {
    const c = s.crew;
    body.innerHTML = c
      ? `<div class="sq-code">[${esc(c.tag)}] <b>${esc(c.name)}</b> · code <b>${esc(c.code)}</b> <button class="btn ghost" data-act="copy" data-code="${esc(c.code)}">Copy</button></div>
         <div class="crew-tabs">${[['chat', '💬 Chat'], ['plan', '🗺 Tactics'], ['train', '🏋 Training'], ['members', `👥 Members (${c.members.length})`]].map(([k, l]) => `<button data-ct="${k}" class="${crewTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
         <div id="crew-pane">${crewPane(s)}</div>`
      : `<h4>Start a crew</h4><div class="sq-row"><input id="sq-crew-name" placeholder="Crew name" maxlength="24"><input id="sq-crew-tag" placeholder="TAG" maxlength="4" style="max-width:90px;text-transform:uppercase"><button class="btn primary" data-act="createCrew">Create</button></div>
         <h4>Join a crew</h4><div class="sq-row"><input id="sq-crew-code" placeholder="Crew code, e.g. CREW-AB12C" maxlength="12"><button class="btn primary" data-act="joinCrew">Join</button></div>`;
  } else {
    body.innerHTML = s.rivals.length
      ? `<p class="muted">Real soldiers you keep trading kills with. Your top rival wears a ⚔ mark in battle; take them down for revenge XP.</p>${s.rivals.map((r) => `<div class="sq-person"><i class="dot rival"></i><div><b>${esc(r.name)}</b><small>They killed you ${r.theyKilledMe} · You killed them ${r.iKilledThem}</small></div><div class="sq-acts">${r.theyKilledMe > r.iKilledThem ? '<span class="tag bad">You owe them</span>' : r.iKilledThem > r.theyKilledMe ? '<span class="tag good">You lead</span>' : '<span class="tag">Level</span>'}</div></div>`).join('')}`
      : '<p class="muted">No rivals yet. Rivals are real players you trade kills with. Bots do not count.</p>';
  }
}

// ---------- daily duty: login calendar + missions ----------
let dailyState = null;
function setupDaily(d) {
  dailyState = d;
  dailyBadge();
  $('btn-daily').onclick = () => {
    renderDaily();
    showSheet('daily');
    net.send({ t: 'daily' });
  };
  net.on('daily', (m) => {
    dailyState = m.daily;
    if (m.profile) showProfile(m.profile);
    if (m.claimed) {
      const r = m.claimed.reward;
      toast(`🎁 ${[r.gems ? `+${r.gems} 💎` : '', r.xp ? `+${r.xp} XP` : ''].filter(Boolean).join(' ')}${m.claimed.mission ? ` · ${m.claimed.mission}` : ` · Day ${m.claimed.streak} streak`}`);
    }
    dailyBadge();
    if (!$('daily').hidden) renderDaily();
  });
  // Pop the calendar once a day when there is a reward waiting.
  if (d?.login?.can && store.get('dailySeen', '') !== new Date().toDateString()) {
    store.set('dailySeen', new Date().toDateString());
    // Wait for the first-time "how to play" card to close so the two never overlap.
    const pop = () => {
      if (inGame) return;
      if (!$('modal').hidden || countryPicker?.isOpen) return setTimeout(pop, 700);
      $('btn-daily').click();
    };
    setTimeout(pop, 900);
  }
}

function dailyBadge() {
  const n = dailyState?.badge || 0;
  $('daily-badge').hidden = !n;
  $('daily-badge').textContent = n;
}

function renderDaily() {
  const d = dailyState;
  if (!d) return;
  const L = d.login;
  const rw = (r) => [r.gems ? `${r.gems}💎` : '', r.xp ? `${r.xp} XP` : ''].filter(Boolean).join(' + ');
  const hrs = Math.ceil(d.resetsIn / 3600000);
  $('daily-body').innerHTML = `
    <h4 style="margin:4px 0">Show face every day · streak <b style="color:var(--pod-2)">${L.streak}</b> day${L.streak === 1 ? '' : 's'}</h4>
    <div class="daily-days">${L.rewards.map((r, i) => `<div class="${i < L.index || (!L.can && i === L.index) ? 'done' : ''} ${L.can && i === L.index ? 'today' : ''}"><small>Day ${i + 1}</small><b>${r.gems ? r.gems + '💎' : '⭐'}</b><small>${r.xp ? r.xp + ' XP' : r.gems === 5 ? 'BIG' : ''}</small></div>`).join('')}</div>
    <button class="btn primary" id="daily-claim" ${L.can ? '' : 'disabled'}>${L.can ? `Collect day ${L.index + 1}: ${rw(L.rewards[L.index])}` : 'Collected today ✓ Come back tomorrow'}</button>
    <h4 style="margin:16px 0 6px">Today's missions <small class="muted">· new ones in ${hrs} h</small></h4>
    <div class="missions">${d.missions
      .map((m) => {
        const done = m.prog >= m.goal;
        return `<div class="mission ${m.claimed ? 'claimed' : ''}"><div><b>${esc(m.title)}</b><br><small>${rw(m.reward)} · ${m.prog}/${m.goal}</small></div>${m.claimed ? '<small>✓ Collected</small>' : `<button class="btn ${done ? 'primary' : 'ghost'}" data-mission="${esc(m.id)}" ${done ? '' : 'disabled'}>${done ? 'Collect' : 'In progress'}</button>`}<div class="pbar"><i style="width:${Math.round((m.prog / m.goal) * 100)}%"></i></div></div>`;
      })
      .join('')}</div>`;
  $('daily-claim').onclick = () => net.send({ t: 'dailyClaim' });
  for (const b of document.querySelectorAll('[data-mission]')) b.onclick = () => net.send({ t: 'missionClaim', id: b.dataset.mission });
}

let lastOnline = 0;
function setOnline(n) {
  if (n === undefined) return;
  lastOnline = n;
  $('online-chip').hidden = false;
  $('online-chip').innerHTML = `<i></i>${n} online`;
}

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

// ---------- country of play ----------
let countryPicker = null;
let countryCounts = {};
function setCountryCounts(c) {
  if (!c) return;
  countryCounts = c;
  countryPicker?.setCounts(c);
  paintCountryChip();
}
function paintCountryChip() {
  const cc = warmap?.country?.cc || savedCountry();
  const c = COUNTRY_BY_CC[cc];
  $('cc-flag').textContent = c ? flagOf(cc) : '🌍';
  $('cc-name').textContent = c ? c.name : 'Select country';
  const n = (c && countryCounts[cc]) || 0;
  $('cc-live').textContent = n ? `● ${n} playing` : '';
}
async function applyCountry(cc) {
  $('cc-name').textContent = 'Loading…';
  try {
    const data = await loadCountry(cc);
    warmap.setCountry(data);
  } catch {
    toast('Could not load that country. Check your network and try again.');
  }
  paintCountryChip();
}

// A region's name even before its country has loaded ("gh.greater-accra" -> "Greater Accra").
function regionName(id) {
  return regionById(id)?.name || String(id).replace(/^[a-z]{2}\./, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

let lobbyTimer;
function showLobby() {
  inGame = false;
  $('game').hidden = true;
  $('lobby').hidden = false;
  music.play('menu');
  net.send({ t: 'lobby' });
  if (dailyState) net.send({ t: 'daily' });
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
  music.unlock();
  goFullscreen();
  music.loadTrack();
  if (msg.mode !== 'stage' && msg.bots === undefined) msg.bots = settings.bots;
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

if (isTouch()) document.body.classList.add('touch');
const input = new Input($('view'));
input.sensitivity = settings.sensitivity;
input.invertY = settings.invertY;
input.touchSens = settings.touchSens;
audio.setVolume(settings.volume);
audio.gunsOn = settings.gunsOn;

// Pause game sound when the app or tab goes to the background, and bring it back after
// anything that stops it (calls, screen lock, Android/iOS "interrupted" audio).
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else audio.ctx.resume().catch(() => {});
});
for (const ev of ['pointerdown', 'touchend', 'keydown'])
  window.addEventListener(ev, () => audio.ctx && audio.ctx.state !== 'running' && !document.hidden && audio.ctx.resume().catch(() => {}), { passive: true });

(async () => {
  await preload();
  await boot.ready();
  audio.unlock();
  music.unlock();
  music.setVolume(settings.music);
  music.setEnabled(settings.musicOn);
  music.play('menu');
  music.loadTrack();
  boot.hide();
  bindSettings();
  warmap = new WarMap({
    onDeploy: deploy,
    onStage: startStage,
    getBots: () => settings.bots,
    setBots: (on) => {
      settings.bots = on;
      saveSettings();
      toast(on ? '🤖 Bots will fill empty places in your next battle.' : '👥 Next battle: real players only.');
    }
  });
  if (boot.lobby) warmap.setLobby(boot.lobby);
  // Country of play: the war map shows the chosen country's regions.
  countryPicker = new CountryPicker({ onPick: (cc) => applyCountry(cc) });
  $('btn-country').onclick = () => countryPicker.open();
  const welcome = await showAuth();
  showProfile(welcome.profile);
  warmap.setLobby(welcome.lobby, welcome.online);
  setOnline(welcome.online);
  setCountryCounts(welcome.countries);
  if (savedCountry()) applyCountry(savedCountry());
  else countryPicker.open(true);
  game = new Game({
    renderer,
    net,
    input,
    quality: PRESETS[settings.quality],
    settings,
    onLeave: () => showLobby(),
    onNextStage: (i) => startStage(i)
  });
  // Inbox (chats with businesses) and daily duty.
  const inboxUI = new InboxUI(net);
  inboxUI.setUnread(welcome.inboxUnread || 0);
  inboxUI.onNotify = (text) => (inGame && game.running ? game.hud.toast(text, 'info', 3500) : toast(text));
  game.onInbox = () => {
    game.togglePause(false);
    inboxUI.open();
  };
  inboxUI.onThreadClosed = () => {
    if (inGame && game.running && !isTouch() && game.status === 'alive') game.input.lock();
  };
  $('btn-inbox').onclick = () => inboxUI.open();
  game.saveSettings = saveSettings;
  // New orders from the debrief: straight into the next region with the same unit.
  game.onOrders = (o) => {
    const faction = game.faction;
    game.hud.hideMatchEnd();
    game.leave();
    warmap.setMode(o.mode);
    warmap.select(o.state);
    deploy(o.state, faction, o.mode);
  };
  setupSquad();
  setupDaily(welcome.daily);
  // News, announcements, events, maintenance, update prompts and push notifications.
  const notices = new Notices({
    net,
    store,
    isInGame: () => inGame && game.running,
    hudToast: (text, kind, ms) => game.hud.toast(text, kind, ms),
    onKicked: () => {
      if (!inGame) return;
      lastJoin = null;
      game.stop();
    }
  });
  notices.welcome(welcome);
  window.__notices = notices;
  // Report a real player in this battle.
  $('btn-report').onclick = () => {
    const real = (game.rosterList || []).filter((r) => !r.bot && r.id !== game.myId);
    if (!real.length) return game.hud.toast('No other real player for this battle.', 'info', 3000);
    game.togglePause(false);
    $('rep-who').innerHTML = real.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
    $('rep-more').value = '';
    showSheet('report');
  };
  $('rep-send').onclick = () => {
    const more = $('rep-more').value.trim();
    net.send({ t: 'report', id: $('rep-who').value, reason: `${$('rep-why').value}${more ? `: ${more}` : ''}` });
    showSheet('report', false);
  };
  if (new URLSearchParams(location.search).has('debug')) {
    window.__game = game;
    window.__THREE = THREE;
    window.__music = music;
    import('../../shared/map.js').then((m) => (window.__findPath = m.findPath));
    import('../../shared/physics.js').then((m) => (window.__phys = m));
  }
  net.on('lobby', (m) => {
    warmap.setLobby(m.states, m.online);
    setCountryCounts(m.countries);
    setOnline(m.online);
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
    // Tell players plainly whether they are fighting bots or real people.
    if (m.mode === 'practice') setTimeout(() => inGame && game.hud.toast('🎯 Practice range: dummies never shoot back, buy any gun (B), swim and sprint to train. Nothing counts towards your record.', 'info', 7000), 7600);
    else if (m.mode !== 'stage') {
      const bots = m.roster.filter((r) => r.bot).length;
      const humans = m.roster.length - bots;
      setTimeout(() => {
        if (!inGame) return;
        if (bots) game.hud.toast(`🤖 ${bots} bots (marked [BOT]) are in this battle. For real players only, turn off "Fight with bots" in Settings · ${lastOnline} online now.`, 'info', 7000);
        else if (humans <= 1) game.hud.toast(`👥 Real players only. Nobody else is here yet: ${lastOnline} online, invite your squad (👥) or wait a moment.`, 'info', 7000);
        else game.hud.toast(`👥 Real players only: ${humans} real soldiers for this battle. No bots.`, 'good', 5000);
      }, 7600);
    }
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
  if (st && COUNTRY_BY_CC[ccOf(st)]) {
    countryPicker.close();
    await applyCountry(ccOf(st)).catch(() => {});
  }
  if (qs.has('stage')) startStage(+qs.get('stage') || 0);
  else if (st && regionById(st)) {
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
    // First visit: the country picker first, then how to play.
    const help = () => {
      if (countryPicker.isOpen) return setTimeout(help, 700);
      store.set('seenHelp', '1');
      howToPlay();
    };
    help();
  }
})();
