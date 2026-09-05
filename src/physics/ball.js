import * as THREE from 'three';
import { BALL, GRAVITY, ARENA } from '../constants.js';
import { collideSphere } from './arena.js';

const _contacts = [];
const _vn = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3(0, BALL.RADIUS, 0);
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.radius = BALL.RADIUS;
    this.lastTouch = null; // { car, time, team }
    this.onGround = false;
    this.frozen = false;
  }

  reset(pos = null) {
    this.pos.set(0, BALL.RADIUS, 0);
    if (pos) this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.identity();
    this.lastTouch = null;
  }

  step(dt) {
    this.bounceImpact = 0;
    if (this.frozen) return;
    // gravity + drag
    this.vel.y -= GRAVITY * dt;
    this.vel.multiplyScalar(1 - BALL.DRAG * dt);
    this.pos.addScaledVector(this.vel, dt);

    // arena collisions
    collideSphere(this.pos, this.radius, _contacts);
    this.onGround = false;
    for (let i = 0; i < _contacts.length; i++) {
      const c = _contacts[i];
      // positional correction
      this.pos.addScaledVector(c.n, c.depth);
      const vn = this.vel.dot(c.n);
      const isGroundLike = c.n.y > 0.7;
      if (isGroundLike) this.onGround = true;
      if (vn < -40) {
        if (-vn > this.bounceImpact) this.bounceImpact = -vn;
        // real bounce: normal restitution + tangential friction that converts slip into spin
        _rel.crossVectors(this.angVel, _tmp.copy(c.n).multiplyScalar(-this.radius)).add(this.vel);
        _vt.copy(_rel).sub(_tmp.copy(c.n).multiplyScalar(_rel.dot(c.n)));
        this.vel.addScaledVector(c.n, -(1 + BALL.RESTITUTION) * vn);
        const slip = _vt.length();
        if (slip > 1e-3) {
          // impulse limited by friction cone; solid-sphere split between linear and angular
          const maxJ = BALL.FRICTION * Math.abs(vn) * (1 + BALL.RESTITUTION);
          const j = Math.min(slip * (2 / 7), maxJ);
          // Ramps (floor/wall curves) deflect the ball sideways less than a flat wall would
          void c.kind;
          const dv = _vt.clone().multiplyScalar(-j / slip);
          this.vel.add(dv);
          const r = _tmp.copy(c.n).multiplyScalar(-this.radius);
          const dw = new THREE.Vector3().crossVectors(r, dv).multiplyScalar(-1 / (0.4 * this.radius * this.radius));
          this.angVel.add(dw.multiplyScalar(0.4));
        }
      } else if (vn < 0) {
        // resting / rolling contact: kill the inward velocity, no bounce
        this.vel.addScaledVector(c.n, -vn);
      }
    }

    // rolling on ground: low rolling resistance and spin consistent with translation
    if (this.onGround) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0) {
        const decel = Math.min(speed, 30 * dt);
        this.vel.x -= (this.vel.x / speed) * decel;
        this.vel.z -= (this.vel.z / speed) * decel;
      }
      // desired angular velocity for pure rolling: w = (n x v)/R
      const target = new THREE.Vector3(0, 1, 0).cross(this.vel).multiplyScalar(1 / this.radius);
      this.angVel.lerp(target, Math.min(1, 6 * dt));
    }

    // clamp speeds
    const s = this.vel.length();
    if (s > BALL.MAX_SPEED) this.vel.multiplyScalar(BALL.MAX_SPEED / s);
    const w = this.angVel.length();
    if (w > BALL.MAX_ANG) this.angVel.multiplyScalar(BALL.MAX_ANG / w);

    // integrate rotation
    if (w > 1e-5) {
      const dq = new THREE.Quaternion().setFromAxisAngle(_tmp.copy(this.angVel).normalize(), w * dt);
      this.quat.premultiply(dq).normalize();
    }

    // Safety clamp: never leave the arena bounding box
    this.pos.x = Math.max(-ARENA.HALF_WIDTH + 1, Math.min(ARENA.HALF_WIDTH - 1, this.pos.x));
    this.pos.z = Math.max(-ARENA.HALF_LENGTH - ARENA.GOAL_DEPTH + 1, Math.min(ARENA.HALF_LENGTH + ARENA.GOAL_DEPTH - 1, this.pos.z));
    this.pos.y = Math.max(this.radius * 0.5, Math.min(ARENA.HEIGHT - 1, this.pos.y));
  }

  /** Which goal is the ball in? returns -1 none, 0 = in blue's goal (orange scored), 1 = in orange goal */
  goalCheck() {
    if (this.pos.z < -ARENA.HALF_LENGTH - this.radius) return 0;
    if (this.pos.z > ARENA.HALF_LENGTH + this.radius) return 1;
    return -1;
  }

  /**
   * Predict future ball state ignoring cars. Returns array of {t, pos, vel} samples.
   */
  predict(duration, step = 1 / 30) {
    const sim = new Ball();
    sim.pos.copy(this.pos);
    sim.vel.copy(this.vel);
    sim.angVel.copy(this.angVel);
    const out = [];
    const sub = 1 / 120;
    let t = 0;
    let acc = 0;
    out.push({ t: 0, pos: sim.pos.clone(), vel: sim.vel.clone() });
    while (t < duration) {
      sim.step(sub);
      t += sub;
      acc += sub;
      if (acc >= step - 1e-6) {
        acc = 0;
        out.push({ t, pos: sim.pos.clone(), vel: sim.vel.clone() });
      }
    }
    return out;
  }
}
