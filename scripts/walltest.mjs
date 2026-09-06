globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Car } = await import('../src/physics/car.js');
// drive straight at the side wall at x=4096 from x=2000 at 1400 uu/s
const car = new Car(0,'t'); car.setPose(2000,0,Math.PI/2,100); car.vel.set(1400,0,0);
let t=0; const dt=1/120; let maxY=0;
while (t<3.5){ car.controls.throttle=1; car.controls.boost = t<1.6; car.step(dt); t+=dt; maxY=Math.max(maxY,car.pos.y);
 if (Math.round(t*120)%12===0) console.log(`t=${t.toFixed(2)} pos=(${car.pos.x.toFixed(0)},${car.pos.y.toFixed(0)},${car.pos.z.toFixed(0)}) v=${car.speed.toFixed(0)} up=(${car.up.x.toFixed(2)},${car.up.y.toFixed(2)}) fwd.y=${car.forward.y.toFixed(2)} ${car.onGround?'G':'A'} n=(${car.surfaceNormal.x.toFixed(2)},${car.surfaceNormal.y.toFixed(2)})`);
}
console.log('maxY', maxY.toFixed(0));
