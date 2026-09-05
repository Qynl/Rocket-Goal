// Headless smoke test: run a bot-vs-bot match and print stats.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const { Game } = await import('../src/game.js');
const { SKILLS } = await import('../src/bot/bot.js');

const diff = process.argv[2] || 'allstar';
const size = parseInt(process.argv[3] || '1');
const seconds = parseInt(process.argv[4] || '120');
const g = new Game({ mode: 'match', teamSize: size, difficulty: diff, duration: seconds, humanTeam: 0 });
// make the human a bot too
const { Bot } = await import('../src/bot/bot.js');
const humanBot = new Bot(g.human, g, SKILLS[process.argv[5] || diff]);
g.bots.push(humanBot);
humanBot.onKickoff();
g.on('goal', (e) => console.log(`t=${g.time.toFixed(1)} GOAL ${e.team} by ${e.scorer?.name} own=${e.ownGoal} speed=${e.speed.toFixed(0)}  score ${g.score}`));
g.on('demo', (e) => console.log(`t=${g.time.toFixed(1)} DEMO ${e.demolisher.name} -> ${e.victim.name}`));
let maxBallSpeed = 0, maxCarSpeed = 0, nan = false;
const t0 = Date.now();
let steps = 0;
while (g.state !== 'ended' && g.time < seconds + 120) {
  g.update(1/60);
  steps++;
  maxBallSpeed = Math.max(maxBallSpeed, g.ball.vel.length());
  for (const c of g.cars) { maxCarSpeed = Math.max(maxCarSpeed, c.speed); if (!isFinite(c.pos.x) || !isFinite(c.quat.x)) nan = true; }
  if (!isFinite(g.ball.pos.x)) nan = true;
  if (nan) { console.log('NaN detected at t=', g.time); break; }
  if (steps % (60*30) === 0) {
    console.log(`t=${g.time.toFixed(0)} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)}) cars: ` + g.cars.map(c => `${c.name}[${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} b=${c.boost.toFixed(0)} ${c.onGround?'G':'A'} ${g.bots.find(b=>b.car===c)?.role}]`).join(' '));
  }
}
const ms = Date.now() - t0;
console.log(`Simulated ${g.time.toFixed(0)}s in ${ms}ms (${(g.time*1000/ms).toFixed(1)}x realtime). score=${g.score} maxBall=${maxBallSpeed.toFixed(0)} maxCar=${maxCarSpeed.toFixed(0)}`);
for (const c of g.cars) console.log(c.name, JSON.stringify({touches:c.stats.touches, shots:c.stats.shots, saves:c.stats.saves, goals:c.stats.goals, aerial:c.stats.aerialTouches, avgSpeed:(c.stats.speedSum/c.stats.speedSamples).toFixed(0), avgBoost:(c.stats.boostSum/c.stats.speedSamples).toFixed(0), boostUsed:c.stats.boostUsed.toFixed(0), collected:c.stats.boostCollected.toFixed(0)}));
