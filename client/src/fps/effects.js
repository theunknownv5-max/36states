// World effects: tracers, bullet holes, dust and sparks, blood, explosions with
// debris and scorch marks, smoke screens, grenades and rockets in flight,
// artillery target zones and muzzle light.
import * as THREE from 'three';
import * as T from '../core/textures.js';

const DUST = { sand: '#d8c08e', dirt: '#8a6a48', gravel: '#9a9a90', mud: '#5a4a30', concrete: '#b8b4ac', wood: '#9a7650', metal: '#ffd27a', water: '#cfe6ee', flesh: '#7a0a0a' };

class SpritePool {
  constructor(scene, size, mat) {
    this.items = [];
    this.i = 0;
    for (let k = 0; k < size; k++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0, max: 1, v: new THREE.Vector3(), g: 0, grow: 0, fade: 1, base: 1, drag: 0 });
    }
  }
  spawn(pos, { colour = '#fff', size = 0.3, life = 0.5, v = null, g = 0, grow = 0, opacity = 1, drag = 0, rot = Math.random() * 6 }) {
    const p = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    p.s.visible = true;
    p.s.position.copy(pos);
    p.s.material.color.set(colour);
    p.s.material.opacity = opacity;
    p.s.material.rotation = rot;
    p.s.scale.setScalar(size);
    p.base = size;
    p.life = p.max = life;
    p.v.copy(v || new THREE.Vector3());
    p.g = g;
    p.grow = grow;
    p.fade = opacity;
    p.drag = drag;
    return p;
  }
  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.v.y -= p.g * dt;
      if (p.drag) p.v.multiplyScalar(Math.pow(1 - p.drag, dt * 60));
      p.s.position.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      p.s.material.opacity = p.fade * Math.min(1, k * 2);
      if (p.grow) p.s.scale.setScalar(p.base * (1 + (1 - k) * p.grow));
    }
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.shake = 0;
    // Tracers.
    const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tracerGeo, this.tracerMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ m, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 0 });
    }
    this.ti = 0;
    // Particles.
    this.sparks = new SpritePool(scene, 120, new THREE.SpriteMaterial({ map: T.softDot(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.dust = new SpritePool(scene, 140, new THREE.SpriteMaterial({ map: T.smokePuff(), depthWrite: false, transparent: true }));
    this.fire = new SpritePool(scene, 50, new THREE.SpriteMaterial({ map: T.flashStar(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.blood = new SpritePool(scene, 40, new THREE.SpriteMaterial({ map: T.bloodTex(), depthWrite: false, transparent: true }));
    // Decals.
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.holeMat = new THREE.MeshBasicMaterial({ map: T.bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.scorchMat = new THREE.MeshBasicMaterial({ map: T.scorchTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.bloodMat = new THREE.MeshBasicMaterial({ map: T.bloodTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.85 });
    this.decals = [];
    // Debris chunks.
    this.debrisGeo = new THREE.BoxGeometry(0.12, 0.08, 0.1);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1 });
    this.debris = [];
    // Lights for muzzle flashes and blasts.
    this.muzzleLight = new THREE.PointLight('#ffb35a', 0, 12, 2);
    this.blastLight = new THREE.PointLight('#ff9a40', 0, 40, 1.8);
    scene.add(this.muzzleLight, this.blastLight);
    // Smoke screens.
    this.smokes = [];
    // Projectiles in flight.
    this.proj = [];
    this.grenadeGeo = new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1.3, 1);
    this.grenadeMat = { frag: new THREE.MeshStandardMaterial({ color: '#3d4a2a', roughness: 0.6 }), smoke: new THREE.MeshStandardMaterial({ color: '#7a7a7a', roughness: 0.5 }), flash: new THREE.MeshStandardMaterial({ color: '#2c3b56', roughness: 0.5 }) };
    this.rocketGeo = new THREE.ConeGeometry(0.06, 0.6, 10).rotateX(-Math.PI / 2);
    this.rocketMat = new THREE.MeshStandardMaterial({ color: '#4d5a2f', emissive: '#ff6a00', emissiveIntensity: 0.3 });
    // Artillery zones.
    this.zones = [];
    this.fires = [];
    this.ringTex = T.ringTex();
  }

  tracer(from, to, colour = '#ffd28a') {
    const t = this.tracers[this.ti];
    this.ti = (this.ti + 1) % this.tracers.length;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.len = t.dir.length();
    if (t.len < 2) return;
    t.dir.normalize();
    t.t = 0;
    t.m.material.color.set(colour);
    t.m.visible = true;
  }

  muzzle(pos, strength = 1) {
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 25 * strength;
  }

  addDecal(mat, pos, normal, size, life = 40) {
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.copy(pos).addScaledVector(normal, 0.01);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    this.scene.add(m);
    this.decals.push({ m, life });
    if (this.decals.length > 160) this.scene.remove(this.decals.shift().m);
  }

  impact(pos, normal, surface) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    const col = DUST[surface] || DUST.dirt;
    if (surface !== 'water') this.addDecal(this.holeMat, pos, n, surface === 'metal' ? 0.07 : 0.1);
    for (let i = 0; i < 3; i++) {
      const v = n.clone().multiplyScalar(1 + Math.random() * 1.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2));
      this.dust.spawn(pos, { colour: col, size: 0.25 + Math.random() * 0.2, life: 0.7 + Math.random() * 0.5, v, g: surface === 'water' ? 6 : 0.4, grow: 2.5, opacity: 0.55, drag: 0.04 });
    }
    if (surface === 'metal' || surface === 'concrete' || surface === 'gravel') {
      for (let i = 0; i < 5; i++) {
        const v = n.clone().multiplyScalar(3).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
        this.sparks.spawn(pos, { colour: '#ffcf7a', size: 0.05, life: 0.25 + Math.random() * 0.2, v, g: 12 });
      }
    }
  }

  bloodHit(pos, dir) {
    for (let i = 0; i < 4; i++) {
      const v = (dir ? dir.clone().multiplyScalar(1.5) : new THREE.Vector3()).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
      this.blood.spawn(pos, { colour: '#8a0a0a', size: 0.18 + Math.random() * 0.2, life: 0.45, v, g: 6, grow: 1.5, opacity: 0.9 });
    }
    if (Math.random() < 0.5) this.addDecal(this.bloodMat, new THREE.Vector3(pos.x + (Math.random() - 0.5), 0.02, pos.z + (Math.random() - 0.5)), new THREE.Vector3(0, 1, 0), 0.6 + Math.random() * 0.5, 25);
  }

  explosion(pos, radius = 7, kind = 'frag') {
    const big = kind === 'artillery' || kind === 'rpg';
    this.blastLight.position.copy(pos).setY(pos.y + 1.5);
    this.blastLight.intensity = big ? 900 : 500;
    for (let i = 0; i < (big ? 10 : 6); i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 6 + 1, (Math.random() - 0.5) * 6);
      this.fire.spawn(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), { colour: '#ffb04a', size: radius * 0.45 + Math.random(), life: 0.35 + Math.random() * 0.25, v, grow: 1.2, opacity: 1 });
    }
    for (let i = 0; i < (big ? 16 : 10); i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 5 + 1, (Math.random() - 0.5) * 8);
      this.dust.spawn(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), { colour: i % 3 ? '#3a342e' : '#8a7a62', size: radius * 0.35 + Math.random() * 1.5, life: 3 + Math.random() * 3, v, g: -0.3, grow: 2.2, opacity: 0.8, drag: 0.05 });
    }
    for (let i = 0; i < 20; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 14, (Math.random() - 0.5) * 22);
      this.sparks.spawn(pos, { colour: '#ffcf7a', size: 0.08, life: 0.5 + Math.random() * 0.5, v, g: 14 });
    }
    // Chunks of earth and rubble.
    for (let i = 0; i < (big ? 14 : 8); i++) {
      const m = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      m.position.copy(pos).setY(pos.y + 0.3);
      m.castShadow = true;
      this.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 12, 4 + Math.random() * 8, (Math.random() - 0.5) * 12), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), life: 2.5 });
    }
    this.addDecal(this.scorchMat, new THREE.Vector3(pos.x, 0.02, pos.z), new THREE.Vector3(0, 1, 0), radius * 0.8, 90);
  }

  // A burst fuel drum keeps burning for a while: flames, embers, smoke and flickering light.
  burningWreck(x, z, secs) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const flames = [];
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.set((Math.random() - 0.5) * 1.4, 0.6, (Math.random() - 0.5) * 1.4);
      sp.userData.ph = Math.random() * 10;
      g.add(sp);
      flames.push(sp);
    }
    const light = new THREE.PointLight('#ff7a2a', 40, 14, 1.8);
    light.position.y = 1.2;
    g.add(light);
    this.scene.add(g);
    this.addDecal(this.scorchMat, new THREE.Vector3(x, 0.02, z), new THREE.Vector3(0, 1, 0), 4.5, 120);
    this.fires.push({ g, flames, light, life: secs, max: secs });
  }

  flashbang(pos) {
    this.blastLight.position.copy(pos);
    this.blastLight.intensity = 1500;
    this.blastLight.color.set('#ffffff');
    setTimeout(() => this.blastLight.color.set('#ff9a40'), 120);
    for (let i = 0; i < 12; i++) this.sparks.spawn(pos, { colour: '#ffffff', size: 0.6, life: 0.2, v: new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10) });
  }

  // A thick smoke screen built from many large puffs.
  smoke(x, z, r, dur) {
    const puffs = [];
    const mat = new THREE.SpriteMaterial({ map: T.smokePuff(), color: '#c9c6c0', transparent: true, depthWrite: false, opacity: 0 });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(mat.clone());
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.85;
      s.position.set(x + Math.cos(a) * d, 0.8 + Math.random() * 2.6, z + Math.sin(a) * d);
      s.userData.size = 3.5 + Math.random() * 3;
      s.material.rotation = Math.random() * 6;
      s.scale.setScalar(0.5);
      this.scene.add(s);
      puffs.push(s);
    }
    this.smokes.push({ x, z, puffs, t: 0, dur });
  }

  // Snapshot list of live smoke clouds [[x,z,r]]: create any we missed (late joiners).
  syncSmokes(list) {
    for (const [x, z, r] of list) {
      if (!this.smokes.some((s) => Math.hypot(s.x - x, s.z - z) < 0.5)) {
        this.smoke(x, z, r, 10);
        this.smokes[this.smokes.length - 1].t = 2;
      }
    }
  }

  projectiles(list) {
    while (this.proj.length > list.length) this.scene.remove(this.proj.pop().m);
    list.forEach(([kind, x, y, z], i) => {
      let p = this.proj[i];
      if (!p || p.kind !== kind) {
        if (p) this.scene.remove(p.m);
        const m = kind === 'rocket' ? new THREE.Mesh(this.rocketGeo, this.rocketMat) : new THREE.Mesh(this.grenadeGeo, this.grenadeMat[kind] || this.grenadeMat.frag);
        m.castShadow = true;
        m.position.set(x, y, z);
        this.scene.add(m);
        p = this.proj[i] = { kind, m, target: new THREE.Vector3(x, y, z), prev: new THREE.Vector3(x, y, z), vel: new THREE.Vector3() };
      }
      p.prev.copy(p.target);
      p.target.set(x, y, z);
      p.vel.subVectors(p.target, p.prev).multiplyScalar(20);
    });
  }

  artillery(x, z, spread, seconds) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(spread * 2.4, spread * 2.4), new THREE.MeshBasicMaterial({ map: this.ringTex, color: '#ff3a2a', transparent: true, opacity: 0.8, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.08, z);
    this.scene.add(m);
    this.zones.push({ m, life: seconds });
  }

  incoming(x, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: this.ringTex, color: '#ffb02a', transparent: true, opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.1, z);
    this.scene.add(m);
    this.zones.push({ m, life: 1.4, shrink: true });
  }

  update(dt, camera) {
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.t += dt * 420;
      const seg = Math.min(4, t.len);
      const head = Math.min(t.len, t.t);
      const tail = Math.max(0, head - seg);
      if (tail >= t.len) {
        t.m.visible = false;
        continue;
      }
      t.m.position.copy(t.from).addScaledVector(t.dir, (head + tail) / 2);
      t.m.lookAt(t.m.position.clone().add(t.dir));
      t.m.scale.set(1, 1, Math.max(0.01, head - tail));
    }
    this.sparks.update(dt);
    this.dust.update(dt);
    this.fire.update(dt);
    this.blood.update(dt);
    this.muzzleLight.intensity *= Math.pow(0.00001, dt);
    this.blastLight.intensity *= Math.pow(0.001, dt);
    for (const d of this.debris) {
      d.life -= dt;
      d.v.y -= 18 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.05) {
        d.m.position.y = 0.05;
        d.v.set(d.v.x * 0.4, -d.v.y * 0.25, d.v.z * 0.4);
      }
      d.m.rotation.x += d.spin.x * dt;
      d.m.rotation.y += d.spin.y * dt;
      if (d.life <= 0) this.scene.remove(d.m);
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    for (const d of this.decals) d.life -= dt;
    while (this.decals.length && this.decals[0].life <= 0) this.scene.remove(this.decals.shift().m);
    for (const s of this.smokes) {
      s.t += dt;
      const fadeIn = Math.min(1, s.t / 1.5);
      const fadeOut = Math.min(1, (s.dur - s.t) / 3);
      for (const p of s.puffs) {
        p.material.opacity = 0.92 * Math.max(0, Math.min(fadeIn, fadeOut));
        p.scale.setScalar(p.userData.size * (0.4 + fadeIn * 0.6));
        p.material.rotation += dt * 0.05;
        p.position.y += dt * 0.05;
      }
      if (s.t >= s.dur) for (const p of s.puffs) this.scene.remove(p);
    }
    this.smokes = this.smokes.filter((s) => s.t < s.dur);
    for (const p of this.proj) {
      // Extrapolate between 20 Hz snapshots for smooth flight.
      p.m.position.lerp(p.target.clone().addScaledVector(p.vel, 0.03), Math.min(1, dt * 18));
      if (p.kind === 'rocket') {
        if (p.vel.lengthSq() > 1) p.m.lookAt(p.m.position.clone().add(p.vel));
        this.fire.spawn(p.m.position, { colour: '#ffb04a', size: 0.5, life: 0.08 });
        this.dust.spawn(p.m.position, { colour: '#8a8a8a', size: 0.4, life: 1.2, grow: 3, opacity: 0.5, v: new THREE.Vector3(0, 0.4, 0) });
      } else p.m.rotation.x += dt * 8;
    }
    for (const z of this.zones) {
      z.life -= dt;
      z.m.material.opacity = (0.5 + Math.sin(z.life * 12) * 0.3) * Math.min(1, z.life);
      z.m.rotation.z += dt;
      if (z.shrink) z.m.scale.setScalar(Math.max(0.2, z.life / 1.4));
      if (z.life <= 0) this.scene.remove(z.m);
    }
    this.zones = this.zones.filter((z) => z.life > 0);
    for (const f of this.fires) {
      f.life -= dt;
      const k = Math.min(1, f.life / 2); // die down over the last two seconds
      const t = performance.now() / 1000;
      f.flames.forEach((sp) => {
        const flick = 0.75 + Math.sin(t * 11 + sp.userData.ph) * 0.15 + Math.random() * 0.1;
        sp.scale.set(1.6 * flick * k, 2.6 * flick * k, 1);
        sp.position.y = 0.9 * k + Math.sin(t * 3 + sp.userData.ph) * 0.1;
      });
      f.light.intensity = (32 + Math.random() * 18) * k;
      if (Math.random() < dt * 8) this.dust.spawn(new THREE.Vector3(f.g.position.x, 1.6, f.g.position.z), { colour: '#2a2522', size: 1.2, life: 3, v: new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.6, (Math.random() - 0.5) * 0.5), grow: 3, opacity: 0.6 * k });
      if (Math.random() < dt * 10) this.sparks.spawn(new THREE.Vector3(f.g.position.x, 0.8, f.g.position.z), { colour: '#ffb04a', size: 0.05, life: 1, v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.5), g: -0.5 });
      if (f.life <= 0) this.scene.remove(f.g);
    }
    this.fires = this.fires.filter((f) => f.life > 0);
    this.shake *= Math.pow(0.02, dt);
  }
}
