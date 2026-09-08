// Exercise renderer.js construction & per-frame update with the GL renderer stubbed out.
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
const dom = new JSDOM(`<!doctype html><html><body><canvas id="game"></canvas><div id="ui"></div></body></html>`, { pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w; globalThis.document = w.document; globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} };
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
globalThis.HTMLElement = w.HTMLElement; globalThis.performance = w.performance; globalThis.devicePixelRatio = 1;
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d')
    return new Proxy(
      {},
      {
        get: (t, k) =>
          k === 'measureText'
            ? () => ({ width: 10 })
            : k === 'getImageData'
              ? () => ({ data: new Uint8ClampedArray(4 * 1024 * 1024) })
              : k === 'createLinearGradient' || k === 'createRadialGradient'
                ? () => ({ addColorStop() {} })
                : () => {},
        set: () => true,
      }
    );
  return null;
};
globalThis.HTMLCanvasElement = w.HTMLCanvasElement;
const { Renderer } = await import('../src/render/renderer.js');
const { Game } = await import('../src/game.js');
const stub = { shadowMap: {}, rendered: 0, setPixelRatio() {}, setSize() {}, render(scene, cam) { this.rendered++; scene.updateMatrixWorld(true); cam.updateMatrixWorld(true); } };
const r = new Renderer(document.getElementById('game'), stub);
console.log('scene children', r.scene.children.length, 'pads', r.arena.pads.length);
const g = new Game({ mode: 'match', teamSize: 3, difficulty: 'allstar', duration: 60, humanTeam: 0 });
r.showPrediction = true;
const view = { ballCam: true, rearView: false, followCar: g.human, mode: 'play', snap: true };
let err = null;
try {
  for (let i = 0; i < 600; i++) { g.human.controls.throttle = 1; g.human.controls.boost = true; g.human.controls.handbrake = i % 100 < 30; g.update(1/60); if (i === 100) view.ballCam = false; if (i === 300) view.mode = 'goalReplay'; if (i===310) view.mode='play'; r.update(g, 1/60, view); view.snap = false; }
  console.log("car meshes during match", r.carMeshes.size); r.burst(g.ball.pos, 0xff0000, 50); r.kick(20); r.update(g, 1/60, view);
  const d = new Game({ mode: 'drill', drill: 'recovery', level: 3, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: false });
  for (let i = 0; i < 120; i++) { d.update(1/60); r.update(d, 1/60, { ...view, followCar: d.human }); }
  r.update({ ball: g.ball, cars: [], pads: g.pads, prediction: [], drill: null }, 1/60, { followCar: null, mode: 'goalReplay', ballCam: true });
} catch (e) { err = e; }
console.log('frames rendered', stub.rendered, 'car meshes', r.carMeshes.size, 'particles', r.particles.length, 'cam', r.camera.position.toArray().map(v=>v.toFixed(0)).join(','), 'err', err ? err.stack.split('\n').slice(0,4).join(' | ') : 'none');
// off-screen ball projection sanity: ball ahead of a car-cam follow => on screen; ball behind the camera => flagged behind
{
  const g2 = new Game({ mode: 'freeplay', humanTeam: 0 });
  const v2 = { followCar: g2.human, mode: 'play', ballCam: false, snap: true };
  g2.ball.pos.set(0, 93, 1500); g2.human.setPose(0, -1000, 0, 33);
  for (let i = 0; i < 60; i++) r.update(g2, 1/60, v2);
  const a = r.ballScreen;
  g2.ball.pos.set(0, 93, -3000);
  for (let i = 0; i < 60; i++) r.update(g2, 1/60, v2);
  const b = r.ballScreen;
  console.log('ballScreen ahead', a && `x=${a.x.toFixed(2)} y=${a.y.toFixed(2)} on=${a.onScreen}`, '| behind', b && `x=${b.x.toFixed(2)} y=${b.y.toFixed(2)} on=${b.onScreen} behind=${b.behind}`);
  if (!a || !a.onScreen || !b || b.onScreen || !b.behind) { console.log('BALL SCREEN CHECK FAILED'); err = err || new Error('ballScreen'); }
}
// ---- ground blob + soft sprites ------------------------------------------
{
  const g3 = new Game({ mode: 'freeplay', humanTeam: 0 });
  const v3 = { followCar: g3.human, mode: 'play', ballCam: false, snap: true };
  const m = r.getCarMesh(g3.human);
  const bad = [];
  // the blob is a scene object: parented to the chassis it would tilt with every
  // jump and hang in the air during an aerial (the old "blue slab" artefact)
  if (m.glow.parent === m.group) bad.push('blob is parented to the chassis');
  else if (m.glow.parent !== r.scene) bad.push('blob is not in the scene');
  if (Math.abs(m.glow.rotation.x + Math.PI / 2) > 1e-6) bad.push('blob is not flat on the floor');
  if (!m.glow.material.map) bad.push('blob has no soft texture (hard-edged quad)');
  if (m.glow.material.blending === THREE.AdditiveBlending) bad.push('blob is additive (washes out on bright floors)');

  g3.human.setPose(0, -1000, 0, 33);
  for (let i = 0; i < 40; i++) { g3.update(1 / 60); r.update(g3, 1 / 60, v3); }
  if (!m.glow.visible) bad.push('blob hidden while the car is on the ground');
  if (Math.abs(m.glow.position.y) > 3) bad.push(`blob floats at y=${m.glow.position.y.toFixed(2)} instead of on the floor`);
  if (!(m.glow.material.opacity > 0.35)) bad.push(`blob too faint on the ground: ${m.glow.material.opacity.toFixed(2)}`);
  if (Math.abs(m.glow.position.x - g3.human.pos.x) > 1 || Math.abs(m.glow.position.z - g3.human.pos.z) > 1) bad.push('blob is not under the car');
  const groundOpacity = m.glow.material.opacity;

  // airborne: the glow must fade out, not follow the car into the sky
  g3.human.pos.y = 900;
  g3.human.onGround = false;
  for (let i = 0; i < 40; i++) r.update(g3, 1 / 60, v3);
  if (m.glow.visible) bad.push(`blob still drawn ${g3.human.pos.y.toFixed(0)} uu up in the air`);
  if (m.glow.material.opacity > groundOpacity) bad.push('blob got brighter while airborne');

  // halfway up it should be partway faded, and a little wider (light spreads)
  g3.human.pos.y = 200;
  for (let i = 0; i < 40; i++) r.update(g3, 1 / 60, v3);
  if (!(m.glow.material.opacity < groundOpacity) && m.glow.visible) bad.push('blob does not fade with height');

  // demolished cars cast nothing
  g3.human.pos.y = 17;
  g3.human.demolished = true;
  for (let i = 0; i < 5; i++) r.update(g3, 1 / 60, v3);
  if (m.glow.visible) bad.push('blob still drawn for a demolished car');
  g3.human.demolished = false;

  // soft sprites everywhere a hard quad used to be
  if (!r.ballShadow.material.map) bad.push('ball shadow has no soft texture');
  if (!r.getParticle().mesh.material.map) bad.push('particles have no soft sprite');

  // reflections belong to the arena: changing theme must rebuild the env map
  let envCalls = 0;
  const realBuild = r.buildEnvironment.bind(r);
  r.buildEnvironment = (t) => { envCalls++; return realBuild(t); };
  r.setArenaTheme(r.themeName === 'stadium' ? 'dfh' : 'stadium');
  r.buildEnvironment = realBuild;
  if (envCalls !== 1) bad.push(`setArenaTheme rebuilt the environment ${envCalls} times, expected 1`);

  console.log(bad.length ? `GROUND BLOB CHECKS FAILED: ${bad.join('; ')}` : 'ground blob + soft sprites ok');
  if (bad.length) err = err || new Error('groundBlob');
}
// ---- arena themes --------------------------------------------------------
{
  const { ARENA_LIST } = await import('../src/arenas.js');
  const idle = { ball: g.ball, cars: [], pads: g.pads, prediction: [], drill: null };
  const v = { followCar: null, mode: 'goalReplay', ballCam: true };
  let themeErr = null;
  for (const a of ARENA_LIST) {
    try {
      r.setArenaTheme(a.id);
      for (let i = 0; i < 5; i++) r.update(idle, 1 / 60, v);
      const skyTop = r.skyMat.uniforms.top.value.getHex();
      const okSky = skyTop === a.sky.top;
      const okSun = r.sun.color.getHex() === a.sun.color && Math.abs(r.sun.intensity - a.sun.intensity) < 1e-6;
      const okFog = r.scene.fog.color.getHex() === a.fog.color;
      const okStars = Math.abs(r.stars.material.opacity - a.stars) < 1e-6;
      const okSeats = r.seatMats.every((m, i) => m.color.getHex() === a.seat[i % a.seat.length]);
      if (!(okSky && okSun && okFog && okStars && okSeats)) throw new Error(`${a.id} sky=${okSky} sun=${okSun} fog=${okFog} stars=${okStars} seats=${okSeats}`);
      if (r.arena.pads.length !== 34) throw new Error(a.id + ' pads ' + r.arena.pads.length);
    } catch (e) { themeErr = e; }
  }
  console.log('arenas themed', ARENA_LIST.length, 'err', themeErr ? themeErr.message : 'none');
  if (themeErr) err = err || themeErr;
  r.setArenaTheme('stadium');
}
// ---- garage turntable ----------------------------------------------------
{
  const { Car } = await import('../src/physics/car.js');
  const showCar = new Car(0, 'Showcase', false, { car: 'batmobile', primary: 0x00ff00, finish: 'chrome', wheels: 'neon', trail: 'purple' });
  showCar.setPose(0, 0, 0.5, 100);
  r.showcase = { car: showCar };
  let showErr = null;
  try {
    for (let i = 0; i < 40; i++) r.update({ ball: g.ball, cars: [], pads: g.pads, prediction: [], drill: null }, 1 / 60, { followCar: null, mode: 'goalReplay', ballCam: true });
    const m = r.carMeshes.get(showCar.id);
    if (!m) throw new Error('showcase car mesh missing');
    if (m.paintMat.color.getHex() !== 0x00ff00) throw new Error('showcase paint ' + m.paintMat.color.getHex());
    if (r.ballMesh.visible) throw new Error('ball should be hidden on the turntable');
    const dist = r.camera.position.distanceTo(showCar.pos);
    if (dist > 900) throw new Error('turntable camera too far: ' + dist.toFixed(0));
    console.log('garage turntable cam dist', dist.toFixed(0), 'paint ok, ball hidden');
  } catch (e) { showErr = e; }
  console.log('showcase err', showErr ? showErr.message : 'none');
  if (showErr) err = err || showErr;
  r.showcase = null;
  for (let i = 0; i < 3; i++) r.update({ ball: g.ball, cars: [], pads: g.pads, prediction: [], drill: null }, 1 / 60, { followCar: null, mode: 'goalReplay', ballCam: true });
  if (r.carMeshes.size !== 0) { console.log('showcase mesh not cleaned up'); err = err || new Error('cleanup'); }
}
// ---- loadouts + goal explosions in a live match --------------------------
{
  const loadoutGame = new Game({ mode: 'match', teamSize: 2, difficulty: 'allstar', duration: 60, humanTeam: 0, loadout: { car: 'merc', primary: 0x123456, finish: 'carbon', wheels: 'offroad', trail: 'ice', explosion: 'lightning' } });
  let loadErr = null;
  try {
    const v = { followCar: loadoutGame.human, mode: 'play', ballCam: true, snap: true };
    for (let i = 0; i < 120; i++) { loadoutGame.human.controls.throttle = 1; loadoutGame.update(1 / 60); r.update(loadoutGame, 1 / 60, v); v.snap = false; }
    const mesh = r.carMeshes.get(loadoutGame.human.id);
    if (!mesh) throw new Error('no mesh for the loadout car');
    if (mesh.spec.preset.id !== 'merc') throw new Error('mesh built for ' + mesh.spec.preset.id);
    if (mesh.paintMat.color.getHex() !== 0x123456) throw new Error('loadout paint ignored');
    if (mesh.flame.material.color.getHex() !== 0x9ff0ff) throw new Error('boost trail ignored');
    if (!loadoutGame.human.hitbox.half.y > 0) throw new Error('hitbox');
    for (const kind of ['default', 'fireworks', 'confetti', 'shockwave', 'lightning']) {
      r.goalExplosion(loadoutGame.ball.pos, 0x2a6cff, kind);
      r.update(loadoutGame, 1 / 60, v);
    }
    console.log('loadout mesh merc paint+trail ok, 5 goal explosions rendered');
  } catch (e) { loadErr = e; }
  console.log('loadout err', loadErr ? loadErr.stack.split('\n').slice(0, 3).join(' | ') : 'none');
  if (loadErr) err = err || loadErr;
}
process.exit(err ? 1 : 0);
