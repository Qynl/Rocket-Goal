globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Car } = await import('../src/physics/car.js');
const { Ball } = await import('../src/physics/ball.js');
const { collideCarBall } = await import('../src/physics/collision.js');
function run(speed, dodge) {
  const car = new Car(0,'t'); car.setPose(0,-1500,0,100);
  const ball = new Ball(); ball.reset();
  car.vel.set(0,0,speed);
  let t=0; let touched=false; let maxBall=0; let carAfter=0;
  const dt=1/120;
  let dodged=false;
  while (t<2) {
    car.controls.throttle=1; car.controls.boost = speed>1410;
    const dist = ball.pos.z - car.pos.z;
    car.controls.jump = false;
    if (dodge && !dodged && dist < 420 + speed*0.1) { car.controls.jump = true; car._dj = t; dodged=true; }
    if (dodge && dodged && car._dj !== undefined && t - car._dj > 0.08 && t - car._dj < 0.1) { car.controls.jump = true; car.controls.pitch = -1; }
    car.step(dt); ball.step(dt);
    if (collideCarBall(car, ball, t)) touched=true;
    maxBall=Math.max(maxBall, ball.vel.length());
    if (touched && !carAfter && t - car.lastBallTouch > 0.1) carAfter = car.speed;
    t+=dt;
  }
  console.log(`car ${speed} dodge=${dodge}: ball max ${maxBall.toFixed(0)}, car after ${carAfter.toFixed(0)}, ball vel y ${ball.vel.y.toFixed(0)} touched=${touched}`);
}
for (const s of [500,1000,1410,2300]) { run(s,false); run(s,true); }
// flip test: how much speed is kept on a front flip and how long airborne
{
  const car = new Car(0,'t'); car.setPose(0,0,0,0); car.vel.set(0,0,1000);
  let t=0, air=0, maxY=0; const dt=1/120;
  while (t<2){ car.controls.throttle=1; car.controls.jump = (t<0.02) || (t>0.1 && t<0.12); car.controls.pitch = (t>0.1&&t<0.12)?-1:0; car.step(dt); if(!car.onGround) air+=dt; maxY=Math.max(maxY,car.pos.y); t+=dt; }
  console.log(`frontflip from 1000: speed after ${car.speed.toFixed(0)} airtime ${air.toFixed(2)} maxY ${maxY.toFixed(0)} up.y=${car.up.y.toFixed(2)}`);
}
{
  const car = new Car(0,'t'); car.setPose(0,0,0,0); car.vel.set(0,0,0);
  let t=0, air=0, maxY=0; const dt=1/120;
  while (t<2){ car.controls.jump = (t<0.2); car.step(dt); if(!car.onGround) air+=dt; maxY=Math.max(maxY,car.pos.y); t+=dt; }
  console.log(`held jump: airtime ${air.toFixed(2)} maxY ${maxY.toFixed(0)}`);
}
{
  const car = new Car(0,'t'); car.setPose(0,0,0,0); car.vel.set(0,0,0);
  let t=0, air=0, maxY=0; const dt=1/120;
  while (t<3){ car.controls.jump = (t<0.2) || (t>0.3 && t<0.32); car.step(dt); if(!car.onGround) air+=dt; maxY=Math.max(maxY,car.pos.y); t+=dt; }
  console.log(`double jump: airtime ${air.toFixed(2)} maxY ${maxY.toFixed(0)}`);
}
// aerial: jump + pitch up + boost 
{
  const car = new Car(0,'t'); car.setPose(0,0,0,100); car.vel.set(0,0,0);
  let t=0, maxY=0; const dt=1/120;
  while (t<2){ car.controls.jump = (t<0.2); car.controls.pitch = t<0.5? 1:0; car.controls.boost = t>0.1; car.step(dt); maxY=Math.max(maxY,car.pos.y); t+=dt; }
  console.log(`aerial 2s: maxY ${maxY.toFixed(0)} pos=(${car.pos.x.toFixed(0)},${car.pos.y.toFixed(0)},${car.pos.z.toFixed(0)}) fwd.y=${car.forward.y.toFixed(2)}`);
}
// turning radius at 1400
{
  const car = new Car(0,'t'); car.setPose(0,0,0,0); car.vel.set(0,0,1400);
  let t=0; const dt=1/120; let start=car.pos.clone();
  while (t<1.5){ car.controls.throttle=1; car.controls.steer=1; car.step(dt); t+=dt; }
  const f=car.forward; console.log(`turn 1.5s at 1400: yaw ${(Math.atan2(f.x,f.z)*180/Math.PI).toFixed(0)} deg, moved ${car.pos.distanceTo(start).toFixed(0)}`);
}
