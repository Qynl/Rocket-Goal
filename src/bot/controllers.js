import * as THREE from 'three';
import { CAR, GRAVITY } from '../constants.js';
import { clamp, driveTime } from '../math.js';

const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _err = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export function toLocal(car, worldVec, out = _local) {
  return out.copy(worldVec).applyQuaternion(_q.copy(car.quat).invert());
}

/**
 * Ground driving controller. Writes to car.controls.
 * opts: { speed (target speed), allowBoost, allowFlip, allowHandbrake, arriveIn (seconds) }
 * Returns { dist, angle }.
 */
export function driveTo(bot, target, opts = {}) {
  const car = bot.car;
  const c = car.controls;
  const rel = _tmp.copy(target).sub(car.pos);
  // project onto the driving surface (floor: drop y; wall: drop the normal component)
  const sn = car.onGround ? car.surfaceNormal : UPV;
  rel.addScaledVector(sn, -rel.dot(sn));
  const dist = rel.length();
  const local = toLocal(car, rel, _tmp2);
  const angle = Math.atan2(local.x, local.z); // + = right
  const speed = car.forwardSpeed;
  const absSpeed = Math.abs(speed);
  let desired = opts.speed ?? car.maxSpeed;
  if (opts.arriveIn !== undefined && opts.arriveIn > 0) {
    desired = Math.min(desired, dist / opts.arriveIn);
  }
  desired = clamp(desired, 0, car.maxSpeed);

  // Steering
  let steer = clamp(angle * 3.2, -1, 1);
  let handbrake = false;
  if ((opts.allowHandbrake ?? true) && Math.abs(angle) > 1.25 && absSpeed > 450 && dist > 250) {
    handbrake = true;
  }
  // If target is behind and very close, reverse into it instead of a full turn
  let throttle = 1;
  const goBackward = Math.abs(angle) > 2.3 && dist < 800 && absSpeed < 700 && (opts.allowReverse ?? true);
  if (goBackward) {
    throttle = -1;
    steer = -Math.sign(angle);
    handbrake = false;
  } else {
    if (absSpeed > desired + 150) throttle = -0.6; // brake
    else if (absSpeed > desired + 30) throttle = 0; // coast
    else throttle = 1;
    if (speed < -50) throttle = 1; // stop reversing
  }
  // boost
  let boost = false;
  const boostAllowed = (opts.allowBoost ?? true) && bot.skill.useBoost;
  if (boostAllowed && throttle > 0 && Math.abs(angle) < 0.35 && speed < desired - 120 && speed < car.maxSpeed - 20 && car.boost > 0) {
    // do not waste boost when a flip would do or when target speed is reachable by throttle
    if (desired > 1300 || dist > 1500) boost = true;
    if (speed >= 1410 - 20 && desired <= 1410) boost = false;
  }
  if (car.onGround && car.up.y < 0.6) boost = false; // don't boost while sideways on a wall
  c.throttle = throttle;
  c.steer = steer;
  c.handbrake = handbrake;
  c.boost = boost;
  c.jump = false;
  c.pitch = 0;
  c.yaw = 0;
  c.roll = 0;

  // speed-flip for distance
  // Front flip for speed when we're out of boost (every skill level knows this one);
  // the skilled bots cancel it into a speed flip.
  const flipSkill = bot.skill.speedFlips ? 1 : bot.skill.flipForSpeed ?? 0.6;
  if (
    (opts.allowFlip ?? true) &&
    flipSkill > 0 &&
    car.onGround &&
    car.up.y > 0.9 &&
    Math.abs(angle) < 0.12 &&
    dist > (bot.skill.speedFlips ? 1600 : 2000) &&
    speed > 950 &&
    speed < 2050 &&
    desired > speed + 250 &&
    car.boost < 25 + (dist > 3500 ? 30 : 0) &&
    (bot.skill.speedFlips || Math.random() < flipSkill)
  ) {
    bot.startManeuver('frontflip', { keepBoost: boost, cancel: !!bot.skill.speedFlips });
  }
  return { dist, angle, desired };
}

/**
 * Orientation controller in the air. Aligns car forward with `forward` and (optionally) car up with `up`.
 * Two-stage: error -> desired angular rate (rate-limited), then rate error -> input. This is stable
 * for RL's torque/damping model and doesn't overshoot at large angles.
 */
export function aimAir(car, forward, up = null) {
  const c = car.controls;
  const fLocal = toLocal(car, forward, _tmp).normalize();
  const yawErr = Math.atan2(fLocal.x, fLocal.z); // + => target to the right
  const pitchErr = Math.atan2(fLocal.y, Math.hypot(fLocal.x, fLocal.z)); // + => target above
  const wLocal = toLocal(car, car.angVel, _tmp2);
  // conventions: wLocal.x > 0 => nose going down; wLocal.y > 0 => nose going right; wLocal.z > 0 => rolling left
  const noseUpRate = -wLocal.x;
  const noseRightRate = wLocal.y;
  const rollLeftRate = wLocal.z;
  // desired rate follows a braking profile: v = sqrt(2 a |e|) capped, linear near zero
  const profile = (err, accel, maxRate) => {
    const mag = Math.min(maxRate, Math.sqrt(2 * accel * Math.abs(err)), 10 * Math.abs(err));
    return Math.sign(err) * mag;
  };
  const wantPitch = profile(pitchErr, CAR.AIR_TORQUE.pitch * 0.55, 5.0);
  const wantYaw = profile(yawErr, CAR.AIR_TORQUE.yaw * 0.55, 4.5);
  const kIn = 1.2;
  let pitch = clamp(kIn * (wantPitch - noseUpRate), -1, 1);
  let yaw = clamp(kIn * (wantYaw - noseRightRate), -1, 1);
  let roll = 0;
  if (up) {
    const uLocal = toLocal(car, up, _err);
    // target up tilted to the car's right (x>0) => roll right => positive input
    const rollErr = Math.atan2(uLocal.x, uLocal.y);
    const wantRollRight = profile(rollErr, CAR.AIR_TORQUE.roll * 0.5, 5.0);
    roll = clamp(0.6 * (wantRollRight + rollLeftRate), -1, 1);
    if (Math.abs(pitchErr) + Math.abs(yawErr) > 1.3) roll *= 0.3;
  }
  c.pitch = pitch;
  c.yaw = yaw;
  c.roll = roll;
  return { yawErr, pitchErr };
}

/** Compute direction and magnitude of acceleration needed to reach target at time dt (aerial). */
export function aerialRequirement(car, target, dt, out = new THREE.Vector3()) {
  if (dt <= 0.05) dt = 0.05;
  out.copy(target).sub(car.pos).addScaledVector(car.vel, -dt);
  out.y += 0.5 * GRAVITY * dt * dt;
  out.multiplyScalar(2 / (dt * dt));
  return out; // required constant acceleration vector
}

/** Estimated time for car to reach a ground point, including turning cost. */
export function timeToPoint(car, point, useBoost = true) {
  const rel = _tmp.copy(point).sub(car.pos);
  rel.y = 0;
  const d = rel.length();
  const local = toLocal(car, rel, _tmp2);
  const angle = Math.abs(Math.atan2(local.x, local.z));
  const speed = car.forwardSpeed;
  let t = driveTime(Math.max(0, d - 60), Math.max(speed, 0), useBoost, car.boost);
  // turning cost: roughly angle / yawRate at moderate speed
  t += angle * 0.45 + (angle > 1.8 ? 0.4 : 0);
  if (!car.onGround) t += 0.3 + Math.max(0, car.pos.y - 100) / 800;
  return t;
}

export { _fwd };
