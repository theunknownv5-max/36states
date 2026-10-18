// The lobby: game-mode tabs, the war map of the chosen country's regions with live battles,
// the region briefing and the side/faction picker, and the campaign stage list.
import { STATE_BY_ID, ZONES, BIOMES, RESOURCES } from '../../../shared/states.js';
import { FACTIONS, SIDES, WEAPONS, MODES, STAGES } from '../../../shared/config.js';
import { regionById, COUNTRY_BY_CC, flagOf } from '../../../shared/regions.js';

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

// Spread tiles so neighbouring regions do not overlap, keeping them near their real spot.
function spread(pts, min) {
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
  return pts;
}

// Colours for regions outside Nigeria (by biome).
const BIOME_COL = { sahel: '#9a6a2a', desert: '#a8823a', savanna: '#7a7a2c', plateau: '#6a5a8a', rainforest: '#2f7a4c', creeks: '#28688e', urban: '#8a3a4a', temperate: '#3f7a3a', snow: '#5a7a9a' };

// Shorten a region name to fit its tile.
function shortName(name, max) {
  const n = name.replace(/ \((State|Municipality|City|Federal District)\)$/, '').replace(/ (Prefecture|Province|Region|Governorate|Oblast|County|District|Department)$/, '');
  return n.length > max ? n.slice(0, Math.max(3, max - 1)) + '…' : n;
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
    this.country = null;
    this.tiles = {};
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

  // Draw the chosen country: its real region shapes, and a tile per region (overseas regions
  // far from the mainland sit in a column on the right).
  setCountry(data) {
    this.country = data;
    if (this.selected && !data.regions.some((r) => r.id === this.selected)) this.selected = null;
    this.draw();
    if (!MODES[this.mode].solo) {
      $('state-info').hidden = !this.selected;
      $('state-empty').hidden = !!this.selected;
      if (this.selected) this.renderInfo();
    }
    this.updateCounts();
  }

  draw() {
    const svg = this.svg;
    svg.innerHTML = '';
    this.tiles = {};
    const data = this.country;
    if (!data) return;
    const regions = data.regions;
    const isNG = data.cc === 'NG';
    // Mainland: regions near the country's label point; the rest are drawn as an overseas column.
    let [L0, L1] = data.label || [(data.bbox[0] + data.bbox[2]) / 2, (data.bbox[1] + data.bbox[3]) / 2];
    if (L0 < data.bbox[0]) L0 += 360;
    const dist = (r) => Math.hypot((r.lon - L0) * Math.cos((L1 * Math.PI) / 180), r.lat - L1);
    const ds = regions.map(dist).sort((a, b) => a - b);
    const median = ds[Math.floor(ds.length / 2)] || 0;
    const limit = Math.max(8, median * 3);
    const main = regions.filter((r) => dist(r) <= limit);
    const away = regions.filter((r) => dist(r) > limit);
    // Projection fitted to the mainland shapes.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of main)
      for (const flat of r.poly || [])
        for (let i = 0; i < flat.length; i += 2) {
          minX = Math.min(minX, flat[i]);
          maxX = Math.max(maxX, flat[i]);
          minY = Math.min(minY, flat[i + 1]);
          maxY = Math.max(maxY, flat[i + 1]);
        }
    if (!isFinite(minX)) [minX, minY, maxX, maxY] = data.bbox;
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const right = away.length ? 150 : 0;
    const pad = 46;
    const sw = (W - right - pad * 2) / Math.max(0.01, (maxX - minX) * k);
    const sh = (H - pad * 2) / Math.max(0.01, maxY - minY);
    const sc = Math.min(sw, sh);
    const ox = pad + (W - right - pad * 2 - (maxX - minX) * k * sc) / 2;
    const oy = pad + (H - pad * 2 - (maxY - minY) * sc) / 2;
    const project = (lon, lat) => [ox + (lon - minX) * k * sc, oy + (maxY - lat) * sc];
    const pathOf = (rings) =>
      rings
        .map((flat) => {
          let d = '';
          for (let i = 0; i < flat.length; i += 2) {
            const [x, y] = project(flat[i], flat[i + 1]);
            d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          }
          return d + 'Z';
        })
        .join('');
    const defs = el('defs', {}, svg);
    const glow = el('filter', { id: 'glow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6', result: 'b' }, glow);
    const merge = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, merge);
    el('feMergeNode', { in: 'SourceGraphic' }, merge);
    if (data.outline?.length) el('path', { d: pathOf(data.outline), fill: 'rgba(255,122,26,0.06)', stroke: 'rgba(255,150,60,0.55)', 'stroke-width': 2.5, filter: 'url(#glow)' }, svg);
    const colour = (r) => (isNG ? ZONE_COL[r.zone] : BIOME_COL[r.biome]) || '#5a6a7a';
    this.shapes = {};
    for (const r of main) {
      if (!r.poly?.length) continue;
      const sh = el('path', { d: pathOf(r.poly), fill: colour(r), 'fill-opacity': 0.28, class: 'region-shape', 'data-id': r.id }, svg);
      sh.addEventListener('click', () => this.select(r.id));
      this.shapes[r.id] = sh;
    }
    if (isNG) {
      const river = (coords) => coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${project(lon, lat).map((v) => v.toFixed(1)).join(',')}`).join(' ');
      el('path', { d: river([[3.6, 11.7], [4.6, 10.6], [5.5, 9.4], [6.2, 8.9], [6.75, 7.8], [6.7, 6.9], [6.45, 5.8], [6.3, 4.9]]), fill: 'none', stroke: 'rgba(80,160,220,0.35)', 'stroke-width': 3, 'pointer-events': 'none' }, svg);
      el('path', { d: river([[12.4, 9.3], [11.2, 9.0], [9.8, 8.4], [8.6, 7.75], [7.5, 7.75], [6.75, 7.8]]), fill: 'none', stroke: 'rgba(80,160,220,0.35)', 'stroke-width': 3, 'pointer-events': 'none' }, svg);
    }
    // Tiles: sized so every region fits.
    const R = Math.max(13, Math.min(44, Math.sqrt(((W - right) * H) / Math.max(1, main.length)) * 0.3));
    const pts = spread(
      main.map((r) => {
        const [x, y] = project(r.lon, r.lat);
        return { id: r.id, x, y, hx: x, hy: y };
      }),
      R * 1.86
    );
    away.forEach((r, i) => {
      const cols = Math.ceil(away.length / 12);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = W - right + 30 + col * 64;
      const y = 70 + row * Math.min(64, (H - 90) / Math.ceil(away.length / cols));
      pts.push({ id: r.id, x, y, hx: x, hy: y, away: true });
    });
    if (away.length) {
      const t = el('text', { x: W - right + 10, y: 34, class: 'inset-label' }, svg);
      t.textContent = 'OVERSEAS';
    }
    const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
    const fs = R > 24 ? 12 : R > 18 ? 10 : 9;
    for (const p of pts) {
      const s = byId[p.id];
      const r = p.away ? 22 : R;
      const g = el('g', { class: 'state', 'data-id': s.id, tabindex: 0, role: 'button', 'aria-label': s.name }, svg);
      el('polygon', { points: hexPoints(p.x, p.y, r), fill: colour(s) }, g);
      const name = isNG && s.id === 'fct' ? 'FCT' : shortName(s.name.replace('Cross River', 'C. River').replace('Akwa Ibom', 'A. Ibom'), Math.max(4, Math.floor((r * 2.1) / (fs * 0.56))));
      const t = el('text', { x: p.x, y: p.y + 4, 'font-size': p.away ? 9 : name.length > 7 ? fs : fs + 2 }, g);
      t.textContent = name;
      const pip = el('circle', { cx: p.x + r * 0.62, cy: p.y - r * 0.55, r: 6, fill: '#ff4f4f', class: 'livepip', visibility: 'hidden' }, g);
      const count = el('text', { x: p.x, y: p.y + r * 0.62, 'font-size': 10, fill: '#ffd' }, g);
      g.addEventListener('click', () => this.select(s.id));
      g.addEventListener('keydown', (e) => e.key === 'Enter' && this.select(s.id));
      this.tiles[s.id] = { g, pip, count };
    }
    if (this.selected) this.tiles[this.selected]?.g.classList.add('sel');
  }

  setLobby(states, online) {
    if (online !== undefined) this.online = online;
    this.live = Object.fromEntries((states || []).map((s) => [s.id, s]));
    this.updateCounts();
    if (this.selected && !MODES[this.mode].solo) this.renderInfo();
  }

  // Live players for the current mode on each tile, and per mode on the tabs.
  updateCounts() {
    const totals = {};
    for (const t of Object.values(this.tiles || {})) {
      t.pip.setAttribute('visibility', 'hidden');
      t.count.textContent = '';
    }
    const cc = this.country?.cc;
    for (const s of Object.values(this.live)) {
      if (cc && (s.cc || 'NG') !== cc) continue;
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
    for (const [k, p] of Object.entries(this.shapes || {})) p.classList.toggle('sel', k === id);
    $('state-empty').hidden = true;
    $('state-info').hidden = false;
    this.renderInfo();
    this.onSelect?.(id);
  }

  renderInfo() {
    if (!this.selected) return;
    const s = regionById(this.selected);
    if (!s) return;
    const L = this.live[s.id] || { humans: 0, bots: 0, sec: 0, out: 0, modes: {} };
    const mode = MODES[this.mode];
    const here = L.modes?.[this.mode] || 0;
    const c = COUNTRY_BY_CC[s.cc || 'NG'];
    $('si-zone').textContent = `${flagOf(c?.cc)} ${c?.name || ''}${s.cc === 'NG' || !s.cc ? ` · ${ZONES[s.zone]}` : s.zone ? ` · ${s.zone}` : ''} · ${mode.icon} ${mode.label}`;
    $('si-name').textContent = s.name;
    $('si-cap').textContent = s.capitalTerritory ? 'Federal Capital Territory' : s.capital && s.capital !== s.name ? `Capital: ${s.capital}` : s.type || '';
    $('si-biome').innerHTML = `Ground: ${esc(BIOMES[s.biome].label)}<div class="mode-blurb">${esc(mode.blurb)}</div>`;
    $('si-res').innerHTML = s.resources.map((r) => `<span><i style="background:${RESOURCES[r].colour}"></i>${RESOURCES[r].label}</span>`).join('');
    $('si-landmark').textContent = `Landmark for the map: ${s.landmark.name}`;
    const bots = this.getBots();
    const realHere = L.realModes?.[this.mode] || 0;
    const live = here
      ? `🔴 <b>${here}</b> real ${here === 1 ? 'player' : 'players'} fighting now in ${esc(mode.label)}`
      : `Quiet here. Bots are holding it. You could be the first to land.`;
    // Bots or real players only: say it plainly, with the switch right here.
    const kind = bots
      ? `<div class="match-kind bots">🤖 <b>With bots:</b> computer soldiers (marked <b>[BOT]</b>) fill empty places so there is always a battle. <button class="btn ghost sm" id="si-real">Play real players only${this.online ? ` · ${this.online} online` : ''}</button></div>`
      : `<div class="match-kind real">👥 <b>Real players only</b> · ${this.online} online now · ${realHere} for this battle room. No bots at all. <button class="btn ghost sm" id="si-bots">Add bots</button></div>`;
    $('si-live').innerHTML = mode.practice
      ? `<div class="match-kind real">🎯 <b>Your private practice range</b> (you and your crew only). Target dummies never shoot back, every gun is free, swimming and fitness train 3x faster. Nothing counts towards your record.</div>`
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
    btn.textContent = !this.faction ? 'CHOOSE YOUR SIDE FIRST' : mode.practice ? `OPEN PRACTICE RANGE IN ${s.name.toUpperCase()}` : `DEPLOY TO ${s.name.toUpperCase()} AS ${FACTIONS[this.faction].label.toUpperCase()}`;
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
    const diff = st.diff < 0.3 ? 'Easy' : st.diff < 0.55 ? 'Normal' : st.diff < 0.75 ? 'Hard' : 'Brutal';
    $('st-facts').innerHTML = `<span>🌊 ${st.waves} waves</span><span>❤ ${st.lives} lives</span><span>🎯 ${diff}</span><span>🪖 You: ${FACTIONS[st.ally].label}</span><span>☠ Enemy: ${FACTIONS[st.enemy].label}</span><span>🤝 2 bot allies</span>`;
    $('btn-stage').textContent = `START STAGE ${this.stageSel + 1}`;
  }
}
