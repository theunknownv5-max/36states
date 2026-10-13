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

Date.now = realNow;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
