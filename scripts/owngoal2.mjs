globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'allstar', duration: 200, humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS.allstar); g.bots.push(hb); hb.onKickoff();
let printed = 0;
let kickoffT = 0;
g.on('go', () => (kickoffT = g.time));
g.on('goal', (e) => console.log('GOAL', e.team, e.scorer.name, 'own', e.ownGoal, 'speed', e.speed.toFixed(0), 'after kickoff', (g.time-kickoffT).toFixed(1)));
while (g.time < 70 && g.state!=='ended') {
  g.update(1/60);
  const dt = g.time - kickoffT;
  if (g.state==='play' && g.frame % 12 === 0 && dt < 8 && g.time > 40) { const b=g.ball; console.log(`t=${dt.toFixed(2)} ball=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) bv=(${b.vel.x.toFixed(0)},${b.vel.y.toFixed(0)},${b.vel.z.toFixed(0)}) `+g.cars.map(c=>{const bb=g.bots.find(x=>x.car===c); return `${c.name}[${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} ${c.onGround?'G':'A'} ${bb?.kickoff?'KO':bb?.role}/${bb?.maneuver?.type||'-'} ic=${bb?.intercept?.mode||'-'}]`}).join(' ')); }
}
