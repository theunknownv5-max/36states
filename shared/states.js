// Nigeria's 36 states + the FCT (hand-made). Every other country's regions come from
// shared/world/<cc>.json via shared/regions.js. Each region becomes its own battlefield.
// lat/lon are approximate state centres (used to draw the war map).
// biome drives the terrain look; resources become the capture sites; landmark is built into the map.

export const ZONES = {
  NC: 'North Central',
  NE: 'North East',
  NW: 'North West',
  SE: 'South East',
  SS: 'South South',
  SW: 'South West'
};

export const BIOMES = {
  sahel: { label: 'Sahel (dry, sandy)', ground: '#c9a46b', grass: 0.08, haze: '#e2c79a' },
  savanna: { label: 'Guinea savanna', ground: '#a8884f', grass: 0.5, haze: '#d6c08e' },
  plateau: { label: 'Highland plateau', ground: '#8a7a5c', grass: 0.45, haze: '#b9c2c8' },
  rainforest: { label: 'Rainforest', ground: '#8a4f2c', grass: 0.7, haze: '#a9b89a' },
  creeks: { label: 'Creeks & mangroves', ground: '#5d5137', grass: 0.6, haze: '#9fb3a8' },
  urban: { label: 'City', ground: '#77716a', grass: 0.1, haze: '#cdb99a' },
  // World biomes: their own look, built with the terrain rules of the biome named in base.
  desert: { label: 'Desert', ground: '#d8b47a', grass: 0.02, haze: '#ecd3a2', base: 'sahel' },
  temperate: { label: 'Green countryside', ground: '#6f7a4a', grass: 0.75, haze: '#b8c6cf', base: 'savanna' },
  snow: { label: 'Snow and pine', ground: '#e6ebef', grass: 0.15, haze: '#d4dde6', base: 'plateau' }
};

// Natural resources and the facility built for each on the map.
export const RESOURCES = {
  crude: { label: 'Crude oil', site: 'Oil Wellhead', prop: 'wellhead', colour: '#1b1b1b' },
  gas: { label: 'Natural gas', site: 'Gas Flow Station', prop: 'tanks', colour: '#ff8a3d' },
  gold: { label: 'Gold', site: 'Gold Pit', prop: 'pit', colour: '#ffd54f' },
  tin: { label: 'Tin', site: 'Tin Mine', prop: 'mine', colour: '#b0bec5' },
  columbite: { label: 'Columbite', site: 'Columbite Mine', prop: 'mine', colour: '#78909c' },
  coal: { label: 'Coal', site: 'Coal Mine', prop: 'mine', colour: '#212121' },
  limestone: { label: 'Limestone', site: 'Limestone Quarry', prop: 'quarry', colour: '#e0e0e0' },
  iron: { label: 'Iron ore', site: 'Iron Ore Mine', prop: 'mine', colour: '#8d4b32' },
  lithium: { label: 'Lithium', site: 'Lithium Pit', prop: 'pit', colour: '#b39ddb' },
  bitumen: { label: 'Bitumen', site: 'Bitumen Field', prop: 'wellhead', colour: '#263238' },
  kaolin: { label: 'Kaolin', site: 'Kaolin Quarry', prop: 'quarry', colour: '#f5f5f5' },
  salt: { label: 'Salt', site: 'Salt Lake Works', prop: 'pans', colour: '#ffffff' },
  marble: { label: 'Marble', site: 'Marble Quarry', prop: 'quarry', colour: '#eceff1' },
  leadzinc: { label: 'Lead & zinc', site: 'Lead-Zinc Mine', prop: 'mine', colour: '#90a4ae' },
  gypsum: { label: 'Gypsum', site: 'Gypsum Pit', prop: 'pit', colour: '#fafafa' },
  granite: { label: 'Granite', site: 'Granite Quarry', prop: 'quarry', colour: '#9e9e9e' },
  barytes: { label: 'Barytes', site: 'Barytes Mine', prop: 'mine', colour: '#bdbdbd' },
  phosphate: { label: 'Phosphate', site: 'Phosphate Mine', prop: 'mine', colour: '#cfd8dc' },
  tantalite: { label: 'Tantalite', site: 'Tantalite Pit', prop: 'pit', colour: '#607d8b' },
  gemstones: { label: 'Gemstones', site: 'Gemstone Pit', prop: 'pit', colour: '#4dd0e1' },
  talc: { label: 'Talc', site: 'Talc Mine', prop: 'mine', colour: '#f1f8e9' },
  diatomite: { label: 'Diatomite', site: 'Diatomite Pit', prop: 'pit', colour: '#efebe9' },
  bentonite: { label: 'Bentonite', site: 'Bentonite Pit', prop: 'pit', colour: '#d7ccc8' },
  cocoa: { label: 'Cocoa', site: 'Cocoa Plantation', prop: 'farm', colour: '#6d4c41' },
  groundnut: { label: 'Groundnut', site: 'Groundnut Pyramids', prop: 'sacks', colour: '#d7a86e' },
  rice: { label: 'Rice', site: 'Rice Fields', prop: 'farm', colour: '#9ccc65' },
  tea: { label: 'Tea', site: 'Tea Estate', prop: 'farm', colour: '#558b2f' },
  cattle: { label: 'Cattle', site: 'Cattle Ranch', prop: 'ranch', colour: '#8d6e63' },
  fish: { label: 'Fish', site: 'Fishing Jetty', prop: 'jetty', colour: '#4fc3f7' },
  rubber: { label: 'Rubber', site: 'Rubber Plantation', prop: 'farm', colour: '#33691e' },
  timber: { label: 'Timber', site: 'Timber Camp', prop: 'logs', colour: '#795548' },
  sesame: { label: 'Sesame', site: 'Sesame Farm', prop: 'sacks', colour: '#e6cf8b' },
  gumarabic: { label: 'Gum arabic', site: 'Gum Arabic Grove', prop: 'farm', colour: '#a1887f' },
  ginger: { label: 'Ginger', site: 'Ginger Farm', prop: 'sacks', colour: '#c8a165' },
  cotton: { label: 'Cotton', site: 'Cotton Gin', prop: 'sacks', colour: '#fafafa' },
  cashew: { label: 'Cashew', site: 'Cashew Orchard', prop: 'farm', colour: '#ffb74d' },
  hydro: { label: 'Hydropower', site: 'Hydro Station', prop: 'tanks', colour: '#29b6f6' },
  port: { label: 'Sea trade', site: 'Seaport Depot', prop: 'containers', colour: '#e53935' },
  copper: { label: 'Copper', site: 'Copper Mine', prop: 'mine', colour: '#c46f3c' },
  potash: { label: 'Potash', site: 'Potash Works', prop: 'pans', colour: '#f0c9c9' },
  solar: { label: 'Solar power', site: 'Solar Farm', prop: 'tanks', colour: '#3949ab' },
  uranium: { label: 'Uranium', site: 'Uranium Mine', prop: 'mine', colour: '#c0ca33' },
  diamonds: { label: 'Diamonds', site: 'Diamond Pit', prop: 'pit', colour: '#e0f7fa' },
  palmoil: { label: 'Palm oil', site: 'Palm Oil Mill', prop: 'farm', colour: '#e65100' },
  silver: { label: 'Silver', site: 'Silver Mine', prop: 'mine', colour: '#cfd8dc' },
  wheat: { label: 'Wheat', site: 'Grain Silos', prop: 'sacks', colour: '#e6c35c' },
  grapes: { label: 'Vineyards', site: 'Vineyard', prop: 'farm', colour: '#7b1fa2' },
  nickel: { label: 'Nickel', site: 'Nickel Mine', prop: 'mine', colour: '#9e9d89' },
  coffee: { label: 'Coffee', site: 'Coffee Estate', prop: 'farm', colour: '#4e342e' }
};

// Landmark types: rock (monolith), hills (boulder field), gate (ancient city gate), flare (gas flare stack),
// tower (tall structure), falls (cliff + waterfall), lake (water body), palace (traditional palace).
export const STATES = [
  { id: 'abia', name: 'Abia', capital: 'Umuahia', zone: 'SE', biome: 'rainforest', lat: 5.45, lon: 7.5, resources: ['crude', 'gas', 'leadzinc'], landmark: { name: 'Arochukwu Long Juju Caves', type: 'rock' } },
  { id: 'adamawa', name: 'Adamawa', capital: 'Yola', zone: 'NE', biome: 'savanna', lat: 9.3, lon: 12.4, resources: ['kaolin', 'bentonite', 'cattle'], landmark: { name: 'Sukur Hills', type: 'hills' } },
  { id: 'akwaibom', name: 'Akwa Ibom', capital: 'Uyo', zone: 'SS', biome: 'creeks', lat: 4.9, lon: 7.85, resources: ['crude', 'gas', 'fish'], landmark: { name: 'Qua Iboe Gas Flare', type: 'flare' } },
  { id: 'anambra', name: 'Anambra', capital: 'Awka', zone: 'SE', biome: 'rainforest', lat: 6.2, lon: 6.95, resources: ['gas', 'crude', 'kaolin'], landmark: { name: 'Ogbunike Caves', type: 'rock' } },
  { id: 'bauchi', name: 'Bauchi', capital: 'Bauchi', zone: 'NE', biome: 'savanna', lat: 10.5, lon: 10.0, resources: ['tin', 'columbite', 'limestone'], landmark: { name: 'Wikki Warm Spring (Yankari)', type: 'lake' } },
  { id: 'bayelsa', name: 'Bayelsa', capital: 'Yenagoa', zone: 'SS', biome: 'creeks', lat: 4.75, lon: 6.1, resources: ['crude', 'gas', 'fish'], landmark: { name: 'Oloibiri Oil Well No. 1', type: 'flare' } },
  { id: 'benue', name: 'Benue', capital: 'Makurdi', zone: 'NC', biome: 'savanna', lat: 7.35, lon: 8.75, resources: ['limestone', 'barytes', 'leadzinc'], landmark: { name: 'Ushongo Hills', type: 'hills' } },
  { id: 'borno', name: 'Borno', capital: 'Maiduguri', zone: 'NE', biome: 'sahel', lat: 11.9, lon: 13.1, resources: ['diatomite', 'gumarabic', 'fish'], landmark: { name: 'Lake Chad Shore', type: 'lake' } },
  { id: 'crossriver', name: 'Cross River', capital: 'Calabar', zone: 'SS', biome: 'rainforest', lat: 5.9, lon: 8.6, resources: ['limestone', 'cocoa', 'timber'], landmark: { name: 'Agbokim Waterfalls', type: 'falls' } },
  { id: 'delta', name: 'Delta', capital: 'Asaba', zone: 'SS', biome: 'creeks', lat: 5.7, lon: 5.9, resources: ['crude', 'gas', 'rubber'], landmark: { name: 'Escravos Flow Station', type: 'flare' } },
  { id: 'ebonyi', name: 'Ebonyi', capital: 'Abakaliki', zone: 'SE', biome: 'rainforest', lat: 6.25, lon: 8.0, resources: ['leadzinc', 'salt', 'limestone'], landmark: { name: 'Uburu Salt Lake', type: 'lake' } },
  { id: 'edo', name: 'Edo', capital: 'Benin City', zone: 'SS', biome: 'rainforest', lat: 6.6, lon: 5.9, resources: ['crude', 'marble', 'rubber'], landmark: { name: 'Benin City Walls (Iya)', type: 'gate' } },
  { id: 'ekiti', name: 'Ekiti', capital: 'Ado-Ekiti', zone: 'SW', biome: 'rainforest', lat: 7.7, lon: 5.3, resources: ['kaolin', 'granite', 'cocoa'], landmark: { name: 'Ikogosi Warm Springs', type: 'lake' } },
  { id: 'enugu', name: 'Enugu', capital: 'Enugu', zone: 'SE', biome: 'rainforest', lat: 6.55, lon: 7.4, resources: ['coal', 'limestone', 'iron'], landmark: { name: 'Udi Hills (Coal City)', type: 'hills' } },
  { id: 'gombe', name: 'Gombe', capital: 'Gombe', zone: 'NE', biome: 'savanna', lat: 10.35, lon: 11.2, resources: ['crude', 'limestone', 'gypsum'], landmark: { name: 'Tangale Peak', type: 'rock' } },
  { id: 'imo', name: 'Imo', capital: 'Owerri', zone: 'SE', biome: 'rainforest', lat: 5.55, lon: 7.05, resources: ['crude', 'gas', 'leadzinc'], landmark: { name: 'Oguta Lake', type: 'lake' } },
  { id: 'jigawa', name: 'Jigawa', capital: 'Dutse', zone: 'NW', biome: 'sahel', lat: 12.2, lon: 9.6, resources: ['sesame', 'groundnut', 'kaolin'], landmark: { name: 'Birnin Kudu Rock', type: 'rock' } },
  { id: 'kaduna', name: 'Kaduna', capital: 'Kaduna', zone: 'NW', biome: 'savanna', lat: 10.4, lon: 7.7, resources: ['gold', 'gemstones', 'ginger'], landmark: { name: 'Kajuru Castle', type: 'palace' } },
  { id: 'kano', name: 'Kano', capital: 'Kano', zone: 'NW', biome: 'sahel', lat: 11.7, lon: 8.5, resources: ['groundnut', 'tin', 'cotton'], landmark: { name: 'Ancient Kano City Gate', type: 'gate' } },
  { id: 'katsina', name: 'Katsina', capital: 'Katsina', zone: 'NW', biome: 'sahel', lat: 12.4, lon: 7.6, resources: ['kaolin', 'cotton', 'groundnut'], landmark: { name: 'Gobarau Minaret', type: 'tower' } },
  { id: 'kebbi', name: 'Kebbi', capital: 'Birnin Kebbi', zone: 'NW', biome: 'sahel', lat: 11.6, lon: 4.1, resources: ['gold', 'rice', 'fish'], landmark: { name: 'Argungu Fishing Grounds', type: 'lake' } },
  { id: 'kogi', name: 'Kogi', capital: 'Lokoja', zone: 'NC', biome: 'savanna', lat: 7.75, lon: 6.6, resources: ['iron', 'coal', 'marble'], landmark: { name: 'Mount Patti', type: 'hills' } },
  { id: 'kwara', name: 'Kwara', capital: 'Ilorin', zone: 'NC', biome: 'savanna', lat: 8.9, lon: 4.7, resources: ['limestone', 'gold', 'marble'], landmark: { name: 'Owu Falls', type: 'falls' } },
  { id: 'lagos', name: 'Lagos', capital: 'Ikeja', zone: 'SW', biome: 'urban', lat: 6.5, lon: 3.5, resources: ['port', 'crude', 'fish'], landmark: { name: 'Marina Skyline', type: 'tower' } },
  { id: 'nasarawa', name: 'Nasarawa', capital: 'Lafia', zone: 'NC', biome: 'savanna', lat: 8.5, lon: 8.3, resources: ['lithium', 'tantalite', 'salt'], landmark: { name: 'Farin Ruwa Falls', type: 'falls' } },
  { id: 'niger', name: 'Niger', capital: 'Minna', zone: 'NC', biome: 'savanna', lat: 9.9, lon: 5.7, resources: ['gold', 'talc', 'hydro'], landmark: { name: 'Zuma Rock', type: 'rock' } },
  { id: 'ogun', name: 'Ogun', capital: 'Abeokuta', zone: 'SW', biome: 'rainforest', lat: 7.0, lon: 3.4, resources: ['limestone', 'phosphate', 'cocoa'], landmark: { name: 'Olumo Rock', type: 'rock' } },
  { id: 'ondo', name: 'Ondo', capital: 'Akure', zone: 'SW', biome: 'rainforest', lat: 7.0, lon: 5.0, resources: ['bitumen', 'crude', 'cocoa'], landmark: { name: 'Idanre Hills', type: 'hills' } },
  { id: 'osun', name: 'Osun', capital: 'Osogbo', zone: 'SW', biome: 'rainforest', lat: 7.6, lon: 4.5, resources: ['gold', 'kaolin', 'cocoa'], landmark: { name: 'Erin-Ijesha Waterfalls', type: 'falls' } },
  { id: 'oyo', name: 'Oyo', capital: 'Ibadan', zone: 'SW', biome: 'savanna', lat: 8.2, lon: 3.6, resources: ['kaolin', 'marble', 'cashew'], landmark: { name: 'Cocoa House', type: 'tower' } },
  { id: 'plateau', name: 'Plateau', capital: 'Jos', zone: 'NC', biome: 'plateau', lat: 9.2, lon: 9.4, resources: ['tin', 'columbite', 'lithium'], landmark: { name: 'Shere Hills', type: 'hills' } },
  { id: 'rivers', name: 'Rivers', capital: 'Port Harcourt', zone: 'SS', biome: 'creeks', lat: 4.8, lon: 6.9, resources: ['crude', 'gas', 'port'], landmark: { name: 'Bonny Island Gas Flare', type: 'flare' } },
  { id: 'sokoto', name: 'Sokoto', capital: 'Sokoto', zone: 'NW', biome: 'sahel', lat: 13.0, lon: 5.3, resources: ['limestone', 'phosphate', 'gypsum'], landmark: { name: "Sultan's Palace", type: 'palace' } },
  { id: 'taraba', name: 'Taraba', capital: 'Jalingo', zone: 'NE', biome: 'plateau', lat: 8.0, lon: 10.8, resources: ['tea', 'leadzinc', 'cattle'], landmark: { name: 'Mambilla Plateau', type: 'hills' } },
  { id: 'yobe', name: 'Yobe', capital: 'Damaturu', zone: 'NE', biome: 'sahel', lat: 12.3, lon: 11.5, resources: ['gumarabic', 'diatomite', 'cattle'], landmark: { name: 'Dagona Waterfowl Sanctuary', type: 'lake' } },
  { id: 'zamfara', name: 'Zamfara', capital: 'Gusau', zone: 'NW', biome: 'sahel', lat: 12.1, lon: 6.2, resources: ['gold', 'cotton', 'cattle'], landmark: { name: 'Kwatarkwashi Hills', type: 'hills' } },
  { id: 'fct', name: 'Abuja (FCT)', capital: 'Abuja', zone: 'NC', biome: 'savanna', lat: 8.85, lon: 7.15, resources: ['granite', 'marble', 'tantalite'], landmark: { name: 'Aso Rock', type: 'rock' }, capitalTerritory: true }
];

export const STATE_BY_ID = Object.fromEntries(STATES.map((s) => [s.id, s]));

// Stable numeric seed per state so every client and the server generate the same map.
export function stateSeed(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
