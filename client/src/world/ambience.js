// Life around the battlefield: drifting clouds, smoke columns from fights on the
// horizon, flocks of birds (vultures over the Sahel), and helicopters or jets that
// fly over with their own sound.
import * as THREE from 'three';
import { mulberry32 } from '../../../shared/rng.js';
import { makeCanvas, toTexture, fbm, smokePuff } from '../core/textures.js';
import { audio } from '../core/audio.js';

function cloudTexture(seed, cover) {
  const size = 512;
  const n = fbm(size, 6, mulberry32(seed), 4);
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < n.length; i++) {
    const v = Math.max(0, Math.min(1, (n[i] - (1 - cover)) * 3.2));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = v * 235;
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function birdGeometry() {
  // A simple V of two wings; flapped in the vertex positions every frame.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.5, 0, -0.05, 0, 0, -0.12, 0, 0, 0.12, 0.5, 0, -0.05, 0, 0, -0.12], 3));
  return g;
}

function helicopter() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#3b4230', roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: '#111820', roughness: 0.1, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.2, 6, 12).rotateX(Math.PI / 2), dark);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), glass);
  nose.position.z = -2.4;
  nose.scale.set(0.95, 0.85, 0.8);
  g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 5, 8).rotateX(Math.PI / 2), dark);
  tail.position.set(0, 0.4, 4.2);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.8), dark);
  fin.position.set(0, 1, 6.5);
  g.add(fin);
  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6).rotateX(Math.PI / 2), dark);
    skid.position.set(s * 0.9, -1.3, -0.2);
    g.add(skid);
  }
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.04, 24), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.22, depthWrite: false }));
  rotor.position.y = 1.4;
  g.add(rotor);
  const tailRotor = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 12).rotateZ(Math.PI / 2), rotor.material);
  tailRotor.position.set(0.25, 1, 6.6);
  g.add(tailRotor);
  g.userData.rotor = rotor;
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return g;
}

function jet() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#6a7078', roughness: 0.4, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 11, 10).rotateX(-Math.PI / 2), mat);
  g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 2.6), mat);
  wing.position.z = 1;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 1.4), mat);
  tail.position.set(0, 1, 4.6);
  g.add(tail);
  return g;
}

export class Ambience {
  constructor(scene, map, arena) {
    this.scene = scene;
    this.map = map;
    this.arena = arena;
    this.group = new THREE.Group();
    scene.add(this.group);
    const rng = mulberry32(map.seed ^ 0xc10d);
    this.rng = rng;
    // Cloud layer, thicker in wet biomes, thin in the Sahel.
    const cover = { sahel: 0.32, desert: 0.2, savanna: 0.45, temperate: 0.6, snow: 0.7, plateau: 0.55, rainforest: 0.62, creeks: 0.6, urban: 0.5 }[map.lookId || map.biome] ?? 0.45;
    this.cloudTex = cloudTexture(map.seed, arena.raining ? 0.85 : cover);
    this.cloudTex.repeat.set(3, 3);
    const tint = arena.raining ? '#8a9098' : '#ffffff';
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, color: tint, fog: false, opacity: 0.85 }));
    clouds.rotation.x = Math.PI / 2;
    clouds.position.y = 220;
    clouds.renderOrder = -1;
    this.group.add(clouds);
    // Smoke columns from fighting far away.
    this.plumes = [];
    const puff = smokePuff();
    for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
      const a = rng() * Math.PI * 2;
      const r = 260 + rng() * 260;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const parts = [];
      for (let k = 0; k < 14; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: k < 2 ? '#3a2a20' : '#4a4440', transparent: true, depthWrite: false, opacity: 0.55 }));
        sp.userData = { k, ph: rng() * 10 };
        this.group.add(sp);
        parts.push(sp);
      }
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#ff7a2a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
      fire.position.set(x, 4, z);
      fire.scale.setScalar(18);
      this.group.add(fire);
      this.plumes.push({ x, z, parts, fire, lean: (rng() - 0.5) * 0.4 });
    }
    // Birds circling (vultures in the north, smaller birds elsewhere).
    this.flocks = [];
    const big = map.biome === 'sahel' || map.biome === 'savanna';
    const birdMat = new THREE.MeshBasicMaterial({ color: '#1a1614', side: THREE.DoubleSide, fog: true });
    for (let f = 0; f < 2; f++) {
      const birds = [];
      const n = big ? 5 : 9;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(birdGeometry(), birdMat);
        m.scale.setScalar(big ? 2.2 : 0.9);
        this.group.add(m);
        birds.push({ m, off: rng() * Math.PI * 2, r: 6 + rng() * 14, h: rng() * 6, sp: 0.8 + rng() * 0.4 });
      }
      this.flocks.push({ cx: (rng() - 0.5) * 160, cz: (rng() - 0.5) * 160, y: big ? 55 + rng() * 25 : 30 + rng() * 15, birds, speed: big ? 0.12 : 0.35 });
    }
    // A low flock of white egrets (cattle egrets) where it is green.
    if (map.biome !== 'sahel' && map.biome !== 'urban') {
      const white = new THREE.MeshBasicMaterial({ color: '#f2efe6', side: THREE.DoubleSide, fog: true });
      const birds = [];
      for (let i = 0; i < 11; i++) {
        const m = new THREE.Mesh(birdGeometry(), white);
        m.scale.setScalar(0.8);
        this.group.add(m);
        birds.push({ m, off: rng() * Math.PI * 2, r: 4 + rng() * 8, h: rng() * 3, sp: 0.9 + rng() * 0.3 });
      }
      this.flocks.push({ cx: (rng() - 0.5) * 120, cz: (rng() - 0.5) * 120, y: 14 + rng() * 6, birds, speed: 0.45 });
    }
    // Aircraft passes.
    this.nextFlyover = 25 + rng() * 40;
    this.craft = null;
  }

  flyover() {
    const heli = this.rng() < 0.6;
    const obj = heli ? helicopter() : jet();
    const a = this.rng() * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 420, heli ? 38 + this.rng() * 15 : 110, Math.sin(a) * 420);
    const to = new THREE.Vector3(-from.x + (this.rng() - 0.5) * 150, from.y, -from.z + (this.rng() - 0.5) * 150);
    obj.position.copy(from);
    obj.lookAt(to);
    obj.rotateY(Math.PI);
    this.scene.add(obj);
    const speed = heli ? 38 : 160;
    this.craft = { obj, from, to, t: 0, dur: from.distanceTo(to) / speed, heli };
    audio.flyover(heli, this.craft.dur);
  }

  // Gunfire or a blast nearby: flocks within range take off.
  scare(x, z) {
    for (const f of this.flocks) if (Math.hypot(f.cx - x, f.cz - z) < 90) f.alarm = 4;
  }

  update(dt, t, camera) {
    this.cloudTex.offset.x += dt * 0.0016;
    this.cloudTex.offset.y += dt * 0.0007;
    for (const p of this.plumes) {
      for (const sp of p.parts) {
        const k = (sp.userData.k + ((t * 0.08 + sp.userData.ph) % 1)) / 14;
        const h = k * 120;
        sp.position.set(p.x + h * p.lean + Math.sin(t * 0.3 + sp.userData.ph) * 3, 6 + h, p.z + h * p.lean * 0.5);
        sp.scale.setScalar(12 + k * 70);
        sp.material.opacity = 0.55 * (1 - k * 0.8);
        sp.material.rotation = sp.userData.ph + t * 0.05;
      }
      p.fire.material.opacity = 0.45 + Math.sin(t * 7 + p.x) * 0.15;
    }
    for (const f of this.flocks) {
      f.cx += Math.sin(t * 0.05 + f.y) * dt * 2;
      // Startled by gunfire: climb and wheel away fast, then settle back down.
      f.alarm = Math.max(0, (f.alarm || 0) - dt);
      f.lift = (f.lift || 0) + ((f.alarm > 0 ? 18 : 0) - (f.lift || 0)) * Math.min(1, dt * (f.alarm > 0 ? 1.5 : 0.2));
      if (f.alarm > 0) f.cx += dt * 6;
      for (const b of f.birds) {
        const a = t * f.speed * b.sp * (f.alarm > 0 ? 2.2 : 1) + b.off;
        const x = f.cx + Math.cos(a) * (b.r + 20);
        const z = f.cz + Math.sin(a) * (b.r + 20);
        b.m.position.set(x, f.y + (f.lift || 0) + b.h + Math.sin(t + b.off) * 1.5, z);
        b.m.rotation.y = -a;
        // Flap: move wing tips up and down.
        const flap = Math.sin(t * (f.alarm > 0 ? 22 : f.speed > 0.2 ? 14 : 4) + b.off) * 0.25;
        const pos = b.m.geometry.attributes.position;
        pos.setY(1, flap);
        pos.setY(4, flap);
        pos.needsUpdate = true;
      }
    }
    this.nextFlyover -= dt;
    if (!this.craft && this.nextFlyover <= 0) {
      this.flyover();
      this.nextFlyover = 60 + this.rng() * 70;
    }
    if (this.craft) {
      const c = this.craft;
      c.t += dt;
      const k = c.t / c.dur;
      c.obj.position.lerpVectors(c.from, c.to, k);
      if (c.heli) {
        c.obj.userData.rotor.rotation.y += dt * 40;
        c.obj.position.y += Math.sin(c.t * 1.5) * 0.3;
      }
      audio.moveFlyover(c.obj.position);
      if (k >= 1) {
        this.scene.remove(c.obj);
        this.craft = null;
      }
    }
  }

  dispose() {
    if (this.craft) this.scene.remove(this.craft.obj);
    this.scene.remove(this.group);
    audio.stopLoop('flyover', 0.5);
  }
}
