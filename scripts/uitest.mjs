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
const { defaultMutators, describe: describeMutators } = await import('../src/mutators.js');
const { CARS } = await import('../src/cars.js');
const { loadProfile, awardMatch, rankOf, levelOf } = await import('../src/progress.js');

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
  renderer: { setCameraSettings() {}, showPrediction: false, setQuality() {}, setArenaTheme(id) { this.arena = id; }, arena: 'stadium' },
  input,
  game: null,
  previews: [],
  settings: { teamSize: 1, difficulty: 'allstar', duration: 300, humanTeam: 0, arena: 'stadium', mutators: defaultMutators(), loadout: { car: 'octane', primary: 0x1b3f9e, secondary: 0x0e1220, finish: 'glossy', wheels: 'spoke', trail: 'default', explosion: 'default' }, camera: { fov: 90, distance: 270, height: 110, angle: -3, stiffness: 0.5, swivel: 2.5 }, quality: 'high', replays: true, showPrediction: false, coach: true, quickChat: true, volume: 0.6, playerName: 'You', drillLevel: 1, lastDrill: 'shooting' },
  applySettings(s) { this.settings = s; },
  startGame(cfg) { this.started = cfg; },
  setGaragePreview(loadout) { this.previews.push(JSON.parse(JSON.stringify(loadout))); return {}; },
  clearGaragePreview() { this.previews.push(null); },
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
await tryasync('garage: cars, hitbox readout, cosmetics', async () => {
  fakeEngine.previews.length = 0;
  renderUi({ type: 'garage' });
  await sleep(250);
  if (!document.body.textContent.includes('Garage')) throw new Error('no garage title');
  const cars = document.querySelectorAll('.car-grid .car');
  if (cars.length !== CARS.length) throw new Error('car cards ' + cars.length + ' != ' + CARS.length);
  if (!fakeEngine.previews.length) throw new Error('turntable preview not requested');
  if (!document.body.textContent.includes('Octane hitbox')) throw new Error('no hitbox readout');
  // pick the Merc and check the hitbox numbers change
  const merc = Array.from(cars).find((c) => c.textContent.includes('Merc'));
  merc.click();
  await sleep(60);
  if (fakeEngine.settings.loadout.car !== 'merc') throw new Error('car not selected');
  if (!document.body.textContent.includes('47.3 uu')) throw new Error('merc height missing from readout');
  // paint swatch
  const sw = document.querySelectorAll('.swatches button');
  if (sw.length < 40) throw new Error('swatches ' + sw.length);
  sw[0].click();
  await sleep(40);
  if (fakeEngine.settings.loadout.primary !== 0xc8102e) throw new Error('primary ' + fakeEngine.settings.loadout.primary);
  // finish / wheels / trail / explosion segments
  const segs = document.querySelectorAll('.seg');
  if (segs.length < 4) throw new Error('cosmetic segments ' + segs.length);
  for (const seg of segs) { seg.querySelectorAll('button')[1]?.click(); await sleep(20); }
  const L = fakeEngine.settings.loadout;
  if (L.finish === 'glossy' && L.wheels === 'spoke') throw new Error('cosmetics did not change');
  fakeEngine.settings.loadout = { car: 'octane', primary: 0x1b3f9e, secondary: 0x0e1220, finish: 'glossy', wheels: 'spoke', trail: 'default', explosion: 'default' };
});

await tryasync('match setup: arena picker + mutators', async () => {
  renderUi({ type: 'matchSetup' });
  await sleep(40);
  const arenaBtns = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Wasteland');
  if (!arenaBtns.length) throw new Error('no arena picker');
  arenaBtns[0].click();
  await sleep(40);
  if (fakeEngine.settings.arena !== 'wasteland') throw new Error('arena ' + fakeEngine.settings.arena);
  // presets
  const chaos = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Chaos');
  chaos.click();
  await sleep(40);
  const mods = describeMutators(fakeEngine.settings.mutators);
  if (mods.length < 4) throw new Error('chaos mutators ' + mods.join('|'));
  if (!document.body.textContent.includes('Ball size: Gigantic')) throw new Error('summary not shown');
  // advanced panel
  const adv = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Advanced rules');
  adv.click();
  await sleep(40);
  const fields = document.querySelectorAll('.mut-grid .field');
  if (fields.length < 10) throw new Error('mutator fields ' + fields.length);
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Reset').click();
  await sleep(30);
  if (describeMutators(fakeEngine.settings.mutators).length !== 0) throw new Error('reset failed');
  const start = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Start match');
  start.click();
  await sleep(30);
  if (!fakeEngine.started || !fakeEngine.started.mutators || !fakeEngine.started.loadout) throw new Error('match config missing mutators/loadout');
  fakeEngine.settings.arena = 'stadium';
});

await tryasync('rumble HUD: item meter + respawn', async () => {
  const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 60, humanTeam: 0, mutators: { rumble: 'normal' } });
  g.state = 'play';
  g.human.item = { id: 'tornado', cooldown: 0, timer: 0 };
  hudStore.setVisible(true);
  for (let i = 0; i < 10; i++) hudStore.update(g, 1 / 60, input, { ballCam: true, mode: 'play' });
  await sleep(50);
  if (!document.querySelector('#hud .item')) throw new Error('no item meter');
  if (!document.body.textContent.includes('Tornado')) throw new Error('item name missing');
  g.human.item.cooldown = 5;
  for (let i = 0; i < 10; i++) hudStore.update(g, 1 / 60, input, { ballCam: true, mode: 'play' });
  await sleep(50);
  if (!document.body.textContent.includes('Recharging')) throw new Error('no recharge state');
  g.human.demolished = true;
  g.human.respawnTimer = 2.4;
  for (let i = 0; i < 10; i++) hudStore.update(g, 1 / 60, input, { ballCam: true, mode: 'play' });
  await sleep(50);
  if (!document.querySelector('#hud .respawn')) throw new Error('no respawn overlay');
  hudStore.setVisible(false);
  await sleep(40);
});

tryit('xp + rank progression', () => {
  localStorage.removeItem('rocketgoal.profile.v1');
  const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'champion', duration: 60, humanTeam: 0 });
  g.score[0] = 2;
  g.human.stats.goals = 2;
  g.human.stats.saves = 1;
  g.human.stats.score = 260;
  const st = g.collectStats();
  const res = awardMatch(st, { mode: 'match', difficulty: 'champion' });
  if (res.total < 60) throw new Error('xp too low: ' + res.total);
  if (!res.breakdown.some((b) => b.label === 'Victory')) throw new Error('no victory bonus');
  if (!res.breakdown.some((b) => b.label.includes('bot skill bonus'))) throw new Error('no difficulty bonus');
  const p = loadProfile();
  if (p.xp !== res.total || p.matches !== 1 || p.wins !== 1) throw new Error('profile not saved: ' + JSON.stringify(p));
  if (levelOf(p.xp) !== res.after.level) throw new Error('level mismatch');
  // ranks climb
  const low = rankOf(0);
  const high = rankOf(20000);
  if (low.tier !== 'Unranked' || high.tier !== 'Supersonic Legend') throw new Error('ranks ' + low.tier + '/' + high.tier);
  if (rankOf(1000).tier !== 'Silver') throw new Error('1000 xp should be silver, got ' + rankOf(1000).tier);
});

await tryasync('results screen shows xp', async () => {
  const g = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 60, humanTeam: 0 });
  g.score[0] = 1;
  const st = g.collectStats();
  const res = awardMatch(st, { mode: 'match', difficulty: 'pro' });
  renderUi({ type: 'results', stats: st, report: new Coach(g).report(st), config: { mode: 'match' }, xp: res });
  await sleep(40);
  if (!document.body.textContent.includes('Match played')) throw new Error('no xp breakdown');
  if (!document.querySelector('.xp-bar')) throw new Error('no xp bar');
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
