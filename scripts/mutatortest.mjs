// Mutator integration: run real matches under each rule set and check the rules bite.
import { Game } from '../src/game.js';
import { resolve } from '../src/mutators.js';

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
// no explicit duration: the match-length mutator drives the clock (same as the UI)
const mk = (mutators, extra = {}) => {
  const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', humanTeam: 0, mutators, replays: false, ...extra });
  g.state = 'play';
  g.ball.frozen = false;
  return g;
};
const run = (g, seconds, drive = true) => {
  for (let i = 0; i < seconds * 60 && g.state !== 'ended'; i++) {
    if (drive && g.human) g.human.controls.throttle = 1;
    g.update(1 / 60);
  }
};

// ---- max score ------------------------------------------------------------
{
  const g = mk({ maxScore: 1 });
  g.score[0] = 1;
  g.state = 'play';
  g.onGoal(0); // force the goal path
  for (let i = 0; i < 60 * 6 && g.state !== 'ended'; i++) g.update(1 / 60);
  ok('max score 1 ends the match after one goal', g.state === 'ended', `state ${g.state}`);
}
{
  const g = mk({ maxScore: 0 });
  g.onGoal(0);
  for (let i = 0; i < 60 * 5; i++) g.update(1 / 60);
  ok('unlimited max score keeps playing after a goal', g.state !== 'ended');
}

// ---- match length ---------------------------------------------------------
{
  const g = mk({ length: 0 });
  ok('unlimited match length has no clock', g.clock === Infinity);
  const g2 = mk({ length: 120 });
  ok('2 minute mutator sets the clock', g2.clock === 120, `clock ${g2.clock}`);
}

// ---- boost ----------------------------------------------------------------
{
  const g = mk({ boost: 'none' });
  g.human.controls.boost = true;
  run(g, 2);
  ok('no-boost mutator leaves the tank empty', g.cars.every((c) => c.boost <= 0), `boost ${g.human.boost}`);
}
{
  const g = mk({ boost: 'rapid' });
  g.human.boost = 0;
  g.human.controls.boost = false;
  for (let i = 0; i < 60; i++) {
    g.human.pos.set(0, 17, -4000); // keep away from pads
    g.update(1 / 60);
  }
  ok('rapid recharge refills boost without pads', g.human.boost > 15, `boost ${g.human.boost.toFixed(1)}`);
}
{
  const g = mk({ boost: 'unlimited' });
  g.human.controls.boost = true;
  run(g, 3);
  ok('unlimited boost never runs out', g.human.boost === 100);
}
{
  const g = mk({ boostStrength: 10 });
  ok('10x boost raises the speed cap', g.human.maxSpeed > 3000, `max ${g.human.maxSpeed.toFixed(0)}`);
  g.human.setPose(0, -4500, 0, 100);
  g.human.controls.throttle = 1;
  g.human.controls.boost = true;
  let peak = 0;
  for (let i = 0; i < 60 * 4; i++) {
    g.update(1 / 60);
    peak = Math.max(peak, g.human.speed);
  }
  ok('10x boost actually drives past 2300', peak > 2300, `peak ${peak.toFixed(0)} uu/s`);
}

// ---- ball -----------------------------------------------------------------
{
  const g = mk({ ballSize: 2 });
  ok('gigantic ball mutator scales the ball', Math.abs(g.ball.radius - 185.5) < 0.01);
  g.ball.pos.set(0, 185.5, 4000);
  g.ball.vel.set(0, 0, 2000);
  let scored = false;
  g.on('goal', () => (scored = true));
  for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
  ok('gigantic ball still scores', scored, `score ${g.score.join('-')}`);
}
{
  const g = mk({ ballType: 'puck' });
  ok('puck mutator is flagged for the renderer', g.ball.config.puck === true);
  g.ball.pos.set(0, 400, 0);
  g.ball.vel.set(0, 0, 0);
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  ok('puck settles low and does not bounce', g.ball.pos.y < 200 && g.ball.vel.length() < 200, `y=${g.ball.pos.y.toFixed(0)}`);
}
{
  const g = mk({ ballBounciness: 2.2 });
  ok('bounciness mutator raises restitution', g.ball.restitution > 1.2, `${g.ball.restitution.toFixed(2)}`);
}

// ---- demolition / respawn -------------------------------------------------
{
  const hit = (mutators) => {
    const g = mk(mutators, { teamSize: 1 });
    const foe = g.cars.find((c) => c.team !== g.human.team);
    g.ball.pos.set(3200, 93, -3200); // park the ball so the cars meet cleanly
    g.human.setPose(0, -400, 0, 100);
    foe.setPose(0, 400, 0, 100);
    g.human.vel.set(0, 0, 2300);
    g.human.supersonic = true;
    foe.vel.set(0, 0, 100);
    let demo = null;
    g.on('demo', (e) => (demo = e));
    for (let i = 0; i < 90 && !demo; i++) g.update(1 / 120);
    return { g, demo };
  };
  const a = hit({ demo: 'normal' });
  ok('normal rules demolish on a supersonic hit', !!a.demo);
  ok('normal rules respawn after 3s', a.demo && Math.abs(a.demo.victim.respawnTimer - 3) < 0.01, a.demo ? `${a.demo.victim.respawnTimer}s` : '');
  const b = hit({ demo: 'disabled' });
  ok('demos can be switched off', !b.demo && !b.g.cars.some((c) => c.demolished));
  const c = hit({ demo: 'instant' });
  ok('instant respawn clears the timer', c.demo && c.demo.victim.respawnTimer === 0, c.demo ? `${c.demo.victim.respawnTimer}s` : '');
  const d = hit({ demo: 'always' });
  ok('always-demo takes out the slower car', !!d.demo, d.demo ? `${d.demo.demolisher.name} -> ${d.demo.victim.name}` : 'no demo');
}

// ---- overtime -------------------------------------------------------------
{
  const g = mk({ overtime: 'none' });
  g.clock = 0.01;
  g.ball.onGround = true;
  for (let i = 0; i < 60 * 3 && g.state !== 'ended'; i++) g.update(1 / 60);
  ok('overtime off ends a tied match at 0:00', g.state === 'ended' && !g.overtime, `state ${g.state} ot ${g.overtime}`);
}
{
  const g = mk({ overtime: 'unlimited' });
  g.clock = 0.01;
  g.ball.onGround = true;
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  ok('standard rules go to overtime when tied', g.overtime === true);
}
{
  const g = mk({ overtime: 300 });
  g.clock = 0.01;
  g.ball.onGround = true;
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  ok('capped overtime starts', g.overtime && g.overtimeLimit === 300);
  // pretend the cap has already elapsed; the OT kickoff countdown still has to finish
  g.overtimeStart = -1000;
  for (let i = 0; i < 60 * 6 && g.state !== 'ended'; i++) g.update(1 / 60);
  ok('capped overtime ends the match after the cap', g.state === 'ended', `state ${g.state} t=${g.time.toFixed(0)}`);
}

// ---- mutators reach the sim, and drills stay standard ---------------------
{
  const g = new Game({ mode: 'drill', drill: 'shooting', level: 1, humanTeam: 0, teamSize: 1, difficulty: 'pro', drillBots: false });
  ok('drills run standard ball rules', g.ball.radius === 92.75 && !g.rumble);
  const r = resolve({ ballSize: 2, rumble: 'normal' });
  ok('resolve() keeps the raw choices for the UI', r.raw.ballSize === 2 && r.raw.rumble === 'normal');
}

// ---- full matches under heavy mutators -----------------------------------
for (const [name, mutators] of [
  ['chaos', { ballSize: 2, ballBounciness: 2.2, boost: 'rapid', respawn: 0, demo: 'instant', boostStrength: 1.5 }],
  ['snow day', { ballType: 'puck' }],
  ['rumble', { rumble: 'normal', boost: 'unlimited' }],
  ['no boost + no demos', { boost: 'none', demo: 'disabled' }],
  ['first to 3', { maxScore: 3, length: 0 }],
]) {
  const g = new Game({ mode: 'match', teamSize: 2, difficulty: 'allstar', duration: 60, humanTeam: 0, mutators, replays: false });
  let err = null;
  try {
    for (let i = 0; i < 90 * 60 && g.state !== 'ended'; i++) {
      if (g.human) {
        g.human.controls.throttle = 1;
        g.human.controls.boost = i % 120 < 80;
        if (g.rumble && g.human.item && g.human.item.cooldown <= 0 && i % 100 === 0) g.useItem(g.human);
      }
      g.update(1 / 60);
    }
  } catch (e) {
    err = e;
  }
  ok(`full match runs under "${name}"`, !err, err ? err.message : `${g.state} score ${g.score.join('-')} t=${g.time.toFixed(0)}`);
}

console.log(failed ? `${failed} MUTATOR CHECKS FAILED` : 'ALL MUTATOR CHECKS PASSED');
process.exit(failed ? 1 : 0);
