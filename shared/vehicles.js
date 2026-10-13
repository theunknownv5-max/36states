// Vehicles you can enter, drive, shoot from and blow up; houses that burn; C4 charges; the paid
// ambulance. Shared by the server (authority) and the client (driving feel, looks).
// Yaw follows the soldiers' convention: yaw 0 faces -z, forward = (-sin yaw, -cos yaw).
import { query } from './physics.js';

// L/W/H in metres. top = top speed (m/s). seatY = where the driver sits, eye = eye height.
// open: the rider is out in the air (bullets reach them fully). armored: bullets do nothing,
// only explosives hurt it, and whoever is inside can't be shot.
export const VEHICLES = {
  sedan: { name: 'Saloon car', L: 4.6, W: 1.8, H: 1.45, hp: 260, top: 21, accel: 8.5, brake: 16, turn: 1.9, seatY: 0.35, eye: 1.2, wheels: 4, colours: ['#c9ccd1', '#151719', '#f4f4f2', '#8e1b1b', '#1e2f55', '#b7a57a', '#2f4f3a', '#6b6f75', '#5a1a24'] },
  suv: { name: 'Jeep', L: 4.8, W: 1.95, H: 1.85, hp: 340, top: 20, accel: 8, brake: 15, turn: 1.75, seatY: 0.55, eye: 1.5, wheels: 4, colours: ['#151719', '#f4f4f2', '#c9ccd1', '#3a3f45', '#4a3a2a', '#24324a'] },
  pickup: { name: 'Hilux', L: 5.3, W: 1.9, H: 1.8, hp: 320, top: 20, accel: 8, brake: 15, turn: 1.7, seatY: 0.55, eye: 1.5, wheels: 4, colours: ['#f4f4f2', '#c9ccd1', '#151719', '#7a2a1a', '#c2a46a', '#3b4a2a'] },
  danfo: { name: 'Danfo bus', L: 5.0, W: 2.0, H: 2.25, hp: 380, top: 16, accel: 6, brake: 12, turn: 1.5, seatY: 0.6, eye: 1.65, wheels: 4, colours: ['#f2b705'] },
  keke: { name: 'Keke', L: 2.75, W: 1.35, H: 1.8, hp: 150, top: 12, accel: 6, brake: 12, turn: 2.2, seatY: 0.45, eye: 1.4, wheels: 3, open: true, colours: ['#f2c200', '#1f8a3b', '#2d6fd0', '#f2c200'] },
  okada: { name: 'Okada', L: 2.0, W: 0.75, H: 1.15, hp: 90, top: 19, accel: 9, brake: 14, turn: 2.6, seatY: 0.55, eye: 1.55, wheels: 2, open: true, bike: true, colours: ['#b3121b', '#151719', '#1d3f8a', '#c9ccd1'] },
  lorry: { name: 'Lorry', L: 7.6, W: 2.45, H: 3.1, hp: 620, top: 13, accel: 4.5, brake: 10, turn: 1.25, seatY: 1.0, eye: 2.25, wheels: 6, colours: ['#2f5d9a', '#b3121b', '#e0a21a', '#2f6b3a'] },
  apc: { name: 'Armoured carrier', L: 6.3, W: 2.6, H: 2.5, hp: 720, top: 13, accel: 5, brake: 11, turn: 1.3, seatY: 2.15, eye: 3.05, wheels: 6, armored: true, colours: ['#4b5432'] }
};
export const VEHICLE_IDS = Object.keys(VEHICLES);

// Damage tuning. Bullets dent cars; rockets and C4 wreck them. An APC only feels explosives.
export const WRECK = {
  bulletMult: 0.25, // share of a bullet's damage a (non-armoured) vehicle takes
  botBulletMult: 0.5, // bots' stray spray dents cars even less, so parked cars last as cover
  blastMult: 1.6, // explosives against cars
  armoredBlastMult: 1.1,
  passMult: 0.7, // bullet damage left after going through a car door/window
  fireAt: 0.28, // at this share of health the engine catches fire...
  fireDrainPerSec: 0.09, // ...and burns down (share of max health per second) until it blows
  blast: 6.5,
  blastDmg: 140,
  burnSecs: 26, // the wreck burns, then stays as a charred shell
  burnRadius: 2.6,
  runOverMin: 5.5, // m/s before running someone over hurts them
  runOverDmg: 7, // damage per m/s of speed
  crashMin: 9, // hitting a wall faster than this damages the vehicle
  crashDmg: 9
};

// Houses: rockets, grenades and C4 damage them; at zero they burn, the roof caves in, and the
// walls stay as a black charcoal shell.
export const HOUSES = { hp: { mud: 520, plank: 360, plaster: 680, stone: 950 }, burnSecs: 34, c4Mult: 2.8 };

// C4: stick it on a wall, a vehicle or the ground, then set it off from anywhere.
export const C4 = { maxPlanted: 4, reach: 3.2, blast: 7.5, dmg: 260, chainMs: 160 };

// The ambulance you can call when you're hurt: costs battle money and can't be spammed.
export const AMBULANCE = { fee: 1500, cooldownMs: 120000, minMissing: 30, speed: 15, minMs: 4500, maxMs: 14000, reach: 7, stayMs: 4000, armor: 25 };

export const forward = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

// Axis-aligned box around a vehicle at any angle (its collision box in the world grid).
export function footprint(type, x, z, yaw) {
  const d = VEHICLES[type];
  const s = Math.abs(Math.sin(yaw));
  const c = Math.abs(Math.cos(yaw));
  const hx = (s * d.L) / 2 + (c * d.W) / 2;
  const hz = (c * d.L) / 2 + (s * d.W) / 2;
  return { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz };
}

// Is a point inside the vehicle's real (rotated) outline, grown by pad metres?
export function insideVehicle(type, x, z, yaw, px, pz, pad = 0) {
  const d = VEHICLES[type];
  const [fx, fz] = forward(yaw);
  const dx = px - x;
  const dz = pz - z;
  const along = dx * fx + dz * fz;
  const side = dx * -fz + dz * fx;
  return Math.abs(along) <= d.L / 2 + pad && Math.abs(side) <= d.W / 2 + pad;
}

const tmp = [];
// Would the vehicle overlap a wall here? Its outline is a row of circles along its length.
export function vehicleBlocked(type, x, z, yaw, index, selfBox = -1, shrink = 0) {
  const d = VEHICLES[type];
  const [fx, fz] = forward(yaw);
  const r = Math.max(0.2, (d.W / 2) * 0.95 - shrink);
  const reach = Math.max(0, d.L / 2 - d.W / 2);
  const n = Math.max(2, Math.ceil(d.L / d.W) + 1);
  for (let k = 0; k < n; k++) {
    const t = -reach + (2 * reach * k) / (n - 1);
    const cx = x + fx * t;
    const cz = z + fz * t;
    query(index, cx - r, cz - r, cx + r, cz + r, tmp);
    for (const i of tmp) {
      if (i === selfBox) continue;
      const b = index.boxes[i];
      if (b.y1 <= 0.5 || b.y0 >= 1.5) continue; // kerbs you roll over, lintels and roofs above
      const ex = Math.max(b.x0 - cx, 0, cx - b.x1);
      const ez = Math.max(b.z0 - cz, 0, cz - b.z1);
      if (ex * ex + ez * ez < r * r) return true;
    }
  }
  return false;
}

// One step of arcade driving. v: { type, x, z, yaw, speed }. ctl: { throttle, steer, brake }
// (-1..1, -1..1, bool). Returns the impact speed if we hit something (0 otherwise).
export function driveStep(v, ctl, dt, index, half, { selfBox = -1, slowAt = null } = {}) {
  const d = VEHICLES[v.type];
  const thr = ctl.throttle || 0;
  let acc = 0;
  if (thr > 0.05) acc = v.speed < -0.5 ? d.brake : d.accel * thr * (1 - (Math.max(0, v.speed) / d.top) * 0.55);
  else if (thr < -0.05) acc = v.speed > 0.5 ? -d.brake : -d.accel * 0.6 * -thr;
  v.speed += acc * dt;
  const coasting = Math.abs(thr) < 0.05 || Math.sign(thr) !== Math.sign(v.speed);
  const drag = (coasting ? 2.4 : 0) + 0.01 * v.speed * v.speed + (ctl.brake ? d.brake * 1.2 : 0);
  v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), drag * dt);
  const slow = slowAt?.(v.x, v.z) ? 0.3 : 1;
  v.speed = Math.max(-d.top * 0.35 * slow, Math.min(d.top * slow, v.speed));
  // Steering bites harder at low speed; reversing steers the other way like a real car.
  const grip = Math.min(1, Math.abs(v.speed) / 4);
  const rate = (ctl.steer || 0) * d.turn * grip * (1 - 0.45 * Math.min(1, Math.abs(v.speed) / d.top));
  const oldYaw = v.yaw;
  v.yaw -= rate * Math.sign(v.speed || 1) * dt;
  if (vehicleBlocked(v.type, v.x, v.z, v.yaw, index, selfBox)) v.yaw = oldYaw;
  const dist = v.speed * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(dist) / 0.3));
  const [fx, fz] = forward(v.yaw);
  let impact = 0;
  for (let s = 0; s < steps; s++) {
    const nx = v.x + (fx * dist) / steps;
    const nz = v.z + (fz * dist) / steps;
    if (vehicleBlocked(v.type, nx, nz, v.yaw, index, selfBox)) {
      impact = Math.abs(v.speed);
      v.speed = -v.speed * 0.2;
      break;
    }
    v.x = nx;
    v.z = nz;
  }
  const lim = half - 2 - d.L / 2;
  if (Math.abs(v.x) > lim || Math.abs(v.z) > lim) {
    v.x = Math.max(-lim, Math.min(lim, v.x));
    v.z = Math.max(-lim, Math.min(lim, v.z));
    impact = Math.max(impact, Math.abs(v.speed));
    v.speed = 0;
  }
  return impact;
}

// Where someone getting out stands: beside the doors, else behind, else in front.
export function exitSpots(type, x, z, yaw) {
  const d = VEHICLES[type];
  const [fx, fz] = forward(yaw);
  const rx = -fz;
  const rz = fx;
  const side = d.W / 2 + 0.75;
  const end = d.L / 2 + 0.75;
  return [
    [x - rx * side, z - rz * side],
    [x + rx * side, z + rz * side],
    [x - fx * end, z - fz * end],
    [x + fx * end, z + fz * end],
    [x - rx * (side + 1.2), z - rz * (side + 1.2)],
    [x + rx * (side + 1.2), z + rz * (side + 1.2)]
  ];
}
