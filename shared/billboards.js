// Billboard catalogue and pricing, shared by the game server, the game client and the
// advertiser portal (served as /shared/billboards.js). No imports, so the portal can load it directly.

export const BOARD_TYPES = {
  sky: {
    name: 'Sky Billboard',
    blurb: 'Giant 28-metre rooftop or highway billboard on the skyline. Seen from almost anywhere on the map.',
    ratio: [16, 9],
    minW: 1920,
    minH: 1080,
    viewRadius: 260
  },
  led: {
    name: 'LED Road Screen',
    blurb: 'Double-sided LED screen on poles in the middle of the battle, right where the fighting passes.',
    ratio: [16, 9],
    minW: 1280,
    minH: 720,
    viewRadius: 80
  },
  wall: {
    name: 'Wall Banner',
    blurb: 'Lit banner on a battlefield wall. Every banner holds a life gem, so players come close to it.',
    ratio: [2, 1],
    minW: 1200,
    minH: 600,
    viewRadius: 45
  }
};

export const MAX_IMAGE_PX = 4096;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const RATIO_TOLERANCE = 0.03;

const STATE_CODES = { crossriver: 'CRO', akwaibom: 'AKW', fct: 'FCT' };
export const stateCode = (id) => STATE_CODES[id] || id.slice(0, 3).toUpperCase();

// Every billboard in one state, from its generated map.
export function boardsFor(map) {
  const code = stateCode(map.stateId);
  const near = (x, z) => describeSpot(map, x, z);
  const out = [];
  map.billboards
    .filter((b) => b.type === 'sky')
    .forEach((b, i) => {
      const edge = b.nz > 0 ? 'north' : b.nz < 0 ? 'south' : b.nx > 0 ? 'west' : 'east';
      out.push({ id: b.id, type: 'sky', code: `${code}-S${i + 1}`, x: b.x, z: b.z, label: `${b.tower ? 'Rooftop of skyline tower' : 'Highway unipole'}, ${edge} edge of the map, faces the whole battlefield` });
    });
  map.billboards
    .filter((b) => b.type === 'led')
    .forEach((b, i) => out.push({ id: b.id, type: 'led', code: `${code}-L${i + 1}`, x: b.x, z: b.z, label: `LED screen ${near(b.x, b.z)}` }));
  map.adWalls.forEach((a, i) => out.push({ id: a.id, type: 'wall', code: `${code}-W${String(i + 1).padStart(2, '0')}`, x: a.x, z: a.z, label: `Wall banner ${near(a.x, a.z)}` }));
  return out;
}

function describeSpot(map, x, z) {
  const spots = [
    ...map.sites.map((s) => ({ x: s.x, z: s.z, name: `site ${s.id} (${s.label})` })),
    { x: map.bases.sec.x, z: 0, name: 'the Security base' },
    { x: map.bases.out.x, z: 0, name: 'the Outlaw base' },
    { x: map.landmark.x, z: map.landmark.z, name: map.landmark.name || 'the landmark' }
  ];
  let best = null;
  let bd = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (!best || bd > 45) return 'in the open ground between the bases';
  return bd < 22 ? `right by ${best.name}` : `near ${best.name}`;
}

// ---------- pricing ----------
export const DEFAULT_PRICING = {
  daily: { sky: 25000, led: 12000, wall: 5000 }, // naira per day for one shared slot
  tiers: [
    { name: 'Premium state', mult: 1.5, states: ['lagos', 'fct', 'rivers'] },
    { name: 'Major state', mult: 1.25, states: ['kano', 'oyo', 'kaduna', 'enugu', 'delta', 'anambra', 'edo', 'ogun', 'akwaibom'] }
  ],
  exclusiveMult: 3, // a billboard all to yourself (no rotation) costs this many shared slots
  shares: 4, // advertisers rotating on one billboard
  rotateSecs: 12,
  discounts: [
    { days: 30, off: 20 },
    { days: 7, off: 10 }
  ],
  minDays: 1,
  maxDays: 90
};

export function mergePricing(p = {}) {
  const d = DEFAULT_PRICING;
  return {
    ...d,
    ...p,
    daily: { ...d.daily, ...(p.daily || {}) },
    tiers: Array.isArray(p.tiers) ? p.tiers : d.tiers,
    discounts: Array.isArray(p.discounts) ? p.discounts : d.discounts
  };
}

export function tierFor(pricing, stateId) {
  return pricing.tiers.find((t) => t.states.includes(stateId)) || { name: 'Standard state', mult: 1 };
}

export function quote(pricing, { type, stateId, days, exclusive }) {
  const base = pricing.daily[type];
  if (!base) throw new Error('Unknown billboard type');
  days = Math.round(Number(days));
  if (!(days >= pricing.minDays && days <= pricing.maxDays)) throw new Error(`Pick between ${pricing.minDays} and ${pricing.maxDays} days`);
  const tier = tierFor(pricing, stateId);
  const perDay = base * tier.mult * (exclusive ? pricing.exclusiveMult : 1);
  const subtotal = perDay * days;
  const disc = [...pricing.discounts].sort((a, b) => b.days - a.days).find((x) => days >= x.days);
  const off = disc ? disc.off : 0;
  const total = Math.round((subtotal * (1 - off / 100)) / 100) * 100;
  return { perDay: Math.round(perDay), days, subtotal: Math.round(subtotal), discountPct: off, total, tier: tier.name, exclusive: !!exclusive };
}

export function ratioOk(type, w, h) {
  const [rw, rh] = BOARD_TYPES[type].ratio;
  return Math.abs(w / h / (rw / rh) - 1) <= RATIO_TOLERANCE;
}

export const naira = (n) => '₦' + Math.round(n).toLocaleString('en-NG');
