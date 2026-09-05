globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const g = new Game({ mode: 'drill', drill: 'dribbling', level: 1, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: false });
for (let i=0;i<180;i++){ g.human.controls.throttle = i>60 ? 0.6 : 0; g.update(1/60); if(i%20===0){const c=g.human,b=g.ball; console.log(`t=${(i/60).toFixed(2)} car z=${c.pos.z.toFixed(0)} v=${c.speed.toFixed(0)} ball=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) rel z=${(b.pos.z-c.pos.z).toFixed(0)} bv=(${b.vel.x.toFixed(0)},${b.vel.y.toFixed(0)},${b.vel.z.toFixed(0)})`);} }
