// Houses that burn: when one is bombed down the roof caves in, flames pour out of the door and
// windows with a column of black smoke, the walls char, and it is left as a blackened
// charcoal shell with embers that slowly cool.
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { HOUSES } from '../../../shared/vehicles.js';
import { charMaterial } from './vehicle-models.js';
import * as T from '../core/textures.js';

export class Houses {
  constructor(scene, map, arena, fx) {
    this.scene = scene;
    this.map = map;
    this.arena = arena;
    this.fx = fx;
    this.state = map.houses.map(() => 0);
    this.burning = [];
    // Original wall heights, so a house a lorry knocked down stands again next round.
    this.orig = [];
    map.boxes.forEach((b, bi) => b.house !== undefined && !b.roof && this.orig.push([bi, b.y1]));
    this.flameMat = new THREE.SpriteMaterial({ map: T.flameTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.debrisMat = new THREE.MeshStandardMaterial({ color: '#151210', roughness: 1, metalness: 0.2, side: THREE.DoubleSide });
  }

  apply(list) {
    for (const [i, s] of list || []) this.setState(i, s, true);
  }

  setState(i, s, instant = false) {
    const H = this.map.houses[i];
    const parts = this.arena.houseParts?.[i];
    if (!H || !parts || this.state[i] >= s) return;
    if (s === 4) return this.crush(i, H, parts, instant);
    const was = this.state[i];
    this.state[i] = s;
    // The roof caves in, server and client alike.
    const roof = this.map.boxes[H.roof];
    if (roof) {
      roof.y0 = -3;
      roof.y1 = -2.5;
    }
    if (was === 0) {
      const char = charMaterial(true);
      char.emissiveIntensity = 0;
      parts.walls.traverse((o) => o.isMesh && (o.material = char));
      parts.roof.visible = false;
      for (const o of parts.props) o.visible = false;
      this.collapse(H, parts);
      const fire = { i, H, char, life: instant || s === 3 ? 0 : HOUSES.burnSecs, flames: [], ember: instant ? 0 : 1, smokeT: 0 };
      if (!instant && s === 2) this.ignite(fire);
      this.burning.push(fire);
    } else if (s === 3) {
      const f = this.burning.find((x) => x.i === i);
      if (f) f.life = Math.min(f.life, 2.5);
    }
  }

  // A lorry drove through it: walls knocked down to a low line of rubble, in a cloud of dust.
  crush(i, H, parts, instant) {
    this.state[i] = 4;
    for (const b of this.map.boxes) {
      if (b.house !== i) continue;
      if (b.roof) {
        b.y0 = -3;
        b.y1 = -2.5;
      } else b.y1 = Math.min(b.y1, 0.45);
    }
    parts.walls.scale.y = 0.14;
    parts.roof.visible = false;
    for (const o of parts.props) o.visible = false;
    if (parts.debris) parts.debris.visible = false;
    const f = this.burning.find((x) => x.i === i);
    if (f) f.life = Math.min(f.life, 0.5);
    if (instant) return;
    for (let k = 0; k < 26; k++) this.fx.dust.spawn(new THREE.Vector3(H.x + (Math.random() - 0.5) * H.w, 0.6 + Math.random() * H.h * 0.6, H.z + (Math.random() - 0.5) * H.d), { colour: k % 2 ? '#8a7a62' : '#6b5a48', size: 1.6 + Math.random() * 1.5, life: 2.5 + Math.random() * 2, v: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), grow: 2.5, opacity: 0.75 });
    audio.crash?.(14);
  }

  // Burnt roof sheets and beams lying across the room.
  collapse(H, parts) {
    const g = new THREE.Group();
    g.position.set(H.x, 0, H.z);
    const along = H.w >= H.d;
    for (let k = 0; k < 3; k++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry((along ? H.w : H.d) * 0.42, (along ? H.d : H.w) * 0.8), this.debrisMat);
      sheet.rotation.set(-Math.PI / 2 + (k - 1) * 0.35, (k - 1) * 0.3, along ? 0 : Math.PI / 2);
      sheet.position.set(((k - 1) * H.w) / 3.4, 0.35 + k * 0.3, ((k - 1) * H.d) / 8);
      sheet.receiveShadow = sheet.castShadow = true;
      g.add(sheet);
    }
    for (let k = 0; k < 2; k++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, Math.max(H.w, H.d) * 0.9), this.debrisMat);
      beam.rotation.set(0.45 * (k ? 1 : -1), along ? Math.PI / 2 : 0, 0.1);
      beam.position.set(((k ? 1 : -1) * H.w) / 6, H.h * 0.4, 0);
      g.add(beam);
    }
    this.scene.add(g);
    parts.debris = g;
  }

  // Flames at the door, the windows and over the open top, with one light for the glow.
  ignite(f) {
    const { H } = f;
    const g = new THREE.Group();
    const spots = [];
    for (let k = 0; k < 7; k++) spots.push([H.x + (Math.random() - 0.5) * H.w * 0.7, H.z + (Math.random() - 0.5) * H.d * 0.7, 0.5 + Math.random() * (H.h + 0.6)]);
    for (const [x, z, y] of spots) {
      const sp = new THREE.Sprite(this.flameMat.clone());
      sp.position.set(x, y, z);
      sp.userData.ph = Math.random() * 10;
      sp.userData.y = y;
      g.add(sp);
      f.flames.push(sp);
    }
    this.scene.add(g);
    f.g = g;
    f.light = this.fx.takeFireLight(H.x, H.h * 0.6, H.z, f);
    this.fx.addDecal(this.fx.scorchMat, new THREE.Vector3(H.x, 0.03, H.z), new THREE.Vector3(0, 1, 0), Math.max(H.w, H.d) * 1.2, 300);
  }

  update(dt, t) {
    for (const f of this.burning) {
      const { H } = f;
      if (f.life > 0) {
        f.life -= dt;
        const k = Math.min(1, f.life / 3);
        for (const sp of f.flames) {
          const flick = 0.75 + Math.sin(t * 9 + sp.userData.ph) * 0.18 + Math.random() * 0.12;
          sp.scale.set(2.4 * flick * k, 3.6 * flick * k, 1);
          sp.position.y = sp.userData.y + Math.sin(t * 2.5 + sp.userData.ph) * 0.15;
        }
        if (f.light && this.fx.lightUsers.get(f.light) === f) f.light.intensity = (60 + Math.random() * 30) * k;
        // A thick black column of smoke.
        f.smokeT += dt;
        if (f.smokeT > 0.12) {
          f.smokeT = 0;
          this.fx.dust.spawn(new THREE.Vector3(H.x + (Math.random() - 0.5) * H.w * 0.5, H.h + 1, H.z + (Math.random() - 0.5) * H.d * 0.5), { colour: '#1c1a19', size: 2.2, life: 5, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.4, (Math.random() - 0.5) * 0.6), grow: 3.5, opacity: 0.7 * k });
        }
        if (Math.random() < dt * 14) this.fx.sparks.spawn(new THREE.Vector3(H.x + (Math.random() - 0.5) * H.w * 0.6, H.h * 0.7, H.z + (Math.random() - 0.5) * H.d * 0.6), { colour: '#ffb04a', size: 0.06, life: 1.4, v: new THREE.Vector3((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2), g: -0.4 });
        if (f.life <= 0) {
          if (f.g) this.scene.remove(f.g);
          if (f.light && this.fx.lightUsers.get(f.light) === f) this.fx.releaseFireLight(f.light);
        }
      } else if (f.ember > 0.02 && Math.random() < dt * 1.5) {
        this.fx.dust.spawn(new THREE.Vector3(H.x + (Math.random() - 0.5) * H.w * 0.4, 1.2, H.z + (Math.random() - 0.5) * H.d * 0.4), { colour: '#55504c', size: 1.4, life: 5, v: new THREE.Vector3(0, 0.9, 0), grow: 4, opacity: 0.3 });
      }
      // Walls glow with embers while it burns, then slowly go black.
      f.ember = f.life > 0 ? Math.max(0.6, f.ember - dt * 0.01) : Math.max(0, f.ember - dt * 0.025);
      f.char.emissiveIntensity = f.ember * 0.55 * (0.8 + Math.sin(t * 5 + f.i) * 0.12 + Math.random() * 0.08);
    }
  }

  // New round: houses stand again.
  reset() {
    for (const [i, s] of this.state.entries()) {
      if (!s) continue;
      const parts = this.arena.houseParts[i];
      const H = this.map.houses[i];
      parts.walls.scale.y = 1;
      parts.roof.visible = true;
      for (const o of parts.props) o.visible = true;
      if (parts.debris) this.scene.remove(parts.debris);
      const mats = this.arena.materials;
      parts.walls.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mats[H.kind] || mats.plaster;
      });
      const roof = this.map.boxes[H.roof];
      if (roof) {
        roof.y0 = H.h;
        roof.y1 = H.h + 0.12;
      }
    }
    for (const [bi, y1] of this.orig) this.map.boxes[bi].y1 = y1;
    for (const f of this.burning) {
      if (f.g) this.scene.remove(f.g);
      if (f.light && this.fx.lightUsers.get(f.light) === f) this.fx.releaseFireLight(f.light);
    }
    this.burning = [];
    this.state = this.map.houses.map(() => 0);
  }
}
