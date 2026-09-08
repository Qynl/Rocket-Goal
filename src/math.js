import * as THREE from 'three';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Hermite ramp from 0 at `a` to 1 at `b` — the JS twin of GLSL smoothstep. */
export function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}
export const sign = (v) => (v < 0 ? -1 : 1);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

// wrap angle to [-PI, PI]
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Piecewise-linear interpolation over [[x, y], ...] sorted by x
export function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

export const UP = new THREE.Vector3(0, 1, 0);
export const FORWARD = new THREE.Vector3(0, 0, 1);
export const RIGHT = new THREE.Vector3(1, 0, 0);

// Rotate a world vector into car-local frame (x right, y up, z forward)
export function toLocal(vec, quat, out = new THREE.Vector3()) {
  return out.copy(vec).applyQuaternion(_qinv.copy(quat).invert());
}
const _qinv = new THREE.Quaternion();

export function yawOf(quat) {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  return Math.atan2(f.x, f.z);
}

// Quaternion that has `up` as up and `forward` as close as possible to forward
export function lookQuat(forward, up, out = new THREE.Quaternion()) {
  const f = _f.copy(forward);
  const u = _u.copy(up).normalize();
  // remove up component from forward
  f.addScaledVector(u, -f.dot(u));
  if (f.lengthSq() < 1e-6) f.set(u.y, -u.x, 0).normalize(); // degenerate: pick anything perpendicular
  else f.normalize();
  const r = _r.crossVectors(u, f).normalize(); // right = up x forward
  _m.makeBasis(r, u, f);
  return out.setFromRotationMatrix(_m);
}
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function quatFromYaw(yaw) {
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw);
}

// Kinematic helpers -------------------------------------------------
// Time for a car (starting at speed v0, using boost or not) to travel distance d.
export function driveTime(d, v0, boost, boostAmount = 0) {
  // Simple model: accelerate to max, then constant.
  // On throttle only, accel ~ 1000 average until 1410. With boost, ~1600 until 2300.
  const vmax = boost && boostAmount > 0 ? 2300 : 1410;
  const a = boost && boostAmount > 0 ? 1650 : 900;
  let v = Math.max(0, v0);
  if (d <= 0) return 0;
  if (v >= vmax) return d / v;
  const tAcc = (vmax - v) / a;
  const dAcc = v * tAcc + 0.5 * a * tAcc * tAcc;
  if (dAcc >= d) {
    // solve 0.5 a t^2 + v t - d = 0
    return (-v + Math.sqrt(v * v + 2 * a * d)) / a;
  }
  return tAcc + (d - dAcc) / vmax;
}
