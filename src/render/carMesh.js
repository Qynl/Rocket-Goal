import * as THREE from 'three';
import { CAR } from '../constants.js';
import { resolveSpec } from '../cars.js';

/**
 * Car meshes built from the car's real hitbox dimensions, so a Batmobile looks
 * as flat as it drives and a Merc looks as tall as it is. `body` picks the
 * silhouette; cosmetics (paint / finish / wheels / boost trail) come from the
 * garage loadout.
 *
 * Origin = car physics origin (between the wheels), forward = +Z, up = +Y.
 */

function extrudeAlongX(shape, width, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geo.rotateY(-Math.PI / 2); // shape X -> +Z (forward), extrusion Z -> -X
  geo.translate(width / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

function poly(points) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

/** Body side profile per silhouette, normalised against the hitbox (L long, H tall). */
function bodyProfile(body, L, H) {
  const P = {
    // rounded fastback (Octane)
    octane: [
      [-L, -H * 0.5], [L * 0.55, -H * 0.52], [L * 0.92, -H * 0.34], [L, -H * 0.02],
      [L * 0.97, H * 0.22], [L * 0.72, H * 0.48], [L * 0.42, H * 0.56], [-L * 0.35, H * 0.62],
      [-L * 0.92, H * 0.58], [-L, H * 0.3],
    ],
    // boxy SUV (Fennec)
    suv: [
      [-L, -H * 0.52], [L * 0.6, -H * 0.54], [L * 0.98, -H * 0.3], [L, H * 0.02],
      [L * 0.96, H * 0.3], [L * 0.8, H * 0.62], [L * 0.5, H * 0.7], [-L * 0.6, H * 0.7],
      [-L * 0.95, H * 0.66], [-L, H * 0.34],
    ],
    // compact hatch (Octane ZSR / Endo)
    hatch: [
      [-L, -H * 0.5], [L * 0.5, -H * 0.54], [L * 0.94, -H * 0.3], [L, 0],
      [L * 0.95, H * 0.26], [L * 0.7, H * 0.5], [L * 0.4, H * 0.6], [-L * 0.3, H * 0.66],
      [-L * 0.9, H * 0.64], [-L, H * 0.44],
    ],
    // low long wedge (Dominus)
    wedge: [
      [-L, -H * 0.5], [L * 0.5, -H * 0.5], [L * 0.98, -H * 0.36], [L, H * 0.05],
      [L * 0.98, H * 0.3], [L * 0.74, H * 0.52], [L * 0.3, H * 0.58], [-L * 0.5, H * 0.6],
      [-L * 0.95, H * 0.5], [-L, H * 0.26],
    ],
    // muscle car with a long hood and a stubby cabin (69 Charger)
    muscle: [
      [-L, -H * 0.5], [L * 0.45, -H * 0.54], [L * 0.96, -H * 0.42], [L, -H * 0.05],
      [L * 0.99, H * 0.2], [L * 0.8, H * 0.42], [L * 0.34, H * 0.5], [-L * 0.1, H * 0.62],
      [-L * 0.72, H * 0.62], [-L * 0.98, H * 0.44], [-L, H * 0.3],
    ],
    // sharp arrow nose, no real cabin (Aftershock / Breakout / Mantis)
    arrow: [
      [-L, -H * 0.44], [L * 0.45, -H * 0.5], [L * 0.99, -H * 0.28], [L, H * 0.12],
      [L * 0.9, H * 0.4], [L * 0.5, H * 0.5], [-L * 0.2, H * 0.54], [-L * 0.85, H * 0.46],
      [-L, H * 0.2],
    ],
    // batmobile: paper thin with a canopy
    bat: [
      [-L, -H * 0.3], [L * 0.4, -H * 0.5], [L * 0.99, -H * 0.2], [L, H * 0.2],
      [L * 0.85, H * 0.5], [L * 0.35, H * 0.7], [-L * 0.3, H * 0.66], [-L * 0.9, H * 0.5],
      [-L, H * 0.16],
    ],
    // pickup / truck (Road Hog XL)
    truck: [
      [-L, -H * 0.52], [L * 0.55, -H * 0.54], [L * 0.97, -H * 0.34], [L, 0],
      [L * 0.98, H * 0.3], [L * 0.86, H * 0.66], [L * 0.4, H * 0.72], [-L * 0.55, H * 0.72],
      [-L * 0.95, H * 0.68], [-L, H * 0.36],
    ],
    // van (Merc) — tall box, short nose
    van: [
      [-L, -H * 0.5], [L * 0.4, -H * 0.52], [L * 0.9, -H * 0.4], [L, -H * 0.05],
      [L * 0.98, H * 0.25], [L * 0.82, H * 0.55], [L * 0.45, H * 0.66], [-L * 0.55, H * 0.66],
      [-L * 0.95, H * 0.62], [-L, H * 0.36],
    ],
  };
  return P[body] || P.octane;
}

/** Glass / roofline shape per silhouette. */
function cabinProfile(body, L, H) {
  const P = {
    octane: [[L * 0.5, H * 0.52], [L * 0.18, H * 1.06], [-L * 0.28, H * 1.28], [-L * 0.62, H * 1.24], [-L * 0.78, H * 0.55]],
    suv: [[L * 0.52, H * 0.62], [L * 0.34, H * 1.16], [-L * 0.42, H * 1.22], [-L * 0.8, H * 1.1], [-L * 0.86, H * 0.64]],
    hatch: [[L * 0.44, H * 0.5], [L * 0.2, H * 1.02], [-L * 0.22, H * 1.08], [-L * 0.56, H * 1.04], [-L * 0.74, H * 0.6]],
    wedge: [[L * 0.3, H * 0.52], [L * 0.06, H * 0.94], [-L * 0.3, H * 1.0], [-L * 0.6, H * 0.92], [-L * 0.72, H * 0.54]],
    muscle: [[L * 0.34, H * 0.42], [L * 0.12, H * 0.96], [-L * 0.28, H * 1.02], [-L * 0.62, H * 0.94], [-L * 0.7, H * 0.5]],
    arrow: [[L * 0.24, H * 0.44], [L * 0.02, H * 0.8], [-L * 0.28, H * 0.84], [-L * 0.5, H * 0.76], [-L * 0.6, H * 0.46]],
    bat: [[L * 0.1, H * 0.5], [-L * 0.02, H * 0.86], [-L * 0.3, H * 0.9], [-L * 0.46, H * 0.78], [-L * 0.5, H * 0.5]],
    truck: [[L * 0.36, H * 0.6], [L * 0.16, H * 1.24], [-L * 0.3, H * 1.3], [-L * 0.6, H * 1.22], [-L * 0.7, H * 0.66]],
    van: [[L * 0.34, H * 0.5], [L * 0.18, H * 1.12], [-L * 0.4, H * 1.16], [-L * 0.72, H * 1.08], [-L * 0.8, H * 0.56]],
  };
  return P[body] || P.octane;
}

// ---------------------------------------------------------------------------
// cosmetic materials
// ---------------------------------------------------------------------------
const texCache = new Map();

function stripeTexture(primary, secondary) {
  const key = `stripe-${primary}-${secondary}`;
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const paint = '#' + new THREE.Color(primary).getHexString();
  const acc = '#' + new THREE.Color(secondary).getHexString();
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = acc;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(96, 0, 22, 256);
  ctx.fillRect(142, 0, 22, 256);
  ctx.globalAlpha = 0.25;
  ctx.fillRect(0, 236, 256, 20);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

function carbonTexture() {
  if (texCache.has('carbon')) return texCache.get('carbon');
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0c11';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.fillRect(x, y, 8, 4);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set('carbon', tex);
  return tex;
}

function paintMaterial(color, finish) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: finish.roughness,
    metalness: finish.metalness,
    clearcoat: finish.clearcoat,
    clearcoatRoughness: finish.clearcoatRoughness,
    envMapIntensity: finish.env,
  });
  if (finish.shift) {
    mat.iridescence = 0.6;
    mat.iridescenceIOR = 1.4;
  }
  if (finish.carbon) mat.map = carbonTexture();
  return mat;
}

// ---------------------------------------------------------------------------
export function buildCarMesh(spec, isHuman = false, teamColor = 0x2a6cff) {
  const s = resolveSpec(spec || {});
  const g = new THREE.Group();
  const h = s.hitbox.half;
  const o = s.hitbox.offset;
  const L = h.z;
  const W = h.x;
  const H = h.y;
  const body = s.preset.body;

  const paint = paintMaterial(s.primary, s.finish);
  const paintDark = paintMaterial(new THREE.Color(s.primary).multiplyScalar(0.55), s.finish);
  const stripeMat = new THREE.MeshPhysicalMaterial({
    map: stripeTexture(s.primary, s.secondary),
    roughness: s.finish.roughness + 0.04,
    metalness: s.finish.metalness,
    clearcoat: s.finish.clearcoat,
    envMapIntensity: s.finish.env,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.42, metalness: 0.72, envMapIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171a21, roughness: 0.6, metalness: 0.45 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x101c2e,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    transparent: true,
    opacity: 0.92,
    envMapIntensity: 1.6,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, roughness: 0.18, metalness: 1, envMapIntensity: 1.4 });

  const centre = new THREE.Group();
  centre.position.set(o.x, o.y, o.z);
  g.add(centre);

  // ---- body + glass ---------------------------------------------------------
  const widthScale = { bat: 1.7, plank: 1.7, van: 1.95, truck: 1.95, suv: 1.92, arrow: 1.85 }[body] || 1.9;
  const bodyMesh = new THREE.Mesh(extrudeAlongX(poly(bodyProfile(body, L, H)), W * widthScale, 2.4), paint);
  bodyMesh.castShadow = true;
  centre.add(bodyMesh);

  const cabinMesh = new THREE.Mesh(extrudeAlongX(poly(cabinProfile(body, L, H)), W * (body === 'van' || body === 'truck' ? 1.62 : 1.44), 1.6), glass);
  cabinMesh.castShadow = true;
  centre.add(cabinMesh);

  // painted roof skin over the greenhouse
  const cp = cabinProfile(body, L, H);
  const roofPts = cp.map(([x, y], i) => [x * (i > 0 && i < 4 ? 0.92 : 0.8), y * 1.02]);
  const roof = new THREE.Mesh(extrudeAlongX(poly(roofPts), W * 1.5, 1.2), stripeMat);
  centre.add(roof);

  // hood scoop + rear deck
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 5, 26), carbon);
  scoop.position.set(0, H * 0.6, L * 0.52);
  centre.add(scoop);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 1.35, 6, L * 0.4), paintDark);
  deck.position.set(0, H * 0.62, -L * 0.62);
  centre.add(deck);

  // ---- aero -----------------------------------------------------------------
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 2.24, 3.5, 20), carbon);
  splitter.position.set(0, -H * 0.58, L * 0.94);
  centre.add(splitter);
  for (const sx of [-1, 1]) {
    const canard = new THREE.Mesh(new THREE.BoxGeometry(14, 2.5, 16), carbon);
    canard.rotation.z = sx * 0.25;
    canard.position.set(sx * (W + 1), H * 0.05, L * 0.88);
    centre.add(canard);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(7, H * 0.55, L * 1.55), carbon);
    skirt.position.set(sx * (h.x - 2), -H * 0.32, -L * 0.02);
    centre.add(skirt);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.2), dark);
    stalk.position.set(sx * (W * 0.95), H * 0.85, L * 0.28);
    centre.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 3.2), paintDark);
    mirror.position.set(sx * (W + 5), H * 0.9, L * 0.27);
    centre.add(mirror);
    for (const fz of [1, -1]) {
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 13, 14, 1, true, 0, Math.PI), paint);
      arch.rotation.z = Math.PI / 2;
      arch.rotation.x = fz > 0 ? 0 : Math.PI;
      arch.position.set(sx * (h.x - 4), -H * 0.2 + 3, fz * (L * (fz > 0 ? 0.58 : 0.42)));
      centre.add(arch);
    }
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 1.9, H * 0.4, 12), carbon);
  diffuser.position.set(0, -H * 0.52, -L * 0.99);
  centre.add(diffuser);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.2, H * 0.42, 13), carbon);
    fin.position.set(i * 13, -H * 0.5, -L * 1.0);
    centre.add(fin);
  }

  // rear wing — tall for the tall hitboxes, a flat plank for the Batmobile
  const wingY = body === 'bat' ? H * 0.9 : H * 1.28;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 2.16, 3, 18), carbon);
  wing.position.set(0, wingY, -L * 0.9);
  centre.add(wing);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(4.5, H * 0.72, 12), carbon);
    strut.position.set(sx * h.x * 0.68, wingY - H * 0.36, -L * 0.9);
    centre.add(strut);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.5, H * 0.66, 26), paintDark);
    plate.position.set(sx * W * 1.08, wingY, -L * 0.9);
    centre.add(plate);
  }
  if (body === 'bat') {
    // bat wings out at the sides
    for (const sx of [-1, 1]) {
      const batWing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 2.5, L * 0.9), paintDark);
      batWing.position.set(sx * W * 1.25, H * 0.2, -L * 0.2);
      batWing.rotation.z = sx * -0.12;
      centre.add(batWing);
    }
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(W * 1.95, H * 0.5, 8), paintDark);
  bumper.position.set(0, -H * 0.28, -L * 1.0);
  centre.add(bumper);

  // ---- lights ---------------------------------------------------------------
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8ecff, emissiveIntensity: 4, toneMapped: false });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 2.5, toneMapped: false });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2a1a, emissiveIntensity: 3.2, toneMapped: false });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(Math.min(17, W * 0.42), 4.5, 3), headMat);
    hl.position.set(sx * h.x * 0.62, H * 0.16, L * 0.985);
    centre.add(hl);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(4, Math.min(9, H * 0.5), 2.5), drlMat);
    drl.position.set(sx * h.x * 0.8, H * 0.02, L * 0.96);
    centre.add(drl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(W * 1.62, 4, 2.5), tailMat);
  tail.position.set(0, H * 0.28, -L * 1.005);
  centre.add(tail);
  const brakeMat = tailMat.clone();
  const brake = new THREE.Mesh(new THREE.BoxGeometry(W * 1.3, 2.5, 2), brakeMat);
  brake.position.set(0, H * 0.12, -L * 1.006);
  centre.add(brake);

  // ---- boost nozzles + flame (colour = boost trail cosmetic) ----------------
  const trailColor = s.trail.color;
  for (const sx of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 13, 12), chrome);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx * 12, -H * 0.16, -L * 1.01);
    centre.add(nozzle);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(5.2, 12), new THREE.MeshBasicMaterial({ color: trailColor, toneMapped: false, transparent: true, opacity: 0.85 }));
    glow.position.set(sx * 12, -H * 0.16, -L * 1.08);
    centre.add(glow);
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: trailColor, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(11, 92, 12, 1, true), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, -H * 0.16, -L * 1.03 - 46);
  flame.visible = false;
  centre.add(flame);
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(6, 58, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: s.trail.core, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.set(0, -H * 0.16, -L * 1.03 - 30);
  flameCore.visible = false;
  centre.add(flameCore);
  const flameLight = new THREE.PointLight(trailColor, 0, 520, 2);
  flameLight.position.set(0, -H * 0.16, -L * 1.03 - 60);
  centre.add(flameLight);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 26, 6), dark);
  antenna.position.set(0, H * 1.42, -L * 0.5);
  centre.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4455, toneMapped: false }));
  antennaTip.position.set(0, H * 1.42 + 14, -L * 0.5);
  centre.add(antennaTip);

  // ---- wheels (style is a cosmetic too) -------------------------------------
  const wheels = [];
  const w = s.wheels;
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.94, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: w.rim,
    roughness: w.glow ? 0.2 : 0.22,
    metalness: 0.95,
    envMapIntensity: 1.5,
    emissive: w.glow ? w.rim : 0x000000,
    emissiveIntensity: w.glow ? 1.6 : 0,
  });
  const hubMat = new THREE.MeshStandardMaterial({ color: s.primary, roughness: 0.3, metalness: 0.7 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.4, metalness: 0.9 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.secondary).lerp(new THREE.Color(0xffffff), 0.15), roughness: 0.35, metalness: 0.6, emissive: s.secondary, emissiveIntensity: 0.25 });
  const fat = w.fat ? 1.35 : 1;
  const tyreGeoFront = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_FRONT * fat, CAR.WHEEL_RADIUS_FRONT * fat, 15 * fat, 22);
  const tyreGeoBack = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_BACK * fat, CAR.WHEEL_RADIUS_BACK * fat, 17 * fat, 22);
  const rimGeoFront = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_FRONT * w.depth, CAR.WHEEL_RADIUS_FRONT * w.depth, 15.5 * fat, 16);
  const rimGeoBack = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_BACK * w.depth, CAR.WHEEL_RADIUS_BACK * w.depth, 17.5 * fat, 16);
  CAR.WHEELS.forEach((wp, i) => {
    const front = i < 2;
    const r = (front ? CAR.WHEEL_RADIUS_FRONT : CAR.WHEEL_RADIUS_BACK) * fat;
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, wp.y, wp.z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(front ? tyreGeoFront : tyreGeoBack, tyreMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const rim = new THREE.Mesh(front ? rimGeoFront : rimGeoBack, rimMat);
    rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.24, 18.5 * fat, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    if (w.spokes > 0) {
      const spokes = Math.max(1, Math.round(w.spokes / 2));
      for (let k = 0; k < spokes; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(17 * fat, r * 1.24, 3.2), rimMat);
        spoke.rotation.x = (k / spokes) * Math.PI;
        spin.add(spoke);
      }
    } else {
      // aero disc
      const disc2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 2, 20), rimMat);
      disc2.rotation.z = Math.PI / 2;
      spin.add(disc2);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 2.4, 18), discMat);
    disc.rotation.z = Math.PI / 2;
    spin.add(disc);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(3.5, r * 0.5, r * 0.34), caliperMat);
    caliper.position.set(0, r * 0.42, front ? -r * 0.35 : r * 0.35);
    pivot.add(caliper);
    spin.add(tyre, rim, hub);
    pivot.add(spin);
    g.add(pivot);
    wheels.push({ pivot, spin, front });
  });

  // underglow (bright for the human car, subtle for bots so teams read fast)
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(h.x * 3.1, h.z * 2.6),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: isHuman ? 0.5 : 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.set(0, -CAR.REST_HEIGHT + 2.2, o.z);
  g.add(underglow);

  // hitbox outline (debug)
  const hitbox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2)), new THREE.LineBasicMaterial({ color: 0x00ff00 }));
  hitbox.position.set(o.x, o.y, o.z);
  hitbox.visible = false;
  g.add(hitbox);

  return { group: g, wheels, flame, flameCore, flameLight, hitbox, paintMat: paint, underglow, brakeMat, trailColor, spec: s };
}
