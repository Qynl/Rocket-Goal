import * as THREE from 'three';
import { ARENA, BOOST_PADS, BOOST_PAD, TEAM_COLORS } from '../constants.js';

const A = ARENA;
const R = A.RAMP_RADIUS;
const SOLID_WALL_TOP = 900; // solid wall panels up to here, glass above (like DFH Stadium)

// ---------------------------------------------------------------------------
// textures (procedural, no assets)
// ---------------------------------------------------------------------------
function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function makeFloorTexture() {
  const size = 2048;
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  // base pitch green
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#1f6b38');
  grad.addColorStop(0.5, '#1a5d30');
  grad.addColorStop(1, '#1f6b38');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  // mowing stripes (two directions -> checker, like DFH)
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.075)';
    ctx.fillRect(0, (i * size) / bands, size, size / bands);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.034)';
    ctx.fillRect((i * size) / bands, 0, size / bands, size);
  }
  // grass noise
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n;
    d[i + 1] += n * 1.25;
    d[i + 2] += n * 0.6;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Centre-circle emblem drawn once (ring + rocket chevrons + wordmark). */
function makeCenterDecal() {
  const S = 1024;
  const cv = canvas(S, S);
  const ctx = cv.getContext('2d');
  const cx = S / 2;
  ctx.translate(cx, cx);
  // outer ring
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(0, 0, 470, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,190,255,0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 440, 0, Math.PI * 2);
  ctx.stroke();
  // rocket chevrons
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-140, s * 130);
    ctx.lineTo(20, 0);
    ctx.lineTo(-140, -s * 130);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(90, 150);
  ctx.lineTo(230, 0);
  ctx.lineTo(90, -150);
  ctx.stroke();
  // wordmark
  ctx.font = 'bold 74px Rajdhani, Arial Narrow, Arial';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText('ROCKET GOAL', 0, 330);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePanelTexture() {
  const cv = canvas(512, 512);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2c3344';
  ctx.fillRect(0, 0, 512, 512);
  // subtle panel plates with brushed gradient
  for (let y = 0; y < 512; y += 128) {
    for (let x = 0; x < 512; x += 256) {
      const ox = (y / 128) % 2 ? 128 : 0;
      const g = 40 + Math.random() * 12;
      const gr = ctx.createLinearGradient(x + ox, y, x + ox + 250, y + 122);
      gr.addColorStop(0, `rgb(${g},${g + 5},${g + 16})`);
      gr.addColorStop(0.5, `rgb(${g + 8},${g + 14},${g + 26})`);
      gr.addColorStop(1, `rgb(${g},${g + 5},${g + 16})`);
      ctx.fillStyle = gr;
      ctx.fillRect(x + ox + 3, y + 3, 250, 122);
    }
  }
  // seams
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  // rivets
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  for (let y = 12; y < 512; y += 128) for (let x = 12; x < 512; x += 64) ctx.fillRect(x, y, 4, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeNetTexture() {
  const cv = canvas(128, 128);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(235,240,255,0.9)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  for (let i = 0; i <= 128; i += 32) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Scrolling LED advertising band. */
function makeAdTexture() {
  const W = 2048;
  const H = 128;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  const msgs = ['ROCKET GOAL', '⚡ SUPERSONIC ⚡', 'ARENA.E2B', 'NICE SHOT!', 'WHAT A SAVE!', 'GG WP', 'ROCKET GOAL', '🚀 EST. 2025 🚀'];
  ctx.fillStyle = '#070a18';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#0d1740');
  grad.addColorStop(0.5, '#12205c');
  grad.addColorStop(1, '#0d1740');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.font = 'bold 66px Rajdhani, Arial Narrow, Arial';
  ctx.textBaseline = 'middle';
  let x = 60;
  for (let i = 0; i < msgs.length * 2; i++) {
    const m = msgs[i % msgs.length];
    ctx.fillStyle = i % 3 === 0 ? '#7fd0ff' : i % 3 === 1 ? '#ffd23f' : '#ff9d5c';
    ctx.fillText(m, x, H / 2 + 4);
    x += ctx.measureText(m).width + 170;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(0.5, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// outline geometry helpers
// ---------------------------------------------------------------------------
export function arenaOutline() {
  const c = A.CORNER_SUM;
  const W = A.HALF_WIDTH;
  const L = A.HALF_LENGTH;
  return [
    [-W, -(c - W)],
    [-(c - L), -L],
    [c - L, -L],
    [W, -(c - W)],
    [W, c - W],
    [c - L, L],
    [-(c - L), L],
    [-W, c - W],
  ];
}

function outlineEdges() {
  const o = arenaOutline();
  const edges = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    if (nx * mx + nz * mz > 0) {
      nx = -nx;
      nz = -nz;
    }
    edges.push({ a, b, nx, nz, len, back: Math.abs(nz) > 0.99 });
  }
  return edges;
}

function insetOutline(edges, s) {
  const n = edges.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const e0 = edges[(i - 1 + n) % n];
    const e1 = edges[i];
    const c0 = e0.nx * e0.a[0] + e0.nz * e0.a[1] + s;
    const c1 = e1.nx * e1.a[0] + e1.nz * e1.a[1] + s;
    const det = e0.nx * e1.nz - e0.nz * e1.nx;
    const x = (c0 * e1.nz - c1 * e0.nz) / det;
    const z = (e0.nx * c1 - e1.nx * c0) / det;
    pts.push([x, z]);
  }
  return pts;
}

function wallProfile() {
  const pts = [];
  const segs = 10;
  let arc = 0;
  for (let i = 0; i <= segs; i++) {
    const th = (Math.PI / 2) * (i / segs);
    const s = R - R * Math.sin(th);
    const y = R - R * Math.cos(th);
    if (i > 0) arc += (Math.PI / 2 / segs) * R;
    pts.push({ s, y, arc });
  }
  const pushWall = (y) => {
    arc += y - pts[pts.length - 1].y;
    pts.push({ s: 0, y, arc });
  };
  pushWall(A.GOAL_HEIGHT);
  pushWall(SOLID_WALL_TOP);
  pushWall(A.HEIGHT - R);
  for (let i = 1; i <= segs; i++) {
    const th = (Math.PI / 2) * (i / segs);
    const s = R - R * Math.cos(th);
    const y = A.HEIGHT - R + R * Math.sin(th);
    arc += (Math.PI / 2 / segs) * R;
    pts.push({ s, y, arc });
  }
  return pts;
}

function buildWallGeometry() {
  const edges = outlineEdges();
  const prof = wallProfile();
  const rings = prof.map((p) => insetOutline(edges, p.s));
  const solid = { pos: [], uv: [], idx: [] };
  const glass = { pos: [], uv: [], idx: [] };

  const quad = (dst, p0, p1, p2, p3, uv0, uv1, uv2, uv3) => {
    const base = dst.pos.length / 3;
    dst.pos.push(...p0, ...p1, ...p2, ...p3);
    dst.uv.push(...uv0, ...uv1, ...uv2, ...uv3);
    dst.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const j = (i + 1) % edges.length;
    for (let k = 0; k < prof.length - 1; k++) {
      const pa = prof[k];
      const pb = prof[k + 1];
      const A0 = rings[k][i];
      const B0 = rings[k][j];
      const A1 = rings[k + 1][i];
      const B1 = rings[k + 1][j];
      const isGlass = pa.y >= SOLID_WALL_TOP - 1 && pb.y <= A.HEIGHT - R + 1;
      const dst = isGlass ? glass : solid;
      let splits = [0, 1];
      if (e.back && pa.y < A.GOAL_HEIGHT - 1) {
        const x0 = A0[0];
        const x1 = B0[0];
        const tOf = (x) => (x - x0) / (x1 - x0);
        const tl = tOf(-A.GOAL_HALF_WIDTH);
        const tr = tOf(A.GOAL_HALF_WIDTH);
        splits = [0, Math.min(tl, tr), Math.max(tl, tr), 1];
      }
      for (let sIdx = 0; sIdx < splits.length - 1; sIdx++) {
        const t0 = splits[sIdx];
        const t1 = splits[sIdx + 1];
        if (splits.length === 4 && sIdx === 1) continue; // the goal opening
        const lerp2 = (P, Q, t) => [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
        const a0 = lerp2(A0, B0, t0);
        const b0 = lerp2(A0, B0, t1);
        const a1 = lerp2(A1, B1, t0);
        const b1 = lerp2(A1, B1, t1);
        const u0 = (t0 * e.len) / 512;
        const u1 = (t1 * e.len) / 512;
        const v0 = pa.arc / 512;
        const v1 = pb.arc / 512;
        quad(
          dst,
          [a0[0], pa.y, a0[1]],
          [b0[0], pa.y, b0[1]],
          [b1[0], pb.y, b1[1]],
          [a1[0], pb.y, a1[1]],
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1]
        );
      }
    }
  }
  const toGeo = (d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setIndex(d.idx);
    g.computeVertexNormals();
    return g;
  };
  return { solid: toGeo(solid), glass: toGeo(glass), topRing: rings[rings.length - 1], floorRing: rings[0] };
}

function ringShape(ring) {
  const shape = new THREE.Shape();
  ring.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  return shape;
}

function lineMaterial(opacity = 0.9) {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
}

function addLine(group, x1, z1, x2, z2, width = 18, y = 0.8) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const g = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, width), lineMaterial());
  plane.rotation.x = -Math.PI / 2;
  g.add(plane);
  g.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  group.add(g);
  return g;
}

// ---------------------------------------------------------------------------
export function buildArena() {
  const group = new THREE.Group();
  const H = A.HEIGHT;
  const animated = { leds: [], ads: [], beams: [], goalGlow: [] };

  // ---- floor -------------------------------------------------------------
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(2, 2.5);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.88, metalness: 0.04, envMapIntensity: 0.45 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A.HALF_WIDTH * 2, A.HALF_LENGTH * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // centre emblem decal
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(1900, 1900),
    new THREE.MeshBasicMaterial({ map: makeCenterDecal(), transparent: true, opacity: 0.5, depthWrite: false })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 1;
  group.add(decal);
  // goal floors (dark, team tinted)
  for (const sz of [-1, 1]) {
    const gf = new THREE.Mesh(
      new THREE.PlaneGeometry(A.GOAL_HALF_WIDTH * 2, A.GOAL_DEPTH),
      new THREE.MeshStandardMaterial({ color: sz < 0 ? 0x10182c : 0x1c130a, roughness: 0.75, metalness: 0.2, envMapIntensity: 0.5 })
    );
    gf.rotation.x = -Math.PI / 2;
    gf.position.set(0, 0, sz * (A.HALF_LENGTH + A.GOAL_DEPTH / 2));
    gf.receiveShadow = true;
    group.add(gf);
  }

  // ---- field markings ----------------------------------------------------
  const lines = new THREE.Group();
  addLine(lines, -A.HALF_WIDTH + R, 0, A.HALF_WIDTH - R, 0);
  const circle = new THREE.Mesh(new THREE.RingGeometry(1000 - 12, 1000 + 12, 96), lineMaterial());
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.8;
  lines.add(circle);
  for (const sz of [-1, 1]) {
    const bz = sz * A.HALF_LENGTH;
    const bw = 1800;
    const bd = 800;
    addLine(lines, -bw, bz - sz * R * 0.6, -bw, bz - sz * bd);
    addLine(lines, bw, bz - sz * R * 0.6, bw, bz - sz * bd);
    addLine(lines, -bw, bz - sz * bd, bw, bz - sz * bd);
    addLine(lines, -A.GOAL_HALF_WIDTH, bz, A.GOAL_HALF_WIDTH, bz, 22, 1.0);
    const tint = new THREE.Mesh(
      new THREE.PlaneGeometry(A.HALF_WIDTH * 2 - R * 2, 1600),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[sz < 0 ? 0 : 1], transparent: true, opacity: 0.09, depthWrite: false })
    );
    tint.rotation.x = -Math.PI / 2;
    tint.position.set(0, 0.5, bz - sz * 780);
    lines.add(tint);
  }
  group.add(lines);

  // ---- walls ---------------------------------------------------------------
  const wallGeo = buildWallGeometry();
  const panelTex = makePanelTexture();
  const solidMat = new THREE.MeshStandardMaterial({ map: panelTex, color: 0xb9c2d4, roughness: 0.68, metalness: 0.3, envMapIntensity: 0.8 });
  const solid = new THREE.Mesh(wallGeo.solid, solidMat);
  solid.receiveShadow = true;
  group.add(solid);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xaad2ff,
    transparent: true,
    opacity: 0.09,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.6,
  });
  group.add(new THREE.Mesh(wallGeo.glass, glassMat));

  // glass frame grid
  const gridMat = new THREE.LineBasicMaterial({ color: 0x7f9dd8, transparent: true, opacity: 0.4 });
  const gridPts = [];
  const outline = arenaOutline();
  for (let y = SOLID_WALL_TOP; y <= H - R + 1; y += 280) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      gridPts.push(a[0], y, a[1], b[0], y, b[1]);
    }
  }
  const edges = outlineEdges();
  for (const e of edges) {
    const n = Math.max(2, Math.round(e.len / 600));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t;
      const z = e.a[1] + (e.b[1] - e.a[1]) * t;
      gridPts.push(x, SOLID_WALL_TOP, z, x, H - R, z);
    }
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
  group.add(new THREE.LineSegments(gridGeo, gridMat));

  // ---- trim, LED rails, ad boards -----------------------------------------
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xdfe6f5, emissive: 0x9fb8ff, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.55 });
  const adTex = makeAdTexture();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rot = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 30, 30), trimMat);
    rail.position.set(mid[0], SOLID_WALL_TOP, mid[1]);
    rail.rotation.y = rot;
    group.add(rail);
    // animated LED strip along the rail
    const edge = edges[i];
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x37c8ff, toneMapped: false });
    const led = new THREE.Mesh(new THREE.BoxGeometry(len - R * 0.9, 8, 6), ledMat);
    led.position.set(mid[0] + edge.nx * 8, SOLID_WALL_TOP - 22, mid[1] + edge.nz * 8);
    led.rotation.y = rot;
    group.add(led);
    animated.leds.push({ mat: ledMat, base: new THREE.Color(0x37c8ff), phase: i * 0.7, edge });
    // LED strip where ramp meets floor
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x66e0ff, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len - R * 0.9, 4, 12), stripMat);
    strip.position.set(mid[0] + edge.nx * (R + 6), 1.5, mid[1] + edge.nz * (R + 6));
    strip.rotation.y = rot;
    group.add(strip);
    animated.leds.push({ mat: stripMat, base: new THREE.Color(0x66e0ff), phase: 1.3 + i * 0.5, edge });
    // ad boards on the long side walls (above the solid wall top edge, behind the glass)
    if (!edge.back && len > 3000) {
      const adMat = new THREE.MeshBasicMaterial({ map: adTex.clone(), toneMapped: false });
      adMat.map.repeat.set(len / 4200, 1);
      adMat.map.needsUpdate = true;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(len - 500, 150), adMat);
      board.position.set(mid[0] - edge.nx * 40, 620, mid[1] - edge.nz * 40);
      board.rotation.y = Math.atan2(edge.nx, edge.nz);
      group.add(board);
      animated.ads.push(adMat);
    }
  }

  // ---- ceiling -----------------------------------------------------------
  const ceilShape = ringShape(wallGeo.topRing);
  const ceilGeo = new THREE.ShapeGeometry(ceilShape);
  ceilGeo.rotateX(Math.PI / 2);
  const ceil = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({ color: 0x151b28, roughness: 0.9, metalness: 0.15, side: THREE.DoubleSide }));
  ceil.position.y = H;
  group.add(ceil);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, toneMapped: false });
  const lightPanels = [];
  for (let zi = -3; zi <= 3; zi++) {
    for (const sx of [-1, 1]) {
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(900, 170), lightMat);
      lp.rotation.x = Math.PI / 2;
      lp.position.set(sx * 1500, H - 4, zi * 1400);
      group.add(lp);
      lightPanels.push(lp);
    }
  }
  // ceiling light housing frames
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.7, metalness: 0.4 });
  for (let zi = -3; zi <= 3; zi++) {
    for (const sx of [-1, 1]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1020, 40, 290), housingMat);
      frame.position.set(sx * 1500, H - 14, zi * 1400);
      group.add(frame);
    }
  }
  // outer stadium trusses (visible through the glass)
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.8, metalness: 0.4 });
  for (let zi = -4; zi <= 4; zi++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(A.HALF_WIDTH * 2 + 2400, 90, 90), trussMat);
    t.position.set(0, H + 200, zi * 1300);
    group.add(t);
  }
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(90, 90, A.HALF_LENGTH * 2 + 2400), trussMat);
    t.position.set(sx * (A.HALF_WIDTH + 1200), H + 200, 0);
    group.add(t);
  }

  // ---- goals ---------------------------------------------------------------
  for (const sz of [-1, 1]) {
    const team = sz < 0 ? 0 : 1;
    const goal = buildGoal(TEAM_COLORS[team], animated);
    goal.position.z = sz * A.HALF_LENGTH;
    if (sz > 0) goal.rotation.y = Math.PI;
    group.add(goal);
  }

  // ---- boost pads ----------------------------------------------------------
  const pads = [];
  const bigGeo = new THREE.CylinderGeometry(150, 165, 14, 6); // hex pad
  const smallGeo = new THREE.CylinderGeometry(80, 90, 10, 6);
  const orbGeoBig = new THREE.IcosahedronGeometry(64, 1);
  const orbGeoSmall = new THREE.IcosahedronGeometry(30, 1);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1d222e, roughness: 0.5, metalness: 0.65, envMapIntensity: 0.8 });
  const ringGeoBig = new THREE.RingGeometry(120, 150, 6);
  const ringGeoSmall = new THREE.RingGeometry(58, 76, 6);
  const beamGeo = new THREE.CylinderGeometry(46, 92, 520, 12, 1, true);
  for (const p of BOOST_PADS) {
    const padGroup = new THREE.Group();
    padGroup.position.set(p.x, 0, p.z);
    const base = new THREE.Mesh(p.big ? bigGeo : smallGeo, baseMat);
    base.position.y = p.big ? 7 : 5;
    padGroup.add(base);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb200, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(p.big ? ringGeoBig : ringGeoSmall, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = p.big ? 15 : 11;
    padGroup.add(ring);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xffb200, emissive: 0xffa200, emissiveIntensity: 2.4, roughness: 0.25, metalness: 0.3 });
    const orb = new THREE.Mesh(p.big ? orbGeoBig : orbGeoSmall, orbMat);
    orb.position.y = p.big ? 110 : 55;
    padGroup.add(orb);
    // big pads: soft vertical light pillar
    let beam = null;
    if (p.big) {
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffb200, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 270;
      padGroup.add(beam);
      animated.beams.push(beam);
    }
    group.add(padGroup);
    pads.push({ group: padGroup, orb, ring, big: p.big, mat: orbMat, ringMat, beam });
  }

  return { group, pads, lightPanels, animated };
}

function buildGoal(color, animated) {
  const g = new THREE.Group();
  const w = A.GOAL_HALF_WIDTH;
  const h = A.GOAL_HEIGHT;
  const d = A.GOAL_DEPTH;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd4dbea, roughness: 0.32, metalness: 0.75, envMapIntensity: 1.2 });
  const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3, roughness: 0.3, toneMapped: false });
  const postDepth = R + 40;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(50, h, postDepth), frameMat);
    post.position.set(sx * (w + 25), h / 2, postDepth / 2 - 20);
    g.add(post);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(14, h - 20, 14), glowMat);
    strip.position.set(sx * (w + 25), h / 2, postDepth - 8);
    g.add(strip);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 100, 50, postDepth), frameMat);
  bar.position.set(0, h + 25, postDepth / 2 - 20);
  g.add(bar);
  const barStrip = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 60, 14, 14), glowMat);
  barStrip.position.set(0, h + 25, postDepth - 8);
  g.add(barStrip);

  // net (alpha-tested so it reads as a real net from distance)
  const netTex = makeNetTexture();
  const mkNet = (rx, ry) => {
    const t = netTex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ color: 0x2c3446, roughness: 0.85, side: THREE.DoubleSide, map: t, transparent: true, alphaTest: 0.35, emissive: 0x1a2233, emissiveIntensity: 0.35 });
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, h), mkNet(w / 55, h / 55));
  back.position.set(0, h / 2, -d);
  g.add(back);
  const sideMat = mkNet(d / 55, h / 55);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(d, h), sideMat);
    side.position.set(sx * w, h / 2, -d / 2);
    side.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(side);
  }
  const topMat = mkNet(w / 55, d / 55);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, d), topMat);
  top.position.set(0, h, -d / 2);
  top.rotation.x = Math.PI / 2;
  g.add(top);
  // team colour glow plane just inside the mouth of the goal
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 - 40, h - 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  inner.position.set(0, h / 2, -d + 4);
  g.add(inner);
  animated.goalGlow.push(inner);
  // light strips along the goal floor edges
  const floorStrip = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 6, 10), glowMat);
  floorStrip.position.set(0, 3, -d + 8);
  g.add(floorStrip);
  return g;
}

export { BOOST_PAD };
