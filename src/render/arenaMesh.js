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
  const size = 1024;
  const cv = canvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1c5a2e';
  ctx.fillRect(0, 0, size, size);
  // mowing stripes
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(0, (i * size) / 16, size, size / 16);
  }
  // grass noise
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n * 1.2;
    img.data[i + 2] += n * 0.6;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePanelTexture() {
  const cv = canvas(512, 512);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2b3140';
  ctx.fillRect(0, 0, 512, 512);
  // subtle panel plates
  for (let y = 0; y < 512; y += 128) {
    for (let x = 0; x < 512; x += 256) {
      const ox = (y / 128) % 2 ? 128 : 0;
      const g = 38 + Math.random() * 10;
      ctx.fillStyle = `rgb(${g},${g + 4},${g + 14})`;
      ctx.fillRect(x + ox + 3, y + 3, 250, 122);
    }
  }
  // seams
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  // rivets
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 12; y < 512; y += 128) for (let x = 12; x < 512; x += 64) ctx.fillRect(x, y, 4, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeNetTexture() {
  const cv = canvas(128, 128);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 3;
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

function makeBannerTexture(text, color) {
  const cv = canvas(1024, 128);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0d1020';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 8);
  ctx.fillRect(0, 120, 1024, 8);
  ctx.font = 'bold 72px Rajdhani, Arial Narrow, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// outline geometry helpers
// ---------------------------------------------------------------------------
export function arenaOutline() {
  const c = A.CORNER_SUM;
  const W = A.HALF_WIDTH;
  const L = A.HALF_LENGTH;
  // counter-clockwise when viewed from above (x right, z forward)
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

/** Edge list with inward normals. */
function outlineEdges() {
  const o = arenaOutline();
  const edges = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    // inward normal: rotate direction toward the centre
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

/** Vertices of the outline inset by `s` (each edge line shifted inward). */
function insetOutline(edges, s) {
  const n = edges.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const e0 = edges[(i - 1 + n) % n];
    const e1 = edges[i];
    // line i: n·p = n·a + s  (n inward)
    const c0 = e0.nx * e0.a[0] + e0.nz * e0.a[1] + s;
    const c1 = e1.nx * e1.a[0] + e1.nz * e1.a[1] + s;
    const det = e0.nx * e1.nz - e0.nz * e1.nx;
    const x = (c0 * e1.nz - c1 * e0.nz) / det;
    const z = (e0.nx * c1 - e1.nx * c0) / det;
    pts.push([x, z]);
  }
  return pts; // pts[i] is the start vertex of edge i
}

/** Profile of the wall cross-section: {s (inward inset), y, arc (running length for UVs)} */
function wallProfile() {
  const pts = [];
  const segs = 10;
  let arc = 0;
  // floor ramp: quarter circle from (s=R, y=0) to (s=0, y=R)
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
  // ceiling ramp
  for (let i = 1; i <= segs; i++) {
    const th = (Math.PI / 2) * (i / segs);
    const s = R - R * Math.cos(th);
    const y = A.HEIGHT - R + R * Math.sin(th);
    arc += (Math.PI / 2 / segs) * R;
    pts.push({ s, y, arc });
  }
  return pts;
}

/**
 * Sweep the wall profile around the outline. Returns { solid, glass } geometries.
 * Back walls get the goal opening cut out (below GOAL_HEIGHT, |x| < GOAL_HALF_WIDTH).
 */
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
      // along-edge sub-splits (for goal opening on the back walls)
      let splits = [0, 1];
      if (e.back && pa.y < A.GOAL_HEIGHT - 1) {
        // parametrise by x along the edge
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
        if (splits.length === 4 && sIdx === 1) continue; // the opening
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

  // ---- floor -------------------------------------------------------------
  const floorTex = makeFloorTexture();
  floorTex.repeat.set(2, 2.5);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A.HALF_WIDTH * 2, A.HALF_LENGTH * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  // goal floors (dark)
  const goalFloorMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.9 });
  for (const sz of [-1, 1]) {
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(A.GOAL_HALF_WIDTH * 2, A.GOAL_DEPTH), goalFloorMat);
    gf.rotation.x = -Math.PI / 2;
    gf.position.set(0, 0, sz * (A.HALF_LENGTH + A.GOAL_DEPTH / 2));
    gf.receiveShadow = true;
    group.add(gf);
  }

  // ---- field markings ----------------------------------------------------
  const lines = new THREE.Group();
  addLine(lines, -A.HALF_WIDTH + R, 0, A.HALF_WIDTH - R, 0); // half line
  const circle = new THREE.Mesh(new THREE.RingGeometry(1000 - 12, 1000 + 12, 96), lineMaterial());
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.8;
  lines.add(circle);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(40, 32), lineMaterial());
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.8;
  lines.add(dot);
  for (const sz of [-1, 1]) {
    const bz = sz * A.HALF_LENGTH;
    const bw = 1800;
    const bd = 800;
    addLine(lines, -bw, bz - sz * R * 0.6, -bw, bz - sz * bd);
    addLine(lines, bw, bz - sz * R * 0.6, bw, bz - sz * bd);
    addLine(lines, -bw, bz - sz * bd, bw, bz - sz * bd);
    // goal line
    addLine(lines, -A.GOAL_HALF_WIDTH, bz, A.GOAL_HALF_WIDTH, bz, 22, 1.0);
    // team-coloured tint fading from the goal
    const tint = new THREE.Mesh(
      new THREE.PlaneGeometry(A.HALF_WIDTH * 2 - R * 2, 1400),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[sz < 0 ? 0 : 1], transparent: true, opacity: 0.07, depthWrite: false })
    );
    tint.rotation.x = -Math.PI / 2;
    tint.position.set(0, 0.5, bz - sz * 700);
    lines.add(tint);
  }
  group.add(lines);

  // ---- walls (solid ramps + panels, glass above) --------------------------
  const wallGeo = buildWallGeometry();
  const panelTex = makePanelTexture();
  const solidMat = new THREE.MeshStandardMaterial({ map: panelTex, color: 0xb8c0d0, roughness: 0.75, metalness: 0.25 });
  const solid = new THREE.Mesh(wallGeo.solid, solidMat);
  solid.receiveShadow = true;
  group.add(solid);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fc6ff,
    transparent: true,
    opacity: 0.1,
    roughness: 0.1,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(wallGeo.glass, glassMat));

  // glass frame grid
  const gridMat = new THREE.LineBasicMaterial({ color: 0x6f8fc8, transparent: true, opacity: 0.35 });
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

  // top rail of the solid wall (bright trim) and floor-level light strip
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xdfe6f5, emissive: 0x9fb8ff, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.5 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x8fd3ff });
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rot = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 30, 30), trimMat);
    rail.position.set((a[0] + b[0]) / 2, SOLID_WALL_TOP, (a[1] + b[1]) / 2);
    rail.rotation.y = rot;
    group.add(rail);
    // floor light strip sits where ramp meets floor (inset R)
    const e = edges[i];
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len - R * 0.9, 4, 12), stripMat);
    strip.position.set((a[0] + b[0]) / 2 + e.nx * (R + 6), 1.5, (a[1] + b[1]) / 2 + e.nz * (R + 6));
    strip.rotation.y = rot;
    group.add(strip);
  }

  // ---- ceiling -----------------------------------------------------------
  const ceilShape = ringShape(wallGeo.topRing);
  const ceilGeo = new THREE.ShapeGeometry(ceilShape);
  ceilGeo.rotateX(Math.PI / 2);
  const ceil = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.9, side: THREE.DoubleSide }));
  ceil.position.y = H;
  group.add(ceil);
  // ceiling light panels
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  lightMat.toneMapped = false;
  const lightPanels = [];
  for (let zi = -3; zi <= 3; zi++) {
    for (const sx of [-1, 1]) {
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(900, 160), lightMat);
      lp.rotation.x = Math.PI / 2;
      lp.position.set(sx * 1500, H - 4, zi * 1400);
      group.add(lp);
      lightPanels.push(lp);
    }
  }
  // outer stadium trusses (visible through the glass)
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.8, metalness: 0.4 });
  for (let zi = -4; zi <= 4; zi++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(A.HALF_WIDTH * 2 + 2400, 90, 90), trussMat);
    t.position.set(0, H + 200, zi * 1300);
    group.add(t);
  }

  // ---- banners on the solid wall (team colour near each goal) -------------
  for (const sz of [-1, 1]) {
    const team = sz < 0 ? 0 : 1;
    const col = '#' + new THREE.Color(TEAM_COLORS[team]).getHexString();
    const tex = makeBannerTexture(team === 0 ? 'BLUE' : 'ORANGE', col);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1400, 175), mat);
      b.position.set(sx * 2100, 780, sz * (A.HALF_LENGTH - 3));
      b.rotation.y = sz > 0 ? Math.PI : 0;
      group.add(b);
    }
    // side wall banners
    const side = new THREE.Mesh(new THREE.PlaneGeometry(2600, 175), new THREE.MeshBasicMaterial({ map: makeBannerTexture('ROCKET GOAL', '#e8ecf5') }));
    side.position.set(sz * (A.HALF_WIDTH - 3), 780, 0);
    side.rotation.y = sz > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(side);
  }

  // ---- goals -------------------------------------------------------------
  for (const sz of [-1, 1]) {
    const team = sz < 0 ? 0 : 1;
    const g = buildGoal(TEAM_COLORS[team]);
    g.position.z = sz * A.HALF_LENGTH;
    if (sz > 0) g.rotation.y = Math.PI;
    group.add(g);
  }

  // ---- boost pads --------------------------------------------------------
  const pads = [];
  const bigGeo = new THREE.CylinderGeometry(150, 160, 14, 28);
  const smallGeo = new THREE.CylinderGeometry(80, 88, 10, 18);
  const orbGeoBig = new THREE.SphereGeometry(70, 20, 14);
  const orbGeoSmall = new THREE.SphereGeometry(32, 14, 10);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x20252f, roughness: 0.55, metalness: 0.6 });
  const ringGeoBig = new THREE.RingGeometry(120, 150, 32);
  const ringGeoSmall = new THREE.RingGeometry(60, 78, 24);
  for (const p of BOOST_PADS) {
    const padGroup = new THREE.Group();
    padGroup.position.set(p.x, 0, p.z);
    const base = new THREE.Mesh(p.big ? bigGeo : smallGeo, baseMat);
    base.position.y = p.big ? 7 : 5;
    padGroup.add(base);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb200, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(p.big ? ringGeoBig : ringGeoSmall, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = p.big ? 15 : 11;
    padGroup.add(ring);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xffb200, emissive: 0xff9a00, emissiveIntensity: 2.2, roughness: 0.3 });
    const orb = new THREE.Mesh(p.big ? orbGeoBig : orbGeoSmall, orbMat);
    orb.position.y = p.big ? 110 : 55;
    padGroup.add(orb);
    group.add(padGroup);
    pads.push({ group: padGroup, orb, ring, big: p.big, mat: orbMat, ringMat });
  }

  return { group, pads, lightPanels };
}

function buildGoal(color) {
  const g = new THREE.Group();
  const w = A.GOAL_HALF_WIDTH;
  const h = A.GOAL_HEIGHT;
  const d = A.GOAL_DEPTH;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e4, roughness: 0.35, metalness: 0.7 });
  const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5, roughness: 0.3 });
  // posts & crossbar (they fill the ramp cross-section at the sides of the opening)
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

  // interior: dark solid panels with a net texture
  const netTex = makeNetTexture();
  const netMat = new THREE.MeshStandardMaterial({ color: 0x252b38, roughness: 0.9, side: THREE.DoubleSide, map: netTex, transparent: false });
  netTex.repeat.set(w / 60, h / 60);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, h), netMat);
  back.position.set(0, h / 2, -d);
  g.add(back);
  const sideTex = netTex.clone();
  sideTex.repeat.set(d / 60, h / 60);
  const sideMat = netMat.clone();
  sideMat.map = sideTex;
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(d, h), sideMat);
    side.position.set(sx * w, h / 2, -d / 2);
    side.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(side);
  }
  const topTex = netTex.clone();
  topTex.repeat.set(w / 60, d / 60);
  const topMat = netMat.clone();
  topMat.map = topTex;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, d), topMat);
  top.position.set(0, h, -d / 2);
  top.rotation.x = Math.PI / 2;
  g.add(top);
  // team colour glow inside the goal
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 - 40, h - 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
  inner.position.set(0, h / 2, -d + 4);
  g.add(inner);
  // light strips along the goal floor edges
  const floorStrip = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 6, 10), glowMat);
  floorStrip.position.set(0, 3, -d + 8);
  g.add(floorStrip);
  return g;
}

export { BOOST_PAD };
