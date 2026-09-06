import * as THREE from 'three';
import { ARENA, BALL, TEAM, CAR } from './constants.js';
import { rand, randSign, clamp } from './math.js';

const STORAGE = 'rocketgoal.training.v1';

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}');
  } catch (e) {
    return {};
  }
}
export function saveProgress(p) {
  localStorage.setItem(STORAGE, JSON.stringify(p));
}

export const DRILLS = [
  {
    id: 'shooting',
    name: 'Shooting',
    icon: '🎯',
    desc: 'Rolling & bouncing balls fed to you from all angles. Score fast and clean. Levels add speed, height and a goalie bot.',
    tip: 'Approach from behind the ball on the line to the target, and hit the ball where you want it to go — not the middle.',
    hasBots: true,
  },
  {
    id: 'saves',
    name: 'Goalkeeping',
    icon: '🧤',
    desc: 'Shots come at your net from everywhere: rollers, bouncers, power shots and aerials. Keep them out and clear to a corner.',
    tip: 'Stay on the far post, stay patient, and clear to the side — never back up the middle.',
    hasBots: false,
  },
  {
    id: 'aerials',
    name: 'Aerials',
    icon: '🚀',
    desc: 'Balls lobbed into the air. Jump, tilt, boost, hit. Later levels are higher, faster and require air roll.',
    tip: 'Jump, hold, tilt your nose toward where the ball will be, then feather the boost. Fix your angle early, not late.',
    hasBots: false,
  },
  {
    id: 'dribbling',
    name: 'Dribbling',
    icon: '🏀',
    desc: 'Carry the ball on your roof through the checkpoints and finish with a flick. Balance is everything.',
    tip: 'Keep the ball slightly in front of centre. Tap the throttle to catch it, coast to let it roll forward.',
    hasBots: false,
  },
  {
    id: 'kickoffs',
    name: 'Kickoffs',
    icon: '⚡',
    desc: 'Repeated kickoffs versus a Grand Champion bot. Win the 50/50 or lose the possession. Every spawn is random.',
    tip: 'Speed flip diagonally, cut in, and flip into the ball at the last moment. Aim the ball to a side, not up.',
    hasBots: true,
  },
  {
    id: 'wallshots',
    name: 'Wall & Rebounds',
    icon: '🧱',
    desc: 'Balls hit the wall and bounce out. Read the bounce, drive up the wall or catch it off the rebound.',
    tip: 'Watch the prediction line. Meet the ball where it comes off the wall rather than chasing it into the corner.',
    hasBots: false,
  },
  {
    id: 'recovery',
    name: 'Speed & Recovery',
    icon: '🏁',
    desc: 'A timed ring course. Chain speed flips, wavedashes and powerslides through the rings as fast as you can.',
    tip: 'Powerslide early into turns, then flip out of them. Land on all four wheels facing where you want to go.',
    hasBots: false,
  },
];

export function createDrill(id, game) {
  switch (id) {
    case 'shooting':
      return new ShootingDrill(game);
    case 'saves':
      return new SavesDrill(game);
    case 'aerials':
      return new AerialDrill(game);
    case 'dribbling':
      return new DribbleDrill(game);
    case 'kickoffs':
      return new KickoffDrill(game);
    case 'wallshots':
      return new WallDrill(game);
    case 'recovery':
      return new RecoveryDrill(game);
    default:
      return new ShootingDrill(game);
  }
}

// ---------------------------------------------------------------------------
class Drill {
  constructor(game, id) {
    this.game = game;
    this.id = id;
    this.meta = DRILLS.find((d) => d.id === id);
    this.attempts = 0;
    this.successes = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.level = clamp(game.config.level || 1, 1, 5);
    this.timer = 0;
    this.attemptTime = 0;
    this.attemptLimit = 8;
    this.message = '';
    this.messageTimer = 0;
    this.attemptActive = false;
    this.rings = [];
    this.results = []; // {ok, time}
    this.markers = [];
    this.lastFeedback = '';
    this.progress = loadProgress();
    this.progress[id] = this.progress[id] || { best: 0, attempts: 0, successes: 0, sessions: 0, levelBest: {} };
    this.progress[id].sessions++;
    this.humanSign = game.human.team === TEAM.BLUE ? 1 : -1; // attack direction
  }
  get human() {
    return this.game.human;
  }
  get ball() {
    return this.game.ball;
  }
  get accuracy() {
    return this.attempts ? this.successes / this.attempts : 0;
  }
  start() {
    this.game.ball.frozen = false;
    this.nextAttempt();
  }
  say(text, ms = 1800) {
    this.message = text;
    this.messageTimer = ms / 1000;
    this.game.emit('drillMessage', { text });
  }
  finishAttempt(ok, feedback = '') {
    if (!this.attemptActive) return;
    this.attemptActive = false;
    this.attempts++;
    if (ok) {
      this.successes++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else this.streak = 0;
    this.results.push({ ok, time: this.attemptTime, feedback });
    this.lastFeedback = feedback;
    const p = this.progress[this.id];
    p.attempts++;
    if (ok) p.successes++;
    p.best = Math.max(p.best, this.bestStreak);
    p.levelBest[this.level] = Math.max(p.levelBest[this.level] || 0, this.successes);
    saveProgress(this.progress);
    this.game.emit('drillResult', { ok, feedback, drill: this });
    this.say(ok ? pick(['Nice!', 'Clean!', 'Great hit!', 'Perfect!', 'That works!']) : feedback || pick(['Missed.', 'Not quite.', 'Reset.']));
    this.resetDelay = ok ? 1.2 : 1.6;
    // auto level-up: 8 of last 10 succeeded
    const last = this.results.slice(-10);
    if (last.length >= 10 && last.filter((r) => r.ok).length >= 8 && this.level < 5) {
      this.level++;
      this.results = [];
      this.say(`Level up! Now level ${this.level}`, 2500);
      this.game.emit('levelUp', { level: this.level });
    }
  }
  update(dt) {
    this.timer += dt;
    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.resetDelay !== undefined) {
      this.resetDelay -= dt;
      if (this.resetDelay <= 0) {
        this.resetDelay = undefined;
        this.nextAttempt();
      }
      return;
    }
    if (this.attemptActive) {
      this.attemptTime += dt;
      this.updateAttempt(dt);
      if (this.attemptTime > this.attemptLimit) this.finishAttempt(false, this.timeoutMessage || 'Too slow — reset.');
    }
  }
  updateAttempt() {}
  onTouch() {}
  onBallInGoal(goalTeam) {
    // goalTeam = whose goal the ball is in
    void goalTeam;
  }
  nextAttempt() {
    this.attemptActive = true;
    this.attemptTime = 0;
    this.touched = false;
    this.setup();
    this.game.predictionDirty = true;
  }
  setup() {}
  // put the ball & car somewhere, optionally give velocity
  placeCar(x, z, yaw, boost = 100) {
    this.human.setPose(x, CAR_Z(z), yaw, boost);
  }
  placeBall(x, y, z, vx = 0, vy = 0, vz = 0) {
    this.ball.reset(new THREE.Vector3(x, Math.max(BALL.RADIUS, y), z));
    this.ball.vel.set(vx, vy, vz);
    this.ball.frozen = false;
  }
  ballInEnemyGoal() {
    return this.ball.pos.z * this.humanSign > ARENA.HALF_LENGTH + BALL.RADIUS;
  }
  ballInOwnGoal() {
    return this.ball.pos.z * this.humanSign < -ARENA.HALF_LENGTH - BALL.RADIUS;
  }
  hudLines() {
    return [`Level ${this.level}`, `${this.successes}/${this.attempts}  (${Math.round(this.accuracy * 100)}%)`, `Streak ${this.streak}  Best ${this.bestStreak}`];
  }
  placeBots() {}
}

const CAR_Z = (z) => z;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
class ShootingDrill extends Drill {
  constructor(game) {
    super(game, 'shooting');
    this.attemptLimit = 9;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    // car spawn near midfield facing the enemy goal
    const cx = rand(-2500, 2500);
    const cz = -s * rand(500, 2200);
    this.placeCar(cx, cz, s === 1 ? 0 : Math.PI, 100);
    // ball fed from a side, rolling across / toward the player
    const side = randSign();
    const bx = side * rand(1500, 3200);
    const bz = s * rand(1000, 3200);
    const speed = 500 + L * 220 + rand(0, 300);
    // velocity roughly across the field toward an area in front of the player
    const tx = rand(-1200, 1200);
    const tz = s * rand(1400, 2800);
    const dx = tx - bx;
    const dz = tz - bz;
    const d = Math.hypot(dx, dz);
    const vy = L >= 2 ? rand(0, 250 + L * 120) : 0;
    const y = L >= 3 ? rand(BALL.RADIUS, 200 + L * 150) : BALL.RADIUS;
    this.placeBall(bx, y, bz, (dx / d) * speed, vy, (dz / d) * speed);
    // goalie bot on levels 4+
    for (const bot of this.game.bots) {
      const car = bot.car;
      if (car.team === this.human.team) {
        car.demolish();
        car.respawnTimer = 999;
        continue;
      }
      if (L >= 4) {
        car.demolished = false;
        car.setPose(rand(-600, 600), s * (ARENA.HALF_LENGTH - 500), s === 1 ? Math.PI : 0, L >= 5 ? 60 : 20);
        bot.role = 'defend';
        bot.maneuver = null;
      } else {
        car.demolish();
        car.respawnTimer = 999;
      }
    }
  }
  onTouch(car) {
    if (car === this.human) this.touched = true;
  }
  updateAttempt() {
    if (this.ballInEnemyGoal()) {
      const spd = this.ball.vel.length();
      const fb = spd > 3000 ? 'Rocket!' : spd > 2000 ? 'Powerful.' : 'In — try hitting it harder.';
      this.finishAttempt(true, fb);
      return;
    }
    if (this.ballInOwnGoal()) this.finishAttempt(false, 'Own goal?!');
    // ball went dead
    if (this.touched && this.ball.vel.length() < 80 && this.attemptTime > 2.5 && this.ball.pos.y < 100) this.finishAttempt(false, 'Ball stopped — commit to the shot.');
    if (this.touched && this.ball.pos.z * this.humanSign < -3500) this.finishAttempt(false, 'Ball went the wrong way.');
  }
}

// ---------------------------------------------------------------------------
class SavesDrill extends Drill {
  constructor(game) {
    super(game, 'saves');
    this.attemptLimit = 6;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    // player in front of their own goal
    this.placeCar(rand(-500, 500), -s * (ARENA.HALF_LENGTH - rand(400, 900)), s === 1 ? 0 : Math.PI, 100);
    // shot from various places
    const bx = rand(-3000, 3000);
    const bz = -s * rand(600, 3200);
    const dist = Math.hypot(bx, ARENA.HALF_LENGTH - Math.abs(bz));
    const targetX = rand(-700, 700);
    const targetY = L >= 3 ? rand(100, 550) : rand(100, 250);
    const goalZ = -s * ARENA.HALF_LENGTH;
    const speed = 1000 + L * 300 + rand(0, 400);
    const y = L >= 2 && Math.random() < 0.5 ? rand(BALL.RADIUS, 900) : BALL.RADIUS;
    const dx = targetX - bx;
    const dz = goalZ - bz;
    const d = Math.hypot(dx, dz);
    const t = d / speed;
    // simple ballistic solve for vy to reach targetY
    const vy = (targetY - y + 0.5 * 650 * t * t) / t;
    this.placeBall(bx, y, bz, (dx / d) * speed, L >= 2 ? vy : 0, (dz / d) * speed);
    this.shotDist = dist;
  }
  onTouch(car) {
    if (car === this.human) {
      this.touched = true;
      this.touchPos = this.ball.pos.clone();
    }
  }
  updateAttempt() {
    if (this.ballInOwnGoal()) {
      this.finishAttempt(false, this.touched ? 'Touched but not cleared.' : 'Beat you — get to the ball earlier.');
      return;
    }
    if (this.touched) {
      const b = this.ball;
      const s = this.humanSign;
      // success when the ball is heading away from our goal and is past the box, or after 2s not in goal
      const awayZ = b.vel.z * s;
      const wide = Math.abs(b.pos.x) > 1200;
      const far = b.pos.z * s > -ARENA.HALF_LENGTH + 2500;
      if ((awayZ > 500 && (wide || far)) || this.attemptTime - this.firstTouchTime() > 2.5) {
        const cornerClear = wide && awayZ > 300;
        this.finishAttempt(true, cornerClear ? 'Great clear to the side.' : 'Saved — but clear it wide, not up the middle.');
      }
    }
    if (!this.touched && this.attemptTime > 4 && this.ball.vel.length() < 100) this.finishAttempt(true, 'Ball died — lucky.');
  }
  firstTouchTime() {
    if (this._ft === undefined && this.touched) this._ft = this.attemptTime;
    return this._ft ?? this.attemptTime;
  }
  nextAttempt() {
    this._ft = undefined;
    super.nextAttempt();
  }
}

// ---------------------------------------------------------------------------
class AerialDrill extends Drill {
  constructor(game) {
    super(game, 'aerials');
    this.attemptLimit = 6;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.placeCar(rand(-1500, 1500), -s * rand(2500, 3800), s === 1 ? 0 : Math.PI, 100);
    // ball starts ahead and is tossed up
    const bx = this.human.pos.x + rand(-1200, 1200);
    const bz = this.human.pos.z + s * rand(1800, 3000);
    const vy = 750 + L * 150 + rand(0, 150);
    const vx = rand(-1, 1) * (100 + L * 140);
    const vz = s * rand(-150, 150) * (L >= 3 ? 2 : 1);
    this.placeBall(bx, BALL.RADIUS + 50, bz, vx, vy, vz);
    this.peak = BALL.RADIUS + 50 + (vy * vy) / (2 * 650);
  }
  onTouch(car) {
    if (car === this.human && !this.touched) {
      this.touched = true;
      const h = this.ball.pos.y;
      const aerial = h > 350;
      const toward = this.ball.vel.z * this.humanSign > 400;
      if (!aerial) {
        this.finishAttempt(false, 'Touched it too low — that was not an aerial. Jump earlier.');
      } else if (this.ballScoredSoon()) {
        this.finishAttempt(true, 'Aerial and on target!');
      } else if (toward) {
        this.finishAttempt(true, `Aerial touch at ${Math.round(h)} uu. Now aim it.`);
      } else {
        this.finishAttempt(true, 'Aerial touch — try to hit it toward the goal.');
      }
    }
  }
  ballScoredSoon() {
    const pred = this.ball.predict(3, 1 / 15);
    const s = this.humanSign;
    return pred.some((p) => p.pos.z * s > ARENA.HALF_LENGTH - 20 && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH && p.pos.y < ARENA.GOAL_HEIGHT);
  }
  updateAttempt() {
    if (!this.touched && this.ball.pos.y < 200 && this.ball.vel.y < 0 && this.attemptTime > 1.5) {
      this.finishAttempt(false, 'Missed. Jump earlier and commit with boost.');
    }
  }
}

// ---------------------------------------------------------------------------
class DribbleDrill extends Drill {
  constructor(game) {
    super(game, 'dribbling');
    this.attemptLimit = 25;
    this.timeoutMessage = 'Out of time — a carry should take under 20 seconds.';
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.placeCar(0, -s * 3500, s === 1 ? 0 : Math.PI, 100);
    // ball placed gently on the car roof (slightly in front of centre)
    this.placeBall(0, 140, -s * 3500 + s * 30, 0, 0, 0);
    this.human.vel.set(0, 0, 0);
    // checkpoints: a slalom
    this.rings = [];
    const n = 2 + L;
    for (let i = 0; i < n; i++) {
      const z = -s * 2200 + s * i * (5200 / n);
      const x = (i % 2 === 0 ? 1 : -1) * (300 + L * 180) + rand(-150, 150);
      this.rings.push({ x, z, y: 0, r: 330, done: false });
    }
    this.carryTime = 0;
    this.onRoof = false;
    this.lostTimer = 0;
  }
  updateAttempt(dt) {
    const b = this.ball;
    const h = this.human;
    const rel = b.pos.clone().sub(h.pos);
    const onRoof = b.pos.y > 100 && b.pos.y < 260 && Math.hypot(rel.x, rel.z) < 130;
    this.onRoof = onRoof;
    if (onRoof) {
      this.carryTime += dt;
      this.lostTimer = 0;
      for (const r of this.rings) {
        if (!r.done && Math.hypot(b.pos.x - r.x, b.pos.z - r.z) < r.r) {
          r.done = true;
          this.say('Checkpoint!', 800);
        }
      }
    } else {
      this.lostTimer += dt;
    }
    const remaining = this.rings.filter((r) => !r.done).length;
    if (remaining === 0 && this.ballInEnemyGoal()) {
      this.finishAttempt(true, `Carried and finished in ${this.attemptTime.toFixed(1)}s!`);
      return;
    }
    if (remaining === 0 && !onRoof && this.lostTimer > 3 && this.ball.vel.length() < 100) {
      this.finishAttempt(false, 'All checkpoints — but no goal. Flick it at the end.');
      return;
    }
    if (remaining > 0 && this.lostTimer > 3.5 && this.attemptTime > 2) {
      this.finishAttempt(false, `Lost the ball with ${remaining} checkpoint${remaining > 1 ? 's' : ''} left. Slower is smoother.`);
    }
  }
  hudLines() {
    const remaining = this.rings.filter((r) => !r.done).length;
    return [...super.hudLines(), `Checkpoints left: ${remaining}`, `Carry time ${this.carryTime.toFixed(1)}s`];
  }
}

// ---------------------------------------------------------------------------
class KickoffDrill extends Drill {
  constructor(game) {
    super(game, 'kickoffs');
    this.attemptLimit = 6;
    this.spawnNames = ['Right diagonal', 'Left diagonal', 'Back right', 'Back left', 'Far back'];
  }
  setup() {
    const g = this.game;
    g.ball.reset();
    g.ball.frozen = true;
    const s = this.humanSign;
    const slot = Math.floor(Math.random() * 5);
    const spawns = [
      { x: -2048, z: -2560, yaw: Math.PI * 0.25 },
      { x: 2048, z: -2560, yaw: -Math.PI * 0.25 },
      { x: -256, z: -3840, yaw: 0 },
      { x: 256, z: -3840, yaw: 0 },
      { x: 0, z: -4608, yaw: 0 },
    ];
    const sp = spawns[slot];
    this.slot = slot;
    this.human.setPose(s * sp.x, s * sp.z, s === 1 ? sp.yaw : sp.yaw + Math.PI, 33);
    // opponent bot: mirrored spawn, exactly like a real 1v1 kickoff
    const os = spawns[slot];
    for (const bot of g.bots) {
      const car = bot.car;
      if (car.team === this.human.team) {
        car.demolish();
        car.respawnTimer = 999;
        continue;
      }
      car.demolished = false;
      car.setPose(-s * os.x, -s * os.z, s === 1 ? os.yaw + Math.PI : os.yaw, 33);
      bot.onKickoff();
      bot.kickoffRole = 'go';
    }
    this.countdown = 3;
    this.goTime = null;
    this.result = null;
    this.firstTouch = null;
    this.say(`${this.spawnNames[slot]} — 3`, 1000);
    this.lastCount = 3;
    g.state = 'countdown';
    g.stateTimer = 3;
  }
  onTouch(car) {
    if (!this.firstTouch) this.firstTouch = { car, time: this.attemptTime };
  }
  updateAttempt(dt) {
    const g = this.game;
    if (g.state === 'countdown') {
      const n = Math.ceil(g.stateTimer);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.say(`${this.spawnNames[this.slot]} — ${n}`, 900);
      }
      this.attemptTime = 0; // don't count down time during the countdown
      return;
    }
    if (this.goTime === null) {
      this.goTime = this.timer;
      this.say('GO!', 700);
    }
    const s = this.humanSign;
    const b = this.ball;
    // judge after the 50/50 resolves: ball moving clearly one way, or 3s passed
    const elapsed = this.attemptTime;
    if (elapsed > 1.2) {
      const zv = b.vel.z * s;
      const zp = b.pos.z * s;
      if (this.ballInEnemyGoal()) return this.finishAttempt(true, 'Kickoff goal!');
      if (this.ballInOwnGoal()) return this.finishAttempt(false, 'Kickoff goal conceded.');
      if (elapsed > 2.6 || Math.abs(zp) > 1800) {
        const ft = this.firstTouch;
        const won = zp > 400 || (zp > -300 && zv > 300);
        const lost = zp < -400 || (zp < 300 && zv < -300);
        let fb;
        if (won) fb = ft && ft.car === this.human ? 'Won the kickoff — first touch and pushed it away.' : 'Ball ended on their side. Nice.';
        else if (lost) fb = ft && ft.car !== this.human ? `They got there first (${(ft.time).toFixed(2)}s). Speed flip faster.` : 'You touched first but lost the 50/50 — flip into the ball later, with your nose down.';
        else fb = 'Neutral kickoff. Fine — but a fast follow-up wins these.';
        this.finishAttempt(!!won && !lost, fb);
      }
    }
  }
  hudLines() {
    const p = this.game.bots[0]?.car;
    return [...super.hudLines(), this.firstTouch ? `First touch: ${this.firstTouch.car === this.human ? 'you' : p?.name || 'bot'} (${this.firstTouch.time.toFixed(2)}s)` : ''];
  }
  finishAttempt(ok, fb) {
    super.finishAttempt(ok, fb);
    this.resetDelay = 2.2;
  }
}

// ---------------------------------------------------------------------------
class WallDrill extends Drill {
  constructor(game) {
    super(game, 'wallshots');
    this.attemptLimit = 8;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    const side = randSign();
    this.placeCar(-side * rand(0, 1500), -s * rand(1000, 2600), s === 1 ? 0 : Math.PI, 100);
    // ball fired at the side wall so it pops off toward the field
    const bx = side * rand(1000, 2500);
    const bz = s * rand(-500, 2500);
    const speed = 1300 + L * 250;
    const ang = rand(0.3, 0.9); // toward the wall + forward
    const vx = side * Math.cos(ang) * speed;
    const vz = s * Math.sin(ang) * speed;
    const vy = 300 + L * 160;
    this.placeBall(bx, BALL.RADIUS + 30, bz, vx, vy, vz);
    this.hitWall = false;
  }
  onTouch(car) {
    if (car === this.human && this.hitWall) {
      this.touched = true;
      this.touchHeight = this.ball.pos.y;
      this.touchOnWall = car.onGround && car.up.y < 0.5;
    }
  }
  updateAttempt() {
    if (!this.hitWall && Math.abs(this.ball.pos.x) > ARENA.HALF_WIDTH - BALL.RADIUS - 20) this.hitWall = true;
    if (this.ballInEnemyGoal()) return this.finishAttempt(true, this.touchOnWall ? 'Wall shot goal!' : 'Rebound goal!');
    if (this.touched && this.ball.vel.z * this.humanSign > 900 && this.attemptTime > 2) {
      const pred = this.ball.predict(2.5, 1 / 15);
      const onNet = pred.some((p) => p.pos.z * this.humanSign > ARENA.HALF_LENGTH - 20 && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH && p.pos.y < ARENA.GOAL_HEIGHT);
      if (onNet) return this.finishAttempt(true, 'On target!');
    }
    if (this.hitWall && this.ball.pos.y < 100 && this.ball.vel.length() < 150 && this.attemptTime > 2.5)
      this.finishAttempt(false, this.touched ? 'Touched but no shot.' : 'Missed it. Read the bounce off the wall earlier.');
  }
}

// ---------------------------------------------------------------------------
class RecoveryDrill extends Drill {
  constructor(game) {
    super(game, 'recovery');
    this.attemptLimit = 60;
    this.timeoutMessage = 'Out of time — restarting the course.';
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.placeCar(0, -s * 4200, s === 1 ? 0 : Math.PI, 100);
    this.ball.reset(new THREE.Vector3(0, -1000, 0)); // hide the ball under the floor
    this.ball.frozen = true;
    this.rings = [];
    const n = 5 + L * 2;
    let x = 0;
    let z = -s * 3000;
    for (let i = 0; i < n; i++) {
      x = clamp(x + rand(-1, 1) * (1200 + L * 300), -3200, 3200);
      z = clamp(z + s * rand(500, 1200), -4500, 4500);
      const y = L >= 3 && Math.random() < 0.3 ? rand(150, 500) : 0;
      this.rings.push({ x, z, y, r: 300, done: false });
    }
    this.ringsDone = 0;
  }
  updateAttempt() {
    const h = this.human;
    const r = this.rings.find((rr) => !rr.done);
    if (!r) {
      const t = this.attemptTime;
      const par = this.rings.length * 0.95;
      const ok = t < par;
      const p = this.progress[this.id];
      p.bestTime = Math.min(p.bestTime || Infinity, t);
      saveProgress(this.progress);
      this.finishAttempt(ok, `${t.toFixed(2)}s (par ${par.toFixed(1)}s${ok ? ' ✓' : ' ✗'})`);
      this.ball.frozen = true;
      return;
    }
    const dy = r.y > 0 ? h.pos.y - r.y : 0;
    if (Math.hypot(h.pos.x - r.x, h.pos.z - r.z) < r.r && Math.abs(dy) < 200) {
      r.done = true;
      this.ringsDone++;
    }
  }
  hudLines() {
    const left = this.rings.filter((r) => !r.done).length;
    return [`Level ${this.level}`, `Time ${this.attemptTime.toFixed(2)}s`, `Rings left ${left}`, this.progress[this.id].bestTime ? `Best ${this.progress[this.id].bestTime.toFixed(2)}s` : ''];
  }
  onBallInGoal() {}
}

export { CAR };
