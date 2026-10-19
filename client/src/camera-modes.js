// Camera modes on top of the normal first-person view:
//  - Chase cam (H): third person over the shoulder. You still fight; shots leave from your
//    own eyes toward whatever is under the crosshair, so the server's checks stay the same.
//  - Scout drone (T): fly a camera drone over the battlefield with a cockpit display.
//    Your soldier stays put (and can be shot), so scouting has a cost. The battery drains
//    while flying and recharges after; it is unlimited while your side's recon drone
//    streak is up, and while you are dead and waiting to come back.
import * as THREE from 'three';
import { raycast, dirFromAngles, hitSoldier, lineBlocked } from '../../shared/physics.js';
import { audio } from './core/audio.js';
import { WEAPONS, MODES } from '../../shared/config.js';
import { VEHICLES } from '../../shared/vehicles.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// While you wait to come back, the drone tours the adverts in this battlefield.
export const TOUR = { dwell: 5.5, fly: 1.5, idleResume: 5 };
const lerpA = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export const DRONE = { battery: 30, recharge: 1 / 2.5, speed: 20, boost: 34, minAlt: 14, maxAlt: 75, startAlt: 38, range: 40 };

export class CameraModes {
  constructor(game) {
    this.g = game;
    this.mode = 'fp';
    this.chase = false; // remembered preference for the soldier view
    this.battery = DRONE.battery;
    this.drone = null;
    this.ray = new THREE.Raycaster();
    // Your saved choice in Settings: hands only (first person, default) or full body.
    this.chase = game.settings?.view === 'chase';
    if (this.chase) this.mode = 'chase';
    // BRD: the assassin drone view from above, all match long.
    this.top = !!MODES[game.modeId]?.topDown;
    if (this.top) this.mode = 'top';
    this.climb = 0;
    // Touch buttons on the drone display.
    const hold = (id, v) => {
      const el = $(id);
      if (!el) return;
      el.onpointerdown = (e) => {
        e.preventDefault();
        this.climb = v;
      };
      el.onpointerup = el.onpointercancel = el.onpointerleave = () => (this.climb = 0);
    };
    hold('dr-up', 1);
    hold('dr-down', -1);
    if ($('dr-exit')) $('dr-exit').onclick = () => this.exitDrone();
  }

  // ---------- switching ----------
  toggleChase() {
    if (this.mode === 'drone' || this.top) return;
    this.setView(this.chase ? 'fp' : 'chase');
    this.g.hud.toast(this.chase ? 'Full body view (H to switch back)' : 'Hands only view (H for full body)', 'info', 1400);
  }

  setView(view) {
    this.chase = view === 'chase';
    if (this.mode !== 'drone' && !this.top) this.mode = this.chase ? 'chase' : 'fp';
    if (this.g.settings) {
      this.g.settings.view = this.chase ? 'chase' : 'fp';
      this.g.saveSettings?.();
    }
  }

  unlimited() {
    const g = this.g;
    return g.status === 'dead' || g.status === 'medevac' || g.uavUntil > g.net.serverNow();
  }

  // The advert tour: every billboard, LED screen, wall banner and floor tile in turn,
  // paying advertisers first. Moving the drone yourself pauses it for a few seconds.
  startTour() {
    if (this.mode !== 'drone') this.toggleDrone();
    if (this.mode !== 'drone') return;
    const panels = [...(this.g.boards?.panels?.values() || [])];
    const paid = panels.filter((p) => p.list.some((a) => a.chat));
    const withAds = panels.filter((p) => p.list.length && !paid.includes(p));
    const rest = panels.filter((p) => !p.list.length);
    const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    // Paid boards first, then other adverts, then the empty boards ("your brand here").
    const list = [...shuffle(paid), ...shuffle(withAds), ...(paid.length + withAds.length ? [] : shuffle(rest).slice(0, 8))];
    if (!list.length) return;
    this.g.input.takeLook(); // forget mouse movement from before the tour
    this.tour = { list, i: -1, t: TOUR.dwell, from: null, to: null, touched: 0, started: performance.now() };
  }

  stopTour() {
    this.tour = null;
  }

  // Where to hover to see an advert well.
  tourView(panel) {
    const g = this.g;
    const f = panel.faces[0];
    const b = g.map.billboards.find((x) => x.id === panel.id);
    let pos;
    if (panel.type === 'ground') {
      const side = f.x < 0 ? -1 : 1;
      pos = new THREE.Vector3(f.x - side * 7, 16, f.z + 2);
    } else {
      // Try a few spots in front of it and keep the first one with a clear view.
      const w = b?.w || 3.2;
      const tries = [];
      for (const k of [0.9, 1.3, 1.8]) for (const up of [panel.type === 'wall' ? 1.0 : 1.2, 3]) tries.push([Math.max(4.2, w * k), up]);
      pos = null;
      for (const [dist, up] of tries) {
        const p = new THREE.Vector3(f.x + f.nx * dist, f.y + up, f.z + f.nz * dist);
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const dz = f.z - p.z;
        const len = Math.hypot(dx, dy, dz);
        const hit = raycast(g.map.index, p.x, p.y, p.z, dx / len, dy / len, dz / len, len);
        if (hit.t >= len - 0.6) {
          pos = p;
          break;
        }
      }
      pos ||= new THREE.Vector3(f.x + f.nx * Math.max(4.2, w * 0.9), f.y + 1.2, f.z + f.nz * Math.max(4.2, w * 0.9));
    }
    const dx = f.x - pos.x;
    const dy = f.y - pos.y;
    const dz = f.z - pos.z;
    return { pos, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  tourPanel() {
    const t = this.tour;
    return t && t.i >= 0 && !this.tourPaused() ? t.list[t.i] : null;
  }

  // You took the controls in the last few seconds (ignoring the first second after starting).
  tourPaused() {
    const t = this.tour;
    return !!t && performance.now() - t.touched < TOUR.idleResume * 1000;
  }

  touchTour() {
    const t = this.tour;
    if (t && performance.now() - t.started > 1000) t.touched = performance.now();
  }

  flyTour(dt, d, manual) {
    const t = this.tour;
    if (manual) this.touchTour();
    if (this.tourPaused()) return false;
    t.t += dt;
    if (t.t >= TOUR.dwell + TOUR.fly || !t.to) {
      t.i = (t.i + 1) % t.list.length;
      t.t = 0;
      t.from = { pos: new THREE.Vector3(d.x, d.y, d.z), yaw: d.yaw, pitch: d.pitch };
      t.to = this.tourView(t.list[t.i]);
    }
    const k = Math.min(1, t.t / TOUR.fly);
    const e = k * k * (3 - 2 * k);
    const p = t.from.pos.clone().lerp(t.to.pos, e);
    // Rise a little mid-flight so we don't clip roofs.
    p.y += Math.sin(e * Math.PI) * 6;
    d.x = p.x;
    d.y = p.y;
    d.z = p.z;
    d.alt = Math.max(DRONE.minAlt, Math.min(DRONE.maxAlt, p.y));
    d.yaw = lerpA(t.from.yaw, t.to.yaw, e);
    d.pitch = t.from.pitch + (t.to.pitch - t.from.pitch) * e;
    d.vx = d.vz = 0;
    return true;
  }

  toggleDrone() {
    if (this.mode === 'drone') return this.exitDrone();
    const g = this.g;
    if (this.top && g.status === 'alive') return;
    if (!['alive', 'dead', 'medevac'].includes(g.status)) return;
    if (!this.unlimited() && this.battery < 5) return g.hud.toast(`Drone battery charging (${Math.round((this.battery / DRONE.battery) * 100)}%)`, 'bad', 1600);
    const b = g.body;
    this.drone = { x: b.x, z: b.z, y: b.y + 3, alt: DRONE.startAlt, yaw: g.yaw, pitch: -0.95, vx: 0, vz: 0, t: 0 };
    this.mode = 'drone';
    g.adsOn = false;
    $('drone-hud').hidden = false;
    document.body.classList.add('drone-on');
    if (!g.touch && g.status !== 'alive') g.input.lock();
    audio.drone?.(true);
    g.touchKey = null;
    g.hud.toast(g.status === 'alive' ? 'Drone in the air. Your body is still on the ground, watch your back!' : 'Spectator drone: look round while you wait', 'info', 2200);
  }

  exitDrone(reason) {
    if (this.mode !== 'drone') return;
    this.mode = this.top ? 'top' : this.chase ? 'chase' : 'fp';
    this.drone = null;
    this.tour = null;
    $('drone-hud').hidden = true;
    document.body.classList.remove('drone-on');
    audio.drone?.(false);
    if (!this.g.touch && this.g.status === 'dead') this.g.input.unlock();
    this.g.touchKey = null;
    if (reason) this.g.hud.toast(reason, 'bad', 1800);
  }

  onHurt() {
    if (this.mode === 'drone' && this.g.status === 'alive') this.exitDrone('Drone signal lost: you are under fire!');
  }

  onStatus(now) {
    if (this.mode === 'drone' && (now === 'downed' || now === 'spirit')) this.exitDrone();
    if (this.mode === 'drone' && now === 'alive' && this.prevStatus && this.prevStatus !== 'alive') this.exitDrone();
    this.prevStatus = now;
  }

  // Chase cam is on (a sniper scope switches back to your own eyes while aiming).
  thirdPerson() {
    const g = this.g;
    if (this.top) return ['alive', 'downed'].includes(g.status);
    if (g.driving?.active) return g.status === 'alive';
    return this.mode === 'chase' && !(g.adsOn && WEAPONS[g.weapon()]?.zoom) && ['alive', 'downed'].includes(g.status);
  }

  blocksMovement() {
    return this.mode === 'drone';
  }

  blocksFire() {
    return this.mode === 'drone';
  }

  // ---------- per frame ----------
  look(look, zoom) {
    if (this.mode !== 'drone') return false;
    const d = this.drone;
    if (this.tour && Math.abs(look.yaw) + Math.abs(look.pitch) > 0.004) this.touchTour();
    d.yaw += look.yaw / zoom;
    d.pitch = clamp(d.pitch + look.pitch / zoom, -1.55, 0.35);
    return true;
  }

  // Positions the camera for chase cam or drone; returns false for normal first person.
  apply(dt, now) {
    const g = this.g;
    const cam = g.camera;
    if (this.mode === 'drone') return this.flyDrone(dt, cam);
    if (this.top) return this.topCam(dt, cam);
    // Battery recharges whenever the drone is parked.
    this.battery = Math.min(DRONE.battery, this.battery + dt * DRONE.recharge);
    if (!this.thirdPerson()) {
      this.smooth = null;
      return false;
    }
    if (g.driving?.active) return this.driveCam(dt, cam);
    const b = g.body;
    const eye = new THREE.Vector3(b.x, b.y + g.eye, b.z);
    const pitch = g.pitch + g.punch.p;
    const yaw = g.yaw + g.punch.y;
    const fwd = new THREE.Vector3(...dirFromAngles(yaw, pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const ads = g.adsOn;
    // Over the right shoulder, far enough right that your body never covers the crosshair.
    const back = ads ? 1.5 : 2.7;
    const want = eye.clone().addScaledVector(fwd, -back).addScaledVector(right, ads ? 0.7 : 1.05).add(new THREE.Vector3(0, ads ? 0.18 : 0.42, 0));
    // Pull in when a wall is behind us.
    const dir = want.clone().sub(eye);
    const len = dir.length();
    dir.normalize();
    const hit = raycast(g.map.index, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, len + 0.3);
    const dist = Math.max(0.35, Math.min(len, hit.t - 0.3));
    const target = eye.clone().addScaledVector(dir, dist);
    this.smooth ||= target.clone();
    this.smooth.lerp(target, Math.min(1, dt * 18));
    cam.position.copy(this.smooth);
    cam.rotation.set(pitch, yaw, 0);
    // Wall right behind you: fade your own body out instead of filling the screen with it.
    if (g.ownSoldier?.root) g.ownSoldier.root.visible = dist > 0.9;
    return true;
  }

  // BRD: high above your soldier, looking down (north is up the screen), a little ahead of
  // where you face so you see who is coming.
  topCam(dt, cam) {
    const g = this.g;
    const b = g.driving?.active ? g.driving.v : g.body;
    const ahead = 2;
    const tx = b.x - Math.sin(g.yaw) * ahead;
    const tz = b.z - Math.cos(g.yaw) * ahead;
    const target = new THREE.Vector3(tx, (b.y || 0) + 10.5, tz + 4.4);
    this.smooth ||= target.clone();
    this.smooth.lerp(target, Math.min(1, dt * 6));
    cam.position.copy(this.smooth);
    cam.rotation.set(-1.17, 0, 0);
    // Cut away everything more than ~3 m above the ground (roofs, upper floors) like a
    // cross-section, so you can always see yourself indoors.
    if (cam.near !== 7.4) {
      cam.near = 7.4;
      cam.updateProjectionMatrix();
    }
    if (g.ownSoldier?.root) g.ownSoldier.root.visible = true;
    return true;
  }

  // The enemy best lined up with where you face (BRD aim help), within range and a cone.
  assistTarget(range = 26, cone = 0.5) {
    const g = this.g;
    const b = g.body;
    const fx = -Math.sin(g.yaw);
    const fz = -Math.cos(g.yaw);
    let best = null;
    let bestScore = Infinity;
    for (const s of g.soldiers.values()) {
      if (!s.visible || s.isMate || !s.state || s.state.flags & (256 | 4)) continue;
      const dx = s.state.x - b.x;
      const dz = s.state.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.01) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
      if (ang > cone) continue;
      if (lineBlocked(g.map.index, b.x, b.y + 1.4, b.z, s.state.x, s.state.y + 1.2, s.state.z, g.smokes || [])) continue;
      const score = d * (1 + ang * 2);
      if (score < bestScore) {
        bestScore = score;
        best = s.state;
      }
    }
    return best;
  }

  // Behind and above the vehicle, looking where you look (so you can shoot out of it).
  driveCam(dt, cam) {
    const g = this.g;
    const v = g.driving.v;
    const d = VEHICLES[v.type];
    const pitch = g.pitch + g.punch.p;
    const yaw = g.yaw + g.punch.y;
    const centre = new THREE.Vector3(v.x, d.H * 0.75 + 0.7, v.z);
    const fwd = new THREE.Vector3(...dirFromAngles(yaw, pitch));
    const back = d.L * 0.75 + (d.armored ? 3.8 : 3.3);
    const want = centre.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, 1.3 + d.H * 0.25, 0));
    const dir = want.clone().sub(centre);
    const len = dir.length();
    dir.normalize();
    const hit = raycast(g.map.index, centre.x, centre.y, centre.z, dir.x, dir.y, dir.z, len + 0.3, g.driving.box);
    const dist = Math.max(1.2, Math.min(len, hit.t - 0.3));
    const target = centre.clone().addScaledVector(dir, dist);
    this.smooth ||= target.clone();
    this.smooth.lerp(target, Math.min(1, dt * 10));
    cam.position.copy(this.smooth);
    cam.rotation.set(pitch, yaw, 0);
    return true;
  }

  flyDrone(dt, cam) {
    const g = this.g;
    const d = this.drone;
    d.t += dt;
    if (!this.unlimited()) {
      this.battery = Math.max(0, this.battery - dt);
      if (this.battery <= 0) return this.exitDrone('Drone battery empty. It is returning.'), false;
    }
    const inp = g.input;
    const mv = g.anyMenu() ? { x: 0, y: 0 } : inp.move();
    if (this.tour && this.flyTour(dt, d, mv.x || mv.y || this.climb || inp.down('Space'))) {
      cam.position.set(d.x, d.y + Math.sin(d.t * 1.7) * 0.1, d.z);
      cam.rotation.set(d.pitch, d.yaw, 0);
      audio.moveDrone?.(cam.position);
      this.hud(dt);
      return true;
    }
    const fast = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const sp = fast ? DRONE.boost : DRONE.speed;
    const sin = Math.sin(d.yaw);
    const cos = Math.cos(d.yaw);
    const wx = mv.x * cos - mv.y * sin;
    const wz = -mv.x * sin - mv.y * cos;
    d.vx += (wx * sp - d.vx) * Math.min(1, dt * 3);
    d.vz += (wz * sp - d.vz) * Math.min(1, dt * 3);
    const lim = g.map.half + DRONE.range;
    d.x = clamp(d.x + d.vx * dt, -lim, lim);
    d.z = clamp(d.z + d.vz * dt, -lim, lim);
    if (inp.down('Space') || this.climb > 0) d.alt += dt * 14;
    if (inp.down('KeyC') || inp.down('ControlLeft') || this.climb < 0) d.alt -= dt * 14;
    d.alt = clamp(d.alt, DRONE.minAlt, DRONE.maxAlt);
    d.y += (d.alt - d.y) * Math.min(1, dt * 2.5);
    // A little hover wobble and bank into turns, like a real quadcopter.
    const bank = clamp((d.vx * cos - d.vz * sin) * -0.006, -0.12, 0.12);
    cam.position.set(d.x, d.y + Math.sin(d.t * 1.7) * 0.15, d.z);
    cam.rotation.set(d.pitch + Math.sin(d.t * 1.1) * 0.004, d.yaw, bank);
    audio.moveDrone?.(cam.position);
    this.hud(dt);
    return true;
  }

  hud() {
    const d = this.drone;
    const pct = this.unlimited() ? 100 : Math.round((this.battery / DRONE.battery) * 100);
    const deg = Math.round(((-d.yaw * 180) / Math.PI + 360 * 10) % 360);
    const dist = Math.round(Math.hypot(d.x - this.g.body.x, d.z - this.g.body.z));
    if (this.hudKey === `${pct}|${deg}|${Math.round(d.y)}|${dist}`) return;
    this.hudKey = `${pct}|${deg}|${Math.round(d.y)}|${dist}`;
    $('dr-alt').textContent = `${Math.round(d.y)} m`;
    $('dr-hdg').textContent = `${String(deg).padStart(3, '0')}°`;
    $('dr-dist').textContent = `${dist} m`;
    $('dr-bat').style.width = `${pct}%`;
    $('dr-bat').classList.toggle('low', pct < 25);
    $('dr-bat-t').textContent = this.unlimited() ? '∞' : `${pct}%`;
  }

  // ---------- chase-cam aiming ----------
  // Where shots start (your eyes) and where they go (what the crosshair is on).
  shot() {
    const g = this.g;
    if (!this.thirdPerson()) return null;
    if (this.top) {
      // From above: shots leave your eyes level with the ground, straight at the enemy you face.
      const b = g.body;
      const o = [b.x, b.y + g.eye, b.z];
      const t = this.assistTarget(30, 0.42);
      let d;
      if (t) {
        const v = [t.x - o[0], t.y + (t.flags & 1 ? 0.95 : 1.3) - o[1], t.z - o[2]];
        const l = Math.hypot(...v) || 1;
        d = v.map((x) => x / l);
      } else d = dirFromAngles(g.yaw + g.punch.y, 0);
      return { o, d, muzzle: new THREE.Vector3(o[0] + d[0] * 0.8, o[1] - 0.25, o[2] + d[2] * 0.8) };
    }
    const b = g.body;
    const o = [b.x, b.y + g.eye, b.z];
    const cam = g.camera.position;
    const cd = dirFromAngles(g.yaw + g.punch.y, g.pitch + g.punch.p);
    const hit = raycast(g.map.index, cam.x, cam.y, cam.z, cd[0], cd[1], cd[2], 400, g.driving?.box ?? -1);
    let t = Math.min(hit.t, 400);
    // If an enemy is under the crosshair, aim at the enemy (not at the wall behind them):
    // otherwise the shot from your eyes would slip past the side of the target.
    for (const s of g.soldiers.values()) {
      if (!s.visible || s.isMate || !s.state || s.state.flags & (256 | 4)) continue;
      const h = hitSoldier(cam.x, cam.y, cam.z, cd[0], cd[1], cd[2], { x: s.state.x, y: s.state.y, z: s.state.z, crouch: s.state.flags & 1, downed: s.state.flags & 2 });
      if (h && h.t < t) t = h.t + 0.05;
    }
    const p = [cam.x + cd[0] * t, cam.y + cd[1] * t, cam.z + cd[2] * t];
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const l = Math.hypot(...v) || 1;
    // Target behind us (very close wall)? Shoot straight ahead instead.
    const d = v[0] * cd[0] + v[1] * cd[1] + v[2] * cd[2] > 0.5 * l ? v.map((x) => x / l) : cd;
    return { o, d, muzzle: new THREE.Vector3(o[0] + Math.cos(g.yaw) * 0.25 + d[0] * 0.7, o[1] - 0.15 + d[1] * 0.7, o[2] - Math.sin(g.yaw) * 0.25 + d[2] * 0.7) };
  }

  // Which body to listen from: in the drone you still hear around your soldier.
  listener() {
    return this.mode === 'drone' ? this.g.ownSoldier?.root?.position : null;
  }
}
