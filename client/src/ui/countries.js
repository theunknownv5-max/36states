// Country of play: the picker (world map + search + continents, with live player counts) and
// loading a country's regions from the server.
import { COUNTRIES, COUNTRY_BY_CC, registerCountry, flagOf } from '../../../shared/regions.js';
import { api } from '../core/server.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NS = 'http://www.w3.org/2000/svg';
const CONTINENTS = ['Africa', 'Europe', 'Asia', 'North America', 'South America', 'Oceania', 'Antarctica'];
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

const cache = new Map();

// A country's regions and shapes (cached; Nigeria comes from the same endpoint).
export async function loadCountry(cc) {
  cc = String(cc).toUpperCase();
  if (cache.has(cc)) return cache.get(cc);
  const p = fetch(api(`/api/world/${cc.toLowerCase()}`))
    .then((r) => {
      if (!r.ok) throw new Error('country');
      return r.json();
    })
    .then((d) => registerCountry(d))
    .catch((e) => {
      cache.delete(cc);
      throw e;
    });
  cache.set(cc, p);
  return p;
}

// The player's country: what they picked before, else a guess from the phone's language/time zone.
export function savedCountry() {
  const c = store.get('pod.country');
  return COUNTRY_BY_CC[c] ? c : null;
}

export function guessCountry() {
  const langs = [...(navigator.languages || []), navigator.language || ''];
  for (const l of langs) {
    const m = /[-_]([A-Za-z]{2})$/.exec(l);
    if (m && COUNTRY_BY_CC[m[1].toUpperCase()]) return m[1].toUpperCase();
  }
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/')[1] || '';
  const byCity = { Lagos: 'NG', Accra: 'GH', Nairobi: 'KE', Johannesburg: 'ZA', Cairo: 'EG', London: 'GB', New_York: 'US', Chicago: 'US', Los_Angeles: 'US', Toronto: 'CA', Paris: 'FR', Berlin: 'DE', Kolkata: 'IN', Tokyo: 'JP', Sao_Paulo: 'BR', Dubai: 'AE', Kinshasa: 'CD', Abidjan: 'CI', Dakar: 'SN', Kampala: 'UG', Dar_es_Salaam: 'TZ', Addis_Ababa: 'ET' };
  return byCity[tz] || 'NG';
}

export class CountryPicker {
  constructor({ onPick }) {
    this.onPick = onPick;
    this.counts = {};
    this.continent = 'all';
    this.drawn = false;
    $('cp-search').oninput = () => this.renderList();
    $('cp-close').onclick = () => this.close();
  }

  setCounts(counts) {
    this.counts = counts || {};
    if (!$('country-sheet').hidden) {
      this.renderList();
      this.paintMap();
    }
  }

  open(first = false) {
    $('country-sheet').hidden = false;
    $('cp-close').hidden = first;
    $('cp-search').value = '';
    const sug = savedCountry() || guessCountry();
    const c = COUNTRY_BY_CC[sug];
    $('cp-suggest').innerHTML = c ? `<button class="btn primary" id="cp-sug">${flagOf(c.cc)} Play in ${esc(c.name)}</button>` : '';
    if (c) $('cp-sug').onclick = () => this.pick(c.cc);
    this.renderTabs();
    this.renderList();
    if (!this.drawn) this.drawMap();
    else this.paintMap();
  }

  close() {
    $('country-sheet').hidden = true;
  }

  get isOpen() {
    return !$('country-sheet').hidden;
  }

  pick(cc) {
    store.set('pod.country', cc);
    this.close();
    this.onPick?.(cc);
  }

  renderTabs() {
    const nav = $('cp-tabs');
    nav.innerHTML = '';
    for (const id of ['all', ...CONTINENTS]) {
      const b = document.createElement('button');
      b.className = 'chip' + (this.continent === id ? ' on' : '');
      const live = COUNTRIES.filter((c) => id === 'all' || c.continent === id).reduce((n, c) => n + (this.counts[c.cc] || 0), 0);
      b.innerHTML = `${id === 'all' ? 'All' : esc(id)}${live ? ` <i>${live}</i>` : ''}`;
      b.onclick = () => {
        this.continent = id;
        this.renderTabs();
        this.renderList();
      };
      nav.appendChild(b);
    }
  }

  renderList() {
    const q = $('cp-search').value.trim().toLowerCase();
    const list = COUNTRIES.filter((c) => (this.continent === 'all' || c.continent === this.continent) && (!q || c.name.toLowerCase().includes(q) || c.cc.toLowerCase() === q)).sort(
      (a, b) => (this.counts[b.cc] || 0) - (this.counts[a.cc] || 0) || a.name.localeCompare(b.name)
    );
    const wrap = $('cp-list');
    wrap.innerHTML = list.length
      ? list
          .map((c) => {
            const n = this.counts[c.cc] || 0;
            return `<button class="cp-item${n ? ' live' : ''}" data-cc="${c.cc}"><span class="flag">${flagOf(c.cc)}</span><b>${esc(c.name)}</b><small>${c.n} ${c.n === 1 ? 'battlefield' : 'battlefields'}${n ? ` · <em>${n} playing</em>` : ''}</small></button>`;
          })
          .join('')
      : '<p class="muted">No country matches that name.</p>';
    for (const b of wrap.querySelectorAll('.cp-item')) b.onclick = () => this.pick(b.dataset.cc);
  }

  // A small world map: tap a country to play there; countries with live battles glow.
  async drawMap() {
    this.drawn = true;
    const svg = $('cp-map');
    try {
      const r = await fetch(api('/api/world/outline'));
      const world = await r.json();
      svg.innerHTML = '';
      const P = (lon, lat) => [((lon + 180) / 360) * 1000, ((84 - lat) / 144) * 420];
      this.shapes = {};
      for (const c of world) {
        if (!COUNTRY_BY_CC[c.cc]) continue;
        const d = c.p
          .map((flat) => {
            let s = '';
            for (let i = 0; i < flat.length; i += 2) {
              const [x, y] = P(flat[i], flat[i + 1]);
              s += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
            }
            return s + 'Z';
          })
          .join('');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'cp-land');
        path.dataset.cc = c.cc;
        const t = document.createElementNS(NS, 'title');
        t.textContent = COUNTRY_BY_CC[c.cc].name;
        path.appendChild(t);
        path.addEventListener('click', () => this.pick(c.cc));
        svg.appendChild(path);
        this.shapes[c.cc] = path;
      }
      this.P = P;
      this.paintMap();
    } catch {
      svg.innerHTML = '';
    }
  }

  paintMap() {
    if (!this.shapes) return;
    const svg = $('cp-map');
    for (const d of svg.querySelectorAll('.cp-dot')) d.remove();
    const mine = savedCountry();
    for (const [cc, path] of Object.entries(this.shapes)) {
      path.classList.toggle('live', !!this.counts[cc]);
      path.classList.toggle('mine', cc === mine);
    }
    for (const [cc, n] of Object.entries(this.counts)) {
      const c = COUNTRY_BY_CC[cc];
      if (!c || !n) continue;
      const [x, y] = this.P(c.lon, c.lat);
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', Math.min(9, 3 + Math.sqrt(n) * 1.5));
      dot.setAttribute('class', 'cp-dot');
      svg.appendChild(dot);
    }
  }
}
