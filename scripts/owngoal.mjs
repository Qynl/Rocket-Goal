globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'allstar', duration: 200, humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS.allstar); g.bots.push(hb); hb.onKickoff();
const hist = [];
let done=false;
g.on('goal', (e) => { if (e.ownGoal && !done) { done=true; console.log('OWN GOAL', e.scorer.name, 'speed', e.speed.toFixed(0)); for (const h of hist.slice(-40)) console.log(h); } });
while (!done && g.time < 400 && g.state!=='ended') {
  g.update(1/60);
  if (g.frame % 8 === 0) { const b=g.ball; hist.push(`t=${g.time.toFixed(2)} st=${g.state} ball=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) bv=(${b.vel.x.toFixed(0)},${b.vel.y.toFixed(0)},${b.vel.z.toFixed(0)}) `+g.cars.map(c=>`${c.name}[${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} ${c.onGround?'G':'A'} ${g.bots.find(bb=>bb.car===c)?.role}/${g.bots.find(bb=>bb.car===c)?.maneuver?.type||'-'} demo=${c.demolished}]`).join(' ')); if (hist.length>60) hist.shift(); }
}
