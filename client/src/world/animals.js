// Animals: crocodiles in the big rivers (from the server, they bite) and stray dogs that roam
// the towns, bark at soldiers and bolt when guns go off (cosmetic, on each phone).
import * as THREE from 'three';
import { NET } from '../../../shared/config.js';
import { moveBody } from '../../../shared/physics.js';
import { inWater } from '../../../shared/map.js';
import { audio } from '../core/audio.js';

const lerpA = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

// ---------- crocodile ----------
function crocModel() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#3d4a2c', roughness: 0.8, metalness: 0.05 });
  const belly = new THREE.MeshStandardMaterial({ color: '#8f8a5c', roughness: 0.9 });
  const eye = new THREE.MeshStandardMaterial({ color: '#d8c13a', emissive: '#4a3a00', roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.6, 6, 12).rotateX(Math.PI / 2), skin);
  body.scale.set(1.15, 0.6, 1);
  g.add(body);
  const under = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.5, 4, 10).rotateX(Math.PI / 2), belly);
  under.scale.set(1.05, 0.45, 1);
  under.position.y = -0.08;
  g.add(under);
  // Ridged back.
  for (let k = 0; k < 9; k++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 4), skin);
    s.position.set(k % 2 ? 0.16 : -0.16, 0.25, -0.9 + k * 0.24);
    g.add(s);
  }
  const head = new THREE.Group();
  head.position.z = -1.3;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.5), skin);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.85), skin);
  snout.position.set(0, -0.04, -0.6);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.85), belly);
  jaw.position.set(0, -0.15, -0.6);
  head.add(skull, snout, jaw);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eye);
    e.position.set(s * 0.17, 0.17, -0.05);
    head.add(e);
  }
  g.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.1, 8).rotateX(Math.PI / 2), skin);
  tail.scale.set(1, 0.5, 1);
  tail.position.z = 1.9;
  g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.45, -0.7], [0.45, -0.7], [-0.45, 0.7], [0.45, 0.7]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.42), skin);
    l.position.set(x, -0.12, z);
    g.add(l);
    legs.push(l);
  }
  g.userData = { head, jaw, tail, legs };
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export class Crocs {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.items = new Map();
  }

  item(i) {
    if (!this.items.has(i)) {
      const g = crocModel();
      this.scene.add(g);
      this.items.set(i, { g, buf: [], state: 0, deadT: 0 });
    }
    return this.items.get(i);
  }

  apply(list, ts) {
    for (const [i, x, z, yaw, st] of list || []) {
      const c = this.item(i);
      c.buf.push({ t: ts, x, z, yaw });
      if (c.buf.length > 12) c.buf.shift();
      if (st === 2 && c.state !== 2) c.deadT = 0;
      if (st !== 2 && c.state === 2) c.g.visible = true;
      c.state = st;
    }
  }

  bite(i) {
    const c = this.items.get(i);
    if (!c) return;
    c.snap = 1;
    const p = c.g.position;
    for (let k = 0; k < 14; k++) this.fx.dust.spawn(new THREE.Vector3(p.x, 0.05, p.z), { colour: '#d9ecf2', size: 0.4, life: 0.8, v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3), g: 7, opacity: 0.8 });
    audio.croc?.({ x: p.x, y: 0, z: p.z });
  }

  update(dt, sNow, t) {
    const rt = sNow - NET.interpDelayMs;
    for (const c of this.items.values()) {
      const buf = c.buf;
      if (!buf.length) continue;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let k = buf.length - 1; k > 0; k--)
        if (buf[k - 1].t <= rt) {
          a = buf[k - 1];
          b = buf[k];
          break;
        }
      const k = b.t === a.t ? 1 : Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
      const g = c.g;
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const moving = Math.hypot(b.x - a.x, b.z - a.z) > 0.02;
      g.position.x = x;
      g.position.z = z;
      g.rotation.y = lerpA(a.yaw, b.yaw, k);
      const u = g.userData;
      if (c.state === 2) {
        // Dead: rolls belly-up, then sinks out of sight.
        c.deadT += dt;
        g.rotation.z = Math.min(Math.PI, c.deadT * 3);
        g.position.y = -0.15 - Math.max(0, c.deadT - 5) * 0.3;
        if (c.deadT > 9) g.visible = false;
        continue;
      }
      g.rotation.z = 0;
      // Lurking: only the eyes and the ridge of the back show. Chasing: higher, with a wake.
      const want = c.state === 1 ? -0.14 : -0.3;
      g.position.y += (want - g.position.y) * Math.min(1, dt * 3);
      u.tail.rotation.y = Math.sin(t * (moving ? 7 : 1.5)) * (moving ? 0.4 : 0.12);
      for (const [n, l] of u.legs.entries()) l.rotation.x = moving ? Math.sin(t * 8 + n * 1.6) * 0.5 : 0;
      c.snap = Math.max(0, (c.snap || 0) - dt * 3);
      u.jaw.rotation.x = c.snap * 0.6;
      if (c.state === 1 && moving && Math.random() < dt * 20) this.fx.dust.spawn(new THREE.Vector3(x, 0.02, z), { colour: '#e2f0f4', size: 0.5, life: 0.9, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8), grow: 2, opacity: 0.5 });
    }
  }

  dispose() {
    for (const c of this.items.values()) this.scene.remove(c.g);
    this.items.clear();
  }
}

// ---------- stray dogs ----------
const COATS = ['#b5824a', '#3a2c22', '#d9c49a', '#7a5a3a', '#1f1c1a'];
function dogModel(coat) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#18120e', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.48, 4, 8).rotateX(Math.PI / 2), fur);
  body.position.y = 0.48;
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.62, -0.42);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.2), fur);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.14), fur);
  muzzle.position.set(0, -0.03, -0.15);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), dark);
  nose.position.set(0, -0.01, -0.23);
  head.add(skull, muzzle, nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), fur);
    ear.position.set(s * 0.06, 0.11, 0.02);
    head.add(ear);
  }
  g.add(head);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 5), fur);
  tail.position.set(0, 0.6, 0.38);
  tail.rotation.x = 0.8;
  g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.08, -0.22], [0.08, -0.22], [-0.08, 0.22], [0.08, 0.22]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.42, 5), fur);
    l.geometry.translate(0, -0.21, 0);
    l.position.set(x, 0.42, z);
    g.add(l);
    legs.push(l);
  }
  g.userData = { head, tail, legs };
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export class Dogs {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.dogs = [];
    const homes = map.buildings.filter((b) => !b.solid);
    const n = Math.min(6, Math.max(2, Math.round(homes.length / 3)));
    for (let k = 0; k < n && homes.length; k++) {
      const h = homes[Math.floor(Math.random() * homes.length)];
      const x = h.x + (h.w / 2 + 2) * (Math.random() < 0.5 ? -1 : 1);
      const z = h.z + (Math.random() - 0.5) * h.d;
      const g = dogModel(COATS[k % COATS.length]);
      g.position.set(x, 0, z);
      scene.add(g);
      this.dogs.push({ g, body: { x, y: 0, z, vy: 0, onGround: true, crouch: false }, home: { x, z }, goal: null, speed: 0, fleeUntil: 0, barkAt: 0, phase: Math.random() * 6 });
    }
  }

  // Gunshots and blasts send them running.
  scare(x, z, r = 30) {
    const t = performance.now();
    for (const d of this.dogs)
      if (Math.hypot(d.body.x - x, d.body.z - z) < r) {
        d.fleeUntil = t + 4000;
        d.goal = { x: d.body.x + (d.body.x - x) * 2, z: d.body.z + (d.body.z - z) * 2 };
      }
  }

  update(dt, t, me) {
    const now = performance.now();
    for (const d of this.dogs) {
      const b = d.body;
      const fleeing = now < d.fleeUntil;
      const dMe = me ? Math.hypot(me.x - b.x, me.z - b.z) : 99;
      if (!fleeing && dMe < 7 && now - d.barkAt > 2500 + Math.random() * 2000) {
        d.barkAt = now;
        audio.bark?.({ x: b.x, y: 0.6, z: b.z });
        if (dMe < 3.5) {
          d.fleeUntil = now + 1500;
          d.goal = { x: b.x + (b.x - me.x) * 3, z: b.z + (b.z - me.z) * 3 };
        }
      }
      if (!d.goal || Math.hypot(d.goal.x - b.x, d.goal.z - b.z) < 0.4 || (!fleeing && Math.random() < dt * 0.15)) {
        if (!fleeing) d.goal = Math.random() < 0.4 ? null : { x: d.home.x + (Math.random() - 0.5) * 20, z: d.home.z + (Math.random() - 0.5) * 20 };
      }
      let wx = 0;
      let wz = 0;
      if (d.goal) {
        const dx = d.goal.x - b.x;
        const dz = d.goal.z - b.z;
        const len = Math.hypot(dx, dz) || 1;
        const sp = fleeing ? 7 : 1.6;
        wx = (dx / len) * sp;
        wz = (dz / len) * sp;
        d.g.rotation.y = lerpA(d.g.rotation.y, Math.atan2(-dx, -dz), Math.min(1, dt * 8));
      }
      if (inWater(this.map, b.x + wx * 0.3, b.z + wz * 0.3)) {
        wx = -wx;
        wz = -wz;
        d.goal = null;
      }
      const ox = b.x;
      const oz = b.z;
      moveBody(b, wx, wz, dt, this.map.index, this.map.half - 3, false);
      const moved = Math.hypot(b.x - ox, b.z - oz) / Math.max(dt, 1e-3);
      d.speed += (moved - d.speed) * Math.min(1, dt * 6);
      d.g.position.set(b.x, b.y, b.z);
      const u = d.g.userData;
      d.phase += dt * (2 + d.speed * 3.2);
      const swing = Math.min(0.8, d.speed * 0.18);
      u.legs.forEach((l, n) => (l.rotation.x = Math.sin(d.phase + (n % 2 === 0 ? 0 : Math.PI) + (n > 1 ? Math.PI / 2 : 0)) * swing));
      u.tail.rotation.z = Math.sin(t * (fleeing ? 4 : 10)) * 0.4;
      u.head.rotation.x = d.speed < 0.2 ? Math.sin(t * 0.7 + d.phase) * 0.15 + 0.2 : 0;
    }
  }

  dispose() {
    for (const d of this.dogs) this.scene.remove(d.g);
  }
}
