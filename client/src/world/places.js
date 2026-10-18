// The lived-in parts of each battlefield: river banks and bridges, the old rail yard with
// abandoned wagons, the live railway on a viaduct outside the wall (trains run on a schedule
// shared by every player), warehouses and burnt-out abandoned houses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../shared/rng.js';
import * as T from '../core/textures.js';
import { audio } from '../core/audio.js';

const TRAIN = { period: 110, speed: 26, run: 380, cars: 9, carLen: 14.5 };

function mat(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.2, ...opts });
}

function graffitiTexture(text, colour, seed) {
  const [c, ctx] = T.makeCanvas(512, 256);
  const rng = mulberry32(seed);
  ctx.translate(256, 128);
  ctx.rotate((rng() - 0.5) * 0.15);
  ctx.font = `400 ${70 + rng() * 30}px "Black Ops One", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 0, 0, 480);
  ctx.fillStyle = colour;
  ctx.fillText(text, 0, 0, 480);
  // Paint drips.
  ctx.fillStyle = colour;
  for (let i = 0; i < 9; i++) ctx.fillRect(-220 + rng() * 440, 20 + rng() * 20, 4, 20 + rng() * 50);
  return T.toTexture(c, { repeat: false });
}

const GRAFFITI = ['NO GO AREA', 'STAY ALERT', 'POWER OUT AGAIN', 'POD', 'HOLD THE LINE', 'NO SURRENDER', 'SOLDIER ON', 'NEVER LAST'];

export class Places {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rng = mulberry32(map.seed ^ 0x9a11);
    this.rust = T.rustTexture();
    this.metal = T.metalTexture();
    this.zinc = T.zincTexture();
    this.conc = T.concreteTexture();
    this.plank = T.plankTexture();
    for (const v of map.visuals) {
      if (v.type === 'riverbank') this.riverbank(v);
      else if (v.type === 'bridgeRails') this.bridgeRails(v);
      else if (v.type === 'rails') this.rails(v);
      else if (v.type === 'wagon') this.wagon(v);
      else if (v.type === 'viaduct') this.viaduct(v);
      else if (v.type === 'warehouse') this.warehouse(v);
      else if (v.type === 'ruin') this.ruin(v);
    }
  }

  // ---------- river ----------
  riverbank(v) {
    const rng = this.rng;
    const half = this.map.half;
    const mud = mat({ color: v.lush ? '#4a3a26' : '#8a6f4c', roughness: 1, map: this.conc.map, polygonOffset: true, polygonOffsetFactor: -1 });
    for (const [x0, x1] of [
      [v.x0 - 2.4, v.x0],
      [v.x1, v.x1 + 2.4]
    ]) {
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, half * 2).rotateX(-Math.PI / 2), mud);
      bank.position.set((x0 + x1) / 2, 0.015, 0);
      bank.receiveShadow = true;
      this.group.add(bank);
    }
    // Reeds and river stones along both banks.
    const blade = new THREE.PlaneGeometry(0.7, 1.7).translate(0, 0.85, 0);
    const tuft = mergeGeometries([blade, blade.clone().rotateY(Math.PI / 2)]);
    const reedMat = new THREE.MeshStandardMaterial({ map: T.grassCard(), color: v.lush ? '#8fae5a' : '#b8a66a', alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    const n = v.lush ? 260 : 120;
    const reeds = new THREE.InstancedMesh(tuft, reedMat, n);
    const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.45, 0), mat({ color: '#6d6a63', roughness: 0.95, map: this.conc.map }), 70);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const x = left ? v.x0 - rng() * 2.2 + 0.4 : v.x1 + rng() * 2.2 - 0.4;
      const z = (rng() * 2 - 1) * (half - 2);
      const s = 0.7 + rng() * 0.7;
      m4.compose(p.set(x, -0.25, z), q.setFromAxisAngle(up, rng() * 6.28), sc.set(s, s, s));
      reeds.setMatrixAt(i, m4);
    }
    for (let i = 0; i < 70; i++) {
      const left = i % 2 === 0;
      const x = left ? v.x0 - rng() * 2 : v.x1 + rng() * 2;
      const z = (rng() * 2 - 1) * (half - 2);
      const s = 0.4 + rng() * 0.9;
      m4.compose(p.set(x, -0.05, z), q.setFromAxisAngle(up, rng() * 6.28), sc.set(s, s * 0.55, s * 0.8));
      stones.setMatrixAt(i, m4);
    }
    stones.castShadow = stones.receiveShadow = true;
    this.group.add(reeds, stones);
  }

  bridgeRails(v) {
    const wood = mat({ map: this.plank.map, color: '#8b6b47', roughness: 0.9 });
    const len = v.x1 - v.x0;
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.12), wood);
      rail.position.set((v.x0 + v.x1) / 2, 1.0, v.z + side * (v.half - 0.1));
      rail.castShadow = true;
      this.group.add(rail);
      for (let x = v.x0 + 0.3; x <= v.x1; x += 1.6) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), wood);
        post.position.set(x, 0.5, v.z + side * (v.half - 0.1));
        this.group.add(post);
      }
    }
  }

  // ---------- old rail yard ----------
  rails(v) {
    const len = v.x1 - v.x0;
    const cx = (v.x0 + v.x1) / 2;
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 3.6), mat({ color: '#6e6a62', map: this.conc.map, roughness: 1 }));
    ballast.position.set(cx, 0.02, v.z);
    ballast.receiveShadow = true;
    this.group.add(ballast);
    const sleeperGeo = new THREE.BoxGeometry(0.26, 0.12, 2.6);
    const n = Math.floor(len / 0.75);
    const sleepers = new THREE.InstancedMesh(sleeperGeo, mat({ map: this.plank.map, color: '#5a4630', roughness: 0.95 }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m4.makeRotationY((this.rng() - 0.5) * 0.08);
      m4.setPosition(v.x0 + i * 0.75, 0.13, v.z);
      sleepers.setMatrixAt(i, m4);
    }
    sleepers.receiveShadow = true;
    this.group.add(sleepers);
    const steel = mat({ map: this.rust.map, color: '#8a7462', metalness: 0.6, roughness: 0.55 });
    for (const s of [-0.72, 0.72]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.09), steel);
      r.position.set(cx, 0.24, v.z + s);
      this.group.add(r);
    }
  }

  wheels(x, z, L, y, steel) {
    const geo = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 16).rotateX(Math.PI / 2);
    for (const bx of [-L / 2 + 1.8, L / 2 - 1.8])
      for (const wx of [-0.75, 0.75])
        for (const wz of [-0.72, 0.72]) {
          const w = new THREE.Mesh(geo, steel);
          w.position.set(x + bx + wx, y + 0.46, z + wz);
          this.group.add(w);
        }
  }

  wagon(v) {
    const g = new THREE.Group();
    g.position.set(v.x, 0, v.z);
    // (kept level so the details line up with the collision box)
    const steel = mat({ color: '#2b2622', metalness: 0.7, roughness: 0.5 });
    const rusty = mat({ map: this.rust.map, color: '#9a6a4a', roughness: 0.85, metalness: 0.4 });
    this.group.add(g);
    this.wheels(v.x, v.z, v.L, 0.2, steel);
    if (v.style === 'tanker') {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, v.L - 0.8, 24).rotateZ(Math.PI / 2), mat({ map: this.rust.map, color: '#3a3532', metalness: 0.6, roughness: 0.55 }));
      tank.position.y = 1.75;
      tank.castShadow = tank.receiveShadow = true;
      g.add(tank);
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.4, 14), steel);
      dome.position.y = 3.15;
      g.add(dome);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: T.labelTexture('PMS · FLAMMABLE', { w: 512, h: 128, size: 60, colour: '#ffcf3a' }), transparent: true }));
      label.position.set(0, 1.85, 1.37);
      g.add(label);
    } else if (v.style === 'loco') {
      const livery = mat({ color: '#2d6b3f', map: this.metal.map, roughness: 0.6, metalness: 0.35 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(v.L - 3.5, 2.7, 2.6), livery);
      body.position.set(-1.6, 2.15, 0);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 2.9), livery);
      cab.position.set(v.L / 2 - 1.8, 2.5, 0);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(v.L - 0.2, 0.35, 2.95), mat({ color: '#d8a21a', roughness: 0.6 }));
      stripe.position.set(0, 1.5, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 2.3), mat({ color: '#10161c', metalness: 0.8, roughness: 0.15 }));
      glass.position.set(v.L / 2 - 0.1, 3.35, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(v.L, 0.5, 2.9), steel);
      frame.position.y = 0.95;
      for (const m of [body, cab, stripe, glass, frame]) {
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      const num = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), new THREE.MeshBasicMaterial({ map: T.labelTexture('NRC 2071', { w: 512, h: 128, size: 64, colour: '#f2efe2' }), transparent: true }));
      num.position.set(v.L / 2 - 1.8, 3.2, 1.46);
      g.add(num);
    } else {
      // Boxcar / flatcar: the body is the collision box; add ribs, doors, ladder and chassis.
      const frame = new THREE.Mesh(new THREE.BoxGeometry(v.L + 0.4, 0.35, 3.0), steel);
      frame.position.y = 0.92;
      g.add(frame);
      if (v.style === 'boxcar') {
        for (let x = -v.L / 2 + 0.6; x < v.L / 2; x += 1.15)
          for (const s of [-1, 1]) {
            const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, v.h - 1.1, 0.06), rusty);
            rib.position.set(x, 1.1 + (v.h - 1.1) / 2, s * 1.48);
            g.add(rib);
          }
        for (const s of [-1, 1]) {
          const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, v.h - 1.3, 0.08), mat({ map: this.rust.map, color: '#6f4a33', roughness: 0.9 }));
          door.position.set(0.4 * s, 1.15 + (v.h - 1.3) / 2, s * 1.52);
          g.add(door);
        }
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshBasicMaterial({ map: graffitiTexture(GRAFFITI[Math.floor(this.rng() * GRAFFITI.length)], ['#ff4fd8', '#3fe0ff', '#ffd23f', '#7cff6b'][Math.floor(this.rng() * 4)], Math.floor(this.rng() * 1e6)), transparent: true, depthWrite: false }));
        tag.position.set(-v.L / 4, 2.1, 1.56);
        g.add(tag);
      }
    }
  }

  // ---------- live railway on a viaduct outside the wall ----------
  viaduct(v) {
    const deckY = this.map.biome === 'urban' ? 16 : 7.5;
    this.trainY = deckY + 0.6;
    this.trainZ = v.z;
    const concrete = mat({ map: this.conc.map, color: '#a8a39a', roughness: 0.95 });
    const L = 900;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 1.1, 6), concrete);
    deck.position.set(0, deckY, v.z);
    deck.castShadow = deck.receiveShadow = true;
    this.group.add(deck);
    const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, deckY, 3.4), concrete, Math.ceil(L / 28));
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < pillars.count; i++) {
      m4.makeTranslation(-L / 2 + i * 28, deckY / 2 - 0.5, v.z);
      pillars.setMatrixAt(i, m4);
    }
    pillars.castShadow = true;
    this.group.add(pillars);
    const steel = mat({ color: '#6c6862', metalness: 0.8, roughness: 0.4 });
    for (const s of [-0.72, 0.72]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 0.09), steel);
      r.position.set(0, deckY + 0.62, v.z + s);
      this.group.add(r);
    }
    // Catenary posts.
    for (let x = -L / 2; x <= L / 2; x += 40) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), steel);
      post.position.set(x, deckY + 3.5, v.z + 2.6);
      this.group.add(post);
    }
    this.buildTrain();
  }

  buildTrain() {
    const t = new THREE.Group();
    const paint = [mat({ color: '#2d6b3f', map: this.metal.map, metalness: 0.4, roughness: 0.5 }), mat({ color: '#7d2b22', map: this.rust.map, metalness: 0.4, roughness: 0.6 }), mat({ color: '#3d4a5a', map: this.metal.map, metalness: 0.5, roughness: 0.5 })];
    const steel = mat({ color: '#222', metalness: 0.7, roughness: 0.5 });
    const yellow = mat({ color: '#d8a21a', roughness: 0.5 });
    const glass = mat({ color: '#0e141a', metalness: 0.9, roughness: 0.1, emissive: '#1a2a38', emissiveIntensity: 0.3 });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff6cc' });
    this.cars = [];
    for (let i = 0; i < TRAIN.cars; i++) {
      const car = new THREE.Group();
      const loco = i === 0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(TRAIN.carLen - 0.8, loco ? 3.6 : 3.3, 2.9), loco ? paint[0] : paint[1 + (i % 2)]);
      body.position.y = loco ? 2.3 : 2.15;
      body.castShadow = true;
      car.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(TRAIN.carLen - 0.7, 0.3, 2.95), yellow);
      band.position.y = 1.2;
      car.add(band);
      const under = new THREE.Mesh(new THREE.BoxGeometry(TRAIN.carLen - 1, 0.6, 2.4), steel);
      under.position.y = 0.4;
      car.add(under);
      if (loco) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 2.4), glass);
        w.position.set(TRAIN.carLen / 2 - 0.35, 3.2, 0);
        car.add(w);
        for (const s of [-0.8, 0.8]) {
          const l = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12).rotateY(Math.PI / 2), lamp);
          l.position.set(TRAIN.carLen / 2 - 0.34, 1.6, s);
          car.add(l);
        }
      } else {
        for (let k = -2; k <= 2; k++)
          for (const s of [-1, 1]) {
            const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), glass);
            w.position.set(k * 2.5, 2.8, s * 1.46);
            w.rotation.y = s > 0 ? 0 : Math.PI;
            car.add(w);
          }
      }
      t.add(car);
      this.cars.push(car);
    }
    t.visible = false;
    this.train = t;
    this.group.add(t);
    this.hornCycle = -1;
  }

  // Every player sees the same train at the same moment (driven by server time).
  update(dt, serverNow) {
    if (!this.train) return;
    const phaseOffset = (this.map.seed % 97) + 0.5;
    const tt = serverNow / 1000 + phaseOffset;
    const cycle = Math.floor(tt / TRAIN.period);
    const phase = tt - cycle * TRAIN.period;
    const travel = (TRAIN.run * 2 + TRAIN.cars * TRAIN.carLen) / TRAIN.speed;
    const running = phase < travel;
    this.train.visible = running;
    if (!running) {
      if (this.trainOn) {
        this.trainOn = false;
        audio.train?.(false);
      }
      return;
    }
    const dir = cycle % 2 ? -1 : 1;
    const head = -dir * TRAIN.run + dir * phase * TRAIN.speed;
    this.cars.forEach((c, i) => {
      c.position.set(head - dir * i * TRAIN.carLen, this.trainY, this.trainZ);
      c.rotation.y = dir > 0 ? 0 : Math.PI;
    });
    const mid = new THREE.Vector3(head - dir * TRAIN.carLen * 2, this.trainY + 2, this.trainZ);
    if (!this.trainOn) {
      this.trainOn = true;
      audio.train?.(true);
    }
    audio.moveTrain?.(mid);
    if (this.hornCycle !== cycle && Math.abs(head) < 160) {
      this.hornCycle = cycle;
      audio.horn?.(mid);
    }
  }

  // ---------- warehouse ----------
  warehouse(v) {
    const g = new THREE.Group();
    g.position.set(v.x, 0, v.z);
    if (!v.alongX) g.rotation.y = Math.PI / 2;
    const L = v.alongX ? v.w : v.d;
    const D = v.alongX ? v.d : v.w;
    const zincTex = this.zinc.map.clone();
    zincTex.wrapS = zincTex.wrapT = THREE.RepeatWrapping;
    zincTex.repeat.set(L / 3, 2);
    zincTex.needsUpdate = true;
    const roofMat = mat({ map: zincTex, normalMap: this.zinc.normalMap, color: '#9aa2a8', metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
    const rise = 2.2;
    const slope = Math.hypot(D / 2 + 0.4, rise);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.8, slope), roofMat);
      r.rotation.x = -Math.PI / 2 + s * Math.atan2(rise, D / 2 + 0.4);
      r.position.set(0, v.h + rise / 2, (s * (D / 2 + 0.4)) / 2);
      r.castShadow = r.receiveShadow = true;
      g.add(r);
    }
    // Gable ends.
    const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, rise)]);
    const gableMat = mat({ map: this.zinc.map, color: '#8d969c', metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const gab = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat);
      gab.rotation.y = Math.PI / 2;
      gab.position.set((s * L) / 2, v.h, 0);
      g.add(gab);
    }
    // Steel trusses and hanging lamps inside.
    const steel = mat({ color: '#3a3d40', metalness: 0.7, roughness: 0.5 });
    for (let x = -L / 2 + 3; x < L / 2 - 1; x += 4.5) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, D), steel);
      beam.position.set(x, v.h - 0.2, 0);
      g.add(beam);
      const lampMesh = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 12, 1, true), mat({ color: '#2a2a2a', emissive: '#fff1c8', emissiveIntensity: 1.6, side: THREE.DoubleSide }));
      lampMesh.position.set(x, v.h - 1.4, 0);
      g.add(lampMesh);
    }
    // Hazard stripes over the loading doors and a sign on the long wall.
    const stripeTex = (() => {
      const [c, ctx] = T.makeCanvas(256, 32);
      for (let i = -2; i < 20; i++) {
        ctx.fillStyle = i % 2 ? '#111' : '#f2c200';
        ctx.beginPath();
        ctx.moveTo(i * 16, 32);
        ctx.lineTo(i * 16 + 16, 32);
        ctx.lineTo(i * 16 + 32, 0);
        ctx.lineTo(i * 16 + 16, 0);
        ctx.fill();
      }
      return T.toTexture(c, { repeat: false });
    })();
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.45), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 }));
      st.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      st.position.set(s * (L / 2 + 0.02), 5.25, 0);
      g.add(st);
    }
    const num = 1 + Math.floor(this.rng() * 9);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.4), new THREE.MeshStandardMaterial({ map: T.labelTexture([`WAREHOUSE ${num}`], { w: 1024, h: 200, size: 120, colour: '#f2efe6', bg: '#1d3b5a', stroke: false }), roughness: 0.7 }));
    sign.position.set(0, v.h - 1.3, -(D / 2 + 0.03));
    sign.rotation.y = Math.PI;
    g.add(sign);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: graffitiTexture(GRAFFITI[num % GRAFFITI.length], '#ff4fd8', v.seed), transparent: true, depthWrite: false }));
    tag.position.set(L / 5, 1.8, D / 2 + 0.03);
    g.add(tag);
    this.group.add(g);
  }

  // ---------- abandoned house ----------
  ruin(v) {
    const rng = mulberry32(v.seed);
    // Scorched floor and fallen, charred roof beams.
    const [c, ctx] = T.makeCanvas(256);
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, 'rgba(10,8,6,0.85)');
    grad.addColorStop(1, 'rgba(10,8,6,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(v.w * 0.9, v.d * 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.toTexture(c, { repeat: false }), transparent: true, depthWrite: false }));
    scorch.position.set(v.x, 0.03, v.z);
    this.group.add(scorch);
    const charred = mat({ color: '#1e1914', map: this.plank.map, roughness: 1 });
    for (let k = 0; k < 3; k++) {
      const len = 2.5 + rng() * 3;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, len), charred);
      beam.position.set(v.x + (rng() - 0.5) * v.w * 0.6, 0.6 + rng() * 0.8, v.z + (rng() - 0.5) * v.d * 0.6);
      beam.rotation.set(0.3 + rng() * 0.5, rng() * 3, (rng() - 0.5) * 0.4);
      beam.castShadow = true;
      this.group.add(beam);
    }
    // Graffiti on an outside wall.
    const side = Math.floor(rng() * 4);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: graffitiTexture(GRAFFITI[Math.floor(rng() * GRAFFITI.length)], ['#ff4fd8', '#3fe0ff', '#ffd23f', '#ffffff'][Math.floor(rng() * 4)], v.seed), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const off = [
      [0, -(v.d / 2 + 0.02), Math.PI],
      [v.w / 2 + 0.02, 0, Math.PI / 2],
      [0, v.d / 2 + 0.02, 0],
      [-(v.w / 2 + 0.02), 0, -Math.PI / 2]
    ][side];
    tag.position.set(v.x + off[0], 0.95, v.z + off[1]);
    tag.rotation.y = off[2];
    this.group.add(tag);
  }

  dispose() {
    audio.train?.(false);
    this.scene.remove(this.group);
  }
}
