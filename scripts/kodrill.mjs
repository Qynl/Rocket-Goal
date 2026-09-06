globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const diff = process.argv[2] || 'champion';
const g = new Game({ mode: 'drill', drill: 'kickoffs', level: 2, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: true });
const hb = new Bot(g.human, g, SKILLS[diff]);
let ok = 0, n = 0;
g.on('drillResult', (e) => { n++; if (e.ok) ok++; console.log('RESULT', e.ok, e.feedback); });
let wasCountdown = false;
while (g.time < 60 && n < 6) {
  if (g.state === 'countdown' && !wasCountdown) hb.onKickoff();
  wasCountdown = g.state === 'countdown';
  hb.update(1/60); g.update(1/60);
}
console.log(`${diff} as human: ${ok}/${n}`);
// detail run
{
const g = new Game({ mode: 'drill', drill: 'kickoffs', level: 2, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: true });
const hb = new Bot(g.human, g, SKILLS.champion);
let wasCountdown = false, n=0; let goT=null;
g.on('drillResult', (e) => { n++; console.log('RESULT', e.ok, e.feedback); goT=null; });
g.on('touch', (e)=> console.log(`  touch ${e.car.name} t+${(g.time-goT).toFixed(2)} ball v=(${g.ball.vel.x.toFixed(0)},${g.ball.vel.y.toFixed(0)},${g.ball.vel.z.toFixed(0)})`));
let acc=0;
while (g.time < 30 && n < 3) {
  if (g.state === 'countdown' && !wasCountdown) { hb.onKickoff(); console.log('spawn', g.human.pos.x.toFixed(0), g.human.pos.z.toFixed(0), 'opp', g.bots[0].car.pos.x.toFixed(0), g.bots[0].car.pos.z.toFixed(0), 'hbplan', JSON.stringify(hb.kickoffPlan), 'botplan', JSON.stringify(g.bots[0].kickoffPlan)); }
  if (wasCountdown && g.state !== 'countdown') goT = g.time;
  wasCountdown = g.state === 'countdown';
  hb.update(1/60); g.update(1/60);
  if (goT!==null && g.time-goT < 3) { acc+=1/60; if (acc>0.25){acc=0; const h=g.human, o=g.bots[0].car; console.log(`  t+${(g.time-goT).toFixed(2)} You(${h.pos.x.toFixed(0)},${h.pos.z.toFixed(0)}) sp=${h.speed.toFixed(0)} man=${hb.maneuver?.type||'-'} ko=${hb.kickoff} | Opp(${o.pos.x.toFixed(0)},${o.pos.z.toFixed(0)}) sp=${o.speed.toFixed(0)} man=${g.bots[0].maneuver?.type||'-'} ko=${g.bots[0].kickoff} | ball(${g.ball.pos.x.toFixed(0)},${g.ball.pos.z.toFixed(0)})`);} }
}
}
