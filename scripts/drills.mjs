globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const { DRILLS } = await import('../src/training.js');
const { Coach } = await import('../src/coach.js');
for (const d of DRILLS) {
  const g = new Game({ mode: 'drill', drill: d.id, level: 2, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: d.hasBots });
  const coach = new Coach(g);
  const hb = new Bot(g.human, g, SKILLS.champion); hb.kickoff = false; const origUpdate = g.update.bind(g); g.update = (dt) => { origUpdate(dt); }; g._humanBot = hb;
  let msgs = [];
  g.on('drillResult', (e) => msgs.push((e.ok?'OK ':'X  ') + e.feedback));
  let err = null;
  try { while (g.time < 60) { { hb.update(1/60); g.update(1/60); } coach.update(1/60); } } catch (e) { err = e; }
  console.log(`${d.id}: attempts=${g.drill.attempts} ok=${g.drill.successes} level=${g.drill.level} err=${err ? err.stack.split('\n').slice(0,3).join(' | ') : 'none'}`);
  console.log('   ' + msgs.slice(0,4).join('\n   '));
}
// 2v2 and 3v3 smoke
for (const size of [2,3]) {
  const g = new Game({ mode: 'match', teamSize: size, difficulty: 'champion', duration: 60, humanTeam: 1 });
  const hb = new Bot(g.human, g, SKILLS.champion); g.bots.push(hb); hb.onKickoff();
  const coach = new Coach(g);
  let err=null; let ended=false; g.on('ended', ()=>ended=true);
  try { while (g.time < 150 && !ended) { { hb.update(1/60); g.update(1/60); } coach.update(1/60);} } catch(e){err=e;}
  console.log(`${size}v${size}: score=${g.score} ended=${ended} t=${g.time.toFixed(0)} err=${err?err.stack.split('\n').slice(0,3).join(' | '):'none'}`);
  if (ended) { const st = g.collectStats(); console.log('   report items:', coach.report(st).length, st.cars.map(c=>`${c.name}:${c.score}`).join(' ')); }
}
// freeplay
{ const g = new Game({ mode: 'freeplay', humanTeam: 0 }); let err=null; try { for (let i=0;i<600;i++){ g.human.controls.throttle=1; g.human.controls.boost=true; g.human.controls.jump = i%120===0; g.update(1/60); } g.resetFreeplay(); } catch(e){err=e;} console.log('freeplay err', err?err.stack:'none', 'cars', g.cars.length); }
