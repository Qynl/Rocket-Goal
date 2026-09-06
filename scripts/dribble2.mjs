globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.window = { addEventListener() {} };
const THREE = await import('three');
const { Car } = await import('../src/physics/car.js');
const { Ball } = await import('../src/physics/ball.js');
const { collideCarBall } = await import('../src/physics/collision.js');
const car = new Car(0,'t'); car.setPose(0,0,0,0);
const ball = new Ball(); ball.reset(new THREE.Vector3(0, 150, 20));
for (let i=0;i<120;i++){ const touched = collideCarBall(car, ball, i/120); ball.step(1/120); car.step(1/120); if(i%10===0) console.log(`t=${(i/120).toFixed(2)} ball=(${ball.pos.x.toFixed(1)},${ball.pos.y.toFixed(1)},${ball.pos.z.toFixed(1)}) v=(${ball.vel.x.toFixed(0)},${ball.vel.y.toFixed(0)},${ball.vel.z.toFixed(0)}) touched=${touched} carz=${car.pos.z.toFixed(1)}`); }
