globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const { aerialRequirement } = await import('../src/bot/controllers.js');
const verbose = process.argv[2] === 'v';
let hits=0, tries=0;
for (let trial=0; trial<12; trial++) {
  const g = new Game({ mode: 'freeplay', humanTeam: 0 });
  const hb = new Bot(g.human, g, SKILLS.champion); hb.kickoff=false;
  g.human.setPose((Math.random()-0.5)*2000, -3500, 0, 100);
  g.ball.reset(new THREE.Vector3((Math.random()-0.5)*2000, 100, -1000 + Math.random()*1500));
  g.ball.vel.set((Math.random()-0.5)*400, 900 + Math.random()*400, (Math.random()-0.5)*300);
  g.predictionDirty = true;
  let touched=false, touchH=0, aerialStarted=false, maxH=0; let acc=0;
  g.on('touch', ()=>{ if(!touched){touched=true; touchH=g.ball.pos.y;} });
  for (let i=0;i<60*5;i++){ hb.update(1/60); g.update(1/60); maxH=Math.max(maxH,g.human.pos.y);
    if (hb.maneuver?.type==='aerial') aerialStarted=true;
    acc+=1/60;
    if (verbose && trial===0 && acc>=0.2){acc=0; const c=g.human; const ic=hb.intercept; const req = ic? aerialRequirement(c, ic.point, ic.time-g.time).length():0; console.log(`t=${g.time.toFixed(1)} man=${hb.maneuver?.type||'-'} ph=${hb.maneuver?.phase} ic=${ic?ic.mode+'@'+(ic.time-g.time).toFixed(2):'-'} req=${req.toFixed(0)} car=(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) v=${c.speed.toFixed(0)} fwd.y=${c.forward.y.toFixed(2)} bo=${c.controls.boost?1:0} pitch=${c.controls.pitch.toFixed(2)} boost=${c.boost.toFixed(0)} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)})`);}
    if (touched) break; }
  tries++; if (touched && touchH>400) hits++;
  console.log(`trial ${trial}: aerialStarted=${aerialStarted} touched=${touched} touchH=${touchH.toFixed(0)} carMaxH=${maxH.toFixed(0)}`);
}
console.log(`aerial hits ${hits}/${tries}`);
