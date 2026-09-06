// ---------------------------------------------------------------------------
// Car catalogue: Rocket League hitbox classes, the cars that use them, and the
// cosmetics (paint / finish / wheels / boost trail / goal explosion) that a
// player picks in the garage.
//
// Hitbox dimensions are the real Psyonix values, in cm (== uu). Only the
// hitbox differs between cars — speed, boost, jump and flip are identical for
// every car, exactly like Rocket League.
// ---------------------------------------------------------------------------

export const HITBOXES = {
  octane: { id: 'octane', name: 'Octane', length: 118.01, width: 84.2, height: 36.16, offsetY: 20.75, offsetZ: 13.88, blurb: 'Tall, forgiving, the all-rounder.' },
  dominus: { id: 'dominus', name: 'Dominus', length: 127.93, width: 83.28, height: 31.32, offsetY: 21.19, offsetZ: 9.01, blurb: 'Long and flat — flicks and dribbles.' },
  breakout: { id: 'breakout', name: 'Breakout', length: 128.93, width: 83.13, height: 29.17, offsetY: 19.93, offsetZ: 14.25, blurb: 'The flattest long hitbox. Hard carries.' },
  plank: { id: 'plank', name: 'Plank', length: 131.21, width: 84.69, height: 18.38, offsetY: 17.74, offsetZ: 14.67, blurb: 'Paper-thin. Pinch king, ceiling hugger.' },
  hybrid: { id: 'hybrid', name: 'Hybrid', length: 124.93, width: 87.09, height: 36.44, offsetY: 23.93, offsetZ: 11.05, blurb: 'Halfway between Octane and Dominus.' },
  merc: { id: 'merc', name: 'Merc', length: 117.79, width: 92.33, height: 47.26, offsetY: 25.34, offsetZ: 6.05, blurb: 'Tallest and widest. Aerial 50/50 machine.' },
};

/** half extents + centre offset for a hitbox id (uu, y-up, +z forward) */
export function hitboxOf(id) {
  const h = HITBOXES[id] || HITBOXES.octane;
  return {
    id: h.id,
    half: { x: h.width / 2, y: h.height / 2, z: h.length / 2 },
    offset: { x: 0, y: h.offsetY, z: h.offsetZ },
  };
}

// `body` picks the silhouette the mesh builder draws for that hitbox.
export const CARS = [
  { id: 'octane', name: 'Octane', hitbox: 'octane', body: 'octane', rarity: 'Import', desc: 'The car the game is balanced around. Tall hitbox, easy 50/50s.' },
  { id: 'fennec', name: 'Fennec', hitbox: 'octane', body: 'suv', rarity: 'Import', desc: 'Octane hitbox with a squared-off body. Favourite of pros.' },
  { id: 'octanezsr', name: 'Octane ZSR', hitbox: 'octane', body: 'hatch', rarity: 'Limited', desc: 'Same hitbox, sharper nose. Looks fast, is fast.' },
  { id: 'dominus', name: 'Dominus', hitbox: 'dominus', body: 'wedge', rarity: 'Import', desc: 'Long flat hitbox. Dribbles and flicks feel enormous.' },
  { id: 'charger', name: '69 Charger', hitbox: 'dominus', body: 'muscle', rarity: 'Import', desc: 'Dominus hitbox, muscle-car roofline. Kickoff monster.' },
  { id: 'aftershock', name: 'Aftershock', hitbox: 'dominus', body: 'arrow', rarity: 'Premium', desc: 'Dominus hitbox in a low arrow shape. Clean hits.' },
  { id: 'batmobile', name: 'Batmobile 2016', hitbox: 'plank', body: 'bat', rarity: 'Black Market', desc: 'Plank hitbox. Pinches and ceiling shots that nobody reads.' },
  { id: 'breakout', name: 'Breakout Type-S', hitbox: 'breakout', body: 'arrow', rarity: 'Import', desc: 'Lowest hitbox. Powerful flicks, brutal ceiling carries.' },
  { id: 'roadhog', name: 'Road Hog XL', hitbox: 'hybrid', body: 'truck', rarity: 'Premium', desc: 'Hybrid hitbox with a boxy body. Great aerials.' },
  { id: 'mantis', name: 'Mantis', hitbox: 'hybrid', body: 'arrow', rarity: 'Import', desc: 'Hybrid hitbox, long nose. Reads the ball early.' },
  { id: 'merc', name: 'Merc', hitbox: 'merc', body: 'van', rarity: 'Import', desc: 'Biggest hitbox in the game. Wins every 50/50 you commit to.' },
  { id: 'endo', name: 'Endo', hitbox: 'hybrid', body: 'hatch', rarity: 'Limited', desc: 'Hybrid hitbox, compact hatch. Quick to reposition.' },
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

// ---------------------------------------------------------------------------
// cosmetics
// ---------------------------------------------------------------------------
export const PAINT_COLORS = [
  { id: 'crimson', name: 'Crimson', hex: 0xc8102e },
  { id: 'burntsienna', name: 'Burnt Sienna', hex: 0x9c4a1a },
  { id: 'saffron', name: 'Saffron', hex: 0xf2a900 },
  { id: 'lime', name: 'Lime', hex: 0x86c02f },
  { id: 'forest', name: 'Forest Green', hex: 0x1d6f42 },
  { id: 'teal', name: 'Teal', hex: 0x00a693 },
  { id: 'cobalt', name: 'Cobalt', hex: 0x1f5fd6 },
  { id: 'sky', name: 'Sky Blue', hex: 0x4fb8ff },
  { id: 'navy', name: 'Navy', hex: 0x152a55 },
  { id: 'violet', name: 'Violet', hex: 0x6b3fa0 },
  { id: 'magenta', name: 'Magenta', hex: 0xd02090 },
  { id: 'pink', name: 'Pink', hex: 0xff8fc7 },
  { id: 'black', name: 'Black', hex: 0x0d0f14 },
  { id: 'grey', name: 'Titanium', hex: 0x7a828f },
  { id: 'white', name: 'White', hex: 0xeef1f7 },
  { id: 'bronze', name: 'Bronze', hex: 0x8c5a2b },
  { id: 'silver', name: 'Silver', hex: 0xb9bfcc },
  { id: 'gold', name: 'Gold', hex: 0xd4af37 },
  { id: 'orange', name: 'Orange', hex: 0xff6b1a },
  { id: 'ice', name: 'Ice', hex: 0xbfe9ff },
];

export const FINISHES = [
  { id: 'glossy', name: 'Glossy', roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05, env: 1.35 },
  { id: 'semigloss', name: 'Semi-Gloss', roughness: 0.34, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, env: 1.1 },
  { id: 'metalflake', name: 'Metalflake', roughness: 0.2, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.12, env: 1.6 },
  { id: 'pearlescent', name: 'Pearlescent', roughness: 0.14, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.9, shift: 0.12 },
  { id: 'brushed', name: 'Brushed Metal', roughness: 0.44, metalness: 0.95, clearcoat: 0.25, clearcoatRoughness: 0.4, env: 1.4 },
  { id: 'matte', name: 'Matte', roughness: 0.88, metalness: 0.06, clearcoat: 0, clearcoatRoughness: 0.9, env: 0.7 },
  { id: 'carbon', name: 'Carbon Fiber', roughness: 0.3, metalness: 0.65, clearcoat: 1, clearcoatRoughness: 0.06, env: 1.5, carbon: true },
  { id: 'chrome', name: 'Chrome', roughness: 0.08, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.05, env: 2.2 },
];

export const WHEELS = [
  { id: 'spoke', name: 'Spoked', spokes: 3, rim: 0xb9bfcc, depth: 0.64 },
  { id: 'star', name: 'Star', spokes: 5, rim: 0xd6dbe6, depth: 0.58 },
  { id: 'dish', name: 'Deep Dish', spokes: 8, rim: 0xe8e2c8, depth: 0.8 },
  { id: 'aero', name: 'Aero', spokes: 0, rim: 0x2a2f3a, depth: 0.9 },
  { id: 'offroad', name: 'Off-Road', spokes: 4, rim: 0x6a6f7a, depth: 0.5, fat: true },
  { id: 'neon', name: 'Neon', spokes: 6, rim: 0x9fe8ff, depth: 0.6, glow: true },
];

export const BOOST_TRAILS = [
  { id: 'default', name: 'Standard', color: 0xffa030, core: 0xfff2d0 },
  { id: 'blue', name: 'Ion', color: 0x2fa9ff, core: 0xd6f2ff },
  { id: 'green', name: 'Toxic', color: 0x54ff6a, core: 0xe8ffe8 },
  { id: 'purple', name: 'Vortex', color: 0xb04dff, core: 0xf0dcff },
  { id: 'red', name: 'Inferno', color: 0xff3b2f, core: 0xffd9c0 },
  { id: 'ice', name: 'Frostbite', color: 0x9ff0ff, core: 0xffffff },
  { id: 'gold', name: 'Golden', color: 0xffd24a, core: 0xfffbe0 },
  { id: 'pink', name: 'Bubblegum', color: 0xff6fc8, core: 0xffe0f4 },
];

export const GOAL_EXPLOSIONS = [
  { id: 'default', name: 'Default', blurb: 'Shockwave, sparks and a light pillar.' },
  { id: 'fireworks', name: 'Fireworks', blurb: 'Rockets that bloom over the goal.' },
  { id: 'confetti', name: 'Confetti', blurb: 'Team-coloured confetti rain.' },
  { id: 'shockwave', name: 'Supernova', blurb: 'One enormous white-hot blast.' },
  { id: 'lightning', name: 'Lightning', blurb: 'Strobe flashes and electric arcs.' },
];

export const RARITY_COLORS = {
  Import: '#5b9bff',
  Premium: '#7fd6ff',
  Limited: '#c58bff',
  'Black Market': '#ff8a1f',
};

// ---------------------------------------------------------------------------
/**
 * Normalise a stored spec (from localStorage / settings) into a full spec.
 * Accepts either raw ids ('octane', 'glossy') or an already-resolved spec, so
 * passing `car.spec` back through is safe.
 */
export function resolveSpec(spec = {}) {
  const carId = spec.preset ? spec.preset.id : spec.car || 'octane';
  const car = carById(carId);
  const byId = (list, value, fallback) => {
    const id = value && typeof value === 'object' ? value.id : value;
    return list.find((x) => x.id === id) || fallback;
  };
  return {
    car: car.id,
    hitbox: hitboxOf(car.hitbox),
    preset: car,
    primary: typeof spec.primary === 'number' ? spec.primary : PAINT_COLORS[12].hex,
    secondary: typeof spec.secondary === 'number' ? spec.secondary : PAINT_COLORS[14].hex,
    finish: byId(FINISHES, spec.finish, FINISHES[0]),
    wheels: byId(WHEELS, spec.wheels, WHEELS[0]),
    trail: byId(BOOST_TRAILS, spec.trail, BOOST_TRAILS[0]),
    explosion: byId(GOAL_EXPLOSIONS, spec.explosion, GOAL_EXPLOSIONS[0]),
  };
}

export function defaultSpec(team = 0) {
  return resolveSpec({
    car: 'octane',
    primary: team === 0 ? 0x2a6cff : 0xff8a1f,
    secondary: 0x11141c,
    finish: 'glossy',
    wheels: 'spoke',
    trail: 'default',
    explosion: 'default',
  });
}

/** Random cosmetics for a bot, biased toward its team colour so teams read fast. */
export function botSpec(team, index = 0) {
  const car = CARS[(index * 5 + (team ? 3 : 1)) % CARS.length];
  const base = team === 0 ? PAINT_COLORS[8] : PAINT_COLORS[18];
  const accent = PAINT_COLORS[(index * 7 + 4) % PAINT_COLORS.length];
  return resolveSpec({
    car: car.id,
    primary: index === 0 ? base.hex : accent.hex,
    secondary: base.hex,
    finish: FINISHES[index % FINISHES.length].id,
    wheels: WHEELS[(index + 1) % WHEELS.length].id,
    trail: BOOST_TRAILS[(index + 1) % BOOST_TRAILS.length].id,
    explosion: GOAL_EXPLOSIONS[index % GOAL_EXPLOSIONS.length].id,
  });
}
