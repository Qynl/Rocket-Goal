// Training checks: do the drills actually feed what they promise?
//
// A drill is easy to get subtly wrong — a lob that never reaches the height the
// feedback quotes, a landing marker on the wrong side of the pitch, an aerial
// feed that never fires, a "ground hit" message for a contact 400 uu up in the
// air. These checks run the real feeds through the real ball physics and grade
// the real success paths, without needing anyone to play them.
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.window = { addEventListener() {} };

const { Game } = await import('../src/game.js');
const { DRILLS, createDrill } = await import('../src/training.js');
const { ARENA, BALL } = await import('../src/constants.js');

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

const drillGame = (id, level, opts = {}) =>
  new Game({ mode: 'drill', drill: id, level, humanTeam: opts.team ?? 0, teamSize: 1, difficulty: 'champion', drillBots: opts.bots ?? false, ...opts.extra });

/** Fly the ball on its own and report the arc: apex, where and when it comes down. */
function traceBall(ball, seconds = 10) {
  const start = ball.pos.clone();
  let apex = ball.pos.y;
  let apexAt = 0;
  let land = null;
  let t = 0;
  const dt = 1 / 120;
  for (let i = 0; i < seconds / dt; i++) {
    ball.step(dt);
    t += dt;
    if (ball.pos.y > apex) {
      apex = ball.pos.y;
      apexAt = t;
    }
    if (!land && t > 0.15 && ball.pos.y <= ball.radius + 6) land = { pos: ball.pos.clone(), t };
    if (land && t > land.t + 0.05) break;
    if (!Number.isFinite(ball.pos.x + ball.pos.y + ball.pos.z)) return { nan: true, start, apex, land };
  }
  // `horizon` means the ball was still in the air when the trace ran out: at the
  // top levels a few drops ricochet off the rounded surround beside the goal
  // mouth and take a second bounce before they settle.
  return { start, apex, apexAt, land: land || { pos: ball.pos.clone(), t, horizon: true }, nan: false };
}

const s2 = (id, d) => (id === 'aerialsaves' ? -d.humanSign : d.humanSign);

/** Feed `n` attempts at a level and collect what each ball actually did. */
function sampleFeeds(id, level, n = 24, team = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = drillGame(id, level, { team });
    g.drill.level = level;
    g.drill.nextAttempt();
    const trace = traceBall(g.ball);
    out.push({ g, trace, drill: g.drill, sign: g.drill.humanSign });
    if (trace.nan) return out;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. registration
// ---------------------------------------------------------------------------
{
  const ids = DRILLS.map((d) => d.id);
  ok('air shots and aerial saves are in the training list', ids.includes('airshots') && ids.includes('aerialsaves'), ids.join(', '));
  for (const d of DRILLS) {
    const complete = d.id && d.name && d.icon && d.desc && d.tip && typeof d.hasBots === 'boolean';
    if (!complete) ok(`drill "${d.id}" has full metadata`, false, JSON.stringify(d));
    const g = drillGame(d.id, 1);
    if (!g.drill || g.drill.id !== d.id) ok(`createDrill("${d.id}") builds the right drill`, false, `got ${g.drill && g.drill.id}`);
  }
  ok('every listed drill builds and reports its own id', DRILLS.every((d) => drillGame(d.id, 1).drill.id === d.id));
  ok('air shots wants a goalie bot, aerial saves does not', DRILLS.find((d) => d.id === 'airshots').hasBots === true && DRILLS.find((d) => d.id === 'aerialsaves').hasBots === false);
}

// ---------------------------------------------------------------------------
// 2. air shots: the feed really is an aerial ball in the shooting lane
// ---------------------------------------------------------------------------
for (const team of [0, 1]) {
  for (const level of [1, 3, 5]) {
    const feeds = sampleFeeds('airshots', level, 20, team);
    const s = team === 0 ? 1 : -1; // blue attacks +z
    const nan = feeds.filter((f) => f.trace.nan).length;
    const apexes = feeds.map((f) => f.trace.apex);
    const minApex = Math.min(...apexes);
    const maxApex = Math.max(...apexes);
    // every feed must be meetable in the air: well above a car's roof
    ok(`airshots L${level} t${team}: every feed peaks at aerial height`, minApex > 380, `apex ${minApex.toFixed(0)}–${maxApex.toFixed(0)} uu`);
    ok(`airshots L${level} t${team}: higher levels peak higher`, level === 1 || minApex > 420, `min apex ${minApex.toFixed(0)}`);
    // the ball has to come down in the attacking half, not behind the player
    const ahead = feeds.filter((f) => f.trace.land.pos.z * s > f.drill.human.pos.z * s).length;
    ok(`airshots L${level} t${team}: the ball lands ahead of the player, toward their goal`, ahead >= feeds.length * 0.8, `${ahead}/${feeds.length} feeds land ahead`);
    const inArena = feeds.every((f) => Math.abs(f.trace.land.pos.x) < ARENA.HALF_WIDTH + 400 && Math.abs(f.trace.land.pos.z) < ARENA.HALF_LENGTH + ARENA.GOAL_DEPTH + 400);
    ok(`airshots L${level} t${team}: feeds stay inside the arena`, inArena && nan === 0, nan ? `${nan} NaN feeds` : '');
    // enough hang time to actually fly to it
    const hang = feeds.map((f) => f.trace.land.t);
    ok(`airshots L${level} t${level}: enough hang time to reach it`, Math.min(...hang) > 1.4, `${Math.min(...hang).toFixed(2)}–${Math.max(...hang).toFixed(2)}s airborne`);
    // the quoted height bar must be below what the feed actually offers
    ok(`airshots L${level} t${team}: the height bar is reachable`, feeds.every((f) => f.drill.minHeight < f.trace.apex), `bar ${feeds[0].drill.minHeight} vs apex ${minApex.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------------------
// 3. aerial saves: high balls dropping into your own box
// ---------------------------------------------------------------------------
for (const team of [0, 1]) {
  for (const level of [1, 3, 5]) {
    const feeds = sampleFeeds('aerialsaves', level, 20, team);
    const s = team === 0 ? 1 : -1;
    const apexes = feeds.map((f) => f.trace.apex);
    ok(`aerialsaves L${level} t${team}: the drop is high enough to need a jump`, Math.min(...apexes) > 450, `apex ${Math.min(...apexes).toFixed(0)}–${Math.max(...apexes).toFixed(0)} uu`);
    // it must come down in (or just in front of) the player's own goal box
    const ownGoalZ = -s * ARENA.HALF_LENGTH;
    const inBox = feeds.filter((f) => {
      const z = f.trace.land.pos.z;
      const depth = (ownGoalZ - z) * -s; // how far past the line, +ve = inside the goal
      return depth > -1800 && Math.abs(f.trace.land.pos.x) < ARENA.HALF_WIDTH;
    }).length;
    ok(`aerialsaves L${level} t${team}: the ball drops into the keeper's box`, inBox >= feeds.length * 0.85, `${inBox}/${feeds.length} land in the box`);
    // and it must actually threaten the goal. Level 1 deliberately drops short of
    // the line so there is time to read it; by level 5 it lands inside the goal.
    const margin = level >= 5 ? 700 : level >= 3 ? 1400 : 2000;
    const share = level >= 3 ? 0.7 : 0.6;
    const threatening = feeds.filter((f) => f.trace.land.pos.z * s < -(ARENA.HALF_LENGTH - margin)).length;
    ok(`aerialsaves L${level} t${team}: an untouched ball is a real chance against you`, threatening >= feeds.length * share, `${threatening}/${feeds.length} land within ${margin} uu of the line`);
    ok(`aerialsaves L${level} t${team}: no NaN in any feed`, feeds.every((f) => !f.trace.nan));
    // the drop the keeper has to read: the lob's own flight time, not how long
    // the ball happens to keep bouncing around the box afterwards
    const fts = feeds.map((f) => f.drill.flightTime);
    ok(`aerialsaves L${level} t${team}: the drop is readable — long enough to react, short enough to matter`, fts.every((t) => t > 1.5 && t < 5), `${Math.min(...fts).toFixed(2)}–${Math.max(...fts).toFixed(2)}s`);
    const lts = feeds.map((f) => f.trace.land.t);
    const unsettled = feeds.filter((f) => f.trace.land.horizon).length;
    ok(`aerialsaves L${level} t${team}: every ball comes back down (a few off the goal-mouth surround)`, unsettled === 0 && Math.max(...lts) < 10, `first contact ${Math.min(...lts).toFixed(2)}–${Math.max(...lts).toFixed(2)}s, ${unsettled}/${feeds.length} still airborne at the trace limit`);
    ok(`aerialsaves L${level} t${team}: the height bar is reachable`, feeds.every((f) => f.drill.minHeight < f.trace.apex), `bar ${feeds[0].drill.minHeight} vs apex ${Math.min(...apexes).toFixed(0)}`);
  }
}

// ---------------------------------------------------------------------------
// 4. the landing marker: on the floor, on the right side, and it tracks the ball
// ---------------------------------------------------------------------------
for (const id of ['airshots', 'aerialsaves', 'aerials']) {
  const g = drillGame(id, 3, { team: 0 });
  const d = g.drill;
  d.level = 3;
  d.nextAttempt();
  for (let i = 0; i < 24; i++) g.update(1 / 60);
  const landing = d.rings.find((r) => r.landing);
  const contact = d.rings.find((r) => r.contact);
  ok(`${id}: draws a landing marker`, !!landing, `${d.rings.length} rings`);
  ok(`${id}: the landing marker lies flat on the floor`, !!landing && landing.y === 0 && landing.r > 100, landing && `y=${landing.y} r=${landing.r}`);
  ok(`${id}: draws the aerial contact ring`, !!contact && contact.y > 200, contact && `y=${contact.y.toFixed(0)}`);
  // the ground ring must sit where the ball is actually heading
  const pred = g.ball.predict(3.5, 1 / 20);
  const due = pred.find((p) => p.pos.y <= BALL.RADIUS + 30) || pred[pred.length - 1];
  ok(`${id}: the marker sits at the ball's predicted landing spot`, !!landing && Math.hypot(landing.x - due.pos.x, landing.z - due.pos.z) < 400, landing && `marker ${landing.x.toFixed(0)},${landing.z.toFixed(0)} vs predicted ${due.pos.x.toFixed(0)},${due.pos.z.toFixed(0)}`);
  // A ballistic arc barely changes its landing spot, so "did it move" proves
  // nothing. Kick the ball sideways instead: a live marker has to follow, a
  // stale one stays where the feed started.
  const before = { x: landing.x, z: landing.z };
  const carZ0 = d.human.pos.z;
  g.ball.vel.x += 1800;
  g.ball.vel.z += s2(id, d) * 600;
  // keep it in the air while we compare: once a ball has touched down (or
  // ricocheted off the goal-mouth surround) "where will it land" stops having a
  // single answer, and the marker is refreshed on a 4-frame throttle anyway
  g.ball.vel.y = Math.max(g.ball.vel.y, 1100);
  g.predictionDirty = true;
  for (let i = 0; i < 20; i++) g.update(1 / 60);
  const after = d.rings.find((r) => r.landing);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  ok(`${id}: the marker follows the ball when its flight changes`, moved > 300, `moved ${moved.toFixed(0)} uu after a sideways kick`);
  // same horizon and step the drill itself uses, so any gap is real staleness.
  // Allow for the throttle: up to 4 frames (66 ms) of a ~2500 uu/s ball is ~170 uu.
  const due2 = g.ball.predict(3.5, 1 / 20);
  const land2 = due2.find((p) => p.pos.y <= BALL.RADIUS + 30) || due2[due2.length - 1];
  const off2 = Math.hypot(after.x - land2.pos.x, after.z - land2.pos.z);
  const slack = 250 + g.ball.vel.length() * 0.08;
  ok(`${id}: and stays accurate after the change`, off2 < slack, `marker ${after.x.toFixed(0)},${after.z.toFixed(0)} vs ${land2.pos.x.toFixed(0)},${land2.pos.z.toFixed(0)} — ${off2.toFixed(0)} uu off, ${slack.toFixed(0)} allowed`);
  // Side of the pitch: air shots attack, aerial saves defend. Judged on the feed
  // as it was dealt — `landing` and `after` are the *same* ring object, updated
  // in place, so reading `landing` here would judge the ball we just kicked.
  const s = d.humanSign;
  if (id === 'aerialsaves') {
    ok(`${id}: the marker is deep in your own half`, before.z * s < -(ARENA.HALF_LENGTH - 2400), `marker z ${before.z.toFixed(0)}, own goal at ${(-s * ARENA.HALF_LENGTH).toFixed(0)}`);
  } else {
    // air shots and open-field aerials are both played going forward
    ok(`${id}: the marker is ahead of the player`, before.z * s > carZ0 * s - 200, `marker z ${before.z.toFixed(0)}, car z ${carZ0.toFixed(0)}, attacking ${s > 0 ? '+z' : '-z'}`);
  }
  // rings must be cleared between attempts, or stale markers pile up
  const countBefore = d.rings.length;
  d.nextAttempt();
  for (let i = 0; i < 12; i++) g.update(1 / 60);
  ok(`${id}: markers do not pile up across attempts`, d.rings.length <= Math.max(countBefore, 2), `${countBefore} -> ${d.rings.length}`);
}

// ---------------------------------------------------------------------------
// 5. aerial feeds inside the Shooting and Goalkeeping drills
// ---------------------------------------------------------------------------
for (const id of ['shooting', 'saves']) {
  for (const level of [1, 2, 3, 5]) {
    let aerials = 0;
    let apexes = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      const g = drillGame(id, level);
      g.drill.level = level;
      g.drill.nextAttempt();
      if (g.drill.aerialFeed) {
        aerials++;
        apexes.push(traceBall(g.ball).apex);
      }
    }
    if (level < 3) {
      ok(`${id} L${level}: no aerial feeds before level 3 (progression)`, aerials === 0, `${aerials}/${N}`);
    } else {
      ok(`${id} L${level}: aerial balls are actually fed`, aerials >= N * 0.15, `${aerials}/${N} attempts were aerials`);
      ok(`${id} L${level}: those feeds peak at aerial height`, Math.min(...apexes) > 400, `apex ${Math.min(...apexes).toFixed(0)}–${Math.max(...apexes).toFixed(0)} uu`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. grading: an aerial contact must not be called a ground hit
// ---------------------------------------------------------------------------
{
  const g = drillGame('airshots', 3, { bots: true });
  const d = g.drill;
  d.level = 3;
  const results = [];
  g.on('drillResult', (e) => results.push(e));
  const s = d.humanSign;

  const attempt = (contactHeight, ballSpeed, towardGoal) => {
    results.length = 0;
    d.nextAttempt();
    g.ball.pos.set(d.human.pos.x, contactHeight, d.human.pos.z + s * 400);
    g.ball.vel.set(0, -100, towardGoal ? s * ballSpeed : -s * ballSpeed);
    d.onTouch(d.human);
    d.updateAttempt(1 / 60);
    return results[0] || { ok: null, feedback: '(no result)' };
  };

  const bar = d.minHeight;
  const clean = attempt(bar + 150, 1600, true);
  ok('a clean air shot on target succeeds', clean.ok === true, clean.feedback);
  const low = attempt(bar - 60, 1600, true);
  ok('a contact just under the bar is not called a ground hit', low.ok === false && !/ground hit/i.test(low.feedback), low.feedback);
  ok('...and it says how far under it was', /uu/.test(low.feedback) && /just under/i.test(low.feedback));
  const ground = attempt(120, 900, true);
  ok('a genuinely low contact is called a ground hit', ground.ok === false && /ground hit/i.test(ground.feedback), ground.feedback);
  const highNoDirection = attempt(bar + 200, 400, false);
  ok('height without direction is coached, not passed', highNoDirection.ok === false && /direction/i.test(highNoDirection.feedback), highNoDirection.feedback);
  const goal = (() => {
    results.length = 0;
    d.nextAttempt();
    g.ball.pos.set(0, 200, s * (ARENA.HALF_LENGTH + BALL.RADIUS + 40));
    g.ball.vel.set(0, 0, s * 500);
    d.contactHeight = bar + 120;
    d.touched = true;
    d.updateAttempt(1 / 60);
    return results[0] || { ok: null, feedback: '(no result)' };
  })();
  ok('putting an aerial ball in the goal is the best outcome', goal.ok === true && /air shot/i.test(goal.feedback), goal.feedback);
}

{
  const g = drillGame('aerialsaves', 4);
  const d = g.drill;
  d.level = 4;
  const results = [];
  g.on('drillResult', (e) => results.push(e));
  const s = d.humanSign;

  // a high clear that goes wide is a save
  results.length = 0;
  d.nextAttempt();
  g.ball.pos.set(2000, d.minHeight + 200, -s * (ARENA.HALF_LENGTH - 2600));
  g.ball.vel.set(900, 200, s * 900); // away from our goal, wide
  d.onTouch(d.human);
  d.updateAttempt(1 / 60);
  ok('a wide aerial clear counts as a save', results[0] && results[0].ok === true, results[0] && results[0].feedback);

  // at level 4+ a low punch is not an aerial save
  results.length = 0;
  d.nextAttempt();
  g.ball.pos.set(1500, 150, -s * (ARENA.HALF_LENGTH - 2600));
  g.ball.vel.set(900, 100, s * 900);
  d.onTouch(d.human);
  d.updateAttempt(1 / 60);
  ok('level 4+ rejects a ground punch as an aerial save', results[0] && results[0].ok === false && /in the air/i.test(results[0].feedback), results[0] && results[0].feedback);

  // conceding is a failure even after a touch
  results.length = 0;
  d.nextAttempt();
  g.ball.pos.set(0, 120, -s * (ARENA.HALF_LENGTH + BALL.RADIUS + 30));
  g.ball.vel.set(0, 0, -s * 100);
  d.touched = true;
  d.contactHeight = 400;
  d._ft = 0;
  d.updateAttempt(1 / 60);
  ok('letting it drop in is a failure', results[0] && results[0].ok === false, results[0] && results[0].feedback);
}

// ---------------------------------------------------------------------------
// 7. long runs: no stuck attempts, no NaN, attempts keep coming
// ---------------------------------------------------------------------------
for (const id of ['airshots', 'aerialsaves', 'shooting', 'saves', 'aerials']) {
  for (const level of [1, 5]) {
    const g = drillGame(id, level, { bots: DRILLS.find((d) => d.id === id).hasBots });
    g.drill.level = level;
    let err = null;
    let nan = false;
    try {
      for (let i = 0; i < 60 * 75; i++) {
        g.human.controls.throttle = 1;
        g.human.controls.boost = g.human.boost > 20;
        g.human.controls.jump = i % 90 < 12;
        g.update(1 / 60);
        if (!Number.isFinite(g.ball.pos.x + g.ball.pos.y + g.ball.pos.z + g.human.pos.x + g.human.pos.y)) nan = true;
      }
    } catch (e) {
      err = e;
    }
    const d = g.drill;
    ok(`${id} L${level}: 75 s of play stays clean`, !err && !nan, err ? err.message : nan ? 'NaN in ball/car state' : `${d.attempts} attempts, ${d.successes} ok, level ${d.level}`);
    ok(`${id} L${level}: attempts keep being dealt`, d.attempts >= 4, `${d.attempts} attempts in 75 s`);
    ok(`${id} L${level}: hud lines render`, d.hudLines().length >= 3 && d.hudLines().every((l) => typeof l === 'string' && l.length), d.hudLines().join(' / '));
  }
}

console.log(failed ? `\n${failed} TRAINING CHECKS FAILED` : '\nALL TRAINING CHECKS PASSED');
process.exit(failed ? 1 : 0);
