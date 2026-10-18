// Data for the native Android game (Godot): the game rules and each state's map, straight from
// the shared code the server itself uses. The native app never copies these numbers, so a
// balance change here reaches both apps at once.
import { gzipSync } from 'node:zlib';
import * as C from '../shared/config.js';
import { STATES, BIOMES, RESOURCES, ZONES } from '../shared/states.js';
import { regionById, COUNTRIES } from '../shared/regions.js';
import { VEHICLES } from '../shared/vehicles.js';
import { SKILLS, DROWN } from '../shared/skills.js';
import { DIG } from '../shared/underworld.js';
import { generateMap } from '../shared/map.js';

let rulesCache = null;
const mapCache = new Map();

export function nativeRules() {
  if (rulesCache) return rulesCache;
  const body = {
    GAME: C.GAME,
    SIDES: C.SIDES,
    FACTIONS: C.FACTIONS,
    WEAPONS: C.WEAPONS,
    WEAPON_IDS: Object.keys(C.WEAPONS), // the order soldiers' weapons are sent in snapshots
    GEAR: C.GEAR,
    PUNCH: C.PUNCH,
    HEALTH: C.HEALTH,
    TILE_GEMS: C.TILE_GEMS,
    KILLSTREAKS: C.KILLSTREAKS,
    GEMS: C.GEMS,
    RESPAWN: C.RESPAWN,
    MATCH: C.MATCH,
    MODES: C.MODES,
    MONEY: C.MONEY,
    PLAYER: C.PLAYER,
    XP: C.XP,
    RANKS: C.RANKS,
    NET: C.NET,
    STATES,
    COUNTRIES,
    BIOMES,
    RESOURCES,
    ZONES,
    VEHICLES,
    SKILLS,
    DROWN,
    DIG
  };
  rulesCache = gzipSync(JSON.stringify(body));
  return rulesCache;
}

// Everything the native app needs to draw and walk a state's battlefield. The collision
// index and bot navigation grid stay on the server (the app builds its own index).
export function nativeMap(stateId) {
  if (!regionById(stateId)) return null;
  if (mapCache.has(stateId)) return mapCache.get(stateId);
  const m = generateMap(stateId);
  const { index, nav, ...rest } = m;
  const gz = gzipSync(JSON.stringify(rest));
  mapCache.set(stateId, gz);
  // Keep the most recent 160 battlefields.
  if (mapCache.size > 160) mapCache.delete(mapCache.keys().next().value);
  return gz;
}

export function sendGz(res, gz) {
  res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' });
  res.end(gz);
}
