// ---------------------------------------------------------------------------
// Local profile: XP, level and a season rank that climbs as you play.
// Everything is stored in localStorage — no accounts, no network.
// ---------------------------------------------------------------------------

const KEY = 'rocketgoal.profile.v1';

export const XP_PER_LEVEL = 100;

// Cumulative XP needed to reach each tier. Divisions split the gap evenly.
export const TIERS = [
  { name: 'Unranked', divisions: 1, xp: 0, color: '#9aa3b2' },
  { name: 'Bronze', divisions: 4, xp: 250, color: '#c07b45' },
  { name: 'Silver', divisions: 4, xp: 900, color: '#c3ccd8' },
  { name: 'Gold', divisions: 4, xp: 1900, color: '#f0c64a' },
  { name: 'Platinum', divisions: 4, xp: 3400, color: '#6fe0d0' },
  { name: 'Diamond', divisions: 4, xp: 5600, color: '#7fb3ff' },
  { name: 'Champion', divisions: 4, xp: 8600, color: '#c58bff' },
  { name: 'Grand Champion', divisions: 4, xp: 12600, color: '#ff6f6f' },
  { name: 'Supersonic Legend', divisions: 1, xp: 18000, color: '#ffd24a' },
];

export function defaultProfile() {
  return { xp: 0, level: 1, matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, saves: 0, shots: 0, demos: 0, shotsOnGoal: 0, shotsTaken: 0, drills: 0, history: [], name: 'You' };
}

export function loadProfile() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...defaultProfile(), ...raw };
  } catch (e) {
    return defaultProfile();
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) {
    /* storage full / disabled — profile just won't persist */
  }
}

export const levelOf = (xp) => Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
export const xpIntoLevel = (xp) => xp % XP_PER_LEVEL;

/** Which tier/division a total XP sits in, plus progress through it. */
export function rankOf(xp) {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) if (xp >= TIERS[i].xp) idx = i;
  const tier = TIERS[idx];
  const next = TIERS[idx + 1];
  const span = next ? next.xp - tier.xp : 1;
  const into = xp - tier.xp;
  const division = tier.divisions === 1 ? 1 : Math.min(tier.divisions, Math.floor((into / span) * tier.divisions) + 1);
  const roman = ['I', 'II', 'III', 'IV'][division - 1] || 'I';
  const start = tier.xp + ((division - 1) * span) / tier.divisions;
  const end = tier.xp + (division * span) / tier.divisions;
  return {
    tier: tier.name,
    division,
    label: tier.divisions === 1 ? tier.name : `${tier.name} ${roman}`,
    color: tier.color,
    pct: Math.max(0, Math.min(1, (xp - start) / Math.max(1, end - start))),
    toNext: Math.max(0, Math.ceil(end - xp)),
    nextLabel: next ? (next.divisions === 1 ? next.name : `${next.name} I`) : 'Max',
  };
}

/**
 * XP earned for a finished match. Rewards winning, but every stat pays out so a
 * good loss still progresses you — like Rocket League's end-of-match screen.
 */
export function matchXp(stats, config, humanStats) {
  const h = humanStats || stats.cars.find((c) => c.isHuman);
  const breakdown = [];
  const add = (label, value) => {
    if (value > 0) breakdown.push({ label, value });
  };
  const won = h && stats.score[h.team] > stats.score[1 - h.team];
  const draw = stats.score[0] === stats.score[1];
  add('Match played', 20);
  if (won) add('Victory', 40);
  else if (draw) add('Draw', 15);
  if (h) {
    add('Goals', (h.goals || 0) * 10);
    add('Assists', (h.assists || 0) * 6);
    add('Saves', (h.saves || 0) * 8);
    add('Shots', Math.min(5, h.shots || 0) * 3);
    add('Demolitions', (h.demos || 0) * 4);
    add('Score points', Math.round((h.score || 0) / 10));
    if (stats.overtime && won) add('Overtime winner', 15);
    if (stats.forfeited) {
      breakdown.length = 0;
      add('Forfeit', 5);
    }
  }
  const difficultyBonus = { rookie: 0, pro: 0.1, allstar: 0.25, champion: 0.5 }[config?.difficulty] || 0;
  const modeBonus = config?.mode === 'drill' ? 0.4 : config?.mode === 'freeplay' ? 0.2 : 1;
  if (difficultyBonus > 0) {
    const subtotal = breakdown.reduce((s, b) => s + b.value, 0);
    breakdown.push({ label: `${(difficultyBonus * 100).toFixed(0)}% bot skill bonus`, value: Math.round(subtotal * difficultyBonus) });
  }
  const total = Math.round(breakdown.reduce((s, b) => s + b.value, 0) * modeBonus);
  return { total, breakdown };
}

/** Apply XP to the stored profile; returns what changed for the results screen. */
export function awardMatch(stats, config) {
  const p = loadProfile();
  const h = stats.cars.find((c) => c.isHuman);
  const before = { xp: p.xp, level: p.level, rank: rankOf(p.xp) };
  const { total, breakdown } = matchXp(stats, config, h);
  p.xp += total;
  p.level = levelOf(p.xp);
  if (config?.mode === 'match') {
    p.matches++;
    if (h) {
      if (stats.score[h.team] > stats.score[1 - h.team]) p.wins++;
      else if (stats.score[0] === stats.score[1]) p.draws++;
      else p.losses++;
      p.goals += h.goals || 0;
      p.saves += h.saves || 0;
      p.demos += h.demos || 0;
      p.shotsTaken += h.shots || 0;
      if ((h.shots || 0) > 0) p.shotsOnGoal += h.goals || 0;
    }
  } else if (config?.mode === 'drill') p.drills++;
  p.history.unshift({ date: Date.now(), xp: total, mode: config?.mode, score: stats.score.slice() });
  while (p.history.length > 30) p.history.pop();
  saveProfile(p);
  const after = { xp: p.xp, level: p.level, rank: rankOf(p.xp) };
  return {
    profile: p,
    total,
    breakdown,
    leveledUp: after.level > before.level,
    rankUp: after.rank.label !== before.rank.label,
    before,
    after,
  };
}
