globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const id = process.argv[2] || 'shooting';
const g = new Game({ mode: 'drill', drill: id, level: 2, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: true });
const hb = new Bot(g.human, g, SKILLS.champion); hb.kickoff = false; const origUpdate = g.update.bind(g); g.update = (dt) => { origUpdate(dt); }; g._humanBot = hb;
g.on('drillResult', (e) => console.log('RESULT', e.ok, e.feedback));
let acc=0;
while (g.time < 20) { { hb.update(1/60); g.update(1/60); } acc+=1/60; if (acc>=0.4){acc=0; const c=g.human; const ic=hb.intercept; console.log(`t=${g.time.toFixed(1)} role=${hb.role} man=${hb.maneuver?.type||'-'} ic=${ic?ic.mode+'@'+(ic.time-g.time).toFixed(2)+' k='+ic.kind:'-'} car=(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) v=${c.speed.toFixed(0)} thr=${c.controls.throttle.toFixed(1)} st=${c.controls.steer.toFixed(1)} b=${c.controls.boost?1:0} ${c.onGround?'G':'A'} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)}) bv=${g.ball.vel.length().toFixed(0)}`);} }
