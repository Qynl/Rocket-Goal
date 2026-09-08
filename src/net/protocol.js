// ---------------------------------------------------------------------------
// Online protocol: message types, rates and the binary codec.
//
// Everything that runs per frame is binary and travels over an *unreliable,
// unordered* data channel (UDP-like, no head-of-line blocking):
//
//   guest -> host   INPUT     one record per physics step of the guest's car
//   host  -> guest  SNAPSHOT  authoritative world state, 30 Hz
//
// Everything that must not be lost (handshake, match config, goals, chat,
// final stats) is JSON over a *reliable, ordered* channel.
//
// The codec is hand-rolled (DataView) so a snapshot stays a few hundred bytes
// and both peers decode it without allocating a JSON parser per frame.
// ---------------------------------------------------------------------------

/** Tuning. All times in seconds. */
export const NET = {
  /** Host snapshot rate (Hz). 30 Hz keeps bandwidth tiny and is plenty with
   *  interpolation + local ball extrapolation on the guest. */
  SNAPSHOT_HZ: 30,
  /** Guest input flush rate (Hz). Inputs themselves are per physics step. */
  INPUT_HZ: 60,
  /** Physics step both peers simulate at (must match constants.PHYSICS_DT). */
  DT: 1 / 120,
  /** Render remote entities this far in the past so jitter never starves the
   *  interpolator. Adaptively clamped between MIN and MAX. */
  INTERP_MIN: 0.05,
  INTERP_MAX: 0.16,
  INTERP_BASE: 0.09,
  /** If no snapshot/input arrives for this long the match is declared lost. */
  TIMEOUT: 6,
  /** Ping probe interval. */
  PING_EVERY: 0.5,
  /** Positional error above which the local car snaps instead of gliding. */
  SNAP_DIST: 110,
  /** Rotation error (rad) above which the local car snaps. */
  SNAP_ANGLE: 0.35,
  /** Ball error above which the ball snaps instead of blending. */
  BALL_SNAP_DIST: 260,
  /** Protocol version — peers refuse to play across versions. */
  VERSION: 3,
};

/** Binary message kinds (first byte of every unreliable packet). */
export const MSG = {
  INPUT: 1,
  SNAPSHOT: 2,
  PING: 3,
  PONG: 4,
};

/** Match state ids (kept short on the wire). */
export const STATE_ID = { countdown: 0, play: 1, goal: 2, ended: 3 };
export const STATE_NAME = ['countdown', 'play', 'goal', 'ended'];

/** Car flag bits. */
export const CAR_FLAG = {
  ON_GROUND: 1,
  HAS_JUMPED: 2,
  HAS_FLIP: 4,
  JUMP_HOLDING: 8,
  FLIPPING: 16,
  FLIP_CANCELLED: 32,
  SUPERSONIC: 64,
  BOOST_ACTIVE: 128,
  HANDBRAKING: 256,
  DEMOLISHED: 512,
  PREV_JUMP: 1024,
  AIR_ROLL: 2048,
};

/** Snapshot-level flag bits. */
export const SNAP_FLAG = {
  OVERTIME: 1,
  BALL_FROZEN: 2,
  KICKOFF_PENDING: 4,
  RUMBLE: 8,
};

/** Control flags inside an input record. */
export const IN_FLAG = { JUMP: 1, BOOST: 2, HANDBRAKE: 4, ITEM: 8 };

/** Rumble item ids in wire order (index 255 = no item). */
export const ITEM_ORDER = ['boost', 'grapple', 'boot', 'spike', 'tornado', 'haymaker', 'powershot', 'swapper'];
export const ITEM_INDEX = ITEM_ORDER.reduce((m, id, i) => ((m[id] = i), m), {});

// ---------------------------------------------------------------------------
// writer / reader
// ---------------------------------------------------------------------------
export class Writer {
  constructor(size = 2048) {
    this.buf = new ArrayBuffer(size);
    this.v = new DataView(this.buf);
    this.o = 0;
  }
  grow(n) {
    if (this.o + n <= this.buf.byteLength) return;
    const size = Math.max(this.buf.byteLength * 2, this.o + n);
    const buf = new ArrayBuffer(size);
    new Uint8Array(buf).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = buf;
    this.v = new DataView(buf);
  }
  u8(x) {
    this.grow(1);
    this.v.setUint8(this.o++, x & 0xff);
    return this;
  }
  u16(x) {
    this.grow(2);
    this.v.setUint16(this.o, x & 0xffff, true);
    this.o += 2;
    return this;
  }
  i8(x) {
    this.grow(1);
    this.v.setInt8(this.o++, x);
    return this;
  }
  u32(x) {
    this.grow(4);
    this.v.setUint32(this.o, x >>> 0, true);
    this.o += 4;
    return this;
  }
  f32(x) {
    this.grow(4);
    this.v.setFloat32(this.o, x, true);
    this.o += 4;
    return this;
  }
  f64(x) {
    this.grow(8);
    this.v.setFloat64(this.o, x, true);
    this.o += 8;
    return this;
  }
  /** Quantised float: keeps 1/128 precision, 2 bytes instead of 4. Used for
   *  values that are naturally -1..1 (controls, flip direction). */
  q8(x) {
    return this.i8(Math.round(clampNum(x, -1, 1) * 127));
  }
  vec3(v) {
    return this.f32(v.x).f32(v.y).f32(v.z);
  }
  quat(q) {
    return this.f32(q.x).f32(q.y).f32(q.z).f32(q.w);
  }
  bytes(u8) {
    this.grow(u8.length);
    new Uint8Array(this.buf, this.o, u8.length).set(u8);
    this.o += u8.length;
    return this;
  }
  finish() {
    return new Uint8Array(this.buf, 0, this.o);
  }
}

export class Reader {
  constructor(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.u8arr = u8;
    this.v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.o = 0;
  }
  get left() {
    return this.u8arr.length - this.o;
  }
  u8() {
    return this.v.getUint8(this.o++);
  }
  u16() {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  i8() {
    return this.v.getInt8(this.o++);
  }
  u32() {
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  }
  f32() {
    const x = this.v.getFloat32(this.o, true);
    this.o += 4;
    return x;
  }
  f64() {
    const x = this.v.getFloat64(this.o, true);
    this.o += 8;
    return x;
  }
  q8() {
    return this.i8() / 127;
  }
  vec3(out) {
    out.x = this.f32();
    out.y = this.f32();
    out.z = this.f32();
    return out;
  }
  quat(out) {
    out.x = this.f32();
    out.y = this.f32();
    out.z = this.f32();
    out.w = this.f32();
    return out;
  }
}

function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------
/** Quantise a controls object the way the wire does, so the predicting guest
 *  and the authoritative host step the car with *identical* numbers. */
export function quantizeControls(src, dst) {
  dst.throttle = Math.round(clampNum(src.throttle, -1, 1) * 127) / 127;
  dst.steer = Math.round(clampNum(src.steer, -1, 1) * 127) / 127;
  dst.pitch = Math.round(clampNum(src.pitch, -1, 1) * 127) / 127;
  dst.yaw = Math.round(clampNum(src.yaw, -1, 1) * 127) / 127;
  dst.roll = Math.round(clampNum(src.roll, -1, 1) * 127) / 127;
  dst.jump = !!src.jump;
  dst.boost = !!src.boost;
  dst.handbrake = !!src.handbrake;
  dst.useItem = !!src.useItem;
  return dst;
}

/** Pack a batch of per-step input records: {seq, c: controls}. */
export function packInputs(records) {
  const w = new Writer(16 + records.length * 12);
  w.u8(MSG.INPUT).u8(records.length);
  for (const r of records) {
    const c = r.c;
    w.u32(r.seq)
      .q8(c.throttle)
      .q8(c.steer)
      .q8(c.pitch)
      .q8(c.yaw)
      .q8(c.roll)
      .u8(
        (c.jump ? IN_FLAG.JUMP : 0) |
        (c.boost ? IN_FLAG.BOOST : 0) |
        (c.handbrake ? IN_FLAG.HANDBRAKE : 0) |
        (c.useItem ? IN_FLAG.ITEM : 0)
      );
  }
  return w.finish();
}

export function readInputs(data) {
  const r = new Reader(data);
  const kind = r.u8();
  if (kind !== MSG.INPUT) return null;
  const n = r.u8();
  const out = [];
  for (let i = 0; i < n; i++) {
    const seq = r.u32();
    const c = {
      throttle: r.q8(),
      steer: r.q8(),
      pitch: r.q8(),
      yaw: r.q8(),
      roll: r.q8(),
    };
    const f = r.u8();
    c.jump = !!(f & IN_FLAG.JUMP);
    c.boost = !!(f & IN_FLAG.BOOST);
    c.handbrake = !!(f & IN_FLAG.HANDBRAKE);
    c.useItem = !!(f & IN_FLAG.ITEM);
    out.push({ seq, c });
  }
  return out;
}

// ---------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------
/**
 * Pack the authoritative world.
 * @param snap plain object, see readSnapshot() for the shape.
 */
export function packSnapshot(s) {
  const cars = s.cars;
  const w = new Writer(160 + cars.length * 150);
  w.u8(MSG.SNAPSHOT);
  w.u32(s.frame).f32(s.simTime);
  w.u8(STATE_ID[s.state] ?? 1).f32(s.stateTimer);
  w.u8(Math.min(255, s.score[0])).u8(Math.min(255, s.score[1]));
  w.f32(isFinite(s.clock) ? s.clock : -1);
  let flags = 0;
  if (s.overtime) flags |= SNAP_FLAG.OVERTIME;
  if (s.ballFrozen) flags |= SNAP_FLAG.BALL_FROZEN;
  if (s.kickoffPending) flags |= SNAP_FLAG.KICKOFF_PENDING;
  if (s.rumble) flags |= SNAP_FLAG.RUMBLE;
  w.u8(flags);
  // ball
  const b = s.ball;
  w.vec3(b.pos).vec3(b.vel).vec3(b.angVel).quat(b.quat).u8(b.lastTouch < 0 ? 255 : b.lastTouch);
  // boost pads: one bit each
  const pads = s.pads;
  const bytes = Math.ceil(pads.length / 8);
  w.u8(bytes);
  for (let i = 0; i < bytes; i++) {
    let v = 0;
    for (let k = 0; k < 8; k++) if (pads[i * 8 + k]) v |= 1 << k;
    w.u8(v);
  }
  // cars
  w.u8(cars.length);
  for (const c of cars) {
    let cf = 0;
    if (c.onGround) cf |= CAR_FLAG.ON_GROUND;
    if (c.hasJumped) cf |= CAR_FLAG.HAS_JUMPED;
    if (c.hasFlip) cf |= CAR_FLAG.HAS_FLIP;
    if (c.jumpHolding) cf |= CAR_FLAG.JUMP_HOLDING;
    if (c.flipping) cf |= CAR_FLAG.FLIPPING;
    if (c.flipCancelled) cf |= CAR_FLAG.FLIP_CANCELLED;
    if (c.supersonic) cf |= CAR_FLAG.SUPERSONIC;
    if (c.boostActive) cf |= CAR_FLAG.BOOST_ACTIVE;
    if (c.handbraking) cf |= CAR_FLAG.HANDBRAKING;
    if (c.demolished) cf |= CAR_FLAG.DEMOLISHED;
    if (c.prevJump) cf |= CAR_FLAG.PREV_JUMP;
    if (c.airRollActive) cf |= CAR_FLAG.AIR_ROLL;
    w.vec3(c.pos).vec3(c.vel).vec3(c.angVel).quat(c.quat);
    w.f32(c.boost).u16(cf);
    w.f32(c.respawnTimer).f32(c.airTime).f32(c.flipWindow).f32(c.flipTimer);
    w.f32(c.jumpHoldTime).f32(c.suspension).f32(c.wheelSpin).f32(c.steerVisual);
    w.f32(c.flipF).f32(c.flipS);
    w.vec3(c.normal).vec3(c.prevN);
    w.u8(c.itemId < 0 ? 255 : c.itemId).f32(c.itemCooldown).f32(c.itemTimer);
    w.u16(c.boostCollected).u32(c.ackSeq);
  }
  return w.finish();
}

/** Decode into `out` (re-used object, no per-frame garbage). */
export function readSnapshot(data, out) {
  const r = new Reader(data);
  if (r.u8() !== MSG.SNAPSHOT) return null;
  const s = out || {};
  s.frame = r.u32();
  s.simTime = r.f32();
  s.state = STATE_NAME[r.u8()] || 'play';
  s.stateTimer = r.f32();
  s.score = s.score || [0, 0];
  s.score[0] = r.u8();
  s.score[1] = r.u8();
  const clock = r.f32();
  s.clock = clock < 0 ? Infinity : clock;
  const flags = r.u8();
  s.overtime = !!(flags & SNAP_FLAG.OVERTIME);
  s.ballFrozen = !!(flags & SNAP_FLAG.BALL_FROZEN);
  s.kickoffPending = !!(flags & SNAP_FLAG.KICKOFF_PENDING);
  s.rumble = !!(flags & SNAP_FLAG.RUMBLE);
  const b = (s.ball = s.ball || { pos: v3(), vel: v3(), angVel: v3(), quat: q() });
  r.vec3(b.pos);
  r.vec3(b.vel);
  r.vec3(b.angVel);
  r.quat(b.quat);
  const lt = r.u8();
  b.lastTouch = lt === 255 ? -1 : lt;
  const padBytes = r.u8();
  s.pads = s.pads || [];
  for (let i = 0; i < padBytes; i++) {
    const v = r.u8();
    for (let k = 0; k < 8; k++) s.pads[i * 8 + k] = !!(v & (1 << k));
  }
  const n = r.u8();
  s.cars = s.cars || [];
  for (let i = 0; i < n; i++) {
    const c = s.cars[i] || (s.cars[i] = blankCar());
    r.vec3(c.pos);
    r.vec3(c.vel);
    r.vec3(c.angVel);
    r.quat(c.quat);
    c.boost = r.f32();
    const cf = r.u16();
    c.onGround = !!(cf & CAR_FLAG.ON_GROUND);
    c.hasJumped = !!(cf & CAR_FLAG.HAS_JUMPED);
    c.hasFlip = !!(cf & CAR_FLAG.HAS_FLIP);
    c.jumpHolding = !!(cf & CAR_FLAG.JUMP_HOLDING);
    c.flipping = !!(cf & CAR_FLAG.FLIPPING);
    c.flipCancelled = !!(cf & CAR_FLAG.FLIP_CANCELLED);
    c.supersonic = !!(cf & CAR_FLAG.SUPERSONIC);
    c.boostActive = !!(cf & CAR_FLAG.BOOST_ACTIVE);
    c.handbraking = !!(cf & CAR_FLAG.HANDBRAKING);
    c.demolished = !!(cf & CAR_FLAG.DEMOLISHED);
    c.prevJump = !!(cf & CAR_FLAG.PREV_JUMP);
    c.airRollActive = !!(cf & CAR_FLAG.AIR_ROLL);
    c.respawnTimer = r.f32();
    c.airTime = r.f32();
    c.flipWindow = r.f32();
    c.flipTimer = r.f32();
    c.jumpHoldTime = r.f32();
    c.suspension = r.f32();
    c.wheelSpin = r.f32();
    c.steerVisual = r.f32();
    c.flipF = r.f32();
    c.flipS = r.f32();
    r.vec3(c.normal);
    r.vec3(c.prevN);
    const item = r.u8();
    c.itemId = item === 255 ? -1 : item;
    c.itemCooldown = r.f32();
    c.itemTimer = r.f32();
    c.boostCollected = r.u16();
    c.ackSeq = r.u32();
  }
  s.cars.length = n;
  s.recvTime = 0; // filled in by the caller (local monotonic seconds)
  return s;
}

function blankCar() {
  return {
    pos: v3(),
    vel: v3(),
    angVel: v3(),
    quat: q(),
    normal: v3(0, 1, 0),
    prevN: v3(0, 1, 0),
    boost: 0,
    respawnTimer: 0,
    airTime: 0,
    flipWindow: 0,
    flipTimer: 0,
    jumpHoldTime: 0,
    suspension: 0,
    wheelSpin: 0,
    steerVisual: 0,
    flipF: 0,
    flipS: 0,
    itemId: -1,
    itemCooldown: 0,
    itemTimer: 0,
    boostCollected: 0,
    ackSeq: 0,
    onGround: false,
    hasJumped: false,
    hasFlip: true,
    jumpHolding: false,
    flipping: false,
    flipCancelled: false,
    supersonic: false,
    boostActive: false,
    handbraking: false,
    demolished: false,
    prevJump: false,
    airRollActive: false,
  };
}

function v3(x = 0, y = 0, z = 0) {
  return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } };
}
function q() {
  return { x: 0, y: 0, z: 0, w: 1, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; return this; }, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; this.w = o.w; return this; } };
}

/** Snapshot a live Car into the wire shape (avoids allocating per frame). */
export function writeCarState(car, out, ackSeq) {
  const c = out || blankCar();
  c.pos.copy(car.pos);
  c.vel.copy(car.vel);
  c.angVel.copy(car.angVel);
  c.quat.copy(car.quat);
  c.boost = car.boost;
  c.onGround = car.onGround;
  c.hasJumped = car.hasJumped;
  c.hasFlip = car.hasFlip;
  c.jumpHolding = car.jumpHolding;
  c.flipping = car.flipping;
  c.flipCancelled = !!car.flipCancelled;
  c.supersonic = car.supersonic;
  c.boostActive = car.boostActive;
  c.handbraking = car.handbraking;
  c.demolished = car.demolished;
  c.prevJump = car.prevJump;
  c.airRollActive = !!car.airRollActive;
  c.respawnTimer = car.respawnTimer;
  c.airTime = car.airTime;
  c.flipWindow = car.flipWindow;
  c.flipTimer = car.flipTimer;
  c.jumpHoldTime = car.jumpHoldTime;
  c.suspension = car.suspension;
  c.wheelSpin = car.wheelSpin;
  c.steerVisual = car.steerVisual;
  c.flipF = car.flipDir ? car.flipDir.f : 0;
  c.flipS = car.flipDir ? car.flipDir.s : 0;
  c.normal.copy(car.surfaceNormal);
  c.prevN.copy(car._prevN || car.surfaceNormal);
  c.itemId = car.item ? ITEM_INDEX[car.item.id] ?? -1 : -1;
  c.itemCooldown = car.item ? car.item.cooldown : 0;
  c.itemTimer = car.item ? car.item.timer : 0;
  // no event mirrors this one, so the scoreboard would otherwise show the
  // remote players with zero boost collected for the whole match
  c.boostCollected = Math.max(0, Math.min(65535, Math.round((car.stats && car.stats.boostCollected) || 0)));
  c.ackSeq = ackSeq || 0;
  return c;
}

export { blankCar as blankCarState, v3 as netVec3, q as netQuat };
