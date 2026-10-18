// One battle: rendering, the local fighter (movement, shooting, grenades, buying,
// reviving, respawning), remote fighters from server snapshots, and every server event.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GradeShader } from './fps/grade.js';
import { generateMap } from '../../shared/map.js';
import { moveBody, raycast, dirFromAngles, spreadDir, hitSoldier, lineBlocked, insideAnyBox, normalise } from '../../shared/physics.js';
import { WEAPONS, GEAR, FACTIONS, PLAYER, RESPAWN, MONEY, NET, ADS, KILLSTREAKS, SIDES, GEMS, DRUMS, TANKS, TILE_GEMS } from '../../shared/config.js';
import { Arena } from './world/arena.js';
import { Ambience } from './world/ambience.js';
import { AdWalls, SiteMarkers } from './world/markers.js';
import { Billboards } from './world/billboards.js';
import { Places } from './world/places.js';
import { TileGems } from './world/tile-gems.js';
import { Soldier } from './characters/soldiers.js';
import { ViewModel } from './fps/viewmodel.js';
import { Effects } from './fps/effects.js';
import { Hud } from './ui/hud.js';
import { audio } from './core/audio.js';
import { music } from './core/music.js';
import { isTouch } from './core/input.js';
import { ModeClient } from './modes-client.js';
import { CameraModes } from './camera-modes.js';
import { AdChat } from './ad-chat.js';
import { Vehicles, Charges, Ambulances } from './world/vehicles.js';
import { Houses } from './world/houses.js';
import { Driving } from './driving.js';
import { WaitAds } from './ui/wait-ads.js';
import { Crocs, Dogs } from './world/animals.js';
import { Underworld } from './world/underworld.js';
import { DIG, LOOT } from '../../shared/underworld.js';
import { swimFactor, deepWater, staminaFor, sprintFor, SKILLS } from '../../shared/skills.js';
import { VEHICLES, C4, AMBULANCE } from '../../shared/vehicles.js';

const WEAPON_IDS = Object.keys(WEAPONS); // same order as the server
const $ = (id) => document.getElementById(id);
const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }
};

export class Game {
  constructor({ renderer, net, input, quality, settings, onLeave, onNextStage }) {
    this.onNextStage = onNextStage;
    this.modes = new ModeClient(this);
    this.touch = isTouch();
    this.renderer = renderer;
    this.net = net;
    this.input = input;
    this.quality = quality;
    this.settings = settings;
    this.onLeave = onLeave;
    this.hud = new Hud();
    this.running = false;
    this.unsub = [];
    this.clock = new THREE.Clock();
    this.input.on((code, e, down) => this.onKey(code, e, down));
    this.input.on((code) => {
      if (code === 'unlock' && this.running) this.onUnlock();
    });
    this.bindUi();
    this.waitAds = new WaitAds(this);
  }

  // ---------- lifecycle ----------
  async start(info) {
    this.stop(true);
    this.info = info;
    this.myId = info.you;
    this.side = info.side;
    this.faction = info.faction;
    this.stateId = info.state;
    this.modeId = info.mode || 'conquest';
    this.map = generateMap(info.state);
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 1500);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    this.arena = new Arena(this.renderer, scene, this.map, this.quality);
    this.ambience = new Ambience(scene, this.map, this.arena);
    this.places = new Places(scene, this.map);
    this.boards = new Billboards(scene, this.map, this.renderer);
    this.cams?.exitDrone();
    this.cams = new CameraModes(this);
    this.adChat ||= new AdChat(this);
    this.adChat.reset();
    this.walls = new AdWalls(scene, this.map, this.boards);
    this.walls.setGems(info.gems);
    this.boards.load(info.state);
    this.tileGems = new TileGems(scene, this.map, info.tileGems || []);
    for (const i of info.drums || []) this.arena.killDrum(i);
    for (const i of info.tanks || []) this.arena.killTank(i);
    this.siteMarkers = new SiteMarkers(scene, this.map);
    this.siteMarkers.apply(info.sites);
    this.fx = new Effects(scene);
    // Vehicles, burning houses, C4 and ambulances.
    this.vehicles = new Vehicles(scene, this.map, this.fx);
    this.houses = new Houses(scene, this.map, this.arena, this.fx);
    this.charges = new Charges(scene, this.vehicles);
    this.ambulances = new Ambulances(scene);
    this.driving ||= new Driving(this);
    this.driving.stop();
    this.underworld = new Underworld(scene, this.map, this.arena);
    this.crocs = new Crocs(scene, this.fx);
    this.crocs.apply(info.crocs, info.serverTime);
    this.dogs = new Dogs(scene, this.fx);
    this.dogs.apply(info.dogs, info.serverTime);
    this.digging = null;
    this.diggers = new Map();
    this.applyWorld(info.world);
    this.vm = new ViewModel(scene);
    this.vm.scene.environment = scene.environment;
    this.vm.scene.environmentIntensity = 0.35;
    this.vm.setUniform(info.faction, info.you.charCodeAt(0));
    this.vm.sun.position.copy(this.arena.sunDir);
    this.soldiers = new Map();
    this.buffers = new Map(); // id -> snapshots
    this.roster = new Map(info.roster.map((r) => [r.id, r]));
    this.rosterList = info.roster;
    this.score = info.score;
    this.sites = info.sites;
    this.startedAt = info.startedAt;
    this.timeLimit = info.timeLimit;
    this.msLeft = info.timeLimit - (info.serverTime - info.startedAt);
    this.leftAt = performance.now();
    this.uavUntil = 0;
    this.latest = []; // latest snapshot players (for radar and revive checks)
    // Local fighter.
    const base = this.map.bases[this.side];
    this.body = { x: base.spawns[0].x, y: 0, z: base.spawns[0].z, vy: 0, onGround: true, crouch: false };
    this.vel = new THREE.Vector2();
    this.yaw = base.spawns[0].yaw;
    this.pitch = 0;
    this.punch = { p: 0, y: 0 };
    this.eye = PLAYER.eye;
    this.stamina = PLAYER.stamina;
    this.me = null;
    this.status = 'alive';
    this.local = { ammo: null, reloadUntil: 0, lastFire: 0, burst: 0, lastShot: 0, trigger: true, heal: 0 };
    this.stepDist = 0;
    this.sendT = 0;
    this.viewsT = 0;
    this.labelsT = 0;
    this.radarT = 0;
    this.heartT = 0;
    this.artilleryAim = false;
    this.menus = { buy: false, score: false, pause: false, chat: false };
    this.deathInfo = null;
    this.ownSoldier = new Soldier(scene, { id: this.myId, faction: this.faction }, true);
    this.ownSoldier.visible = false;
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(KILLSTREAKS.artillery.spread - 0.4, KILLSTREAKS.artillery.spread, 48), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.visible = false;
    scene.add(this.aimRing);
    this.pixelRatio = Math.min(devicePixelRatio, this.quality.pixelRatio);
    this.setupComposer();
    // Compile every shader now so the first look at a new object does not hitch.
    try {
      this.renderer.compile(scene, this.camera);
      this.renderer.compile(this.vm.scene, this.vm.camera);
    } catch {
      /* compile is only an optimisation */
    }
    this.hud.setMatch(info.state, info.side, info.faction);
    this.hud.score(info.score, info.sites, this.msLeft);
    this.hud.hideMatchEnd();
    for (const k of ['buy', 'scoreboard', 'pause', 'death', 'downed', 'spirit', 'medevac']) $(k).hidden = true;
    this.waitAds.hide();
    $('touch').hidden = !isTouch();
    this.touchKey = null;
    if (isTouch() && !this.touchBound) {
      this.input.bindTouch($('touch'));
      this.touchBound = true;
    }
    audio.setBiome(this.map.biome);
    audio.ambience(this.map.biome, this.arena.raining);
    audio.placeLoops(this.arena.loops);
    this.modes.start(info);
    this.subscribe();
    this.input.enabled = true;
    this.running = true;
    this.clock.getDelta();
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.ctpHidden = undefined;
    this.raf = requestAnimationFrame(() => this.frame());
    // Hint for new players.
    this.hud.banner(`${this.map.state.name.toUpperCase()} · ${SIDES[this.side].label.toUpperCase()}`, 3500);
    setTimeout(() => this.running && this.hud.toast(this.introTip(), 'info', 6500), 1500);
  }

  stop(silent = false) {
    if (!this.scene) return;
    this.modes.stop();
    this.ambience?.dispose();
    this.boards?.dispose();
    this.places?.dispose();
    this.tileGems?.dispose();
    this.cams?.exitDrone();
    this.adChat?.close(true);
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const u of this.unsub) u();
    this.unsub = [];
    removeEventListener('resize', this.onResize);
    this.driving?.stop();
    audio.stopAmbience();
    audio.spirit(false);
    this.input.enabled = false;
    this.input.unlock();
    this.arena.dispose();
    this.composer?.dispose?.();
    this.scene = null;
    $('tint').className = '';
    if (!silent) this.onLeave?.();
  }

  introTip() {
    return this.modes.introTip();
  }

  leave() {
    this.net.send({ t: 'leave' });
    this.stop();
  }

  // Campaign: start (or retry) a stage from the end screen.
  nextStage(i) {
    this.restart = true;
    this.hud.hideMatchEnd();
    this.onNextStage?.(i);
  }

  setupComposer() {
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.composer = null;
    if (!this.quality.postprocessing) return;
    const size = r.getSize(new THREE.Vector2());
    const q = this.quality;
    const c = new EffectComposer(r);
    c.addPass(new RenderPass(this.scene, this.camera));
    const vmPass = new RenderPass(this.vm.scene, this.vm.camera);
    vmPass.clear = false;
    vmPass.clearDepth = true;
    c.addPass(vmPass);
    if (q.bloom) c.addPass(new UnrealBloomPass(size, 0.28, 0.5, 0.92));
    c.addPass(new OutputPass());
    if (q.grade) {
      this.grade = new ShaderPass(GradeShader);
      c.addPass(this.grade);
    }
    if (!q.antialias) c.addPass(new SMAAPass(size.x * r.getPixelRatio(), size.y * r.getPixelRatio()));
    this.composer = c;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.pixelRatio ??= Math.min(devicePixelRatio, this.quality.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
    this.composer?.setSize(w, h);
  }

  // ---------- network ----------
  subscribe() {
    const on = (t, fn) => this.unsub.push(this.net.on(t, fn));
    this.modes.subscribe(on);
    on('s', (m) => this.onSnapshot(m));
    on('me', (m) => this.onMe(m));
    on('spawn', (m) => this.onSpawn(m));
    on('lunge', (m) => {
      // The server closed the last step of a melee swing: move there.
      Object.assign(this.body, { x: m.x, z: m.z });
      this.fx.shake = Math.min(1, this.fx.shake + 0.15);
    });
    on('correct', (m) => {
      Object.assign(this.body, { x: m.x, y: m.y, z: m.z, vy: 0 });
    });
    on('shot', (m) => this.onShot(m));
    on('hit', (m) => {
      music.excite(m.kill ? 0.3 : 0.06);
      this.hud.hitmarker(m.head, m.kill);
      audio.hitmarker(m.head, m.kill);
    });
    on('hurt', (m) => this.onHurt(m));
    on('kill', (m) => this.onKill(m));
    on('down', (m) => {
      if (m.id === this.myId) return;
      const r = this.roster.get(m.id);
      if (r?.side === this.side) this.hud.toast(`${r.name} is down — get there and hold E to revive them`, 'bad');
    });
    on('revived', (m) => {
      if (m.id === this.myId) this.hud.toast(`${m.by} revived you! Thank them later.`, 'good');
      else if (this.roster.get(m.id)?.side === this.side) this.hud.toast(`${m.by} revived ${this.roster.get(m.id).name}`, 'good');
    });
    on('toast', (m) => {
      this.hud.toast(m.text, m.kind);
      if (m.kind === 'gem') audio.gem();
      if (m.kind === 'streak') audio.alert();
    });
    on('chat', (m) => this.hud.chat(m));
    on('reload', (m) => m.id !== this.myId && audio.reload(m.w, this.posOf(m.id)));
    on('swing', (m) => m.id !== this.myId && audio.swing(this.posOf(m.id)));
    on('punchHit', (m) => {
      const pos = m.id === this.myId ? null : this.posOf(m.id);
      audio.punch?.(pos, m.heavy);
      if (m.id === this.myId) this.fx.shake = Math.min(1, this.fx.shake + (m.heavy ? 0.5 : 0.25));
      if (m.by === this.myId && m.heavy) this.hud.callout('HEAVY BLOW!');
    });
    on('combo', () => this.hud.callout('COMBO!'));
    on('revenge', (m) => {
      this.hud.callout('REVENGE!');
      this.hud.toast(`Revenge on ${m.name}! +150 XP`, 'streak', 2400);
    });
    on('secondWind', () => {
      this.hud.callout('SECOND WIND!');
      this.hud.toast('You nearly die! Find cover now, your body go recover.', 'bad', 2600);
      this.fx.shake = 1;
    });
    on('pill', (m) => audio.heal?.(m.id === this.myId ? null : this.posOf(m.id)));
    on('tgem', (m) => {
      this.tileGems?.taken(m.i, m.at, m.type);
      if (m.id === this.myId) {
        const g = TILE_GEMS.types[m.took];
        audio.heal?.(null);
        this.hud.toast(`${g.name}! ${g.heal ? `+${g.heal} health` : ''}${g.heal && g.armor ? ' · ' : ''}${g.armor ? `+${g.armor} armour` : ''}`, 'gem', 1800);
        $('tint').className = 'healed';
        setTimeout(() => $('tint').className === 'healed' && ($('tint').className = ''), 450);
      }
    });
    on('throw', (m) => m.id !== this.myId && audio.bounce(this.posOf(m.id)));
    on('smoke', (m) => {
      this.fx.smoke(m.x, m.z, m.r, m.dur);
      audio.smoke({ x: m.x, y: 0.5, z: m.z });
    });
    on('flashbang', (m) => {
      this.fx.flashbang(new THREE.Vector3(m.x, m.y, m.z));
      audio.flashbang({ x: m.x, y: m.y, z: m.z }, 0);
    });
    on('flashed', (m) => {
      this.hud.flash(m.s);
      audio.flashbang(null, m.s);
    });
    on('uav', (m) => {
      if (m.side === this.side) {
        this.uavUntil = m.until;
        this.hud.toast(`${m.by} launched a drone: enemies are on your radar`, 'streak');
        audio.drone(true);
        setTimeout(() => audio.drone(false), m.until - this.net.serverNow());
      } else this.hud.toast('Enemy drone overhead! They can see where you are', 'bad');
    });
    on('artillery', (m) => {
      const a = KILLSTREAKS.artillery;
      this.fx.artillery(m.x, m.z, a.spread, m.delay + a.shells * a.interval + 0.5);
      if (m.side !== this.side) {
        this.hud.banner('⚠ ARTILLERY INCOMING — RUN!', 3500);
        audio.alert();
      } else this.hud.toast(`${m.by} called in artillery`, 'streak');
    });
    on('incoming', (m) => {
      this.fx.incoming(m.x, m.z);
      audio.incoming({ x: m.x, y: 0, z: m.z });
    });
    on('boom', (m) => this.onBoom(m));
    on('gem', (m) => this.walls.collected(m.i, m.until));
    on('tank', (m) => {
      // A fuel tank goes up: the huge blast itself arrives as a 'boom'; this is the fire after.
      this.arena.killTank(m.i);
      for (let k = 0; k < 3; k++) this.fx.burningWreck(m.x + (Math.random() - 0.5) * 4, m.z + (Math.random() - 0.5) * 4, TANKS.fireSecs);
      audio.fire({ x: m.x, y: 2, z: m.z }, 12);
      if (Math.hypot(m.x - this.body.x, m.z - this.body.z) < 80) this.hud.banner(m.by ? `💥 ${m.by} blew up a fuel tank!` : '💥 A fuel tank blew up!', 2400);
    });
    on('drum', (m) => {
      this.arena.killDrum(m.i);
      this.fx.burningWreck(m.x, m.z, DRUMS.fireSecs);
      audio.fire({ x: m.x, y: 0.8, z: m.z }, DRUMS.fireSecs);
    });
    on('vseat', (m) => {
      this.vehicles.seat(m.i, m.id);
      if (m.id === this.myId) this.driving.start(this.vehicles.list[m.i]);
      else if (this.driving.active && this.driving.v.i === m.i) this.driving.stop();
      if (m.out === this.myId) this.driving.stop();
    });
    on('vcorrect', (m) => this.driving.correct(m));
    on('vstate', (m) => {
      this.vehicles.setState(m.i, m.s);
      if (m.s === 2) {
        const v = this.vehicles.list[m.i];
        audio.fire({ x: v.x, y: 1, z: v.z }, 10);
      }
    });
    on('house', (m) => {
      this.houses.setState(m.i, m.s);
      const H = this.map.houses[m.i];
      if (m.s === 2 && H) {
        audio.fire({ x: H.x, y: 1.5, z: H.z }, 14);
        if (Math.hypot(H.x - this.body.x, H.z - this.body.z) < 60) this.hud.toast('🔥 A house is on fire!', 'info', 1800);
      }
    });
    on('c4', (m) => {
      if (m.a === 'plant') {
        this.charges.plant(m, this.myId);
        audio.c4({ x: m.pos[0], y: m.pos[1], z: m.pos[2] });
      } else if (m.a === 'gone') this.charges.gone(m.id);
      else if (m.a === 'det') audio.click();
      this.hud.c4Planted = this.charges.mineCount();
      if (this.me) this.hud.nades(this.me);
    });
    on('amb', (m) => this.ambulances.add(m));
    on('dog', (m) => {
      this.dogs.event(m);
      if (m.a === 'bite' && m.id === this.myId) this.fx.shake = Math.min(1.2, this.fx.shake + 0.5);
      if (m.a === 'dead' && m.by) this.hud.toast(`${m.by} put down a guard dog`, 'info', 1800);
    });
    on('croc', (m) => {
      if (m.a === 'bite') {
        this.crocs.bite(m.i);
        if (m.id === this.myId) this.fx.shake = Math.min(1.4, this.fx.shake + 0.8);
      } else if (m.a === 'dead' && m.by) this.hud.toast(`🐊 ${m.by} killed a crocodile`, 'info', 2000);
    });
    // Digging graves and opening tombs.
    on('dig', (m) => {
      if (m.i >= 0) this.digging = { i: m.i, start: performance.now(), secs: m.secs };
      else {
        if (this.digging && m.reason === 'moved') this.hud.toast('You moved: digging stopped.', 'bad', 1400);
        this.digging = null;
      }
    });
    on('digging', (m) => {
      if (m.on) this.diggers.set(m.id, m.i);
      else this.diggers.delete(m.id);
    });
    on('grave', (m) => {
      this.diggers.delete(m.id);
      this.underworld.open(m.i, m.loot);
      const G = this.map.graves[m.i];
      const L = LOOT[m.loot];
      if (G.kind !== 'grave') audio.tombOpen?.({ x: G.x, y: G.y + 0.8, z: G.z });
      if (m.id === this.myId) {
        if (L.kind !== 'none') {
          audio.relic?.();
          this.hud.callout(`${L.icon} ${L.name.toUpperCase()}`);
          $('tint').className = 'healed';
          setTimeout(() => $('tint').className === 'healed' && ($('tint').className = ''), 900);
          for (let k = 0; k < 30; k++) this.fx.sparks.spawn(new THREE.Vector3(G.x, G.y + 0.8, G.z), { colour: '#ffd66a', size: 0.08, life: 1.2, v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3), g: 3 });
        }
      } else if (L.kind === 'weapon') this.hud.toast(`${m.by} dug out ${L.icon} ${L.name}!`, 'info', 2600);
    });
    on('ambHeal', (m) => {
      if (m.pid !== this.myId) return;
      audio.heal(null);
      $('tint').className = 'healed';
      setTimeout(() => $('tint').className === 'healed' && ($('tint').className = ''), 700);
    });
    on('site', (m) => {
      if (m.neutral) this.hud.toast(`${m.label} is neutral again`, 'info');
      else {
        const ours = m.owner === this.side;
        this.hud.banner(`${ours ? 'WE HOLD' : 'ENEMY TOOK'} ${m.id === 'D' ? 'THE NEW DEPOSIT' : m.id} · ${m.label.toUpperCase()}`, 3200);
        audio.alert();
      }
    });
    on('score', (m) => {
      this.score = m.score;
      this.hud.liveCount(m.humans);
      this.sites = m.sites;
      this.siteMarkers.apply(m.sites);
      if (m.roster) {
        this.rosterList = m.roster;
        for (const r of m.roster) this.roster.set(r.id, r);
      }
      if (m.left !== undefined) {
        this.msLeft = m.left;
        this.leftAt = performance.now();
      }
      this.hud.score(m.score, m.sites);
      if (m.modeState) this.modes.apply(m.modeState);
      if (this.menus.score) this.hud.scoreboard(this.rosterList, this.myId, this.score);
    });
    on('discovery', (m) => {
      this.hud.banner(`⛏ ${m.label.toUpperCase()} FOUND — DOUBLE POINTS`, 4500);
      audio.alert();
    });
    on('discoveryEnd', (m) => this.hud.toast(`${m.label} is over`, 'info'));
    on('bought', (m) => {
      audio.click();
      if (WEAPONS[m.item]) {
        this.local.reloadUntil = 0;
        this.vm.cancelReload();
      }
    });
    on('spirit', () => {
      this.hud.toast('Find any glowing 💎 on an advert wall!', 'gem');
    });
    on('joined', (m) => {
      this.hud.liveCount(m.humans);
      if (m.name) this.hud.toast(`${m.name} joined the battle`, 'info', 2500);
    });
    on('debrief', (d) => {
      this.hud.debrief(d, { deploy: (o) => this.onOrders?.(o), map: () => this.leave() });
      if (d.finished) audio.alert();
    });
    on('left', (m) => {
      this.hud.liveCount(m.humans);
      if (m.name) this.hud.toast(`${m.name} left the battle`, 'info', 2500);
      this.soldiers.get(m.id)?.dispose();
      this.soldiers.delete(m.id);
      this.buffers.delete(m.id);
    });
    on('matchEnd', (m) => {
      this.hud.matchEnd(m, this.side, this.myId, this.modes.endActions(m));
      music.sting(m.winner === this.side);
      this.input.unlock();
      this.ended = true;
    });
    on('matchInfo', (m) => {
      // New round after the end screen (same state).
      if (m.state !== this.stateId) return;
      this.ended = false;
      this.hud.hideMatchEnd();
      if (m.modeState) this.modes.apply(m.modeState);
      this.walls.setGems(m.gems);
      this.arena.restoreDrums();
      for (const i of m.drums || []) this.arena.killDrum(i);
      this.arena.restoreTanks();
      for (const i of m.tanks || []) this.arena.killTank(i);
      this.driving.stop();
      this.vehicles.reset();
      this.houses.reset();
      this.charges.clear();
      this.ambulances.clear();
      this.underworld.reset();
      this.digging = null;
      this.diggers.clear();
      this.applyWorld(m.world);
      this.siteMarkers.apply(m.sites);
      this.score = m.score;
      this.msLeft = m.timeLimit - (m.serverTime - m.startedAt);
      this.leftAt = performance.now();
      this.hud.score(m.score, m.sites, this.msLeft);
    });
  }

  // Vehicles, burnt houses and live C4 for a player joining mid-battle (or a new round).
  applyWorld(w) {
    if (!w) return;
    this.vehicles.apply(w);
    this.houses.apply(w.h);
    for (const [id, x, y, z, owner] of w.c || []) this.charges.plant({ id, pos: [x, y, z], veh: null, by: owner }, this.myId);
    for (const [i, loot] of w.g || []) this.underworld.open(i, loot, true);
  }

  posOf(id) {
    const s = this.soldiers.get(id);
    return s ? { x: s.root.position.x, y: s.root.position.y + 1.4, z: s.root.position.z } : null;
  }

  onSnapshot(m) {
    const seen = new Set();
    this.latest = [];
    for (const [id, x, y, z, yaw, pitch, flags, wi, hp] of m.p) {
      seen.add(id);
      const st = { t: m.ts, x, y, z, yaw, pitch, flags, w: WEAPON_IDS[wi], hp };
      this.latest.push({ id, ...st, side: this.roster.get(id)?.side });
      if (id === this.myId) {
        const burning = !!(flags & 1024);
        if (burning !== this.burning) {
          this.burning = burning;
          $('burn').classList.toggle('on', burning);
          if (burning) this.hud.toast('🔥 You are on fire! Water puts it out.', 'bad', 2500);
        }
        this.myFlags = flags;
        continue;
      }
      let buf = this.buffers.get(id);
      if (!buf) this.buffers.set(id, (buf = []));
      buf.push(st);
      if (buf.length > 30) buf.shift();
    }
    // Soldiers missing from the snapshot (enemy spirits) are hidden.
    for (const [id, s] of this.soldiers) s.visible = seen.has(id);
    this.vehicles.onSnapshot(m.vh, m.ts, this.driving.active ? this.driving.v.i : -1);
    if (m.ck) this.crocs.apply(m.ck, m.ts);
    if (m.dg) this.dogs.apply(m.dg, m.ts);
    this.fx.projectiles(m.pr);
    this.fx.syncSmokes(m.sm);
    this.smokes = m.sm.map(([x, z, r]) => ({ x, z, r }));
  }

  onMe(m) {
    const prev = this.status;
    this.me = m;
    // The server is the judge of who sits where: never stay stuck in (or out of) a seat.
    if (this.driving?.active && m.veh == null) this.driving.stop();
    else if (this.driving && !this.driving.active && m.veh != null && this.vehicles?.list[m.veh]) this.driving.start(this.vehicles.list[m.veh]);
    this.status = m.status;
    // Keep predicted ammo unless we fired very recently.
    const w = m.weapons[m.slot];
    if (performance.now() - this.local.lastFire > 450 && !(this.local.reloadUntil > performance.now())) this.local.ammo = m.ammo[w] ? { ...m.ammo[w] } : null;
    if (w !== this.vm.id) {
      this.vm.setWeapon(w);
      this.local.ammo = m.ammo[w] ? { ...m.ammo[w] } : null;
    }
    if (m.reloadUntil && !this.local.reloadUntil && WEAPONS[w]?.reload) {
      // Server started an automatic reload.
      const left = (m.reloadUntil - this.net.serverNow()) / 1000;
      if (left > 0.1) {
        this.local.reloadUntil = performance.now() + left * 1000;
        this.vm.reload(left);
        audio.reload(w);
      }
    }
    this.hud.me(m, this.local);
    if (prev !== m.status) this.onStatus(prev, m.status);
  }

  onStatus(prev, now) {
    this.cams?.onStatus(now);
    this.hud.showState(now, this.me, this.deathInfo || {});
    audio.spirit(now === 'spirit');
    audio.helicopter(now === 'medevac');
    $('tint').className = ['spirit', 'dead', 'medevac'].includes(now) ? now : '';
    if (now === 'dead') {
      music.calm();
      this.hud.deadSince = performance.now();
      this.input.unlock();
      this.closeMenus();
      this.vm.visible = false;
    } else if (now === 'alive') {
      this.vm.visible = true;
      this.deathInfo = null;
    } else if (now === 'spirit') {
      this.vm.visible = false;
      if (!isTouch()) this.input.lock();
    } else this.vm.visible = false;
    if (now === 'downed') this.closeMenus();
    // Waiting for the medevac: the drone tours the battlefield's adverts until you land.
    if (now === 'medevac') this.cams.startTour();
  }

  onSpawn(m) {
    Object.assign(this.body, { x: m.x, y: m.y, z: m.z, vy: 0, onGround: true, crouch: false });
    this.vel.set(0, 0);
    this.yaw = m.yaw;
    this.pitch = 0;
    this.stamina = PLAYER.stamina;
    this.local.reloadUntil = 0;
    this.vm.cancelReload();
    this.hud.deadSince = 0;
  }

  onShot(m) {
    if (m.id === this.myId) return;
    if (Math.random() < 0.3) this.scareAnimals(m.o[0], m.o[2]);
    const sol = this.soldiers.get(m.id);
    const w = WEAPONS[m.w];
    const from = sol && sol.visible ? sol.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...m.o);
    audio.gunshot(w?.sound || 'rifle', { x: from.x, y: from.y, z: from.z });
    if (from.distanceTo(this.camera.position) < 45) music.excite(0.03);
    this.fx.muzzle(from, 0.7);
    if (sol) sol.firedAt = performance.now();
    const eye = this.camera.position;
    m.e.forEach((e, i) => {
      if (!e) return;
      const end = new THREE.Vector3(...e);
      if (i % 2 === 0 || !w?.pellets) this.fx.tracer(from, end, '#ffcf7a');
      const surf = e[1] < 0.06 ? this.arena.surfaceAt(e[0], 0, e[2]) : 'concrete';
      this.fx.impact(end, new THREE.Vector3().subVectors(from, end).normalize(), surf);
      if (i === 0) audio.impact(surf === 'concrete' ? 'concrete' : 'dirt', { x: e[0], y: e[1], z: e[2] });
      // Bullet passing close to your head.
      const seg = new THREE.Line3(from, end);
      const closest = seg.closestPointToPoint(eye, true, new THREE.Vector3());
      if (closest.distanceTo(eye) < 2.2 && closest.distanceTo(end) > 1) audio.whiz(closest);
    });
  }

  onHurt(m) {
    this.cams?.onHurt();
    this.adChat?.onHurt();
    music.excite(0.15);
    audio.hurt(m.dmg);
    this.fx.shake = Math.min(1, this.fx.shake + m.dmg / 60);
    this.punch.p += 0.02 + m.dmg / 2000;
    if (m.from) {
      const dx = m.from[0] - this.body.x;
      const dz = m.from[2] - this.body.z;
      const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
      this.hud.damageFrom(Math.atan2(dx * r[0] + dz * r[1], dx * f[0] + dz * f[1]));
    }
  }

  onKill(m) {
    this.hud.kill(m, this.myId);
    if (m.victim === this.myId) {
      this.deathInfo = { killer: m.kn && m.killer !== this.myId ? m.kn : null, weapon: m.w, head: m.head, killerId: m.killer };
      if (this.me) this.hud.showState('dead', this.me, this.deathInfo);
    }
    if (m.killer === this.myId && m.victim !== this.myId) {
      const streak = (this.me?.streak || 0) + 1;
      const call = ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'RAMPAGE!', 'NO MERCY!'][Math.min(5, streak)] || 'WAR GENERAL!';
      if (streak >= 2) this.hud.callout(call);
      else if (m.head) this.hud.callout('HEADSHOT!');
      else if (m.w === 'knife') this.hud.callout('MACHETE KILL!');
    }
    const s = this.soldiers.get(m.victim);
    if (s) this.fx.bloodHit(s.root.position.clone().setY(1.2), null);
  }

  onBoom(m) {
    this.scareAnimals(m.x, m.z, 60);
    const p = new THREE.Vector3(m.x, m.y, m.z);
    this.fx.explosion(p, m.r, m.w);
    audio.explosion(p, m.w === 'tank' ? 2 : m.w === 'artillery' || m.w === 'rpg' ? 1.3 : 1);
    const d = p.distanceTo(this.camera.position);
    if (d < 40) music.excite(0.12);
    this.fx.shake = Math.min(1.5, this.fx.shake + Math.max(0, (m.r * 4 - d) / (m.r * 4)) * 1.2);
  }

  // ---------- input ----------
  onKey(code, e, down) {
    if (!this.running || !this.me) return;
    if (!down) {
      if (code === 'Tab') this.toggleScore(false);
      if (code === 'Mouse0') this.local.trigger = true;
      if (code === 'KeyE') {
        this.modes.useAction(false);
        if (this.digging) this.net.send({ t: 'dig', a: 'stop' });
      }
      return;
    }
    if (code === 'unlock') return;
    const st = this.status;
    if (this.menus.chat) return;
    if (code === 'Escape') {
      if (this.artilleryAim) return this.cancelArtillery();
      if (this.menus.buy) return this.toggleBuy(false);
      if (st === 'dead') return;
      return this.togglePause(!this.menus.pause);
    }
    if (this.menus.pause || this.ended) return;
    if (code === 'Tab') return this.toggleScore(true);
    if (code === 'KeyV') return this.modes.toggleQuick();
    if (this.modes.quickOpen) {
      const q = /^Digit([1-6])$/.exec(code);
      if (q) return this.modes.sendQuick(+q[1] - 1);
    }
    if (code === 'KeyY' || code === 'KeyU') return this.openChat(code === 'KeyU');
    if (code === 'KeyT') return (st === 'dead' || st === 'medevac') && this.cams.mode !== 'drone' ? this.cams.startTour() : this.cams.toggleDrone();
    if (code === 'KeyH') return this.cams.toggleChase();
    if (code === 'KeyJ') return this.adChat.openTarget();
    if (this.cams.mode === 'drone') {
      if (code === 'Mouse0') return this.adChat.openTarget();
      if (code === 'WheelUp' || code === 'WheelDown') {
        this.cams.drone.alt = Math.max(14, Math.min(75, this.cams.drone.alt + (code === 'WheelUp' ? 4 : -4)));
        return;
      }
    }
    if (st === 'dead') {
      if (code === 'Digit1') this.respawn('gem');
      if (code === 'Digit2') this.respawn('spirit');
      if (code === 'Digit3') this.respawn('medevac');
      return;
    }
    if (this.menus.buy) {
      if (code === 'KeyB') return this.toggleBuy(false);
      const m = /^Digit(\d)$/.exec(code);
      if (m) document.querySelector(`#buy-grid .item[data-key="${m[1]}"]`)?.click();
      return;
    }
    if (st !== 'alive') return;
    if (this.artilleryAim && code === 'Mouse0') return this.confirmArtillery();
    switch (code) {
      case 'KeyB':
        if (this.driving.active) return this.hud.toast('Get out of the vehicle to buy.', 'bad', 1400);
        return this.toggleBuy(true);
      case 'KeyR':
        return this.reload();
      case 'Digit1':
        return this.switchSlot('primary');
      case 'Digit2':
        return this.switchSlot('secondary');
      case 'Digit3':
        return this.switchSlot('melee');
      case 'KeyQ':
        return this.switchSlot(this.lastSlot || 'secondary');
      case 'WheelUp':
      case 'WheelDown': {
        const order = ['primary', 'secondary', 'melee'].filter((s) => this.me.weapons[s]);
        const i = order.indexOf(this.me.slot);
        return this.switchSlot(order[(i + (code === 'WheelDown' ? 1 : order.length - 1)) % order.length]);
      }
      case 'Digit4':
        return this.cycleNade();
      case 'KeyG':
        return this.throwNade();
      case 'KeyX':
        return this.medkit();
      case 'KeyE':
        if (this.driving.active) return this.net.send({ t: 'veh', a: 'exit' });
        if (this.modes.useAction(true)) return;
        if (this.downedMate()) return this.tryRevive();
        if (this.vehicles.nearest(this.body.x, this.body.z)) return this.enterVehicle();
        if (this.nearGrave) return this.net.send({ t: 'dig', a: 'start', i: this.nearGrave.g.i });
        return;
      case 'KeyP':
        return this.plantC4();
      case 'KeyL':
        return this.detonateC4();
      case 'KeyK':
        return this.net.send({ t: 'amb' });
      case 'KeyF':
        if (this.driving.active) return;
        return this.quickPunch();
      case 'KeyN':
        return this.takePill();
      case 'Digit5':
        if (this.me.streaksAvail?.uav) this.net.send({ t: 'streak', kind: 'uav' });
        return;
      case 'Digit6':
        if (this.me.streaksAvail?.artillery) this.startArtillery();
        return;
      default:
    }
  }

  bindUi() {
    // Where to come back: where you fell (if it's safe) or fresh at your base.
    this.comeBack = store.get('pod.comeBack') === 'base' ? 'base' : 'here';
    const setBack = (at) => {
      this.comeBack = at;
      store.set('pod.comeBack', at);
      $('cb-here').classList.toggle('on', at === 'here');
      $('cb-base').classList.toggle('on', at === 'base');
      this.net.send({ t: 'respawn', at });
    };
    $('cb-here').onclick = () => setBack('here');
    $('cb-base').onclick = () => setBack('base');
    $('cb-here').classList.toggle('on', this.comeBack === 'here');
    $('cb-base').classList.toggle('on', this.comeBack === 'base');
    $('opt-gem').onclick = () => this.respawn('gem');
    $('opt-spirit').onclick = () => this.respawn('spirit');
    $('opt-medevac').onclick = () => this.respawn('medevac');
    $('opt-drone').onclick = () => this.cams.startTour();
    $('ad-prompt').onclick = () => this.adChat.openTarget();
    $('veh-prompt').onclick = () => (this.driving?.active ? this.net.send({ t: 'veh', a: 'exit' }) : this.enterVehicle());
    $('btn-inbox-game').onclick = () => this.onInbox?.();
    $('btn-resume').onclick = () => this.togglePause(false);
    $('btn-leave').onclick = () => {
      this.net.send({ t: 'leave' });
      this.stop();
    };
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => (b.dataset.close === 'buy' ? this.toggleBuy(false) : this.togglePause(false));
    $('click-to-play').onclick = () => {
      audio.unlock();
      this.input.lock();
    };
    const ci = $('chat-input');
    ci.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (ci.value.trim()) this.net.send({ t: 'chat', text: ci.value, team: this.chatTeam });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  onUnlock() {
    if (this.status === 'dead' || this.ended || this.menus.buy || this.menus.chat || this.menus.pause) return;
    if (isTouch()) return;
    // Esc released the mouse: show the pause menu.
    this.togglePause(true);
  }

  togglePause(on) {
    this.menus.pause = on;
    $('pause').hidden = !on;
    if (on) {
      this.input.unlock();
      $('set-sens').value = this.settings.sensitivity;
      $('set-fov').value = this.settings.fov;
      $('set-vol').value = this.settings.volume;
      $('set-quality').value = this.settings.quality;
      $('set-invert').checked = this.settings.invertY;
      $('set-music').value = this.settings.music;
      $('set-touch').value = this.settings.touchSens;
    } else if (!isTouch() && this.status !== 'dead') this.input.lock();
  }

  toggleBuy(on) {
    this.menus.buy = on;
    $('buy').hidden = !on;
    if (on) {
      this.input.unlock();
      this.renderBuy();
    } else if (!isTouch() && this.status === 'alive') this.input.lock();
  }

  renderBuy() {
    if (!this.me) return;
    this.hud.renderBuy(this.me, this.inBuyZone(), (item) => {
      this.net.send({ t: 'buy', item });
      setTimeout(() => this.menus.buy && this.renderBuy(), 150);
    });
  }

  inBuyZone() {
    const b = this.map.bases[this.side];
    return Math.hypot(this.body.x - b.x, this.body.z - b.z) < MONEY.buyZoneRadius || this.net.serverNow() < (this.me?.buyUntil || 0);
  }

  toggleScore(on) {
    this.menus.score = on;
    $('scoreboard').hidden = !on;
    if (on) this.hud.scoreboard(this.rosterList, this.myId, this.score);
  }

  openChat(team) {
    this.menus.chat = true;
    this.chatTeam = team;
    this.input.typing = true;
    const ci = $('chat-input');
    ci.hidden = false;
    ci.placeholder = team ? 'Team chat…' : 'All chat…';
    setTimeout(() => ci.focus(), 0);
  }

  closeChat() {
    const ci = $('chat-input');
    ci.value = '';
    ci.hidden = true;
    ci.blur();
    this.input.typing = false;
    setTimeout(() => (this.menus.chat = false), 0);
  }

  closeMenus() {
    if (this.menus.buy) this.toggleBuy(false);
    this.menus.buy = false;
    $('buy').hidden = true;
    this.cancelArtillery();
  }

  respawn(mode) {
    audio.unlock();
    this.respawnAt = performance.now();
    $('death').hidden = true;
    this.net.send({ t: 'respawn', mode, at: this.comeBack || 'here' });
    if (mode !== 'medevac' && !isTouch()) this.input.lock();
  }

  // ---------- weapons ----------
  weapon() {
    return this.me ? this.me.weapons[this.me.slot] : null;
  }

  switchSlot(slot) {
    if (!this.me?.weapons[slot] || this.me.slot === slot) return;
    this.lastSlot = this.me.slot;
    this.me.slot = slot;
    this.net.send({ t: 'slot', slot });
    this.local.reloadUntil = 0;
    this.vm.setWeapon(this.me.weapons[slot]);
    this.local.ammo = this.me.ammo[this.me.weapons[slot]] ? { ...this.me.ammo[this.me.weapons[slot]] } : null;
    this.local.lastFire = performance.now() - 200; // brief draw delay
    this.hud.me(this.me, this.local);
    audio.click();
  }

  reload() {
    const id = this.weapon();
    const w = WEAPONS[id];
    const a = this.local.ammo;
    if (!w || w.melee || !a || a.mag >= w.mag || a.reserve <= 0 || this.local.reloadUntil > performance.now()) return;
    this.net.send({ t: 'reload' });
    this.local.reloadUntil = performance.now() + w.reload * 1000;
    this.local.reloadId = id;
    this.vm.reload(w.reload);
    audio.reload(id);
  }

  finishReload() {
    const w = WEAPONS[this.local.reloadId];
    const a = this.local.ammo;
    if (w && a && this.weapon() === this.local.reloadId) {
      const take = Math.min(w.mag - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
    }
    this.local.reloadUntil = 0;
    this.hud.me(this.me, this.local);
  }

  spreadNow(w, speed) {
    if (!w) return 0;
    const ads = this.adsOn;
    let s = ads ? w.adsSpread : w.spread;
    s += (w.moveSpread || 0) * clamp(speed / PLAYER.jog, 0, 1.2) * (ads ? 0.6 : 1);
    if (!this.body.onGround) s += 0.08;
    if (this.body.crouch) s *= 0.75;
    if (w.auto) s += Math.min(0.03, this.local.burst * 0.0035);
    return s;
  }

  tryFire(now) {
    const id = this.weapon();
    const w = WEAPONS[id];
    if (!w) return;
    if (w.melee) {
      if (now - this.local.lastFire < 520) return;
      this.local.lastFire = now;
      this.net.send({ t: 'melee' });
      this.vm.swing();
      audio.swing();
      return;
    }
    if (!w.auto && !this.local.trigger) return;
    if (now - this.local.lastFire < 60000 / w.rpm) return;
    if (this.local.reloadUntil > now) return;
    const a = this.local.ammo;
    if (!a || a.mag <= 0) {
      if (this.local.trigger) audio.dryFire();
      this.local.trigger = false;
      if (a && a.reserve > 0) this.reload();
      return;
    }
    this.local.trigger = false;
    this.local.burst = now - this.local.lastFire < (60000 / w.rpm) * 1.6 ? this.local.burst + 1 : 0;
    this.local.lastFire = now;
    a.mag--;
    const chase = this.cams.shot();
    const o = chase ? chase.o : [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    let d = chase ? chase.d : dirFromAngles(this.yaw + this.punch.y + (this.sway?.y || 0), this.pitch + this.punch.p + (this.sway?.p || 0));
    if (!w.pellets) d = spreadDir(d, this.spreadNow(w, this.vel.length()));
    if (!this.scareT || now - this.scareT > 400) {
      this.scareT = now;
      this.scareAnimals(o[0], o[2]);
    }
    this.net.send({ t: 'fire', w: id, o: o.map((v) => +v.toFixed(3)), d: d.map((v) => +v.toFixed(4)), ts: Math.round(this.net.serverNow() - NET.interpDelayMs) });
    // Recoil: part is view punch that recovers, part climbs for good.
    const k = w.kick * (this.adsOn ? 0.75 : 1) * (this.body.crouch ? 0.8 : 1);
    this.punch.p += k * 0.6;
    this.punch.y += (Math.random() - 0.5) * k * 0.7;
    this.pitch = clamp(this.pitch + k * 0.45, -1.5, 1.5);
    this.vm.fire();
    audio.gunshot(w.sound, null, true);
    music.excite(0.02);
    const muzzle = chase ? chase.muzzle : this.camera.localToWorld(new THREE.Vector3(0.12, -0.1, -0.6));
    this.fx.muzzle(muzzle, w.pellets ? 1.3 : 1);
    this.fx.shake = Math.min(1, this.fx.shake + (w.pellets || w.dmg > 50 ? 0.25 : 0.06));
    if (w.projectile) return;
    // Local hit effects (the server decides damage).
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = pellets > 1 ? spreadDir(d, w.spread) : d;
      const hit = raycast(this.map.index, o[0], o[1], o[2], dir[0], dir[1], dir[2], w.range, this.driving.box);
      let t = hit.t;
      let body = null;
      for (const s of this.soldiers.values()) {
        if (!s.visible || s.isMate || !s.state || s.state.flags & (256 | 4)) continue;
        const h = hitSoldier(o[0], o[1], o[2], dir[0], dir[1], dir[2], { x: s.state.x, y: s.state.y, z: s.state.z, crouch: s.state.flags & 1, downed: s.state.flags & 2 });
        if (h && h.t < t) {
          t = h.t;
          body = s;
        }
      }
      const end = new THREE.Vector3(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t);
      if (i === 0 && (this.local.burst % 2 === 0 || !w.auto)) this.fx.tracer(muzzle, end, '#ffe0a0');
      if (body) this.fx.bloodHit(end, new THREE.Vector3(...dir));
      else if (hit.box !== -1) {
        const surf = hit.box === -2 ? this.arena.surfaceAt(end.x, 0, end.z) : this.surfaceOfBox(this.map.boxes[hit.box]);
        this.fx.impact(end, this.normalAt(hit, end), surf);
        if (i === 0) audio.impact(surf, end);
      }
    }
    if (a.mag === 0 && a.reserve > 0) setTimeout(() => this.reload(), 250);
    this.hud.me(this.me, this.local);
  }

  surfaceOfBox(b) {
    if (!b) return 'concrete';
    if (['plank', 'bridge', 'crate', 'stall', 'trunk'].includes(b.kind)) return 'wood';
    if (['metal', 'zinc', 'container', 'tank', 'pipe', 'wreck', 'drum', 'adwall', 'vehicle'].includes(b.kind)) return 'metal';
    if (['mud', 'mudthick', 'sandbag'].includes(b.kind)) return 'dirt';
    return 'concrete';
  }

  normalAt(hit, p) {
    if (hit.box === -2) return new THREE.Vector3(0, 1, 0);
    const b = this.map.boxes[hit.box];
    const d = [
      [Math.abs(p.x - b.x0), -1, 0, 0],
      [Math.abs(p.x - b.x1), 1, 0, 0],
      [Math.abs(p.y - b.y0), 0, -1, 0],
      [Math.abs(p.y - b.y1), 0, 1, 0],
      [Math.abs(p.z - b.z0), 0, 0, -1],
      [Math.abs(p.z - b.z1), 0, 0, 1]
    ].sort((a, c) => a[0] - c[0])[0];
    return new THREE.Vector3(d[1], d[2], d[3]);
  }

  cycleNade() {
    const have = ['frag', 'smoke', 'flash'].filter((k) => this.me[k] > 0);
    if (!have.length) return this.hud.toast('You have no grenades. Buy some at the armoury.', 'bad', 1500);
    const i = have.indexOf(this.hud.nadeSel);
    this.hud.nadeSel = have[(i + 1) % have.length];
    this.hud.nades(this.me);
  }

  throwNade() {
    let kind = this.hud.nadeSel;
    if (!(this.me[kind] > 0)) kind = ['frag', 'smoke', 'flash'].find((k) => this.me[k] > 0);
    if (!kind) return this.hud.toast('You have no grenades. Buy some at the armoury.', 'bad', 1500);
    this.hud.nadeSel = kind;
    const d = dirFromAngles(this.yaw, this.pitch + 0.12);
    const p = this.camera.position;
    const speed = 17;
    const v = [d[0] * speed + this.vel.x * 0.5, d[1] * speed + 2, d[2] * speed + this.vel.y * 0.5];
    this.net.send({ t: 'throw', kind, o: [p.x + d[0] * 0.4, p.y - 0.1, p.z + d[2] * 0.4].map((x) => +x.toFixed(2)), v: v.map((x) => +x.toFixed(2)) });
    this.vm.swing();
    audio.grenadeThrow();
    this.me[kind]--;
    this.hud.nades(this.me);
  }

  // Quick punch with the free hand, any time (three in a row on one enemy = heavy blow).
  enterVehicle() {
    const v = this.vehicles.nearest(this.body.x, this.body.z);
    if (!v) return;
    // Don't fire twice while the first request is on its way.
    if (this.enterAt && performance.now() - this.enterAt < 600) return;
    this.enterAt = performance.now();
    this.net.send({ t: 'veh', a: 'enter', i: v.i });
  }

  // Stick a C4 charge on whatever you are looking at (a wall, a vehicle) or drop it at your feet.
  plantC4() {
    if (!(this.me?.c4 > 0)) return this.hud.toast('You have no C4. Buy it at the armoury (B).', 'bad', 1600);
    if (this.driving.active) return this.hud.toast('Get out of the vehicle to plant C4.', 'bad', 1600);
    const b = this.body;
    const eye = [b.x, b.y + this.eye, b.z];
    const d = dirFromAngles(this.yaw, this.pitch);
    const hit = raycast(this.map.index, eye[0], eye[1], eye[2], d[0], d[1], d[2], C4.reach);
    let pos;
    let veh = null;
    if (hit.box !== -1 && hit.t < C4.reach) {
      const t = Math.max(0, hit.t - 0.05);
      pos = [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
      const box = hit.box >= 0 ? this.map.boxes[hit.box] : null;
      if (box?.veh !== undefined) veh = box.veh;
    } else pos = [b.x - Math.sin(this.yaw) * 0.6, 0.06, b.z - Math.cos(this.yaw) * 0.6];
    this.net.send({ t: 'c4', a: 'plant', pos: pos.map((v) => +v.toFixed(2)), veh });
  }

  detonateC4() {
    if (!this.charges.mineCount()) return;
    this.net.send({ t: 'c4', a: 'det' });
  }

  quickPunch() {
    const now = performance.now();
    if (now - (this.local.lastPunch || 0) < 380) return;
    this.local.lastPunch = now;
    this.net.send({ t: 'melee', kind: 'punch' });
    this.vm.punch?.();
    audio.swing();
  }

  takePill() {
    if (!(this.me?.bloodpill > 0)) return this.hud.toast('You have no blood pills. Buy some at the armoury.', 'bad', 1500);
    if (this.me.health >= 100) return this.hud.toast('You never wound. Keep the pill.', 'info', 1300);
    this.net.send({ t: 'pill' });
  }

  medkit() {
    if (!(this.me.medkit > 0)) return this.hud.toast('You have no first aid. Buy some at the armoury.', 'bad', 1500);
    if (this.me.health >= 100) return;
    this.net.send({ t: 'medkit' });
    this.local.heal = performance.now() + GEAR.medkit.useTime * 1000;
  }

  downedMate() {
    let best = null;
    for (const p of this.latest) {
      if (p.id === this.myId || !(p.flags & 2) || this.roster.get(p.id)?.side !== this.side) continue;
      const d = Math.hypot(p.x - this.body.x, p.z - this.body.z);
      if (d < 2.3 && (!best || d < best.d)) best = { id: p.id, d };
    }
    return best;
  }

  tryRevive() {
    const m = this.downedMate();
    if (!m) return;
    this.net.send({ t: 'revive', target: m.id });
    this.reviving = { id: m.id, until: performance.now() + RESPAWN.reviveTime * 1000 };
  }

  startArtillery() {
    this.artilleryAim = true;
    this.aimRing.visible = true;
    this.hud.prompt('Aim at the ground, <kbd>click</kbd> to call artillery · <kbd>Esc</kbd> cancel');
  }

  cancelArtillery() {
    this.artilleryAim = false;
    if (this.aimRing) this.aimRing.visible = false;
    this.hud.prompt(null);
  }

  confirmArtillery() {
    if (!this.aimRing.visible) return;
    this.net.send({ t: 'streak', kind: 'artillery', x: +this.aimRing.position.x.toFixed(1), z: +this.aimRing.position.z.toFixed(1) });
    this.cancelArtillery();
  }

  // ---------- per-frame ----------
  frame() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.frame());
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    const now = performance.now();
    this.adaptResolution(raw);
    if (this.grade) this.grade.uniforms.uTime.value = (now / 1000) % 100;
    const sNow = this.net.serverNow();
    if (!this.me) {
      this.render();
      return;
    }
    const st = this.status;
    // Look.
    const look = this.input.takeLook();
    const zoom = this.zoom || 1;
    if (this.cams.look(look, zoom)) {
      /* flying the drone */
    } else if (st === 'alive' || st === 'spirit' || st === 'downed') {
      if (look.yaw || look.pitch) this.lastLookAt = now;
      this.yaw += look.yaw / zoom;
      this.pitch = clamp(this.pitch + look.pitch / zoom, -1.5, 1.5);
    }
    this.move(dt, now);
    this.cameraUpdate(dt, now, look);
    // Firing.
    if (st === 'alive' && !this.anyMenu() && !this.cams.blocksFire() && !this.adChat.open && (this.input.locked || isTouch())) {
      if (this.artilleryAim) this.aimArtillery();
      else if (this.input.firing() && !this.sprinting) this.tryFire(now);
    }
    if (!this.input.firing()) {
      this.local.trigger = true;
      if (now - this.local.lastFire > 300) this.local.burst = 0;
    }
    if (this.local.reloadUntil && now >= this.local.reloadUntil) this.finishReload();
    // Recoil recovery.
    const rec = Math.pow(0.003, dt);
    this.punch.p *= rec;
    this.punch.y *= rec;
    // Send state at 20 Hz.
    this.sendT += dt;
    if (this.sendT >= 1 / NET.sendHz) {
      this.sendT = 0;
      if (st === 'alive' || st === 'spirit') {
        this.net.send({ t: 'st', x: +this.body.x.toFixed(2), y: +this.body.y.toFixed(2), z: +this.body.z.toFixed(2), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), c: this.body.crouch ? 1 : 0, a: this.adsOn ? 1 : 0, r: this.sprinting ? 1 : 0, ...(this.driving.active ? { v: this.driving.stateMsg() } : {}) });
      }
    }
    // Advertiser views.
    this.viewsT += dt;
    if (this.viewsT > ADS.reportEveryMs / 1000) {
      this.viewsT = 0;
      if (st === 'alive' || st === 'spirit' || this.cams.mode === 'drone') {
        const slots = this.boards.visible(this.camera, this.map.index, lineBlocked, this.smokes || []);
        if (slots.length) this.net.send({ t: 'views', slots });
      }
    }
    this.updateSoldiers(dt, sNow);
    this.arena.update(dt, this.camera);
    this.ambience.update(dt, this.arena.time, this.camera);
    this.walls.update(dt, this.arena.time, sNow, this.camera);
    this.boards.update(dt, sNow);
    this.places.update(dt, sNow);
    this.tileGems.update(dt, this.arena.time, sNow);
    this.updateWarzone(dt, sNow);
    this.siteMarkers.update(dt, this.arena.time);
    this.fx.update(dt, this.camera);
    this.vm.update(dt, { speed: this.vel.length(), sprint: this.sprinting, ads: this.adsOn, crouch: this.body.crouch, onGround: this.body.onGround, look, landed: this.justLanded });
    this.justLanded = false;
    this.hudUpdate(dt, now, sNow);
    // Audio listener.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    // Flying the drone you still hear what is around your soldier.
    audio.setListener(this.cams.mode === 'drone' ? { x: this.body.x, y: this.body.y + this.eye, z: this.body.z } : this.camera.position, fwd, up);
    this.adChat.update(dt);
    this.render();
  }

  // Gunfire and blasts: dogs bolt, birds lift off.
  scareAnimals(x, z, r = 30) {
    this.dogs?.scare(x, z, r);
    this.ambience?.scare?.(x, z);
  }

  updateWarzone(dt, sNow) {
    this.crocs.update(dt, sNow, this.arena.time);
    this.dogs.update(dt, sNow, this.arena.time);
    const mine = this.driving.active ? this.driving.v.i : -1;
    this.vehicles.update(dt, sNow, this.arena.time, mine);
    this.houses.update(dt, this.arena.time);
    this.charges.update(dt);
    audio.sirens(this.ambulances.update(dt, sNow, this.arena.time));
    // Engines of the nearest other moving vehicles.
    const hums = [];
    for (const v of this.vehicles.list) if (v.i !== mine && Math.abs(v.speed) > 0.8 && v.state < 2) hums.push({ id: v.i, x: v.x, z: v.z, speed: v.speed, d: Math.hypot(v.x - this.body.x, v.z - this.body.z) });
    hums.sort((a, b) => a.d - b.d);
    audio.hums(hums.filter((h) => h.d < 70));
    // The camera swings round behind the vehicle when you are not looking around.
    if (this.driving.active && Math.abs(this.driving.v.speed) > 3 && performance.now() - (this.lastLookAt || 0) > 1300) {
      this.yaw = lerpAngle(this.yaw, this.driving.v.yaw, Math.min(1, dt * 1.6));
      this.pitch += (-0.12 - this.pitch) * Math.min(1, dt * 1.2);
    }
    // Graves and tombs: which one you could dig, dirt flying where someone digs.
    this.underworld.update(dt);
    this.nearGrave = this.status === 'alive' && !this.driving.active ? this.underworld.near(this.body.x, this.body.y, this.body.z, DIG.reach) : null;
    const digs = [...this.diggers.values()];
    if (this.digging) digs.push(this.digging.i);
    this.digT = (this.digT || 0) + dt;
    if (digs.length && this.digT > 0.45) {
      this.digT = 0;
      for (const i of digs) {
        const G = this.map.graves[i];
        if (!G) continue;
        const p = new THREE.Vector3(G.x, G.y + 0.3, G.z);
        for (let k = 0; k < 6; k++) this.fx.dust.spawn(p, { colour: G.kind === 'grave' ? '#6b4f35' : '#9a948a', size: 0.25, life: 0.9, v: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 2), g: 6, opacity: 0.9 });
        audio.dig?.({ x: G.x, y: G.y + 0.5, z: G.z }, G.kind !== 'grave');
      }
    }
    // Vehicle prompt and touch button.
    const near = !this.driving.active && this.status === 'alive' ? this.vehicles.nearest(this.body.x, this.body.z) : null;
    const key = near ? `in${near.i}` : this.driving.active ? 'out' : '';
    if (key !== this.vehKey) {
      this.vehKey = key;
      const p = $('veh-prompt');
      p.hidden = !near; // while driving the vehicle panel already says how to get out
      p.innerHTML = near ? `<kbd>E</kbd> Enter ${VEHICLES[near.type].name}${VEHICLES[near.type].armored ? ' 🛡' : ''}` : this.driving.active ? '<kbd>E</kbd> Get out' : '';
      const tb = $('touch')?.querySelector('.t-veh');
      if (tb) tb.hidden = !key;
    }
  }

  // Keep the game smooth: if frames are slow, render at a lower resolution
  // (down to the preset's floor); raise it again when there is headroom.
  adaptResolution(dt) {
    if (dt > 0.5) return; // tab was hidden
    this.ftAvg = (this.ftAvg ?? 1 / 60) * 0.95 + dt * 0.05;
    this.ftCheck = (this.ftCheck || 0) + dt;
    if (this.ftCheck < 2) return;
    this.ftCheck = 0;
    const max = Math.min(devicePixelRatio, this.quality.pixelRatio);
    const min = Math.min(max, this.quality.minPixelRatio ?? 0.75);
    let pr = this.pixelRatio;
    if (this.ftAvg > 1 / 40) pr = Math.max(min, pr - 0.15);
    else if (this.ftAvg < 1 / 57) pr = Math.min(max, pr + 0.1);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.resize();
    }
  }

  anyMenu() {
    return this.menus.buy || this.menus.pause || this.menus.chat || this.ended;
  }

  move(dt, now) {
    const st = this.status;
    if (this.driving.active) {
      if (st === 'alive') this.driving.step(dt);
      return;
    }
    const b = this.body;
    const inp = this.input;
    const f = FACTIONS[this.faction].perks;
    const mv = st === 'alive' || st === 'spirit' ? inp.move() : { x: 0, y: 0 };
    if ((this.anyMenu() && !this.menus.buy) || this.modes.frozen() || this.cams.blocksMovement() || this.adChat.open) {
      mv.x = mv.y = 0;
    }
    const droning = this.cams.blocksMovement() || this.adChat.open;
    // Wish direction in world space.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = mv.x * cos - mv.y * sin;
    let wz = -mv.x * sin - mv.y * cos;
    const w = WEAPONS[this.weapon()] || {};
    if (st === 'spirit') {
      // Spirits glide through walls.
      const sp = RESPAWN.spiritSpeed;
      b.x = clamp(b.x + wx * sp * dt, -this.map.half + 2, this.map.half - 2);
      b.z = clamp(b.z + wz * sp * dt, -this.map.half + 2, this.map.half - 2);
      b.y = 0;
      this.vel.set(wx * sp, wz * sp);
      this.sprinting = false;
      this.adsOn = false;
      return;
    }
    if (st !== 'alive') {
      this.vel.set(0, 0);
      this.sprinting = false;
      this.adsOn = false;
      return;
    }
    // Crouch (hold Ctrl or C), can't stand up under a low roof.
    const wantCrouch = !droning && (inp.down('ControlLeft') || inp.down('ControlRight') || inp.down('KeyC') || inp.touch.crouch);
    if (wantCrouch) b.crouch = true;
    else if (b.crouch && !insideAnyBox(this.map.index, b.x, b.y, b.z, false)) b.crouch = false;
    const forward = mv.y > 0.3;
    const wantSprint = (inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.touch.sprint) && forward && !b.crouch;
    this.adsOn = inp.aiming() && !this.anyMenu() && !w.melee && !droning;
    this.sprinting = wantSprint && this.stamina > 0.2 && !this.adsOn && !this.local.reloadUntil;
    const sk = this.me?.skills || { swim: 0, fitness: 0 };
    const maxStam = staminaFor(sk.fitness, PLAYER.stamina);
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt);
    else this.stamina = Math.min(maxStam, this.stamina + dt * 0.8);
    let speed = PLAYER.jog;
    if (this.sprinting) speed = PLAYER.run * sprintFor(sk.fitness);
    else if (inp.down('KeyZ')) speed = PLAYER.slow;
    if (b.crouch) speed = PLAYER.crouchSpeed;
    if (this.adsOn) speed *= PLAYER.adsSpeed + 0.2;
    speed *= (w.speed || 1) * (f.speedMult || 1);
    if (b.y < 0.1 && this.arena.inWater(b.x, b.z)) {
      const deep = deepWater(this.map, b.x, b.z);
      speed *= PLAYER.waterSpeed * (f.swimMult || 1) * swimFactor(sk.swim, deep);
      // Deep water without the skill: say so plainly (the server makes you go under).
      if (deep && sk.swim < SKILLS.swim.canSwimAt && now - (this.swimWarnAt || 0) > 6000) {
        this.swimWarnAt = now;
        $('tint').className = 'drowning';
        setTimeout(() => $('tint').className === 'drowning' && ($('tint').className = ''), 1500);
      }
    }
    if (this.local.heal > now) speed *= 0.5;
    const accel = b.onGround ? 14 : 2.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.y += (wz * speed - this.vel.y) * k;
    const jump = !droning && inp.down('Space') && b.onGround && !b.crouch;
    const wasGround = b.onGround;
    const vyBefore = b.vy;
    const before = { x: b.x, z: b.z };
    moveBody(b, this.vel.x, this.vel.y, dt, this.map.index, this.map.half, jump);
    if (jump) audio.jumpGrunt();
    if (!wasGround && b.onGround && vyBefore < -4) {
      this.justLanded = true;
      audio.land(this.arena.surfaceAt(b.x, b.y, b.z), null);
    }
    // Footsteps.
    const moved = Math.hypot(b.x - before.x, b.z - before.z);
    if (b.onGround) {
      this.stepDist += moved;
      const stride = this.sprinting ? 2.6 : b.crouch ? 1.4 : 2.1;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const quiet = b.crouch || inp.down('KeyZ') || f.quietSteps;
        audio.footstep(this.arena.surfaceAt(b.x, b.y, b.z), null, this.sprinting ? 0.9 : quiet ? 0.25 : 0.55);
      }
    }
  }

  cameraUpdate(dt, now, look) {
    const b = this.body;
    const st = this.status;
    const cam = this.camera;
    const dv = this.driving.active ? VEHICLES[this.driving.v.type] : null;
    const targetEye = dv ? dv.eye - dv.seatY : st === 'downed' ? 0.45 : b.crouch ? PLAYER.crouchEye : PLAYER.eye;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    // ADS zoom.
    const w = WEAPONS[this.weapon()];
    const scoped = this.adsOn && w?.zoom;
    const zoomTarget = this.adsOn ? (w?.zoom || (w?.slot === 'secondary' ? 1.12 : 1.3)) : 1;
    this.zoom = (this.zoom || 1) + (zoomTarget - (this.zoom || 1)) * Math.min(1, dt * 14);
    const fov = this.settings.fov / this.zoom;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // Sniper scope sway; hold Shift to steady your breath for a few seconds.
    const scopedIn = !!scoped && this.zoom > 2.5;
    this.breath ??= 4;
    const holding = scopedIn && (this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && this.breath > 0;
    this.breath = holding ? Math.max(0, this.breath - dt) : Math.min(4, this.breath + dt * 0.6);
    this.swayT = (this.swayT || 0) + dt;
    const amp = scopedIn ? (holding ? 0.0003 : this.breath <= 0.05 ? 0.007 : 0.0035) * (this.body.crouch ? 0.6 : 1) : 0;
    this.sway = { y: Math.sin(this.swayT * 0.9) * amp + Math.sin(this.swayT * 2.3) * amp * 0.3, p: Math.sin(this.swayT * 1.3 + 1) * amp * 0.8 };
    this.vm.visible = st === 'alive' && !(scoped && this.zoom > 2.5) && !this.cams.thirdPerson() && this.cams.mode !== 'drone';
    this.hud.scope(!!scoped && this.zoom > 2.5 && this.cams.mode !== 'drone');
    if (this.cams.apply(dt, now)) return;
    if (st === 'dead' || st === 'medevac') {
      // Death cam: orbit your body; medevac rises into the sky.
      const t = now / 1000;
      const high = st === 'medevac' ? 14 + Math.min(20, (now - (this.medevacStart ||= now)) / 1000) : 3.5;
      const r = st === 'medevac' ? 12 : 4.5;
      cam.position.set(b.x + Math.cos(t * 0.3) * r, b.y + high, b.z + Math.sin(t * 0.3) * r);
      cam.lookAt(b.x, b.y + 0.4, b.z);
      return;
    }
    this.medevacStart = 0;
    // Head bob and shake.
    const moving = this.vel.length() > 0.5 && b.onGround;
    this.bobT = (this.bobT || 0) + dt * (this.sprinting ? 13 : 8.5) * (moving ? 1 : 0);
    const bob = moving ? Math.sin(this.bobT * 2) * (this.sprinting ? 0.045 : 0.022) * (this.adsOn ? 0.3 : 1) : 0;
    const sh = this.fx.shake;
    cam.position.set(b.x + (Math.random() - 0.5) * sh * 0.08, b.y + this.eye + bob + (Math.random() - 0.5) * sh * 0.08, b.z);
    cam.rotation.set(this.pitch + this.punch.p + (this.sway?.p || 0) + (Math.random() - 0.5) * sh * 0.02, this.yaw + this.punch.y + (this.sway?.y || 0), (st === 'downed' ? 0.25 : 0) + (moving ? Math.sin(this.bobT) * 0.004 : 0));
  }

  aimArtillery() {
    const d = dirFromAngles(this.yaw, this.pitch);
    const p = this.camera.position;
    const hit = raycast(this.map.index, p.x, p.y, p.z, d[0], d[1], d[2], 220);
    const t = hit.t;
    this.aimRing.position.set(p.x + d[0] * t, 0.15, p.z + d[2] * t);
    this.aimRing.visible = hit.box !== -1;
  }

  // ---------- remote fighters ----------
  updateSoldiers(dt, sNow) {
    const rt = sNow - NET.interpDelayMs;
    for (const [id, buf] of this.buffers) {
      if (!buf.length) continue;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= rt) {
          a = buf[i - 1];
          b = buf[i];
          break;
        }
      }
      const k = b.t === a.t ? 1 : clamp((rt - a.t) / (b.t - a.t), 0, 1.2);
      const s = {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        yaw: lerpAngle(a.yaw, b.yaw, k),
        pitch: a.pitch + (b.pitch - a.pitch) * k,
        flags: b.flags,
        w: b.w,
        hp: b.hp
      };
      s.sink = s.y < 0.1 && this.arena.inWater(s.x, s.z) ? 0.35 : 0;
      let sol = this.soldiers.get(id);
      const r = this.roster.get(id);
      if (sol && r && sol.info.faction !== r.faction) {
        sol.dispose();
        this.soldiers.delete(id);
        sol = null;
      }
      if (!sol) {
        const faction = r?.faction || (b.hp >= 0 ? this.faction : this.side === 'sec' ? 'bandit' : 'police');
        sol = new Soldier(this.scene, { id, faction }, (r?.side || (b.hp >= 0 ? this.side : null)) === this.side);
        this.soldiers.set(id, sol);
        sol.last.x = s.x;
        sol.last.z = s.z;
      }
      sol.state = s;
      // Inside a car you can't see them through the tinted glass; on an okada or keke you can.
      const ride = s.flags & 4096 ? this.vehicles.byDriver(id) : null;
      if (ride) s.yaw = ride.yaw;
      sol.update(dt, s, this.arena.time);
      if (ride && !ride.def.open) sol.root.visible = false;
      // Remote footsteps.
      if (!(s.flags & (2 | 4 | 256)) && s.y < 2.5) {
        const dist = Math.hypot(s.x - this.body.x, s.z - this.body.z);
        sol.stepAcc = (sol.stepAcc || 0) + sol.speed * dt;
        const stride = s.flags & 128 ? 2.6 : 2.1;
        if (sol.stepAcc > stride) {
          sol.stepAcc = 0;
          const quiet = s.flags & 1 || sol.speed < 2.4 || FACTIONS[r?.faction]?.perks.quietSteps;
          if (dist < 38 && !quiet) audio.footstep(this.arena.surfaceAt(s.x, s.y, s.z), { x: s.x, y: s.y, z: s.z }, s.flags & 128 ? 0.95 : 0.6);
        }
      }
    }
    // Your own body for the death cam.
    const own = this.ownSoldier;
    const dead = this.status === 'dead' || this.status === 'medevac';
    const dv = this.driving.active ? VEHICLES[this.driving.v.type] : null;
    const shown = (this.cams.thirdPerson() || this.cams.mode === 'drone') && (this.status === 'alive' || this.status === 'downed') && !(dv && !dv.open);
    own.visible = dead || shown;
    if (dead) own.update(dt, { x: this.body.x, y: this.body.y, z: this.body.z, yaw: this.yaw, pitch: 0, flags: 256, w: this.weapon() || 'p9' }, this.arena.time);
    else if (shown) {
      const flags = (this.body.crouch || dv ? 1 : 0) | (this.status === 'downed' ? 2 : 0) | (this.sprinting ? 128 : 0);
      own.update(dt, { x: this.body.x, y: this.body.y, z: this.body.z, yaw: dv ? this.driving.v.yaw : this.yaw, pitch: this.pitch, flags, w: this.weapon() || 'p9', hp: this.me?.health ?? 100 }, this.arena.time);
    } else own.root.visible = false;
  }

  // ---------- HUD ----------
  hudUpdate(dt, now, sNow) {
    const m = this.me;
    const st = this.status;
    this.hud.timers(st, m, sNow);
    this.waitAds.update(now, sNow);
    this.hud.score(this.score, null, this.msLeft - (now - this.leftAt));
    this.modes.update(dt, sNow);
    this.hud.stamina(this.stamina / staminaFor(this.me?.skills?.fitness || 0, PLAYER.stamina));
    // Crosshair grows with spread.
    const w = WEAPONS[this.weapon()];
    const spread = this.spreadNow(w, this.vel.length());
    const px = (Math.tan(spread) / Math.tan((this.camera.fov * Math.PI) / 360)) * (innerHeight / 2);
    this.hud.crosshair(4 + px, st === 'alive' && !(this.adsOn && w && !w.pellets) && !this.anyMenu(), this.sprinting ? 'rgba(255,255,255,0.3)' : '#fff');
    // Prompts.
    let prompt = null;
    if (st === 'alive' && !this.artilleryAim) {
      const mate = this.downedMate();
      if (mate) prompt = `<kbd>E</kbd> Revive ${this.roster.get(mate.id)?.name || 'your person'}`;
      else if (this.inBuyZone() && sNow < (m.buyUntil || 0)) prompt = `<kbd>${isTouch() ? '₦' : 'B'}</kbd> Buy weapon · ${Math.ceil((m.buyUntil - sNow) / 1000)}s`;
    }
    if (!prompt && st === 'alive') prompt = this.modes.prompt();
    if (st === 'alive' && this.digging) {
      const pct = Math.min(100, ((now - this.digging.start) / (this.digging.secs * 1000)) * 100);
      const kind = this.map.graves[this.digging.i]?.kind;
      prompt = `${kind === 'tomb' ? 'Pushing the lid' : kind === 'cache' ? 'Forcing the chest' : 'Digging'}… <span class="dig-bar"><i style="width:${pct.toFixed(0)}%"></i></span>`;
    } else if (!prompt && st === 'alive' && this.nearGrave && !this.driving.active) prompt = `<kbd>E</kbd> Hold to ${{ tomb: 'open the tomb', cache: 'open the old chest' }[this.nearGrave.g.kind] || 'dig the grave'}`;
    if (!this.artilleryAim) this.hud.prompt(prompt);
    if (isTouch()) this.syncTouch(st, m);
    // "Click to fight" whenever the mouse is free during play (desktop only).
    const ctp = isTouch() || this.input.locked || this.anyMenu() || !(st === 'alive' || st === 'spirit');
    if (ctp !== this.ctpHidden) {
      this.ctpHidden = ctp;
      $('click-to-play').hidden = ctp;
    }
    // Progress bars: revive, medkit.
    if (this.reviving && now < this.reviving.until && this.downedMate()?.id === this.reviving.id) this.hud.progress(1 - (this.reviving.until - now) / (RESPAWN.reviveTime * 1000), 'Reviving…');
    else if (this.local.heal > now) this.hud.progress(1 - (this.local.heal - now) / (GEAR.medkit.useTime * 1000), 'Using first aid…');
    else if (this.modes.progress(sNow)) this.hud.progress(...this.modes.progress(sNow));
    else this.hud.progress(null);
    if (this.reviving && now > this.reviving.until) this.reviving = null;
    // Heartbeat when hurt.
    if (st === 'alive' && m.health < 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.75;
        audio.heartbeat(1 - m.health / 30);
      }
    }
    // Spirit compass to the nearest glowing gem.
    if (st === 'spirit') {
      const i = this.walls.nearestReady(this.body.x, this.body.z, sNow);
      if (i >= 0) {
        const g = this.map.adWalls[i].gem;
        const dx = g.x - this.body.x;
        const dz = g.z - this.body.z;
        const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
        const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
        const ang = Math.atan2(dx * r[0] + dz * r[1], dx * f[0] + dz * f[1]);
        $('spirit-arrow').style.transform = `rotate(${ang - Math.PI / 2}rad)`;
      }
    }
    // Radar at 15 Hz, labels at 30 Hz.
    this.radarT += dt;
    if (this.radarT > 1 / 15) {
      this.radarT = 0;
      this.hud.drawRadar({ me: this.body, yaw: this.yaw, players: this.latest, sites: this.sites, walls: this.map.adWalls, gemsReady: this.walls.walls.map((x) => x.until <= sNow), uav: this.uavUntil > sNow, myId: this.myId, mySide: this.side, range: 60 });
    }
    this.labelsT += dt;
    if (this.labelsT > 1 / 30) {
      this.labelsT = 0;
      this.hud.worldLabels(this.camera, this.labelItems(sNow));
    }
  }

  // Show only the touch buttons that make sense right now.
  syncTouch(st, m) {
    const drone = this.cams?.mode === 'drone';
    const show = !this.ended && !this.menus.buy && !this.menus.pause && !this.menus.score && !this.adChat?.open && (drone || st === 'alive' || st === 'spirit' || st === 'downed');
    const combat = st === 'alive' && !drone;
    const use = combat && (!!this.downedMate() || !!this.modes.availableAction() || !!this.nearGrave || !!this.digging);
    const med = combat && m.medkit > 0 && m.health < 100;
    const pill = combat && m.bloodpill > 0 && m.health < 100;
    const c4 = combat && m.c4 > 0 && !this.driving.active;
    const det = (combat || st === 'downed') && this.charges.mineCount() > 0;
    const amb = combat && m.health <= 70 && m.money >= AMBULANCE.fee && m.veh == null && this.net.serverNow() >= (m.ambReady || 0);
    const key = `${show}${combat}${use}${med}${drone}${pill}${c4}${det}${amb}`;
    if (key === this.touchKey) return;
    this.touchKey = key;
    const t = $('touch');
    t.hidden = !show;
    t.classList.toggle('combat-off', !combat);
    t.classList.toggle('drone', drone);
    t.querySelector('.t-use').hidden = !use;
    t.querySelector('.t-med').hidden = !med;
    t.querySelector('.t-pill').hidden = !pill;
    t.querySelector('.t-c4').hidden = !c4;
    t.querySelector('.t-det').hidden = !det;
    t.querySelector('.t-amb').hidden = !amb;
    if (!show || !combat) this.input.resetTouch(t);
  }

  labelItems(sNow) {
    const items = [];
    const me = this.body;
    const rival = this.me?.rival;
    for (const [id, s] of this.soldiers) {
      if (rival && s.visible && s.state && !s.isMate && !(s.state.flags & (256 | 4))) {
        const r = this.roster.get(id);
        const plain = (r?.name || '').replace(/^\[[A-Z0-9]+\] /, '');
        if (plain === rival) {
          const d = Math.hypot(s.state.x - me.x, s.state.z - me.z);
          const cam = this.camera.position;
          if (d < 80 && !lineBlocked(this.map.index, cam.x, cam.y, cam.z, s.state.x, s.state.y + 1.6, s.state.z, this.smokes || [])) items.push({ x: s.state.x, y: s.state.y + 2.15, z: s.state.z, cls: 'lab rival', html: `⚔ RIVAL · ${plain.replace(/[<>&]/g, '')}` });
        }
      }
      if (!s.visible || !s.state || !s.isMate) continue;
      const r = this.roster.get(id);
      const d = Math.hypot(s.state.x - me.x, s.state.z - me.z);
      if (d > 90) continue;
      const f = s.state.flags;
      if (f & 256) continue;
      if (f & 2) {
        items.push({ x: s.state.x, y: s.state.y + 0.8, z: s.state.z, cls: 'downmark', html: `✚<br>${r?.name || ''}`, clamp: d < 40 });
        continue;
      }
      const hp = Math.max(0, s.state.hp);
      items.push({ x: s.state.x, y: s.state.y + 2.05, z: s.state.z, cls: `lab ${this.side}`, html: `${(r?.name || '').replace(/[<>&]/g, '')}${f & 4 ? ' 👻' : ''}<span class="hpb"><i style="width:${hp}%"></i></span>`, opacity: d > 50 ? 0.6 : 1 });
    }
    for (const s of this.sites) {
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      const col = s.owner === 'sec' ? '#7fb6ff' : s.owner === 'out' ? '#ff8a80' : s.id === 'D' ? '#ffc13b' : '#fff';
      items.push({ x: s.x, y: 4, z: s.z, cls: 'site', html: `<span style="color:${col}">${s.id === 'D' ? '◆' : s.id}</span><small>${Math.round(d)} m</small>`, clamp: true, opacity: d < 12 ? 0.3 : 0.9 });
    }
    this.modes.labels(items);
    if (this.status === 'spirit') {
      this.map.adWalls.forEach((a, i) => {
        if (this.walls.walls[i].until > sNow) return;
        items.push({ x: a.gem.x, y: a.gem.y + 0.6, z: a.gem.z, cls: 'gemmark', html: '💎', clamp: true });
      });
    }
    return items;
  }

  render() {
    if (!this.scene) return;
    if (this.composer) this.composer.render();
    else {
      const r = this.renderer;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
      r.autoClear = true;
    }
  }
}
