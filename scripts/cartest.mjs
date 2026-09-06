// Car catalogue checks: hitbox presets, per-car physics differences, cosmetics
// in the mesh builder, and ball mutator plumbing.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><canvas id="game"></canvas></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.requestAnimationFrame = () => 0;
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy(
    { measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true }
  );
};

const { CARS, HITBOXES, hitboxOf, resolveSpec, botSpec, defaultSpec, FINISHES, WHEELS, BOOST_TRAILS, GOAL_EXPLOSIONS } = await import('../src/cars.js');
const { Car } = await import('../src/physics/car.js');
const { Ball } = await import('../src/physics/ball.js');
const { collideCarBall } = await import('../src/physics/collision.js');
const { buildCarMesh } = await import('../src/render/carMesh.js');
const { defaultMutators, resolve, describe } = await import('../src/mutators.js');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

// ---- hitbox table ---------------------------------------------------------
ok('octane hitbox is 118 long / 84.2 wide / 36.16 tall', Math.abs(hitboxOf('octane').half.z - 59.005) < 0.01 && Math.abs(hitboxOf('octane').half.x - 42.1) < 0.01 && Math.abs(hitboxOf('octane').half.y - 18.08) < 0.01);
ok('plank is the flattest hitbox', hitboxOf('plank').half.y < hitboxOf('breakout').half.y && hitboxOf('breakout').half.y < hitboxOf('octane').half.y);
ok('merc is the tallest hitbox', hitboxOf('merc').half.y > hitboxOf('octane').half.y && hitboxOf('merc').half.x > hitboxOf('octane').half.x);
ok('every car maps to a known hitbox class', CARS.every((c) => HITBOXES[c.hitbox]));

// ---- cars carry their hitbox into physics ---------------------------------
const merc = new Car(0, 'MercTest', false, { car: 'merc' });
const bat = new Car(1, 'BatTest', true, { car: 'batmobile' });
ok('car adopts its preset hitbox', Math.abs(merc.hitbox.half.y - HITBOXES.merc.height / 2) < 0.01 && Math.abs(bat.hitbox.half.y - HITBOXES.plank.height / 2) < 0.01);

// a ball resting on the roof sits at the hitbox roof height — Merc much higher
function roofHeight(car) {
  const ball = new Ball();
  car.setPose(0, 0, 0, 0);
  ball.pos.set(car.hitbox.offset.x, car.hitbox.offset.y + car.hitbox.half.y + ball.radius + 2, car.hitbox.offset.z);
  for (let i = 0; i < 90; i++) {
    collideCarBall(car, ball, i / 120);
    ball.step(1 / 120);
  }
  return ball.pos.y;
}
const mercRoof = roofHeight(merc);
const batRoof = roofHeight(bat);
ok('ball rests higher on a Merc than on a Batmobile', mercRoof > batRoof + 10, `merc ${mercRoof.toFixed(1)} vs bat ${batRoof.toFixed(1)}`);

// ---- cosmetics ------------------------------------------------------------
const spec = resolveSpec({ car: 'fennec', primary: 0xff0000, secondary: 0x00ff00, finish: 'metalflake', wheels: 'dish', trail: 'green', explosion: 'confetti' });
ok('spec resolves cosmetics', spec.preset.id === 'fennec' && spec.finish.id === 'metalflake' && spec.wheels.id === 'dish' && spec.trail.id === 'green' && spec.explosion.id === 'confetti');
ok('unknown ids fall back to defaults', resolveSpec({ car: 'nope', finish: 'nope' }).preset.id === 'octane' && resolveSpec({ car: 'nope', finish: 'nope' }).finish.id === 'glossy');
ok('botSpec gives every bot a valid loadout', CARS.every((c, i) => resolveSpec(botSpec(i % 2, i)).preset.id));
ok('defaultSpec tints the car with the team colour', defaultSpec(0).primary === 0x2a6cff && defaultSpec(1).primary === 0xff8a1f);
ok('bots keep a team-readable paint', botSpec(0, 0).primary === 0x152a55 && botSpec(1, 0).primary === 0xff6b1a);

// ---- mesh builds for every car x cosmetic combo ---------------------------
let meshFail = null;
for (const c of CARS) {
  for (const f of FINISHES) {
    for (const w of WHEELS) {
      try {
        const m = buildCarMesh({ car: c.id, finish: f.id, wheels: w.id, trail: BOOST_TRAILS[0].id }, false, 0x2a6cff);
        let nan = 0;
        m.group.traverse((o) => {
          if (o.geometry && o.geometry.attributes.position) {
            const a = o.geometry.attributes.position.array;
            for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) nan++;
          }
        });
        if (nan) meshFail = `${c.id}/${f.id}/${w.id} NaN verts`;
      } catch (e) {
        meshFail = `${c.id}/${f.id}/${w.id} ${e.message}`;
      }
    }
  }
}
ok('meshes build for all cars x finishes x wheels', !meshFail, meshFail || `${CARS.length * FINISHES.length * WHEELS.length} combos`);

const painted = buildCarMesh({ car: 'dominus', primary: 0xff0000, finish: 'matte', wheels: 'neon', trail: 'blue' }, true, 0xff8a1f);
ok('paint colour reaches the body material', painted.paintMat.color.getHex() === 0xff0000 && painted.paintMat.metalness === FINISHES.find((f) => f.id === 'matte').metalness);
ok('boost trail colour reaches the flame', painted.flame.material.color.getHex() === BOOST_TRAILS.find((t) => t.id === 'blue').color);
ok('all goal explosions exist for the results cosmetic', GOAL_EXPLOSIONS.length >= 5);

// ---- ball mutators --------------------------------------------------------
const big = new Ball({ radius: 185.5, mass: 60, restitution: 1.2 });
ok('ball takes mutator config', big.radius === 185.5 && big.mass === 60 && big.restitution === 1.2);
big.pos.set(0, 4000, 0);
big.vel.set(0, 0, 0);
for (let i = 0; i < 120; i++) big.step(1 / 120);
ok('big ball settles on its own radius', Math.abs(big.pos.y - 185.5) < 30, `y=${big.pos.y.toFixed(1)}`);
ok('prediction uses the same config', new Ball({ radius: 185.5 }).predict(0.1)[1].pos.y < 185.5 + 1);

// ---- mutator resolution ---------------------------------------------------
const def = resolve(defaultMutators());
ok('standard rules: 5 min, normal boost, no rumble', def.duration === 300 && def.boost.mode === 'normal' && !def.boost.unlimited && def.rumble === 'none' && def.respawnTime === 3);
const rum = resolve({ rumble: 'normal' });
ok('rumble unlocks unlimited boost', rum.boost.unlimited && rum.rumbleCooldown === 10);
const turbo = resolve({ rumble: 'turbo' });
ok('turbo rumble recharges faster', turbo.rumbleCooldown === 6);
const puck = resolve({ ballType: 'puck' });
ok('puck is heavier and dead-bouncy', puck.ball.puck && puck.ball.restitution < def.ball.restitution && puck.ball.mass > def.ball.mass);
const chaos = resolve({ ballSize: 2, ballBounciness: 2.2, boost: 'rapid', respawn: 0, demo: 'instant' });
ok('chaos mutators resolve', chaos.ball.radius === 185.5 && chaos.ball.restitution > 1 && chaos.boost.recharge === 25 && chaos.respawnTime === 0);
const noDemo = resolve({ demo: 'disabled' });
ok('demos can be disabled', noDemo.demoMode === 'disabled');
const none = resolve({ boost: 'none' });
ok('no-boost mutator', none.boost.none && !none.boost.unlimited);
ok('describe() lists only non-default mutators', describe({}).length === 0 && describe({ ballSize: 2 }).length === 1 && describe({ rumble: 'normal' })[0].startsWith('Rumble'));

console.log(failed ? `${failed} CAR/MUTATOR CHECKS FAILED` : 'ALL CAR + MUTATOR CHECKS PASSED');
process.exit(failed ? 1 : 0);
