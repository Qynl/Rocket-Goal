globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'allstar', duration: 60, humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS.allstar); g.bots.push(hb); hb.onKickoff();
const watch = g.bots[parseInt(process.argv[2]||'0')];
let acc=0;
while (g.state !== 'ended' && g.time < 40) {
  g.update(1/60); acc+=1/60;
  if (acc>=0.5){acc=0; const c=watch.car; const ic=watch.intercept;
    console.log(`t=${g.time.toFixed(1)} ${c.name} role=${watch.role} man=${watch.maneuver?.type||'-'} ic=${ic?ic.mode+'@'+(ic.time-g.time).toFixed(2):'-'} pos=(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) v=${c.speed.toFixed(0)} fwd=${c.forwardSpeed.toFixed(0)} b=${c.boost.toFixed(0)} thr=${c.controls.throttle.toFixed(1)} st=${c.controls.steer.toFixed(1)} bo=${c.controls.boost?1:0} hb=${c.controls.handbrake?1:0} ${c.onGround?'G':'A'} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)}) bv=${g.ball.vel.length().toFixed(0)}`);}
}
