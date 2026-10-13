// What you see of the underworld: the domed hall, the cemetery (headstones, grave mounds,
// gate pillars), the domed mausoleum, the catacomb (tombs with heavy stone lids, bones),
// and lamps along the tunnel. Graves dug open show a pit, a dirt pile and a spade; tombs
// show their lid pushed aside, with a glint of what was inside.
import * as THREE from 'three';
import * as T from '../core/textures.js';

const hash = (x, z, k = 1) => Math.abs(Math.sin(x * 12.9898 * k + z * 78.233) * 43758.5453) % 1;

export class Underworld {
  constructor(scene, map, arena) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);
    const stone = T.stoneTexture();
    const plaster = T.plasterTexture();
    const mud = T.mudTexture();
    this.mats = {
      stone: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, color: '#c9c2b4', roughness: 0.9 }),
      marble: new THREE.MeshStandardMaterial({ map: plaster.map, color: '#e8e4dc', roughness: 0.55 }),
      darkStone: new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normalMap, color: '#8d867b', roughness: 0.95 }),
      dome: new THREE.MeshStandardMaterial({ map: plaster.map, color: '#d9cfbd', roughness: 0.8 }),
      domeGreen: new THREE.MeshStandardMaterial({ color: '#3f6f5a', roughness: 0.6, metalness: 0.3 }),
      gold: new THREE.MeshStandardMaterial({ color: '#d4a537', roughness: 0.3, metalness: 1 }),
      earth: new THREE.MeshStandardMaterial({ map: mud.map, color: '#7a5c40', roughness: 1 }),
      pit: new THREE.MeshBasicMaterial({ color: '#120d09' }),
      bone: new THREE.MeshStandardMaterial({ color: '#d8cfb8', roughness: 0.85 }),
      wood: new THREE.MeshStandardMaterial({ color: '#5a3d22', roughness: 0.9 }),
      steel: new THREE.MeshStandardMaterial({ color: '#8b9096', roughness: 0.4, metalness: 0.8 }),
      bulb: new THREE.MeshStandardMaterial({ color: '#fff3c8', emissive: '#ffcf7a', emissiveIntensity: 2.2 })
    };
    this.glowMat = new THREE.SpriteMaterial({ map: T.softDot(), color: '#ffcf7a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    this.graves = [];
    for (const v of map.visuals) {
      if (v.type === 'dome') this.dome(v);
      else if (v.type === 'mausoleum') this.mausoleum(v);
      else if (v.type === 'lamp') this.lamp(v);
      else if (v.type === 'catacomb') this.catacomb(v);
      else if (v.type === 'gatePosts' && v.gate) this.gate(v);
      else if (v.type === 'cave') this.cave(v);
    }
    for (const g of map.graves || []) this.graves.push(this.build(g));
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.position.y > -1;
        o.receiveShadow = true;
      }
    });
  }

  add(o, x, y, z) {
    o.position.set(x, y, z);
    this.group.add(o);
    return o;
  }

  // A big plastered hall crowned with a dome on a drum, a gold finial on top.
  dome(v) {
    const g = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(v.r * 0.82, v.r * 0.86, 1.1, 40, 1, true), this.mats.dome);
    drum.position.y = 0.55;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(v.r * 0.82, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.domeGreen);
    cap.position.y = 1.1;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(v.r * 0.84, 0.12, 8, 48), this.mats.dome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.1;
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.4, 8), this.mats.gold);
    fin.position.y = 1.1 + v.r * 0.82 + 0.6;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), this.mats.gold);
    ball.position.y = fin.position.y + 0.2;
    // Little arched windows round the drum.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.7), this.mats.pit);
      w.position.set(Math.sin(a) * v.r * 0.865, 0.55, Math.cos(a) * v.r * 0.865);
      w.rotation.y = a;
      g.add(w);
    }
    g.add(drum, cap, ring, fin, ball);
    this.add(g, v.x, v.h, v.z);
    // Cornice round the roof edge.
    const c = new THREE.Mesh(new THREE.BoxGeometry(v.w + 0.9, 0.3, v.w + 0.9), this.mats.dome);
    this.add(c, v.x, v.h + 0.05, v.z);
  }

  mausoleum(v) {
    const g = new THREE.Group();
    const r = Math.min(v.w, v.d) * 0.42;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.marble);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.5, 28), this.mats.marble);
    drum.position.y = 0.25;
    cap.position.y = 0.5;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), this.mats.gold);
    fin.position.y = 0.5 + r + 0.3;
    g.add(drum, cap, fin);
    this.add(g, v.x, v.h, v.z);
    // Two columns either side of the door.
    const doorZ = v.door === 'z0' ? v.z - v.d / 2 - 0.25 : v.z + v.d / 2 + 0.25;
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, v.h, 12), this.mats.marble);
      this.add(col, v.x + s * 1.05, v.h / 2, doorZ);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.35, 0.6), this.mats.marble);
    this.add(lintel, v.x, v.h - 0.1, doorZ);
  }

  gate(v) {
    for (const s of [-1, 1]) {
      const along = v.mid + s * 1.75;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), this.mats.stone);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.mats.stone);
      const x = v.alongX ? along : v.at;
      const z = v.alongX ? v.at : along;
      this.add(pillar, x, 0.9, z);
      this.add(cap, x, 1.95, z);
    }
  }

  lamp(v) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.mats.bulb);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4), this.mats.steel);
    wire.position.y = 0.17;
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(1.6);
    const g = new THREE.Group();
    g.add(bulb, wire, glow);
    this.add(g, v.x, v.y, v.z);
  }

  // Bones and skulls in the corners, old candles, dust.
  catacomb(v) {
    const skull = new THREE.SphereGeometry(0.11, 10, 8);
    const bone = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
    for (const [cx, cz] of [
      [v.x0 + 0.5, v.z0 + 1.3],
      [v.x1 - 0.5, v.z1 - 1.3],
      [v.x0 + 0.5, v.z1 - 1.3],
      [v.x1 - 0.5, v.z0 + 1.3]
    ]) {
      for (let k = 0; k < 5; k++) {
        const b = new THREE.Mesh(bone, this.mats.bone);
        b.rotation.set(Math.PI / 2, hash(cx, cz, k + 1) * 6, 0);
        this.add(b, cx + (hash(cz, cx, k) - 0.5) * 0.6, v.y + 0.04, cz + (hash(cx, k, 3) - 0.5) * 0.6);
      }
      const s = new THREE.Mesh(skull, this.mats.bone);
      s.scale.set(1, 0.9, 1.15);
      this.add(s, cx, v.y + 0.1, cz);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 8), this.mats.marble);
      this.add(candle, cx + 0.25, v.y + 0.11, cz);
      const flame = new THREE.Sprite(this.glowMat);
      flame.scale.setScalar(0.35);
      this.add(flame, cx + 0.25, v.y + 0.3, cz);
    }
  }

  build(g) {
    return g.kind === 'tomb' ? this.tomb(g) : g.kind === 'cache' ? this.chest(g) : this.grave(g);
  }

  // A cave: a lumpy rock hill over the hollow (whose walls and roof are the collision boxes),
  // stalactites, glowing crystals, and the dark mouth facing the middle of the map.
  cave(v) {
    const rock = T.rockTexture();
    // No normal map here: on the faceted boulders it turned the whole hill black on some GPUs.
    const mat = new THREE.MeshStandardMaterial({ map: rock.map, color: '#c2b49c', roughness: 0.95, flatShading: true });
    const inner = new THREE.MeshStandardMaterial({ map: rock.map, color: '#4e463d', roughness: 1, flatShading: true, side: THREE.BackSide });
    const g = new THREE.Group();
    g.position.set(v.x, 0, v.z);
    const seed = (k) => hash(v.x, v.z, k);
    // Outer shell: overlapping boulders following the walls and the roof.
    const hw = v.w / 2;
    const hd = v.d / 2;
    const geo = new THREE.DodecahedronGeometry(1, 1);
    const boulder = (x, y, z, s, k) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(s * (0.8 + seed(k) * 0.5), s * (0.7 + seed(k + 1) * 0.4), s * (0.8 + seed(k + 2) * 0.5));
      m.rotation.set(seed(k + 3) * 3, seed(k + 4) * 3, 0);
      g.add(m);
    };
    let k = 0;
    const doorOf = (x, z) => {
      if (v.door === 'x0') return x < -hw + 1 && Math.abs(z) < 2.2;
      if (v.door === 'x1') return x > hw - 1 && Math.abs(z) < 2.2;
      if (v.door === 'z0') return z < -hd + 1 && Math.abs(x) < 2.2;
      return z > hd - 1 && Math.abs(x) < 2.2;
    };
    for (let x = -hw; x <= hw; x += 2.6)
      for (const z of [-hd + 0.6, hd - 0.6]) if (!doorOf(x, z)) boulder(x, 1.8, z, 2.0, k++ * 7);
    for (let z = -hd + 2.6; z <= hd - 2.6; z += 2.6) for (const x of [-hw + 0.6, hw - 0.6]) if (!doorOf(x, z)) boulder(x, 1.8, z, 2.0, k++ * 7);
    for (let x = -hw + 2; x <= hw - 2; x += 3) for (let z = -hd + 2; z <= hd - 2; z += 3) boulder(x, v.h + 1.0 + seed(k) * 0.8, z, 2.4, k++ * 7);
    // Dark interior lining.
    // (No lining on the mouth side, so you can see in and out.)
    const hole = new THREE.MeshBasicMaterial({ visible: false });
    const faces = [inner, inner, inner, inner, inner, inner];
    faces[{ x1: 0, x0: 1, z1: 4, z0: 5 }[v.door]] = hole;
    const lining = new THREE.Mesh(new THREE.BoxGeometry(v.w - 2.9, v.h - 0.05, v.d - 2.9), faces);
    lining.position.y = v.h / 2;
    g.add(lining);
    // Stalactites and glowing crystals.
    const drip = new THREE.ConeGeometry(0.16, 0.9, 6).rotateX(Math.PI);
    for (let n = 0; n < 12; n++) {
      const m = new THREE.Mesh(drip, inner.clone());
      m.material.side = THREE.FrontSide;
      m.position.set((seed(n + 50) - 0.5) * (v.w - 4), v.h - 0.45, (seed(n + 70) - 0.5) * (v.d - 4));
      m.scale.y = 0.6 + seed(n + 90) * 0.9;
      g.add(m);
    }
    const crystalMat = [new THREE.MeshStandardMaterial({ color: '#5fe0ff', emissive: '#1fa8d8', emissiveIntensity: 1.6, roughness: 0.2 }), new THREE.MeshStandardMaterial({ color: '#c58cff', emissive: '#7a30d8', emissiveIntensity: 1.6, roughness: 0.2 })];
    for (let n = 0; n < 7; n++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), crystalMat[n % 2]);
      c.scale.y = 2.2;
      const wallX = (seed(n + 110) < 0.5 ? -1 : 1) * (hw - 1.6);
      c.position.set(n % 2 ? wallX : (seed(n + 130) - 0.5) * (v.w - 4), 0.35, n % 2 ? (seed(n + 150) - 0.5) * (v.d - 4) : (seed(n + 170) < 0.5 ? -1 : 1) * (hd - 1.6));
      c.rotation.z = (seed(n + 190) - 0.5) * 0.6;
      g.add(c);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.softDot(), color: n % 2 ? '#c58cff' : '#5fe0ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      glow.scale.setScalar(1.4);
      glow.position.copy(c.position);
      g.add(glow);
    }
    // Stalagmites (their collision boxes are in the map).
    for (const b of this.map.boxes) {
      if (!b.mite || Math.abs((b.x0 + b.x1) / 2 - v.x) > hw || Math.abs((b.z0 + b.z1) / 2 - v.z) > hd) continue;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.32, b.y1, 7), mat);
      m.position.set((b.x0 + b.x1) / 2 - v.x, b.y1 / 2, (b.z0 + b.z1) / 2 - v.z);
      g.add(m);
    }
    this.group.add(g);
  }

  // An old iron-bound chest half buried in the cave floor.
  chest(g) {
    const grp = new THREE.Group();
    grp.position.set(g.x, 0, g.z);
    grp.rotation.y = { x0: Math.PI / 2, x1: -Math.PI / 2, z0: 0, z1: Math.PI }[g.door] || 0;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), this.mats.wood);
    base.position.y = 0.27;
    const lid = new THREE.Group();
    lid.position.set(0, 0.55, 0.35);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), this.mats.wood);
    top.position.set(0, 0, -0.35);
    lid.add(top);
    for (const x of [-0.42, 0.42]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.58, 0.72), this.mats.steel);
      band.position.set(x, 0.28, 0);
      grp.add(band);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.05), this.mats.gold);
    lock.position.set(0, 0.48, -0.37);
    grp.add(base, lid, lock);
    this.group.add(grp);
    return { g, grp, lid, chest: true, dug: false };
  }

  // A grave: an earth mound with a headstone in one of a few styles.
  grave(g) {
    const grp = new THREE.Group();
    grp.position.set(g.x, 0, g.z);
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.earth);
    mound.scale.set(0.5, 0.28, 1.0);
    mound.position.z = 0.1;
    grp.add(mound);
    const st = this.mats[g.style === 1 ? 'marble' : 'stone'];
    let head;
    if (g.style === 0) {
      head = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.14), st);
      slab.position.y = 0.3;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 16, 1, false, 0, Math.PI), st);
      top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      top.position.y = 0.6;
      head.add(slab, top);
    } else if (g.style === 1) {
      head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.15), st);
      head.position.y = 0.42;
    } else if (g.style === 2) {
      head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 1.1, 4), st);
      head.position.y = 0.55;
      head.rotation.y = Math.PI / 4;
    } else {
      head = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.08), this.mats.wood);
      post.position.y = 0.42;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.06), this.mats.wood);
      board.position.y = 0.62;
      head.add(post, board);
    }
    head.position.z = -1.17;
    grp.add(head);
    this.group.add(grp);
    return { g, grp, mound, dug: false };
  }

  // A catacomb tomb: stone chest with a heavy lid.
  tomb(g) {
    const s = g.slab;
    const grp = new THREE.Group();
    grp.position.set(s.x, g.y, s.z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.72, 1.0), this.mats.darkStone);
    base.position.y = 0.36;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 1.08), this.mats.stone);
    lid.position.y = 0.79;
    const carve = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.5), this.mats.darkStone);
    carve.position.y = 0.87;
    lid.add(carve);
    carve.position.set(0, 0.08, 0);
    grp.add(base, lid);
    this.group.add(grp);
    return { g, grp, lid, dug: false };
  }

  // Opened by someone (or already open when you join).
  open(i, loot, instant = false) {
    const e = this.graves[i];
    if (!e || e.dug) return;
    e.dug = true;
    if (e.g.kind !== 'grave') {
      e.lidT = instant ? 1 : 0;
      if (instant) this.placeLid(e, 1);
    } else {
      e.mound.visible = false;
      const pit = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.9), this.mats.pit);
      pit.rotation.x = -Math.PI / 2;
      pit.position.set(0, 0.03, 0.1);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 6, 16), this.mats.earth);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(0.85, 1.6, 1);
      rim.position.set(0, 0.04, 0.1);
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.earth);
      pile.scale.set(1, 0.6, 1.3);
      pile.position.set(1.0, 0, 0.3);
      const spade = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), this.mats.wood);
      shaft.position.y = 0.5;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.02), this.mats.steel);
      blade.position.y = -0.02;
      spade.add(shaft, blade);
      spade.rotation.z = 0.25;
      spade.position.set(1.05, 0.3, 0.2);
      e.grp.add(pit, rim, pile, spade);
    }
    e.loot = loot;
  }

  placeLid(e, k) {
    if (e.chest) {
      e.lid.rotation.x = -1.9 * k; // hinged open
      return;
    }
    // Pushed aside and tipped against the base.
    e.lid.position.set(0.95 * k, 0.79 - 0.5 * k, 0.15 * k);
    e.lid.rotation.set(0, 0.25 * k, -0.5 * k);
  }

  // Lids grinding open.
  update(dt) {
    for (const e of this.graves) {
      if (e.g.kind === 'grave' || !e.dug || e.lidT >= 1) continue;
      e.lidT = Math.min(1, e.lidT + dt * 1.4);
      this.placeLid(e, e.lidT * e.lidT * (3 - 2 * e.lidT));
    }
  }

  // The grave or tomb you could dig from here (not yet dug).
  near(x, y, z, reach) {
    let best = null;
    let bd = reach;
    for (const e of this.graves) {
      if (e.dug) continue;
      const d = Math.hypot(e.g.x - x, e.g.z - z);
      if (d < bd && Math.abs(y - e.g.y) < 1.3) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  reset() {
    for (const [k, e] of this.graves.entries()) {
      if (!e.dug) continue;
      this.group.remove(e.grp);
      this.graves[k] = this.build(e.g);
    }
  }
}
