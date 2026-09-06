globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'drill', drill: 'kickoffs', level: 1, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: true });
const hb = new Bot(g.human, g, SKILLS.champion);
const origNext = g.drill.nextAttempt.bind(g.drill);
g.drill.nextAttempt = () => { origNext(); hb.onKickoff(); hb.kickoffRole='go'; hb.maneuver=null; };
hb.onKickoff(); hb.kickoffRole='go';
g.on('drillResult', (e) => console.log('RESULT', e.ok, e.feedback));
g.on('touch', (e) => { if (g.drill.firstTouch && g.drill.firstTouch.car===e.car && Math.abs(g.drill.firstTouch.time - g.drill.attemptTime)<0.01) console.log(`  first touch by ${e.car.name} at ${g.drill.attemptTime.toFixed(2)}s  ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)}) car speed=${e.car.speed.toFixed(0)}`); });
let acc=0;
while (g.time < 40) { if (g.state !== 'countdown') hb.update(1/60); g.update(1/60); acc+=1/60; if (process.argv[2]==='v' && acc>=0.15 && g.state==='play' && g.drill.attempts===0){acc=0; const c=g.human; console.log(`t=${g.drill.attemptTime.toFixed(2)} man=${hb.maneuver?.type||'-'} pos=(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) v=${c.speed.toFixed(0)} b=${c.boost.toFixed(0)} ${c.onGround?'G':'A'} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)})`);} }
console.log('attempts', g.drill.attempts, 'ok', g.drill.successes);
