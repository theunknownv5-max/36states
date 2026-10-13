// Every number that shapes the game lives here: factions, weapons, gear, killstreaks,
// life gems, respawning, game modes, stages, scoring, money and networking.
// Server and client both read it. Player-facing text is in Nigerian Pidgin.

export const GAME = {
  name: 'Proof of Duty',
  short: 'POD',
  tagline: 'Shoot • Survive • Win',
  version: 'V0.1',
  developer: 'Tcee',
  website: 'https://proofofduty.com',
  about:
    'Proof of Duty na tactical shooter wey dey happen for all 36 states of Nigeria plus Abuja. Choose your side, hold the ground, collect life gems, and show say you get the heart for duty. Na one Naija developer, Tcee, build am from scratch.'
};

export const SIDES = {
  sec: { label: 'Security Forces', short: 'SEC', colour: '#4f9dff' },
  out: { label: 'Outlaws', short: 'OUT', colour: '#ff5a4f' }
};

// Uniform colours drive how soldiers look. Perks are applied by the server.
export const FACTIONS = {
  police: {
    side: 'sec',
    label: 'Police',
    blurb: 'E dey start every life with vest. MP5 cheap for am.',
    uniform: { top: '#1d2433', bottom: '#1d2433', cap: '#0f1420', vest: '#2a2f3a' },
    discount: 'mp5',
    perks: { startVest: true }
  },
  army: {
    side: 'sec',
    label: 'Army',
    blurb: 'Artillery after 4 kills, no be 5. G3 cheap for am.',
    uniform: { top: '#4b5a32', bottom: '#4b5a32', cap: '#3c4a28', vest: '#5a5a3a', camo: true },
    discount: 'g3',
    perks: { artilleryAt: 4 }
  },
  civildefence: {
    side: 'sec',
    label: 'Civil Defence',
    blurb: 'Dem dey guard pipeline and mine: dem dey hold ground 40% faster. PKM cheap.',
    uniform: { top: '#6b6a3c', bottom: '#2f3320', cap: '#2f3320', vest: '#4a4a30' },
    discount: 'pkm',
    perks: { captureMult: 1.4 }
  },
  vigilante: {
    side: 'sec',
    label: 'Vigilante Hunters',
    blurb: 'Dem sabi bush: dem leg no dey make noise. Dane gun na free.',
    uniform: { top: '#7a5230', bottom: '#4e3824', cap: '#a33a2a', vest: null },
    discount: 'danegun',
    perks: { quietSteps: true }
  },
  bandit: {
    side: 'out',
    label: 'Bandits',
    blurb: 'Dem leg sharp: +10% speed. AK-47 cheap for dem.',
    uniform: { top: '#5d4a36', bottom: '#3a3128', cap: null, vest: null, wrap: '#2b2b2b' },
    discount: 'ak47',
    perks: { speedMult: 1.1 }
  },
  militant: {
    side: 'out',
    label: 'Creek Militants',
    blurb: 'Explosive 30% cheaper. Dem dey move fast for water.',
    uniform: { top: '#161616', bottom: '#202020', cap: null, vest: '#2b2b2b', wrap: '#9b1c1c' },
    discount: 'rpg',
    perks: { explosiveDiscount: 0.3, swimMult: 1.5 }
  },
  smuggler: {
    side: 'out',
    label: 'Smugglers',
    blurb: '+30% more money from resource site. Hawk .50 cheap.',
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
  // Two guns, one in each hand. Unlocked by rank (see unlockLevel), bought in the armoury.
  dualp9: { name: 'Dual P9 (two hands)', slot: 'secondary', dual: true, unlockLevel: 3, price: 1200, dmg: 26, head: 3.6, armorPen: 0.5, rpm: 720, mag: 26, reserve: 78, reload: 2.9, range: 60, falloff: [16, 50], spread: 0.02, moveSpread: 0.035, adsSpread: 0.014, kick: 0.012, auto: false, speed: 1.0, kill: 300, pen: 0.2, sound: 'pistol' },
  dualmp5: { name: 'Dual MP5 (two hands)', slot: 'primary', dual: true, unlockLevel: 6, price: 3800, dmg: 22, head: 2.8, armorPen: 0.55, rpm: 1250, mag: 60, reserve: 180, reload: 3.4, range: 70, falloff: [14, 48], spread: 0.03, moveSpread: 0.04, adsSpread: 0.02, kick: 0.009, auto: true, speed: 0.95, kill: 600, pen: 0.3, sound: 'smg' },
  rpg: { name: 'RPG-7', slot: 'primary', price: 6000, projectile: 'rocket', dmg: 160, blast: 7, rocketSpeed: 70, rpm: 30, mag: 1, reserve: 2, reload: 3.6, range: 300, spread: 0.01, moveSpread: 0.04, adsSpread: 0.004, kick: 0.12, auto: false, speed: 0.8, kill: 300, sound: 'rpg', explosive: true },
  // Relics: only found by digging graves and opening tombs (never sold). Lost when you die.
  goldak: { name: 'Golden AK', slot: 'primary', loot: true, price: 0, dmg: 44, head: 4, armorPen: 0.92, rpm: 650, mag: 40, reserve: 160, reload: 2.2, range: 230, falloff: [60, 190], spread: 0.005, moveSpread: 0.05, adsSpread: 0.0018, kick: 0.013, auto: true, speed: 0.93, kill: 300, pen: 0.85, sound: 'rifle' },
  barrett: { name: 'Thunder .50', slot: 'primary', loot: true, price: 0, dmg: 150, head: 2.2, legMult: 0.8, armorPen: 1, rpm: 60, mag: 5, reserve: 20, reload: 3.4, range: 500, falloff: [300, 500], spread: 0.07, moveSpread: 0.12, adsSpread: 0.0003, kick: 0.11, auto: false, speed: 0.8, zoom: 5, kill: 100, pen: 1.4, sound: 'sniper', antiArmor: true },
  gl: { name: 'Drum Launcher', slot: 'primary', loot: true, price: 0, projectile: 'shell', dmg: 120, blast: 5.5, rocketSpeed: 42, gravity: 9, rpm: 120, mag: 6, reserve: 12, reload: 4.2, range: 200, spread: 0.012, moveSpread: 0.04, adsSpread: 0.006, kick: 0.08, auto: false, speed: 0.85, kill: 300, sound: 'rpg', explosive: true },
  ancestral: { name: "Ancestor's Dane Gun", slot: 'primary', loot: true, price: 0, pellets: 12, dmg: 21, head: 1.7, armorPen: 0.7, rpm: 75, mag: 2, reserve: 20, reload: 2.0, range: 40, falloff: [10, 32], spread: 0.06, moveSpread: 0.02, adsSpread: 0.045, kick: 0.09, auto: false, speed: 1.0, kill: 900, pen: 0.2, sound: 'shotgun' }
};

export const GEAR = {
  vest: { name: 'Kevlar vest', price: 650, armor: 100 },
  helmet: { name: 'Vest + helmet', price: 1000, armor: 100, helmet: true },
  frag: { name: 'Frag grenade', price: 300, max: 2, fuse: 2.6, blast: 7, dmg: 115, explosive: true },
  smoke: { name: 'Smoke grenade', price: 300, max: 1, fuse: 1.6, radius: 5.5, duration: 16 },
  flash: { name: 'Flashbang', price: 200, max: 2, fuse: 1.5, radius: 18 },
  medkit: { name: 'First aid kit', price: 400, max: 1, heal: 50, useTime: 3 },
  // Quick blood top-up you can take while moving: heals over a few seconds.
  bloodpill: { name: 'Blood pill', price: 250, max: 3, heal: 35, secs: 2.5 },
  // Plastic explosive: stick it on a wall, car or the ground (P), set it off from anywhere (L).
  c4: { name: 'C4 charge', price: 900, max: 2, explosive: true }
};

// Bare-hand punch (quick melee, any time). Three hits on the same enemy in a row land a heavy blow.
export const PUNCH = { dmg: 28, backstab: 55, range: 1.8, cooldownMs: 360, combo: 3, comboWindowMs: 1600, comboBonus: 30 };

// Staying alive: health comes back after a few seconds out of fire; bots hit humans a bit softer;
// everyone lands with light armour and one blood pill.
export const HEALTH = {
  regenDelayMs: 5000,
  regenPerSec: 9,
  botDamageToHumans: 0.7,
  botMaxHit: 38, // no single bot bullet can one-shot a player (not even a headshot)
  secondWindHp: 20, // once per life, a hit that would kill you leaves you on this much health
  secondWindMs: 1500, // with a moment of protection to find cover
  startArmor: 40,
  startPills: 1
};

// Gemstones on the ground advert tiles: walk over one to heal (or armour up). They come back after a while.
export const TILE_GEMS = {
  perTile: 4,
  respawnMs: 40000,
  radius: 1.4,
  types: {
    ruby: { name: 'Ruby', heal: 30, color: '#ff2d55', weight: 45 },
    emerald: { name: 'Emerald', heal: 60, color: '#22e07a', weight: 28 },
    sapphire: { name: 'Sapphire', armor: 50, color: '#2f7bff', weight: 20 },
    topaz: { name: 'Golden Topaz', heal: 100, armor: 25, color: '#ffc21a', weight: 7 }
  }
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
  chatMs: 120000, // longest protected chat with a business before you are back in the fight
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

// Game modes. Matches are keyed by mode + state.
export const MODES = {
  conquest: {
    label: 'Hold Ground',
    blurb: 'Capture and hold A, B and C. Every second wey una hold am dey bring point and money.',
    sites: true,
    respawn: true,
    scoreLimit: 750,
    timeLimitMs: 15 * 60 * 1000,
    icon: '⛳'
  },
  tdm: {
    label: 'Gbas Gbos',
    blurb: 'Team deathmatch. No site, na only kill. First team wey reach 60 kills win.',
    sites: false,
    respawn: true,
    scoreLimit: 60,
    timeLimitMs: 10 * 60 * 1000,
    icon: '💥'
  },
  bomb: {
    label: 'Plant & Defuse',
    blurb: 'Rounds, one life each round. Outlaws go plant bomb for A or B; Security go stop dem or defuse am. First to 5 rounds.',
    sites: true,
    bombSites: ['A', 'B'],
    respawn: false,
    scoreLimit: 5,
    timeLimitMs: 40 * 60 * 1000,
    icon: '💣'
  },
  practice: {
    label: 'Practice Range',
    blurb: 'Your private training ground (you and your crew only): target dummies wey no dey shoot back, free kit, train swimming and fitness 3x faster. Nothing count for your record.',
    sites: false,
    respawn: true,
    practice: true,
    private: true,
    scoreLimit: 0,
    timeLimitMs: 60 * 60 * 1000,
    icon: '🎯'
  },
  stage: {
    label: 'Campaign Stages',
    blurb: 'Solo missions against waves of enemies across Naija. Clear one stage to open the next.',
    sites: false,
    respawn: true,
    solo: true,
    scoreLimit: 0,
    timeLimitMs: 30 * 60 * 1000,
    icon: '🎖'
  }
};

export const BOMB = {
  freezeMs: 8000, // buy time at the start of each round (nobody can shoot)
  roundMs: 115000,
  fuseMs: 40000,
  plantSecs: 3.5,
  defuseSecs: 7,
  actionRange: 2.2, // how close you must be to defuse / how far you may drift while acting
  blast: 22,
  dmg: 400,
  postMs: 6000, // pause between rounds
  winMoney: 3000,
  lossMoney: 1900,
  plantMoney: 400
};

// Campaign: each stage is a state, an enemy faction and waves to survive.
// diff 0..1 sets bot aim and reactions; lives = deaths allowed before the stage is lost.
export const STAGES = [
  { state: 'lagos', enemy: 'smuggler', ally: 'police', waves: 3, diff: 0.15, lives: 4, title: 'Wahala for Marina', story: 'Smugglers don take over the port. Clear dem commot before dem load the containers.' },
  { state: 'ogun', enemy: 'bandit', ally: 'police', waves: 3, diff: 0.22, lives: 4, title: 'Olumo Rock Lookout', story: 'Bandits dey use Olumo Rock as hideout. Climb, hold, push dem back.' },
  { state: 'oyo', enemy: 'bandit', ally: 'vigilante', waves: 4, diff: 0.28, lives: 4, title: 'Cashew Farm Raid', story: 'Farmers dey cry. Bandits wan carry the harvest. Hunters, follow us.' },
  { state: 'delta', enemy: 'militant', ally: 'army', waves: 4, diff: 0.34, lives: 3, title: 'Creek Patrol', story: 'Militants dey bunker crude for the creeks. Water go slow you; dem no slow.' },
  { state: 'rivers', enemy: 'militant', ally: 'army', waves: 4, diff: 0.4, lives: 3, title: 'Bonny Gas Flare', story: 'Dem wan blow the flow station. Hold am, and mind the fuel drums.' },
  { state: 'plateau', enemy: 'bandit', ally: 'civildefence', waves: 5, diff: 0.46, lives: 3, title: 'Tin Mine Standoff', story: 'For Jos the cold sharp, the fight sharper. Guard the tin mine.' },
  { state: 'kaduna', enemy: 'bandit', ally: 'army', waves: 5, diff: 0.52, lives: 3, title: 'Gold Pit Ambush', story: 'Illegal miners and bandits don join hand. Clear the gold pit.' },
  { state: 'zamfara', enemy: 'bandit', ally: 'army', waves: 5, diff: 0.58, lives: 3, title: 'Dust and Gold', story: 'Na their home ground this. Every bush fit hide gun.' },
  { state: 'kano', enemy: 'smuggler', ally: 'police', waves: 6, diff: 0.64, lives: 3, title: 'Gate of Kano', story: 'Smugglers dey move goods through the old city gate. Close am for good.' },
  { state: 'borno', enemy: 'bandit', ally: 'army', waves: 6, diff: 0.72, lives: 2, title: 'Sahel Storm', story: 'Harmattan full everywhere. You no go see far. Trust your ears.' },
  { state: 'benue', enemy: 'bandit', ally: 'vigilante', waves: 6, diff: 0.8, lives: 2, title: 'Food Basket', story: 'Dem wan scatter the nation food basket. No gree for dem.' },
  { state: 'fct', enemy: 'militant', ally: 'army', waves: 7, diff: 0.9, lives: 2, title: 'Aso Rock Final Stand', story: 'Last stage. Everybody don gather for Abuja. Show say you get Proof of Duty.' }
];
export const WAVE = { base: 3, perWave: 1.5, perStage: 0.25, gapMs: 6000, allies: 2 };

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
