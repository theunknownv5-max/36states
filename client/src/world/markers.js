// Live objects on the battlefield: advert walls with their life gems, and the
// resource sites (A, B, C and mid-match discoveries) with their capture beams.
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { GEMS } from '../../../shared/config.js';
import { RESOURCES } from '../../../shared/states.js';

const SIDE_COL = { sec: new THREE.Color('#4f9dff'), out: new THREE.Color('#ff5a4f'), none: new THREE.Color('#e8e8e8'), contested: new THREE.Color('#ffd23f'), discovery: new THREE.Color('#ffc13b') };

// ---------- advert walls + life gems ----------
export class AdWalls {
  constructor(scene, map) {
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.walls = [];
    const frameMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.7 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#3d4046', roughness: 0.7, metalness: 0.5 });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#222', emissive: '#fff4d0', emissiveIntensity: 2.5 });
    const gemGeo = new THREE.OctahedronGeometry(0.26, 0);
    gemGeo.scale(1, 1.55, 1);
    const glowTex = T.softDot();
    const ringTex = T.ringTex();
    const boxes = new Map(map.boxes.filter((b) => b.ad).map((b) => [b.ad, b]));
    map.adWalls.forEach((a, i) => {
      const b = boxes.get(a.id);
      const g = new THREE.Group();
      // Billboard structure.
      const back = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), backMat);
      back.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      back.castShadow = back.receiveShadow = true;
      g.add(back);
      const yaw = Math.atan2(a.nx, a.nz);
      const face = new THREE.Group();
      face.position.set(a.face.x, a.y, a.face.z);
      face.rotation.y = yaw;
      const mat = new THREE.MeshStandardMaterial({ map: T.houseAdTexture(i), emissive: '#ffffff', emissiveMap: T.houseAdTexture(i), emissiveIntensity: 0.2, roughness: 0.45 });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(a.w - 0.25, a.h - 0.2), mat);
      panel.position.z = 0.015;
      panel.receiveShadow = true;
      face.add(panel);
      // Frame and two flood lamps.
      for (const [w, h, x, y] of [
        [a.w, 0.12, 0, a.h / 2 - 0.06],
        [a.w, 0.12, 0, -a.h / 2 + 0.06],
        [0.12, a.h, -a.w / 2 + 0.06, 0],
        [0.12, a.h, a.w / 2 - 0.06, 0]
      ]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), frameMat);
        f.position.set(x, y, 0.04);
        face.add(f);
      }
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), frameMat);
        arm.position.set(s * a.w * 0.28, a.h / 2 + 0.05, 0.35);
        face.add(arm);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.18), lampMat);
        lamp.position.set(s * a.w * 0.28, a.h / 2 + 0.02, 0.7);
        lamp.rotation.x = 0.6;
        face.add(lamp);
      }
      g.add(face);
      // Life gem.
      const gem = new THREE.Group();
      gem.position.set(a.gem.x, a.gem.y, a.gem.z);
      const crystal = new THREE.Mesh(gemGeo, new THREE.MeshPhysicalMaterial({ color: '#59f3ff', emissive: '#19c6ff', emissiveIntensity: 1.6, roughness: 0.08, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 }));
      gem.add(crystal);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#3fe0ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
      glow.scale.setScalar(1.6);
      gem.add(glow);
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: ringTex, color: '#3fe0ff', transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.1;
      gem.add(ring);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      label.scale.set(1.6, 0.4, 1);
      label.position.y = 0.8;
      label.visible = false;
      gem.add(label);
      g.add(gem);
      this.group.add(g);
      this.walls.push({ a, panel, mat, gem, crystal, glow, ring, label, until: 0, labelText: '', burst: 0 });
    });
  }

  // Apply the paid adverts served for this state.
  async loadAds(stateId) {
    try {
      const r = await fetch(`/api/ads?state=${encodeURIComponent(stateId)}`);
      if (!r.ok) return;
      const { slots } = await r.json();
      const loader = new THREE.TextureLoader();
      for (const w of this.walls) {
        const s = slots[w.a.id];
        if (!s?.image) continue;
        loader.load(s.image, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          w.mat.map = tex;
          w.mat.emissiveMap = tex;
          w.mat.needsUpdate = true;
          w.advertiser = s.advertiser;
        });
      }
    } catch {
      /* offline: keep house adverts */
    }
  }

  setGems(untilList) {
    untilList.forEach((u, i) => {
      if (this.walls[i]) this.walls[i].until = u;
    });
  }

  collected(i, until) {
    const w = this.walls[i];
    if (!w) return;
    w.until = until;
    w.burst = 1;
  }

  // Index of the nearest wall whose gem is ready, for the spirit-run compass.
  nearestReady(x, z, serverNow) {
    let best = -1;
    let bd = Infinity;
    this.walls.forEach((w, i) => {
      if (w.until > serverNow) return;
      const d = Math.hypot(w.a.gem.x - x, w.a.gem.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  update(dt, t, serverNow, cam) {
    for (const w of this.walls) {
      const ready = w.until <= serverNow;
      w.crystal.visible = ready;
      w.glow.visible = ready || w.burst > 0;
      if (ready) {
        w.crystal.rotation.y += dt * 1.6;
        w.crystal.position.y = Math.sin(t * 2 + w.a.x) * 0.12;
        w.glow.material.opacity = 0.65 + Math.sin(t * 4 + w.a.z) * 0.2;
        w.glow.scale.setScalar(1.6);
        w.ring.material.color.set('#3fe0ff');
        w.ring.material.opacity = 0.55;
        w.ring.rotation.z += dt * 0.5;
      } else {
        // Recharging: grey ring fills as the gem comes back.
        const k = 1 - Math.min(1, (w.until - serverNow) / GEMS.cooldownMs);
        w.ring.material.color.setRGB(0.4 + k * 0.2, 0.45 + k * 0.4, 0.5 + k * 0.5);
        w.ring.material.opacity = 0.25 + k * 0.3;
      }
      if (w.burst > 0) {
        w.burst = Math.max(0, w.burst - dt * 1.5);
        w.glow.scale.setScalar(1.6 + (1 - w.burst) * 6);
        w.glow.material.opacity = w.burst;
      }
      // Countdown label only for walls close by (canvas redraw is not free).
      const near = Math.hypot(cam.position.x - w.a.x, cam.position.z - w.a.z) < 40;
      if (!ready && near) {
        const s = Math.ceil((w.until - serverNow) / 1000);
        const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (text !== w.labelText) {
          w.labelText = text;
          w.label.material.map?.dispose();
          w.label.material.map = T.labelTexture(['💎 ' + text], { w: 256, h: 64, size: 40, colour: '#bfefff' });
          w.label.material.needsUpdate = true;
        }
        w.label.visible = true;
      } else w.label.visible = false;
    }
  }

  // Walls the player can actually see right now (for advertiser view counts).
  visibleSlots(camera, index, lineBlocked, smokes, radius) {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const out = [];
    const p = camera.position;
    const pt = new THREE.Vector3();
    for (const w of this.walls) {
      const a = w.a;
      const dx = a.face.x - p.x;
      const dz = a.face.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      if (dx * a.nx + dz * a.nz > 0) continue; // looking at the back
      if (!frustum.containsPoint(pt.set(a.face.x, a.y, a.face.z))) continue;
      const fx = a.face.x + a.nx * 0.3;
      const fz = a.face.z + a.nz * 0.3;
      if (lineBlocked(index, p.x, p.y, p.z, fx, a.y, fz, smokes)) continue;
      out.push(a.id);
    }
    return out;
  }
}

// ---------- resource sites ----------
export class SiteMarkers {
  constructor(scene, map) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sites = new Map();
    for (const s of map.sites) this.make(s);
  }

  make(s) {
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 2, s.r * 2), new THREE.MeshBasicMaterial({ map: T.ringTex(), transparent: true, opacity: 0.6, depthWrite: false, color: SIDE_COL.none }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    const beamTex = T.beamTex();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: SIDE_COL.none }));
    beam.position.y = 30;
    g.add(beam);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.labelTexture([s.id === 'D' ? '◆' : s.id], { w: 128, h: 128, size: 96, font: 'Black Ops One', weight: 400 }), transparent: true, depthWrite: false, depthTest: false }));
    label.scale.set(1.6, 1.6, 1);
    label.position.y = 6.5;
    label.renderOrder = 10;
    g.add(label);
    // Sign naming the resource.
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.labelTexture([s.label || RESOURCES[s.resource]?.site || ''], { w: 512, h: 96, size: 52 }), transparent: true, depthWrite: false }));
    sign.scale.set(5, 0.95, 1);
    sign.position.y = 5.2;
    g.add(sign);
    this.group.add(g);
    const rec = { s, g, ring, beam, label, sign };
    this.sites.set(s.id, rec);
    return rec;
  }

  apply(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      const rec = this.sites.get(s.id) || this.make(s);
      rec.s = s;
    }
    for (const [id, rec] of this.sites) {
      if (!seen.has(id) && id === 'D') {
        this.group.remove(rec.g);
        this.sites.delete(id);
      }
    }
  }

  update(dt, t) {
    for (const rec of this.sites.values()) {
      const s = rec.s;
      let col = s.owner ? SIDE_COL[s.owner] : s.id === 'D' ? SIDE_COL.discovery : SIDE_COL.none;
      if (s.contested && Math.sin(t * 10) > 0) col = SIDE_COL.contested;
      rec.ring.material.color.copy(col);
      rec.beam.material.color.copy(col);
      rec.beam.material.opacity = (s.id === 'D' ? 0.45 : 0.28) + Math.sin(t * 2) * 0.06;
      rec.ring.rotation.z += dt * 0.15;
      rec.label.material.color.copy(col);
    }
  }
}
