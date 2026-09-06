import * as THREE from 'three';
import { CAR } from '../constants.js';

/** Extrude a 2D shape (shape X = car forward, shape Y = up) sideways across the car, centred on x=0. */
function extrudeAlongX(shape, width, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
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
  const h = CAR.HITBOX_HALF; // x 42.1, y 18.1, z 59
  const L = h.z; // half length
  const W = h.x;
  const Hb = h.y;

  // Side profile of the lower body (x = forward, y = up), origin at hitbox centre.
  const body = poly([
    [-L * 0.98, -Hb * 0.55],
    [L * 0.7, -Hb * 0.55],
    [L * 0.98, -Hb * 0.25],
    [L * 1.0, Hb * 0.15],
    [L * 0.72, Hb * 0.55], // bonnet top
    [L * 0.3, Hb * 0.6],
    [-L * 0.6, Hb * 0.6],
    [-L * 0.98, Hb * 0.45],
  ]);
  const bodyGeo = extrudeAlongX(body, W * 2 - 4, 2);

  // Cabin / greenhouse (glass)
  const cabin = poly([
    [L * 0.34, Hb * 0.55],
    [-L * 0.02, Hb * 1.42],
    [-L * 0.52, Hb * 1.42],
    [-L * 0.72, Hb * 0.55],
  ]);
  const cabinGeo = extrudeAlongX(cabin, W * 1.5, 1.5);

  // Roof rails / pillars (painted)
  const roof = poly([
    [-L * 0.06, Hb * 1.42],
    [-L * 0.5, Hb * 1.42],
    [-L * 0.55, Hb * 1.6],
    [-L * 0.08, Hb * 1.6],
  ]);
  const roofGeo = extrudeAlongX(roof, W * 1.5 + 2);

  // Side skirts / wheel-arch flares
  const skirt = new THREE.BoxGeometry(6, Hb * 0.6, L * 1.9);
  // Rear arch (Octane's big rear haunch)
  const arch = new THREE.CylinderGeometry(20, 20, 14, 16, 1, false, 0, Math.PI);
  arch.rotateZ(Math.PI / 2);
  arch.rotateY(Math.PI / 2);

  // Splitter
  const splitter = new THREE.BoxGeometry(W * 2.15, 3, 16);
  // Rear wing
  const wing = new THREE.BoxGeometry(W * 2.2, 3.5, 16);
  const strut = new THREE.BoxGeometry(4, Hb * 0.9, 12);
  // Diffuser / rear bumper
  const bumper = new THREE.BoxGeometry(W * 2, Hb * 0.5, 8);

  sharedGeo = { bodyGeo, cabinGeo, roofGeo, skirt, arch, splitter, wing, strut, bumper };
  return sharedGeo;
}

function makeDecalTexture(color, accent) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#' + new THREE.Color(accent).getHexString();
  ctx.fillRect(112, 0, 32, 256);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(60, 0, 12, 256);
  ctx.fillRect(184, 0, 12, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build an Octane-like car mesh. Origin = car physics origin (between the wheels). */
export function buildCarMesh(color, isHuman = false) {
  const g = new THREE.Group();
  const h = CAR.HITBOX_HALF;
  const o = CAR.HITBOX_OFFSET;
  const G = geometries();

  const accent = isHuman ? 0xffffff : 0x0d0f14;
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0.65,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  });
  const decalMat = new THREE.MeshPhysicalMaterial({ map: makeDecalTexture(color, accent), roughness: 0.3, metalness: 0.6, clearcoat: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.65, metalness: 0.5 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.45, metalness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1424, roughness: 0.05, metalness: 0.9, clearcoat: 1 });

  const centre = new THREE.Group();
  centre.position.set(o.x, o.y, o.z);
  g.add(centre);

  const body = new THREE.Mesh(G.bodyGeo, paint);
  body.castShadow = true;
  centre.add(body);

  const cabin = new THREE.Mesh(G.cabinGeo, glass);
  cabin.castShadow = true;
  centre.add(cabin);

  const roof = new THREE.Mesh(G.roofGeo, decalMat);
  centre.add(roof);

  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(G.skirt, carbon);
    skirt.position.set(sx * (h.x - 1), -h.y * 0.35, 0);
    centre.add(skirt);
    // rear haunch
    const arch = new THREE.Mesh(G.arch, paint);
    arch.position.set(sx * (h.x - 4), -h.y * 0.25, -h.z * 0.55);
    arch.scale.set(1, 1.3, 1);
    centre.add(arch);
  }

  const splitter = new THREE.Mesh(G.splitter, carbon);
  splitter.position.set(0, -h.y * 0.6, h.z * 0.9);
  centre.add(splitter);

  const wing = new THREE.Mesh(G.wing, carbon);
  wing.position.set(0, h.y * 1.25, -h.z * 0.92);
  centre.add(wing);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(G.strut, carbon);
    strut.position.set(sx * h.x * 0.75, h.y * 0.85, -h.z * 0.92);
    centre.add(strut);
  }
  const bumper = new THREE.Mesh(G.bumper, carbon);
  bumper.position.set(0, -h.y * 0.35, -h.z * 0.99);
  centre.add(bumper);

  // headlights / taillights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6dc, emissiveIntensity: 3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1a1a, emissiveIntensity: 3 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 3), headMat);
    hl.position.set(sx * h.x * 0.62, h.y * 0.12, h.z * 0.995);
    centre.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(22, 4, 3), tailMat);
    tl.position.set(sx * h.x * 0.55, h.y * 0.25, -h.z * 1.0);
    centre.add(tl);
  }

  // boost nozzle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 12, 12), dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, -h.y * 0.2, -h.z * 1.03);
  centre.add(nozzle);

  // wheels
  const wheels = [];
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bfcc, roughness: 0.25, metalness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.7 });
  CAR.WHEELS.forEach((w, i) => {
    const r = i < 2 ? CAR.WHEEL_RADIUS_FRONT : CAR.WHEEL_RADIUS_BACK;
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 16, 20), tyreMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 17, 12), rimMat);
    rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, 18, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    // spokes
    const spokes = new THREE.Group();
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(17.5, r * 1.1, 3), rimMat);
      sp.rotation.x = (s / 5) * Math.PI;
      spokes.add(sp);
    }
    const spin = new THREE.Group();
    spin.add(tyre, rim, hub, spokes);
    pivot.add(spin);
    g.add(pivot);
    wheels.push({ pivot, spin, front: i < 2 });
  });

  // boost flame (hidden unless boosting)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(10, 80, 12, 1, true), flameMat);
  flame.rotation.x = -Math.PI / 2; // tip points backwards
  flame.position.set(0, -h.y * 0.2, -h.z * 1.03 - 40);
  flame.visible = false;
  centre.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(5.5, 50, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.copy(flame.position);
  flameCore.position.z += 12;
  flameCore.visible = false;
  centre.add(flameCore);
  const flameLight = new THREE.PointLight(0xffa040, 0, 500, 2);
  flameLight.position.set(0, -h.y * 0.2, -h.z * 1.03 - 60);
  centre.add(flameLight);

  // underglow for the human car (helps you find yourself instantly)
  let underglow = null;
  if (isHuman) {
    underglow = new THREE.Mesh(new THREE.PlaneGeometry(h.x * 2.6, h.z * 2.4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    underglow.rotation.x = -Math.PI / 2;
    underglow.position.set(0, -CAR.REST_HEIGHT + 2.5, o.z);
    g.add(underglow);
  }

  // hitbox outline (debug)
  const hitbox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2)), new THREE.LineBasicMaterial({ color: 0x00ff00 }));
  hitbox.position.set(o.x, o.y, o.z);
  hitbox.visible = false;
  g.add(hitbox);

  return { group: g, wheels, flame, flameCore, flameLight, hitbox, paintMat: paint, underglow };
}
