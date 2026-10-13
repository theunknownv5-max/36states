// Vehicles on the battlefield (client side): the parked and driven ones, engine fire, burning
// wrecks that cool into charred shells, C4 charges (stuck on walls or vehicles, blinking),
// and the ambulance that drives in with its siren when someone pays for one.
import * as THREE from 'three';
import { VEHICLES, WRECK, footprint, forward } from '../../../shared/vehicles.js';
import { moveBox } from '../../../shared/physics.js';
import { NET } from '../../../shared/config.js';
import { buildVehicle, charVehicle, charMaterial } from './vehicle-models.js';
import * as T from '../core/textures.js';

const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export class Vehicles {
  constructor(scene, map, fx) {
    this.scene = scene;
    this.map = map;
    this.fx = fx;
    this.list = map.vehicles.map((d) => {
      const g = buildVehicle(d.type, d.colour);
      scene.add(g);
      const b = map.boxes[d.box];
      const v = { i: d.i, type: d.type, def: VEHICLES[d.type], g, x: d.x, z: d.z, yaw: d.yaw, speed: 0, state: 0, driver: null, box: d.box, buf: [], orig: { x: d.x, z: d.z, yaw: d.yaw, y1: b.y1 }, steer: 0, ember: 0 };
      this.pose(v, d.x, d.z, d.yaw);
      return v;
    });
  }

  // Put a vehicle somewhere (and its collision box, so we bump into it where it really is).
  pose(v, x, z, yaw) {
    v.x = x;
    v.z = z;
    v.yaw = yaw;
    v.g.position.x = x;
    v.g.position.z = z;
    v.g.rotation.y = yaw;
    const fp = footprint(v.type, x, z, yaw);
    moveBox(this.map.index, v.box, fp.x0, fp.z0, fp.x1, fp.z1);
  }

  // Joining mid-battle: where everything is and what state it is in.
  apply(view) {
    for (const [i, x, z, yaw, s, driver] of view?.v || []) {
      const v = this.list[i];
      if (!v) continue;
      this.pose(v, x, z, yaw);
      v.driver = driver || null;
      if (s) this.setState(i, s, { instant: true });
    }
  }

  onSnapshot(vh, ts, mine) {
    for (const [i, x, z, yaw, speed] of vh || []) {
      const v = this.list[i];
      if (!v || i === mine) continue;
      v.buf.push({ t: ts, x, z, yaw, speed });
      if (v.buf.length > 20) v.buf.shift();
      v.seen = ts;
    }
  }

  seat(i, id) {
    const v = this.list[i];
    if (!v) return;
    v.driver = id;
    v.buf.length = 0;
  }

  byDriver(id) {
    return this.list.find((v) => v.driver === id) || null;
  }

  // The closest vehicle you could climb into from here.
  nearest(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const v of this.list) {
      if (v.state >= 2 || v.driver) continue;
      const d = Math.hypot(v.x - x, v.z - z) - v.def.L / 2;
      if (d < 2.2 && d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  setState(i, s, { instant = false, burnSecs = WRECK.burnSecs } = {}) {
    const v = this.list[i];
    if (!v || v.state === s) return;
    v.state = s;
    if (s >= 2 && !v.g.userData.charred) {
      v.char = charVehicle(v.g, charMaterial());
      v.g.position.y = -0.2;
      v.g.rotation.x = (Math.random() - 0.5) * 0.05;
      v.g.rotation.z = (Math.random() - 0.5) * 0.07;
      v.ember = instant || s === 3 ? 0.05 : 1;
      const b = this.map.boxes[v.box];
      b.y1 = Math.min(b.y1, v.def.H * 0.72);
      if (s === 2 && !instant) {
        this.fx.burningWreck(v.x, v.z, burnSecs);
        const [fx, fz] = forward(v.yaw);
        if (v.def.L > 3) this.fx.burningWreck(v.x + fx * v.def.L * 0.3, v.z + fz * v.def.L * 0.3, burnSecs * 0.8);
      }
      v.speed = 0;
      v.buf.length = 0;
    }
  }

  // New round: everything back where it was parked, good as new.
  reset() {
    for (const v of this.list) {
      this.scene.remove(v.g);
      const d = this.map.vehicles[v.i];
      v.g = buildVehicle(d.type, d.colour);
      this.scene.add(v.g);
      Object.assign(v, { state: 0, driver: null, speed: 0, buf: [], ember: 0, char: null });
      this.map.boxes[v.box].y1 = v.orig.y1;
      this.pose(v, v.orig.x, v.orig.z, v.orig.yaw);
    }
  }

  update(dt, sNow, t, mine) {
    const rt = sNow - NET.interpDelayMs;
    for (const v of this.list) {
      if (v.i !== mine && v.buf.length && v.state < 2) {
        const buf = v.buf;
        let a = buf[0];
        let b = buf[buf.length - 1];
        for (let k = buf.length - 1; k > 0; k--) {
          if (buf[k - 1].t <= rt) {
            a = buf[k - 1];
            b = buf[k];
            break;
          }
        }
        const k = b.t === a.t ? 1 : Math.max(0, Math.min(1.2, (rt - a.t) / (b.t - a.t)));
        const yaw = lerpAngle(a.yaw, b.yaw, k);
        const turn = lerpAngle(0, b.yaw - a.yaw, 1) / Math.max(0.05, (b.t - a.t) / 1000);
        this.pose(v, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, yaw);
        v.speed = a.speed + (b.speed - a.speed) * k;
        v.steer += (Math.max(-1, Math.min(1, (-turn / Math.max(1.5, Math.abs(v.speed))) * 3)) - v.steer) * Math.min(1, dt * 6);
        if (sNow - v.seen > 1000) v.speed = 0;
      }
      // Wheels roll and the front ones steer.
      if (Math.abs(v.speed) > 0.05 && v.state < 2)
        for (const w of v.g.userData.wheels) {
          w.spin.rotation.x -= (v.speed * dt) / w.r;
          if (w.steer) w.pivot.rotation.y = v.steer * 0.45;
        }
      const [fx, fz] = forward(v.yaw);
      // Engine on fire: flames and black smoke out of the bonnet. It is going to blow.
      if (v.state === 1) {
        const p = new THREE.Vector3(v.x + fx * (v.def.L / 2 - 0.8), v.def.H * 0.75, v.z + fz * (v.def.L / 2 - 0.8));
        if (Math.random() < dt * 30) this.fx.fire.spawn(p, { colour: Math.random() < 0.5 ? '#ff8a2a' : '#ffc04a', size: 0.5 + Math.random() * 0.5, life: 0.35, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2 + Math.random(), (Math.random() - 0.5) * 0.6) });
        if (Math.random() < dt * 12) this.fx.dust.spawn(p, { colour: '#1d1b1a', size: 0.9, life: 2.5, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.8, (Math.random() - 0.5) * 0.4), grow: 3, opacity: 0.75 });
      }
      // Burning and charred: embers glow then cool; smoke keeps rising for a while.
      if (v.char) {
        if (v.state === 2) v.ember = Math.max(0.55, v.ember - dt * 0.015);
        else v.ember = Math.max(0, v.ember - dt * 0.03);
        v.char.emissiveIntensity = v.ember * 0.6 * (0.75 + Math.sin(t * 7 + v.i) * 0.15 + Math.random() * 0.1);
        // Blazing: tongues of flame out of the cabin and bonnet, thick black smoke.
        if (v.state === 2) {
          const L = v.def.L;
          if (Math.random() < dt * 40) {
            const a = (Math.random() - 0.5) * L * 0.8;
            const p = new THREE.Vector3(v.x + fx * a + (Math.random() - 0.5) * 0.6, v.def.H * 0.6, v.z + fz * a + (Math.random() - 0.5) * 0.6);
            this.fx.fire.spawn(p, { colour: Math.random() < 0.5 ? '#ff7a1a' : '#ffb440', size: 0.8 + Math.random() * 0.9, life: 0.45, v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 2.6 + Math.random() * 1.5, (Math.random() - 0.5) * 0.5) });
          }
          if (Math.random() < dt * 10) this.fx.dust.spawn(new THREE.Vector3(v.x, v.def.H + 0.4, v.z), { colour: '#151312', size: 1.6, life: 5, v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 2.2, (Math.random() - 0.5) * 0.5), grow: 3.5, opacity: 0.75 });
        }
        if (v.state === 3 && v.ember > 0.02 && Math.random() < dt * 2) this.fx.dust.spawn(new THREE.Vector3(v.x, 1.2, v.z), { colour: '#4a4643', size: 0.8, life: 4, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3), grow: 4, opacity: 0.35 });
      }
    }
  }

  dispose() {
    for (const v of this.list) this.scene.remove(v.g);
  }
}

// ---------- C4 ----------
export class Charges {
  constructor(scene, vehicles) {
    this.scene = scene;
    this.vehicles = vehicles;
    this.items = new Map();
    this.geo = new THREE.BoxGeometry(0.24, 0.12, 0.17);
    this.mat = new THREE.MeshStandardMaterial({ color: '#5c5a3c', roughness: 0.85 });
    this.tape = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.7 });
    this.ledMat = new THREE.SpriteMaterial({ map: T.softDot(), color: '#ff2020', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }

  plant({ id, pos, veh, by }, myId) {
    if (this.items.has(id)) return;
    const g = new THREE.Group();
    const block = new THREE.Mesh(this.geo, this.mat);
    block.castShadow = true;
    g.add(block);
    for (const x of [-0.06, 0.06]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.125, 0.175), this.tape);
      t.position.x = x;
      g.add(t);
    }
    const led = new THREE.Sprite(this.ledMat.clone());
    led.scale.setScalar(0.12);
    led.position.set(0.07, 0.08, -0.05);
    g.add(led);
    const p = new THREE.Vector3(...pos);
    const v = veh != null ? this.vehicles.list[veh] : null;
    if (v && v.state < 2) {
      v.g.updateMatrixWorld();
      v.g.add(g);
      g.position.copy(v.g.worldToLocal(p));
    } else {
      g.position.copy(p);
      this.scene.add(g);
    }
    g.rotation.y = Math.random() * Math.PI;
    this.items.set(id, { g, led, mine: by === myId, t: Math.random() });
  }

  gone(id) {
    const c = this.items.get(id);
    if (!c) return;
    c.g.parent?.remove(c.g);
    this.items.delete(id);
  }

  mineCount() {
    let n = 0;
    for (const c of this.items.values()) if (c.mine) n++;
    return n;
  }

  update(dt) {
    for (const c of this.items.values()) {
      c.t += dt * (c.mine ? 2.2 : 1.1);
      c.led.material.opacity = c.t % 1 < 0.18 ? 1 : 0.08;
    }
  }

  clear() {
    for (const id of [...this.items.keys()]) this.gone(id);
  }
}

// ---------- ambulance ----------
export class Ambulances {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
  }

  add(m) {
    if (this.items.has(m.id)) return;
    const g = buildVehicle('ambulance');
    this.scene.add(g);
    const pts = m.path.map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (pts.length < 2) pts.unshift(pts[0].clone().add(new THREE.Vector3(0, 0, 30)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.items.set(m.id, { ...m, g, curve, parked: false });
  }

  // Where each ambulance is right now (for the siren).
  update(dt, sNow, t) {
    const out = [];
    for (const [id, a] of this.items) {
      let u;
      let back = false;
      if (sNow < a.at) u = Math.max(0, (sNow - a.start) / (a.at - a.start));
      else if (sNow < a.leave) u = 1;
      else {
        u = 1 - Math.min(1, (sNow - a.leave) / 6000);
        back = true;
      }
      if (back && u <= 0) {
        this.scene.remove(a.g);
        this.items.delete(id);
        continue;
      }
      // Ease into the stop and out of it.
      const e = u < 1 ? u * u * (3 - 2 * u) * 0.15 + u * 0.85 : 1;
      const p = a.curve.getPointAt(Math.min(1, e));
      const tan = a.curve.getTangentAt(Math.min(0.999, Math.max(0.001, e)));
      a.g.position.set(p.x, 0, p.z);
      const yaw = Math.atan2(-tan.x, -tan.z) + (back ? Math.PI : 0);
      a.g.rotation.y = yaw;
      const moving = u > 0 && u < 1;
      for (const w of a.g.userData.wheels) if (moving) w.spin.rotation.x -= dt * 14;
      const [r, b] = a.g.userData.beacons;
      const on = Math.floor(t * 6) % 2 === 0;
      r.emissiveIntensity = on ? 2.5 : 0.1;
      b.emissiveIntensity = on ? 0.1 : 2.5;
      out.push({ id, x: p.x, z: p.z, siren: u < 1 || !back });
    }
    return out;
  }

  clear() {
    for (const a of this.items.values()) this.scene.remove(a.g);
    this.items.clear();
  }
}
