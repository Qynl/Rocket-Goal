// ---------------------------------------------------------------------------
// Mutators — the same rule modifiers Rocket League offers in private matches.
// Everything here is data; `resolve()` turns a set of choices into the numbers
// the simulation and renderer actually use.
// ---------------------------------------------------------------------------
import { BALL, CAR } from './constants.js';

export const MUTATOR_GROUPS = [
  {
    id: 'length',
    label: 'Match length',
    options: [
      { v: 60, label: '1 min' },
      { v: 120, label: '2 min' },
      { v: 180, label: '3 min' },
      { v: 300, label: '5 min', d: true },
      { v: 600, label: '10 min' },
      { v: 0, label: 'Unlimited' },
    ],
  },
  {
    id: 'maxScore',
    label: 'Max score',
    options: [
      { v: 0, label: 'Unlimited', d: true },
      { v: 1, label: '1' },
      { v: 3, label: '3' },
      { v: 5, label: '5' },
      { v: 10, label: '10' },
    ],
  },
  {
    id: 'overtime',
    label: 'Overtime',
    options: [
      { v: 'unlimited', label: 'Unlimited', d: true },
      { v: 300, label: '5 min' },
      { v: 600, label: '10 min' },
      { v: 'none', label: 'Off' },
    ],
  },
  {
    id: 'ballSize',
    label: 'Ball size',
    options: [
      { v: 0.7, label: 'Small' },
      { v: 1, label: 'Default', d: true },
      { v: 1.5, label: 'Large' },
      { v: 2, label: 'Gigantic' },
    ],
  },
  {
    id: 'ballWeight',
    label: 'Ball weight',
    options: [
      { v: 0.4, label: 'Feather' },
      { v: 0.75, label: 'Light' },
      { v: 1, label: 'Default', d: true },
      { v: 2, label: 'Heavy' },
      { v: 4, label: 'Super heavy' },
    ],
  },
  {
    id: 'ballBounciness',
    label: 'Ball bounciness',
    options: [
      { v: 0.2, label: 'Low' },
      { v: 1, label: 'Default', d: true },
      { v: 1.6, label: 'High' },
      { v: 2.2, label: 'Super high' },
    ],
  },
  {
    id: 'ballSpeed',
    label: 'Ball speed',
    options: [
      { v: 0.7, label: 'Slow' },
      { v: 1, label: 'Default', d: true },
      { v: 1.4, label: 'Fast' },
      { v: 1.8, label: 'Super fast' },
    ],
  },
  {
    id: 'ballType',
    label: 'Ball type',
    options: [
      { v: 'default', label: 'Default', d: true },
      { v: 'puck', label: 'Puck (Snow Day)' },
    ],
  },
  {
    id: 'boost',
    label: 'Boost',
    options: [
      { v: 'normal', label: 'Default', d: true },
      { v: 'unlimited', label: 'Unlimited' },
      { v: 'slow', label: 'Slow recharge' },
      { v: 'rapid', label: 'Rapid recharge' },
      { v: 'none', label: 'No boost' },
    ],
  },
  {
    id: 'boostStrength',
    label: 'Boost strength',
    options: [
      { v: 0.5, label: '0.5×' },
      { v: 1, label: '1×', d: true },
      { v: 1.5, label: '1.5×' },
      { v: 10, label: '10×' },
    ],
  },
  {
    id: 'respawn',
    label: 'Respawn time',
    options: [
      { v: 3, label: '3 s', d: true },
      { v: 2, label: '2 s' },
      { v: 1, label: '1 s' },
      { v: 0, label: 'Instant' },
    ],
  },
  {
    id: 'demo',
    label: 'Demolition',
    options: [
      { v: 'normal', label: 'Default', d: true },
      { v: 'disabled', label: 'Disabled' },
      { v: 'always', label: 'Always' },
      { v: 'instant', label: 'Instant respawn' },
      { v: '3s', label: '3 s respawn' },
    ],
  },
  {
    id: 'rumble',
    label: 'Rumble',
    options: [
      { v: 'none', label: 'Off', d: true },
      { v: 'normal', label: 'Default' },
      { v: 'slow', label: 'Slow recharge' },
      { v: 'turbo', label: 'Turbo recharge' },
    ],
  },
];

export const MUTATOR_PRESETS = {
  standard: { label: 'Standard', desc: 'Official 5-minute rules.', values: { length: 300, maxScore: 0, overtime: 'unlimited' } },
  quick: { label: 'Quick match', desc: 'First to 3 goals wins.', values: { length: 0, maxScore: 3, overtime: 'none' } },
  rumble: { label: 'Rumble', desc: 'Power-ups, unlimited boost.', values: { length: 300, rumble: 'normal', boost: 'unlimited' } },
  snowday: { label: 'Snow Day', desc: 'Hockey with a puck.', values: { ballType: 'puck', length: 300 } },
  chaos: { label: 'Chaos', desc: 'Gigantic bouncy ball, rapid boost, instant respawn.', values: { ballSize: 2, ballBounciness: 2.2, boost: 'rapid', respawn: 0, demo: 'instant', length: 300 } },
};

export function defaultMutators() {
  const m = {};
  for (const g of MUTATOR_GROUPS) {
    const d = g.options.find((o) => o.d) || g.options[0];
    m[g.id] = d.v;
  }
  return m;
}

/** Merge user choices over the defaults and derive the physics numbers. */
export function resolve(mutators = {}) {
  const m = { ...defaultMutators(), ...mutators };
  const puck = m.ballType === 'puck';
  const ball = {
    radius: BALL.RADIUS * m.ballSize,
    mass: BALL.MASS * m.ballWeight * (puck ? 2.2 : 1),
    restitution: BALL.RESTITUTION * (puck ? 0.25 : m.ballBounciness),
    friction: BALL.FRICTION * (puck ? 0.45 : 1),
    drag: BALL.DRAG * (puck ? 0.6 : 1),
    maxSpeed: BALL.MAX_SPEED * m.ballSpeed * (puck ? 0.85 : 1),
    maxAng: BALL.MAX_ANG * (puck ? 1.6 : 1),
    puck,
  };
  const boost = {
    mode: m.boost,
    unlimited: m.boost === 'unlimited' || m.rumble !== 'none',
    none: m.boost === 'none',
    recharge: m.boost === 'slow' ? 6 : m.boost === 'rapid' ? 25 : 0,
    accel: CAR.BOOST_ACCEL * m.boostStrength,
    maxSpeed: CAR.MAX_SPEED * (1 + Math.max(0, m.boostStrength - 1) * 0.35),
  };
  return {
    raw: m,
    duration: m.length,
    maxScore: m.maxScore,
    overtime: m.overtime,
    ball,
    boost,
    respawnTime: m.demo === 'instant' ? 0 : m.demo === '3s' ? 3 : m.respawn,
    demoMode: m.demo,
    rumble: m.rumble,
    rumbleCooldown: m.rumble === 'slow' ? 14 : m.rumble === 'turbo' ? 6 : 10,
  };
}

/** Human readable summary, shown on the match setup screen and the scoreboard. */
export function describe(mutators = {}) {
  const out = [];
  const m = { ...defaultMutators(), ...mutators };
  for (const g of MUTATOR_GROUPS) {
    const opt = g.options.find((o) => o.v === m[g.id]);
    if (!opt) continue;
    if (opt.d) continue;
    out.push(`${g.label}: ${opt.label}`);
  }
  return out;
}

export function isStandard(mutators = {}) {
  return describe(mutators).filter((d) => !d.startsWith('Match length')).length === 0;
}
