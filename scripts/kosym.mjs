globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { addEventListener() {} };
const { Game } = await import('../src/game.js');
const { SKILLS, Bot } = await import('../src/bot/bot.js');
const diff = process.argv[2] || 'allstar';
for (let trial = 0; trial < 6; trial++) {
  const g = new Game({ mode: 'match', teamSize: 1, difficulty: diff, duration: 300, humanTeam: 0 });
  const hb = new Bot(g.human, g, SKILLS[diff]); g.bots.push(hb); hb.onKickoff();
  let first = null;
  g.on('touch', (e) => { if (!first) first = { car: e.car.name, t: g.time }; });
  const spawn = g.cars.map(c => `${c.name}(${c.pos.x.toFixed(0)},${c.pos.z.toFixed(0)})`).join(' ');
  while (g.time < 6.5) g.update(1/60);
  const b = g.ball;
  console.log(`trial ${trial}: ${spawn} first=${first?.car}@${first?.t.toFixed(2)} ball after=(${b.pos.x.toFixed(0)},${b.pos.y.toFixed(0)},${b.pos.z.toFixed(0)}) v=(${b.vel.x.toFixed(0)},${b.vel.z.toFixed(0)})`);
}
