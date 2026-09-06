import * as THREE from 'three';
import { CAR } from '../constants.js';

/**
 * Detailed Octane-style car. Origin = car physics origin (between the wheels),
 * forward = +Z, up = +Y. All sizes in uu (hitbox half extents: x 42, y 18, z 59).
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

let sharedGeo = null;
function geometries() {
  if (sharedGeo) return sharedGeo;
  const h = CAR.HITBOX_HALF;
  const L = h.z;
  const W = h.x;
  const Hb = h.y;

  // Main body side profile — a smoother, sportier line than the old block.
  const body = poly([
    [-L * 1.0, -Hb * 0.5],
    [L * 0.55, -Hb * 0.52],
    [L * 0.92, -Hb * 0.34],
    [L * 1.0, -Hb * 0.02],
    [L * 0.97, Hb * 0.22],
    [L * 0.72, Hb * 0.48], // nose top
    [L * 0.42, Hb * 0.56], // hood
    [-L * 0.35, Hb * 0.62], // shoulder to cabin
    [-L * 0.92, Hb * 0.58],
    [-L * 1.0, Hb * 0.3],
  ]);
  const bodyGeo = extrudeAlongX(body, W * 1.9, 2.4);

  // Cabin greenhouse (glass) — raked windshield, fastback rear.
  const cabin = poly([
    [L * 0.5, Hb * 0.52],
    [L * 0.18, Hb * 1.06],
    [-L * 0.28, Hb * 1.28],
    [-L * 0.62, Hb * 1.24],
    [-L * 0.78, Hb * 0.55],
  ]);
  const cabinGeo = extrudeAlongX(cabin, W * 1.44, 1.6);

  // Painted roof skin over the greenhouse.
  const roof = poly([
    [L * 0.235, Hb * 1.09],
    [-L * 0.255, Hb * 1.31],
    [-L * 0.585, Hb * 1.28],
    [-L * 0.72, Hb * 1.16],
    [L * 0.16, Hb * 0.98],
  ]);
  const roofGeo = extrudeAlongX(roof, W * 1.5, 1.2);

  // Hood scoop
  const scoop = new THREE.BoxGeometry(W * 0.7, 5, 26);
  // Rear deck / engine cover
  const deck = new THREE.BoxGeometry(W * 1.35, 6, L * 0.4);

  sharedGeo = { bodyGeo, cabinGeo, roofGeo, scoop, deck };
  return sharedGeo;
}

function stripeTexture(color, accent) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const paint = '#' + new THREE.Color(color).getHexString();
  const acc = '#' + new THREE.Color(accent).getHexString();
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, 256, 256);
  // twin racing stripes down the middle (maps along the car's forward axis)
  ctx.fillStyle = acc;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(96, 0, 22, 256);
  ctx.fillRect(142, 0, 22, 256);
  ctx.globalAlpha = 0.25;
  ctx.fillRect(0, 236, 256, 20);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildCarMesh(color, isHuman = false) {
  const g = new THREE.Group();
  const h = CAR.HITBOX_HALF;
  const o = CAR.HITBOX_OFFSET;
  const G = geometries();

  const accent = isHuman ? 0xf4f6ff : 0x11141c;
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.22,
    metalness: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.35,
  });
  const paintDark = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).multiplyScalar(0.55),
    roughness: 0.3,
    metalness: 0.6,
    clearcoat: 0.9,
    envMapIntensity: 1.1,
  });
  const stripeMat = new THREE.MeshPhysicalMaterial({
    map: stripeTexture(color, accent),
    roughness: 0.24,
    metalness: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.3,
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

  const body = new THREE.Mesh(G.bodyGeo, paint);
  body.castShadow = true;
  centre.add(body);

  const cabin = new THREE.Mesh(G.cabinGeo, glass);
  cabin.castShadow = true;
  centre.add(cabin);

  const roof = new THREE.Mesh(G.roofGeo, stripeMat);
  centre.add(roof);

  // hood scoop + rear deck
  const scoop = new THREE.Mesh(G.scoop, carbon);
  scoop.position.set(0, h.y * 0.58, h.z * 0.52);
  centre.add(scoop);
  const deck = new THREE.Mesh(G.deck, paintDark);
  deck.position.set(0, h.y * 0.62, -h.z * 0.62);
  centre.add(deck);

  // ---- aero: splitter, skirts, arches, diffuser, wing --------------------
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 2.24, 3.5, 20), carbon);
  splitter.position.set(0, -h.y * 0.58, h.z * 0.94);
  centre.add(splitter);
  // canards
  for (const sx of [-1, 1]) {
    const canard = new THREE.Mesh(new THREE.BoxGeometry(14, 2.5, 16), carbon);
    canard.rotation.z = sx * 0.25;
    canard.position.set(sx * (W2(h) + 1), h.y * 0.05, h.z * 0.88);
    centre.add(canard);
  }
  // side skirts
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(7, h.y * 0.55, L2(h) * 1.55), carbon);
    skirt.position.set(sx * (h.x - 2), -h.y * 0.32, -h.z * 0.02);
    centre.add(skirt);
    // mirrors
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.2), dark);
    stalk.position.set(sx * (W2(h) * 0.95), h.y * 0.85, h.z * 0.28);
    centre.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 3.2), paintDark);
    mirror.position.set(sx * (W2(h) + 5), h.y * 0.9, h.z * 0.27);
    centre.add(mirror);
    // wheel arch flares
    for (const fz of [1, -1]) {
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 13, 14, 1, true, 0, Math.PI), paint);
      arch.rotation.z = Math.PI / 2;
      arch.rotation.x = fz > 0 ? 0 : Math.PI;
      arch.position.set(sx * (h.x - 4), -h.y * 0.2 + 3, fz * (h.z * (fz > 0 ? 0.58 : 0.42)));
      centre.add(arch);
    }
  }
  // rear diffuser + fins
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 1.9, h.y * 0.4, 12), carbon);
  diffuser.position.set(0, -h.y * 0.52, -h.z * 0.99);
  centre.add(diffuser);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.2, h.y * 0.42, 13), carbon);
    fin.position.set(i * 13, -h.y * 0.5, -h.z * 1.0);
    centre.add(fin);
  }
  // rear wing: plank + struts + endplates
  const wing = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 2.16, 3, 18), carbon);
  wing.position.set(0, h.y * 1.28, -h.z * 0.9);
  centre.add(wing);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(4.5, h.y * 0.72, 12), carbon);
    strut.position.set(sx * h.x * 0.68, h.y * 0.92, -h.z * 0.9);
    centre.add(strut);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.5, h.y * 0.66, 26), paintDark);
    plate.position.set(sx * W2(h) * 1.08, h.y * 1.28, -h.z * 0.9);
    centre.add(plate);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 1.95, h.y * 0.5, 8), paintDark);
  bumper.position.set(0, -h.y * 0.28, -h.z * 1.0);
  centre.add(bumper);

  // ---- lights -------------------------------------------------------------
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd8ecff, emissiveIntensity: 4, toneMapped: false });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 2.5, toneMapped: false });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2a1a, emissiveIntensity: 3.2, toneMapped: false });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(17, 4.5, 3), headMat);
    hl.position.set(sx * h.x * 0.62, h.y * 0.16, h.z * 0.985);
    centre.add(hl);
    const drl = new THREE.Mesh(new THREE.BoxGeometry(4, 9, 2.5), drlMat);
    drl.position.set(sx * h.x * 0.8, h.y * 0.02, h.z * 0.96);
    centre.add(drl);
  }
  // full-width tail light bar
  const tail = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 1.62, 4, 2.5), tailMat);
  tail.position.set(0, h.y * 0.28, -h.z * 1.005);
  centre.add(tail);
  // brake glow (intensity driven while braking/reversing)
  const brakeMat = tailMat.clone();
  const brake = new THREE.Mesh(new THREE.BoxGeometry(W2(h) * 1.3, 2.5, 2), brakeMat);
  brake.position.set(0, h.y * 0.12, -h.z * 1.006);
  centre.add(brake);

  // ---- boost nozzles + flame ----------------------------------------------
  for (const sx of [-1, 1]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 13, 12), chrome);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx * 12, -h.y * 0.16, -h.z * 1.01);
    centre.add(nozzle);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(5.2, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, toneMapped: false, transparent: true, opacity: 0.85 }));
    glow.position.set(sx * 12, -h.y * 0.16, -h.z * 1.08);
    centre.add(glow);
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(11, 92, 12, 1, true), flameMat);
  flame.rotation.x = -Math.PI / 2; // tip points backwards
  flame.position.set(0, -h.y * 0.16, -h.z * 1.03 - 46);
  flame.visible = false;
  centre.add(flame);
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(6, 58, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.set(0, -h.y * 0.16, -h.z * 1.03 - 30);
  flameCore.visible = false;
  centre.add(flameCore);
  const flameLight = new THREE.PointLight(0xffa040, 0, 520, 2);
  flameLight.position.set(0, -h.y * 0.16, -h.z * 1.03 - 60);
  centre.add(flameLight);

  // roof antenna with lit tip
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 26, 6), dark);
  antenna.position.set(0, h.y * 1.42, -h.z * 0.5);
  centre.add(antenna);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4455, toneMapped: false }));
  antennaTip.position.set(0, h.y * 1.42 + 14, -h.z * 0.5);
  centre.add(antennaTip);

  // ---- wheels ---------------------------------------------------------------
  const wheels = [];
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.94, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bfcc, roughness: 0.22, metalness: 0.95, envMapIntensity: 1.5 });
  const hubMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.7 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.4, metalness: 0.9 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.15), roughness: 0.35, metalness: 0.6, emissive: color, emissiveIntensity: 0.25 });
  const tyreGeoFront = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_FRONT, CAR.WHEEL_RADIUS_FRONT, 15, 22);
  const tyreGeoBack = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_BACK, CAR.WHEEL_RADIUS_BACK, 17, 22);
  const rimGeoFront = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_FRONT * 0.64, CAR.WHEEL_RADIUS_FRONT * 0.64, 15.5, 16);
  const rimGeoBack = new THREE.CylinderGeometry(CAR.WHEEL_RADIUS_BACK * 0.64, CAR.WHEEL_RADIUS_BACK * 0.64, 17.5, 16);
  CAR.WHEELS.forEach((w, i) => {
    const front = i < 2;
    const r = front ? CAR.WHEEL_RADIUS_FRONT : CAR.WHEEL_RADIUS_BACK;
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(front ? tyreGeoFront : tyreGeoBack, tyreMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const rim = new THREE.Mesh(front ? rimGeoFront : rimGeoBack, rimMat);
    rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.24, 18.5, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    // 6-spoke star
    for (let s = 0; s < 3; s++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(17, r * 1.24, 3.2), rimMat);
      spoke.rotation.x = (s / 3) * Math.PI;
      spin.add(spoke);
    }
    // brake disc + caliper (caliper stays on the pivot, not the spin)
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
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isHuman ? 0.5 : 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.set(0, -CAR.REST_HEIGHT + 2.2, o.z);
  g.add(underglow);

  // hitbox outline (debug)
  const hitbox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2)), new THREE.LineBasicMaterial({ color: 0x00ff00 }));
  hitbox.position.set(o.x, o.y, o.z);
  hitbox.visible = false;
  g.add(hitbox);

  return { group: g, wheels, flame, flameCore, flameLight, hitbox, paintMat: paint, underglow, brakeMat };
}

// tiny helpers so the numbers above stay readable
function W2(h) {
  return h.x;
}
function L2(h) {
  return h.z;
}
