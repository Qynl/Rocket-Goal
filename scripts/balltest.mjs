globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Ball } = await import('../src/physics/ball.js');
const THREE = await import('three');
function sim(pos, vel, T, label, every=0.25) {
  const b = new Ball(); b.reset(new THREE.Vector3(...pos)); b.vel.set(...vel);
  let t=0, acc=0; const dt=1/120; let bounces=0; let lastGround=b.onGround;
  const rows=[];
  while (t<T) { b.step(dt); t+=dt; acc+=dt; if (!lastGround && b.onGround) bounces++; lastGround=b.onGround; if (acc>=every-1e-9){acc=0; rows.push(`t=${t.toFixed(2)} p=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) v=(${b.vel.x.toFixed(0)},${b.vel.y.toFixed(0)},${b.vel.z.toFixed(0)}) w=(${b.angVel.x.toFixed(1)},${b.angVel.y.toFixed(1)},${b.angVel.z.toFixed(1)})`);} }
  console.log('--', label, 'bounces', bounces); console.log(rows.join('\n'));
}
sim([0,1000,0],[1000,0,0],3,'drop w/ horizontal vel',0.5);
sim([0,93,0],[1500,0,0],4,'roll toward side wall',0.5);
sim([0,93,-4000],[0,600,-1500],3,'shot into blue goal',0.5);
sim([3800,300,4800],[1200,0,1200],2,'corner',0.25);
sim([0,1900,0],[0,800,0],2,'ceiling',0.25);
sim([0,93,0],[0,0,0],3,'rest',1);
