// First-person arms and weapon, drawn in their own scene on top of the world:
// sway, bob, recoil, ADS, reload, weapon raise, sprint pose, muzzle flash and shells.
import * as THREE from 'three';
import { buildGun } from './guns.js';
import { FACTIONS, WEAPONS } from '../../../shared/config.js';
import { flashStar } from '../core/textures.js';

const up = new THREE.Vector3(0, 1, 0);

function limb(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(up, dir.normalize());
  return m;
}

export class ViewModel {
  constructor(mainScene) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight('#dfe8ff', '#6a5a48', 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff2dc', 1.5);
    this.sun.position.set(0.5, 1, 0.3);
    this.scene.add(this.sun);
    this.mainScene = mainScene;
    this.root = new THREE.Group(); // camera-space offset, sway, bob
    this.camera.add(this.root);
    this.kick = new THREE.Group(); // recoil and reload motion
    this.root.add(this.kick);
    this.holder = new THREE.Group(); // the gun + hands
    this.kick.add(this.holder);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashStar(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight('#ffb35a', 0, 4, 2);
    this.scene.add(this.flashLight);
    this.shells = [];
    this.shellGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6);
    this.shellMat = new THREE.MeshStandardMaterial({ color: '#c8963a', metalness: 1, roughness: 0.3 });
    this.t = 0;
    this.bob = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.adsK = 0;
    this.sprintK = 0;
    this.raise = 1;
    this.recoil = 0;
    this.recoilRot = 0;
    this.reloadStart = 0;
    this.reloadDur = 0;
    this.swingT = 0;
    this.id = null;
    this.visible = true;
    this.landDip = 0;
  }

  setUniform(faction, skinIndex = 1) {
    const u = FACTIONS[faction]?.uniform || FACTIONS.police.uniform;
    this.sleeve = new THREE.MeshStandardMaterial({ color: u.top, roughness: 0.9 });
    const skin = ['#3a2216', '#48291b', '#2e1b11', '#553220'][skinIndex % 4];
    this.skin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.55 });
    this.glove = new THREE.MeshStandardMaterial({ color: faction === 'army' || faction === 'police' || faction === 'civildefence' ? '#151515' : skin, roughness: 0.7 });
    if (this.id) {
      const id = this.id;
      this.id = null;
      this.setWeapon(id, true);
    }
  }

  setWeapon(id, instant = false) {
    if (this.id === id) return;
    this.id = id;
    this.holder.clear();
    if (!id) return;
    const gun = buildGun(id);
    this.gun = gun;
    this.holder.add(gun);
    gun.add(this.flash);
    this.flash.position.copy(gun.userData.muzzle);
    const w = WEAPONS[id];
    this.def = w;
    this.pistol = w.slot === 'secondary';
    this.melee = !!w.melee;
    this.rpg = id === 'rpg';
    this.addHands(gun);
    gun.traverse((m) => {
      if (m.isMesh) m.frustumCulled = false;
    });
    // Hip and ADS positions (camera space).
    if (this.melee) {
      this.hip = new THREE.Vector3(0.2, -0.2, -0.38);
      this.holder.rotation.set(0.3, 0.2, -0.3);
    } else if (this.rpg) {
      this.hip = new THREE.Vector3(0.16, -0.1, -0.28);
      this.holder.rotation.set(0, 0, 0);
    } else if (this.pistol) {
      this.hip = new THREE.Vector3(0.15, -0.16, -0.44);
      this.holder.rotation.set(0, 0, 0);
    } else {
      this.hip = new THREE.Vector3(0.14, -0.15, -0.34);
      this.holder.rotation.set(0, 0, 0);
    }
    const sightY = gun.userData.sightY;
    this.ads = new THREE.Vector3(0, -sightY, this.pistol ? -0.38 : this.rpg ? -0.2 : gun.userData.scope ? -0.16 : -0.24);
    if (this.rpg) this.ads.x = -0.045; // offset optic on the left
    this.raise = instant ? 1 : 0;
  }

  addHands(gun) {
    const s = this.sleeve || new THREE.MeshStandardMaterial({ color: '#333' });
    const g = this.glove || s;
    const k = this.skin || s;
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const parts = [];
    if (this.melee) {
      const grip = P(0, -0.01, 0.05);
      parts.push(limb(grip, P(0.06, -0.3, 0.22), 0.032, s));
      parts.push(new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), g));
      parts[1].position.copy(grip);
    } else if (this.pistol) {
      const grip = P(0, -0.05, 0.03);
      parts.push(limb(grip, P(0.07, -0.34, 0.2), 0.034, s));
      parts.push(limb(P(-0.01, -0.06, 0.02), P(-0.13, -0.34, 0.18), 0.034, s));
      const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), g);
      h1.position.copy(grip);
      h1.scale.set(1, 1.2, 1.1);
      const h2 = h1.clone();
      h2.position.set(-0.02, -0.06, 0.02);
      parts.push(h1, h2);
    } else {
      const grip = this.rpg ? P(0, -0.07, 0.02) : P(0, -0.08, 0.1);
      const fore = this.rpg ? P(0, -0.07, -0.18) : P(0, -0.035, -0.32);
      parts.push(limb(grip, P(0.1, -0.34, 0.25), 0.036, s));
      parts.push(limb(fore, P(-0.15, -0.36, -0.02), 0.036, s));
      const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), g);
      h1.position.copy(grip);
      h1.scale.set(1, 1.2, 1.15);
      const h2 = h1.clone();
      h2.position.copy(fore);
      h2.scale.set(1.15, 1, 1.4);
      parts.push(h1, h2);
      // A bit of wrist skin above the gloves.
      const wrist = limb(grip.clone().add(P(0.01, -0.03, 0.04)), grip.clone().add(P(0.02, -0.05, 0.08)), 0.03, k);
      parts.push(wrist);
    }
    for (const p of parts) {
      p.frustumCulled = false;
      gun.add(p);
    }
  }

  fire() {
    if (this.melee) return this.swing();
    const w = this.def;
    this.recoil = Math.min(1.2, this.recoil + (this.pistol ? 0.7 : this.rpg ? 1.2 : 0.45 + (w.kick || 0.015) * 10));
    this.recoilRot = Math.min(1, this.recoilRot + 0.5 + (w.kick || 0.02) * 6);
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = this.pistol ? 0.16 : this.rpg ? 0.6 : 0.24 + (w.dmg > 40 ? 0.08 : 0);
    this.flash.scale.set(s, s, 1);
    this.flashTime = 0.045;
    this.flashLight.intensity = 6;
    if (this.gun.userData.eject && !this.rpg && this.id !== 'danegun') this.ejectShell();
  }

  ejectShell() {
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    m.frustumCulled = false;
    const p = this.gun.localToWorld(this.gun.userData.eject.clone());
    this.camera.worldToLocal(p);
    m.position.copy(p);
    m.rotation.z = Math.PI / 2;
    this.camera.add(m);
    this.shells.push({ m, v: new THREE.Vector3(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.4, 0.2), life: 0.5, spin: (Math.random() - 0.5) * 30 });
    if (this.shells.length > 12) {
      const old = this.shells.shift();
      this.camera.remove(old.m);
    }
  }

  reload(seconds) {
    this.reloadStart = this.t;
    this.reloadDur = seconds;
  }

  cancelReload() {
    this.reloadDur = 0;
  }

  swing() {
    this.swingT = 1;
  }

  // opts: { speed, sprint, ads, crouch, onGround, look: {yaw,pitch} deltas, landed }
  update(dt, o) {
    this.t += dt;
    if (!this.gun) return;
    const ads = o.ads && !o.sprint && !this.melee;
    this.adsK += ((ads ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.sprintK += ((o.sprint ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    this.raise = Math.min(1, this.raise + dt * 3.2);
    // Bob from footsteps.
    const moving = o.speed > 0.3 && o.onGround;
    this.bob += dt * (o.sprint ? 13 : 8.5) * Math.min(1.3, o.speed / 4);
    const bobAmt = moving ? (o.sprint ? 0.02 : 0.009) * (1 - this.adsK * 0.85) : 0;
    const bx = Math.cos(this.bob) * bobAmt;
    const by = -Math.abs(Math.sin(this.bob)) * bobAmt;
    // Sway lags behind mouse movement.
    this.swayX += (-o.look.yaw * 0.6 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (o.look.pitch * 0.6 - this.swayY) * Math.min(1, dt * 10);
    const swayK = 1 - this.adsK * 0.8;
    // Idle breathing.
    const breathe = Math.sin(this.t * 1.6) * 0.002 * (1 - this.adsK * 0.7);
    if (o.landed) this.landDip = 0.04;
    this.landDip *= Math.pow(0.001, dt);
    const base = new THREE.Vector3().lerpVectors(this.hip, this.ads, this.adsK);
    this.root.position.set(base.x + bx + this.swayX * 0.04 * swayK, base.y + by + breathe - this.landDip - (1 - this.raise) * 0.25 + this.swayY * 0.03 * swayK, base.z);
    this.root.rotation.set(this.swayY * 0.4 * swayK + this.sprintK * -0.35, this.swayX * 0.5 * swayK + this.sprintK * 0.6, this.swayX * 0.3 * swayK + this.sprintK * 0.25 + (o.crouch ? 0.04 : 0));
    // Recoil springs back.
    this.recoil *= Math.pow(0.0006, dt);
    this.recoilRot *= Math.pow(0.002, dt);
    const adsRecoil = 1 - this.adsK * 0.55;
    this.kick.position.set(0, this.recoil * 0.006, this.recoil * (this.rpg ? 0.08 : 0.045) * adsRecoil);
    this.kick.rotation.set(this.recoilRot * 0.12 * adsRecoil, 0, this.recoilRot * 0.02 * (Math.random() - 0.5));
    // Reload: tilt, drop the mag, slap it in, rack.
    const mag = this.gun.userData.mag;
    if (this.reloadDur > 0) {
      const p = (this.t - this.reloadStart) / this.reloadDur;
      if (p >= 1) this.reloadDur = 0;
      const tilt = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
      this.kick.rotation.x += -0.25 * tilt;
      this.kick.rotation.z += 0.55 * tilt;
      this.kick.position.y -= 0.05 * tilt;
      if (mag) {
        const out = p > 0.2 && p < 0.65 ? Math.min(1, (p - 0.2) / 0.1) * (p > 0.55 ? (0.65 - p) / 0.1 : 1) : 0;
        mag.position.y = (mag.userData.y0 ??= mag.position.y) - out * 0.25;
        mag.visible = !(p > 0.32 && p < 0.45);
      }
      if (p > 0.7 && p < 0.85) this.kick.position.z += Math.sin(((p - 0.7) / 0.15) * Math.PI) * 0.03;
    } else if (mag && mag.userData.y0 !== undefined) {
      mag.position.y = mag.userData.y0;
      mag.visible = true;
    }
    // Machete swing.
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * 3.5);
      const s = Math.sin((1 - this.swingT) * Math.PI);
      this.kick.rotation.set(-s * 0.9, s * 0.8, s * 0.7);
      this.kick.position.set(-s * 0.15, s * 0.05, -s * 0.12);
    }
    // Flash and shells.
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    this.flashLight.intensity *= Math.pow(0.0001, dt);
    this.flashLight.position.set(0.1, -0.1, -0.6);
    for (const s of this.shells) {
      s.life -= dt;
      s.v.y -= 6 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.spin * dt;
      if (s.life <= 0) this.camera.remove(s.m);
    }
    this.shells = this.shells.filter((s) => s.life > 0);
    this.root.visible = this.visible;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
