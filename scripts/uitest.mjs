// jsdom smoke test for UI modules (no WebGL): menus, HUD, input, coach
import { JSDOM } from '/tmp/jt/node_modules/jsdom/lib/api.js';
const dom = new JSDOM(`<!doctype html><html><body><canvas id="game"></canvas><div id="ui"></div></body></html>`, { pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w; globalThis.document = w.document; globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} };
globalThis.HTMLElement = w.HTMLElement; globalThis.performance = w.performance; globalThis.requestAnimationFrame = (fn)=>setTimeout(()=>fn(performance.now()),16);
globalThis.confirm = () => true; Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
// canvas 2d stub
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}) , set: () => true });
const { Game } = await import('../src/game.js');
const { HUD } = await import('../src/ui/hud.js');
const { Menus } = await import('../src/ui/menus.js');
const { Input } = await import('../src/input.js');
const { QuickChat } = await import('../src/chat.js');
const { Coach } = await import('../src/coach.js');
const canvas = document.getElementById('game');
const input = new Input(canvas);
const fakeApp = { audio: { ui(){}, setVolume(){}, resume(){} }, renderer: { setCameraSettings(){}, showPrediction:false }, input, game:null, startGame(cfg){ this.started = cfg; }, resume(){}, restart(){}, quitToMenu(){} };
const menus = new Menus(document.getElementById('ui'), fakeApp);
const hud = new HUD(document.getElementById('ui'));
let errors = [];
const tryit = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { errors.push(name); console.log('FAIL', name, e.stack.split('\n').slice(0,3).join(' | ')); } };
tryit('main menu', () => menus.main());
tryit('cards clickable', () => { const cards = document.querySelectorAll('.card'); if (cards.length < 6) throw new Error('cards ' + cards.length); cards[0].click(); if (!document.querySelector('h2')) throw new Error('no match setup'); });
tryit('match setup start', () => { document.querySelectorAll('button').forEach(b => { if (b.textContent === 'Start match') b.click(); }); if (!fakeApp.started || fakeApp.started.mode !== 'match') throw new Error('not started'); });
tryit('training screen', () => { menus.training(); if (document.querySelectorAll('.card').length !== 7) throw new Error('drill cards'); document.querySelectorAll('.card')[2].click(); document.querySelectorAll('button').forEach(b => { if (b.textContent === 'Start drill') b.click(); }); if (fakeApp.started.drill !== 'aerials') throw new Error('drill ' + fakeApp.started.drill); });
tryit('progress', () => menus.progress());
tryit('settings tabs', () => { menus.settingsScreen(); document.querySelectorAll('.tabs button').forEach(b => b.click()); });
tryit('howto', () => menus.howTo());
tryit('pause', () => { fakeApp.game = new Game({ mode: 'match', teamSize: 1, difficulty: 'pro', duration: 60, humanTeam: 0 }); menus.pause(); });
tryit('input update', () => { const c = input.update(); if (typeof c.throttle !== 'number') throw new Error('controls'); w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyW' })); const c2 = input.update(); if (c2.throttle !== 1) throw new Error('W not throttle: ' + c2.throttle); w.dispatchEvent(new w.KeyboardEvent('keyup', { code: 'KeyW' })); });
tryit('rebind', () => { input.rebind('boost', 'KeyB'); if (input.binds.boost[0] !== 'KeyB') throw new Error('rebind'); input.setPreset('rl'); if (input.binds.boost[0] !== 'Mouse0') throw new Error('preset'); input.setPreset('keyboard'); });
tryit('hud update + game + coach', () => {
  const g = fakeApp.game; const coach = new Coach(g);
  for (let i = 0; i < 60 * 20; i++) { g.human.controls.throttle = 1; g.human.controls.boost = i % 200 < 100; g.update(1/60); coach.update(1/60); hud.update(g, 1/60, input, { ballCam: true }); }
  hud.showMessage('GOAL!', 'blue', 2); hud.addFeed('test'); hud.showCoach('tip');
  hud.update(g, 1/60, input, { ballCam: false });
  const st = g.collectStats(); const rep = coach.report(st); if (!rep.length) throw new Error('report empty');
  menus.results(st, rep, { mode: 'match' });
});
tryit('drill hud + summary', () => { const g = new Game({ mode: 'drill', drill: 'dribbling', level: 1, humanTeam: 0, teamSize: 1, difficulty: 'champion', drillBots: false }); for (let i = 0; i < 300; i++) { g.update(1/60); hud.update(g, 1/60, input, { ballCam: true }); } g.drill.finishAttempt(false, 'x'); menus.drillSummary(g.drill, { mode: 'drill', drill: 'dribbling' }); });
tryit('kickoff drill hud', () => { const g = new Game({ mode: 'drill', drill: 'kickoffs', level: 1, humanTeam: 1, teamSize: 1, difficulty: 'champion', drillBots: true }); for (let i = 0; i < 600; i++) { g.update(1/60); hud.update(g, 1/60, input, { ballCam: true }); } });
tryit('quick chat + scoreboard + stat pops + ball arrow', () => {
  const g = new Game({ mode: 'match', teamSize: 2, difficulty: 'allstar', duration: 60, humanTeam: 0 });
  const chat = new QuickChat(g, hud);
  chat.humanSay(1); chat.humanSay(2);
  if (hud.chatItems.length < 1) throw new Error('no chat line');
  hud.addStat('SAVE', 50, true); hud.addStat('EPIC SAVE', 75, false);
  if (document.querySelectorAll('.stat-pops .pop').length !== 2) throw new Error('stat pops');
  hud.setBoard(true, g);
  if (document.querySelectorAll('.board tr').length < 5) throw new Error('board rows');
  hud.setBoard(false, g);
  if (!hud.board.classList.contains('hidden')) throw new Error('board hide');
  for (let i = 0; i < 120; i++) { g.update(1/60); hud.update(g, 1/60, input, { ballCam: false, mode: 'play', ballScreen: { x: 1.4, y: 0.2, onScreen: false, behind: false, dist: 3000 } }); }
  if (hud.ballArrow.classList.contains('hidden')) throw new Error('ball arrow hidden');
  hud.update(g, 1/60, input, { ballCam: false, mode: 'play', ballScreen: { x: 0, y: 0, onScreen: true, behind: false, dist: 300 } });
  if (!hud.ballArrow.classList.contains('hidden')) throw new Error('ball arrow shown on-screen');
  // emit events so bots react
  g.emit('goal', { team: 1, scorer: g.bots[0].car, ownGoal: false, speed: 2500 });
  g.emit('save', { car: g.human, epic: true });
});
console.log(errors.length ? `FAILED: ${errors.join(', ')}` : 'ALL UI TESTS PASSED');
process.exit(errors.length ? 1 : 0);
