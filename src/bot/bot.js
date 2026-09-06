import * as THREE from 'three';
import { ARENA, BALL, CAR, TEAM, GRAVITY } from '../constants.js';
import { Car } from '../physics/car.js';
import { clamp, rand, lerp } from '../math.js';
import { driveTo, aimAir, aerialRequirement, timeToPoint, toLocal } from './controllers.js';

// ---------------------------------------------------------------------------
// Skill presets
// ---------------------------------------------------------------------------
export const SKILLS = {
  rookie: {
    name: 'Rookie',
    reaction: 0.55, // seconds before re-planning after the ball is hit
    aimNoise: 0.45, // radians of shot-direction noise
    speedFactor: 0.72,
    useBoost: true,
    boostChance: 0.4,
    speedFlips: false,
    flipForSpeed: 0.25,
    defenseIQ: 0.35,
    dodgeShots: 0.35, // probability of flipping into the ball
    maxAerialHeight: 0, // no aerials
    shadow: false,
    boostManagement: false,
    demo: false,
    challengeMargin: 0.6,
    thinkRate: 6,
  },
  pro: {
    name: 'Pro',
    reaction: 0.3,
    aimNoise: 0.2,
    speedFactor: 0.9,
    useBoost: true,
    boostChance: 0.8,
    speedFlips: false,
    flipForSpeed: 0.8,
    defenseIQ: 0.8,
    dodgeShots: 0.75,
    maxAerialHeight: 650,
    shadow: true,
    boostManagement: true,
    demo: false,
    challengeMargin: 0.3,
    thinkRate: 4,
  },
  allstar: {
    name: 'All-Star',
    reaction: 0.14,
    aimNoise: 0.08,
    speedFactor: 1,
    useBoost: true,
    boostChance: 1,
    speedFlips: true,
    dodgeShots: 0.95,
    maxAerialHeight: 1250,
    shadow: true,
    boostManagement: true,
    demo: false,
    challengeMargin: 0.15,
    thinkRate: 3,
  },
  champion: {
    name: 'Grand Champion',
    reaction: 0.05,
    aimNoise: 0.025,
    speedFactor: 1,
    useBoost: true,
    boostChance: 1,
    speedFlips: true,
    dodgeShots: 1,
    maxAerialHeight: 1850,
    shadow: true,
    boostManagement: true,
    demo: true,
    challengeMargin: 0.05,
    thinkRate: 2,
  },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _local = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const BIG_PADS_IDX = [0, 3, 4, 15, 18, 29, 30, 33];

// Height-vs-time tables for a held single jump and a jump + double jump, from the actual car model.
let JUMP_TABLES = null;
function jumpTables() {
  if (JUMP_TABLES) return JUMP_TABLES;
  const make = (double) => {
    const car = new Car(0, 'sim');
    car.setPose(0, 0, 0, 0);
    const out = [];
    const dt = 1 / 120;
    for (let t = 0; t < 1.6; t += dt) {
      car.controls.jump = t < 0.2 || (double && t >= 0.25 && t < 0.27);
      car.step(dt);
      out.push({ t: t + dt, y: car.pos.y, vy: car.vel.y });
      if (t > 0.3 && car.onGround) break;
    }
    return out;
  };
  JUMP_TABLES = { single: make(false), double: make(true) };
  return JUMP_TABLES;
}
/** Time until a jumping car's origin first reaches `height` (rising). Returns {t, double} or null. */
export function riseTime(height) {
  const tb = jumpTables();
  for (const [name, table] of [
    ['single', tb.single],
    ['double', tb.double],
  ]) {
    for (const row of table) {
      if (row.vy < 0 && row.y < height) break; // already falling below it
      if (row.y >= height) return { t: row.t, double: name === 'double' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
export class Bot {
  constructor(car, game, skill) {
    this.car = car;
    this.game = game;
    this.skill = skill;
    this.target = new THREE.Vector3();
    this.role = 'attack';
    this.maneuver = null;
    this.thinkTimer = 0;
    this.lockUntil = 0;
    this.aimOffset = 0;
    this.aimTimer = 0;
    this.intercept = null;
    this.stuckTimer = 0;
    this.kickoff = false;
    this.kickoffRole = 'go';
    this.kickoffPlan = null;
    this.kickoffTimer = 0;
    this.lastTouchTime = -1;
    this.boostChoice = Math.random() < skill.boostChance;
    this.boostChoiceTimer = 0;
    this.debug = { role: '', text: '' };
    this.plan = { type: 'ball', point: new THREE.Vector3(), speed: CAR.MAX_SPEED, arriveIn: 0, facing: null };
  }

  get attackSign() {
    return this.car.team === TEAM.BLUE ? 1 : -1;
  }
  /** Ball radius follows the ball-size mutator. */
  get ballRadius() {
    return this.game.ball.radius;
  }
  get enemyGoal() {
    return _v3.set(0, 0, this.attackSign * ARENA.HALF_LENGTH);
  }
  ownGoalPos(out = new THREE.Vector3()) {
    return out.set(0, 0, -this.attackSign * ARENA.HALF_LENGTH);
  }
  enemyGoalPos(out = new THREE.Vector3()) {
    return out.set(0, 0, this.attackSign * ARENA.HALF_LENGTH);
  }

  onKickoff() {
    this.kickoff = true;
    this._kickoffFlipped = false;
    this._kickoffFlipped2 = false;
    this.maneuver = null;
    this.intercept = null;
    this.stuckTimer = 0;
    // The teammate closest to the ball takes the kickoff, others wait / grab boost
    const mates = this.game.cars.filter((c) => c.team === this.car.team);
    let closest = mates[0];
    let best = Infinity;
    for (const m of mates) {
      const d = m.pos.length() + (m.isBot ? 0 : -1); // human wins ties => bots let the human take it
      if (d < best) {
        best = d;
        closest = m;
      }
    }
    this.kickoffRole = closest === this.car ? 'go' : 'cheat';
    if (this.kickoffRole === 'cheat' && Math.abs(this.car.pos.z) > 4500) this.kickoffRole = 'stay';
    // kickoff variety, like real players: side of approach, dodge timing, and hitting the ball
    // slightly off-centre to steer the 50/50
    const sk = this.skill;
    const noise = sk.aimNoise * 2 + 0.05;
    this.kickoffPlan = {
      side: Math.random() < 0.5 ? -1 : 1, // which side of the ball's centre to hit
      offset: 30 + Math.random() * 60, // how far off-centre (uu)
      dodgeLead: 0.1 + Math.random() * 0.06 + (Math.random() - 0.5) * noise * 0.2, // seconds before contact to dodge
      delay: sk.speedFlips ? 0 : Math.random() * 0.25 * (1 - sk.boostChance) + Math.random() * 0.08, // reaction delay
      diagonalFlip: Math.random() < 0.5, // use a diagonal flip into the ball
    };
    this.kickoffTimer = 0;
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const car = this.car;
    const game = this.game;
    if (car.demolished) return;
    const c = car.controls;

    // per-frame stuff
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = rand(1.5, 3);
      this.aimOffset = rand(-1, 1) * this.skill.aimNoise;
    }
    this.boostChoiceTimer -= dt;
    if (this.boostChoiceTimer <= 0) {
      this.boostChoiceTimer = rand(1, 2.5);
      this.boostChoice = Math.random() < this.skill.boostChance;
    }
    // reaction delay after opponent / anyone touches the ball
    const lt = game.ball.lastTouch;
    if (lt && lt.time !== this.lastTouchTime) {
      this.lastTouchTime = lt.time;
      if (lt.car !== car) this.lockUntil = game.time + this.skill.reaction * rand(0.7, 1.3);
    }

    // Rumble: fire the power-up when it is worth using
    if (game.rumble && car.item && game.rumble.botWants(car, this.role)) game.rumble.use(car);

    // active maneuver overrides everything
    if (this.maneuver) {
      if (this.updateManeuver(dt)) return;
      this.maneuver = null;
    }

    // airborne without a maneuver: recover
    if (!car.onGround) {
      this.recover();
      return;
    }

    // kickoff
    if (this.kickoff) {
      if (game.ball.lastTouch || game.ball.pos.lengthSq() > 100 * 100 || game.ball.vel.lengthSq() > 1) this.kickoff = false;
      else {
        this.doKickoff(dt);
        return;
      }
    }

    // on a wall and slow: hop off and recover instead of crawling
    if (car.onGround && car.up.y < 0.6 && car.speed < 450 && this.role !== 'boost') {
      this.startManeuver('dodge', { wallHop: true });
      return;
    }

    // stuck detection
    if (car.speed < 120 && !this.kickoff) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 1.4) {
      // reverse + flip out
      if (this.stuckTimer < 2.2) {
        c.throttle = -1;
        c.steer = this.stuckTimer % 1 < 0.5 ? 1 : -1;
        c.boost = false;
        c.handbrake = false;
        c.jump = false;
        return;
      }
      this.stuckTimer = 0;
      this.startManeuver('dodge', { dir: car.getForward(new THREE.Vector3()).negate() });
      return;
    }

    // think at a reduced rate (planning), act every frame (steering)
    this.thinkTimer -= 1;
    if (this.thinkTimer <= 0 && game.time >= this.lockUntil) {
      this.thinkTimer = this.skill.thinkRate;
      this.think();
    }
    this.act(dt);
  }

  // -------------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------------
  think() {
    const car = this.car;
    const game = this.game;
    const ball = game.ball;
    const pred = game.prediction;
    const sk = this.skill;
    const atk = this.attackSign;
    const ownGoal = this.ownGoalPos(_v);
    const ballToOwnGoal = ownGoal.distanceTo(ball.pos);

    // Threat: is the ball going into our goal?
    let threat = null;
    for (const p of pred) {
      if (p.t > 4.5) break;
      if (p.pos.z * -atk > ARENA.HALF_LENGTH - this.ballRadius && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH + 100 && p.pos.y < ARENA.GOAL_HEIGHT + 100) {
        threat = p;
        break;
      }
    }

    // Who is closest to the ball on each team (time-based)?
    const myTime = timeToPoint(car, ball.pos, sk.useBoost);
    let mateBest = Infinity;
    let mateClosest = null;
    let oppBest = Infinity;
    for (const other of game.cars) {
      if (other === car || other.demolished) continue;
      const t = timeToPoint(other, ball.pos, true);
      if (other.team === car.team) {
        if (t < mateBest) {
          mateBest = t;
          mateClosest = other;
        }
      } else if (t < oppBest) oppBest = t;
    }
    // Humans are given the ball (bots defer unless they are clearly faster)
    const mateFaster = mateClosest && mateBest < myTime - (mateClosest.isBot ? 0.15 : -0.35);
    const iAmLastBack = this.isLastBack();

    // Intercept for a shot
    const shotTarget = this.pickShotTarget(ball.pos);
    const shot = this.findIntercept(pred, shotTarget, 'shot');
    const saveNeeded = !!threat;
    let clearTarget = null;
    if (saveNeeded || ballToOwnGoal < 2600) {
      // clear to the side that's further from the ball's x
      const side = ball.pos.x >= 0 ? 1 : -1;
      clearTarget = new THREE.Vector3(side * 4000, 0, atk * 2000);
    }
    const clear = clearTarget ? this.findIntercept(pred, clearTarget, 'clear') : null;

    // Role choice --------------------------------------------------------
    let role = 'attack';
    if (saveNeeded && (!mateFaster || iAmLastBack)) role = 'save';
    else if (mateFaster && !saveNeeded) role = iAmLastBack ? 'defend' : 'support';
    else if (sk.shadow && oppBest < myTime - sk.challengeMargin && ballToOwnGoal < 7000 && this.ballBetweenMeAndGoal() === false) role = 'shadow';
    else role = 'attack';

    // boost management
    const ic0 = role === 'attack' ? shot || clear : null;
    if (sk.boostManagement && ic0 && ic0.t > 1.8 && car.boost < 40 && !saveNeeded) {
      // ball is far away in time: grab a pad we can reach with time to spare
      const pad = this.nearestBigPad(Math.min(2200, (ic0.t - 1.0) * 1400));
      if (pad) {
        role = 'boost';
        this.plan.pad = pad;
      }
    }
    if (sk.boostManagement && car.boost < 28 && role !== 'save' && role !== 'boost' && !saveNeeded) {
      const pad = this.nearestBigPad(role === 'support' || role === 'defend' ? 2500 : 1300);
      if (pad && (role !== 'attack' || myTime > 1.6)) {
        role = 'boost';
        this.plan.pad = pad;
      }
    }
    // demos for the top bots when opponent is sitting in goal and the ball is far
    if (sk.demo && role === 'support' && car.boost > 40) {
      const victim = game.cars.find((o) => o.team !== car.team && !o.demolished && o.pos.distanceTo(car.pos) < 2500 && Math.abs(o.pos.z + atk * ARENA.HALF_LENGTH) > 3500);
      if (victim && Math.random() < 0.3) {
        role = 'demo';
        this.plan.victim = victim;
      }
    }

    this.role = role;
    if (Math.random() < 0.15) this._defenseRoll = undefined;
    this.intercept = role === 'save' ? clear || shot : role === 'attack' ? shot || clear : null;
    if (role === 'attack' && !shot && clear) this.intercept = clear;
    this.debug.role = role;
  }

  isLastBack() {
    const atk = this.attackSign;
    const mates = this.game.cars.filter((c) => c.team === this.car.team && !c.demolished);
    let last = this.car;
    let best = -Infinity;
    for (const m of mates) {
      const d = m.pos.z * -atk; // higher = closer to own goal
      if (d > best) {
        best = d;
        last = m;
      }
    }
    return last === this.car;
  }

  ballBetweenMeAndGoal() {
    const atk = this.attackSign;
    const ball = this.game.ball;
    return ball.pos.z * -atk > this.car.pos.z * -atk; // ball is closer to our goal than we are
  }

  nearestBigPad(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const idx of BIG_PADS_IDX) {
      const p = this.game.pads[idx];
      if (!p.active) continue;
      const d = Math.hypot(p.x - this.car.pos.x, p.z - this.car.pos.z);
      // prefer pads on our side of the ball when defending
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  pickShotTarget(ballPos) {
    const atk = this.attackSign;
    // aim at the far post-ish side from the ball, with noise
    const goalX = clamp(-ballPos.x * 0.25, -500, 500);
    const t = new THREE.Vector3(goalX, 200, atk * (ARENA.HALF_LENGTH + 200));
    // aim noise
    const d = t.clone().sub(ballPos);
    const ang = Math.atan2(d.x, d.z) + this.aimOffset;
    const len = Math.hypot(d.x, d.z);
    t.x = ballPos.x + Math.sin(ang) * len;
    t.z = ballPos.z + Math.cos(ang) * len;
    return t;
  }

  /**
   * Find the first predicted ball position we can reach in time.
   * kind: 'shot' (arrive with speed) or 'clear'.
   */
  findIntercept(pred, target, kind) {
    const car = this.car;
    const sk = this.skill;
    const canAerial = sk.maxAerialHeight > 0 && car.boost > 18;
    const approach = new THREE.Vector3();
    for (let i = 0; i < pred.length; i += 2) {
      const p = pred[i];
      const bp = p.pos;
      const h = bp.y;
      // don't chase the ball into our own net area
      if (Math.abs(bp.z) > ARENA.HALF_LENGTH - 50 && h > ARENA.GOAL_HEIGHT) continue;
      if (bp.z * this.attackSign < -(ARENA.HALF_LENGTH - 10)) break; // it's in our net: a goal
      if (bp.z * this.attackSign > ARENA.HALF_LENGTH - 10) break; // in theirs: also over
      const dir = _dir.copy(target).sub(bp);
      dir.y = 0;
      dir.normalize();
      // A ball rolling into the corner/back wall on our side: don't plan a hit in the last metres
      // before the wall from the wrong side (the chase pushes it into our own goal). Wait for the
      // bounce off the wall instead — later samples will be reachable from the right side.
      if (kind === 'clear' || kind === 'shot') {
        const ownZ = -this.attackSign * ARENA.HALF_LENGTH;
        const nearOwnBack = Math.abs(bp.z - ownZ) < 900 && Math.abs(bp.x) > ARENA.GOAL_HALF_WIDTH;
        if (nearOwnBack && (p.vel.z * -this.attackSign) > 300 && h < 200) {
          const toBall = _v.copy(bp).sub(car.pos);
          // we're "behind" it (further from our wall than the ball) — a hit would go toward our wall/goal
          if (Math.abs(car.pos.z - ownZ) > Math.abs(bp.z - ownZ) + 150 && toBall.dot(dir) < 0) continue;
        }
      }
      if (h < 160) {
        // ground hit: approach from behind the ball along the shot line
        approach.copy(bp).addScaledVector(dir, -(this.ballRadius + 40));
        approach.y = 0;
        // extra time to line up: how far is our approach direction from the shot line?
        const toApproach = _v.copy(approach).sub(car.pos).setY(0);
        const dA = toApproach.length();
        let lineUp = 0;
        if (dA > 50) {
          const mis = Math.acos(clamp(toApproach.multiplyScalar(1 / dA).dot(dir), -1, 1));
          lineUp = mis > 0.4 ? (mis - 0.4) * 0.6 : 0;
        }
        const tNeed = timeToPoint(car, approach, sk.useBoost) / sk.speedFactor + lineUp;
        if (tNeed <= p.t + 0.02) {
          return { t: p.t, time: this.game.time + p.t, pos: bp.clone(), vel: p.vel.clone(), point: approach.clone(), dir: dir.clone(), mode: 'ground', kind };
        }
      } else if (h < 560 && p.t > 0.2) {
        // jump / double-jump reach. Only take it if we don't have to wait around under the ball;
        // otherwise a later (lower) sample will be picked, which is what a good player does.
        const rt = riseTime(h - 115);
        if (!rt) continue;
        approach.copy(bp).addScaledVector(dir, -(this.ballRadius + 20));
        approach.y = 0;
        const tNeed = timeToPoint(car, approach, sk.useBoost) / sk.speedFactor;
        const wait = p.t - tNeed;
        if (wait >= -0.02 && wait <= 0.6 && p.t >= rt.t) {
          return { t: p.t, time: this.game.time + p.t, pos: bp.clone(), vel: p.vel.clone(), point: approach.clone(), dir: dir.clone(), mode: rt.double ? 'doublejump' : 'jump', kind };
        }
      } else if (canAerial && h <= sk.maxAerialHeight && p.t > 0.6 && p.t < 4) {
        // aerial feasibility: required acceleration after a jump
        const contact = approach.copy(bp).addScaledVector(dir, -(this.ballRadius + 30));
        const req = aerialRequirement(car, contact, p.t - 0.25, _acc);
        // after jumping we get ~ 292 + 200 vertical velocity; approximate by reducing vertical requirement
        req.y -= (500 / (p.t - 0.25)) * 2;
        const mag = req.length();
        const facing = car.getForward(_v2);
        const alignment = facing.dot(_v.copy(contact).sub(car.pos).normalize());
        if (mag < 780 && mag > 200 && alignment > 0.6 && car.boost > 12 + p.t * 20) {
          return { t: p.t, time: this.game.time + p.t, pos: bp.clone(), vel: p.vel.clone(), point: contact.clone(), dir: dir.clone(), mode: 'aerial', kind };
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Acting
  // -------------------------------------------------------------------------
  act(dt) {
    const car = this.car;
    const game = this.game;
    const ball = game.ball;
    const sk = this.skill;
    const atk = this.attackSign;

    switch (this.role) {
      case 'attack':
      case 'save':
        this.actAttack(dt);
        break;
      case 'shadow':
        this.actShadow(dt);
        break;
      case 'defend':
        this.actDefend(dt);
        break;
      case 'support':
        this.actSupport(dt);
        break;
      case 'boost': {
        const p = this.plan.pad;
        if (!p || !p.active) {
          this.thinkTimer = 0;
          this.actSupport(dt);
          break;
        }
        this.target.set(p.x, 0, p.z);
        driveTo(this, this.target, { speed: CAR.MAX_SPEED * sk.speedFactor, allowBoost: false });
        break;
      }
      case 'demo': {
        const v = this.plan.victim;
        if (!v || v.demolished) {
          this.thinkTimer = 0;
          break;
        }
        // lead the target a bit
        this.target.copy(v.pos).addScaledVector(v.vel, 0.4);
        driveTo(this, this.target, { speed: CAR.MAX_SPEED, allowBoost: true, allowFlip: true });
        if (car.pos.distanceTo(v.pos) > 3000 || car.boost < 5) this.thinkTimer = 0;
        break;
      }
      default:
        this.actAttack(dt);
    }
  }

  /**
   * Ball rolling toward our own goal with us near it: the classic "beat it back, block, clear" pattern.
   * Returns true when it took control this frame.
   */
  defendRollingBall() {
    const car = this.car;
    const ball = this.game.ball;
    const c = car.controls;
    if (!car.onGround || ball.pos.y > 260) return false;
    // weaker bots don't always read this situation
    if (this.skill.defenseIQ !== undefined && this._defenseRoll === undefined) this._defenseRoll = Math.random();
    if (this.skill.defenseIQ !== undefined && this._defenseRoll > this.skill.defenseIQ) return false;
    const ownGoal = this.ownGoalPos(_v4);
    const ballToGoal = ownGoal.distanceTo(ball.pos);
    const bv = _v3.copy(ball.vel).setY(0);
    const bs = bv.length();
    if (bs < 200 || bs > 1600 || ballToGoal > 4200) return false;
    bv.multiplyScalar(1 / bs);
    // heading at our goal line, and will cross it between the posts (roughly)?
    const towardLine = bv.z * -this.attackSign;
    if (towardLine < 0.45) return false;
    const zLeft = Math.abs(ownGoal.z - ball.pos.z);
    const tGoal = zLeft / Math.max(1, Math.abs(ball.vel.z));
    const xAtGoal = ball.pos.x + ball.vel.x * tGoal;
    if (Math.abs(xAtGoal) > ARENA.GOAL_HALF_WIDTH + 350) return false;

    const rel = _v2.copy(car.pos).sub(ball.pos).setY(0);
    const along = rel.dot(bv);
    const lateral = _v.copy(rel).addScaledVector(bv, -along);
    const latDist = lateral.length();
    if (along < -2200 || along > 2000 || latDist > 1500) return false;
    const toBall = _v2.copy(ball.pos).sub(car.pos).setY(0);
    const dBall = toBall.length();
    const local = toLocal(car, toBall, _local);
    const ang = Math.atan2(local.x, local.z);
    const side = _v.set(bv.z, 0, -bv.x); // unit vector to the right of the ball's path
    const latSign = Math.sign(lateral.dot(side)) || 1;

    if (along <= 80) {
      // behind or beside the ball: overtake it closely on our side, full speed
      if (dBall < 260 && Math.abs(ang) < 0.5) {
        // it's right in front of us and we can't get past: at least don't push it in — brake
        c.throttle = -1;
        c.steer = 0;
        c.boost = false;
        c.jump = false;
        c.handbrake = false;
        return true;
      }
      const aim = _v2.copy(ball.pos).addScaledVector(bv, 500 + bs * 0.45).addScaledVector(side, latSign * 190);
      aim.y = 0;
      driveTo(this, aim, { speed: CAR.MAX_SPEED, allowFlip: dBall > 900, allowHandbrake: false });
      return true;
    }

    // ahead of the ball: get onto its path and kill our speed so the car body blocks it
    const fs = car.forwardSpeed;
    const facingBall = Math.abs(ang) < 0.75;
    const backToBall = Math.abs(ang) > 2.35;
    if (facingBall) {
      driveTo(this, ball.pos, { speed: CAR.MAX_SPEED, allowFlip: false, allowHandbrake: false });
      if (dBall < 420 && car.hasFlip && (bs > 600 || car.speed > 500)) this.startManeuver('dodge', { dir: toBall.normalize() });
      return true;
    }
    if (backToBall) {
      // reverse into it; steer the tail onto the path
      c.throttle = -1;
      c.steer = clamp(-Math.sign(ang) * (Math.PI - Math.abs(ang)) * 2.5, -1, 1);
      if (latDist > 120) {
        const localSide = toLocal(car, _v.copy(side).multiplyScalar(-latSign), _local);
        c.steer = clamp(c.steer + Math.sign(localSide.x) * 0.6, -1, 1);
      }
      c.boost = false;
      c.jump = false;
      c.handbrake = false;
      return true;
    }
    // sideways to the path: brake hard while steering onto the path; once slow, turn to face the ball
    if (Math.abs(fs) > 350) {
      c.throttle = fs > 0 ? -1 : 1;
      const localPath = toLocal(car, _v.copy(side).multiplyScalar(-latSign), _local);
      c.steer = latDist > 100 ? clamp(localPath.x * 3, -1, 1) * Math.sign(fs) : 0;
      c.handbrake = false;
    } else {
      c.throttle = 0.6;
      c.steer = Math.sign(ang);
      c.handbrake = Math.abs(fs) > 200;
    }
    c.boost = false;
    c.jump = false;
    return true;
  }

  actAttack(dt) {
    const car = this.car;
    const ball = this.game.ball;
    const sk = this.skill;
    const ic = this.intercept;
    const c = car.controls;

    if (this.defendRollingBall()) return;

    if (!ic) {
      // No feasible intercept: drive toward where the ball will be on the ground soon, staying goal-side
      const p = this.groundBallPoint(1.2);
      const toGoal = this.ownGoalPos(_v).sub(p).normalize();
      this.target.copy(p).addScaledVector(toGoal, 600);
      driveTo(this, this.target, { speed: CAR.MAX_SPEED * sk.speedFactor });
      return;
    }

    // refresh intercept against the current prediction (ball may have been touched)
    const tLeft = ic.time - this.game.time;
    if (tLeft < -0.15) {
      this.thinkTimer = 0;
      this.intercept = null;
      return;
    }
    // where's the ball going to be at intercept time?
    const p = this.samplePrediction(Math.max(0, tLeft));
    if (p) {
      // if the ball drifted far from the plan, re-plan
      if (p.pos.distanceTo(ic.pos) > 400) {
        this.thinkTimer = 0;
        this.intercept = null;
        driveTo(this, this.groundBallPoint(0.5), { speed: CAR.MAX_SPEED * sk.speedFactor, allowFlip: false });
        return;
      }
      ic.pos.copy(p.pos);
      ic.point.copy(p.pos).addScaledVector(ic.dir, -(this.ballRadius + 40));
      if (ic.mode !== 'aerial') ic.point.y = 0;
    }

    if (ic.mode === 'aerial') {
      // launch when we're lined up
      const toBall = _v.copy(ic.point).sub(car.pos);
      const flat = _v2.copy(toBall);
      flat.y = 0;
      const local = toLocal(car, flat, _local);
      const angle = Math.abs(Math.atan2(local.x, local.z));
      if (angle < 0.25 && tLeft < 2.6) {
        this.startManeuver('aerial', { intercept: ic });
        return;
      }
      driveTo(this, _v.copy(ic.point).setY(0), { speed: CAR.MAX_SPEED * sk.speedFactor, allowFlip: false });
      return;
    }

    // Ground approach: drive to the contact point (just behind the ball on the shot line).
    // Far away we aim at a point further behind the ball so the approach curves onto the shot line;
    // that offset fades out as the intercept time approaches.
    const contact = _v.copy(ic.point);
    contact.y = 0;
    const distToContact = car.pos.distanceTo(_v2.set(contact.x, car.pos.y, contact.z));
    const fade = clamp((tLeft - 0.35) / 0.8, 0, 1);
    let behind = clamp(distToContact * 0.3, 0, 800) * fade;
    const aim = _v2.copy(contact).addScaledVector(ic.dir, -behind);
    // never aim at a point behind us when the contact point is in front (e.g. ball coming at us)
    const localAim = toLocal(car, _v3.copy(aim).sub(car.pos), _local);
    const localContact = toLocal(car, _v3.copy(contact).sub(car.pos), _local);
    if (localAim.z < 0 && localContact.z > 0) {
      aim.copy(contact);
      behind = 0;
    }
    // arrive on time: if we're going to get there early, ease off (never when it's a save under pressure)
    const arriveIn = Math.max(0.05, tLeft);
    const tNow = timeToPoint(car, contact, sk.useBoost);
    const opts = { speed: CAR.MAX_SPEED * sk.speedFactor, allowFlip: distToContact > 2200 };
    const overtaking = false;

    // We must arrive travelling along the shot line. If we're approaching from the wrong angle and
    // we're close, slow down so the car can actually curve onto the line instead of flying past.
    const velDir = _v3.copy(car.vel);
    if (!overtaking && velDir.lengthSq() > 100) {
      velDir.y = 0;
      velDir.normalize();
      const misalign = Math.acos(clamp(velDir.dot(ic.dir), -1, 1));
      if (distToContact < 1800 && misalign > 0.35) {
        opts.speed = Math.min(opts.speed, clamp(2300 - (misalign - 0.35) * 1500, 800, 2300) * (distToContact / 1800 + 0.5));
      }
    }
    if (overtaking) {
      // no timing games while overtaking
    } else if (ic.mode !== 'ground') {
      // jump shots need exact timing: arrive at the contact point exactly when the ball does
      if (tNow < arriveIn) opts.arriveIn = arriveIn;
      opts.allowFlip = false;
    } else if (tNow < arriveIn - 0.6) opts.arriveIn = arriveIn - 0.25;
    driveTo(this, aim, opts);
    if (overtaking) return;

    // Decide the finishing move -----------------------------------------
    const ballRel = _v.copy(ball.pos).sub(car.pos);
    const ballDist = ballRel.length();
    const localBall = toLocal(car, ballRel, _local);
    const facingBall = Math.abs(Math.atan2(localBall.x, localBall.z)) < 0.6;
    if (!facingBall || !car.onGround) return;

    const contactH = ic.pos.y;
    const needH = contactH - 115; // car origin height so the roof/nose meets the ball
    // where will we be (horizontally) when the ball arrives, if we leave the ground now?
    const futureX = car.pos.x + car.vel.x * tLeft;
    const futureZ = car.pos.z + car.vel.z * tLeft;
    const horizMiss = Math.hypot(futureX - ic.pos.x, futureZ - ic.pos.z);

    if (needH > 25) {
      const rt = riseTime(needH);
      if (!rt) return; // can't reach it from the ground; re-plan next think
      const heading = car.getForward(_v2).setY(0).normalize();
      const aligned = heading.dot(ic.dir) > 0.55;
      if (tLeft <= rt.t + 0.02 && tLeft >= rt.t - 0.1 && horizMiss < 260 && aligned) {
        this.startManeuver('jumpshot', { double: rt.double, intercept: ic });
      }
      return;
    }
    // low ball: flip into it for power, otherwise just drive through
    const closing = Math.max(0, car.vel.dot(ballRel.normalize()) - ball.vel.dot(ballRel));
    const timeToBall = closing > 50 ? ballDist / closing : 9;
    if (ballDist < 450 && timeToBall < 0.3 && Math.random() < sk.dodgeShots) {
      const speedDiff = CAR.MAX_SPEED - car.speed;
      if (speedDiff > 150 || ball.vel.length() > 500) {
        this.startManeuver('dodge', { dir: _v2.copy(ic.dir).normalize(), toBall: true });
      }
    }
  }

  actShadow() {
    const car = this.car;
    const ball = this.game.ball;
    const sk = this.skill;
    const atk = this.attackSign;
    // stay between the ball and our goal, ~ 1000-1800 uu from the ball, facing it
    const ownGoal = this.ownGoalPos(_v);
    const b = this.groundBallPoint(0.6);
    const dir = _v2.copy(ownGoal).sub(b);
    const d = dir.length();
    dir.normalize();
    const shadowDist = clamp(d * 0.45, 900, 1900);
    this.target.copy(b).addScaledVector(dir, shadowDist);
    this.target.x = clamp(this.target.x, -3800, 3800);
    this.target.z = clamp(this.target.z, -4900, 4900);
    const dist = car.pos.distanceTo(this.target);
    // match the ball's speed toward our goal so we keep the gap
    const ballSpeedToGoal = Math.max(0, ball.vel.dot(dir));
    const speed = dist > 700 ? CAR.MAX_SPEED * sk.speedFactor : clamp(ballSpeedToGoal + 300, 400, 1400);
    driveTo(this, this.target, { speed, allowBoost: dist > 1500, allowFlip: false });
    // if the ball is coming at us slowly and close, go for it
    if (ball.pos.distanceTo(car.pos) < 800 && ball.pos.y < 200) this.thinkTimer = 0;
  }

  actDefend() {
    const car = this.car;
    const ball = this.game.ball;
    const sk = this.skill;
    const atk = this.attackSign;
    const goal = this.ownGoalPos(_v);
    // sit in front of the net, slightly toward the ball's side, facing the ball
    const x = clamp(ball.pos.x * 0.35, -650, 650);
    const z = goal.z + atk * 550;
    this.target.set(x, 0, z);
    const dist = car.pos.distanceTo(this.target);
    if (dist < 220) {
      // face the ball
      const rel = _v2.copy(ball.pos).sub(car.pos);
      const local = toLocal(car, rel, _local);
      const ang = Math.atan2(local.x, local.z);
      const c = car.controls;
      c.throttle = Math.abs(ang) > 0.3 ? (Math.abs(ang) > 2.2 ? -0.5 : 0.35) : 0;
      c.steer = Math.abs(ang) > 0.1 ? Math.sign(ang) * (Math.abs(ang) > 2.2 ? -1 : 1) : 0;
      c.boost = false;
      c.handbrake = false;
      c.jump = false;
      return;
    }
    driveTo(this, this.target, { speed: CAR.MAX_SPEED * sk.speedFactor, allowBoost: dist > 2500, allowFlip: dist > 2500 });
  }

  actSupport() {
    const car = this.car;
    const ball = this.game.ball;
    const sk = this.skill;
    const atk = this.attackSign;
    // Second-man position: between ball and own goal, further back than shadow, offset to the open side
    const goal = this.ownGoalPos(_v);
    const b = this.groundBallPoint(0.8);
    const dir = _v2.copy(goal).sub(b);
    const d = dir.length();
    dir.normalize();
    this.target.copy(b).addScaledVector(dir, clamp(d * 0.55, 2000, 3200));
    // offset toward the side the ball is NOT on, so we can cut off passes
    this.target.x += (ball.pos.x > 0 ? -1 : 1) * 700;
    this.target.x = clamp(this.target.x, -3500, 3500);
    this.target.z = clamp(this.target.z, -4800, 4800);
    const dist = car.pos.distanceTo(this.target);
    // grab small pads en route when low
    if (car.boost < 60) {
      const pad = this.nearestPadOnPath(this.target, 500);
      if (pad) this.target.set(pad.x, 0, pad.z);
    }
    const speed = dist > 1200 ? CAR.MAX_SPEED * sk.speedFactor : 900;
    driveTo(this, this.target, { speed, allowBoost: dist > 2500 && car.boost > 50, allowFlip: dist > 2500 });
  }

  nearestPadOnPath(target, maxOff) {
    const car = this.car;
    const dir = _v.copy(target).sub(car.pos);
    const len = dir.length();
    if (len < 100) return null;
    dir.multiplyScalar(1 / len);
    let best = null;
    let bestAlong = Infinity;
    for (const p of this.game.pads) {
      if (!p.active) continue;
      const rx = p.x - car.pos.x;
      const rz = p.z - car.pos.z;
      const along = rx * dir.x + rz * dir.z;
      if (along < 200 || along > len) continue;
      const off = Math.abs(rx * dir.z - rz * dir.x);
      if (off < maxOff && along < bestAlong) {
        bestAlong = along;
        best = p;
      }
    }
    return best;
  }

  groundBallPoint(t) {
    const p = this.samplePrediction(t);
    const out = new THREE.Vector3();
    if (p) out.copy(p.pos);
    else out.copy(this.game.ball.pos);
    out.y = 0;
    return out;
  }

  samplePrediction(t) {
    const pred = this.game.prediction;
    if (!pred.length) return null;
    const dtp = pred.length > 1 ? pred[1].t - pred[0].t : 1 / 30;
    const f = Math.max(0, (t + this.game.predictionAge) / dtp);
    const i0 = Math.min(pred.length - 1, Math.floor(f));
    const i1 = Math.min(pred.length - 1, i0 + 1);
    const a = f - i0;
    if (i0 === i1 || a < 1e-4) return pred[i0];
    // linear interpolation between samples (reused scratch object)
    const out = this._sample || (this._sample = { t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    out.t = pred[i0].t + a * dtp;
    out.pos.lerpVectors(pred[i0].pos, pred[i1].pos, a);
    out.vel.lerpVectors(pred[i0].vel, pred[i1].vel, a);
    return out;
  }

  // -------------------------------------------------------------------------
  // Kickoff
  // -------------------------------------------------------------------------
  doKickoff(dt) {
    const car = this.car;
    const ball = this.game.ball;
    const sk = this.skill;
    const c = car.controls;
    if (this.kickoffRole === 'stay') {
      // back player: grab the corner boost? No — stay in goal, but idle
      c.throttle = 0;
      c.boost = false;
      return;
    }
    if (this.kickoffRole === 'cheat') {
      // move up slowly to the side pad, ready for a follow-up
      const side = car.pos.x >= 0 ? 1 : -1;
      this.target.set(side * 1800, 0, -this.attackSign * 1600);
      driveTo(this, this.target, { speed: 900, allowBoost: false, allowFlip: false });
      return;
    }
    // Go: drive at the ball, boosting, front flip into it at the end
    const plan = this.kickoffPlan || { side: 1, offset: 40, dodgeLead: 0.12, delay: 0, diagonalFlip: false };
    this.kickoffTimer += dt;
    if (this.kickoffTimer < plan.delay) {
      c.throttle = 0;
      c.boost = false;
      return;
    }
    const dist = car.pos.distanceTo(ball.pos);
    // aim slightly off-centre: hitting the ball on one side steers the 50/50 and avoids a straight pop-up
    const toBall = _v2.copy(ball.pos).sub(car.pos).setY(0).normalize();
    const sideDir = _v3.set(toBall.z, 0, -toBall.x);
    const aim = _v.copy(ball.pos).addScaledVector(sideDir, plan.side * plan.offset * clamp(dist / 1500, 0.3, 1));
    aim.y = 0;
    driveTo(this, aim, { speed: CAR.MAX_SPEED, allowBoost: true, allowFlip: false, allowHandbrake: false });
    c.boost = car.boost > 0;
    // speed flip at the start of the run (skilled bots); do it early so the boost is still there
    if (sk.speedFlips && dist > 2600 && car.speed > 500 && car.speed < 1300 && car.onGround && !this._kickoffFlipped) {
      this._kickoffFlipped = true;
      this.startManeuver('frontflip', { keepBoost: true, cancel: true });
      return;
    }
    // second flip for the long (far back) spawn once boost is out
    if (sk.speedFlips && dist > 2200 && car.boost <= 0 && car.speed > 1200 && car.speed < 2000 && car.onGround && this._kickoffFlipped && !this._kickoffFlipped2) {
      this._kickoffFlipped2 = true;
      this.startManeuver('frontflip', { keepBoost: false, cancel: true });
      return;
    }
    // dodge into the ball: jump early enough that the flip lands on the ball (contact ~0.1-0.2 s after the jump)
    const closing = Math.max(300, car.vel.dot(toBall));
    const tContact = (dist - this.ballRadius - 60) / closing;
    if (tContact < 0.22 + plan.dodgeLead && car.onGround) {
      this._kickoffFlipped = false;
      this._kickoffFlipped2 = false;
      const dir = _v2.copy(ball.pos).sub(car.pos);
      dir.y = 0;
      dir.normalize();
      if (plan.diagonalFlip) dir.addScaledVector(sideDir, -plan.side * 0.55).normalize();
      this.startManeuver('dodge', { dir, toBall: true });
    }
  }

  // -------------------------------------------------------------------------
  // Recovery (airborne, no maneuver)
  // -------------------------------------------------------------------------
  recover() {
    const car = this.car;
    const c = car.controls;
    const vel = car.vel;
    // land on wheels pointing along velocity
    const fwd = _v.copy(vel);
    fwd.y = 0;
    if (fwd.lengthSq() < 100) car.getForward(fwd).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    // if we're going to land on a wall, align to it: crude check by proximity
    const up = UP;
    aimAir(car, fwd, up);
    c.throttle = 1;
    c.jump = false;
    c.handbrake = false;
    // boost down to land quicker? no. But do a wavedash-like flip if we still have one and are low & fast
    c.boost = false;
    if (car.hasFlip && !car.hasJumped && car.pos.y < 60 && vel.y < -200 && car.up.y > 0.9) {
      // wavedash: flip forward just before landing to keep momentum
      const ff = car.getForward(_v2);
      if (ff.dot(fwd) > 0.8) this.startManeuver('dodge', { dir: fwd.clone(), noJump: true });
    }
  }

  // -------------------------------------------------------------------------
  // Maneuvers
  // -------------------------------------------------------------------------
  startManeuver(type, params = {}) {
    this.maneuver = { type, t: 0, params, phase: 0 };
    // clear any drive inputs
    const c = this.car.controls;
    c.handbrake = false;
  }

  updateManeuver(dt) {
    const m = this.maneuver;
    const car = this.car;
    const c = car.controls;
    m.t += dt;
    switch (m.type) {
      case 'frontflip':
        return this.doDodge(m, dt, { forward: true });
      case 'dodge':
        return this.doDodge(m, dt, {});
      case 'jumpshot':
        return this.doJumpShot(m, dt);
      case 'aerial':
        return this.doAerial(m, dt);
      case 'halfflip':
        return this.doHalfFlip(m, dt);
      default:
        return false;
    }
  }

  /** Jump (unless noJump), then dodge in world direction params.dir (or straight forward). */
  doDodge(m, dt, { forward }) {
    const car = this.car;
    const c = car.controls;
    const p = m.params;
    const ball = this.game.ball;
    c.throttle = 1;
    c.steer = 0;
    c.boost = p.keepBoost ? car.boost > 0 && car.up.y > 0.5 && car.forward.y > -0.4 : false;
    c.handbrake = false;
    c.roll = 0;
    if (p.wallHop) {
      // single jump off the wall, then air-recover to land on wheels
      c.jump = m.t < 0.05;
      if (m.t > 0.1) {
        const fwd = _v.copy(car.vel).setY(0);
        if (fwd.lengthSq() < 100) car.getForward(fwd).setY(0);
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
        aimAir(car, fwd.normalize(), UP);
        c.boost = false;
      }
      if (m.t > 0.3 && car.onGround) return false;
      return m.t < 2.5;
    }
    const noJump = p.noJump;
    const flipAt = noJump ? 0 : 0.11;
    if (!noJump && m.t < 0.05) {
      c.jump = true; // first jump
      c.pitch = 0;
      c.yaw = 0;
      return true;
    }
    if (m.t < flipAt) {
      c.jump = false;
      return true;
    }
    if (m.phase === 0) {
      // dodge now
      let dir;
      if (p.toBall && ball) {
        dir = _v.copy(ball.pos).sub(car.pos);
        dir.y = 0;
        // blend with intended shot direction
        if (p.dir) dir.normalize().add(_v2.copy(p.dir).multiplyScalar(0.6));
      } else if (p.dir) dir = _v.copy(p.dir);
      else dir = car.getForward(_v);
      dir.y = 0;
      dir.normalize();
      const local = toLocal(car, dir, _local);
      const ang = Math.atan2(local.x, local.z);
      if (forward) {
        c.pitch = -1;
        c.yaw = 0;
      } else {
        c.pitch = -Math.cos(ang); // forward component => nose down
        c.yaw = Math.sin(ang);
      }
      c.jump = true;
      m.phase = 1;
      m.flipTime = m.t;
      return true;
    }
    c.jump = false;
    // speed flip: cancel the front flip right after it starts so the nose stays level and boost keeps working
    if (forward && p.cancel && !car.onGround) {
      if (car.flipping && !car.flipCancelled) c.pitch = 1;
      else {
        // level out for the landing
        const fwd = _v2.copy(car.vel).setY(0);
        if (fwd.lengthSq() < 100) car.getForward(fwd).setY(0);
        aimAir(car, fwd.normalize(), UP);
      }
      c.boost = car.boost > 0 && car.forward.y > -0.35 && car.up.y > 0.3;
    }
    if (!car.hasFlip && !car.flipping && car.onGround && m.t > m.flipTime + 0.2) return false; // landed
    if (car.onGround && m.t > m.flipTime + 0.3) return false;
    if (m.t > m.flipTime + 1.6) return false;
    // during flip: keep boosting if allowed once nose is roughly level and we're going forward
    if (!car.flipping && !car.onGround) {
      // recover orientation after the flip
      const fwd = _v.copy(car.vel);
      fwd.y = 0;
      if (fwd.lengthSq() < 100) car.getForward(fwd).setY(0);
      fwd.normalize();
      aimAir(car, fwd, UP);
      c.boost = p.keepBoost && car.boost > 0 && car.up.y > 0.7;
    } else {
      c.pitch = 0;
      c.yaw = 0;
      c.roll = 0;
    }
    return true;
  }

  /** Jump (optionally double jump) and dodge into the ball when it arrives. */
  doJumpShot(m, dt) {
    const car = this.car;
    const c = car.controls;
    const ball = this.game.ball;
    const p = m.params;
    const ic = p.intercept;
    c.throttle = 1;
    c.steer = 0;
    c.handbrake = false;
    c.boost = false;
    c.roll = 0;
    const rel = _v.copy(ball.pos).sub(car.pos);
    const dist = rel.length();
    const local = toLocal(car, rel, _local);
    const tLeft = ic ? ic.time - this.game.time : 9;
    if (m.phase === 0) {
      c.jump = m.t < 0.2; // hold for height
      c.pitch = 0;
      c.yaw = 0;
      if (p.double && m.t >= 0.25) {
        c.jump = true; // second jump (no direction => pure double jump)
        m.phase = 2;
        return true;
      }
      if (!p.double && m.t >= 0.21) m.phase = 2;
      return true;
    }
    if (m.phase === 2) {
      c.jump = false;
      // keep the nose pointed at the ball while we rise
      aimAir(car, _v2.copy(rel).normalize(), UP);
      const closeEnough = dist < 240 || (Math.abs(local.y) < 70 && dist < 320);
      if (car.hasFlip && (closeEnough || (tLeft < 0.06 && dist < 400))) {
        m.phase = 1;
        return true;
      }
      if (car.onGround && m.t > 0.4) return false;
      if (m.t > 1.6) return false;
      return true;
    }
    if (m.phase === 1) {
      // dodge toward the ball (flattened): adds power and pushes the ball where the nose points
      const ang = Math.atan2(local.x, local.z);
      c.pitch = -Math.cos(ang);
      c.yaw = Math.sin(ang);
      c.jump = true;
      m.phase = 3;
      m.flipAt = m.t;
      return true;
    }
    c.jump = false;
    if (car.onGround && m.t > m.flipAt + 0.25) return false;
    if (m.t > m.flipAt + 1.5) return false;
    if (!car.flipping) {
      const fwd = _v2.copy(car.vel).setY(0);
      if (fwd.lengthSq() < 100) car.getForward(fwd).setY(0);
      aimAir(car, fwd.normalize(), UP);
    }
    return true;
  }

  /** Full aerial: jump, orient toward the required acceleration and boost. */
  doAerial(m, dt) {
    const car = this.car;
    const c = car.controls;
    const ic = m.params.intercept;
    const ball = this.game.ball;
    const tLeft = ic.time - this.game.time;
    c.throttle = 0;
    c.steer = 0;
    c.handbrake = false;

    // refresh the target from the current prediction
    const p = this.samplePrediction(Math.max(0, tLeft));
    if (p && p.pos.distanceTo(ic.pos) < 600) {
      ic.pos.copy(p.pos);
    } else if (p) {
      // ball got hit elsewhere, bail out
      return this.aerialAbort(m);
    }
    const contact = _v.copy(ic.pos).addScaledVector(ic.dir, -(this.ballRadius + 25));

    // phase 0: jump & hold; phase 1: flight
    if (m.phase === 0) {
      c.jump = m.t < 0.2;
      // pitch up while holding the jump
      c.pitch = 0.7;
      c.yaw = 0;
      c.roll = 0;
      c.boost = m.t > 0.08 && car.boost > 0;
      if (m.t >= 0.2) {
        m.phase = 1;
        m.doubleJumpDone = false;
      }
      return true;
    }
    if (tLeft < -0.3 || car.onGround && m.t > 0.5) return false;
    if (car.boost <= 0 && car.pos.y < 200) return false;

    const req = aerialRequirement(car, contact, Math.max(0.05, tLeft), _acc);
    const mag = req.length();
    // second jump for extra lift early in the aerial (if the requirement is mostly upward)
    if (!m.doubleJumpDone && car.hasFlip && m.t < 0.55 && req.y > 300 && mag > 500) {
      c.jump = true;
      c.pitch = 0;
      c.yaw = 0;
      m.doubleJumpDone = true;
      return true;
    }
    c.jump = false;
    // Point the nose along the required acceleration and feather the boost. In the final moments
    // (when we're on course) point at the ball so the hit is clean.
    // Two modes with hysteresis: "correct" (nose along required acceleration, boost when aligned)
    // and "hit" (on course: nose at the predicted contact so the touch is clean).
    if (m.hitMode && mag > 140) m.hitMode = false;
    if (!m.hitMode && mag < 50) m.hitMode = true;
    const dir = _v2.copy(req).normalize();
    if (m.hitMode || (tLeft < 0.3 && mag < 400)) dir.copy(ic.pos).sub(car.pos).normalize();
    aimAir(car, dir, UP);
    const fwd = car.getForward(_v3);
    const align = fwd.dot(_v2.copy(req).normalize());
    c.boost = !m.hitMode && align > 0.75 && mag > 60 && car.boost > 0;
    // tiny corrections with the air throttle
    c.throttle = align > 0.5 && mag > 20 && !c.boost ? 1 : 0;
    // finishing: dodge into the ball when very close
    const rel = _v3.copy(ball.pos).sub(car.pos);
    const dist = rel.length();
    if (dist < 220 && car.hasFlip && tLeft < 0.2) {
      const local = toLocal(car, rel, _local);
      const ang = Math.atan2(local.x, local.z);
      c.pitch = -Math.cos(ang);
      c.yaw = Math.sin(ang);
      c.jump = true;
      m.type = 'dodge';
      m.phase = 3;
      m.flipTime = m.t;
      m.params = {};
      return true;
    }
    if (mag > 1400 && tLeft > 0.3) return this.aerialAbort(m);
    return true;
  }

  aerialAbort(m) {
    // fall back to recovery
    this.maneuver = null;
    this.intercept = null;
    this.thinkTimer = 0;
    return false;
  }

  doHalfFlip(m, dt) {
    const car = this.car;
    const c = car.controls;
    c.throttle = 1;
    c.boost = false;
    if (m.t < 0.05) {
      c.jump = true;
      return true;
    }
    if (m.t < 0.12) {
      c.jump = false;
      return true;
    }
    if (m.phase === 0) {
      c.jump = true;
      c.pitch = 1; // backflip
      c.yaw = 0;
      m.phase = 1;
      return true;
    }
    c.jump = false;
    if (m.t < 0.55) {
      c.pitch = 1;
      return true;
    }
    // cancel & roll
    c.pitch = -1;
    c.roll = 1;
    if (car.onGround || m.t > 1.6) return false;
    return true;
  }
}

export { lerp, GRAVITY };
