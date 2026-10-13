// Daily duty: a 7-day login reward calendar and three daily missions, so there is always a
// reason to come back. Days follow Nigerian time (WAT). Stored on the player's profile.
import { GEMS } from '../shared/config.js';

const DAY_MS = 86400000;
export const lagosDay = (t = Date.now()) => new Date(t + 3600000).toISOString().slice(0, 10);

export const LOGIN_REWARDS = [{ gems: 1 }, { xp: 150 }, { gems: 1 }, { xp: 300 }, { gems: 2 }, { xp: 500 }, { gems: 5 }];

export const MISSIONS = [
  { kind: 'kills', goal: 10, title: 'Kpai 10 enemies', reward: { gems: 1 } },
  { kind: 'kills', goal: 25, title: 'Kpai 25 enemies', reward: { gems: 2, xp: 300 } },
  { kind: 'headshots', goal: 3, title: 'Land 3 headshots', reward: { xp: 300 } },
  { kind: 'gems', goal: 2, title: 'Pick 2 life gems from advert walls', reward: { xp: 250 } },
  { kind: 'matches', goal: 2, title: 'Finish 2 battles', reward: { gems: 1 } },
  { kind: 'wins', goal: 1, title: 'Win 1 battle', reward: { gems: 2 } },
  { kind: 'revives', goal: 2, title: 'Revive 2 of your people', reward: { xp: 300 } },
  { kind: 'captures', goal: 2, title: 'Capture 2 sites in Hold Ground', reward: { xp: 300 } }
];

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class Daily {
  constructor(save) {
    this.save = save || (() => {});
  }

  // Today's missions for this profile (three different kinds, the same all day).
  ensure(profile, t = Date.now()) {
    const today = lagosDay(t);
    const d = (profile.daily ||= { lastClaim: null, streak: 0 });
    if (d.day !== today) {
      let h = hash(today + profile.token);
      const pool = MISSIONS.map((m, i) => ({ ...m, id: String(i) }));
      const picked = [];
      while (picked.length < 3 && pool.length) {
        const m = pool.splice(h % pool.length, 1)[0];
        h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
        if (picked.some((p) => p.kind === m.kind)) continue;
        picked.push({ id: `${today}:${m.id}`, kind: m.kind, goal: m.goal, title: m.title, reward: m.reward, prog: 0, claimed: false });
      }
      d.day = today;
      d.missions = picked;
      this.save();
    }
    return d;
  }

  // The day number (0-6) you would claim today, and whether you can.
  loginState(profile, t = Date.now()) {
    const d = this.ensure(profile, t);
    const today = lagosDay(t);
    const yesterday = lagosDay(t - DAY_MS);
    const can = d.lastClaim !== today;
    const continuing = d.lastClaim === yesterday || d.lastClaim === today;
    const streak = continuing ? d.streak : 0;
    const index = can ? streak % LOGIN_REWARDS.length : (streak - 1 + LOGIN_REWARDS.length) % LOGIN_REWARDS.length;
    return { can, streak, index };
  }

  claimLogin(profile, t = Date.now()) {
    const s = this.loginState(profile, t);
    if (!s.can) return null;
    const reward = LOGIN_REWARDS[s.index];
    this.grant(profile, reward);
    profile.daily.streak = s.streak + 1;
    profile.daily.lastClaim = lagosDay(t);
    this.save();
    return { reward, streak: profile.daily.streak };
  }

  progress(profile, kind, n = 1) {
    const d = this.ensure(profile);
    const done = [];
    for (const m of d.missions) {
      if (m.kind !== kind || m.prog >= m.goal) continue;
      m.prog = Math.min(m.goal, m.prog + n);
      if (m.prog >= m.goal) done.push(m);
    }
    if (done.length) this.save();
    return done;
  }

  claimMission(profile, id) {
    const d = this.ensure(profile);
    const m = d.missions.find((x) => x.id === id);
    if (!m || m.claimed || m.prog < m.goal) return null;
    m.claimed = true;
    this.grant(profile, m.reward);
    this.save();
    return { reward: m.reward, mission: m.title };
  }

  grant(profile, r) {
    if (r.gems) profile.gems = Math.min(GEMS.maxGems ?? 999, (profile.gems || 0) + r.gems);
    if (r.xp) profile.xp = (profile.xp || 0) + r.xp;
  }

  view(profile, t = Date.now()) {
    const d = this.ensure(profile, t);
    const s = this.loginState(profile, t);
    const ready = d.missions.filter((m) => m.prog >= m.goal && !m.claimed).length;
    return { login: { ...s, rewards: LOGIN_REWARDS }, missions: d.missions, badge: (s.can ? 1 : 0) + ready, resetsIn: DAY_MS - ((t + 3600000) % DAY_MS) };
  }
}
