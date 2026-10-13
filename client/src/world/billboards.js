// Every advert surface in a battle: skyline billboards (rooftop towers or highway unipoles
// outside the walls), double-sided LED road screens, and the wall banners (registered by
// AdWalls). Paid artwork is loaded at full resolution with mipmaps and maximum anisotropic
// filtering, drawn unlit (exact colours as the advertiser designed them) and only lightly
// hazed by fog, so it stays sharp and readable at a distance.
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { api, HTTP_BASE } from '../core/server.js';
import { mulberry32 } from '../../../shared/rng.js';
import { BOARD_TYPES, boardsFor } from '../../../shared/billboards.js';

const REFRESH_MS = 5 * 60000;

// Billboards keep 35% of the fog, so far ones still read clearly but sit in the scene.
function lightFog(mat, k = 0.35) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('fogFactor )', `fogFactor * ${k.toFixed(2)} )`));
  };
  mat.customProgramCacheKey = () => `lightfog${k}`;
  return mat;
}

export function panelMaterial(tex, bright = 0.92) {
  return lightFog(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(bright, bright, bright), toneMapped: false }));
}

export class Billboards {
  constructor(scene, map, renderer) {
    this.scene = scene;
    this.map = map;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.panels = new Map(); // board id -> { id, type, code, mats, faces, list, shown, fade }
    this.pickables = []; // advert faces, for "aim at an advert to chat with the business"
    this.textures = new Map(); // url -> Promise<Texture>
    this.rotateMs = 12000;
    this.codes = new Map(boardsFor(map).map((b) => [b.id, b.code]));
    this.host = (HTTP_BASE || location.origin).replace(/^https?:\/\//, '');
    this.build();
  }

  build() {
    const steel = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.55, metalness: 0.75 });
    const galv = new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.45, metalness: 0.8 });
    const lampMat = new THREE.MeshStandardMaterial({ color: '#222', emissive: '#fff1cc', emissiveIntensity: 3 });
    const fac = T.facadeTexture();
    for (const b of this.map.billboards) {
      const yaw = Math.atan2(b.nx, b.nz);
      if (b.type === 'sky') {
        if (b.tower) {
          // Office tower; the billboard stands on its roof at the front edge.
          const t = b.tower;
          const tex = fac.map.clone();
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(t.w / 12, t.h / 14);
          tex.needsUpdate = true;
          const rng = mulberry32(t.seed);
          const tint = new THREE.Color().setHSL(0.08 + rng() * 0.5, 0.08, 0.55 + rng() * 0.2);
          const body = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.4, metalness: 0.25 }));
          body.position.set(b.x - b.nx * (t.d / 2 - 1), t.h / 2, b.z - b.nz * (t.d / 2 - 1));
          body.rotation.y = yaw;
          this.group.add(body);
          const crown = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.6, 1.2, t.d + 0.6), steel);
          crown.position.set(body.position.x, t.h + 0.6, body.position.z);
          crown.rotation.y = yaw;
          this.group.add(crown);
          // Truss legs from roof to the board.
          for (const s of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), steel);
            leg.position.set(b.x + Math.cos(yaw) * s * b.w * 0.3 - b.nx * 1.2, t.h + 1.2 + 1, b.z - Math.sin(yaw) * s * b.w * 0.3 - b.nz * 1.2);
            this.group.add(leg);
          }
          // Red aviation light.
          const av = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3020' }));
          av.position.set(body.position.x, t.h + 1.6, body.position.z);
          this.group.add(av);
        } else {
          // Highway unipole: one tall steel column.
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.35, b.pole + 2.2, 14), galv);
          pole.position.set(b.x - b.nx * 1.2, (b.pole + 2.2) / 2, b.z - b.nz * 1.2);
          this.group.add(pole);
          const head = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.45, 0.8, 1.4), steel);
          head.position.set(pole.position.x, b.pole + 2.2, pole.position.z);
          head.rotation.y = yaw;
          this.group.add(head);
        }
        this.addPanel(b, yaw, steel, lampMat);
      } else if (b.type === 'led') {
        for (const s of [-3, 3]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 9.5, 10), galv);
          pole.position.set(b.x, 4.75, b.z + s);
          pole.castShadow = true;
          this.group.add(pole);
        }
        this.addPanel(b, yaw, steel, null);
      } else if (b.type === 'ground') this.addGroundTile(b);
    }
  }

  // A giant artwork set into a concrete pad, with painted borders: reads like a real
  // floor graphic, sits flush with the ground and has no collision.
  addGroundTile(b) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.rot || 0;
    const conc = T.concreteTexture();
    const slabMat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, color: '#b9b4aa', roughness: 0.9 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.4, 0.05, b.h + 1.4), slabMat);
    slab.position.y = 0.005;
    slab.receiveShadow = true;
    g.add(slab);
    const code = this.codes.get(b.id) || b.id;
    const house = T.advertiseHereTexture(code, BOARD_TYPES.ground.name, this.host);
    // Lit by the sun (so soldiers cast shadows across it) with a little glow to stay readable.
    const mat = new THREE.MeshStandardMaterial({ map: house, emissive: '#ffffff', emissiveMap: house, emissiveIntensity: 0.35, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.onBeforeCompile = lightFog(new THREE.MeshBasicMaterial()).onBeforeCompile;
    mat.customProgramCacheKey = () => 'groundad';
    const art = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h).rotateX(-Math.PI / 2), mat);
    art.position.y = 0.034;
    art.receiveShadow = true;
    art.userData.boardId = b.id;
    this.pickables.push(art);
    g.add(art);
    // Painted white border and corner marks.
    const paint = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const t = 0.22;
    for (const [w, h, x, z] of [
      [b.w + 0.9, t, 0, -(b.h / 2 + 0.35)],
      [b.w + 0.9, t, 0, b.h / 2 + 0.35],
      [t, b.h + 0.9, -(b.w / 2 + 0.35), 0],
      [t, b.h + 0.9, b.w / 2 + 0.35, 0]
    ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), paint);
      m.position.set(x, 0.036, z);
      m.receiveShadow = true;
      g.add(m);
    }
    this.group.add(g);
    // The material keeps its emissive map in step with the advert on show.
    mat.userData.ground = true;
    this.panels.set(b.id, { id: b.id, type: 'ground', mats: [mat], house, faces: [{ x: b.x, y: 0.05, z: b.z, ground: true }], list: [], shown: -1, fade: 1 });
  }

  // Frame, backing and the advert face(s) for a skyline board or LED screen.
  addPanel(b, yaw, steel, lampMat) {
    const g = new THREE.Group();
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = yaw;
    const depth = b.type === 'led' ? 0.4 : 0.7;
    const back = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.5, b.h + 0.5, depth), steel);
    back.position.z = -depth / 2;
    back.castShadow = true;
    g.add(back);
    const geo = new THREE.PlaneGeometry(b.w, b.h);
    const type = BOARD_TYPES[b.type];
    const code = this.codes.get(b.id) || b.id;
    const house = T.advertiseHereTexture(code, type.name, this.host);
    const bright = b.type === 'led' ? 1 : 0.92;
    const mats = [];
    const front = new THREE.Mesh(geo, panelMaterial(house, bright));
    front.position.z = 0.02;
    front.userData.boardId = b.id;
    this.pickables.push(front);
    g.add(front);
    mats.push(front.material);
    if (b.twoSided) {
      const rear = new THREE.Mesh(geo, panelMaterial(house, bright));
      rear.position.z = -depth - 0.02;
      rear.rotation.y = Math.PI;
      rear.userData.boardId = b.id;
      this.pickables.push(rear);
      g.add(rear);
      mats.push(rear.material);
    }
    if (lampMat) {
      // Catwalk and floodlights along the bottom edge.
      const walk = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.5, 0.12, 1.1), steel);
      walk.position.set(0, -b.h / 2 - 0.4, 0.5);
      g.add(walk);
      for (let i = 0; i < 6; i++) {
        const x = -b.w / 2 + b.w * (i + 0.5) / 6;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), lampMat);
        lamp.position.set(x, -b.h / 2 - 0.25, 1.1);
        lamp.rotation.x = -0.7;
        g.add(lamp);
      }
    }
    this.group.add(g);
    this.panels.set(b.id, {
      id: b.id,
      type: b.type,
      mats,
      house,
      faces: [{ x: b.x + b.nx * 0.05, y: b.y, z: b.z + b.nz * 0.05, nx: b.nx, nz: b.nz }].concat(b.twoSided ? [{ x: b.x - b.nx * (depth + 0.05), y: b.y, z: b.z - b.nz * (depth + 0.05), nx: -b.nx, nz: -b.nz }] : []),
      list: [],
      shown: -1,
      fade: 1
    });
  }

  // AdWalls hands over its wall banners so all adverts share loading, rotation and views.
  registerWall(a, material, house, mesh) {
    if (mesh) {
      mesh.userData.boardId = a.id;
      this.pickables.push(mesh);
    }
    this.panels.set(a.id, {
      id: a.id,
      type: 'wall',
      mats: [material],
      house,
      faces: [{ x: a.face.x, y: a.y, z: a.face.z, nx: a.nx, nz: a.nz }],
      list: [],
      shown: -1,
      fade: 1
    });
  }

  texture(url) {
    if (!this.textures.has(url)) {
      this.textures.set(
        url,
        new Promise((resolve) => {
          const loader = new THREE.TextureLoader();
          loader.setCrossOrigin('anonymous');
          loader.load(
            api(url),
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = this.maxAniso;
              tex.generateMipmaps = true;
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
              resolve(tex);
            },
            undefined,
            () => resolve(null)
          );
        })
      );
    }
    return this.textures.get(url);
  }

  async load(stateId) {
    this.stateId = stateId;
    this.nextRefresh = performance.now() + REFRESH_MS;
    try {
      const r = await fetch(api(`/api/ads?state=${encodeURIComponent(stateId)}`));
      if (!r.ok) return;
      const { slots, rotateMs } = await r.json();
      if (this.disposed) return;
      this.rotateMs = rotateMs || this.rotateMs;
      for (const p of this.panels.values()) {
        const list = slots[p.id] || [];
        const loaded = await Promise.all(list.map((s) => this.texture(s.image)));
        if (this.disposed) return;
        p.list = list.map((s, i) => ({ ...s, tex: loaded[i] })).filter((s) => s.tex);
        p.shown = -1;
      }
    } catch {
      /* offline: keep the house artwork */
    }
  }

  // Index of the advert on screen now; the server uses the same clock to credit views.
  current(p, serverNow) {
    return p.list.length ? Math.floor(serverNow / this.rotateMs) % p.list.length : -1;
  }

  update(dt, serverNow) {
    if (this.stateId && performance.now() > this.nextRefresh) this.load(this.stateId);
    for (const p of this.panels.values()) {
      const idx = this.current(p, serverNow);
      if (idx !== p.shown) {
        // Quick blink between adverts, like a real rotating board.
        if (p.fade >= 1 && p.shown !== -1 && idx !== -1) p.fade = 0;
        if (p.fade >= 0.5 || p.shown === -1 || idx === -1) {
          p.shown = idx;
          const tex = idx >= 0 ? p.list[idx].tex : p.house;
          for (const m of p.mats) {
            m.map = tex;
            if (m.userData.ground) m.emissiveMap = tex;
            m.needsUpdate = true;
          }
        }
      }
      if (p.fade < 1) {
        p.fade = Math.min(1, p.fade + dt * 3);
        const k = Math.abs(p.fade - 0.5) * 2;
        const base = p.type === 'led' || p.type === 'ground' ? 1 : 0.92;
        for (const m of p.mats) m.color.setScalar(base * (0.15 + 0.85 * k));
      }
    }
  }

  // Billboards in view for advertiser analytics: in range, facing the camera, on screen, not blocked.
  visible(camera, index, lineBlocked, smokes) {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const out = [];
    const p = camera.position;
    const pt = new THREE.Vector3();
    for (const panel of this.panels.values()) {
      const radius = BOARD_TYPES[panel.type].viewRadius;
      const seen = panel.faces.some((f) => {
        const dx = f.x - p.x;
        const dz = f.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > radius) return false;
        if (f.ground) {
          // Floor art counts when seen from above (drone, rooftop) or close up.
          if (p.y / Math.max(1, d) < 0.18) return false;
          if (!frustum.containsPoint(pt.set(f.x, f.y, f.z))) return false;
          return !lineBlocked(index, p.x, p.y, p.z, f.x, f.y + 0.2, f.z, smokes);
        }
        if (dx * f.nx + dz * f.nz > 0) return false; // looking at the back
        if (!frustum.containsPoint(pt.set(f.x, f.y, f.z))) return false;
        return !lineBlocked(index, p.x, p.y, p.z, f.x + f.nx * 0.3, f.y, f.z + f.nz * 0.3, smokes);
      });
      if (seen) out.push(panel.id);
    }
    return out;
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
  }
}
