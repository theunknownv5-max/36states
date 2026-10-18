// Battlefields all over the world. Every country is split into its real regions (states,
// provinces, counties...), and each region is its own battlefield with a biome, three resource
// sites and a landmark. Nigeria keeps its hand-made states (ids like 'lagos'); every other region
// id is '<country code>.<name>', for example 'gh.ashanti' or 'us.texas'.
//
// The country list (shared/world-index.js) is small and always loaded. A country's regions and
// shapes (shared/world/<cc>.json) load when needed: the server reads the file, clients fetch it
// from /api/world/<cc> (or get the one region they fight in with the match info).
import { STATES, STATE_BY_ID, BIOMES } from './states.js';
import { COUNTRIES, COUNTRY_BY_CC } from './world-index.js';

export { COUNTRIES, COUNTRY_BY_CC };

const REGIONS = new Map(); // id -> region
const LOADED = new Map(); // cc -> country data
let loader = null;

// The server reads country files from disk on demand: setCountryLoader((cc) => data).
export function setCountryLoader(fn) {
  loader = fn;
}

export function registerCountry(data) {
  if (!data?.cc) return data;
  LOADED.set(data.cc, data);
  for (const r of data.regions || []) if (!STATE_BY_ID[r.id]) REGIONS.set(r.id, { ...r, cc: data.cc });
  return data;
}

// One region on its own (what a client gets with the match info).
export function registerRegion(r) {
  if (r?.id && !STATE_BY_ID[r.id]) REGIONS.set(r.id, { ...r, cc: r.cc || ccOf(r.id) });
}

export const ccOf = (id) => (typeof id === 'string' && id.includes('.') ? id.split('.')[0].toUpperCase() : 'NG');

export function countryData(cc) {
  cc = String(cc || '').toUpperCase();
  if (!LOADED.has(cc) && loader && COUNTRY_BY_CC[cc]) {
    try {
      registerCountry(loader(cc));
    } catch {
      return null;
    }
  }
  return LOADED.get(cc) || null;
}

// Any region by id, or null. Nigerian states come from states.js (their hand-made data).
export function regionById(id) {
  if (typeof id !== 'string' || !id) return null;
  const ng = STATE_BY_ID[id];
  if (ng) return ng.cc ? ng : Object.assign(ng, { cc: 'NG', type: 'State' });
  let r = REGIONS.get(id);
  if (!r && loader) {
    countryData(ccOf(id));
    r = REGIONS.get(id);
  }
  return r || null;
}

// The regions of a country (loaded), as a list.
export function regionsOf(cc) {
  cc = String(cc || '').toUpperCase();
  if (cc === 'NG') return STATES;
  return countryData(cc)?.regions.map((r) => regionById(r.id)) || [];
}

// What a region is called with its country, e.g. "Ashanti, Ghana".
export function placeName(id) {
  const r = regionById(id);
  if (!r) return id;
  const c = COUNTRY_BY_CC[r.cc || ccOf(id)];
  return c ? `${r.name}, ${c.name}` : r.name;
}

// The look of a biome and the terrain rules it uses (new world biomes reuse the original six).
export function biomeBase(biome) {
  return BIOMES[biome]?.base || biome;
}

// The flag emoji for a country code.
export function flagOf(cc) {
  if (!cc || cc.length !== 2) return '🏳';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Which payment provider serves a country: Paystack across Africa, Stripe everywhere else.
export function payProvider(cc) {
  return COUNTRY_BY_CC[String(cc || '').toUpperCase()]?.pay || 'stripe';
}
