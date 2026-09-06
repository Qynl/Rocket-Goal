import * as THREE from 'three';
import { CAR } from '../constants.js';
import { interp, clamp } from '../math.js';

const _center = new THREE.Vector3();
const _local = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _n = new THREE.Vector3();
const _qinv = new THREE.Quaternion();
const _rel = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// Psyonix impulse scale curve: relative speed -> multiplier
const PSYONIX_CURVE = [
  [0, 0.65],
  [500, 0.65],
  [2300, 0.55],
  [4600, 0.3],
];

/**
 * Resolve collision between a car hitbox (OBB) and the ball (sphere).
 * Returns true if a touch happened this frame.
 */
export function collideCarBall(car, ball, time) {
  if (car.demolished) return false;
  const h = car.hitbox.half;
  const R = ball.radius;
  const M = ball.mass;
  car.getHitboxCenter(_center);
  _qinv.copy(car.quat).invert();
  _local.copy(ball.pos).sub(_center).applyQuaternion(_qinv);
  _closest.set(clamp(_local.x, -h.x, h.x), clamp(_local.y, -h.y, h.y), clamp(_local.z, -h.z, h.z));
  const dx = _local.x - _closest.x;
  const dy = _local.y - _closest.y;
  const dz = _local.z - _closest.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= R * R) return false;

  let dist = Math.sqrt(d2);
  if (dist < 1e-4) {
    // ball centre inside the box: push out along the axis of least penetration
    const px = h.x - Math.abs(_local.x);
    const py = h.y - Math.abs(_local.y);
    const pz = h.z - Math.abs(_local.z);
    if (px < py && px < pz) _n.set(Math.sign(_local.x) || 1, 0, 0);
    else if (py < pz) _n.set(0, Math.sign(_local.y) || 1, 0);
    else _n.set(0, 0, Math.sign(_local.z) || 1);
    dist = 0;
  } else {
    _n.set(dx / dist, dy / dist, dz / dist);
  }
  // contact normal in world (points from car toward ball)
  _n.applyQuaternion(car.quat);
  const penetration = R - dist;

  // positional separation (ball mostly, car a bit)
  const total = CAR.MASS + M;
  ball.pos.addScaledVector(_n, penetration * (CAR.MASS / total));
  car.pos.addScaledVector(_n, -penetration * (M / total));

  // relative velocity along normal
  // contact point velocity of the car (include angular velocity)
  _tmp.copy(ball.pos).addScaledVector(_n, -R).sub(car.pos);
  const carPointVel = _rel.crossVectors(car.angVel, _tmp).add(car.vel);
  const relVel = _tmp.copy(ball.vel).sub(carPointVel);
  const vn = relVel.dot(_n);

  if (vn < 0) {
    const e = Math.abs(vn) < 60 ? 0 : 0.2; // no bounce for resting contact
    const j = (-(1 + e) * vn) / (1 / M + 1 / CAR.MASS);
    ball.vel.addScaledVector(_n, j / M);
    car.vel.addScaledVector(_n, -j / CAR.MASS);
    // slight ball spin from tangential rub
    const vt = relVel.addScaledVector(_n, -vn);
    ball.angVel.addScaledVector(new THREE.Vector3().crossVectors(_n, vt), -0.4 / R);
    ball.angVel.multiplyScalar(0.9);
  }

  const isNewTouch = time - car.lastBallTouch > 0.25;
  const continuous = time - car.lastBallTouch < 0.05; // resting/rolling contact (dribble)

  // Psyonix impulse: extra push based on car->ball direction and relative speed.
  // Only on real hits — not while the ball is resting on the car (dribbling).
  const relSpeed = _tmp.copy(car.vel).sub(ball.vel).length();
  if (!continuous && relSpeed > 60) {
    _pn.copy(ball.pos).sub(car.pos);
    _pn.y *= 0.35;
    car.getForward(_f);
    _pn.addScaledVector(_f, -0.35 * _pn.dot(_f));
    _pn.normalize();
    const scale = interp(PSYONIX_CURVE, relSpeed);
    ball.vel.addScaledVector(_pn, relSpeed * scale);
    const sp = ball.vel.length();
    if (sp > ball.maxSpeed) ball.vel.multiplyScalar(ball.maxSpeed / sp);
  } else if (continuous) {
    // dribble friction: the ball is carried along with the roof
    const carPointVel2 = _rel.crossVectors(car.angVel, _tmp.copy(ball.pos).sub(car.pos)).add(car.vel);
    const relV = _tmp.copy(ball.vel).sub(carPointVel2);
    relV.addScaledVector(_n, -relV.dot(_n));
    ball.vel.addScaledVector(relV, -0.35);
  }

  car.lastBallTouch = time;
  ball.lastTouch = { car, time, team: car.team, pos: ball.pos.clone(), vel: ball.vel.clone(), height: car.pos.y };
  return isNewTouch;
}

const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _d = new THREE.Vector3();
/** Car vs car collision (approximated with spheres). Returns demolition info or null. */
export function collideCarCar(a, b) {
  if (a.demolished || b.demolished) return null;
  a.getHitboxCenter(_ca);
  b.getHitboxCenter(_cb);
  // contact radius follows each car's hitbox length (Merc bumps sooner than a Batmobile)
  const r = (Math.max(a.hitbox.half.x, a.hitbox.half.z) + Math.max(b.hitbox.half.x, b.hitbox.half.z)) * 0.53;
  _d.copy(_cb).sub(_ca);
  const dist = _d.length();
  if (dist >= r * 2 || dist < 1e-4) return null;
  _d.multiplyScalar(1 / dist);
  const aSpeed = a.vel.length();
  const bSpeed = b.vel.length();
  // demolition: supersonic and driving into the other
  const aInto = a.vel.dot(_d) / (aSpeed || 1);
  const bInto = -b.vel.dot(_d) / (bSpeed || 1);
  if (a.team !== b.team) {
    if (a.supersonic && aInto > 0.7 && aSpeed > bSpeed + 300) return { demolisher: a, victim: b };
    if (b.supersonic && bInto > 0.7 && bSpeed > aSpeed + 300) return { demolisher: b, victim: a };
  }
  // bump
  const pen = r * 2 - dist;
  a.pos.addScaledVector(_d, -pen * 0.5);
  b.pos.addScaledVector(_d, pen * 0.5);
  const rel = _tmp.copy(a.vel).sub(b.vel);
  const vn = rel.dot(_d);
  if (vn > 0) {
    const j = vn * 0.55; // per-mass equal
    a.vel.addScaledVector(_d, -j);
    b.vel.addScaledVector(_d, j);
    // pop the lighter-hit car a little into the air like RL bumps do
    if (vn > 800) {
      const heavier = aSpeed > bSpeed ? b : a;
      heavier.vel.y += Math.min(400, vn * 0.25);
      heavier.onGround = false;
      heavier.angVel.addScaledVector(new THREE.Vector3(_d.z, 0, -_d.x), 2.5);
    }
  }
  return null;
}
