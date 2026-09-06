import * as THREE from 'three';
import { CAR, GRAVITY, throttleAccel, turnCurvature, ARENA } from '../constants.js';
import { resolveSpec } from '../cars.js';
import { ALL_PLANES, nearestSurface, collideSphere } from './arena.js';
import { clamp, UP, lookQuat } from '../math.js';

const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _contacts = [];

export function defaultControls() {
  return {
    throttle: 0, // -1..1
    steer: 0, // -1..1 (positive = right)
    pitch: 0, // -1..1 (positive = nose up ... we use RL convention: +pitch = nose up? RL: pitch +1 = nose up when using stick down) -> here +1 = nose UP
    yaw: 0, // -1..1 positive = right
    roll: 0, // -1..1 positive = roll right
    jump: false,
    boost: false,
    handbrake: false,
    useItem: false, // Rumble power-up button
  };
}

let nextCarId = 1;

export class Car {
  constructor(team, name = 'Car', isBot = false, spec = null) {
    this.id = nextCarId++;
    this.team = team;
    this.name = name;
    this.isBot = isBot;
    // Garage loadout: car model (== hitbox class) + cosmetics.
    this.spec = resolveSpec(spec || {});
    this.hitbox = this.spec.hitbox;
    this.modelName = this.spec.preset.name;
    this.pos = new THREE.Vector3(0, CAR.REST_HEIGHT, 0);
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.boost = 33;
    this.controls = defaultControls();
    this.prevJump = false;

    this.onGround = false;
    this.surfaceNormal = new THREE.Vector3(0, 1, 0);
    this.hasJumped = false;
    this.hasFlip = true;
    this.jumpHoldTime = 0;
    this.jumpHolding = false;
    this.airTime = 0;
    this.flipWindow = 0; // time remaining to use flip
    this.flipping = false;
    this.flipTimer = 0;
    this.flipDir = { f: 0, s: 0 };
    this.flipCancelled = false;
    this.supersonic = false;
    this.demolished = false;
    this.respawnTimer = 0;
    this.boostActive = false;
    this.handbraking = false;
    this.wheelContact = [false, false, false, false];
    this.lastBallTouch = -Infinity;
    this.wheelSpin = 0;
    this.steerVisual = 0;
    this.suspension = 0; // visual compression (0..1), spikes on landings
    // per-step event flags consumed by audio / VFX
    this.events = { jumped: false, doubleJumped: false, dodged: false, landed: 0, wallHit: 0, flipReset: false };
    this.airRollActive = false;

    // stats
    // mutator-tunable values (see mutators.js); defaults match standard rules
    this.boostAccel = CAR.BOOST_ACCEL;
    this.maxSpeed = CAR.MAX_SPEED;
    this.boostRecharge = 0; // uu of boost regenerated per second
    this.item = null; // Rumble power-up state { id, cooldown, timer }

    this.stats = {
      boostUsed: 0,
      boostCollected: 0,
      touches: 0,
      shots: 0,
      goals: 0,
      saves: 0,
      assists: 0,
      demos: 0,
      demoed: 0,
      supersonicTime: 0,
      time: 0,
      speedSum: 0,
      speedSamples: 0,
      boostSum: 0,
      aerialTouches: 0,
      zeroBoostTime: 0,
      fullBoostTime: 0,
      score: 0,
      epicSaves: 0,
      clears: 0,
      wastedBoost: 0,
    };
  }

  get forward() {
    return _fwd.set(0, 0, 1).applyQuaternion(this.quat);
  }
  get up() {
    return _up.set(0, 1, 0).applyQuaternion(this.quat);
  }
  get right() {
    return _right.set(1, 0, 0).applyQuaternion(this.quat);
  }
  getForward(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.quat);
  }
  getUp(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }
  getRight(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }
  get speed() {
    return this.vel.length();
  }
  get forwardSpeed() {
    return this.vel.dot(this.getForward(_tmp2));
  }
  get hitboxCenter() {
    return _tmp.set(this.hitbox.offset.x, this.hitbox.offset.y, this.hitbox.offset.z).applyQuaternion(this.quat).add(this.pos);
  }
  getHitboxCenter(out = new THREE.Vector3()) {
    return out.set(this.hitbox.offset.x, this.hitbox.offset.y, this.hitbox.offset.z).applyQuaternion(this.quat).add(this.pos);
  }

  setPose(x, z, yaw, boost = 33) {
    this.pos.set(x, CAR.REST_HEIGHT, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.boost = boost;
    this.onGround = true;
    this.surfaceNormal.set(0, 1, 0);
    this.hasJumped = false;
    this.hasFlip = true;
    this.flipping = false;
    this.flipTimer = 0;
    this.flipWindow = 0;
    this.jumpHolding = false;
    this.demolished = false;
    this.respawnTimer = 0;
    this.controls = defaultControls();
    this.prevJump = false;
  }

  demolish(respawnTime = CAR.RESPAWN_TIME) {
    this.demolished = true;
    this.respawnTimer = respawnTime;
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.pos.set(0, -5000, 0); // hide
  }

  step(dt) {
    const c = this.controls;
    const s = this.stats;
    if (this.demolished) {
      this.respawnTimer -= dt;
      return;
    }
    s.time += dt;
    s.speedSum += this.speed;
    s.speedSamples++;
    s.boostSum += this.boost;
    if (this.boost <= 0) s.zeroBoostTime += dt;
    if (this.boost >= 100) s.fullBoostTime += dt;

    const jumpPressed = c.jump && !this.prevJump;
    this.prevJump = c.jump;
    const ev = this.events;
    ev.jumped = ev.doubleJumped = ev.dodged = ev.flipReset = false;
    ev.landed = 0;
    ev.wallHit = 0;
    this.airRollActive = !this.onGround && Math.abs(c.roll) > 0.1;
    this.suspension *= Math.exp(-9 * dt);

    const up = this.getUp(_up);
    const fwd = this.getForward(_fwd);

    // ---- ground detection --------------------------------------------------
    let dist = nearestSurface(this.pos, _n, up, 0.55);
    if (!isFinite(dist)) dist = nearestSurface(this.pos, _n);
    const wheelsToward = up.dot(_n);
    const vIntoSurface = -this.vel.dot(_n);
    let grounded = false;
    const tol = this.onGround ? 30 : 6;
    if (dist <= CAR.REST_HEIGHT + tol && wheelsToward > 0.55 && (this.onGround || vIntoSurface > -10)) {
      grounded = true;
      // ceilings / steep overhangs: sticky force cannot hold the car when it's slow
      const intoSurface = GRAVITY * _n.y; // >0 when gravity presses the car onto the surface
      if (intoSurface + CAR.STICKY_FORCE <= 0 && this.speed < 500) {
        grounded = false;
        // wheels touched the ceiling: that still refreshes the flip (RL "flip reset")
        if (!this.onGround && !this.hasFlip) {
          this.hasFlip = true;
          this.hasJumped = false;
          this.airTime = 0;
          ev.flipReset = true;
        }
      }
    }

    if (grounded && !this.onGround) {
      // landing
      const impact = Math.max(0, vIntoSurface);
      if (!this.hasFlip && this.airTime > 0.3) ev.flipReset = true;
      this.onLand();
      ev.landed = impact;
      this.suspension = Math.min(1, impact / 900 + 0.15);
    }
    this.onGround = grounded;

    if (grounded) {
      this.surfaceNormal.copy(_n);
      this.stepGround(dt, jumpPressed, dist);
    } else {
      this.stepAir(dt, jumpPressed);
    }

    // ---- boost -------------------------------------------------------------
    this.boostActive = false;
    if (this.boostRecharge > 0 && this.boost < CAR.MAX_BOOST) {
      this.boost = Math.min(CAR.MAX_BOOST, this.boost + this.boostRecharge * dt);
    }
    if (c.boost && this.boost > 0) {
      this.boostActive = true;
      const f = this.getForward(_fwd);
      // boost only accelerates up to max speed
      if (this.vel.dot(f) < this.maxSpeed || this.speed < this.maxSpeed) {
        this.vel.addScaledVector(f, this.boostAccel * dt);
      }
      const used = Math.min(this.boost, CAR.BOOST_CONSUMPTION * dt);
      this.boost -= used;
      s.boostUsed += used;
      if (this.speed >= this.maxSpeed - 5 && this.onGround) s.wastedBoost += used;
    }

    // ---- speed clamp -------------------------------------------------------
    const spd = this.vel.length();
    if (spd > this.maxSpeed) this.vel.multiplyScalar(this.maxSpeed / spd);
    const ws = this.angVel.length();
    const maxW = this.flipping ? CAR.FLIP_ANGULAR_SPEED + 1 : CAR.MAX_ANGULAR;
    if (ws > maxW) this.angVel.multiplyScalar(maxW / ws);
    this.supersonic = spd >= CAR.SUPERSONIC - (this.supersonic ? 100 : 0);
    if (this.supersonic) s.supersonicTime += dt;

    // ---- integrate ---------------------------------------------------------
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel.length();
    if (w > 1e-6) {
      // rotate about the hitbox centre (centre of mass), not the wheel-level origin
      const centre = this.getHitboxCenter(_tmp2);
      _q.setFromAxisAngle(_tmp.copy(this.angVel).multiplyScalar(1 / w), w * dt);
      this.quat.premultiply(_q).normalize();
      if (!this.onGround) {
        _tmp.set(this.hitbox.offset.x, this.hitbox.offset.y, this.hitbox.offset.z).applyQuaternion(this.quat);
        this.pos.copy(centre).sub(_tmp);
      }
    }

    // ---- body / arena collision -------------------------------------------
    this.collideBody(dt);

    // visual helpers
    this.wheelSpin += (this.forwardSpeed / CAR.WHEEL_RADIUS_BACK) * dt;
    this.steerVisual += (c.steer - this.steerVisual) * Math.min(1, 15 * dt);
  }

  onLand() {
    this.hasJumped = false;
    this.hasFlip = true;
    this.flipping = false;
    this.flipTimer = 0;
    this.flipWindow = 0;
    this.jumpHolding = false;
    this.airTime = 0;
  }

  stepGround(dt, jumpPressed, dist) {
    const c = this.controls;
    const n = this.surfaceNormal;
    const fwd = this.getForward(_fwd);
    // Project forward onto surface
    fwd.addScaledVector(n, -fwd.dot(n));
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    const right = _right.crossVectors(n, fwd).normalize();

    // Align orientation to surface (snappy)
    lookQuat(fwd, n, _qTarget);
    this.quat.slerp(_qTarget, Math.min(1, 25 * dt));

    // Snap height
    const err = CAR.REST_HEIGHT - dist;
    this.pos.addScaledVector(n, err * Math.min(1, 20 * dt) + (err > 0 ? err * 0.5 : 0));

    // velocity decomposition. When the surface curves (ramp segments) keep the speed:
    // the wheels follow the curve rather than slamming into it.
    const speedBefore = this.vel.length();
    let vf = this.vel.dot(fwd);
    let vs = this.vel.dot(right);
    const planar = Math.hypot(vf, vs);
    if (this._prevN && this._prevN.dot(n) < 0.9995 && planar > 1 && speedBefore > planar) {
      const k = Math.min(1.15, (speedBefore * 0.99) / planar);
      vf *= k;
      vs *= k;
    }
    this._prevN = (this._prevN || new THREE.Vector3()).copy(n);

    // throttle
    const throttle = clamp(c.throttle, -1, 1);
    const handbrake = c.handbrake;
    this.handbraking = handbrake;
    if (Math.abs(throttle) > 0.01) {
      if (vf * throttle >= 0 || Math.abs(vf) < 10) {
        vf += throttle * throttleAccel(vf) * dt;
      } else {
        // braking
        const brake = CAR.BRAKE_ACCEL * dt;
        if (Math.abs(vf) <= brake) vf = 0;
        else vf -= Math.sign(vf) * brake;
      }
    } else {
      const coast = CAR.COAST_DECEL * dt;
      if (Math.abs(vf) <= coast) vf = 0;
      else vf -= Math.sign(vf) * coast;
    }
    // reverse speed cap
    if (vf < -CAR.MAX_DRIVE_SPEED && !c.boost) vf = Math.max(vf, -CAR.MAX_DRIVE_SPEED);

    // lateral friction
    const latK = handbrake ? 3.5 : 18;
    vs *= Math.exp(-latK * dt);
    if (!handbrake && Math.abs(vs) < 5) vs = 0;
    // on walls the tyres can't hold all of gravity sideways: slow slide down the wall
    const gLat = -GRAVITY * right.y; // lateral component of gravity (positive => pulls toward +right)
    if (Math.abs(gLat) > 350) vs += (gLat - Math.sign(gLat) * 350) * dt;

    // steering -> yaw
    const steer = clamp(c.steer, -1, 1);
    const speedForTurn = Math.abs(vf);
    let curvature = turnCurvature(speedForTurn);
    if (handbrake) curvature *= 1.9;
    const yawRate = steer * curvature * vf; // +rotation about up turns the nose to the right
    // Angular velocity purely around surface normal when grounded
    this.angVel.copy(n).multiplyScalar(yawRate);

    // gravity along surface
    const g = _tmp.set(0, -GRAVITY, 0);
    const gTangent = g.addScaledVector(n, -g.dot(n));
    // rebuild velocity
    this.vel.copy(fwd).multiplyScalar(vf).addScaledVector(right, vs);
    this.vel.addScaledVector(gTangent, dt);
    // gravity along surface adds to sliding; wheels resist along-forward component slightly (engine) -> keep

    // jump
    if (jumpPressed) {
      this.vel.addScaledVector(n, CAR.JUMP_IMPULSE);
      this.pos.addScaledVector(n, 2);
      this.events.jumped = true;
      this.suspension = Math.max(this.suspension, 0.5);
      this.hasJumped = true;
      this.hasFlip = true;
      this.jumpHolding = true;
      this.jumpHoldTime = 0;
      this.airTime = 0;
      this.flipWindow = CAR.DODGE_DEADLINE + 0.2;
      this.onGround = false;
      // Preserve yaw rate
    }
  }

  stepAir(dt, jumpPressed) {
    const c = this.controls;
    this.airTime += dt;
    this.handbraking = false;

    // gravity
    this.vel.y -= GRAVITY * dt;

    const up = this.getUp(_up);
    const fwd = this.getForward(_fwd);

    // jump hold
    if (this.jumpHolding) {
      if (c.jump && this.jumpHoldTime < CAR.JUMP_MAX_HOLD) {
        this.vel.addScaledVector(up, CAR.JUMP_HOLD_ACCEL * dt);
        this.jumpHoldTime += dt;
      } else {
        this.jumpHolding = false;
      }
    }

    // flip window
    if (this.hasFlip && this.hasJumped) {
      this.flipWindow -= dt;
      if (this.flipWindow <= 0) this.hasFlip = false;
    }
    // if we never jumped (drove off an edge) we still have a flip in RL ("wavedash"/double jump)
    if (!this.hasJumped && this.airTime > 1.45) this.hasFlip = false;

    // double jump / dodge
    if (jumpPressed && this.hasFlip && !this.flipping) {
      const pitchIn = clamp(c.pitch, -1, 1);
      const yawIn = clamp(Math.abs(c.yaw) > Math.abs(c.steer) ? c.yaw : c.steer, -1, 1);
      const mag = Math.hypot(pitchIn, yawIn);
      this.hasFlip = false;
      this.jumpHolding = false;
      if (mag < 0.15) {
        // double jump
        this.vel.addScaledVector(up, CAR.DOUBLE_JUMP_IMPULSE);
        this.events.doubleJumped = true;
      } else {
        this.events.dodged = true;
        // dodge
        let f = -pitchIn / mag; // pitch up (stick back) => backflip
        let sIn = yawIn / mag;
        const vf = this.vel.dot(fwd);
        const sp = Math.abs(vf) / CAR.MAX_SPEED;
        const backward = vf > 0 ? f < 0 : f * vf < 0 && vf < -100;
        if (backward) f *= (16 / 15) * (1 + 1.5 * sp);
        sIn *= 1 + 0.9 * sp;
        // dodge is in the plane of the car's forward/right but flattened horizontally
        const fFlat = _tmp.copy(fwd);
        fFlat.y = 0;
        if (fFlat.lengthSq() < 1e-4) fFlat.set(0, 0, 1);
        fFlat.normalize();
        const rFlat = _tmp2.set(fFlat.z, 0, -fFlat.x); // right = fwd x up (for y-up): (fz, 0, -fx)
        if (this.vel.y < 0) this.vel.y = 0; // dodge cancels downward momentum immediately
        this.vel.addScaledVector(fFlat, CAR.DODGE_IMPULSE * f);
        this.vel.addScaledVector(rFlat, CAR.DODGE_IMPULSE * sIn);
        this.flipping = true;
        this.flipTimer = CAR.FLIP_DURATION;
        this.flipDir = { f: -pitchIn / mag, s: yawIn / mag };
        this.flipCancelled = false;
      }
    }

    // angular dynamics
    // local angular velocity
    const wLocal = _local.copy(this.angVel).applyQuaternion(_q.copy(this.quat).invert());
    // wLocal.x = pitch rate (about right axis; positive = nose down for right-handed? about +X (right), positive rotates +Z toward -Y i.e. nose down)
    // We'll define pitch input +1 = nose up => negative rotation about X.
    // wLocal.y = yaw rate (about up; positive = nose turns left), yaw input +1 = right => negative
    // wLocal.z = roll rate (about forward; positive = right side goes up i.e. roll left), roll input +1 = roll right => negative
    if (this.flipping) {
      this.flipTimer -= dt;
      // upward momentum is damped out between 0.15s and 0.21s into the flip (RL behaviour)
      const elapsed = CAR.FLIP_DURATION - this.flipTimer;
      if (elapsed >= 0.15 && elapsed <= 0.21 && this.vel.y > 0) this.vel.y *= Math.pow(0.35, dt * 120);
      const { f, s } = this.flipDir;
      let pitchRate = f * CAR.FLIP_ANGULAR_SPEED; // forward flip = nose down = positive about X
      const rollRate = -s * CAR.FLIP_ANGULAR_SPEED; // side flip right = roll right = negative
      // flip cancel: opposite pitch input
      if (!this.flipCancelled && Math.abs(f) > 0.3 && c.pitch * f > 0.5) {
        this.flipCancelled = true;
        wLocal.x *= 0.25; // the forced rotation stops almost immediately
      }
      // during a flip, the car can still yaw, and air roll can fight the flip's roll (speed-flip recovery)
      if (this.flipCancelled) {
        // cancelled flip: the forced pitch stops and the player regains (damped) pitch control
        const pitch = clamp(c.pitch, -1, 1);
        wLocal.x += (-pitch * CAR.AIR_TORQUE.pitch - CAR.AIR_DAMPING.pitch * wLocal.x * (1 - Math.abs(pitch))) * dt;
      } else {
        wLocal.x = pitchRate;
      }
      wLocal.z = rollRate - clamp(c.roll, -1, 1) * CAR.FLIP_ANGULAR_SPEED * 0.6;
      wLocal.y += (CAR.AIR_TORQUE.yaw * clamp(c.yaw, -1, 1) - CAR.AIR_DAMPING.yaw * wLocal.y * (1 - Math.abs(c.yaw))) * dt;
      if (this.flipTimer <= 0) {
        this.flipping = false;
        wLocal.x *= 0.2;
        wLocal.z *= 0.2;
      }
    } else {
      const pitch = clamp(c.pitch, -1, 1);
      const yaw = clamp(c.yaw, -1, 1);
      const roll = clamp(c.roll, -1, 1);
      wLocal.x += (-pitch * CAR.AIR_TORQUE.pitch - CAR.AIR_DAMPING.pitch * wLocal.x * (1 - Math.abs(pitch))) * dt;
      wLocal.y += (yaw * CAR.AIR_TORQUE.yaw - CAR.AIR_DAMPING.yaw * wLocal.y * (1 - Math.abs(yaw))) * dt;
      wLocal.z += (-roll * CAR.AIR_TORQUE.roll - CAR.AIR_DAMPING.roll * wLocal.z) * dt;
    }
    this.angVel.copy(wLocal).applyQuaternion(this.quat);

    // air throttle (tiny)
    if (Math.abs(c.throttle) > 0.01) this.vel.addScaledVector(fwd, c.throttle * 66.67 * dt);
  }

  collideBody(dt) {
    // Treat the car as a small set of spheres along its hitbox for arena collisions
    // (keeps the nose out of walls, lets the roof/side bounce).
    const h = this.hitbox.half;
    const o = this.hitbox.offset;
    const r = Math.min(14, h.y * 0.78);
    const pts = [
      [0, 0, h.z - r],
      [0, 0, -h.z + r],
      [h.x - r, 0, h.z - r],
      [-h.x + r, 0, h.z - r],
      [h.x - r, 0, -h.z + r],
      [-h.x + r, 0, -h.z + r],
      [0, h.y - r * 0.6, 0],
    ];
    let hitCount = 0;
    for (const p of pts) {
      _tmp.set(o.x + p[0], o.y + p[1], o.z + p[2]).applyQuaternion(this.quat).add(this.pos);
      collideSphere(_tmp, r, _contacts);
      for (const ct of _contacts) {
        if (ct.kind === 'floor' && this.onGround) continue;
        if (this.onGround && ct.n.dot(this.surfaceNormal) > 0.95) continue;
        // positional push
        this.pos.addScaledVector(ct.n, ct.depth);
        const vn = this.vel.dot(ct.n);
        if (vn < 0 && this.onGround && ct.kind !== 'post' && ct.n.dot(this.surfaceNormal) > 0.2) {
          // wheels are on the surface and the nose meets the next segment of a curve:
          // follow the curve, keep the speed (small scrub loss)
          const sp = this.vel.length();
          this.vel.addScaledVector(ct.n, -vn);
          const sp2 = this.vel.length();
          if (sp2 > 1e-3) this.vel.multiplyScalar((sp * 0.985) / sp2);
          hitCount++;
          continue;
        }
        if (vn < 0) {
          if (!this.onGround && -vn > this.events.wallHit) this.events.wallHit = -vn;
          const e = this.onGround ? 0 : 0.15;
          this.vel.addScaledVector(ct.n, -(1 + e) * vn);
          // friction proportional to the impact (scraping along a wall only slowly bleeds speed)
          this.vel.multiplyScalar(1 - Math.min(0.08, 0.002 + Math.abs(vn) * 0.0002));
          // spin the car toward being upright-ish on the surface (rotate so up aligns with n)
          if (!this.onGround) {
            const up = this.getUp(_up);
            const axis = _tmp2.crossVectors(up, ct.n);
            const mag = axis.length();
            if (mag > 1e-4) {
              axis.multiplyScalar(1 / mag);
              const align = up.dot(ct.n);
              const strength = align > 0 ? 6 : 3;
              this.angVel.addScaledVector(axis, strength * Math.min(1, mag + 0.2));
            }
            // dampen spin from impact
            this.angVel.multiplyScalar(0.7);
            if (this.flipping && Math.abs(vn) > 200) {
              this.flipping = false;
            }
          }
        }
        hitCount++;
      }
    }
    // Safety: keep in arena bounds
    this.pos.x = clamp(this.pos.x, -ARENA.HALF_WIDTH + 10, ARENA.HALF_WIDTH - 10);
    this.pos.z = clamp(this.pos.z, -ARENA.HALF_LENGTH - ARENA.GOAL_DEPTH + 10, ARENA.HALF_LENGTH + ARENA.GOAL_DEPTH - 10);
    this.pos.y = clamp(this.pos.y, 5, ARENA.HEIGHT - 5);
    return hitCount;
  }
}

export { ALL_PLANES };
