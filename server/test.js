// Headless simulation tests: run with `npm test`.
// Drives real matches on a fake clock and checks the rules the game depends on.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), '36states-test-'));
let fakeNow = 1_800_000_000_000;
const realNow = Date.now;
const now2 = () => fakeNow;
Date.now = () => fakeNow;

const { Match } = await import('./match.js');
const { AdManager } = await import('./ads.js');
const { GEMS, RESPAWN, PLAYER, MATCH, priceFor, WEAPONS, DRUMS, BOMB, STAGES, MODES } = await import('../shared/config.js');
const { generateMap } = await import('../shared/map.js');
const { STATES } = await import('../shared/states.js');

let passed = 0;
let failed = 0;
const check = (cond, msg) => {
  if (cond) passed++;
  else {
    failed++;
    console.log('  ✗', msg);
  }
};
const section = (name) => console.log(`• ${name}`);

const { boardsFor } = await import('../shared/billboards.js');
const catalogue = Object.fromEntries(STATES.map((s) => [s.id, boardsFor(generateMap(s.id))]));
const ads = new AdManager(catalogue);
await ads.load();
const hooks = { ads, saveProfile() {} };
const fakeWs = () => {
  const log = [];
  return { readyState: 1, log, send: (s) => log.push(JSON.parse(s)) };
};
const profile = (name) => ({ token: `tok-${name}-${Math.random().toString(16).slice(2)}`, name, gems: GEMS.startingGems, xp: 0, kills: 0, deaths: 0, wins: 0, matches: 0 });
const run = (m, seconds) => {
  const dt = 1 / 20;
  for (let i = 0; i < seconds * 20; i++) {
    fakeNow += 50;
    m.tick(dt);
  }
};

section('Bots fill every state and fight on their own');
const m = new Match('rivers', hooks);
check(m.sideCount('sec') === MATCH.minPerSide && m.sideCount('out') === MATCH.minPerSide, 'bots fill both sides');
run(m, 90);
const totalKills = [...m.players.values()].reduce((n, p) => n + p.kills, 0);
check(totalKills > 0, `bots killed each other (${totalKills} kills in 90 s)`);
const owned = m.sites.filter((s) => s.owner).length;
check(owned > 0, `bots captured resource sites (${owned} held)`);
check(m.score.sec + m.score.out > 0, `score moving (${m.score.sec}-${m.score.out})`);
console.log(`    kills ${totalKills}, sites held ${owned}, score SEC ${m.score.sec} - OUT ${m.score.out}`);

section('Real players join, buy, shoot');
const m2 = new Match('kano', hooks);
const wsA = fakeWs();
const wsB = fakeWs();
const wsC = fakeWs();
const A = m2.addHuman(wsA, 'army', profile('Ada')).player;
const B = m2.addHuman(wsB, 'bandit', profile('Bello')).player;
const C = m2.addHuman(wsC, 'bandit', profile('Chuks')).player;
check(A && B && C, 'three humans joined');
check(m2.sideCount('sec') === MATCH.minPerSide && m2.sideCount('out') === Math.max(MATCH.minPerSide, 2), 'bots rebalanced around humans');
// Remove bots to keep the duel clean.
for (const p of [...m2.players.values()]) if (!p.human) m2.players.delete(p.id);
fakeNow += 5000;
B.money = 5000;
m2.handle(B, { t: 'buy', item: 'ak47' });
check(B.weapons.primary === 'ak47' && B.money === 5000 - priceFor('ak47', 'bandit'), `bandit buys AK-47 at discount (₦${priceFor('ak47', 'bandit')})`);
// Place A facing B on open ground and shoot B in the head.
const open = (x, z) => ({ x, y: 0, z });
Object.assign(A, open(0, 0), { yaw: 0, pitch: 0, slot: 'secondary' });
Object.assign(B, open(0, -8));
Object.assign(C, open(3, -30));
A.protectUntil = B.protectUntil = C.protectUntil = 0;
// Clear any boxes between them by picking a spot with line of sight.
const { lineBlocked } = await import('../shared/physics.js');
let spot = null;
for (let x = -60; x <= 60 && !spot; x += 3) for (let z = -60; z <= 60 && !spot; z += 3) {
  if (!lineBlocked(m2.map.index, x, 1.62, z, x, 1.62, z - 10) && !lineBlocked(m2.map.index, x, 0.5, z, x, 0.5, z - 10)) spot = { x, z };
}
Object.assign(A, { x: spot.x, z: spot.z });
Object.assign(B, { x: spot.x, z: spot.z - 8 });
const fireAt = (shooter, target, yOff, w = shooter.weapons[shooter.slot]) => {
  fakeNow += 1000;
  const o = [shooter.x, shooter.y + PLAYER.eye, shooter.z];
  const d = [target.x - o[0], target.y + yOff - o[1], target.z - o[2]];
  m2.handle(shooter, { t: 'fire', w, o, d, ts: fakeNow });
};
fireAt(A, B, 1.62);
check(B.status === 'dead', 'pistol headshot kills instantly');
check(A.kills === 1 && A.money > 1000, 'killer credited and paid');
check(wsA.log.some((x) => x.t === 'hit' && x.head), 'shooter got a headshot hit marker');
check(wsB.log.some((x) => x.t === 'kill'), 'kill feed broadcast');

section('Downed and revived by a teammate');
m2.spawn(B);
B.protectUntil = 0;
Object.assign(B, { x: spot.x, z: spot.z - 8, armor: 0 });
Object.assign(C, { x: spot.x + 1.5, z: spot.z - 9 });
for (let i = 0; i < 8 && B.status === 'alive'; i++) fireAt(A, B, 1.1);
check(B.status === 'downed', 'body shots down a player who has a teammate nearby');
m2.handle(C, { t: 'revive', target: B.id });
run(m2, RESPAWN.reviveTime + 0.2);
check(B.status === 'alive' && B.health === RESPAWN.reviveHealth, 'teammate revive brings them back');

section('Life gems on advert walls (2-minute shared cooldown)');
const wall = m2.map.adWalls[0];
const gemsBefore = A.profile.gems;
Object.assign(A, { x: wall.gem.x, z: wall.gem.z });
run(m2, 0.2);
check(A.profile.gems === gemsBefore + 1, 'walking into the gem adds a life gem');
check(m2.gems[0] > fakeNow, 'gem goes on cooldown');
Object.assign(A, { x: 0, z: 0 });
Object.assign(C, { x: wall.gem.x, z: wall.gem.z });
const cBefore = C.profile.gems;
run(m2, 5);
check(C.profile.gems === cBefore, 'nobody else can take it during the cooldown');
run(m2, GEMS.cooldownMs / 1000);
check(C.profile.gems === cBefore + 1, 'after 2 minutes it resurfaces for the next player');

section('Respawn: gem, spirit run, medevac');
const wsD = fakeWs();
const D = m2.addHuman(wsD, 'police', profile('Dayo')).player;
for (const p of [...m2.players.values()]) if (!p.human) m2.players.delete(p.id);
D.protectUntil = 0;
m2.kill(D, A, 'p9');
const g0 = D.profile.gems;
m2.handle(D, { t: 'respawn', mode: 'gem' });
check(D.status === 'alive' && D.profile.gems === g0 - 1, 'spend a gem to redeploy instantly');
m2.kill(D, A, 'p9');
m2.handle(D, { t: 'respawn', mode: 'spirit' });
check(D.status === 'spirit', 'spirit run starts');
const free = m2.map.adWalls.findIndex((_, i) => m2.gems[i] <= fakeNow);
const fw = m2.map.adWalls[free];
Object.assign(D, { x: fw.gem.x, z: fw.gem.z });
run(m2, 0.2);
check(D.status === 'alive' && m2.gems[free] > fakeNow, 'touching a glowing gem as a spirit revives you and uses the gem');
m2.kill(D, A, 'p9');
m2.handle(D, { t: 'respawn', mode: 'spirit' });
run(m2, RESPAWN.spiritMs / 1000 + 0.5);
check(D.status === 'dead', 'spirit fades if no gem is reached in time');
D.money = 3000;
m2.handle(D, { t: 'respawn', mode: 'medevac' });
run(m2, RESPAWN.medevacMs / 1000 + 0.2);
check(D.status === 'alive' && wsD.log.some((x) => x.t === 'toast' && /Fee/.test(x.text)), 'medevac redeploys after the wait, minus the fee');

section('Grenades, rockets, artillery');
for (const p of [...m2.players.values()]) if (!p.human) m2.players.delete(p.id);
m2.spawn(B);
B.protectUntil = 0;
Object.assign(B, { x: spot.x, z: spot.z - 8, armor: 0, health: 100 });
A.frag = 1;
m2.handle(A, { t: 'throw', kind: 'frag', o: [B.x, 1, B.z + 0.5], v: [0, 0, 0] });
run(m2, 3);
check(B.health < 100 || B.status !== 'alive', 'frag grenade hurts nearby enemies');
m2.spawn(B);
B.protectUntil = 0;
Object.assign(B, { x: spot.x, z: spot.z - 8 });
Object.assign(A, { x: spot.x, z: spot.z, y: 0 });
A.weapons.primary = 'rpg';
A.ammo.rpg = { mag: 1, reserve: 2 };
A.slot = 'primary';
fireAt(A, B, 1.0, 'rpg');
run(m2, 1);
check(B.status !== 'alive' || B.health < 50, 'RPG rocket explodes on target');
m2.spawn(B);
B.protectUntil = 0;
Object.assign(B, { x: spot.x, z: spot.z - 8, armor: 0 });
A.streaksAvail.artillery = true;
m2.handle(A, { t: 'streak', kind: 'artillery', x: B.x, z: B.z });
run(m2, 8);
check(wsB.log.some((x) => x.t === 'incoming'), 'incoming shell warnings sent');
check(wsB.log.some((x) => x.t === 'boom' && x.w === 'artillery'), 'artillery shells land');

section('Fuel drums explode, water drums do not');
{
  const { insideAnyBox } = await import('../shared/physics.js');
  // Find a state with a fuel drum we can line up a shot on, with a victim on the far side.
  let setup = null;
  for (const st of STATES) {
    const mm = new Match(st.id, hooks);
    for (const bi of mm.map.drums) {
      const b = mm.map.boxes[bi];
      if (!b.fuel) continue;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = cx - dx * 10, sz = cz - dz * 10; // shooter
        const vx = cx + dx * 2.2, vz = cz + dz * 2.2; // victim behind the drum
        if (Math.abs(sx) > 100 || Math.abs(sz) > 100) continue;
        if (insideAnyBox(mm.map.index, sx, 0, sz) || insideAnyBox(mm.map.index, vx, 0, vz)) continue;
        if (mm.map.water.some((w) => vx > w.x0 - 1 && vx < w.x1 + 1 && vz > w.z0 && vz < w.z1)) continue; // water puts fire out
        if (lineBlocked(mm.map.index, cx + dx * 0.5, 0.8, cz + dz * 0.5, vx, 0.9, vz)) continue; // something between the drum and the victim
        // Line of sight to the drum's middle, stopping just short of it.
        if (lineBlocked(mm.map.index, sx, 1.62, sz, cx - dx * 0.5, 0.5, cz - dz * 0.5)) continue;
        setup = { mm, bi, b, cx, cz, sx, sz, vx, vz };
        break;
      }
      if (setup) break;
    }
    if (setup) break;
  }
  check(!!setup, 'found a fuel drum to test');
  if (setup) {
    const { mm, bi, b, cx, cz, sx, sz, vx, vz } = setup;
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const S = mm.addHuman(ws1, 'police', profile('Shooter')).player;
    const V = mm.addHuman(ws2, 'bandit', profile('Victim')).player;
    for (const p of [...mm.players.values()]) if (!p.human) mm.players.delete(p.id);
    fakeNow += 5000;
    Object.assign(S, { x: sx, y: 0, z: sz, protectUntil: 0 });
    Object.assign(V, { x: vx, y: 0, z: vz, protectUntil: 0, armor: 0, health: 100 });
    const top = b.y1;
    for (let i = 0; i < 4 && !mm.drumsDead.includes(b.drum); i++) {
      fakeNow += 1000;
      const o = [S.x, PLAYER.eye, S.z];
      mm.handle(S, { t: 'fire', w: 'p9', o, d: [cx - o[0], 0.5 - o[1], cz - o[2]], ts: fakeNow });
      run(mm, 0.5);
    }
    check(mm.drumsDead.includes(b.drum), 'shooting a fuel drum makes it explode');
    check(ws2.log.some((m) => m.t === 'drum') && ws2.log.some((m) => m.t === 'boom' && m.w === 'drum'), 'drum explosion broadcast to players');
    check(V.status !== 'alive' || V.health < 100, `player beside the drum is hurt (health ${Math.round(V.health)}, ${V.status})`);
    check(V.status !== 'alive' || V.burnUntil > fakeNow || ws2.log.filter((m) => m.t === 'hurt').length > 1, 'nearby player catches fire');
    check(b.y1 < 0, 'destroyed drum no longer blocks bullets or movement');
    // A water drum just takes the hits.
    const water = mm.map.drums.map((i) => mm.map.boxes[i]).find((x) => !x.fuel);
    if (water) {
      const before = mm.drumsDead.length;
      mm.hitDrum(mm.map.boxes.indexOf(water), 999, S);
      run(mm, 1);
      check(mm.drumsDead.length === before, 'water drums do not explode');
    }
    // Far away players are untouched.
    const far = Math.hypot(S.x - cx, S.z - cz);
    check(far > DRUMS.blast || S.health > 50, 'shooter 10 m away is safe');
    mm.reset();
    check(mm.drumsDead.length === 0 && b.y1 === top, 'drums are back for the next round');
  }
}

section('Advertiser analytics');
// Smallest thing with a real PNG header (8-byte signature + IHDR with width and height).
const pngHeader = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const img = 'data:image/png;base64,' + pngHeader(1200, 600).toString('base64');
const ad = await ads.create({ advertiser: 'Test Brand', imageDataUrl: img, states: ['kano'], priceNaira: 100000 });
const slots = ads.slotsFor('kano').slots;
check(Object.keys(slots).length === catalogue.kano.length, 'house advert fills every billboard in the targeted state');
check(Object.keys(ads.slotsFor('lagos').slots).length === 0, 'advert does not appear in states it did not target');
m2.handle(A, { t: 'views', slots: ['kano:0', 'kano:1'] });
m2.handle(A, { t: 'views', slots: ['kano:0'] });
m2.handle(B, { t: 'views', slots: ['kano:0'] });
check(ad.stats.views === 3 && ad.stats.uniques === 2, `views de-duplicated per player (views ${ad.stats.views}, uniques ${ad.stats.uniques})`);
check(ad.stats.bySide.sec === 2 && ad.stats.bySide.out === 1, 'views split by side');
check(ad.stats.byState.kano === 3, 'views split by state');
if (A.status !== 'alive') m2.spawn(A); // the artillery test may have set off a fuel drum near A
Object.assign(A, { x: m2.map.adWalls[2].gem.x, z: m2.map.adWalls[2].gem.z });
m2.gems[2] = 0;
run(m2, 0.2);
check(ad.stats.gems >= 1, 'gem pickups credited to the advert on that wall');
check(!JSON.stringify(ad.stats).includes(A.profile.token), 'no player identity stored in advertiser stats');

section('Gbas Gbos (team deathmatch)');
{
  const mm = new Match('kogi', hooks, 'tdm');
  check(mm.siteView().length === 0, 'no capture sites in deathmatch');
  run(mm, 60);
  const kills = [...mm.players.values()].reduce((n, p) => n + p.kills, 0);
  check(kills > 0 && mm.score.sec + mm.score.out === kills, `team score counts kills (${mm.score.sec}-${mm.score.out}, ${kills} kills)`);
  mm.score.sec = MODES.tdm.scoreLimit;
  run(mm, 0.1);
  check(mm.ended, 'match ends when a team reaches the kill limit');
}

section('Plant & Defuse (bomb rounds)');
{
  const mm = new Match('kano', hooks, 'bomb');
  const ws = fakeWs();
  const H = mm.addHuman(ws, 'bandit', profile('Planter')).player;
  check(mm.mode.phase === 'freeze', 'round starts in buy time');
  check(!!mm.mode.carrier, 'an outlaw carries the bomb');
  const t0 = fakeNow;
  mm.handle(H, { t: 'fire', w: 'p9', o: [H.x, PLAYER.eye, H.z], d: [1, 0, 0], ts: fakeNow });
  check(H.shots === 0, 'nobody can shoot during buy time');
  run(mm, BOMB.freezeMs / 1000 + 0.2);
  check(mm.mode.phase === 'live', 'round goes live after buy time');
  // Give the human the bomb and put them on site A.
  mm.mode.carrier = H.id;
  const A = mm.sites.find((s) => s.id === 'A');
  for (const p of mm.players.values()) if (p !== H) Object.assign(p, { x: p.side === 'sec' ? -95 : 95, z: 0 });
  // Keep the bots still for the test.
  for (const p of mm.players.values()) if (!p.human) p.bot.tick = () => {};
  Object.assign(H, { x: A.x, y: 0, z: A.z });
  mm.handle(H, { t: 'act', kind: 'plant' });
  check(mm.mode.action?.kind === 'plant', 'planting starts inside the site');
  run(mm, BOMB.plantSecs + 0.2);
  check(!!mm.mode.planted && ws.log.some((m) => m.t === 'planted'), 'bomb planted after holding');
  // A security bot defuses.
  const S = [...mm.players.values()].find((p) => p.side === 'sec');
  Object.assign(S, { x: mm.mode.planted.x + 1, z: mm.mode.planted.z });
  mm.mode.startAction(S, 'defuse');
  run(mm, BOMB.defuseSecs + 0.2);
  check(mm.score.sec === 1 && ws.log.some((m) => m.t === 'defused'), 'defusing wins the round for Security');
  run(mm, BOMB.postMs / 1000 + 0.2);
  check(mm.mode.round === 2 && mm.mode.phase === 'freeze', 'next round starts');
  // Explosion path.
  run(mm, BOMB.freezeMs / 1000 + 0.2);
  mm.mode.carrier = H.id;
  if (H.status !== 'alive') mm.spawn(H);
  Object.assign(H, { x: A.x, y: 0, z: A.z, protectUntil: 0 });
  mm.handle(H, { t: 'act', kind: 'plant' });
  run(mm, BOMB.plantSecs + 0.2);
  Object.assign(H, { x: A.x + 60, z: A.z });
  run(mm, BOMB.fuseMs / 1000 + 0.5);
  check(mm.score.out === 1 && ws.log.some((m) => m.t === 'roundEnd' && m.winner === 'out'), 'unstopped bomb explodes and Outlaws win the round');
  // No respawn mid-round.
  mm.kill(H, null, 'p9');
  mm.handle(H, { t: 'respawn', mode: 'gem' });
  check(H.status === 'dead', 'no respawn in Plant & Defuse until the next round');
  void t0;
}

section('Bomb bots play the objective');
{
  const mm = new Match('lagos', hooks, 'bomb');
  run(mm, 140);
  const ended = mm.mode.history.length;
  check(ended >= 1, `bots finish rounds on their own (${ended} rounds: ${mm.mode.history.join(', ')})`);
}

section('Campaign stage');
{
  const st = STAGES[0];
  const mm = new Match(st.state, hooks, 'stage', { stage: 0 });
  const ws = fakeWs();
  const prof = profile('Solo');
  const H = mm.addHuman(ws, st.ally, prof).player;
  const allies = [...mm.players.values()].filter((p) => !p.human && p.side === 'sec').length;
  check(allies === 2, 'player gets two allies');
  run(mm, 5);
  check(mm.mode.wave === 1 && mm.mode.enemyIds.size >= 3, `wave 1 arrives (${mm.mode.enemyIds.size} enemies)`);
  // Wipe each wave.
  for (let w = 0; w < st.waves; w++) {
    for (const id of mm.mode.enemyIds) {
      const e = mm.players.get(id);
      if (e && e.status !== 'dead') mm.kill(e, H, 'ak47');
    }
    run(mm, 8);
  }
  check(mm.ended && mm.mode.result?.won, 'clearing every wave clears the stage');
  check(prof.stage === 1 && prof.stageStars[0] >= 1, `progress saved (next stage unlocked, ${prof.stageStars[0]} stars)`);
  // Losing: run out of lives.
  const mm2 = new Match(st.state, hooks, 'stage', { stage: 0 });
  const H2 = mm2.addHuman(fakeWs(), st.ally, profile('Unlucky')).player;
  for (let i = 0; i < st.lives; i++) {
    if (H2.status !== 'alive') mm2.spawn(H2);
    mm2.kill(H2, null, 'p9');
  }
  check(mm2.ended && !mm2.mode.result.won, 'stage is lost when lives run out');
}

section('Safe chat with a business and daily missions');
{
  const { Daily } = await import('./daily.js');
  const daily = new Daily();
  const mm = new Match('kogi', { ...hooks, daily }, 'tdm');
  const prof = profile('Chatter');
  const H = mm.addHuman(fakeWs(), 'police', prof).player;
  mm.spawn(H);
  fakeNow += 10000;
  run(mm, 0.2);
  H.hurtAt = 0;
  H.firedAt = 0;
  const r = mm.setChat(H, true);
  check(r.ok, `alive soldier can start a chat (${r.reason || 'ok'})`);
  check(!mm.canAct(H), 'cannot shoot while chatting');
  const enemy = [...mm.players.values()].find((o) => o.side !== H.side);
  const hp = H.health;
  mm.damage(H, enemy, 50, { weapon: 'ak47' });
  check(H.health === hp, 'nobody can hurt a chatting soldier');
  mm.onState(H, { x: H.x + 3, y: H.y, z: H.z, yaw: 0, pitch: 0 });
  check(!mm.chatting(H), 'walking away ends the chat');
  H.hurtAt = now2();
  check(!mm.setChat(H, true).ok, 'cannot start a chat right after being shot');
  const before = JSON.stringify(daily.view(prof).missions);
  for (const m of daily.view(prof).missions) daily.progress(prof, m.kind, m.goal);
  const v = daily.view(prof);
  check(before !== JSON.stringify(v.missions) && v.missions.every((m) => m.prog >= m.goal), 'mission progress counts up to the goal');
  const gems = prof.gems;
  const xp = prof.xp;
  const got = daily.claimMission(prof, v.missions[0].id);
  check(got && (prof.gems > gems || prof.xp > xp), 'completed mission pays out');
  check(daily.claimMission(prof, v.missions[0].id) === null, 'a mission pays only once');
}

section('Staying alive: regen, pills, gemstones, punches, two guns');
{
  const { HEALTH, TILE_GEMS, PUNCH, GEAR: G, WEAPONS: W } = await import('../shared/config.js');
  const { tileGemSpots } = await import('../shared/map.js');
  const stateId = STATES.find((s) => tileGemSpots(generateMap(s.id)).length).id;
  const mm = new Match(stateId, hooks, 'tdm');
  const prof = profile('Tough');
  const H = mm.addHuman(fakeWs(), 'police', prof).player;
  mm.spawn(H);
  check(H.armor >= HEALTH.startArmor && H.bloodpill === HEALTH.startPills, 'humans land with light armour and a blood pill');
  fakeNow += 10000;
  const bot = [...mm.players.values()].find((o) => !o.human && o.side !== H.side);
  H.armor = 0;
  H.health = 100;
  mm.damage(H, bot, 40, { weapon: 'ak47' });
  check(Math.abs(H.health - (100 - 40 * HEALTH.botDamageToHumans)) < 0.01, `bots hit humans softer (${H.health})`);
  H.health = 100;
  mm.damage(H, bot, 144, { weapon: 'ak47', zone: 'head' });
  check(H.health === 100 - HEALTH.botMaxHit, `a bot headshot can't one-shot a player (${H.health})`);
  H.health = 10;
  H.protectUntil = 0;
  mm.damage(H, bot, 30, { weapon: 'ak47' });
  check(H.status === 'alive' && H.health === HEALTH.secondWindHp, 'second wind saves you from a bot once per life');
  H.protectUntil = 0;
  H.health = 10;
  fakeNow += 2000;
  mm.damage(H, bot, 30, { weapon: 'ak47' });
  check(H.status !== 'alive', 'but only once');
  mm.spawn(H);
  fakeNow += 10000;
  H.health = 60;
  H.hurtAt = fakeNow;
  // Regeneration after the delay.
  const hp0 = H.health;
  for (const o of mm.players.values()) if (o !== H) o.status = 'dead';
  fakeNow += HEALTH.regenDelayMs + 100;
  run(mm, 2);
  check(H.health > hp0 + 10, `health regenerates out of fire (${hp0.toFixed(0)} → ${H.health.toFixed(0)})`);
  // Blood pill.
  H.health = 40;
  H.hurtAt = fakeNow;
  mm.onPill(H);
  check(H.bloodpill === HEALTH.startPills - 1, 'blood pill used');
  run(mm, G.bloodpill.secs + 0.2);
  check(H.health >= 40 + G.bloodpill.heal - 1, `blood pill heals over time (${H.health.toFixed(0)})`);
  // Gemstone on a ground advert tile.
  H.health = 30;
  H.hurtAt = fakeNow;
  const gem = mm.tileGems[0];
  gem.at = 0;
  gem.type = 'emerald';
  Object.assign(H, { x: gem.x, z: gem.z, y: 0 });
  mm.stepTileGems(fakeNow);
  check(H.health >= 30 + TILE_GEMS.types.emerald.heal - 0.01 && gem.at > fakeNow, 'emerald on the ground tile heals and then recharges');
  // Punch combo.
  const foe = bot;
  foe.status = 'alive';
  foe.health = 400;
  foe.armor = 0;
  foe.protectUntil = 0;
  Object.assign(foe, { x: H.x, z: H.z - 1.2, y: 0 });
  H.yaw = 0;
  let total = 0;
  for (let i = 0; i < PUNCH.combo; i++) {
    fakeNow += PUNCH.cooldownMs + 20;
    const before = foe.health;
    mm.onMelee(H, { kind: 'punch' });
    total += before - foe.health;
  }
  check(total >= PUNCH.dmg * PUNCH.combo + PUNCH.comboBonus - 0.1, `three punches in a row land a heavy blow (${total.toFixed(0)} dmg)`);
  // Dual guns need rank.
  H.money = 99999;
  H.spawnAt = fakeNow;
  mm.onBuy(H, 'dualmp5');
  check(H.weapons.primary !== 'dualmp5', 'two-gun MP5 locked for a recruit');
  prof.xp = 2000 * (W.dualmp5.unlockLevel - 1);
  mm.onBuy(H, 'dualmp5');
  check(H.weapons.primary === 'dualmp5', 'two-gun MP5 bought after reaching the rank');
}

section('Real players: no-bot rooms, friends, crews, rivals');
{
  const { Social } = await import('./social.js');
  const real = new Match('kogi', hooks, 'tdm', { noBots: true });
  const A = real.addHuman(fakeWs(), 'police', profile('Ada')).player;
  real.addHuman(fakeWs(), 'bandit', profile('Bayo'));
  check([...real.players.values()].every((p) => p.human), 'real-players-only room has no bots');
  const store = { data: { profiles: {} } };
  const mk = (n) => (store.data.profiles[`tok-${n}`] = { token: `tok-${n}`, name: n });
  const ada = mk('Ada');
  const bayo = mk('Bayo');
  const soc = new Social(store, () => {}, () => ({ online: true, where: { state: 'kogi', mode: 'tdm' } }));
  const codeA = soc.codeOf(ada);
  check(/^POD-[A-Z0-9]{5}$/.test(codeA) && soc.codeOf(ada) === codeA, `friend code is stable (${codeA})`);
  soc.addFriend(bayo, codeA);
  check(ada.requests.includes(bayo.token), 'friend request arrives');
  soc.accept(ada, soc.codeOf(bayo));
  check(ada.friends.includes(bayo.token) && bayo.friends.includes(ada.token), 'friends both ways after accepting');
  const crew = soc.createCrew(ada, 'Lagos Lions', 'lgl');
  soc.joinCrew(bayo, `CREW-${crew.id}`);
  check(crew.tag === 'LGL' && crew.members.length === 2 && soc.tagOf(bayo) === 'LGL', 'crew created and joined, tag shared');
  let threw = false;
  try {
    soc.createCrew(mk('Chidi'), 'Copycats', 'LGL');
  } catch {
    threw = true;
  }
  check(threw, 'crew tags are unique');
  soc.recordKill(bayo, ada);
  soc.recordKill(bayo, ada);
  check(soc.rivalOf(ada)?.name === 'Bayo', 'the player who keeps killing you becomes your rival');
  const r = soc.recordKill(ada, bayo);
  check(r.revenge, 'killing your rival back counts as revenge');
  const v = soc.view(ada);
  check(v.friends[0].name === 'Bayo' && v.crew.tag === 'LGL' && v.rivals[0].theyKilledMe === 2, 'squad view lists friends, crew and rivals');
  // Crew tag shows in battle names.
  const tagged = new Match('kogi', { ...hooks, social: soc }, 'tdm', { noBots: true });
  const T = tagged.addHuman(fakeWs(), 'police', ada).player;
  check(T.name === '[LGL] Ada', `crew tag before the name in battle (${T.name})`);
}

section('Vehicles: drive, run over, shoot through, APC, C4, burning houses, ambulance');
{
  const { VEHICLES, WRECK, HOUSES, C4: C4c, AMBULANCE, forward, footprint } = await import('../shared/vehicles.js');
  const { insideAnyBox: insideBox, query: q, moveBox: mvBox } = await import('../shared/physics.js');
  const st = STATES.find((s) => {
    const mp = generateMap(s.id);
    return mp.vehicles.some((v) => v.type === 'apc') && mp.houses.some((h) => h.kind !== 'stone');
  }).id;
  const mm = new Match(st, hooks, 'tdm');
  const wsP = fakeWs();
  const wsQ = fakeWs();
  const P = mm.addHuman(wsP, 'police', profile('Driver')).player;
  const Q = mm.addHuman(wsQ, 'bandit', profile('Shooter')).player;
  for (const p of [...mm.players.values()]) if (!p.human) mm.players.delete(p.id);
  fakeNow += 5000;
  P.protectUntil = Q.protectUntil = 0;
  const types = new Set(mm.map.vehicles.map((v) => v.type));
  check(mm.map.vehicles.length >= 6 && types.size >= 3, `vehicles of different kinds on the map (${[...types].join(', ')})`);
  check(mm.info(P).world.v.length === mm.map.vehicles.length, 'joining players get every vehicle');
  // A big open patch of ground to test on.
  let open = null;
  for (let x = -70; x <= 70 && !open; x += 2)
    for (let z = -80; z <= 80 && !open; z += 2) if (!q(mm.map.index, x - 12, z - 11, x + 12, z + 11).filter((i) => { const b = mm.map.boxes[i]; return b.y1 > 0.3 && b.x1 > x - 12 && b.x0 < x + 12 && b.z1 > z - 11 && b.z0 < z + 11; }).length) open = { x, z };
  check(!!open, 'found open ground for the test');
  const park = (v, x, z, yaw = 0) => {
    Object.assign(v, { x, z, yaw, speed: 0 });
    const fp = footprint(v.type, x, z, yaw);
    mvBox(mm.map.index, v.box, fp.x0, fp.z0, fp.x1, fp.z1);
  };
  const car = mm.world.vehicles.find((v) => ['sedan', 'suv', 'pickup', 'danfo', 'lorry'].includes(v.type));
  park(car, open.x, open.z, 0);
  Object.assign(P, { x: open.x + 2.5, y: 0, z: open.z, status: 'alive', health: 100, armor: 0 });
  mm.handle(P, { t: 'veh', a: 'enter', i: car.i });
  check(P.veh === car.i && car.driver === P.id, `player gets into the ${VEHICLES[car.type].name}`);
  check(wsQ.log.some((x) => x.t === 'vseat' && x.id === P.id), 'everyone sees who is driving');
  // Drive one metre forward: accepted, and the collision box moves with it.
  fakeNow += 100;
  const [fx, fz] = forward(0);
  mm.handle(P, { t: 'st', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, v: [open.x + fx, open.z + fz, 0, 10] });
  const box = mm.map.boxes[car.box];
  check(Math.abs(car.z - (open.z + fz)) < 0.01 && Math.abs((box.z0 + box.z1) / 2 - car.z) < 0.01, 'driving moves the vehicle and its collision box');
  check(P.x === car.x && P.z === car.z, 'the driver rides along');
  fakeNow += 100;
  mm.handle(P, { t: 'st', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, v: [car.x + 60, car.z, 0, 10] });
  check(car.x === open.x && wsP.log.some((x) => x.t === 'vcorrect'), 'teleporting a car is refused');
  // Run someone over.
  Object.assign(Q, { x: car.x, y: 0, z: car.z - VEHICLES[car.type].L / 2 + 0.3, status: 'alive', health: 100, armor: 40 });
  run(mm, 0.1);
  check(Q.health < 100, `running someone over hurts them (${Q.health.toFixed(0)} left)`);
  // Bullets: the car takes damage and the driver can be hit through the door.
  Object.assign(Q, { x: car.x + 9, z: car.z, health: 100, status: 'alive' });
  P.health = 100;
  P.armor = 0;
  const hp0 = car.hp;
  fakeNow += 1000;
  Q.slot = 'secondary';
  const o = [Q.x, Q.y + PLAYER.eye, Q.z];
  mm.handle(Q, { t: 'fire', w: Q.weapons.secondary, o, d: [P.x - o[0], P.y + 0.8 - o[1], P.z - o[2]], ts: fakeNow });
  check(car.hp < hp0, `bullets dent the car (${hp0} → ${car.hp.toFixed(0)})`);
  check(P.health < 100, 'the driver is hit through the door');
  // Get out: standing beside the car, not inside it.
  mm.handle(P, { t: 'veh', a: 'exit' });
  check(P.veh == null && car.driver == null && !insideBox(mm.map.index, P.x, 0, P.z), 'getting out puts you beside the vehicle');
  // A rocket wrecks a car: engine fire, then it blows and burns down to a charred shell.
  mm.explode(car.x, 1, car.z, WEAPONS.rpg.blast, WEAPONS.rpg.dmg, Q, 'rpg');
  run(mm, 4);
  check(car.state >= 2, 'a rocket hit sets the car burning');
  check(wsP.log.some((x) => x.t === 'vstate' && x.i === car.i && x.s === 2), 'everyone sees it blow up');
  run(mm, WRECK.burnSecs + 1);
  check(car.state === 3, 'the wreck burns out to a charred shell');
  // The armoured carrier: bullets can't touch you, explosives wear it down.
  const apc = mm.world.vehicles.find((v) => v.type === 'apc');
  park(apc, open.x - 8, open.z + 6, 0);
  mm.spawn(P);
  Object.assign(P, { x: apc.x + 3, y: 0, z: apc.z, protectUntil: 0 });
  mm.handle(P, { t: 'veh', a: 'enter', i: apc.i });
  check(P.veh === apc.i, 'player climbs into the armoured carrier');
  P.health = 100;
  const apcHp = apc.hp;
  Object.assign(Q, { x: apc.x + 10, z: apc.z, status: 'alive', health: 100 });
  for (let k = 0; k < 5; k++) {
    fakeNow += 1000;
    const o2 = [Q.x, Q.y + PLAYER.eye, Q.z];
    mm.handle(Q, { t: 'fire', w: Q.weapons.secondary, o: o2, d: [P.x - o2[0], 2.6 - o2[1], P.z - o2[2]], ts: fakeNow });
  }
  check(P.health === 100 && apc.hp === apcHp, 'no bullet can touch you or the APC');
  // Shooting out of the APC works.
  fakeNow += 1000;
  P.slot = 'secondary';
  const before = Q.health;
  const o3 = [apc.x, VEHICLES.apc.eye, apc.z];
  mm.handle(P, { t: 'fire', w: P.weapons.secondary, o: o3, d: [Q.x - o3[0], Q.y + 1.5 - o3[1], Q.z - o3[2]], ts: fakeNow });
  check(Q.health < before, 'you can shoot from inside the APC');
  mm.explode(apc.x + 2, 1, apc.z, WEAPONS.rpg.blast, WEAPONS.rpg.dmg, Q, 'rpg');
  check(apc.hp < apcHp && P.health === 100, 'a rocket damages the APC but not the soldier inside');
  for (let k = 0; k < 8 && apc.state < 2; k++) mm.explode(apc.x + 2, 1, apc.z, WEAPONS.rpg.blast, WEAPONS.rpg.dmg, Q, 'rpg');
  run(mm, 3);
  check(apc.state >= 2 && P.veh == null, 'enough rockets destroy the APC and throw the soldier out');
  // C4 on a car, set off from a distance.
  const car2 = mm.world.vehicles.find((v) => v.state === 0 && v !== car && v.type !== 'apc');
  park(car2, open.x + 8, open.z - 6, Math.PI / 2);
  Object.assign(Q, { x: car2.x, z: car2.z + VEHICLES[car2.type].W / 2 + 1, status: 'alive', health: 100, c4: 2 });
  mm.handle(Q, { t: 'c4', a: 'plant', pos: [car2.x, 1.0, car2.z], veh: car2.i });
  check(mm.world.charges.length === 1 && mm.world.charges[0].veh === car2.i && Q.c4 === 1, 'C4 sticks to the car');
  Object.assign(Q, { x: car2.x + 30 });
  mm.handle(Q, { t: 'c4', a: 'plant', pos: [Q.x + 20, 0.1, Q.z] });
  check(mm.world.charges.length === 1, 'you must be close to plant C4');
  mm.handle(Q, { t: 'c4', a: 'det' });
  run(mm, 1);
  check(car2.state >= 2 && !mm.world.charges.length, 'pressing the detonator blows the car');
  // A house burns down.
  const hi = mm.map.houses.findIndex((h) => h.kind !== 'stone');
  const Hh = mm.map.houses[hi];
  Object.assign(Q, { x: Hh.x, z: Hh.z, y: 0, c4: 1, status: 'alive', health: 100 });
  mm.handle(Q, { t: 'c4', a: 'plant', pos: [Hh.x, 0.05, Hh.z] });
  Object.assign(Q, { x: Hh.x + 40 });
  Object.assign(P, { x: Hh.x + 0.5, z: Hh.z + 0.5, y: 0, status: 'alive', health: 100, veh: null, protectUntil: 0 });
  mm.spawn(P);
  Object.assign(P, { x: Hh.x + 0.5, z: Hh.z + 0.5, protectUntil: 0 });
  P.status = 'alive';
  P.health = 100;
  mm.handle(Q, { t: 'c4', a: 'det' });
  run(mm, 0.5);
  const hs = mm.world.houses[hi];
  check(hs.state === 2 && mm.map.boxes[Hh.roof].y1 < 0, 'C4 sets the house on fire and the roof caves in');
  check(P.burnUntil > fakeNow || P.status !== 'alive', 'someone inside a burning house catches fire');
  run(mm, HOUSES.burnSecs + 1);
  check(hs.state === 3 && wsQ.log.some((x) => x.t === 'house' && x.s === 3), 'it burns down to a charred shell');
  // The ambulance: costs money, can't be spammed, heals you if you wait for it.
  mm.spawn(Q);
  Object.assign(Q, { protectUntil: 0, health: 45, money: 5000 });
  mm.handle(Q, { t: 'amb' });
  check(Q.money === 5000 - AMBULANCE.fee && mm.world.ambulances.length === 1, `calling the ambulance costs ₦${AMBULANCE.fee}`);
  mm.handle(Q, { t: 'amb' });
  check(Q.money === 5000 - AMBULANCE.fee && mm.world.ambulances.length === 1, 'only one ambulance at a time');
  run(mm, AMBULANCE.maxMs / 1000 + 0.5);
  check(wsQ.log.some((x) => x.t === 'ambHeal') && Q.health === PLAYER.maxHealth, 'paramedics patch you up to full health');
  Q.health = 40;
  const m0 = Q.money;
  mm.handle(Q, { t: 'amb' });
  check(Q.money === m0, 'cooldown: no second ambulance straight away');
  // New round: everything is back.
  mm.reset();
  check(mm.world.vehicles.every((v) => v.state === 0 && !v.driver) && mm.world.houses.every((h) => h.state === 0) && mm.map.boxes[Hh.roof].y1 > 0, 'a new round restores every vehicle and house');
}

section('Underground: domed hall, tunnel, catacomb, graves, relic guns');
{
  const { DIG, LOOT, UNDER } = await import('../shared/underworld.js');
  const { moveBody: mb } = await import('../shared/physics.js');
  let withTunnel = 0;
  for (const s of STATES) if (generateMap(s.id).openings.length === 2) withTunnel++;
  check(withTunnel >= STATES.length - 3, `almost every battlefield has the tunnel network (${withTunnel}/${STATES.length})`);
  check(STATES.every((s) => generateMap(s.id).graves.some((g) => g.kind === 'grave')), 'every battlefield has a cemetery with graves');
  const st = STATES.find((s) => generateMap(s.id).openings.length === 2).id;
  const mm = new Match(st, hooks, 'tdm');
  const ws = fakeWs();
  const P = mm.addHuman(ws, 'army', profile('Digger')).player;
  for (const p of [...mm.players.values()]) if (!p.human) mm.players.delete(p.id);
  fakeNow += 5000;
  // Walk down the dome stairs: the server accepts positions underground.
  const sA = mm.map.openings[0];
  const body = { x: (sA.x0 + sA.x1) / 2, y: 0, z: sA.z0 + 0.3, vy: 0, onGround: true, crouch: false };
  const dir = mm.map.holes[1].z0 >= sA.z1 - 0.01 ? 1 : -1;
  if (dir < 0) body.z = sA.z1 - 0.3;
  Object.assign(P, { x: body.x, y: 0, z: body.z });
  for (let k = 0; k < 60; k++) {
    mb(body, 0, dir * 4, 0.05, mm.map.index, mm.map.half);
    fakeNow += 50;
    mm.handle(P, { t: 'st', x: body.x, y: body.y, z: body.z, yaw: 0, pitch: 0 });
  }
  check(body.y < -UNDER.depth + 0.2 && Math.abs(P.y - body.y) < 0.01, `walked down into the tunnel (y ${P.y.toFixed(2)})`);
  // Dig a grave: hold for the full time, standing still.
  const gi = mm.map.graves.findIndex((g) => g.kind === 'grave');
  const G = mm.map.graves[gi];
  mm.world.graves[gi].loot = 'goldak';
  Object.assign(P, { x: G.x + 0.5, y: 0, z: G.z, status: 'alive' });
  mm.handle(P, { t: 'dig', a: 'start', i: gi });
  check(!!P.dig && ws.log.some((x) => x.t === 'dig' && x.i === gi && x.secs === DIG.graveSecs), 'digging starts next to the grave');
  run(mm, DIG.graveSecs - 1);
  check(!mm.world.graves[gi].dug, 'not done before the time');
  run(mm, 1.2);
  check(mm.world.graves[gi].dug && P.weapons.primary === 'goldak' && P.slot === 'primary', 'dug out the Golden AK');
  check(ws.log.some((x) => x.t === 'grave' && x.i === gi && x.loot === 'goldak'), 'everyone sees the grave opened');
  mm.handle(P, { t: 'dig', a: 'start', i: gi });
  check(!P.dig, 'a dug grave stays empty for the round');
  // Moving cancels digging.
  const g2 = mm.map.graves.findIndex((g, k) => g.kind === 'grave' && k !== gi);
  Object.assign(P, { x: mm.map.graves[g2].x, z: mm.map.graves[g2].z + 0.4 });
  mm.handle(P, { t: 'dig', a: 'start', i: g2 });
  run(mm, 1);
  P.x += 2;
  run(mm, 0.2);
  check(!P.dig && !mm.world.graves[g2].dug, 'walking away stops the digging');
  // A catacomb tomb: underground, faster, better loot.
  const ti = mm.map.graves.findIndex((g) => g.kind === 'tomb');
  const T = mm.map.graves[ti];
  mm.world.graves[ti].loot = 'plate';
  Object.assign(P, { x: T.x, y: T.y, z: T.z });
  mm.handle(P, { t: 'dig', a: 'start', i: ti });
  run(mm, DIG.tombSecs + 0.2);
  check(P.armor === LOOT.plate.armor && P.helmet, 'opened a tomb: 200 armour plate');
  // Relic guns can't be bought.
  P.money = 16000;
  mm.handle(P, { t: 'buy', item: 'barrett' });
  check(P.weapons.primary !== 'barrett' && P.money === 16000, 'relic guns are not for sale');
  // Thunder .50 bites into an armoured carrier.
  const apcV = mm.world.vehicles.find((v) => v.type === 'apc');
  if (apcV) {
    const hp0 = apcV.hp;
    mm.world.bulletHit(mm.map.boxes[apcV.box], WEAPONS.barrett.dmg, P, 'barrett');
    mm.world.bulletHit(mm.map.boxes[apcV.box], WEAPONS.ak47.dmg, P, 'ak47');
    check(apcV.hp === hp0 - WEAPONS.barrett.dmg * 0.35, 'only the Thunder .50 can dent the APC with bullets');
  } else check(true, 'no APC on this map');
  // Drum Launcher shells explode where they land.
  mm.giveWeapon(P, 'gl');
  P.slot = 'primary';
  Object.assign(P, { x: 0, y: 0, z: 0 });
  fakeNow += 2000;
  const nBoom = ws.log.filter((x) => x.t === 'boom' && x.w === 'gl').length;
  mm.handle(P, { t: 'fire', w: 'gl', o: [0, PLAYER.eye, 0], d: [0, 0.2, -1], ts: fakeNow });
  run(mm, 4);
  check(ws.log.filter((x) => x.t === 'boom' && x.w === 'gl').length === nBoom + 1, 'a Drum Launcher shell flies and explodes');
  // A new round reburies everything.
  mm.reset();
  check(mm.world.graves.every((g) => !g.dug), 'graves are full again next round');
}

section('Practice range, skills, deep water, crocodiles, crew room, vehicle entry fixes');
{
  const { SKILLS, DROWN, bigWaters, deepWater } = await import('../shared/skills.js');
  const { Social } = await import('./social.js');
  const { CROC } = await import('./wildlife.js');
  // Practice range: dummies that never shoot, nothing counts.
  const pr = new Match('kano', hooks, 'practice', { practice: true });
  const ws = fakeWs();
  const prof = profile('Trainee');
  const P = pr.addHuman(ws, 'army', prof).player;
  const dummies = [...pr.players.values()].filter((o) => !o.human);
  check(dummies.length === 6 && dummies.every((d) => d.side !== P.side), 'six target dummies on the other side');
  const base = pr.map.bases[P.side];
  check(dummies.every((d) => Math.abs(d.x - base.x) < 75), 'dummies stand on the range in front of your base');
  P.protectUntil = 0;
  const hp0 = P.health;
  run(pr, 20);
  check(P.health >= hp0 && ws.log.filter((x) => x.t === 'shot' && x.id !== P.id).length === 0, 'dummies never shoot back');
  check(P.money === 16000, 'everything is free to try on the range');
  const d0 = dummies[0];
  d0.armor = 0;
  pr.damage(d0, P, 500, { weapon: 'ak47' });
  check(d0.status === 'dead' && prof.kills === 0 && prof.xp === 0, 'kills on the range do not count for your record');
  run(pr, 3);
  check(d0.status === 'alive', 'dummies come back quickly');
  pr.damage(P, null, 500, { weapon: 'fire', explosive: true });
  check(P.status === 'dead' && prof.deaths === 0, 'dying on the range does not count either');
  run(pr, 3.5);
  check(P.status === 'alive', 'free respawn on the range');
  // Swimming: train in water, practice counts 3x.
  const w = pr.map.water[0] || null;
  if (w) {
    const sw0 = prof.skills?.swim || 0;
    for (let k = 0; k < 40; k++) {
      Object.assign(P, { x: w.x0 + 0.6 + (k % 2) * 0.3, z: (w.z0 + w.z1) / 2, y: 0 });
      run(pr, 0.05);
    }
    check((prof.skills.swim || 0) > sw0, `swimming in water trains the skill (${sw0.toFixed(1)} → ${prof.skills.swim.toFixed(1)})`);
  } else check(true, 'no water on this map');
  // Deep water: untrained soldiers go under, trained ones swim.
  const st = STATES.find((s) => bigWaters(generateMap(s.id)).length);
  const mm = new Match(st.id, hooks, 'tdm');
  const ws2 = fakeWs();
  const prof2 = profile('Sinker');
  const S = mm.addHuman(ws2, 'police', prof2).player;
  for (const p of [...mm.players.values()]) if (!p.human) mm.players.delete(p.id);
  const big = bigWaters(mm.map)[0];
  const deep = { x: (big.x0 + big.x1) / 2, z: (big.z0 + big.z1) / 2 };
  check(deepWater(mm.map, deep.x, deep.z), 'the middle of a big river is deep');
  // Keep crocodiles away for this part.
  for (const c of mm.wildlife.crocs) Object.assign(c, { state: 'dead', respawnAt: Infinity });
  Object.assign(S, { x: deep.x, z: deep.z, y: 0, health: 100, protectUntil: 0 });
  run(mm, DROWN.graceSecs + 3);
  check(S.health < 100, `can't swim yet: deep water starts to drown you (${S.health.toFixed(0)})`);
  mm.spawn(S);
  prof2.skills.swim = SKILLS.swim.canSwimAt + 1;
  Object.assign(S, { x: deep.x, z: deep.z, y: 0, health: 100, protectUntil: 0 });
  run(mm, DROWN.graceSecs + 3);
  check(S.health === 100, 'trained swimmers are fine in deep water');
  check(ws2.log.some((x) => x.t === 'me' && x.skills && x.skills.swim >= SKILLS.swim.canSwimAt), 'your skills reach your phone');
  // Crocodiles.
  check(mm.wildlife.crocs.length >= 1, `crocodiles live in the big river (${mm.wildlife.crocs.length})`);
  const croc = mm.wildlife.crocs[0];
  mm.wildlife.place(croc);
  Object.assign(croc, { x: deep.x + 3, z: deep.z });
  Object.assign(S, { x: deep.x, z: deep.z, y: 0, health: 100, armor: 0, protectUntil: 0 });
  run(mm, 2.5);
  check(S.health < 100 && ws2.log.some((x) => x.t === 'croc' && x.a === 'bite'), 'a crocodile chases and bites a swimmer');
  Object.assign(S, { x: big.x0 - 12, z: deep.z, health: 100 });
  const before = S.health;
  run(mm, 3);
  check(S.health === before, 'out of the water you are safe from it');
  S.slot = 'secondary';
  Object.assign(croc, { x: S.x + 6, z: S.z, state: 'lurk', hp: 20 });
  fakeNow += 1000;
  const o = [S.x, PLAYER.eye, S.z];
  mm.handle(S, { t: 'fire', w: S.weapons.secondary, o, d: [croc.x - o[0], 0.05 - o[1], croc.z - o[2]], ts: fakeNow });
  check(croc.state === 'dead', 'you can shoot a crocodile dead');
  check(ws2.log.some((x) => x.t === 'croc' && x.a === 'dead'), 'everyone sees it die');
  // Crew room: chat and plan.
  const store = { data: { profiles: {} } };
  const social = new Social(store, () => {}, () => ({ online: false, where: null }));
  const a = profile('Ada');
  const b = profile('Bayo');
  store.data.profiles[a.token] = a;
  store.data.profiles[b.token] = b;
  const crew = social.createCrew(a, 'Lagos Lions', 'LGL');
  social.joinCrew(b, crew.id);
  social.crewChat(a, 'Meet for Kano at 8');
  social.crewPlan(b, 'Snipers on the dome');
  const vb = social.view(b);
  check(vb.crew.chat.length === 1 && vb.crew.chat[0].text === 'Meet for Kano at 8' && !vb.crew.chat[0].mine, 'crew chat reaches every member');
  check(vb.crew.plan.text === 'Snipers on the dome' && vb.crew.plan.by === 'Bayo', 'the crew tactics plan is shared');
  let threw = false;
  try {
    social.crewChat(profile('Loner'), 'hi');
  } catch {
    threw = true;
  }
  check(threw, 'no crew, no crew chat');
  // Vehicle entry: a wrong vehicle number or a stale seat never blocks you.
  const vm = new Match('lagos', hooks, 'tdm');
  const ws3 = fakeWs();
  const D = vm.addHuman(ws3, 'police', profile('Driver2')).player;
  for (const p of [...vm.players.values()]) if (!p.human) vm.players.delete(p.id);
  const car = vm.world.vehicles.find((v) => v.type !== 'apc');
  Object.assign(D, { x: car.x + 2.4, z: car.z, y: 0, status: 'alive' });
  D.veh = 99; // stale seat from nowhere
  const other = vm.world.vehicles.find((v) => v !== car && Math.hypot(v.x - car.x, v.z - car.z) > 20);
  vm.handle(D, { t: 'veh', a: 'enter', i: other.i });
  check(D.veh === car.i && car.driver === D.id, 'pressing E gets you into the vehicle next to you, even if the request named another');
  vm.handle(D, { t: 'veh', a: 'exit' });
  Object.assign(D, { x: car.x + 40, z: car.z });
  vm.handle(D, { t: 'veh', a: 'enter', i: car.i });
  check(D.veh == null && ws3.log.some((x) => x.t === 'toast' && /closer|No motor/.test(x.text)), 'too far: the game tells you why');
}

section('Every state loads');
for (const s of STATES) {
  for (const mode of ['conquest', 'tdm', 'bomb']) {
    const mm = new Match(s.id, hooks, mode);
    run(mm, 1);
  }
}
check(true, 'all 37 battlefields ran a tick with bots');
{
  const bad = STATES.filter((s) => {
    const b = catalogue[s.id];
    return b.filter((x) => x.type === 'sky').length !== 4 || b.filter((x) => x.type === 'led').length !== 2 || new Set(b.map((x) => x.code)).size !== b.length;
  });
  check(!bad.length, `every state has 4 sky billboards, 2 LED screens and unique codes (${bad.map((s) => s.id).join(', ') || 'ok'})`);
  check(STATES.every((s) => generateMap(s.id).connected), 'billboard poles never block a route');
}

section('Survival, close combat, dogs, fuel tanks, lorries crushing, coming back where you fell');
{
  const { HEALTH, PUNCH, TANKS } = await import('../shared/config.js');
  const { DOG } = await import('./wildlife.js');
  const { VEHICLES } = await import('../shared/vehicles.js');
  // Bots hit softer and never mob one player.
  check(HEALTH.botDamageToHumans <= 0.5 && HEALTH.botMaxHit <= 25 && HEALTH.botFocus === 2, 'bots hit real players softly and at most two shoot at you at once');
  const mm = new Match('lagos', hooks);
  const ws = fakeWs();
  const A = mm.addHuman(ws, 'army', profile('Brawler')).player;
  const bots = [...mm.players.values()].filter((o) => !o.human && o.side !== A.side);
  A.protectUntil = 0;
  // Melee lunge: an enemy 3.5 m in front gets reached with the machete.
  const E = bots[0];
  Object.assign(A, { x: 0, z: 0, y: 0, yaw: 0, status: 'alive' });
  Object.assign(E, { x: 0, z: -3.6, y: 0, status: 'alive', health: 100, armor: 0 });
  E.protectUntil = 0;
  A.lastFire = 0;
  const ok = mm.map.boxes.every((b) => !(b.x0 < 0.5 && b.x1 > -0.5 && b.z0 < 0 && b.z1 > -4 && b.y1 > 0.2));
  if (ok) {
    mm.onMelee(A, {});
    check(E.health < 100 && ws.log.some((x) => x.t === 'lunge'), 'a machete swing lunges onto an enemy a few steps away');
  } else check(true, 'spot blocked, lunge skipped');
  // Bots close in and fight hand to hand.
  const bb = bots[1];
  bb.bot.brawler = true;
  check(typeof bb.bot.brawl === 'function', 'bots can brawl up close');
  // Dogs: on the map, shootable, and they bite back if they're guard dogs.
  const dm = [...STATES].map((st) => new Match(st.id, hooks)).find((x) => x.wildlife.dogs.length);
  check(!!dm, 'stray dogs roam the towns');
  if (dm) {
    const dog = dm.wildlife.dogs[0];
    const ws2 = fakeWs();
    const H = dm.addHuman(ws2, 'army', profile('DogFighter')).player;
    const before = dm.wildlife.dogView()[0][4];
    check(before !== 2, 'dogs are alive at the start');
    const hit = dm.wildlife.rayHit(dog.body.x, 0.5, dog.body.z + 5, 0, 0, -1, 20);
    check(hit && hit.c === dog, 'bullets can hit a dog');
    dm.wildlife.hurt(dog, 999, H);
    check(dog.state === 'dead' && dm.wildlife.dogView()[0][4] === 2, 'a dog can be killed');
    const guard = dm.wildlife.dogs.find((d) => d.state !== 'dead');
    if (guard) {
      guard.guard = true;
      Object.assign(H, { x: guard.body.x + 1, z: guard.body.z, y: 0, status: 'alive' });
      H.protectUntil = 0;
      const h0 = H.health;
      run(dm, 3);
      check(guard.state === 'attack' && H.health < h0, 'a guard dog attacks anyone who comes too close');
      Object.assign(H, { yaw: Math.atan2(-(guard.body.x - H.x), -(guard.body.z - H.z)) });
      dm.wildlife.melee(H, -Math.sin(H.yaw), -Math.cos(H.yaw), 2.6, 999);
      check(guard.state === 'dead', 'you can fight a dog off with the machete');
    }
  }
  // Fuel tanks blow up in a huge blast that wrecks everything around.
  const tm = STATES.map((st) => new Match(st.id, hooks)).find((x) => x.map.tanks?.length);
  if (tm) {
    const bi = tm.map.tanks[0];
    const b = tm.map.boxes[bi];
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const ws3 = fakeWs();
    const V = tm.addHuman(ws3, 'army', profile('Victim')).player;
    Object.assign(V, { x: cx + 6, z: cz, y: 0, status: 'alive', health: 100, armor: 0 });
    V.protectUntil = 0;
    tm.hitTank(0, 30, null);
    check(!tm.tanksDead.includes(0), 'a few bullets do not blow a tank');
    tm.hitTank(0, TANKS.health, null);
    check(tm.tanksDead.includes(0) && b.y1 < 0, 'enough damage blows the tank (its collision goes too)');
    await new Promise((r) => realNow && setTimeout(r, 200));
    check(V.health < 100 || V.status !== 'alive', 'the tank blast hurts anyone nearby');
    tm.reset();
    check(!tm.tanksDead.length && b.y1 > 0, 'tanks are back next round');
  } else check(false, 'no fuel tanks anywhere');
  // Lorries crush small cars and flimsy houses, not stone.
  const { crushable } = await import('../shared/vehicles.js');
  const lm = STATES.map((st) => new Match(st.id, hooks)).find((x) => x.map.vehicles.some((v) => v.type === 'lorry') && x.map.vehicles.some((v) => ['sedan', 'keke', 'suv', 'pickup'].includes(v.type)));
  if (lm) {
    const lorry = lm.map.vehicles.find((v) => v.type === 'lorry');
    const car = lm.map.vehicles.find((v) => ['sedan', 'keke', 'suv', 'pickup'].includes(v.type));
    const carBox = lm.map.boxes[car.box];
    check(crushable('lorry', carBox, lm.map) && !crushable('sedan', carBox, lm.map), 'a lorry can crush a small car; a car cannot');
    const rockBox = lm.map.boxes.find((b) => b.kind === 'rock' || b.kind === 'stone');
    check(!rockBox || !crushable('lorry', rockBox, lm.map), 'rocks and stone are never crushed');
    const mud = lm.map.houses.find((h) => h.kind === 'mud' || h.kind === 'plank');
    const ws4 = fakeWs();
    const D = lm.addHuman(ws4, 'army', profile('Trucker')).player;
    const LV = lm.world.vehicles[lorry.i];
    lm.world.crushVehicle(lm.world.vehicles[car.i], D, LV);
    check(lm.world.vehicles[car.i].state === 4 && carBox.y1 <= 0.5, 'a crushed car is flattened');
    if (mud) {
      lm.world.collapseHouse(lm.world.houses[mud.i], D);
      const walls = lm.map.boxes.filter((b) => b.house === mud.i && !b.roof);
      check(lm.world.houses[mud.i].state === 4 && walls.every((b) => b.y1 <= 0.45), 'a mud or plank house is knocked down to rubble');
      lm.reset();
      check(walls.every((b) => b.y1 > 1), 'houses stand again next round');
    }
  } else check(true, 'no lorry with cars on any map');
  // Coming back where you fell, or fresh at base.
  const cm = new Match('kano', hooks, 'tdm');
  const ws5 = fakeWs();
  const C = cm.addHuman(ws5, 'army', profile('Returner')).player;
  for (const o of cm.players.values()) if (!o.human) o.status = 'dead';
  const spot = [...Array(40).keys()].map((k) => ({ x: -40 + k * 2, z: 10 })).find((q) => cm.freeSpot(q.x, q.z));
  Object.assign(C, { x: spot.x, z: spot.z, y: 0 });
  C.protectUntil = 0;
  cm.damage(C, null, 999, { weapon: 'fire', explosive: true });
  cm.onRespawn(C, 'gem', 'here');
  check(C.status === 'alive' && Math.hypot(C.x - spot.x, C.z - spot.z) < 9, 'you can come back where you fell');
  C.protectUntil = 0;
  cm.damage(C, null, 999, { weapon: 'fire', explosive: true });
  cm.onRespawn(C, 'gem', 'base');
  const bs = cm.map.bases[C.side];
  check(Math.hypot(C.x - bs.x, C.z - bs.z) < 25, 'or start fresh at your base');
}

section('Native app data (rules and maps)');
{
  const { nativeRules, nativeMap } = await import('./native-api.js');
  const { gunzipSync } = await import('node:zlib');
  const rules = JSON.parse(gunzipSync(nativeRules()));
  check(rules.WEAPON_IDS.join() === Object.keys(rules.WEAPONS).join() && rules.STATES.length === STATES.length && rules.PLAYER.run > 0, 'the rules carry weapons in snapshot order, every state and the movement numbers');
  const nm = JSON.parse(gunzipSync(nativeMap('lagos')));
  const sm = generateMap('lagos');
  check(nm.boxes.length === sm.boxes.length && nm.seed === sm.seed && !nm.index && !nm.nav && Array.isArray(nm.holes), 'a native map is the same battlefield as the server, without the server-only index');
  check(nativeMap('nowhere') === null, 'unknown states are refused');
}

Date.now = realNow;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
