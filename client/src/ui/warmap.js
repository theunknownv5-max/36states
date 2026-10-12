// The war map lobby: all 36 states + FCT as tiles on a map of Nigeria, live battle
// counts, the state briefing and the "what are you" faction picker.
import { STATES, STATE_BY_ID, ZONES, BIOMES, RESOURCES } from '../../../shared/states.js';
import { FACTIONS, SIDES, WEAPONS } from '../../../shared/config.js';
import { OUTLINE, projector } from './nigeria.js';

const ZONE_COL = { NC: '#2f7a4c', NE: '#8a6a24', NW: '#9a5426', SE: '#22707e', SS: '#28588e', SW: '#6a4890' };
const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 860;
const R = 30; // hex radius

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
  constructor({ onSelect, onDeploy }) {
    this.svg = document.getElementById('warmap');
    this.onSelect = onSelect;
    this.onDeploy = onDeploy;
    this.selected = null;
    this.faction = null;
    this.live = {};
    try {
      this.faction = localStorage.getItem('36s.faction');
    } catch {
      /* storage blocked */
    }
    this.draw();
    document.getElementById('btn-deploy').onclick = () => {
      if (this.selected && this.faction) this.onDeploy(this.selected, this.faction);
    };
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
    // Country silhouette.
    const d = OUTLINE.map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    el('path', { d: d + 'Z', fill: 'rgba(15,122,70,0.10)', stroke: 'rgba(47,213,133,0.55)', 'stroke-width': 2.5, filter: 'url(#glow)' }, svg);
    // Rivers Niger and Benue (rough), for flavour.
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

  setLobby(states) {
    for (const s of states) {
      this.live[s.id] = s;
      const tile = this.tiles[s.id];
      if (!tile) continue;
      tile.pip.setAttribute('visibility', s.live ? 'visible' : 'hidden');
      tile.count.textContent = s.humans ? `${s.humans} 🎮` : '';
    }
    if (this.selected) this.renderInfo();
  }

  select(id) {
    this.selected = id;
    for (const [k, t] of Object.entries(this.tiles)) t.g.classList.toggle('sel', k === id);
    document.getElementById('state-empty').hidden = true;
    document.getElementById('state-info').hidden = false;
    this.renderInfo();
    this.onSelect?.(id);
  }

  renderInfo() {
    const s = STATE_BY_ID[this.selected];
    const L = this.live[s.id] || { humans: 0, bots: 0, sec: 0, out: 0 };
    document.getElementById('si-zone').textContent = ZONES[s.zone];
    document.getElementById('si-name').textContent = s.name;
    document.getElementById('si-cap').textContent = s.capitalTerritory ? 'Federal Capital Territory' : `Capital: ${s.capital}`;
    document.getElementById('si-biome').textContent = `Terrain: ${BIOMES[s.biome].label}`;
    document.getElementById('si-res').innerHTML = s.resources.map((r) => `<span><i style="background:${RESOURCES[r].colour}"></i>${RESOURCES[r].label}</span>`).join('');
    document.getElementById('si-landmark').textContent = `Landmark on the map: ${s.landmark.name}`;
    document.getElementById('si-live').innerHTML = L.humans
      ? `🔴 <b>${L.humans}</b> real ${L.humans === 1 ? 'player' : 'players'} fighting now · SEC ${L.sec} – ${L.out} OUT`
      : `Quiet front: bots are holding it. Be the first to deploy.`;
    const wrap = document.getElementById('si-factions');
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
        b.title = `Discount: ${WEAPONS[f.discount]?.name || ''}`;
        b.onclick = () => {
          this.faction = id;
          try {
            localStorage.setItem('36s.faction', id);
          } catch {
            /* storage blocked */
          }
          this.renderInfo();
        };
        col.appendChild(b);
      }
      wrap.appendChild(col);
    }
    const btn = document.getElementById('btn-deploy');
    btn.disabled = !this.faction;
    btn.textContent = this.faction ? `DEPLOY TO ${s.name.toUpperCase()} AS ${FACTIONS[this.faction].label.toUpperCase()}` : 'CHOOSE WHAT YOU ARE';
  }
}
