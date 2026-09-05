globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const THREE = await import('three');
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const { aerialRequirement } = await import('../src/bot/controllers.js');
// scenario: ball popped high near the wall, car below, needs to travel far
const g = new Game({ mode: 'freeplay', humanTeam: 0 });
const hb = new Bot(g.human, g, SKILLS.champion); hb.kickoff=false;
g.human.setPose(-200, 3500, 0, 100); g.human.vel.set(0,0,1600);
g.ball.reset(new THREE.Vector3(-1200, 200, 4500)); g.ball.vel.set(-1500, 1500, 300);
g.predictionDirty=true;
let acc=0;
for (let i=0;i<60*5;i++){ hb.update(1/60); g.update(1/60); acc+=1/60;
  if (acc>=0.1){acc=0; const c=g.human; const ic=hb.intercept; const req = ic? aerialRequirement(c, ic.pos.clone().addScaledVector(ic.dir, -(92.75+25)), ic.time-g.time):null;
  const f=c.forward; const rq = req? req.clone().normalize():null;
  console.log(`t=${g.time.toFixed(1)} man=${hb.maneuver?.type||'-'} ph=${hb.maneuver?.phase} ic=${ic?ic.mode+'@'+(ic.time-g.time).toFixed(2):'-'} req=${req?req.length().toFixed(0):'-'} reqdir=${rq?`(${rq.x.toFixed(2)},${rq.y.toFixed(2)},${rq.z.toFixed(2)})`:''} fwd=(${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)}) car=(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) v=(${c.vel.x.toFixed(0)},${c.vel.y.toFixed(0)},${c.vel.z.toFixed(0)}) bo=${c.controls.boost?1:0} p=${c.controls.pitch.toFixed(2)} y=${c.controls.yaw.toFixed(2)} r=${c.controls.roll.toFixed(2)} ball=(${g.ball.pos.x.toFixed(0)},${g.ball.pos.y.toFixed(0)},${g.ball.pos.z.toFixed(0)})`);}
}
