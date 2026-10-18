// Tour of Duty: the story that carries a soldier from battle to battle. Every battle that
// ends gives a debrief (medals, rewards, story progress) and new orders from HQ, so there is
// always a next mission and a reason to come back.
//
// A chapter is finished with merit: a win is worth 3, a battle fought to the end but lost is
// worth 1. Finishing a chapter pays gems and XP and unlocks a title.
import { STATES, STATE_BY_ID, RESOURCES } from '../shared/states.js';
import { FACTIONS } from '../shared/config.js';

export const TOUR = { winMerit: 3, lossMerit: 1, chapterMerit: 6, winGems: 1, mvpGems: 1, chapterGems: 3, chapterXp: 1000 };

export const CHAPTERS = [
  { title: 'Boot Camp', rank: 'Recruit', story: 'Every legend starts with mud on their boots. Show your unit you can take orders and hold your nerve under fire.' },
  { title: 'First Blood', rank: 'Rifleman', story: 'Word has spread about the new soldier who does not flinch. HQ is sending you where the fighting is real.' },
  { title: 'Hold the Line', rank: 'Defender', story: 'The enemy wants the resource sites. Take them, hold them, and make them pay for every metre.' },
  { title: 'Black Gold', rank: 'Pipeline Guard', story: 'Oil, gas and gold keep the region alive. Smugglers and militants want it all. You will not let them.' },
  { title: 'Ghost Patrol', rank: 'Scout', story: 'Night raids, ambushes, silent kills. The enemy never sees you coming, and never sees you leave.' },
  { title: 'Iron Rain', rank: 'Veteran', story: 'Artillery, armour and burning fuel. Only the toughest soldiers walk out of these battles.' },
  { title: 'The Long Night', rank: 'Commander', story: 'Your unit looks to you now. Lead them through the hardest fights of the war.' },
  { title: 'Proof of Duty', rank: 'Legend', story: 'The final campaign. Every region is watching. Prove your duty one last time.' }
];

const ORDERS = [
  (st, res, foe) => `${foe} have seized the ${res} in ${st}. Retake it and hold it.`,
  (st, res, foe) => `Intelligence says ${foe} are moving on ${st}. Get there first and dig in.`,
  (st, res, foe) => `Our unit in ${st} is pinned down near the ${res}. Reinforce them now.`,
  (st, res, foe) => `${foe} are smuggling out of ${st} under cover of the fighting. Shut it down.`,
  (st, res, foe) => `Civilians in ${st} are caught in the crossfire. Clear the area of ${foe}.`
];

export function tourOf(profile) {
  return (profile.tour ||= { chapter: 0, merit: 0, battles: 0, wins: 0, titles: [] });
}

// The current chapter (after the last one, Legend tours keep going at the final chapter).
export function chapterView(profile) {
  const t = tourOf(profile);
  const c = CHAPTERS[Math.min(t.chapter, CHAPTERS.length - 1)];
  return { n: t.chapter + 1, of: CHAPTERS.length, title: c.title, rank: c.rank, story: c.story, merit: t.merit, need: TOUR.chapterMerit, battles: t.battles, wins: t.wins, titles: t.titles };
}

// Medals for the battle just finished (real players only): best at each thing.
export function awards(roster) {
  const humans = roster.filter((r) => !r.bot);
  const best = (key, min = 1) => {
    let top = null;
    for (const r of humans) if ((r[key] || 0) >= min && (!top || r[key] > top[key])) top = r;
    return top;
  };
  const out = [];
  const add = (r, medal, why) => r && out.push({ id: r.id, medal, why });
  add(best('points'), 'MVP', 'Most points in the battle');
  add(best('kills', 3), 'Top Gun', 'Most kills');
  add(best('hs', 2), 'Sharpshooter', 'Most headshots');
  add(best('assists', 2), 'Wingman', 'Most assists');
  const sharp = humans.filter((r) => (r.kills || 0) >= 3).sort((a, b) => (b.acc || 0) - (a.acc || 0))[0];
  if (sharp && sharp.acc >= 35) add(sharp, 'Steady Hand', `${sharp.acc}% accuracy`);
  const iron = humans.filter((r) => (r.kills || 0) >= 2 && (r.deaths || 0) === 0)[0];
  add(iron, 'Untouchable', 'Never fell in the whole battle');
  return out;
}

// New orders: a different region (and sometimes a different mode) with a reason to go.
export function nextOrders(stateId, modeId, rng = Math.random) {
  const pool = STATES.filter((s) => s.id !== stateId);
  const st = pool[Math.floor(rng() * pool.length)] || STATE_BY_ID[stateId];
  const res = RESOURCES[st.resources[Math.floor(rng() * st.resources.length)]]?.site || 'supply depot';
  const foes = Object.values(FACTIONS).filter((f) => f.side === 'out').map((f) => f.label);
  const foe = foes[Math.floor(rng() * foes.length)];
  const mode = rng() < 0.7 ? modeId : modeId === 'conquest' ? 'tdm' : 'conquest';
  const brief = ORDERS[Math.floor(rng() * ORDERS.length)](st.name, res.toLowerCase(), foe);
  return { state: st.id, name: st.name, mode, brief };
}

// One player's debrief: their medals, what they earned and where the story stands.
export function debrief(match, p, winner, roster, medals) {
  const won = !!winner && p.side === winner;
  const t = tourOf(p.profile);
  const before = t.chapter;
  t.battles++;
  if (won) t.wins++;
  t.merit += won ? TOUR.winMerit : TOUR.lossMerit;
  let gems = won ? TOUR.winGems : 0;
  let xp = 0;
  const mine = medals.filter((a) => a.id === p.id);
  if (mine.some((a) => a.medal === 'MVP')) gems += TOUR.mvpGems;
  let finished = null;
  if (t.merit >= TOUR.chapterMerit) {
    t.merit -= TOUR.chapterMerit;
    finished = CHAPTERS[Math.min(before, CHAPTERS.length - 1)];
    if (!t.titles.includes(finished.rank)) t.titles.push(finished.rank);
    if (t.chapter < CHAPTERS.length - 1) t.chapter++;
    gems += TOUR.chapterGems;
    xp += TOUR.chapterXp;
  }
  p.profile.gems += gems;
  if (xp) match.addXP(p, xp);
  return {
    t: 'debrief',
    won,
    draw: !winner,
    medals: mine.map((a) => ({ medal: a.medal, why: a.why })),
    allMedals: medals.map((a) => ({ name: roster.find((r) => r.id === a.id)?.name || '', medal: a.medal })),
    gems,
    xp,
    finished: finished ? { title: finished.title, rank: finished.rank } : null,
    chapter: chapterView(p.profile),
    orders: nextOrders(match.stateId, match.modeId, match.rng)
  };
}
