// Skills you train by doing: swimming (time in the water) and fitness (sprinting). Training in
// your crew's Practice Range counts three times. Both server and client use these rules.
export const SKILLS = {
  swim: { name: 'Swimming', perSec: 0.35, canSwimAt: 30, fastAt: 70 },
  fitness: { name: 'Fitness', perSec: 0.12 },
  practiceMult: 3,
  max: 100
};

// Deep water: far enough from every bank of a big river or lake. Narrow creeks are never deep.
export function deepWater(map, x, z) {
  for (const w of map.water || []) {
    if (x <= w.x0 || x >= w.x1 || z <= w.z0 || z >= w.z1) continue;
    const edge = Math.min(x - w.x0, w.x1 - x, z - w.z0, w.z1 - z);
    if (edge > 3.2) return true;
  }
  return false;
}

// Big rivers and lakes (where crocodiles live).
export function bigWaters(map) {
  return (map.water || []).filter((w) => Math.min(w.x1 - w.x0, w.z1 - w.z0) >= 11);
}

// Speed multiplier in water for a swimming skill (on top of the normal water slow-down).
export function swimFactor(skill, deep) {
  if (!deep) return 1;
  if (skill >= SKILLS.swim.fastAt) return 1.35;
  if (skill >= SKILLS.swim.canSwimAt) return 1;
  return 0.55; // splashing about
}

// Untrained swimmers start to drown after a few seconds in deep water.
export const DROWN = { graceSecs: 4, dps: 7 };

// Fitness: longer sprints and a little extra pace.
export function staminaFor(fitness, base) {
  return base * (1 + Math.min(100, fitness || 0) / 100 * 0.7);
}
export function sprintFor(fitness) {
  return 1 + Math.min(100, fitness || 0) / 100 * 0.06;
}
