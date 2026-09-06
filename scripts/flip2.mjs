globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Car } = await import('../src/physics/car.js');
const car = new Car(0,'t'); car.setPose(0,0,0,100); car.vel.set(0,0,1000);
let t=0; const dt=1/120;
while (t<1.2){ car.controls.throttle=1; car.controls.boost = true; car.controls.jump = (t<0.02) || (t>0.1 && t<0.12); car.controls.pitch = (t>0.1&&t<0.12)?-1: (t>0.12? 1:0); car.step(dt); t+=dt;
 if (Math.round(t*120)%4===0) console.log(`t=${t.toFixed(2)} y=${car.pos.y.toFixed(1)} vy=${car.vel.y.toFixed(0)} spd=${car.speed.toFixed(0)} up.y=${car.up.y.toFixed(2)} fwd.y=${car.forward.y.toFixed(2)} ${car.onGround?'G':'A'} flip=${car.flipping} canc=${car.flipCancelled} wx=${car.angVel.length().toFixed(1)} bo=${car.boostActive}`);
}
