globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const diff = process.argv[2] || 'pro';
const g = new Game({ mode: 'match', teamSize: 1, difficulty: diff, duration: 300, humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS[diff]); g.bots.push(hb); hb.onKickoff();
const ember = g.bots.find(b=>b.car.name==='Ember');
const hist = []; let done = false;
g.on('goal', (e) => { if (e.ownGoal && e.scorer.name==='Ember' && !done) { done = true; console.log('OWN GOAL speed', e.speed.toFixed(0), 't', g.time.toFixed(1)); hist.slice(-45).forEach(h=>console.log(h)); } });
while (!done && g.time < 300 && g.state!=='ended') {
  g.update(1/60);
  if (g.frame % 8 === 0) { const b=g.ball; const c=ember.car; const y=g.human; hist.push(`t=${g.time.toFixed(2)} ball=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) bv=(${b.vel.x.toFixed(0)},${b.vel.y.toFixed(0)},${b.vel.z.toFixed(0)}) You[${y.pos.x.toFixed(0)},${y.pos.z.toFixed(0)}] Ember[${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} fs=${c.forwardSpeed.toFixed(0)} ${c.onGround?'G':'A'} ${ember.role}/${ember.maneuver?.type||'-'} ic=${ember.intercept?.mode||'-'}/${ember.intercept?.kind||''}@${ember.intercept?((ember.intercept.time-g.time).toFixed(2)):'-'} thr=${c.controls.throttle.toFixed(1)} st=${c.controls.steer.toFixed(1)} hb=${c.controls.handbrake?1:0} b=${c.boost.toFixed(0)} fwd=(${c.forward.x.toFixed(2)},${c.forward.z.toFixed(2)})]`); if (hist.length>60) hist.shift(); }
}
