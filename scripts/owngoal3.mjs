globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 200, humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS.pro); g.bots.push(hb); hb.onKickoff();
let kickoffT = 0;
g.on('go', () => (kickoffT = g.time));
const ember = g.bots.find(b=>b.car.name==='Ember');
while (g.time < 40 && g.state!=='ended') {
  g.update(1/60);
  const dt = g.time - kickoffT;
  if (g.state==="play" && g.frame % 10 === 0 && dt > 3.5 && dt < 11) { const b=g.ball; const c=ember.car; console.log(`t=${dt.toFixed(2)} ball=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) bv=(${b.vel.x.toFixed(0)},${b.vel.z.toFixed(0)}) Ember[${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} fs=${c.forwardSpeed.toFixed(0)} ${c.onGround?'G':'A'} ${ember.role}/${ember.maneuver?.type||'-'} ic=${ember.intercept?.mode||'-'}@${ember.intercept?((ember.intercept.time-g.time).toFixed(2)):'-'} thr=${c.controls.throttle.toFixed(1)} st=${c.controls.steer.toFixed(1)} hb=${c.controls.handbrake?1:0} b=${c.boost.toFixed(0)} fwd=(${c.forward.x.toFixed(2)},${c.forward.z.toFixed(2)})]`); }
}
