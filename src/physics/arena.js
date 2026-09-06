import * as THREE from 'three';
import { ARENA } from '../constants.js';

// The arena is a convex volume (plus two goal boxes) described by planes.
// Plane: inward normal n and offset d; a point p is inside when n.p >= d.
// `region` optionally restricts where the plane is active (for goal cutouts).

const A = ARENA;
const planes = [];
const goalPlanes = [];

function addPlane(n, d, region = null, kind = 'wall') {
  const nn = new THREE.Vector3(n[0], n[1], n[2]).normalize();
  planes.push({ n: nn, d, region, kind });
}

const inOpening = (p) => Math.abs(p.x) < A.GOAL_HALF_WIDTH && p.y < A.GOAL_HEIGHT;
const notInOpening = (p) => !inOpening(p);
const inGoalBlue = (p) => p.z < -A.HALF_LENGTH;
const inGoalOrange = (p) => p.z > A.HALF_LENGTH;
const inGoal = (p) => Math.abs(p.z) > A.HALF_LENGTH;

// main box
addPlane([0, 1, 0], 0, null, 'floor');
addPlane([0, -1, 0], -A.HEIGHT, null, 'ceiling');
addPlane([-1, 0, 0], -A.HALF_WIDTH);
addPlane([1, 0, 0], -A.HALF_WIDTH);
addPlane([0, 0, -1], -A.HALF_LENGTH, notInOpening, 'back');
addPlane([0, 0, 1], -A.HALF_LENGTH, notInOpening, 'back');
// 45 degree corner walls
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    addPlane([-sx, 0, -sz], -A.CORNER_SUM / Math.SQRT2);
  }
}

// Rounded edges (approximated by chamfer planes tangent to a circle of radius R)
function addChamfers(n1, d1, n2, d2, R, region, kind) {
  const segs = A.RAMP_SEGMENTS;
  for (let i = 1; i < segs; i++) {
    const th = (Math.PI / 2) * (i / segs);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const n = [n1[0] * c + n2[0] * s, n1[1] * c + n2[1] * s, n1[2] * c + n2[2] * s];
    const d = c * (d1 + R) + s * (d2 + R) - R;
    addPlane(n, d, region, kind);
  }
}

const FLOOR = { n: [0, 1, 0], d: 0 };
const CEIL = { n: [0, -1, 0], d: -A.HEIGHT };
const R_FLOOR = 260;
const R_CEIL = 260;
const walls = [
  { n: [-1, 0, 0], d: -A.HALF_WIDTH, region: null },
  { n: [1, 0, 0], d: -A.HALF_WIDTH, region: null },
  { n: [0, 0, -1], d: -A.HALF_LENGTH, region: notInOpening },
  { n: [0, 0, 1], d: -A.HALF_LENGTH, region: notInOpening },
];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    walls.push({ n: [-sx / Math.SQRT2, 0, -sz / Math.SQRT2], d: -A.CORNER_SUM / Math.SQRT2, region: null });
  }
}
for (const w of walls) {
  addChamfers(FLOOR.n, FLOOR.d, w.n, w.d, R_FLOOR, w.region, 'ramp');
  addChamfers(CEIL.n, CEIL.d, w.n, w.d, R_CEIL, w.region, 'ceilramp');
}

// Goal interiors
function addGoalPlane(n, d, region) {
  const nn = new THREE.Vector3(n[0], n[1], n[2]).normalize();
  goalPlanes.push({ n: nn, d, region, kind: 'goal' });
}
addGoalPlane([-1, 0, 0], -A.GOAL_HALF_WIDTH, inGoal);
addGoalPlane([1, 0, 0], -A.GOAL_HALF_WIDTH, inGoal);
addGoalPlane([0, -1, 0], -A.GOAL_HEIGHT, inGoal);
addGoalPlane([0, 0, 1], -(A.HALF_LENGTH + A.GOAL_DEPTH), inGoalBlue);
addGoalPlane([0, 0, -1], -(A.HALF_LENGTH + A.GOAL_DEPTH), inGoalOrange);

export const ALL_PLANES = planes.concat(goalPlanes);

const _tmp = new THREE.Vector3();

/**
 * Collide a sphere against the arena. Returns array of contacts
 * { n: inward normal, depth: penetration, kind }.
 */
export function collideSphere(pos, radius, out = []) {
  out.length = 0;
  for (let i = 0; i < ALL_PLANES.length; i++) {
    const pl = ALL_PLANES[i];
    if (pl.region && !pl.region(pos)) continue;
    const dist = pl.n.dot(pos) - pl.d;
    if (dist < radius) out.push({ n: pl.n, depth: radius - dist, kind: pl.kind });
  }
  // Goal posts & crossbar as edges (so the sphere wraps around them)
  if (Math.abs(Math.abs(pos.z) - A.HALF_LENGTH) < radius) {
    const sz = pos.z < 0 ? -1 : 1;
    const zEdge = sz * A.HALF_LENGTH;
    // vertical posts
    for (const sx of [-1, 1]) {
      const xEdge = sx * A.GOAL_HALF_WIDTH;
      if (pos.y <= A.GOAL_HEIGHT) {
        const dx = pos.x - xEdge;
        const dz = pos.z - zEdge;
        const d = Math.hypot(dx, dz);
        if (d < radius && d > 1e-4) {
          // only if not already handled by a face
          const insideX = Math.abs(pos.x) < A.GOAL_HALF_WIDTH;
          const insideZ = Math.abs(pos.z) < A.HALF_LENGTH;
          if (insideX !== insideZ) {
            const n = new THREE.Vector3(dx / d, 0, dz / d);
            out.push({ n, depth: radius - d, kind: 'post' });
          }
        }
      }
    }
    // crossbar
    if (Math.abs(pos.x) < A.GOAL_HALF_WIDTH) {
      const dy = pos.y - A.GOAL_HEIGHT;
      const dz = pos.z - zEdge;
      const d = Math.hypot(dy, dz);
      if (d < radius && d > 1e-4) {
        const insideY = pos.y < A.GOAL_HEIGHT;
        const insideZ = Math.abs(pos.z) < A.HALF_LENGTH;
        if (insideY !== insideZ) {
          const n = new THREE.Vector3(0, dy / d, dz / d);
          out.push({ n, depth: radius - d, kind: 'post' });
        }
      }
    }
  }
  return out;
}

/**
 * Signed distance of a point to the nearest active surface, with its normal.
 * If `up` is given, only surfaces the wheels could rest on (n·up > minDot) are considered.
 */
export function nearestSurface(pos, outNormal = new THREE.Vector3(), up = null, minDot = 0.5) {
  let best = Infinity;
  let bestN = null;
  for (let i = 0; i < ALL_PLANES.length; i++) {
    const pl = ALL_PLANES[i];
    if (pl.region && !pl.region(pos)) continue;
    if (up && pl.n.dot(up) < minDot) continue;
    const dist = pl.n.dot(pos) - pl.d;
    if (dist < best) {
      best = dist;
      bestN = pl.n;
    }
  }
  if (bestN) outNormal.copy(bestN);
  return best;
}

/**
 * Raycast from origin along dir (unit) up to maxDist. Returns {dist, n, kind} or null.
 */
export function raycast(origin, dir, maxDist) {
  let best = maxDist;
  let hit = null;
  for (let i = 0; i < ALL_PLANES.length; i++) {
    const pl = ALL_PLANES[i];
    const denom = pl.n.dot(dir);
    if (denom >= -1e-6) continue; // moving away or parallel
    const t = (pl.d - pl.n.dot(origin)) / denom;
    if (t < 0 || t > best) continue;
    if (pl.region) {
      _tmp.copy(origin).addScaledVector(dir, t);
      if (!pl.region(_tmp)) continue;
    }
    best = t;
    hit = pl;
  }
  return hit ? { dist: best, n: hit.n, kind: hit.kind } : null;
}

export function isInsideArena(pos, margin = 0) {
  for (let i = 0; i < ALL_PLANES.length; i++) {
    const pl = ALL_PLANES[i];
    if (pl.region && !pl.region(pos)) continue;
    if (pl.n.dot(pos) - pl.d < -margin) return false;
  }
  return true;
}
