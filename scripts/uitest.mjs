// jsdom smoke test for the React UI (no WebGL): menus, HUD store, input, coach
import { register } from 'node:module';
register('./jsx.hooks.mjs', import.meta.url);
import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
globalThis.document = w.document;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.HTMLElement = w.HTMLElement;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.confirm = () => true;
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Menus } = await import('../src/ui/Menus.jsx');
const { Hud } = await import('../src/ui/Hud.jsx');
const { HudStore, drawMinimap } = await import('../src/ui/hudStore.js');
const { Input } = await import('../src/input.js');
const { Game } = await import('../src/game.js');
const { Coach } = await import('../src/coach.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errors = [];
const tryit = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { errors.push(name); console.log('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); } };
const tryasync = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { errors.push(name); console.log('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); } };

// fake engine: same surface App.jsx passes to Menus, without the WebGL renderer
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const input = new Input(canvas);
const fakeEngine = {
  audio: { ui() {}, setVolume() {}, resume() {} },
  renderer: { setCameraSettings() {}, showPrediction: false, setQuality() {} },
  input,
  game: null,
  settings: { teamSize: 1, difficulty: 'allstar', duration: 300, humanTeam: 0, boostMutator: 'normal', camera: { fov: 90, distance: 270, height: 110, angle: -3, stiffness: 0.5, swivel: 2.5 }, quality: 'high', replays: true, showPrediction: false, coach: true, quickChat: true, volume: 0.6, playerName: 'You', drillLevel: 1, lastDrill: 'shooting' },
  applySettings() {},
  startGame(cfg) { this.started = cfg; },
  resume() {}, restart() {}, quitToMenu() {}, forfeit() {},
};
const nav = (p) => renderUi(p);
const hudStore = new HudStore();

const root = createRoot(document.getElementById('root'));
const renderUi = (overlay) => {
  root.render(React.createElement('div', null,
    React.createElement(Hud, { store: hudStore }),
    React.createElement(Menus, { engine: fakeEngine, overlay, nav })));
};
renderUi({ type: 'menu' });
await sleep(80);

await tryasync('main menu renders cards', async () => {
  const cards = document.querySelectorAll('.card');
  if (cards.length < 6) throw new Error('cards ' + cards.length);
});
await tryasync('match setup flow', async () => {
  document.querySelectorAll('.card')[0].click();
  await sleep(30);
  if (!document.querySelector('h2') || !document.querySelector('h2').textContent.includes('Match setup')) throw new Error('no match setup');
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Start match');
  btn.click();
  await sleep(30);
  if (!fakeEngine.started || fakeEngine.started.mode !== 'match') throw new Error('not started');
});
await tryasync('training screen + aerials drill', async () => {
  renderUi({ type: 'training' });
  await sleep(30);
  if (document.querySelectorAll('.card').length !== 7) throw new Error('drill cards');
  document.querySelectorAll('.card')[2].click(); // aerials
  await sleep(30);
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Start drill');
  btn.click();
  await sleep(30);
  if (!fakeEngine.started || fakeEngine.started.drill !== 'aerials') throw new Error('drill ' + fakeEngine.started?.drill);
});
await tryasync('progress + howto + settings tabs', async () => {
  for (const type of ['progress', 'howto', 'settings']) {
    renderUi({ type });
    await sleep(30);
  }
  const tabs = document.querySelectorAll('.tabs button');
  if (tabs.length !== 3) throw new Error('tabs');
  for (const t of tabs) { t.click(); await sleep(20); }
  // rebind interaction needs real events; check bind grid exists
  if (document.querySelectorAll('.bind-grid').length < 1) throw new Error('bind grid');
});
await tryasync('pause screen with live game', async () => {
  fakeEngine.game = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 60, humanTeam: 0 });
  renderUi({ type: 'pause' });
  await sleep(30);
  if (!document.body.textContent.includes('Paused')) throw new Error('no pause panel');
  if (!document.body.textContent.includes('Touches')) throw new Error('no stats');
});
await tryasync('results screen', async () => {
  const g = fakeEngine.game;
  for (let i = 0; i < 60 * 20; i++) { g.human.controls.throttle = 1; g.human.controls.boost = i % 200 < 100; g.update(1 / 60); }
  const coach = new Coach(g);
  const st = g.collectStats();
  const rep = coach.report(st);
  if (!rep.length) throw new Error('report empty');
  renderUi({ type: 'results', stats: st, report: rep, config: { mode: 'match' } });
  await sleep(30);
  if (!document.body.textContent.includes('Coach report')) throw new Error('no report');
});
await tryasync('hud store + hud render', async () => {
  const g = fakeEngine.game || new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 60, humanTeam: 0 });
  fakeEngine.game = g;
  hudStore.setVisible(true);
  hudStore.showMessage('GOAL!', 'blue', 2);
  hudStore.addFeed('test feed');
  hudStore.addStat('SAVE', 50, true);
  hudStore.addChat('Bot', 0, 'What a save!');
  hudStore.showCoach('tip');
  hudStore.setBoard(true, g);
  for (let i = 0; i < 40; i++) hudStore.update(g, 1 / 60, input, { ballCam: true, mode: 'play' });
  await sleep(60);
  if (!document.body.textContent.includes('BOOST')) throw new Error('no boost gauge');
  if (!document.body.textContent.includes('test feed')) throw new Error('no feed');
  if (!document.body.textContent.includes('What a save!')) throw new Error('no chat');
  if (!document.body.textContent.includes('SAVE')) throw new Error('no stat pop');
  hudStore.setReplay(true);
  await sleep(40);
  if (!document.body.textContent.includes('REPLAY')) throw new Error('no replay banner');
  hudStore.setReplay(false);
  hudStore.setVisible(false);
  await sleep(40);
});
tryit('input update', () => {
  const c = input.update();
  if (typeof c.throttle !== 'number') throw new Error('controls');
  input.keys.add('KeyW');
  const c2 = input.update();
  if (c2.throttle !== 1) throw new Error('W not throttle: ' + c2.throttle);
  input.keys.delete('KeyW');
});
tryit('a/d air roll directions', () => {
  input.keys.add('ControlLeft'); input.keys.add('KeyD');
  const c = input.update();
  if (c.roll !== 1) throw new Error('D should roll right, got ' + c.roll);
  input.keys.delete('KeyD'); input.keys.add('KeyA');
  const c2 = input.update();
  if (c2.roll !== -1) throw new Error('A should roll left, got ' + c2.roll);
  input.keys.delete('KeyA'); input.keys.delete('ControlLeft');
});
tryit('rebind + presets', () => {
  input.rebind('boost', 'KeyB');
  if (input.binds.boost[0] !== 'KeyB') throw new Error('rebind');
  input.setPreset('rl');
  if (input.binds.boost[0] !== 'Mouse0') throw new Error('preset');
  input.setPreset('keyboard');
});
tryit('minimap draw', () => {
  const cv = document.createElement('canvas');
  cv.width = 360; cv.height = 260;
  const ctx = cv.getContext('2d');
  drawMinimap(ctx, cv, hudStore.live.minimap);
});
console.log(errors.length ? 'FAILURES: ' + errors.join(', ') : 'ALL UI TESTS PASSED');
process.exit(errors.length ? 1 : 0);
