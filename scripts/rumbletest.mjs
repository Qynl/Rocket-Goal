// Rumble power-ups: every item is fired and its physical effect is measured.
import { Game } from '../src/game.js';
import { ITEMS, ITEM_IDS } from '../src/rumble.js';

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const mk = (opts = {}) => new Game({ mode: 'match', teamSize: 1, difficulty: 'allstar', duration: 300, humanTeam: 0, mutators: { rumble: 'normal', ...opts }, replays: false });

// ---- setup ----------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  g.ball.frozen = false;
  ok('rumble mode is on and boost is unlimited', !!g.rumble && g.unlimitedBoost);
  ok('every car is holding an item', g.cars.every((c) => c.item && ITEMS[c.item.id]));
  ok('items start on a short cooldown', g.cars.every((c) => c.item.cooldown < g.rumble.cooldown));
  const h = g.human;
  h.item.cooldown = 0;
  g.useItem(h);
  ok('using an item starts the recharge', h.item.cooldown > 0, `cooldown ${h.item.cooldown.toFixed(1)}s`);
  const before = h.item.id;
  ok('the item cannot be fired again while recharging', g.useItem(h) === null && h.item.id === before);
  ok('rumble is off in standard rules', !new Game({ mode: 'match', teamSize: 1, difficulty: 'rookie' }).rumble);
}

// ---- boost ----------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  h.boost = 12;
  h.item = { id: 'boost', cooldown: 0, timer: 0 };
  g.useItem(h);
  ok('boost item fills the tank', h.boost === 100);
}

// ---- boot -----------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  h.setPose(0, 0, 0, 100); // x, z, yaw, boost
  g.ball.pos.set(0, 100, 700);
  g.ball.vel.set(0, 0, 0);
  h.item = { id: 'boot', cooldown: 0, timer: 0 };
  g.useItem(h);
  const v = g.ball.vel.clone();
  ok('boot kicks the ball away from the car', v.z > 2000 && v.y > 500, `v=${v.toArray().map((n) => n.toFixed(0)).join(',')}`);
  // whiffing far from the ball hands the item back
  const g2 = mk();
  g2.state = 'play';
  g2.human.setPose(0, 0, 0, 100);
  g2.ball.pos.set(0, 100, 4000);
  g2.human.item = { id: 'boot', cooldown: 0, timer: 0 };
  g2.useItem(g2.human);
  ok('a boot that hits nothing refunds the item', g2.human.item.cooldown <= 1);
}

// ---- tornado --------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  const foe = g.cars.find((c) => c.team !== h.team);
  h.setPose(0, 0, 0, 100);
  foe.setPose(600, 900, 0, 100);
  foe.vel.set(0, 0, 0);
  h.item = { id: 'tornado', cooldown: 0, timer: 0 };
  g.useItem(h);
  ok('tornado launches nearby opponents', foe.vel.y > 1000 && foe.vel.length() > 1500, `foe v=${foe.vel.toArray().map((n) => n.toFixed(0)).join(',')}`);
  ok('tornado leaves far-away cars alone', (() => {
    const far = new Game({ mode: 'match', teamSize: 3, difficulty: 'rookie', mutators: { rumble: 'normal' } });
    far.state = 'play';
    const me = far.human;
    me.setPose(0, 0, 0, 100);
    for (const c of far.cars) if (c !== me) c.pos.set(0, 17, 6000);
    me.item = { id: 'tornado', cooldown: 0, timer: 0 };
    far.useItem(me);
    return far.cars.filter((c) => c !== me).every((c) => c.vel.y < 100);
  })());
}

// ---- swapper --------------------------------------------------------------
{
  const g = mk({ teamSize: 2 });
  g.state = 'play';
  const h = g.human;
  const foe = g.cars.find((c) => c.team !== h.team);
  h.setPose(-1000, -3000, 0, 100);
  foe.setPose(1200, 2500, 0, 100);
  const hp = h.pos.clone();
  const fp = foe.pos.clone();
  h.item = { id: 'swapper', cooldown: 0, timer: 0 };
  g.useItem(h);
  ok('swapper trades positions with the closest opponent', h.pos.distanceTo(fp) < 1 && foe.pos.distanceTo(hp) < 1);
}

// ---- grapple --------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  h.setPose(0, -1000, 0, 100);
  g.ball.pos.set(0, 600, 600);
  g.ball.vel.set(0, 0, 0);
  const start = h.pos.distanceTo(g.ball.pos);
  h.item = { id: 'grapple', cooldown: 0, timer: 0 };
  g.useItem(h);
  for (let i = 0; i < 60; i++) g.update(1 / 120);
  const end = h.pos.distanceTo(g.ball.pos);
  ok('grapple pulls the car toward the ball', end < start * 0.7, `${start.toFixed(0)} -> ${end.toFixed(0)}`);
}

// ---- spike ----------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  h.setPose(0, 0, 0, 100);
  g.ball.pos.set(0, 200, 300);
  g.ball.vel.set(0, 0, 0);
  h.item = { id: 'spike', cooldown: 0, timer: 0 };
  g.useItem(h);
  for (let i = 0; i < 40; i++) g.update(1 / 120);
  const roof = h.getHitboxCenter().y + h.hitbox.half.y + g.ball.radius;
  ok('spike parks the ball on the roof', Math.abs(g.ball.pos.y - roof) < 40 && g.ball.pos.distanceTo(h.pos) < 200, `ball ${g.ball.pos.y.toFixed(0)} roof ${roof.toFixed(0)}`);
  ok('spike keeps the ball glued while driving', (() => {
    h.controls.throttle = 1;
    for (let i = 0; i < 60; i++) g.update(1 / 120);
    return g.ball.pos.distanceTo(h.pos) < 220;
  })());
  // jumping releases it
  const rel = g.ball.pos.clone();
  h.controls.jump = true;
  for (let i = 0; i < 10; i++) g.update(1 / 120);
  ok('jumping drops the spiked ball', h.item.timer <= 0);
  void rel;
}

// ---- haymaker -------------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  const foe = g.cars.find((c) => c.team !== h.team);
  h.setPose(0, -200, 0, 100);
  foe.setPose(0, 200, 0, 100);
  h.vel.set(0, 0, 1500);
  foe.vel.set(0, 0, 100);
  h.item = { id: 'haymaker', cooldown: 0, timer: 0 };
  g.useItem(h);
  ok('haymaker arms a demolition window', h.item.timer > 0);
  let demoed = null;
  g.on('demo', (e) => (demoed = e));
  for (let i = 0; i < 30 && !demoed; i++) g.update(1 / 120);
  ok('haymaker demolishes at walking speed (no supersonic needed)', demoed && demoed.victim === foe, demoed ? `${demoed.demolisher.name} -> ${demoed.victim.name}` : 'no demo');
  ok('haymaker is consumed by the hit', h.item.timer <= 0);
}

// ---- power shot -----------------------------------------------------------
{
  const g = mk();
  g.state = 'play';
  const h = g.human;
  h.setPose(0, -900, 0, 100);
  g.ball.pos.set(0, 100, 200);
  g.ball.vel.set(0, 0, 0);
  h.item = { id: 'powershot', cooldown: 0, timer: 0 };
  g.useItem(h);
  let hit = false;
  g.on('rumbleHit', () => (hit = true));
  h.controls.throttle = 1;
  h.controls.boost = true;
  for (let i = 0; i < 180 && !hit; i++) g.update(1 / 120);
  ok('power shot fires on the next ball touch', hit);
  ok('power shot sends the ball far above normal hit speed', g.ball.vel.length() > 2500, `${g.ball.vel.length().toFixed(0)} uu/s`);
}

// ---- a full rumble match --------------------------------------------------
{
  const g = new Game({ mode: 'match', teamSize: 2, difficulty: 'champion', duration: 90, humanTeam: 0, mutators: { rumble: 'normal' }, replays: false });
  let uses = 0;
  let err = null;
  const seen = new Set();
  g.on('rumbleUse', (e) => {
    uses++;
    seen.add(e.id);
  });
  try {
    for (let i = 0; i < 90 * 60 && g.state !== 'ended'; i++) {
      if (g.human) {
        g.human.controls.throttle = 1;
        if (g.human.item && g.human.item.cooldown <= 0 && i % 90 === 0) g.useItem(g.human);
      }
      g.update(1 / 60);
    }
  } catch (e) {
    err = e;
  }
  ok('a full rumble match simulates without errors', !err, err ? err.message : `${g.state} score ${g.score.join('-')}`);
  ok('bots fire their power-ups', uses > 10, `${uses} uses of ${seen.size} different items: ${[...seen].join(', ')}`);
  ok('boost stays unlimited through the match', g.cars.every((c) => c.boost > 50 || c.demolished));
}

console.log(failed ? `${failed} RUMBLE CHECKS FAILED` : 'ALL RUMBLE CHECKS PASSED');
process.exit(failed ? 1 : 0);
