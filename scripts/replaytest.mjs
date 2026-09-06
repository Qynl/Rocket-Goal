import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><canvas id="game"></canvas><div id="ui"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
globalThis.requestAnimationFrame = () => 0;
dom.window.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({ measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => (k in t ? t[k] : () => {}) , set: () => true }); };
const THREE = await import('three');
const { Renderer } = await import('../src/render/renderer.js');
const { Game } = await import('../src/game.js');
const { arenaOutline } = await import('../src/render/arenaMesh.js');
const stub = { shadowMap: {}, rendered: 0, setPixelRatio() {}, setSize() {}, render(scene, cam) { this.rendered++; scene.updateMatrixWorld(true); } };
const r = new Renderer(document.getElementById('game'), stub);
// geometry sanity
let nan = 0, tris = 0;
r.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) nan++; tris += (o.geometry.index ? o.geometry.index.count : a.length / 3) / 3; } });
console.log('scene NaN verts', nan, 'triangles', Math.round(tris));
// goal + replay
const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'rookie', duration: 60, humanTeam: 0, replays: true });
g.state = 'play'; g.ball.frozen = false; g.stateTimer = 0;
// deterministic goal: no bots to block the shot (bots now drive random cars/hitboxes)
g.bots.length = 0; g.cars = [g.human];
const view = { ballCam: true, rearView: false, followCar: g.human, mode: 'play', snap: true };
let replayFrames = 0, goalSeen = false, replayStarted = false;
g.on('goal', () => (goalSeen = true));
g.on('replayStart', () => (replayStarted = true));
let err = null;
try {
  // roll the ball into the orange goal
  for (let i = 0; i < 60 * 12 && g.state !== 'ended'; i++) {
    if (i === 60) { g.ball.pos.set(0, 93, 3000); g.ball.vel.set(0, 0, 2500); }
    g.human.controls.throttle = 1;
    g.update(1 / 60);
    if (g.state === 'goal') view.mode = 'goalReplay'; else if (view.mode === 'goalReplay') { view.mode = 'play'; view.snap = true; }
    r.update(g, 1 / 60, view);
    view.snap = false;
    if (g.replay) replayFrames++;
  }
} catch (e) { err = e; }
console.log('goal', goalSeen, 'replayStarted', replayStarted, 'replayFrames', replayFrames, 'state', g.state, 'score', g.score.join('-'), 'cam', r.camera.position.toArray().map((v) => v.toFixed(0)).join(','), 'err', err ? err.stack.split('\n').slice(0, 4).join(' | ') : 'none');
process.exit(err || !replayStarted ? 1 : 0);
