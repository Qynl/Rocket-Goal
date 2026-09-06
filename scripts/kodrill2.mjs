globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const g = new Game({ mode: 'drill', drill: 'kickoffs', level: 2, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: true });
const hb = new Bot(g.human, g, SKILLS.champion);
let wasCountdown = false, n=0; let goT=null;
g.on('drillResult', (e) => { n++; goT=null; });
let acc=0;
while (g.time < 30 && n < 1) {
  if (g.state === 'countdown' && !wasCountdown) { hb.onKickoff(); }
  if (wasCountdown && g.state !== 'countdown') goT = g.time;
  wasCountdown = g.state === 'countdown';
  hb.update(1/60); g.update(1/60);
  if (goT!==null && g.time-goT < 1.5) { acc+=1/60; if (acc>0.05){acc=0; const h=g.human, o=g.bots[0].car; const hc=h.controls, oc=o.controls; console.log(`t+${(g.time-goT).toFixed(2)} You sp=${h.speed.toFixed(0)} b=${h.boost.toFixed(0)} thr=${hc.throttle} bo=${hc.boost} st=${hc.steer.toFixed(2)} man=${hb.maneuver?.type||'-'} | Opp sp=${o.speed.toFixed(0)} b=${o.boost.toFixed(0)} thr=${oc.throttle} bo=${oc.boost} st=${oc.steer.toFixed(2)} man=${g.bots[0].maneuver?.type||'-'}`);} }
}
