globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const g = new Game({ mode: 'match', teamSize: 2, difficulty: 'champion', duration: 300, humanTeam: 0 });
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const hb = new Bot(g.human, g, SKILLS.champion); g.bots.push(hb); hb.onKickoff();
const counts = {};
g.on('stat', (e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
while (g.time < 240) g.update(1/60);
console.log('score', g.score.join('-'), 'events', JSON.stringify(counts));
console.log(g.cars.map(c => `${c.name}:${c.stats.score}`).join(' '));
// scoreboard via hud stub
