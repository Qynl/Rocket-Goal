// Exercise renderer.js construction & per-frame update with the GL renderer stubbed out.
import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><html><body><canvas id="game"></canvas><div id="ui"></div></body></html>`, { pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w; globalThis.document = w.document; globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} };
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
globalThis.HTMLElement = w.HTMLElement; globalThis.performance = w.performance; globalThis.devicePixelRatio = 1;
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') return new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4 * 1024 * 1024) }) : () => {}), set: () => true });
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
process.exit(err ? 1 : 0);
