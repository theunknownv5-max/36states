// Jointed third-person soldiers in faction uniforms: walk, sprint, crouch, aim,
// reload, get downed, fall dead, or drift as a spirit. Driven by interpolated
// server snapshots (see game.js).
import * as THREE from 'three';
import { FACTIONS } from '../../../shared/config.js';
import { thirdPersonGun } from '../fps/guns.js';
import { makeCanvas, toTexture, flameTex, fabricTexture } from '../core/textures.js';
import { mulberry32 } from '../../../shared/rng.js';

const SKIN = ['#4a2c1d', '#5b3523', '#3d2418', '#6b4128', '#54301f', '#2f1c12'];

const matCache = new Map();
function camoTexture(base) {
  const [c, ctx] = makeCanvas(128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  const rng = mulberry32(5);
  const cols = ['#3a4226', '#6b6a44', '#2b2a1d', '#5a4a30'];
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath();
    const x = rng() * 128;
    const y = rng() * 128;
    ctx.ellipse(x, y, 6 + rng() * 14, 3 + rng() * 8, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toTexture(c);
  return t;
}
// Uniform cloth: woven fabric detail (or camouflage) tinted by the faction colour.
function cloth(colour, camo = false) {
  const key = colour + camo;
  if (!matCache.has(key)) {
    const fab = fabricTexture();
    const m = new THREE.MeshStandardMaterial({ color: camo ? '#ffffff' : colour, map: camo ? camoTexture(colour) : fab.map, normalMap: fab.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.93 });
    matCache.set(key, m);
  }
  return matCache.get(key);
}
function skin(i) {
  const key = 'skin' + i;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: SKIN[i % SKIN.length], roughness: 0.6 }));
  return matCache.get(key);
}
const bootMat = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.55, metalness: 0.05 });
const strapMat = new THREE.MeshStandardMaterial({ color: '#1c1b17', roughness: 0.8 });
const ghostMat = new THREE.MeshStandardMaterial({ color: '#8fe8ff', emissive: '#3fc8ff', emissiveIntensity: 0.8, transparent: true, opacity: 0.35, depthWrite: false });

// Shared geometries.
const G = {
  thigh: new THREE.CapsuleGeometry(0.088, 0.32, 6, 12).translate(0, -0.22, 0),
  shin: new THREE.CapsuleGeometry(0.07, 0.34, 6, 12).translate(0, -0.22, 0),
  boot: new THREE.CapsuleGeometry(0.065, 0.16, 4, 10).rotateX(Math.PI / 2).scale(1, 0.85, 1).translate(0, -0.47, -0.05),
  pelvis: new THREE.CapsuleGeometry(0.13, 0.12, 6, 12).rotateZ(Math.PI / 2).scale(1, 0.9, 0.85),
  torso: new THREE.CapsuleGeometry(0.17, 0.26, 8, 14).scale(1.12, 1, 0.72).translate(0, 0.27, 0),
  vest: new THREE.BoxGeometry(0.42, 0.36, 0.3).translate(0, 0.28, 0),
  pouch: new THREE.BoxGeometry(0.08, 0.1, 0.05),
  belt: new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).scale(1.1, 1, 0.8),
  pack: new THREE.BoxGeometry(0.3, 0.36, 0.14),
  knee: new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.1, 0.6),
  upperArm: new THREE.CapsuleGeometry(0.06, 0.24, 6, 10).translate(0, -0.15, 0),
  foreArm: new THREE.CapsuleGeometry(0.052, 0.24, 6, 10).translate(0, -0.15, 0),
  hand: new THREE.SphereGeometry(0.05, 10, 8).scale(1, 1.2, 0.9),
  neck: new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8),
  head: new THREE.SphereGeometry(0.115, 18, 14).scale(0.9, 1.1, 1),
  nose: new THREE.SphereGeometry(0.022, 6, 5).scale(1, 1.2, 1),
  ear: new THREE.SphereGeometry(0.025, 6, 5).scale(0.5, 1, 1),
  helmet: new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  capTop: new THREE.CylinderGeometry(0.125, 0.12, 0.08, 14),
  brim: new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14, 1, false, -Math.PI / 2 - 0.9, 1.8),
  beret: new THREE.SphereGeometry(0.13, 12, 6).scale(1.05, 0.38, 1.05),
  fez: new THREE.CylinderGeometry(0.1, 0.12, 0.13, 12),
  wrap: new THREE.TorusGeometry(0.1, 0.05, 6, 14),
  mask: new THREE.CylinderGeometry(0.12, 0.118, 0.11, 14, 1, true, Math.PI / 2 + 0.2, Math.PI - 0.4)
};

export class Soldier {
  constructor(scene, info, isMate) {
    this.scene = scene;
    this.id = info.id;
    this.info = info;
    this.isMate = isMate;
    const f = FACTIONS[info.faction] || FACTIONS.police;
    const u = f.uniform;
    const seed = [...info.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const top = cloth(u.top, !!u.camo);
    const bottom = cloth(u.bottom, !!u.camo);
    const sk = skin(seed);
    const root = new THREE.Group();
    this.root = root;
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    root.add(hips);
    this.hips = hips;
    const pelvis = new THREE.Mesh(G.pelvis, bottom);
    hips.add(pelvis);
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, -0.05, 0);
      hip.add(new THREE.Mesh(G.thigh, bottom));
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      knee.add(new THREE.Mesh(G.shin, bottom));
      knee.add(new THREE.Mesh(G.boot, bootMat));
      if (u.vest) {
        const pad = new THREE.Mesh(G.knee, strapMat);
        pad.position.set(0, -0.02, -0.06);
        knee.add(pad);
      }
      hip.add(knee);
      hips.add(hip);
      this.legs.push({ hip, knee });
    }
    const spine = new THREE.Group();
    spine.position.y = 0.06;
    hips.add(spine);
    this.spine = spine;
    spine.add(new THREE.Mesh(G.torso, top));
    const belt = new THREE.Mesh(G.belt, strapMat);
    belt.position.y = 0.02;
    spine.add(belt);
    if (['army', 'civildefence', 'militant', 'smuggler'].includes(info.faction)) {
      const pack = new THREE.Mesh(G.pack, cloth(u.vest || u.bottom));
      pack.position.set(0, 0.3, 0.2);
      spine.add(pack);
    }
    if (u.vest) {
      spine.add(new THREE.Mesh(G.vest, cloth(u.vest)));
      for (const x of [-0.12, 0, 0.12]) {
        const p = new THREE.Mesh(G.pouch, cloth(u.vest));
        p.position.set(x, 0.18, -0.16);
        spine.add(p);
      }
    }
    const neck = new THREE.Mesh(G.neck, sk);
    neck.position.y = 0.55;
    spine.add(neck);
    const head = new THREE.Group();
    head.position.y = 0.68;
    spine.add(head);
    this.head = head;
    head.add(new THREE.Mesh(G.head, sk));
    const nose = new THREE.Mesh(G.nose, sk);
    nose.position.set(0, -0.01, -0.11);
    head.add(nose);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(G.ear, sk);
      ear.position.set(sx * 0.103, 0, 0);
      head.add(ear);
    }
    this.addHeadgear(info.faction, u, head);
    // Arms hold the gun at the shoulder; the whole rig pitches with aim.
    const arms = new THREE.Group();
    arms.position.set(0, 0.46, 0);
    spine.add(arms);
    this.arms = arms;
    const armL = this.arm(top, sk, -1);
    const armR = this.arm(top, sk, 1);
    arms.add(armL.g, armR.g);
    this.armParts = [armL, armR];
    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.1, -0.06, -0.3);
    arms.add(this.gunHolder);
    this.weapon = null;
    this.setWeapon('ak47');

    root.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true;
        m.userData.baseMat = m.material;
      }
    });
    // Flames for when the fighter is on fire (hidden until then).
    this.flames = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.set((i % 2 ? 0.15 : -0.15), 0.5 + i * 0.35, 0);
      this.flames.add(sp);
    }
    this.flames.visible = false;
    root.add(this.flames);
    scene.add(root);
    this.phase = 0;
    this.deadT = 0;
    this.downT = 0;
    this.last = { x: 0, z: 0 };
    this.speed = 0;
    this.ghost = false;
    this.visible = true;
  }

  addHeadgear(faction, u, head) {
    const add = (geo, mat, y = 0, extra) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      extra?.(m);
      head.add(m);
      return m;
    };
    switch (faction) {
      case 'army':
        add(G.helmet, cloth(u.cap, true), 0.02);
        break;
      case 'police':
        add(G.capTop, cloth(u.cap), 0.1);
        add(G.brim, cloth('#0b0d12'), 0.065, (m) => m.position.set(0, 0.065, -0.05));
        break;
      case 'civildefence':
        add(G.beret, cloth(u.cap), 0.1, (m) => (m.rotation.z = 0.25));
        break;
      case 'vigilante':
        add(G.fez, cloth(u.cap), 0.12);
        break;
      case 'bandit':
      case 'militant':
        add(G.wrap, cloth(u.wrap), 0.06, (m) => (m.rotation.x = Math.PI / 2));
        add(G.mask, cloth(u.wrap), -0.04, (m) => (m.rotation.y = Math.PI));
        if (faction === 'bandit') add(G.beret, cloth(u.wrap), 0.1);
        break;
      default:
        add(G.capTop, cloth(u.cap || '#222'), 0.1);
        add(G.brim, cloth('#111'), 0.065, (m) => m.position.set(0, 0.065, -0.05));
    }
  }

  arm(top, sk, side) {
    const g = new THREE.Group();
    g.position.set(side * 0.24, 0, 0);
    const upper = new THREE.Mesh(G.upperArm, top);
    g.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(new THREE.Mesh(G.foreArm, top));
    const hand = new THREE.Mesh(G.hand, sk);
    hand.position.y = -0.3;
    elbow.add(hand);
    g.add(elbow);
    return { g, elbow, side };
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.gunHolder.remove(this.weapon);
    this.weapon = thirdPersonGun(id || 'p9');
    this.gunHolder.add(this.weapon);
    this.pistol = id === 'p9' || id === 'hawk';
    this.melee = id === 'knife';
    this.weapon.traverse((m) => m.isMesh && (m.userData.baseMat = m.material));
    if (this.ghost) this.setGhost(true, true);
  }

  setGhost(on, force = false) {
    if (this.ghost === on && !force) return;
    this.ghost = on;
    this.root.traverse((m) => {
      if (m.isMesh) m.material = on ? ghostMat : m.userData.baseMat || m.material;
    });
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return out.copy(this.root.position).setY(this.root.position.y + 1.4);
    return this.weapon.localToWorld(out.copy(this.weapon.userData.muzzle));
  }

  // s: interpolated state { x, y, z, yaw, pitch, flags, w (weapon id), sink }
  update(dt, s, t) {
    const r = this.root;
    const crouch = s.flags & 1;
    const downed = s.flags & 2;
    const spirit = s.flags & 4;
    const sprint = s.flags & 128;
    const dead = s.flags & 256;
    const reloading = s.flags & 64;
    const prot = s.flags & 32;
    const moved = Math.hypot(s.x - this.last.x, s.z - this.last.z);
    this.last.x = s.x;
    this.last.z = s.z;
    const inst = dt > 0 ? Math.min(9, moved / dt) : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);
    r.position.set(s.x, s.y - (s.sink || 0), s.z);
    r.rotation.y = s.yaw;
    this.setWeapon(s.w);
    this.setGhost(!!spirit);
    r.visible = this.visible;

    // Death fall / downed crawl.
    if (dead) this.deadT = Math.min(1, this.deadT + dt * 2.2);
    else this.deadT = 0;
    if (downed) this.downT = Math.min(1, this.downT + dt * 3);
    else this.downT = Math.max(0, this.downT - dt * 3);

    const legs = this.legs;
    const moving = this.speed > 0.4;
    this.phase += dt * (sprint ? 11 : 8) * Math.min(1.4, this.speed / 3.5);
    const swing = moving ? Math.sin(this.phase) * (sprint ? 0.75 : 0.5) : 0;
    let hipY = 0.95;
    let lean = 0;
    if (crouch && !downed) {
      hipY = 0.6;
      legs[0].hip.rotation.x = 1.25 + swing * 0.3;
      legs[1].hip.rotation.x = 0.5 - swing * 0.3;
      legs[0].knee.rotation.x = -1.85;
      legs[1].knee.rotation.x = -1.6;
      lean = 0.25;
    } else {
      legs[0].hip.rotation.x = swing;
      legs[1].hip.rotation.x = -swing;
      // Knees only bend backwards, most while the leg swings through.
      legs[0].knee.rotation.x = -(Math.max(0, -Math.sin(this.phase + 0.6)) * (moving ? 1.1 : 0) + 0.05);
      legs[1].knee.rotation.x = -(Math.max(0, Math.sin(this.phase + 0.6)) * (moving ? 1.1 : 0) + 0.05);
      hipY = 0.95 - (moving ? Math.abs(Math.cos(this.phase)) * 0.04 : 0);
      lean = sprint ? 0.28 : moving ? 0.08 : 0;
    }
    this.hips.position.y = hipY;
    this.spine.rotation.x = -lean;
    // Aim: the arms and head follow pitch; sprinting carries the gun low.
    const pitch = s.pitch || 0;
    let armPitch = sprint ? -0.7 : pitch + lean;
    if (reloading) armPitch = -0.35 + Math.sin(t * 6) * 0.05;
    if (this.melee) armPitch = pitch * 0.5 - 0.2;
    this.arms.rotation.x = armPitch;
    this.head.rotation.x = Math.max(-0.6, Math.min(0.6, pitch * 0.6 + lean));
    // Rifle hold: right hand on grip, left on handguard. Pistols held two-handed out front.
    const [L, R] = this.armParts;
    if (this.pistol) {
      R.g.rotation.set(1.45, 0, -0.3);
      R.elbow.rotation.set(0.05, 0, 0);
      L.g.rotation.set(1.45, 0, 0.4);
      L.elbow.rotation.set(0.05, 0, 0);
      this.gunHolder.position.set(0.02, -0.02, -0.56);
    } else {
      // Right hand on the grip by the chest, left hand forward on the handguard.
      R.g.rotation.set(0.75, 0, -0.35);
      R.elbow.rotation.set(1.0, 0, 0);
      L.g.rotation.set(1.2, 0, 0.6);
      L.elbow.rotation.set(0.45, 0, 0);
      this.gunHolder.position.set(0.1, -0.06, -0.3);
    }

    // Lying down: downed fighters on their back, dead ones fall.
    const lie = Math.max(this.downT, this.deadT);
    if (lie > 0) {
      // Everybody falls differently: forward, backward or twisting to one side.
      const fall = this.fallDir ?? (this.fallDir = ([...this.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3) - 1);
      r.rotation.x = (fall === 1 && !downed ? 1 : -1) * lie * (Math.PI / 2 - 0.08);
      r.rotation.z = fall === 0 && !downed ? lie * 0.5 : 0;
      r.position.y += lie * 0.15;
      this.hips.position.y = hipY * (1 - lie) + 0.18 * lie;
      if (downed) {
        // Reaching arm, slight writhe.
        R.g.rotation.set(2.6 + Math.sin(t * 2) * 0.15, 0, -0.2);
      }
    } else {
      r.rotation.x = 0;
      r.rotation.z = 0;
    }
    // On fire.
    this.flames.visible = !!(s.flags & 1024);
    if (this.flames.visible)
      this.flames.children.forEach((sp, i) => {
        const f = 0.8 + Math.sin(t * 12 + i * 2) * 0.2;
        sp.scale.set(0.7 * f, 1.0 * f, 1);
      });
    // Spawn protection shimmer.
    if (prot && !spirit) r.visible = this.visible && Math.sin(t * 30) > -0.6;
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
