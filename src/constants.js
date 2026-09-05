// All units are Unreal Units (uu), 1 uu ~= 1 cm, matching Rocket League.
// Coordinate system: Y up. X = side to side (+X is right when looking from blue goal
// towards orange goal), Z = field length. Blue defends -Z, Orange defends +Z.

export const ARENA = {
  HALF_WIDTH: 4096,
  HALF_LENGTH: 5120,
  HEIGHT: 2044,
  GOAL_HALF_WIDTH: 892.755,
  GOAL_HEIGHT: 642.775,
  GOAL_DEPTH: 880,
  CORNER_SUM: 8064, // corner walls: |x| + |z| = 8064
  RAMP_RADIUS: 260, // floor/wall curve radius (approximated with segments)
  RAMP_SEGMENTS: 6,
};

export const BALL = {
  RADIUS: 92.75,
  MASS: 30,
  MAX_SPEED: 6000,
  MAX_ANG: 6,
  RESTITUTION: 0.6,
  FRICTION: 0.35,
  DRAG: 0.0305,
};

export const GRAVITY = 650;

// Octane preset (the most used car in RL)
export const CAR = {
  MASS: 180,
  HITBOX_HALF: { x: 42.0997, y: 18.0795, z: 59.0037 }, // right, up, forward half extents
  HITBOX_OFFSET: { x: 0, y: 20.755, z: 13.8757 }, // hitbox centre relative to car origin
  REST_HEIGHT: 17.01, // car origin height above ground when resting on wheels
  WHEEL_RADIUS_FRONT: 12.5,
  WHEEL_RADIUS_BACK: 15,
  // wheel offsets relative to car origin (x right, y up, z forward)
  WHEELS: [
    { x: 29.5, y: 0, z: 51.25 },
    { x: -29.5, y: 0, z: 51.25 },
    { x: 29.5, y: 0, z: -33.8 },
    { x: -29.5, y: 0, z: -33.8 },
  ],
  MAX_SPEED: 2300,
  SUPERSONIC: 2200,
  MAX_DRIVE_SPEED: 1410, // top speed with throttle only
  BOOST_ACCEL: 991.6667,
  BOOST_CONSUMPTION: 33.3333, // per second
  BOOST_MIN_TIME: 0.1,
  BRAKE_ACCEL: 3500,
  COAST_DECEL: 525,
  JUMP_IMPULSE: 292,
  JUMP_HOLD_ACCEL: 1458,
  JUMP_MAX_HOLD: 0.2,
  DOUBLE_JUMP_IMPULSE: 292,
  DODGE_IMPULSE: 500,
  DODGE_DEADLINE: 1.25, // seconds after first jump within which a flip can be used
  FLIP_DURATION: 0.65,
  FLIP_ANGULAR_SPEED: 9.6,
  AIR_TORQUE: { pitch: 12.46, yaw: 9.11, roll: 38.34 },
  AIR_DAMPING: { pitch: 2.8, yaw: 2.0, roll: 4.47 },
  MAX_ANGULAR: 5.5,
  STICKY_FORCE: 325,
  DEMO_SPEED: 2200,
  RESPAWN_TIME: 3,
  MAX_BOOST: 100,
};

// Throttle acceleration curve (speed -> accel)
export function throttleAccel(speed) {
  const s = Math.abs(speed);
  if (s >= CAR.MAX_DRIVE_SPEED) return 0;
  if (s <= 1400) return 1600 - (1600 - 160) * (s / 1400);
  return 160 - 160 * ((s - 1400) / 10);
}

// Turning curvature curve (speed -> curvature 1/uu)
export function turnCurvature(speed) {
  const s = Math.abs(speed);
  const pts = [
    [0, 0.0069],
    [500, 0.00398],
    [1000, 0.00235],
    [1500, 0.001375],
    [1750, 0.0011],
    [2300, 0.00088],
  ];
  if (s <= 0) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i][0]) {
      const [s0, c0] = pts[i - 1];
      const [s1, c1] = pts[i];
      return c0 + (c1 - c0) * ((s - s0) / (s1 - s0));
    }
  }
  return pts[pts.length - 1][1];
}

// Boost pad layout (34 pads). Large pads give 100 boost, small give 12.
// Positions taken from the standard RL field layout (x side, z length).
export const BOOST_PADS = [
  // big pads
  { x: 0, z: -4240, big: true },
  { x: -1792, z: -4184, big: false },
  { x: 1792, z: -4184, big: false },
  { x: -3072, z: -4096, big: true },
  { x: 3072, z: -4096, big: true },
  { x: -940, z: -3308, big: false },
  { x: 940, z: -3308, big: false },
  { x: 0, z: -2816, big: false },
  { x: -3584, z: -2484, big: false },
  { x: 3584, z: -2484, big: false },
  { x: -1788, z: -2300, big: false },
  { x: 1788, z: -2300, big: false },
  { x: -2048, z: -1036, big: false },
  { x: 0, z: -1024, big: false },
  { x: 2048, z: -1036, big: false },
  { x: -3584, z: 0, big: true },
  { x: -1024, z: 0, big: false },
  { x: 1024, z: 0, big: false },
  { x: 3584, z: 0, big: true },
  { x: -2048, z: 1036, big: false },
  { x: 0, z: 1024, big: false },
  { x: 2048, z: 1036, big: false },
  { x: -1788, z: 2300, big: false },
  { x: 1788, z: 2300, big: false },
  { x: -3584, z: 2484, big: false },
  { x: 3584, z: 2484, big: false },
  { x: 0, z: 2816, big: false },
  { x: -940, z: 3308, big: false },
  { x: 940, z: 3308, big: false },
  { x: -3072, z: 4096, big: true },
  { x: 3072, z: 4096, big: true },
  { x: -1792, z: 4184, big: false },
  { x: 1792, z: 4184, big: false },
  { x: 0, z: 4240, big: true },
];

export const BOOST_PAD = {
  BIG_RADIUS: 208,
  SMALL_RADIUS: 144,
  BIG_HEIGHT: 168,
  SMALL_HEIGHT: 165,
  BIG_RESPAWN: 10,
  SMALL_RESPAWN: 4,
  BIG_AMOUNT: 100,
  SMALL_AMOUNT: 12,
};

// Kickoff spawn positions (blue team; orange is mirrored). yaw = radians, 0 = facing +Z
export const KICKOFF_SPAWNS = [
  { x: -2048, z: -2560, yaw: Math.PI * 0.25 }, // right corner (from blue perspective x<0 is left... RL: -2048 is right?)
  { x: 2048, z: -2560, yaw: -Math.PI * 0.25 },
  { x: -256, z: -3840, yaw: 0 },
  { x: 256, z: -3840, yaw: 0 },
  { x: 0, z: -4608, yaw: 0 },
];

export const TEAM = { BLUE: 0, ORANGE: 1 };
export const TEAM_COLORS = [0x2a6cff, 0xff8a1f];
export const TEAM_NAMES = ['BLUE', 'ORANGE'];

export const PHYSICS_DT = 1 / 120;
