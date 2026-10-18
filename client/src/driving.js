// Driving: get into any car, danfo, keke, okada, lorry or (if you find one) the armoured carrier.
// W/S throttle and reverse, A/D steer, Space brake, E to get in or out. The mouse (or right
// thumb) still looks around and you can shoot out of the window; from the armoured carrier
// you fire the roof gun and nobody's bullets can reach you.
import { VEHICLES, driveStep, crushable } from '../../shared/vehicles.js';
import { inWater } from '../../shared/map.js';
import { audio } from './core/audio.js';

const $ = (id) => document.getElementById(id);

export class Driving {
  constructor(game) {
    this.g = game;
    this.v = null;
    this.view = null;
    this.hudKey = '';
  }

  get active() {
    return !!this.v;
  }

  get box() {
    return this.v ? this.v.box : -1;
  }

  get def() {
    return this.v ? VEHICLES[this.v.type] : null;
  }

  // The server put us in a seat.
  start(view) {
    const g = this.g;
    this.view = view;
    this.v = { i: view.i, type: view.type, x: view.x, z: view.z, yaw: view.yaw, speed: 0, box: view.box };
    g.yaw = view.yaw;
    g.pitch = -0.1;
    g.adsOn = false;
    $('veh-hud').hidden = false;
    $('veh-name').textContent = VEHICLES[view.type].name;
    audio.engine?.(true, view.type);
    g.hud.toast(VEHICLES[view.type].armored ? 'You are inside the armoured carrier. Bullets cannot reach you. Use the roof gun!' : `${VEHICLES[view.type].name}: W/S to drive, A/D to turn, Space to brake, E to get out.`, 'info', 3200);
  }

  stop() {
    if (!this.v) return;
    this.v = null;
    this.view = null;
    $('veh-hud').hidden = true;
    audio.engine?.(false);
  }

  correct(m) {
    if (!this.v) return;
    Object.assign(this.v, { x: m.x, z: m.z, yaw: m.yaw, speed: 0 });
  }

  step(dt) {
    const g = this.g;
    const v = this.v;
    const d = VEHICLES[v.type];
    const blocked = g.anyMenu() || g.adChat?.open || g.cams.mode === 'drone';
    const mv = blocked ? { x: 0, y: 0 } : g.input.move();
    const brake = !blocked && (g.input.down('Space') || g.input.touch?.jump);
    // Lorries and the armoured carrier drive straight through small cars and flimsy houses.
    const canCrush = d.crusher ? (b) => crushable(v.type, b, g.map) : null;
    const impact = driveStep(v, { throttle: mv.y, steer: mv.x, brake }, dt, g.map.index, g.map.half, { selfBox: v.box, slowAt: (x, z) => inWater(g.map, x, z), canCrush });
    if (impact > 7) {
      g.fx.shake = Math.min(1.4, g.fx.shake + impact / 18);
      audio.crash?.(impact);
    }
    g.vehicles.pose(this.view, v.x, v.z, v.yaw);
    this.view.speed = v.speed;
    this.view.steer += (mv.x - this.view.steer) * Math.min(1, dt * 8);
    const b = g.body;
    b.x = v.x;
    b.z = v.z;
    b.y = d.seatY;
    b.vy = 0;
    b.onGround = true;
    b.crouch = false;
    g.vel.set(0, 0);
    g.sprinting = false;
    audio.setEngine?.(Math.abs(v.speed) / d.top, Math.abs(mv.y));
    this.hud();
  }

  // Sent with every state message so the server can move the vehicle.
  stateMsg() {
    const v = this.v;
    return [+v.x.toFixed(2), +v.z.toFixed(2), +v.yaw.toFixed(3), +v.speed.toFixed(2)];
  }

  hud() {
    const me = this.g.me;
    const kmh = Math.round(Math.abs(this.v.speed) * 3.6);
    const hp = me?.vhp ?? 100;
    const key = `${kmh}|${hp}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    $('veh-speed').textContent = `${kmh} km/h`;
    $('veh-hp').style.width = `${hp}%`;
    $('veh-hp').classList.toggle('low', hp < 30);
  }
}
