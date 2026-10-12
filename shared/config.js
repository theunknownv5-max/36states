// Every number that shapes the game lives here: factions, weapons, gear, killstreaks,
// life gems, respawning, scoring, money and networking. Server and client both read it.

export const SIDES = {
  sec: { label: 'Security Forces', short: 'SEC', colour: '#4f9dff' },
  out: { label: 'Outlaws', short: 'OUT', colour: '#ff5a4f' }
};

// Uniform colours drive how soldiers look. Perks are applied by the server.
export const FACTIONS = {
  police: {
    side: 'sec',
    label: 'Police',
    blurb: 'Starts every life with a vest. MP5 is cheaper.',
    uniform: { top: '#1d2433', bottom: '#1d2433', cap: '#0f1420', vest: '#2a2f3a' },
    discount: 'mp5',
    perks: { startVest: true }
  },
  army: {
    side: 'sec',
    label: 'Army',
    blurb: 'Artillery after 4 kills instead of 5. G3 is cheaper.',
    uniform: { top: '#4b5a32', bottom: '#4b5a32', cap: '#3c4a28', vest: '#5a5a3a', camo: true },
    discount: 'g3',
    perks: { artilleryAt: 4 }
  },
  civildefence: {
    side: 'sec',
    label: 'Civil Defence',
    blurb: 'Guards pipelines and mines: captures sites 40% faster. PKM is cheaper.',
    uniform: { top: '#6b6a3c', bottom: '#2f3320', cap: '#2f3320', vest: '#4a4a30' },
    discount: 'pkm',
    perks: { captureMult: 1.4 }
  },
  vigilante: {
    side: 'sec',
    label: 'Vigilante Hunters',
    blurb: 'Knows the bush: quiet footsteps. Dane gun is free.',
    uniform: { top: '#7a5230', bottom: '#4e3824', cap: '#a33a2a', vest: null },
    discount: 'danegun',
    perks: { quietSteps: true }
  },
  bandit: {
    side: 'out',
    label: 'Bandits',
    blurb: 'Fast on foot: +10% speed. AK-47 is cheaper.',
    uniform: { top: '#5d4a36', bottom: '#3a3128', cap: null, vest: null, wrap: '#2b2b2b' },
    discount: 'ak47',
    perks: { speedMult: 1.1 }
  },
  militant: {
    side: 'out',
    label: 'Creek Militants',
    blurb: 'Explosives 30% cheaper. Fast in water.',
    uniform: { top: '#161616', bottom: '#202020', cap: null, vest: '#2b2b2b', wrap: '#9b1c1c' },
    discount: 'rpg',
    perks: { explosiveDiscount: 0.3, swimMult: 1.5 }
  },
  smuggler: {
    side: 'out',
    label: 'Smugglers',
    blurb: '+30% money from resource sites. Hawk .50 is cheaper.',
    uniform: { top: '#2f4858', bottom: '#33302a', cap: '#1d1d1d', vest: null },
    discount: 'hawk',
    perks: { incomeMult: 1.3 }
  }
};

// Weapons. dmg = damage per bullet at close range; armorPen = share that still hits health through armour.
// spread values are in radians; kick is upward recoil per shot.
export const WEAPONS = {
  knife: { name: 'Machete', slot: 'melee', price: 0, dmg: 55, backstab: 120, range: 2.0, rpm: 90, melee: true, speed: 1.08, kill: 1500 },
  p9: { name: 'P9 Pistol', slot: 'secondary', price: 0, dmg: 27, head: 4, armorPen: 0.5, rpm: 400, mag: 13, reserve: 52, reload: 2.1, range: 70, falloff: [20, 60], spread: 0.011, moveSpread: 0.03, adsSpread: 0.004, kick: 0.018, auto: false, speed: 1.0, kill: 300, pen: 0.2, sound: 'pistol' },
  hawk: { name: 'Hawk .50', slot: 'secondary', price: 700, dmg: 58, head: 3.6, armorPen: 0.85, rpm: 150, mag: 7, reserve: 35, reload: 2.2, range: 90, falloff: [30, 80], spread: 0.008, moveSpread: 0.05, adsSpread: 0.002, kick: 0.05, auto: false, speed: 0.98, kill: 300, pen: 0.5, sound: 'magnum' },
  mp5: { name: 'MP5', slot: 'primary', price: 1500, dmg: 24, head: 3, armorPen: 0.6, rpm: 800, mag: 30, reserve: 120, reload: 2.3, range: 80, falloff: [18, 55], spread: 0.018, moveSpread: 0.03, adsSpread: 0.008, kick: 0.011, auto: true, speed: 0.98, kill: 600, pen: 0.3, sound: 'smg' },
  ak47: { name: 'AK-47', slot: 'primary', price: 2700, dmg: 36, head: 4, armorPen: 0.78, rpm: 600, mag: 30, reserve: 90, reload: 2.5, range: 200, falloff: [40, 160], spread: 0.007, moveSpread: 0.065, adsSpread: 0.0025, kick: 0.016, auto: true, speed: 0.9, kill: 300, pen: 0.7, sound: 'rifle' },
  g3: { name: 'G3 Battle Rifle', slot: 'primary', price: 3000, dmg: 42, head: 4, armorPen: 0.8, rpm: 550, mag: 20, reserve: 80, reload: 2.6, range: 220, falloff: [50, 180], spread: 0.006, moveSpread: 0.07, adsSpread: 0.002, kick: 0.02, auto: true, speed: 0.88, kill: 300, pen: 0.8, sound: 'battle' },
  danegun: { name: 'Dane Gun', slot: 'primary', price: 900, pellets: 9, dmg: 17, head: 1.6, armorPen: 0.5, rpm: 55, mag: 1, reserve: 14, reload: 1.7, range: 30, falloff: [6, 24], spread: 0.075, moveSpread: 0.02, adsSpread: 0.06, kick: 0.09, auto: false, speed: 0.98, kill: 900, pen: 0, sound: 'shotgun' },
  pkm: { name: 'PKM Machine Gun', slot: 'primary', price: 5200, dmg: 34, head: 3.5, armorPen: 0.8, rpm: 700, mag: 100, reserve: 100, reload: 5.0, range: 200, falloff: [40, 170], spread: 0.018, moveSpread: 0.09, adsSpread: 0.007, kick: 0.012, auto: true, speed: 0.8, kill: 300, pen: 0.8, sound: 'mg' },
  svd: { name: 'SVD Sniper', slot: 'primary', price: 4750, dmg: 96, head: 2.6, legMult: 0.7, armorPen: 0.95, rpm: 140, mag: 10, reserve: 30, reload: 3.0, range: 400, falloff: [200, 400], spread: 0.06, moveSpread: 0.1, adsSpread: 0.0004, kick: 0.07, auto: false, speed: 0.85, zoom: 4, kill: 100, pen: 1, sound: 'sniper' },
  rpg: { name: 'RPG-7', slot: 'primary', price: 6000, projectile: 'rocket', dmg: 160, blast: 7, rocketSpeed: 70, rpm: 30, mag: 1, reserve: 2, reload: 3.6, range: 300, spread: 0.01, moveSpread: 0.04, adsSpread: 0.004, kick: 0.12, auto: false, speed: 0.8, kill: 300, sound: 'rpg', explosive: true }
};

export const GEAR = {
  vest: { name: 'Kevlar vest', price: 650, armor: 100 },
  helmet: { name: 'Vest + helmet', price: 1000, armor: 100, helmet: true },
  frag: { name: 'Frag grenade', price: 300, max: 2, fuse: 2.6, blast: 7, dmg: 115, explosive: true },
  smoke: { name: 'Smoke grenade', price: 300, max: 1, fuse: 1.6, radius: 5.5, duration: 16 },
  flash: { name: 'Flashbang', price: 200, max: 2, fuse: 1.5, radius: 18 },
  medkit: { name: 'First aid kit', price: 400, max: 1, heal: 50, useTime: 3 }
};

// Oil drums. Only the ones holding fuel or gas explode when shot; water drums just ring.
export const DRUMS = {
  fuelShare: 0.45, // share of drums on a map that hold fuel
  health: 45, // damage a fuel drum takes before it blows
  blast: 6.5, // explosion radius (m)
  dmg: 150, // damage at the centre, falling off with distance
  burnRadius: 5.5, // anyone this close catches fire
  burnSecs: 4.5,
  burnDps: 11,
  chainDelayMs: 280, // nearby fuel drums go up one after another
  fireSecs: 9 // how long the wreck keeps burning
};

export const KILLSTREAKS = {
  uav: { name: 'Recon drone', kills: 3, duration: 20 },
  artillery: { name: 'Artillery barrage', kills: 5, shells: 7, spread: 11, delay: 2.6, interval: 0.55, blast: 8, dmg: 170 }
};

// Life gems: every advert wall carries one. Collecting one gives a life (used to redeploy)
// and heals. Once anyone collects it, nobody can collect that wall's gem for 2 minutes.
export const GEMS = {
  cooldownMs: 120000,
  pickupRadius: 1.9,
  heal: 25,
  startingGems: 3,
  levelUpGems: 2
};

// What a fallen player can do to rejoin the war front.
export const RESPAWN = {
  downedMs: 10000, // teammates can revive you while you are down
  reviveTime: 2.5, // seconds holding E next to a downed teammate
  reviveHealth: 35,
  gemCost: 1, // instant redeploy
  spiritMs: 40000, // spirit run: reach a glowing gem as a spirit to come back for free
  spiritSpeed: 9,
  medevacMs: 25000, // or wait for the medevac
  medevacFee: 1000,
  botRespawnMs: 9000,
  protectMs: 2500 // spawn protection
};

export const MATCH = {
  maxHumans: 16,
  minPerSide: 5, // bots fill each side up to this many fighters
  scoreLimit: 750,
  timeLimitMs: 15 * 60 * 1000,
  endScreenMs: 15000,
  captureTime: 8, // seconds to capture a site alone
  siteRadius: 9,
  sitePointsPerSec: 1,
  killPoints: 10,
  headshotBonus: 5,
  discoveryEveryMs: 4 * 60 * 1000,
  discoveryDurationMs: 2 * 60 * 1000,
  discoveryPointsMult: 2,
  idleCloseMs: 60000
};

export const MONEY = {
  start: 1000,
  max: 16000,
  capture: 500,
  incomePerSec: 25, // for each site your team holds, paid to every teammate
  revive: 300,
  assist: 150,
  buyWindowMs: 25000, // after spawning you can buy anywhere
  buyZoneRadius: 16
};

export const PLAYER = {
  height: 1.8,
  crouchHeight: 1.2,
  radius: 0.3,
  eye: 1.62,
  crouchEye: 1.08,
  walk: 3.0, // bots' careful pace
  jog: 4.4, // normal movement
  slow: 2.0, // hold Z: silent walk
  run: 5.6, // hold Shift: sprint (can't shoot)
  stamina: 6, // seconds of sprint
  crouchSpeed: 1.7,
  adsSpeed: 0.6,
  waterSpeed: 0.6,
  jump: 6.0,
  gravity: 19,
  stepUp: 0.45,
  maxHealth: 100
};

export const XP = { kill: 100, headshot: 50, capture: 150, revive: 75, win: 500, levelEvery: 2000 };
export const RANKS = ['Recruit', 'Private', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer', 'Lieutenant', 'Captain', 'Major', 'Lieutenant Colonel', 'Colonel', 'Brigadier', 'Major General', 'General'];

export const ADS = {
  viewRadius: 45,
  viewDedupeMs: 60000,
  reportEveryMs: 3000,
  maxImageBytes: 2 * 1024 * 1024
};

export const NET = {
  tickHz: 20,
  sendHz: 20,
  interpDelayMs: 100,
  maxRewindMs: 300,
  speedTolerance: 1.5
};

export function rankFor(xp) {
  const i = Math.min(RANKS.length - 1, Math.floor(xp / XP.levelEvery));
  return { level: i + 1, name: RANKS[i], next: (i + 1) * XP.levelEvery };
}

export function priceFor(item, faction) {
  const f = FACTIONS[faction];
  const base = WEAPONS[item]?.price ?? GEAR[item]?.price ?? 0;
  if (!f) return base;
  let p = base;
  if (f.discount === item) p = item === 'danegun' ? 0 : Math.round(base * 0.75);
  const explosive = WEAPONS[item]?.explosive || GEAR[item]?.explosive;
  if (explosive && f.perks.explosiveDiscount) p = Math.round(p * (1 - f.perks.explosiveDiscount));
  return p;
}
