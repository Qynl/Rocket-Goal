import * as THREE from 'three';
import { ARENA, BALL, TEAM, CAR, GRAVITY } from './constants.js';
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
    desc: 'Balls lobbed into the air — straight lobs, side aerials, drifting balls and ceiling drop shots. The landing marker shows where to meet it.',
    tip: 'Jump, hold, tilt your nose toward where the ball will be, then feather the boost. Fix your angle early, not late. Powerslide + A/D air-rolls.',
    hasBots: false,
  },
  {
    id: 'airshots',
    name: 'Air Shots',
    icon: '🎯',
    desc: 'Balls lofted into the shooting lane. Meet them in the air and put them on goal — the ring shows the contact point, the marker on the floor shows where it lands. A goalie joins from level 4.',
    tip: 'Leave early and arrive level with the ball. Point your nose at the goal before contact, then feather boost — a full-boost aerial overshoots the ball.',
    hasBots: true,
  },
  {
    id: 'aerialsaves',
    name: 'Aerial Saves',
    icon: '🧤',
    desc: 'High balls dropping into your own box, the ones you have to go up for. Clear them wide and in the air — from level 4 a ground punch does not count.',
    tip: 'Back off and get under the drop, then jump into it. Clear to the side walls: a save straight up the middle is just a second shot.',
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
    case 'airshots':
      return new AirShotsDrill(game);
    case 'aerialsaves':
      return new AerialSavesDrill(game);
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

  /**
   * Where the ball is going to come down, from the real ball physics (drag and
   * bounces included). Aerial drills live or die on reading this, so it is worth
   * the cost of a short prediction — throttled to every 4th frame.
   */
  landingPoint(horizon = 3.5) {
    const pred = this.ball.predict(horizon, 1 / 20);
    for (const p of pred) if (p.pos.y <= BALL.RADIUS + 30) return p;
    return pred[pred.length - 1];
  }

  /**
   * Keep a flat ring on the floor under the ball's predicted landing spot, and
   * (optionally) a vertical ring in the air where it should be met. The ground
   * ring is the one that teaches timing: you leave when the marker is still far
   * enough away that you arrive as the ball does.
   */
  showLandingMarker(ground = 250, contact = null) {
    this._markerTick = (this._markerTick || 0) + 1;
    if (this._markerTick % 4 !== 1 && this.rings.length) return;
    const p = this.landingPoint();
    let ring = this.rings.find((r) => r.landing);
    if (!ring) {
      ring = { x: p.pos.x, y: 0, z: p.pos.z, r: ground, done: false, landing: true };
      this.rings.push(ring);
    } else {
      ring.x = p.pos.x;
      ring.z = p.pos.z;
      ring.r = ground;
      ring.done = false;
    }
    if (contact) {
      let c = this.rings.find((r) => r.contact);
      if (!c) {
        c = { x: contact.x, y: contact.y, z: contact.z, r: 230, done: false, contact: true };
        this.rings.push(c);
      } else {
        c.x = contact.x;
        c.y = contact.y;
        c.z = contact.z;
        c.done = this.contactDone;
      }
    }
  }

  /**
   * Solve a lob: launch speed that puts the apex at `peak` uu, and the z speed
   * that makes the ball come down on `toZ` (the apex is halfway, so it lands
   * where you aimed). Drag makes the real ball fall a little short of this,
   * which is fine — the drills want a readable arc, not a solved trajectory.
   */
  lobTo(fromY, peak, fromZ, toZ) {
    const vy = Math.sqrt(2 * GRAVITY * Math.max(60, peak - fromY));
    const t = vy / GRAVITY;
    const vz = (toZ - fromZ) / (2 * t);
    return { vy, vz, t };
  }
}

const CAR_Z = (z) => z;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
class ShootingDrill extends Drill {
  constructor(game) {
    super(game, 'shooting');
    this.attemptLimit = 9;
    this.aerialFeed = false;
    this.aerialContact = 0;
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
    // From level 3 a third of the feeds are aerial: the ball is lofted into the
    // lane instead of rolled along the floor, so Shooting actually asks you to
    // leave the ground. Air Shots is the dedicated version of this.
    this.aerialFeed = L >= 3 && Math.random() < 0.34;
    this.rings = [];
    this.contactDone = false;
    if (this.aerialFeed) {
      const peak = 430 + L * 95;
      const y0 = BALL.RADIUS + 30;
      const lob = this.lobTo(y0, peak, bz, s * (ARENA.HALF_LENGTH - rand(1400, 2600)));
      const drift = rand(-1, 1) * (40 + L * 30);
      this.placeBall(bx, y0, bz, drift, lob.vy, lob.vz);
      this.minHeight = Math.max(260, Math.round(peak * 0.55));
      this.contactRing = { x: bx + drift * lob.t, y: Math.min(peak, 1000), z: (bz + s * (ARENA.HALF_LENGTH - 2000)) / 2, r: 240 };
      if (this.message !== undefined) this.say('Aerial ball — get up to it!', 1.4);
    } else {
      this.placeBall(bx, y, bz, (dx / d) * speed, vy, (dz / d) * speed);
    }
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
    if (car === this.human) {
      this.touched = true;
      this.contactDone = true;
      this.aerialContact = this.aerialFeed ? this.ball.pos.y : 0;
    }
  }
  updateAttempt() {
    if (this.aerialFeed) this.showLandingMarker(240, this.contactRing);
    if (this.ballInEnemyGoal()) {
      const spd = this.ball.vel.length();
      const air = this.aerialContact > 0;
      const fb = air
        ? `Air shot! Met it at ${Math.round(this.aerialContact)} uu.`
        : spd > 3000
          ? 'Rocket!'
          : spd > 2000
            ? 'Powerful.'
            : 'In — try hitting it harder.';
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
    this.aerialFeed = false;
    this.aerialContact = 0;
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
    const vy = (targetY - y + 0.5 * GRAVITY * t * t) / t;
    // From level 3 some of the shots arrive as high balls dropping into the box
    // rather than driven shots: those are the ones a keeper has to go up for,
    // and they were the missing half of this drill. Aerial Saves drills them on
    // their own.
    this.aerialFeed = L >= 3 && Math.random() < 0.4;
    this.rings = [];
    this.contactDone = false;
    if (this.aerialFeed) {
      const peak = 620 + L * 120;
      const y0 = BALL.RADIUS + 30;
      const fromZ = -s * rand(1300, 2500);
      const landZ = -s * (ARENA.HALF_LENGTH - rand(200, 900));
      const lob = this.lobTo(y0, peak, fromZ, landZ);
      const drift = rand(-1, 1) * (30 + L * 40);
      this.placeBall(clamp(bx, -3000, 3000), y0, fromZ, drift, lob.vy, lob.vz);
      this.minHeight = Math.max(300, Math.round(peak * 0.55));
      this.contactRing = { x: bx + drift * lob.t, y: Math.min(peak, 950), z: (fromZ + landZ) / 2, r: 250 };
      this.flightTime = 2 * lob.t;
      this.say('High ball — get under it and go up!', 1.5);
    } else {
      this.placeBall(bx, y, bz, (dx / d) * speed, L >= 2 ? vy : 0, (dz / d) * speed);
    }
    this.shotDist = dist;
  }
  onTouch(car) {
    if (car === this.human) {
      this.touched = true;
      this.contactDone = true;
      this.touchPos = this.ball.pos.clone();
      this.aerialContact = this.aerialFeed ? this.ball.pos.y : 0;
    }
  }
  updateAttempt() {
    if (this.aerialFeed) this.showLandingMarker(260, this.contactRing);
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
        const airNote = this.aerialFeed ? ` Met it at ${Math.round(this.aerialContact)} uu${this.aerialContact >= this.minHeight ? ' — in the air, that is the way.' : ', below the drop: get up to it next time.'}` : '';
        this.finishAttempt(true, (cornerClear ? 'Great clear to the side.' : 'Saved — but clear it wide, not up the middle.') + airNote);
      }
    }
    if (!this.touched && this.attemptTime > 4 && this.ball.vel.length() < 100) this.finishAttempt(true, 'Ball died — lucky.');
    if (!this.touched && this.aerialFeed && this.ball.pos.y < 160 && this.ball.vel.y < 0 && this.attemptTime > this.flightTime * 0.9) {
      this.finishAttempt(false, 'It dropped past you. Read the landing marker and move early — you cannot reach a high ball from a standing start.');
    }
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
    this.attemptLimit = 8;
    this.airTime = 0;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.placeCar(rand(-1500, 1500), -s * rand(2600, 4000), s === 1 ? 0 : Math.PI, 100);
    // Level variety:
    //  1 gentle straight-up lob · 2 higher, drifting · 3 side aerials (air roll)
    //  4 ball drifting away — boost through it · 5 ceiling-bounce drop shots
    let bx = this.human.pos.x + rand(-900, 900) + (L >= 3 ? randSign() * rand(1400, 2400) : 0);
    const bz = this.human.pos.z + s * rand(2000, 3000);
    const vy = L >= 5 ? 1750 + rand(0, 150) : 800 + L * 190 + rand(0, 150);
    const vx = rand(-1, 1) * (120 + L * 160);
    const vz = L >= 4 ? s * rand(250, 480) : s * rand(-160, 160) * (L >= 3 ? 2.2 : 1);
    this.placeBall(clamp(bx, -3500, 3500), BALL.RADIUS + 50, bz, vx, vy, vz);
    this.minHeight = L >= 3 ? 500 : 350;
    this.peak = BALL.RADIUS + 50 + (vy * vy) / (2 * GRAVITY);
    this.rings = [];
    this.contactDone = false;
    // the ring in the air marks the apex — the point this drill has always
    // advertised ("the landing marker shows where to meet it") but never drew
    const tApex = vy / GRAVITY;
    this.contactRing = { x: clamp(bx, -3500, 3500) + vx * tApex, y: Math.min(this.peak, 1100), z: bz + vz * tApex, r: 250 };
  }
  onTouch(car) {
    if (car === this.human && !this.touched) {
      this.touched = true;
      this.contactDone = true;
      const h = this.ball.pos.y;
      const air = Math.max(0, this.human.airTime);
      const aerial = h > this.minHeight;
      const boostLeft = Math.round(this.human.boost);
      const airNote = `${Math.round(h)} uu after ${air.toFixed(1)}s air · ${boostLeft} boost left`;
      const toward = this.ball.vel.z * this.humanSign > 400;
      if (!aerial) {
        this.finishAttempt(false, `Too low (${Math.round(h)} uu — need ${this.minHeight}). Jump earlier and commit with boost.`);
      } else if (this.ballScoredSoon()) {
        this.finishAttempt(true, `Aerial goal! ${airNote}`);
      } else if (toward) {
        this.finishAttempt(true, `Aerial touch, heading their way. ${airNote}`);
      } else {
        this.finishAttempt(true, `Aerial touch — aim it at the goal. ${airNote}`);
      }
    }
  }
  hudLines() {
    return [...super.hudLines(), `Hit it above ${this.minHeight || 350} uu`, `Air time ${this.airTime.toFixed(1)}s`];
  }
  ballScoredSoon() {
    const pred = this.ball.predict(3, 1 / 15);
    const s = this.humanSign;
    return pred.some((p) => p.pos.z * s > ARENA.HALF_LENGTH - 20 && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH && p.pos.y < ARENA.GOAL_HEIGHT);
  }
  updateAttempt(dt) {
    this.airTime = Math.max(this.airTime, this.human.airTime);
    // the landing marker is the teaching aid: leave when it is still far enough
    // away that you and the ball arrive at the same moment
    this.showLandingMarker(240, this.contactRing);
    if (!this.touched && this.ball.pos.y < 200 && this.ball.vel.y < 0 && this.attemptTime > 1.5) {
      this.finishAttempt(false, 'Missed. Jump earlier, tilt the nose up and commit with boost.');
    }
  }
  nextAttempt() {
    this.airTime = 0;
    this.rings = [];
    super.nextAttempt();
  }
}

// ---------------------------------------------------------------------------
/**
 * Air shots: the ball is lofted into the shooting lane and has to be met in the
 * air and put on goal. This is the piece the Shooting drill cannot teach — there
 * the ball is on the floor or bouncing, so you never have to leave the ground.
 */
class AirShotsDrill extends Drill {
  constructor(game) {
    super(game, 'airshots');
    this.attemptLimit = 12;
    this.airTime = 0;
    this.contactHeight = 0;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.rings = [];
    this.contactHeight = 0;
    this.airTime = 0;
    this.contactDone = false;
    // start behind and below the feed, facing their goal
    this.placeCar(rand(-1300, 1300), -s * rand(1500, 2600), s === 1 ? 0 : Math.PI, 100);
    // Apex height the ball has to be met at, and how far in front of us it hangs
    const peak = 420 + L * 105; // 525 .. 945 uu
    const ahead = 1250 + L * 150;
    const y0 = BALL.RADIUS + 40;
    const bx = clamp(this.human.pos.x + rand(-450, 450), -3200, 3200);
    const bz = this.human.pos.z + s * ahead;
    // The apex sits over the shooting lane and the ball drifts on toward goal
    // afterwards, so a clean contact through the middle of the ring ends up on
    // target without the player having to twist in the air.
    const vy = Math.sqrt(2 * GRAVITY * Math.max(60, peak - y0));
    const t = vy / GRAVITY; // time to the apex: how long the player has to leave
    const vz = s * (140 + L * 65) + rand(-30, 30); // toward their goal
    const vx = L >= 3 ? rand(-1, 1) * (50 + L * 40) : rand(-25, 25);
    this.placeBall(bx, y0, bz, vx, vy, vz);
    this.flightTime = 2 * t;
    // The bar is a fraction of the apex, not a fixed offset below it: meeting the
    // ball on the way down is still an aerial, and a threshold pinned just under
    // the apex turns good attempts into "ground hit" nonsense.
    this.minHeight = Math.max(260, Math.round(peak * 0.55));
    // the ring in the air is where the contact should happen: apex of the arc
    this.contactRing = { x: bx + vx * t, y: peak, z: bz + vz * t, r: 240 };
    // a goalie from level 4, as in Shooting
    for (const bot of this.game.bots) {
      const car = bot.car;
      if (car.team === this.human.team) {
        car.demolish();
        car.respawnTimer = 999;
        continue;
      }
      if (L >= 4) {
        car.demolished = false;
        car.setPose(rand(-650, 650), s * (ARENA.HALF_LENGTH - 480), s === 1 ? Math.PI : 0, L >= 5 ? 60 : 20);
        bot.role = 'defend';
        bot.maneuver = null;
      } else {
        car.demolish();
        car.respawnTimer = 999;
      }
    }
  }
  onTouch(car) {
    if (car !== this.human || this.touched) return;
    this.touched = true;
    this.contactHeight = this.ball.pos.y;
    this.contactDone = true;
    this.airAtContact = Math.max(0, this.human.airTime);
  }
  note() {
    return `${Math.round(this.contactHeight)} uu high · ${(this.airAtContact || 0).toFixed(1)}s of air · ${Math.round(this.human.boost)} boost left`;
  }
  updateAttempt(dt) {
    this.airTime = Math.max(this.airTime, this.human.airTime);
    this.showLandingMarker(250, this.contactRing);
    const s = this.humanSign;
    if (this.ballInEnemyGoal()) {
      const aerial = this.contactHeight >= this.minHeight;
      this.finishAttempt(true, aerial ? `Air shot — top stuff. ${this.note()}` : `In, but that was a ground hit at ${Math.round(this.contactHeight)} uu. Meet it above ${Math.round(this.minHeight)}.`);
      return;
    }
    if (this.ballInOwnGoal()) {
      this.finishAttempt(false, 'Own goal — get your body between the ball and your net.');
      return;
    }
    if (this.touched) {
      const toward = this.ball.vel.z * s > 500;
      const fast = this.ball.vel.length() > 1100;
      const h = this.contactHeight;
      if (h >= this.minHeight) {
        if (toward && fast) this.finishAttempt(true, `Clean air shot on target. ${this.note()}`);
        else this.finishAttempt(false, `Good height, no direction. ${this.note()} Turn your nose toward the goal before you arrive, not after.`);
      } else if (h > 240) {
        this.finishAttempt(false, `${Math.round(h)} uu — just under the ${Math.round(this.minHeight)} uu target. Leave a beat earlier so you meet it at the top of its arc instead of on the way down.`);
      } else {
        this.finishAttempt(false, `That was a ground hit at ${Math.round(h)} uu — the ball was above you. Jump into it and meet it at ${Math.round(this.minHeight)}+.`);
      }
      return;
    }
    if (this.ball.pos.y < 180 && this.ball.vel.y < 0 && this.attemptTime > 1.6) {
      this.finishAttempt(false, 'Missed it. Read the landing marker and leave early — you cannot catch up in the air.');
    }
  }
  hudLines() {
    return [...super.hudLines(), `Meet it above ${Math.round(this.minHeight)} uu`, `Air time ${this.airTime.toFixed(1)}s`];
  }
}

// ---------------------------------------------------------------------------
/**
 * Aerial saves: high balls dropping into your own box, the ones a keeper has to
 * go up for. The Goalkeeping drill drives shots at a target height; this one
 * makes you leave the ground to clear them.
 */
class AerialSavesDrill extends Drill {
  constructor(game) {
    super(game, 'aerialsaves');
    this.attemptLimit = 10;
    this.airTime = 0;
    this.contactHeight = 0;
  }
  setup() {
    const s = this.humanSign;
    const L = this.level;
    this.rings = [];
    this.contactHeight = 0;
    this.airTime = 0;
    this.contactDone = false;
    this._ft = undefined;
    // keeper in front of the net, facing the field
    this.placeCar(rand(-500, 500), -s * (ARENA.HALF_LENGTH - rand(450, 950)), s === 1 ? 0 : Math.PI, 100);
    // the lob is launched from out in the defensive half and drops into the box
    const y0 = BALL.RADIUS + 30;
    const peak = 560 + L * 130; // 690 .. 1210 uu
    const fromZ = -s * rand(1500 + L * 120, 2700 + L * 200);
    // where it comes down: shallow and well in front of the line at level 1 (time
    // to read it), then progressively deeper until it drops inside the goal
    const depth = L >= 4 ? rand(-450, 350) : L >= 3 ? rand(250, 900) : rand(800, 1600);
    const landZ = -s * (ARENA.HALF_LENGTH - depth);
    const lob = this.lobTo(y0, peak, fromZ, landZ, s);
    const { vy, vz, t } = lob;
    const vx = L >= 3 ? rand(-1, 1) * (60 + L * 55) : rand(-30, 30);
    const bx = clamp(rand(-1500, 1500), -3400, 3400);
    this.placeBall(bx, y0, fromZ, vx, vy, vz);
    this.minHeight = Math.max(300, Math.round(peak * 0.55));
    this.contactRing = { x: bx + vx * t, y: Math.min(peak, 900), z: (fromZ + landZ) / 2, r: 250 };
    this.flightTime = 2 * t;
  }
  onTouch(car) {
    if (car !== this.human || this.touched) return;
    this.touched = true;
    this.contactHeight = this.ball.pos.y;
    this.contactDone = true;
    this.airAtContact = Math.max(0, this.human.airTime);
    this._ft = this.attemptTime;
  }
  updateAttempt(dt) {
    this.airTime = Math.max(this.airTime, this.human.airTime);
    this.showLandingMarker(260, this.contactRing);
    const s = this.humanSign;
    const b = this.ball;
    if (this.ballInOwnGoal()) {
      this.finishAttempt(false, this.touched ? `Touched at ${Math.round(this.contactHeight)} uu and it still went in — clear it wide, not straight up.` : 'It dropped in untouched. Get under the ball early: leave before it starts falling.');
      return;
    }
    if (this.touched) {
      const away = b.vel.z * s > 250; // upfield, away from our net
      const wide = Math.abs(b.pos.x) > 1100;
      const out = b.pos.z * s > -(ARENA.HALF_LENGTH - 2000);
      const settled = this.attemptTime - (this._ft ?? this.attemptTime) > 2.2;
      if ((away && (wide || out)) || settled) {
        const aerial = this.contactHeight >= this.minHeight;
        const strict = this.level >= 4;
        if (!aerial && strict) {
          this.finishAttempt(false, `You met it at ${Math.round(this.contactHeight)} uu. At this level the ball has to be cleared in the air — jump into it, above ${Math.round(this.minHeight)} uu.`);
        } else if (aerial && away && (wide || out)) {
          this.finishAttempt(true, `Aerial save, cleared wide at ${Math.round(this.contactHeight)} uu. ${this.airAtContact.toFixed(1)}s of air.`);
        } else if (aerial) {
          this.finishAttempt(true, `Aerial save at ${Math.round(this.contactHeight)} uu — now send it wide, not up the middle.`);
        } else {
          this.finishAttempt(true, `Cleared, but from ${Math.round(this.contactHeight)} uu. Get up to it: the higher you meet it, the earlier the danger is gone.`);
        }
      }
      return;
    }
    if (b.pos.y < 160 && b.vel.y < 0 && this.attemptTime > this.flightTime * 0.9) {
      this.finishAttempt(false, 'Never got to it. Watch the landing marker — that is where you have to be, so start moving before it drops.');
    }
  }
  firstTouchTime() {
    return this._ft ?? this.attemptTime;
  }
  hudLines() {
    return [...super.hudLines(), `Clear it above ${Math.round(this.minHeight)} uu`, `Air time ${this.airTime.toFixed(1)}s`];
  }
  nextAttempt() {
    this._ft = undefined;
    super.nextAttempt();
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
