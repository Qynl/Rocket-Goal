import * as THREE from 'three';
import { Ball } from './physics/ball.js';
import { Car } from './physics/car.js';
import { collideCarBall, collideCarCar } from './physics/collision.js';
import { ARENA, BALL, BOOST_PADS, BOOST_PAD, KICKOFF_SPAWNS, PHYSICS_DT, TEAM, CAR } from './constants.js';
import { Bot, SKILLS } from './bot/bot.js';
import { clamp, rand } from './math.js';
import { createDrill } from './training.js';
import { resolve as resolveMutators, describe as describeMutators } from './mutators.js';
import { Rumble } from './rumble.js';
import { botSpec } from './cars.js';

const KICKOFF_COUNTDOWN = 3;
const GOAL_PAUSE = 3.5;
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();

/**
 * Game / match state. Purely simulation — no rendering. The renderer reads
 * from this and the UI subscribes to `events`.
 */
// Rocket League point values for the in-match score
export const STAT_POINTS = {
  goal: 100,
  assist: 50,
  save: 50,
  epicSave: 75,
  shot: 10,
  clear: 20,
  firstTouch: 10,
  demo: 25,
  aerialGoal: 20,
  longGoal: 20,
  overtimeGoal: 50,
  kickoffGoal: 30,
  mvp: 0,
};
export const STAT_LABELS = {
  goal: 'GOAL',
  assist: 'ASSIST',
  save: 'SAVE',
  epicSave: 'EPIC SAVE',
  shot: 'SHOT ON GOAL',
  clear: 'CLEAR BALL',
  firstTouch: 'FIRST TOUCH',
  demo: 'DEMOLITION',
  aerialGoal: 'AERIAL GOAL',
  longGoal: 'LONG GOAL',
  overtimeGoal: 'OVERTIME GOAL',
  kickoffGoal: 'KICKOFF GOAL',
  mvp: 'MVP',
};

export class Game {
  constructor(config) {
    this.config = config;
    // Mutators (RL-style rule modifiers) drive the ball, boost, respawn and demo rules.
    this.mutators = resolveMutators(config.mutators || {});
    this.mutatorSummary = describeMutators(config.mutators || {});
    this.ball = new Ball(this.mutators.ball);
    this.cars = [];
    this.bots = [];
    this.human = null;
    this.pads = BOOST_PADS.map((p) => ({ ...p, timer: 0, active: true }));
    this.score = [0, 0];
    this.time = 0; // total simulated seconds
    const dur = config.duration ?? this.mutators.duration ?? 300;
    this.clock = dur > 0 ? dur : Infinity; // match seconds remaining (0 => unlimited)
    this.overtime = false;
    this.state = 'countdown';
    this.stateTimer = KICKOFF_COUNTDOWN;
    this.paused = false;
    this.accumulator = 0;
    this.listeners = new Map();
    this.prediction = [];
    this.predictionAge = 1;
    this.lastGoal = null;
    this.timeScale = 1;
    this.frame = 0;
    this.unlimitedBoost = !!this.mutators.boost.unlimited;
    this.noBoost = !!this.mutators.boost.none;
    this.maxScore = this.mutators.maxScore;
    this.demoMode = this.mutators.demoMode;
    this.respawnTime = this.mutators.respawnTime;
    this.overtimeLimit = this.mutators.overtime;
    this.overtimeStart = null;
    this.rumble = null;
    this.touchLog = [];
    this.matchStats = { possession: [0, 0], shots: [0, 0], saves: [0, 0], demos: [0, 0], humanBehindBall: 0, humanTime: 0, humanOwnHalf: 0 };
    this.drill = null;
    // rolling replay buffer (last ~6 s at 30 fps) for goal replays
    this.replayFrames = [];
    this.replay = null; // { frames, t, duration } while a replay plays
    this.replayDelay = 0;

    this.setupTeams();
    // Rumble: power-ups for everyone, boost is free (mutators already unlocked it)
    if (this.mutators.rumble !== 'none' && config.mode !== 'drill') {
      this.rumble = new Rumble(this, this.mutators.rumbleCooldown);
    }
    if (config.mode === 'drill') {
      this.drill = createDrill(config.drill, this);
      this.state = 'play';
      this.stateTimer = 0;
      this.clock = Infinity;
      this.drill.start();
    } else if (config.mode === 'freeplay') {
      this.state = 'play';
      this.clock = Infinity;
      this.human.setPose(0, -4000, 0, 100);
      this.ball.reset();
    } else {
      this.setupKickoff();
    }
  }

  /** Push the resolved mutator numbers onto every car. */
  applyCarTuning() {
    for (const c of this.cars) {
      c.boostAccel = this.mutators.boost.accel;
      c.maxSpeed = this.mutators.boost.maxSpeed;
      c.boostRecharge = this.mutators.boost.recharge;
      if (this.unlimitedBoost) c.boost = 100;
      if (this.noBoost) c.boost = 0;
    }
  }

  /** Fire the Rumble power-up a car is holding (no-op when Rumble is off). */
  useItem(car) {
    if (!this.rumble || !car || car.demolished) return null;
    return this.rumble.use(car);
  }

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, []);
    this.listeners.get(evt).push(fn);
  }
  emit(evt, data) {
    const l = this.listeners.get(evt);
    if (l) for (const fn of l) fn(data);
  }

  setupTeams() {
    const cfg = this.config;
    const size = cfg.mode === 'freeplay' ? 1 : cfg.teamSize ?? 1;
    const humanTeam = cfg.humanTeam ?? TEAM.BLUE;
    const skill = SKILLS[cfg.difficulty] || SKILLS.allstar;
    const names = {
      0: ['Nova', 'Zephyr', 'Bolt', 'Ion', 'Vex'],
      1: ['Ember', 'Rogue', 'Titan', 'Flare', 'Onyx'],
    };
    for (let team = 0; team < 2; team++) {
      const count = cfg.mode === 'freeplay' && team !== humanTeam ? 0 : size;
      for (let i = 0; i < count; i++) {
        if (team === humanTeam && i === 0) {
          const car = new Car(team, cfg.playerName || 'You', false, { primary: team === 0 ? 0x2a6cff : 0xff8a1f, ...(cfg.loadout || cfg.carSpec || {}) });
          this.human = car;
          this.cars.push(car);
        } else {
          const car = new Car(team, names[team][i % 5], true, botSpec(team, i));
          this.cars.push(car);
          const bot = new Bot(car, this, skill, team === humanTeam ? cfg.teammateSkill || skill : skill);
          this.bots.push(bot);
        }
      }
    }
    this.applyCarTuning();
    if (cfg.mode === 'drill' && cfg.drillBots === false) {
      // drills without bots
      this.bots.length = 0;
      this.cars = this.cars.filter((c) => !c.isBot);
    }
  }

  setupKickoff() {
    this.ball.reset();
    this.ball.frozen = true;
    const spawnsUsed = [];
    const byTeam = [[], []];
    for (const c of this.cars) byTeam[c.team].push(c);
    // random spawn assignment (as RL does), same slot indices for both teams
    const size = Math.max(byTeam[0].length, byTeam[1].length);
    const order = kickoffSlots(size);
    for (let team = 0; team < 2; team++) {
      const sgn = team === TEAM.BLUE ? 1 : -1;
      byTeam[team].forEach((car, i) => {
        const s = KICKOFF_SPAWNS[order[i]];
        // Mirror for orange: negate x and z, yaw + PI
        const x = sgn === 1 ? s.x : -s.x;
        const z = sgn === 1 ? s.z : -s.z;
        const yaw = sgn === 1 ? s.yaw : s.yaw + Math.PI;
        car.setPose(x, z, yaw, this.unlimitedBoost ? 100 : 33);
        spawnsUsed.push(order[i]);
      });
    }
    for (const p of this.pads) {
      p.active = true;
      p.timer = 0;
    }
    for (const b of this.bots) b.onKickoff();
    this.kickoffPending = true;
    this.kickoffTime = this.time + KICKOFF_COUNTDOWN;
    this.state = 'countdown';
    this.stateTimer = KICKOFF_COUNTDOWN;
    this.emit('kickoff', { countdown: KICKOFF_COUNTDOWN });
  }

  /** Advance the simulation by real seconds `dt` (uses fixed physics steps). */
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.1) * this.timeScale;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 16) {
      this.fixedStep(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
  }

  fixedStep(dt) {
    this.frame++;
    this.time += dt;

    // --- state machine ---
    if (this.state === 'countdown') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'play';
        this.ball.frozen = false;
        this.emit('go');
      }
    } else if (this.state === 'goal') {
      this.stateTimer -= dt;
      if (this.replayDelay > 0) {
        this.replayDelay -= dt;
        if (this.replayDelay <= 0 && this.config.replays !== false) {
          this.startReplay();
          if (this.replay) this.emit('replayStart');
        }
      }
      if (this.replay) {
        this.replay.t += dt * this.replay.speed;
        if (this.replay.t >= this.replay.duration) this.replay = null;
      }
      if (this.stateTimer <= 0 && !this.replay) {
        if ((this.overtime && this.lastGoal) || (this.maxScore && Math.max(...this.score) >= this.maxScore)) {
          this.endMatch();
        } else if (this.clock <= 0) {
          this.endMatch();
        } else {
          this.setupKickoff();
        }
      }
    } else if (this.state === 'play') {
      if (this.clock !== Infinity) {
        if (this.overtime) {
          this.clock += dt;
          // overtime can be capped by a mutator (5 / 10 minutes)
          if (this.overtimeLimit !== 'unlimited' && this.overtimeLimit !== 'none') {
            if (this.overtimeStart === null) this.overtimeStart = this.time;
            if (this.time - this.overtimeStart > this.overtimeLimit && this.ball.onGround) this.endMatch();
          }
        } else this.clock = Math.max(0, this.clock - dt);
        if (this.clock <= 0 && !this.overtime && this.ball.onGround) {
          this.zeroSecondEnd();
        }
      }
    }

    // replay recording
    if (this.state === 'play' && !this.drill && this.frame % 4 === 0) this.recordReplayFrame();

    // ball prediction (shared by bots and HUD), refresh every 4 physics frames
    this.predictionAge += dt;
    if (this.frame % 4 === 0 || this.predictionDirty) {
      this.prediction = this.ball.predict(6, 1 / 30);
      this.predictionAge = 0;
      this.predictionDirty = false;
    }

    // --- bots think ---
    const active = this.state === 'play' || this.state === 'countdown';
    for (const b of this.bots) {
      if (this.state === 'countdown') {
        b.car.controls.throttle = 0;
        b.car.controls.boost = false;
        b.car.controls.jump = false;
        b.car.controls.steer = 0;
        continue;
      }
      b.update(dt);
    }

    // --- cars ---
    for (const c of this.cars) {
      if (this.state === 'countdown') {
        // cars are locked in place during the countdown; boost is locked too (like RL)
        c.controls.throttle = 0;
        c.controls.jump = false;
        c.controls.boost = false;
        c.vel.set(0, 0, 0);
      }
      if (c.demolished) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) this.respawn(c);
        continue;
      }
      if (this.unlimitedBoost) c.boost = CAR.MAX_BOOST;
      else if (this.noBoost) c.boost = 0;
      c.step(dt);
      // unlimited boost: top the tank back up after the step burned some
      if (this.unlimitedBoost) c.boost = CAR.MAX_BOOST;
    }

    // --- rumble power-ups (before collisions so their effects resolve this tick) ---
    if (this.rumble) this.rumble.update(dt);

    // --- ball ---
    this.ball.step(dt);
    if (this.ball.bounceImpact > 200) this.emit('ballBounce', { speed: this.ball.bounceImpact });

    // --- collisions ---
    for (const c of this.cars) {
      if (c.demolished) continue;
      if (collideCarBall(c, this.ball, this.time)) {
        this.onTouch(c);
        if (this.rumble) this.rumble.onTouch(c);
      }
    }
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const res = collideCarCar(this.cars[i], this.cars[j]);
        let demo = res;
        if (!demo && this.demoMode === 'always' && this.state === 'play') {
          // "always" demolition: any *contact* between opponents takes out the slower car
          const a = this.cars[i];
          const b = this.cars[j];
          if (a.team !== b.team) {
            a.getHitboxCenter(_ca);
            b.getHitboxCenter(_cb);
            const rr = (Math.max(a.hitbox.half.x, a.hitbox.half.z) + Math.max(b.hitbox.half.x, b.hitbox.half.z)) * 0.53;
            if (_ca.distanceToSquared(_cb) < rr * rr * 4) demo = a.speed >= b.speed ? { demolisher: a, victim: b } : { demolisher: b, victim: a };
          }
        }
        if (!demo && this.rumble) {
          // a live Haymaker demolishes whoever it catches, no supersonic needed
          const a = this.cars[i];
          const b = this.cars[j];
          if (a.speed > b.speed && this.rumble.contact(a, b)) demo = { demolisher: a, victim: b };
          else if (b.speed > a.speed && this.rumble.contact(b, a)) demo = { demolisher: b, victim: a };
        }
        if (demo) this.demolish(demo.demolisher, demo.victim);
      }
    }

    // --- boost pads ---
    this.updatePads(dt);

    // --- goals ---
    if (this.state === 'play' && !this.drill) {
      const g = this.ball.goalCheck();
      if (g >= 0) this.onGoal(g === 0 ? TEAM.ORANGE : TEAM.BLUE);
    }

    // --- drills ---
    if (this.drill) this.drill.update(dt);

    // --- stats ---
    if (this.human && this.state === 'play' && !this.human.demolished) {
      const h = this.human;
      const s = this.matchStats;
      s.humanTime += dt;
      const ownSign = h.team === TEAM.BLUE ? -1 : 1;
      if ((this.ball.pos.z - h.pos.z) * ownSign < 0) s.humanBehindBall += dt; // human is goal-side of the ball
      if (h.pos.z * ownSign > 0) s.humanOwnHalf += dt;
      if (this.ball.lastTouch) s.possession[this.ball.lastTouch.team] += dt;
    }
    if (this.human && this.ball.lastTouch && this.state === 'play') {
      // shot detection for last touch: ball heading toward enemy goal fast
      this.checkShot();
    }

    // keep ball out of the void in drills where goals are disabled
    if (this.drill && Math.abs(this.ball.pos.z) > ARENA.HALF_LENGTH + BALL.RADIUS) {
      this.drill.onBallInGoal(this.ball.pos.z > 0 ? TEAM.ORANGE : TEAM.BLUE);
    }
  }

  ballTouchedRecently(sec) {
    return this.ball.lastTouch ? this.time - this.ball.lastTouch.time < sec : false;
  }

  zeroSecondEnd() {
    if (this.score[0] === this.score[1] && this.overtimeLimit !== 'none') {
      this.overtime = true;
      this.clock = 0;
      this.emit('overtime');
      this.setupKickoff();
    } else {
      this.endMatch();
    }
  }

  endMatch() {
    this.state = 'ended';
    this.ball.frozen = true;
    this.emit('ended', { score: this.score, stats: this.collectStats() });
  }

  onTouch(car) {
    car.stats.touches++;
    if (car.pos.y > 300) car.stats.aerialTouches++;
    this.predictionDirty = true;
    const wasKickoff = this.kickoffPending;
    this.kickoffPending = false;
    this.touchLog.push({ time: this.time, car, pos: this.ball.pos.clone(), vel: this.ball.vel.clone(), evaluated: false, kickoff: wasKickoff });
    if (this.touchLog.length > 40) this.touchLog.shift();
    this.emit('touch', { car, speed: car.vel.distanceTo(this.ball.vel) });
    if (wasKickoff && !this.drill && this.state === 'play') this.award(car, 'firstTouch');
    if (this.drill) this.drill.onTouch(car);
  }

  /** Rocket League style scoring events: award points and notify the UI. */
  award(car, kind, extra = {}) {
    const pts = STAT_POINTS[kind] || 0;
    car.stats.score += pts;
    car.stats.events = car.stats.events || {};
    car.stats.events[kind] = (car.stats.events[kind] || 0) + 1;
    this.emit('stat', { car, kind, points: pts, label: STAT_LABELS[kind] || kind, ...extra });
  }

  // Detect shots and saves from the touch log using ball prediction
  checkShot() {
    for (const t of this.touchLog) {
      if (t.evaluated) continue;
      if (this.time - t.time < 0.15) continue;
      t.evaluated = true;
      const enemyZ = t.car.team === TEAM.BLUE ? ARENA.HALF_LENGTH : -ARENA.HALF_LENGTH;
      const ownZ = -enemyZ;
      // where does the ball cross the goal planes?
      let crossesEnemy = false;
      let crossesOwn = false;
      for (const p of this.prediction) {
        if (p.t > 3.5) break;
        if (Math.sign(p.pos.z - enemyZ) === Math.sign(enemyZ) && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH + 30 && p.pos.y < ARENA.GOAL_HEIGHT + 30) {
          crossesEnemy = true;
          break;
        }
        if (Math.sign(p.pos.z - ownZ) === Math.sign(ownZ) && Math.abs(p.pos.x) < ARENA.GOAL_HALF_WIDTH + 30 && p.pos.y < ARENA.GOAL_HEIGHT + 30) {
          crossesOwn = true;
          break;
        }
      }
      let tEnemy = Infinity;
      for (const p of this.prediction) {
        if (p.t > 3.5) break;
        if (Math.sign(p.pos.z - enemyZ) === Math.sign(enemyZ)) {
          tEnemy = p.t;
          break;
        }
      }
      const prev = this.touchLog[this.touchLog.indexOf(t) - 1];
      if (crossesEnemy && this.ball.vel.length() > 600) {
        t.car.stats.shots++;
        this.matchStats.shots[t.car.team]++;
        t.wasShot = true;
        t.shotSpeed = this.ball.vel.length();
        t.shotTime = tEnemy;
        this.emit('shot', { car: t.car });
        this.award(t.car, 'shot');
      }
      // save: previous touch by an opponent was a shot, and now it no longer crosses own goal
      if (prev && prev.wasShot && prev.car.team !== t.car.team && !crossesOwn) {
        t.car.stats.saves++;
        this.matchStats.saves[t.car.team]++;
        const epic = prev.shotSpeed > 2400 || prev.shotTime - (t.time - prev.time) < 0.3;
        if (epic) t.car.stats.epicSaves++;
        this.emit('save', { car: t.car, epic });
        this.award(t.car, epic ? 'epicSave' : 'save');
        t.wasSave = true;
      } else if (!crossesOwn && !t.wasShot) {
        // clear: ball was deep in our third and is now heading up-field
        const ownSign = Math.sign(ownZ);
        const deep = t.pos.z * ownSign > ARENA.HALF_LENGTH - 2000;
        const upField = this.ball.vel.z * -ownSign > 900;
        const enemyTouchedLast = prev && prev.car.team !== t.car.team;
        if (deep && upField && enemyTouchedLast && this.time - (t.car.lastClearTime || -10) > 6) {
          t.car.lastClearTime = this.time;
          t.car.stats.clears++;
          this.award(t.car, 'clear');
        }
      }
    }
  }

  recordReplayFrame() {
    const f = {
      t: this.time,
      ball: { p: this.ball.pos.clone(), q: this.ball.quat.clone() },
      cars: this.cars.map((c) => ({ id: c.id, p: c.pos.clone(), q: c.quat.clone(), boost: c.boostActive, demo: c.demolished, wheel: c.wheelSpin, steer: c.steerVisual })),
    };
    this.replayFrames.push(f);
    while (this.replayFrames.length > 30 * 7) this.replayFrames.shift();
  }

  /** Start a slow-motion replay of the last few seconds (used after goals). */
  startReplay(seconds = 3.6, speed = 0.55) {
    if (this.replayFrames.length < 10) return null;
    const end = this.time;
    const frames = this.replayFrames.filter((f) => f.t >= end - seconds);
    if (frames.length < 5) return null;
    const t0 = frames[0].t;
    this.replay = { frames, t0, t: 0, duration: end - t0 + 0.6, speed };
    return this.replay;
  }

  /** Interpolated replay frame at the current replay time. */
  replayState() {
    const r = this.replay;
    if (!r) return null;
    const t = r.t0 + Math.min(r.t, r.duration - 0.6);
    const fr = r.frames;
    let i = 0;
    while (i < fr.length - 2 && fr[i + 1].t <= t) i++;
    const a = fr[i];
    const b = fr[Math.min(i + 1, fr.length - 1)];
    const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    return { a, b, u, progress: r.t / r.duration };
  }

  onGoal(scoringTeam) {
    this.state = 'goal';
    this.stateTimer = GOAL_PAUSE;
    this.score[scoringTeam]++;
    const lt = this.ball.lastTouch;
    let scorer = null;
    let ownGoal = false;
    if (lt) {
      scorer = lt.car;
      ownGoal = lt.team !== scoringTeam;
      if (!ownGoal) {
        scorer.stats.goals++;
        this.award(scorer, 'goal');
        const speed0 = this.ball.vel.length();
        const dist = Math.abs(scorer.pos.z - (scoringTeam === TEAM.BLUE ? ARENA.HALF_LENGTH : -ARENA.HALF_LENGTH));
        const lastTouchHeight = lt.height || 0;
        if (lastTouchHeight > 400) this.award(scorer, 'aerialGoal');
        else if (dist > 4500) this.award(scorer, 'longGoal');
        if (this.overtime) this.award(scorer, 'overtimeGoal');
        if (this.time - (this.kickoffTime || 0) < 8 && this.touchLog.filter((t) => this.time - t.time < 8).length <= 2) this.award(scorer, 'kickoffGoal');
        void speed0;
        // assist: previous touch by teammate within 6s
        const touches = this.touchLog.filter((t) => t.car !== scorer && t.car.team === scoringTeam && this.time - t.time < 6);
        if (touches.length) {
          const a = touches[touches.length - 1].car;
          a.stats.assists++;
          this.award(a, 'assist');
        }
      }
    }
    const speed = this.ball.vel.length();
    this.lastGoal = { team: scoringTeam, scorer, ownGoal, speed, time: this.time };
    this.emit('goal', this.lastGoal);
    // replay starts after a short celebration
    this.replayDelay = 1.6;
  }

  respawn(car) {
    // respawn at own side, away from the ball
    const sgn = car.team === TEAM.BLUE ? -1 : 1;
    const x = this.ball.pos.x > 0 ? -2688 : 2688;
    car.setPose(x, sgn * 4608, car.team === TEAM.BLUE ? 0 : Math.PI, this.unlimitedBoost ? 100 : 33);
    car.demolished = false;
    car.respawnTimer = 0;
    if (this.rumble) this.rumble.give(car, this.rumble.cooldown * 0.5);
  }

  demolish(demolisher, victim) {
    if (this.demoMode === 'disabled') return;
    victim.demolish(this.respawnTime);
    if (this.demoMode === 'always' && victim.respawnTimer > 0) victim.respawnTimer = this.respawnTime;
    demolisher.stats.demos++;
    victim.stats.demoed++;
    this.matchStats.demos[demolisher.team]++;
    this.emit('demo', { demolisher, victim });
    if (!this.drill) this.award(demolisher, 'demo');
  }

  updatePads(dt) {
    for (const p of this.pads) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) p.active = true;
        continue;
      }
      const r = p.big ? BOOST_PAD.BIG_RADIUS : BOOST_PAD.SMALL_RADIUS;
      const h = p.big ? BOOST_PAD.BIG_HEIGHT : BOOST_PAD.SMALL_HEIGHT;
      for (const c of this.cars) {
        if (c.demolished) continue;
        const dx = c.pos.x - p.x;
        const dz = c.pos.z - p.z;
        if (dx * dx + dz * dz < r * r && c.pos.y < h) {
          if (this.unlimitedBoost) break; // boost is free — pads stay on the floor
          if (c.boost >= CAR.MAX_BOOST && !p.big) continue; // small pads don't trigger at full boost? In RL they do. keep simple: allow
          const before = c.boost;
          c.boost = Math.min(CAR.MAX_BOOST, c.boost + (p.big ? BOOST_PAD.BIG_AMOUNT : BOOST_PAD.SMALL_AMOUNT));
          c.stats.boostCollected += c.boost - before;
          p.active = false;
          p.timer = p.big ? BOOST_PAD.BIG_RESPAWN : BOOST_PAD.SMALL_RESPAWN;
          this.emit('pad', { car: c, big: p.big });
          break;
        }
      }
    }
  }

  // ---- helpers for bots / training --------------------------------------
  teamCars(team) {
    return this.cars.filter((c) => c.team === team);
  }

  /** Reset ball & the human to a freeplay-like state. */
  resetFreeplay() {
    this.ball.reset();
    this.ball.frozen = false;
    if (this.human) this.human.setPose(0, this.human.team === TEAM.BLUE ? -4000 : 4000, this.human.team === TEAM.BLUE ? 0 : Math.PI, 100);
    this.predictionDirty = true;
  }

  collectStats() {
    const cars = this.cars.map((c) => ({
      name: c.name,
      team: c.team,
      isBot: c.isBot,
      isHuman: c === this.human,
      model: c.modelName,
      car: c.spec.car,
      ...c.stats,
      avgSpeed: c.stats.speedSamples ? c.stats.speedSum / c.stats.speedSamples : 0,
      avgBoost: c.stats.speedSamples ? c.stats.boostSum / c.stats.speedSamples : 0,
      supersonicPct: c.stats.time ? c.stats.supersonicTime / c.stats.time : 0,
      zeroBoostPct: c.stats.time ? c.stats.zeroBoostTime / c.stats.time : 0,
      fullBoostPct: c.stats.time ? c.stats.fullBoostTime / c.stats.time : 0,
      score: c.stats.score,
    }));
    return {
      score: this.score.slice(),
      cars,
      possession: this.matchStats.possession.slice(),
      shots: this.matchStats.shots.slice(),
      saves: this.matchStats.saves.slice(),
      humanBehindBallPct: this.matchStats.humanTime ? this.matchStats.humanBehindBall / this.matchStats.humanTime : 0,
      humanOwnHalfPct: this.matchStats.humanTime ? this.matchStats.humanOwnHalf / this.matchStats.humanTime : 0,
      overtime: this.overtime,
      forfeited: !!this.forfeited,
      clock: this.clock,
      mutators: this.mutatorSummary,
      arena: this.config.arena,
      rumble: this.mutators.rumble !== 'none',
    };
  }
}

function kickoffSlots(size) {
  // RL picks random spawn slots each kickoff; diagonal slots are 0/1, back-center 2/3, far back 4
  const pool = [0, 1, 2, 3, 4];
  const out = [];
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export { clamp, rand };
