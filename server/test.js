// Headless simulation tests: run with `npm test`.
// Drives real matches on a fake clock and checks the rules the game depends on.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), '36states-test-'));
let fakeNow = 1_800_000_000_000;
const realNow = Date.now;
Date.now = () => fakeNow;

const { Match } = await import('./match.js');
const { AdManager } = await import('./ads.js');
const { GEMS, RESPAWN, PLAYER, MATCH, priceFor, WEAPONS, DRUMS } = await import('../shared/config.js');
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

const slotCounts = Object.fromEntries(STATES.map((s) => [s.id, generateMap(s.id).adWalls.length]));
const ads = new AdManager(slotCounts);
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
const img = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
const ad = await ads.create({ advertiser: 'Test Brand', imageDataUrl: img, states: ['kano'], priceNaira: 100000 });
const slots = ads.slotsFor('kano').slots;
check(Object.keys(slots).length === slotCounts.kano, 'advert fills every wall in the targeted state');
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

section('Every state loads');
for (const s of STATES) {
  const mm = new Match(s.id, hooks);
  run(mm, 1);
}
check(true, 'all 37 battlefields ran a tick with bots');

Date.now = realNow;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
