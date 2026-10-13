// The lobby: game-mode tabs, the war map of all 36 states + FCT with live battles,
// the state briefing and "wetin you be" faction picker, and the campaign stage list.
import { STATES, STATE_BY_ID, ZONES, BIOMES, RESOURCES } from '../../../shared/states.js';
import { FACTIONS, SIDES, WEAPONS, MODES, STAGES } from '../../../shared/config.js';
import { OUTLINE, projector } from './nigeria.js';

const ZONE_COL = { NC: '#2f7a4c', NE: '#8a6a24', NW: '#9a5426', SE: '#22707e', SS: '#28588e', SW: '#6a4890' };
const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 860;
const R = 30; // hex radius
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
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

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Spread tiles so neighbouring states do not overlap, keeping them near their real spot.
function layout() {
  const project = projector(W, H, 40);
  const pts = STATES.map((s) => {
    const [x, y] = project(s.lon, s.lat);
    return { id: s.id, x, y, hx: x, hy: y };
  });
  const min = R * 1.86;
  for (let it = 0; it < 220; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
    for (const p of pts) {
      p.x += (p.hx - p.x) * 0.02;
      p.y += (p.hy - p.y) * 0.02;
    }
  }
  return { pts, project };
}

export class WarMap {
  constructor({ onSelect, onDeploy, onStage, getBots, setBots }) {
    this.getBots = getBots || (() => true);
    this.setBots = setBots || (() => {});
    this.online = 0;
    this.svg = $('warmap');
    this.onSelect = onSelect;
    this.onDeploy = onDeploy;
    this.onStage = onStage;
    this.selected = null;
    this.faction = store.get('pod.faction');
    this.mode = MODES[store.get('pod.mode')] ? store.get('pod.mode') : 'conquest';
    this.live = {};
    this.profile = null;
    this.stageSel = null;
    this.draw();
    this.drawModes();
    $('btn-deploy').onclick = () => {
      if (this.selected && this.faction) this.onDeploy(this.selected, this.faction, this.mode);
    };
    $('btn-stage').onclick = () => {
      if (this.stageSel !== null) this.onStage(this.stageSel);
    };
    this.setMode(this.mode);
  }

  drawModes() {
    const nav = $('modes');
    nav.innerHTML = '';
    for (const [id, m] of Object.entries(MODES)) {
      const b = document.createElement('button');
      b.dataset.mode = id;
      b.innerHTML = `<span>${m.icon}</span><b>${esc(m.label)}</b><span class="n" hidden></span>`;
      b.onclick = () => this.setMode(id);
      nav.appendChild(b);
    }
  }

  setMode(id) {
    this.mode = id;
    store.set('pod.mode', id);
    for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === id);
    const solo = MODES[id].solo;
    $('map-wrap').hidden = solo;
    $('stages-wrap').hidden = !solo;
    $('state-info').hidden = solo || !this.selected;
    $('state-empty').hidden = solo || !!this.selected;
    $('stage-info').hidden = !solo;
    if (solo) this.renderStages();
    else if (this.selected) this.renderInfo();
    this.updateCounts();
  }

  draw() {
    const svg = this.svg;
    svg.innerHTML = '';
    const { pts, project } = layout();
    const defs = el('defs', {}, svg);
    const glow = el('filter', { id: 'glow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6', result: 'b' }, glow);
    const merge = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, merge);
    el('feMergeNode', { in: 'SourceGraphic' }, merge);
    const d = OUTLINE.map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    el('path', { d: d + 'Z', fill: 'rgba(255,122,26,0.06)', stroke: 'rgba(255,150,60,0.55)', 'stroke-width': 2.5, filter: 'url(#glow)' }, svg);
    const river = (coords) => coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project(lon, lat).map((v) => v.toFixed(1)).join(',')}`).join(' ');
    el('path', { d: river([[3.6, 11.7], [4.6, 10.6], [5.5, 9.4], [6.2, 8.9], [6.75, 7.8], [6.7, 6.9], [6.45, 5.8], [6.3, 4.9]]), fill: 'none', stroke: 'rgba(80,160,220,0.35)', 'stroke-width': 3 }, svg);
    el('path', { d: river([[12.4, 9.3], [11.2, 9.0], [9.8, 8.4], [8.6, 7.75], [7.5, 7.75], [6.75, 7.8]]), fill: 'none', stroke: 'rgba(80,160,220,0.35)', 'stroke-width': 3 }, svg);
    this.tiles = {};
    for (const p of pts) {
      const s = STATE_BY_ID[p.id];
      const g = el('g', { class: 'state', 'data-id': s.id, tabindex: 0, role: 'button', 'aria-label': `${s.name} state` }, svg);
      el('polygon', { points: hexPoints(p.x, p.y, R), fill: ZONE_COL[s.zone] }, g);
      const name = s.id === 'fct' ? 'FCT' : s.name.length > 9 ? s.name.replace('Cross River', 'C. River').replace('Akwa Ibom', 'A. Ibom') : s.name;
      const t = el('text', { x: p.x, y: p.y + 4, 'font-size': name.length > 7 ? 11 : 13 }, g);
      t.textContent = name;
      const pip = el('circle', { cx: p.x + R * 0.62, cy: p.y - R * 0.55, r: 6, fill: '#ff4f4f', class: 'livepip', visibility: 'hidden' }, g);
      const count = el('text', { x: p.x, y: p.y + 18, 'font-size': 10, fill: '#ffd' }, g);
      g.addEventListener('click', () => this.select(s.id));
      g.addEventListener('keydown', (e) => e.key === 'Enter' && this.select(s.id));
      this.tiles[s.id] = { g, pip, count };
    }
  }

  setLobby(states, online) {
    if (online !== undefined) this.online = online;
    for (const s of states) this.live[s.id] = s;
    this.updateCounts();
    if (this.selected && !MODES[this.mode].solo) this.renderInfo();
  }

  // Live players for the current mode on each tile, and per mode on the tabs.
  updateCounts() {
    const totals = {};
    for (const s of Object.values(this.live)) {
      const n = s.modes?.[this.mode] || 0;
      const tile = this.tiles[s.id];
      if (tile) {
        tile.pip.setAttribute('visibility', n ? 'visible' : 'hidden');
        tile.count.textContent = n ? `${n} 🎮` : '';
      }
      for (const [m, c] of Object.entries(s.modes || {})) totals[m] = (totals[m] || 0) + c;
    }
    for (const b of $('modes').children) {
      const n = totals[b.dataset.mode] || 0;
      const badge = b.querySelector('.n');
      badge.hidden = !n;
      badge.textContent = `${n} live`;
    }
  }

  select(id) {
    this.selected = id;
    for (const [k, t] of Object.entries(this.tiles)) t.g.classList.toggle('sel', k === id);
    $('state-empty').hidden = true;
    $('state-info').hidden = false;
    this.renderInfo();
    this.onSelect?.(id);
  }

  renderInfo() {
    if (!this.selected) return;
    const s = STATE_BY_ID[this.selected];
    const L = this.live[s.id] || { humans: 0, bots: 0, sec: 0, out: 0, modes: {} };
    const mode = MODES[this.mode];
    const here = L.modes?.[this.mode] || 0;
    $('si-zone').textContent = `${ZONES[s.zone]} · ${mode.icon} ${mode.label}`;
    $('si-name').textContent = s.name;
    $('si-cap').textContent = s.capitalTerritory ? 'Federal Capital Territory' : `Capital: ${s.capital}`;
    $('si-biome').innerHTML = `Ground: ${esc(BIOMES[s.biome].label)}<div class="mode-blurb">${esc(mode.blurb)}</div>`;
    $('si-res').innerHTML = s.resources.map((r) => `<span><i style="background:${RESOURCES[r].colour}"></i>${RESOURCES[r].label}</span>`).join('');
    $('si-landmark').textContent = `Landmark for the map: ${s.landmark.name}`;
    const bots = this.getBots();
    const realHere = L.realModes?.[this.mode] || 0;
    const live = here
      ? `🔴 <b>${here}</b> real ${here === 1 ? 'player' : 'players'} dey fight now for ${esc(mode.label)}`
      : `E quiet for here. Na bots dey hold am. You fit be the first to land.`;
    // Bots or real players only: say it plainly, with the switch right here.
    const kind = bots
      ? `<div class="match-kind bots">🤖 <b>With bots:</b> computer soldiers (marked <b>[BOT]</b>) fill empty places so war always dey. <button class="btn ghost sm" id="si-real">Play real players only${this.online ? ` · ${this.online} online` : ''}</button></div>`
      : `<div class="match-kind real">👥 <b>Real players only</b> · ${this.online} online now · ${realHere} for this battle room. No bots at all. <button class="btn ghost sm" id="si-bots">Add bots</button></div>`;
    $('si-live').innerHTML = mode.practice
      ? `<div class="match-kind real">🎯 <b>Your private practice range</b> (you and your crew only). Target dummies no dey shoot back, every gun free, swimming and fitness train 3x faster. Nothing count for your record.</div>`
      : live + kind;
    const flip = $('si-real') || $('si-bots');
    if (flip)
      flip.onclick = () => {
        this.setBots(!bots);
        this.renderInfo();
      };
    const wrap = $('si-factions');
    wrap.innerHTML = '';
    for (const side of ['sec', 'out']) {
      const col = document.createElement('div');
      col.className = `side-col ${side}`;
      col.innerHTML = `<h5>${SIDES[side].label.toUpperCase()}</h5>`;
      for (const [id, f] of Object.entries(FACTIONS)) {
        if (f.side !== side) continue;
        const b = document.createElement('button');
        b.className = 'fac' + (this.faction === id ? ' on' : '');
        b.innerHTML = `<i class="sw" style="background:${f.uniform.top}"></i><b>${f.label}</b><small>${f.blurb}</small>`;
        b.title = `Cheap gun: ${WEAPONS[f.discount]?.name || ''}`;
        b.onclick = () => {
          this.faction = id;
          store.set('pod.faction', id);
          this.renderInfo();
        };
        col.appendChild(b);
      }
      wrap.appendChild(col);
    }
    const btn = $('btn-deploy');
    btn.disabled = !this.faction;
    btn.textContent = !this.faction ? 'CHOOSE WETIN YOU BE FIRST' : mode.practice ? `OPEN PRACTICE RANGE IN ${s.name.toUpperCase()}` : `DEPLOY TO ${s.name.toUpperCase()} AS ${FACTIONS[this.faction].label.toUpperCase()}`;
  }

  setProfile(p) {
    this.profile = p;
    if (MODES[this.mode].solo) this.renderStages();
  }

  renderStages() {
    const wrap = $('stages');
    const unlocked = this.profile?.stage || 0;
    const stars = this.profile?.stageStars || {};
    if (this.stageSel === null || this.stageSel > unlocked) this.stageSel = Math.min(unlocked, STAGES.length - 1);
    wrap.innerHTML = '';
    STAGES.forEach((st, i) => {
      const b = document.createElement('button');
      const locked = i > unlocked;
      b.className = 'stage' + (locked ? ' locked' : '') + (i === this.stageSel ? ' sel' : '');
      const s = STATE_BY_ID[st.state];
      const got = stars[i] || 0;
      b.innerHTML = `<span class="num">STAGE ${i + 1}</span><span class="stars">${got ? '★'.repeat(got) + '☆'.repeat(3 - got) : ''}</span><b>${esc(st.title)}</b><small>${esc(s.name)} · ${st.waves} waves</small>`;
      b.onclick = () => {
        if (locked) return;
        this.stageSel = i;
        this.renderStages();
      };
      wrap.appendChild(b);
    });
    const st = STAGES[this.stageSel];
    const s = STATE_BY_ID[st.state];
    $('st-num').textContent = `STAGE ${this.stageSel + 1} OF ${STAGES.length}`;
    $('st-title').textContent = st.title;
    $('st-where').textContent = `${s.name} · ${BIOMES[s.biome].label}`;
    $('st-story').textContent = st.story;
    const diff = st.diff < 0.3 ? 'Easy' : st.diff < 0.55 ? 'Normal' : st.diff < 0.75 ? 'Hard' : 'Wahala';
    $('st-facts').innerHTML = `<span>🌊 ${st.waves} waves</span><span>❤ ${st.lives} lives</span><span>🎯 ${diff}</span><span>🪖 You: ${FACTIONS[st.ally].label}</span><span>☠ Enemy: ${FACTIONS[st.enemy].label}</span><span>🤝 2 bot allies</span>`;
    $('btn-stage').textContent = `START STAGE ${this.stageSel + 1}`;
  }
}
