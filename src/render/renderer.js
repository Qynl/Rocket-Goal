import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildArena } from './arenaMesh.js';
import { buildCarMesh } from './carMesh.js';
import { ARENA, BALL, TEAM_COLORS, CAR, BOOST_PAD } from '../constants.js';
import { clamp, lerp } from '../math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// Rocket League camera presets (RL units / degrees)
export const CAMERA_PRESETS = {
  default: { fov: 90, distance: 270, height: 110, angle: -3, stiffness: 0.5, swivel: 2.5, transition: 1.2 },
  pro: { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.45, swivel: 5, transition: 1.0 },
  wide: { fov: 110, distance: 300, height: 120, angle: -5, stiffness: 0.35, swivel: 4, transition: 1.2 },
};

const SKY_TOP = new THREE.Color(0x0b1226);
const SKY_BOTTOM = new THREE.Color(0x1a2447);

export class Renderer {
  constructor(canvas, glRenderer = null) {
    this.canvas = canvas;
    this.renderer = glRenderer || new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.isStub = !!glRenderer;

    this.scene = new THREE.Scene();
    this.scene.background = SKY_TOP.clone();
    this.scene.fog = new THREE.Fog(0x0b1226, 12000, 26000);

    this.camera = new THREE.PerspectiveCamera(90, 1, 5, 40000);
    this.camState = {
      pos: new THREE.Vector3(0, 500, -5000),
      look: new THREE.Vector3(),
      yaw: 0, // current camera yaw (world, around Y)
      pitch: 0,
      fov: 90,
      transition: 0, // 0 = ball cam, 1 = car cam (blend)
    };
    this.camSettings = { ...CAMERA_PRESETS.default };
    this.camera.fov = this.camSettings.fov;

    this.setupLights();
    const arena = buildArena();
    this.arena = arena;
    this.scene.add(arena.group);
    this.buildStadium();

    // ball
    this.ballMesh = this.buildBall();
    this.scene.add(this.ballMesh);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL.RADIUS, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.ballTrail = this.buildTrail(0xffffff, 40);
    this.scene.add(this.ballTrail.mesh);

    // prediction line
    this.predGeo = new THREE.BufferGeometry();
    this.predGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 200), 3));
    this.predLine = new THREE.Line(this.predGeo, new THREE.LineBasicMaterial({ color: 0x44ffcc, transparent: true, opacity: 0.6 }));
    this.predLine.frustumCulled = false;
    this.predLine.visible = false;
    this.scene.add(this.predLine);
    this.landingMarker = new THREE.Mesh(new THREE.RingGeometry(80, 100, 32), new THREE.MeshBasicMaterial({ color: 0x44ffcc, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    this.landingMarker.rotation.x = -Math.PI / 2;
    this.landingMarker.visible = false;
    this.scene.add(this.landingMarker);

    // ball indicator (arrow above the ball)
    this.ballIndicator = new THREE.Mesh(new THREE.ConeGeometry(28, 64, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    this.ballIndicator.rotation.x = Math.PI;
    this.scene.add(this.ballIndicator);

    this.carMeshes = new Map();
    this.particles = [];
    this.rings = [];
    this.markers = [];
    this.shake = 0;
    this.shakeT = 0;
    this.showPrediction = false;
    this.showHitbox = false;
    this.clock = 0;
    this.quality = 'high';
    this.goalFlash = 0;
    this.goalFlashColor = new THREE.Color();

    // goal explosion light
    this.goalLight = new THREE.PointLight(0xffffff, 0, 6000, 1.2);
    this.scene.add(this.goalLight);

    this.setupPost();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  setupPost() {
    if (this.isStub) {
      this.composer = null;
      return;
    }
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.35, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.75 : 1));
    this.renderer.shadowMap.enabled = high || q === 'medium';
    if (this.sun) this.sun.castShadow = this.renderer.shadowMap.enabled;
    if (this.bloom) this.bloom.enabled = q !== 'low';
    this.onResize();
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xc9d8ff, 0x1c2a3a, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    sun.position.set(2500, 6500, -3000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -6500;
    sun.shadow.camera.right = 6500;
    sun.shadow.camera.top = 7000;
    sun.shadow.camera.bottom = -7000;
    sun.shadow.camera.near = 500;
    sun.shadow.camera.far = 16000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 4;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
    fill.position.set(-3000, 3000, 4000);
    this.scene.add(fill);
    // goal glow lights
    this.goalGlow = [];
    for (const sz of [-1, 1]) {
      const p = new THREE.PointLight(TEAM_COLORS[sz < 0 ? 0 : 1], 3, 4000, 1.6);
      p.position.set(0, 400, sz * 5300);
      this.scene.add(p);
      this.goalGlow.push(p);
    }
  }

  buildStadium() {
    const group = new THREE.Group();
    const R = ARENA.HALF_WIDTH + 700;
    const L = ARENA.HALF_LENGTH + 700;
    const tiers = 14;
    const seatMats = [0x2a3a66, 0x33405e, 0x243458].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
    for (let t = 0; t < tiers; t++) {
      const y = 300 + t * 230;
      const inset = t * 250;
      const mat = seatMats[t % 3];
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(250, 230, L * 2 - 1200), mat);
        m.position.set(sx * (R + inset + 125), y, 0);
        group.add(m);
      }
      for (const sz of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(R * 2 - 1200, 230, 250), mat);
        m.position.set(0, y, sz * (L + inset + 125 + 900));
        group.add(m);
      }
    }
    // outer floor
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    group.add(ground);
    // crowd
    const crowdGeo = new THREE.BufferGeometry();
    const pts = [];
    const cols = [];
    for (let i = 0; i < 9000; i++) {
      const t = Math.floor(Math.random() * tiers);
      const y = 300 + t * 230 + 140;
      const inset = t * 250;
      const side = Math.floor(Math.random() * 4);
      let x;
      let z;
      if (side < 2) {
        x = (side === 0 ? -1 : 1) * (R + inset + 100);
        z = (Math.random() - 0.5) * (L * 2 - 1200);
      } else {
        z = (side === 2 ? -1 : 1) * (L + inset + 100 + 900);
        x = (Math.random() - 0.5) * (R * 2 - 1200);
      }
      pts.push(x, y, z);
      const team = Math.random() < 0.5 ? 0 : 1;
      const c = new THREE.Color(TEAM_COLORS[team]).offsetHSL((Math.random() - 0.5) * 0.08, -0.2, (Math.random() - 0.5) * 0.3);
      if (Math.random() < 0.35) c.setHSL(Math.random(), 0.4, 0.5);
      cols.push(c.r, c.g, c.b);
    }
    crowdGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    crowdGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.crowd = new THREE.Points(crowdGeo, new THREE.PointsMaterial({ size: 70, vertexColors: true, sizeAttenuation: true }));
    group.add(this.crowd);
    // flood lights at the four corners
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(40, 60, 5200, 8), new THREE.MeshStandardMaterial({ color: 0x555b6a }));
        pole.position.set(sx * (R + 3800), 2600, sz * (L + 4500));
        group.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(700, 220, 120), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        head.material.toneMapped = false;
        head.position.set(sx * (R + 3800), 5300, sz * (L + 4500));
        head.lookAt(0, 0, 0);
        group.add(head);
      }
    }
    this.scene.add(group);
  }

  buildBall() {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 512;
    const ctx = cv.getContext('2d');
    // RL-like ball: light grey with darker hexagonal panels and a dark equator band
    ctx.fillStyle = '#d9dde6';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#9aa3b5';
    const hexR = 46;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 14; col++) {
        const x = col * 78 + (row % 2 ? 39 : 0);
        const y = 40 + row * 62;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * hexR * 0.72;
          const py = y + Math.sin(a) * hexR * 0.72;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#3a4560';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(1024, 256);
    ctx.stroke();
    ctx.lineWidth = 8;
    for (const y of [120, 392]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.2 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.RADIUS, 40, 28), mat);
    mesh.castShadow = true;
    return mesh;
  }

  buildTrail(color, n) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    for (let i = 0; i < n; i++) {
      uv[i * 4] = i / (n - 1);
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / (n - 1);
      uv[i * 4 + 3] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vUv; void main(){ float a = vUv.x * (1.0 - abs(vUv.y - 0.5) * 2.0); gl_FragColor = vec4(color, a * opacity); }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, points: [], n, mat };
  }

  updateTrail(trail, point, width, active) {
    const pts = trail.points;
    if (active) {
      pts.push(point.clone());
      while (pts.length > trail.n) pts.shift();
    } else if (pts.length) pts.shift();
    trail.mat.uniforms.opacity.value = pts.length > 2 ? 0.55 : 0;
    if (pts.length < 2) return;
    const pos = trail.mesh.geometry.attributes.position;
    const camPos = this.camera.position;
    for (let i = 0; i < trail.n; i++) {
      const k = Math.max(0, pts.length - trail.n + i);
      const p = pts[Math.min(k, pts.length - 1)];
      const next = pts[Math.min(k + 1, pts.length - 1)];
      const prev = pts[Math.max(k - 1, 0)];
      const dir = _v.copy(next).sub(prev);
      const toCam = _v2.copy(camPos).sub(p);
      const side = _v3.crossVectors(dir, toCam);
      if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
      side.normalize().multiplyScalar(width * (i / (trail.n - 1)));
      pos.setXYZ(i * 2, p.x + side.x, p.y + side.y, p.z + side.z);
      pos.setXYZ(i * 2 + 1, p.x - side.x, p.y - side.y, p.z - side.z);
    }
    pos.needsUpdate = true;
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  getCarMesh(car) {
    let m = this.carMeshes.get(car.id);
    if (!m) {
      m = buildCarMesh(TEAM_COLORS[car.team], !car.isBot);
      this.scene.add(m.group);
      m.tag = this.makeTag(car.name, TEAM_COLORS[car.team]);
      this.scene.add(m.tag);
      m.trail = this.buildTrail(TEAM_COLORS[car.team], 24);
      this.scene.add(m.trail.mesh);
      m.boostBar = this.makeBoostBar(TEAM_COLORS[car.team]);
      this.scene.add(m.boostBar.sprite);
      m.lastBoostFrame = 0;
      this.carMeshes.set(car.id, m);
    }
    return m;
  }

  makeTag(text, color) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 34px Rajdhani, Arial Narrow, Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, 128, 40);
    ctx.fillText(text, 128, 40);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(220, 55, 1);
    return sp;
  }

  makeBoostBar(color) {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 16;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(110, 14, 1);
    const draw = (frac) => {
      ctx.clearRect(0, 0, 128, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, 128, 16);
      ctx.fillStyle = '#ffb200';
      ctx.fillRect(2, 2, 124 * frac, 12);
      tex.needsUpdate = true;
    };
    draw(0.33);
    return { sprite, draw, last: -1 };
  }

  // ------------------------------------------------------------------------
  update(game, dt, view) {
    this.clock += dt;
    const ball = game.ball;
    const replay = game.replayState ? game.replayState() : null;

    // ball + cars: from replay buffer while a replay plays, otherwise live
    if (replay) this.applyReplay(game, replay);
    else {
      this.ballMesh.position.copy(ball.pos);
      this.ballMesh.quaternion.copy(ball.quat);
      for (const car of game.cars) this.applyCarLive(car, view, dt);
    }
    const bp = this.ballMesh.position;
    this.ballShadow.position.set(bp.x, 1.5, bp.z);
    const sh = clamp(1 - bp.y / 2200, 0.25, 1);
    this.ballShadow.scale.set(sh, sh, 1);
    this.ballShadow.material.opacity = 0.42 * sh;
    this.updateTrail(this.ballTrail, bp, 60, !replay && ball.vel.length() > 1800);
    this.ballIndicator.position.set(bp.x, bp.y + BALL.RADIUS + 80 + Math.sin(this.clock * 5) * 8, bp.z);
    this.ballIndicator.rotation.y += dt * 2;
    this.ballIndicator.visible = !replay;

    // remove meshes for cars that no longer exist
    for (const [id, m] of this.carMeshes) {
      if (!game.cars.find((c) => c.id === id)) {
        this.scene.remove(m.group, m.tag, m.trail.mesh, m.boostBar.sprite);
        this.carMeshes.delete(id);
      }
    }

    // pads
    for (let i = 0; i < this.arena.pads.length; i++) {
      const pm = this.arena.pads[i];
      const p = game.pads[i];
      pm.orb.visible = p.active;
      pm.ringMat.opacity = p.active ? 0.85 : 0.15;
      if (p.active) {
        pm.orb.rotation.y += dt * 1.5;
        pm.orb.position.y = (p.big ? 110 : 55) + Math.sin(this.clock * 3 + i) * 6;
        pm.orb.scale.setScalar(1);
      } else if (p.timer > 0) {
        // respawn "charging" ring
        const total = p.big ? BOOST_PAD.BIG_RESPAWN : BOOST_PAD.SMALL_RESPAWN;
        pm.ringMat.opacity = 0.15 + 0.5 * (1 - p.timer / total);
      }
    }

    // prediction
    if (this.showPrediction && game.prediction.length && !replay) {
      this.predLine.visible = true;
      const pos = this.predGeo.attributes.position;
      const n = Math.min(200, game.prediction.length);
      for (let i = 0; i < 200; i++) {
        const p = game.prediction[Math.min(i, n - 1)].pos;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      let land = null;
      for (const p of game.prediction) {
        if (p.t > 0.1 && p.pos.y < BALL.RADIUS + 6 && p.vel.y <= 0) {
          land = p;
          break;
        }
      }
      if (land && ball.pos.y > BALL.RADIUS + 30) {
        this.landingMarker.visible = true;
        this.landingMarker.position.set(land.pos.x, 2, land.pos.z);
      } else this.landingMarker.visible = false;
    } else {
      this.predLine.visible = false;
      this.landingMarker.visible = false;
    }

    // goal flash / light
    if (this.goalFlash > 0) {
      this.goalFlash = Math.max(0, this.goalFlash - dt * 0.8);
      this.goalLight.intensity = this.goalFlash * 40;
      this.goalLight.color.copy(this.goalFlashColor);
    } else this.goalLight.intensity = 0;
    // crowd sway
    if (this.crowd) this.crowd.position.y = Math.sin(this.clock * 2.2) * 6;

    this.updateMarkers(game);
    this.updateParticles(dt);
    this.updateCamera(game, dt, view, replay);
    this.ballScreen = this.projectBall(replay);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Where the ball is on screen (normalised -1..1) and whether it is visible — for the HUD's off-screen arrow. */
  projectBall(replay) {
    if (replay) return null;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const p = _v.copy(this.ballMesh.position).applyMatrix4(cam.matrixWorldInverse);
    const behind = p.z > 0; // camera looks down -z
    const clip = _v2.copy(this.ballMesh.position).project(cam);
    let x = clip.x;
    let y = clip.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const onScreen = !behind && Math.abs(x) < 0.97 && Math.abs(y) < 0.95;
    const dist = Math.hypot(p.x, p.y, p.z);
    return { x, y, onScreen, behind, dist };
  }

  applyCarLive(car, view, dt) {
    const m = this.getCarMesh(car);
    m.group.visible = !car.demolished;
    m.tag.visible = !car.demolished && car !== view.followCar;
    m.boostBar.sprite.visible = m.tag.visible;
    if (car.demolished) {
      m.trail.mat.uniforms.opacity.value = 0;
      return;
    }
    m.group.position.copy(car.pos);
    m.group.quaternion.copy(car.quat);
    // suspension squat on landings / jumps
    const squat = car.suspension * 6;
    _v.set(0, -squat, 0).applyQuaternion(car.quat);
    m.group.position.add(_v);
    m.tag.position.copy(car.pos).add(_v.set(0, 125, 0));
    m.boostBar.sprite.position.copy(car.pos).add(_v.set(0, 95, 0));
    const bf = Math.round(car.boost / 5) * 5;
    if (bf !== m.boostBar.last) {
      m.boostBar.last = bf;
      m.boostBar.draw(car.boost / 100);
    }
    for (const w of m.wheels) {
      w.spin.rotation.x = car.wheelSpin;
      if (w.front) w.pivot.rotation.y = -car.steerVisual * 0.5;
      // wheel droop in the air
      w.pivot.position.y = car.onGround ? -squat * 0.5 : -4;
    }
    const boosting = car.boostActive;
    m.flame.visible = boosting;
    m.flameCore.visible = boosting;
    m.flameLight.intensity = boosting ? 6 + Math.random() * 3 : 0;
    if (boosting) {
      const s = 0.85 + Math.random() * 0.4;
      m.flame.scale.set(1, s, 1);
      m.flameCore.scale.set(1, s * 1.1, 1);
      if (Math.random() < 0.7) this.spawnParticle(car, 'boost');
    }
    if (car.supersonic && Math.random() < 0.8) this.spawnParticle(car, 'trail');
    if (car.handbraking && car.onGround && car.speed > 300 && Math.random() < 0.8) this.spawnParticle(car, 'skid');
    if (car.onGround && car.speed > 900 && Math.random() < 0.25) this.spawnParticle(car, 'dust');
    const ev = car.events;
    if (ev) {
      if (ev.landed > 250) this.burst(car.pos, 0xcccccc, Math.min(14, ev.landed / 60), 300, 0.3, 14);
      if (ev.dodged || ev.doubleJumped) this.spawnRing(car.pos, 0xffffff, 70);
      if (ev.wallHit > 400) this.burst(car.pos, 0xffffff, 8, 250, 0.3, 12);
      if (ev.flipReset) this.spawnRing(car.pos, 0x44ffcc, 90);
    }
    if (m.underglow) m.underglow.visible = car.onGround;
    m.hitbox.visible = this.showHitbox;
    // supersonic ribbon trail
    _v.copy(car.pos).add(_v2.set(0, 20, 0));
    this.updateTrail(m.trail, _v, 26, car.supersonic);
  }

  applyReplay(game, r) {
    const { a, b, u } = r;
    this.ballMesh.position.lerpVectors(a.ball.p, b.ball.p, u);
    this.ballMesh.quaternion.slerpQuaternions(a.ball.q, b.ball.q, u);
    for (const car of game.cars) {
      const m = this.getCarMesh(car);
      const fa = a.cars.find((c) => c.id === car.id);
      const fb = b.cars.find((c) => c.id === car.id) || fa;
      if (!fa) {
        m.group.visible = false;
        continue;
      }
      m.group.visible = !fa.demo;
      m.tag.visible = false;
      m.boostBar.sprite.visible = false;
      m.group.position.lerpVectors(fa.p, fb.p, u);
      m.group.quaternion.slerpQuaternions(fa.q, fb.q, u);
      for (const w of m.wheels) {
        w.spin.rotation.x = lerp(fa.wheel, fb.wheel, u);
        if (w.front) w.pivot.rotation.y = -lerp(fa.steer, fb.steer, u) * 0.5;
      }
      m.flame.visible = fa.boost;
      m.flameCore.visible = fa.boost;
      m.flameLight.intensity = fa.boost ? 6 : 0;
      if (fa.boost && Math.random() < 0.5) this.spawnParticleAt(m.group.position, m.group.quaternion, 'boost');
      m.trail.mat.uniforms.opacity.value = 0;
      if (m.underglow) m.underglow.visible = true;
    }
  }

  // ------------------------------------------------------------------------
  updateCamera(game, dt, view, replay) {
    const car = view.followCar;
    const cam = this.camera;
    const cs = this.camSettings;
    const ball = game.ball;
    const st = this.camState;
    const bp = this.ballMesh.position;

    if (replay) {
      this.replayCamera(game, replay, dt);
      return;
    }

    if (view.mode === 'goalReplay' || !car) {
      // slow orbit around the ball (menu background / goal celebration)
      const t = this.clock * 0.25;
      const target = _v.copy(bp);
      const desired = _v2.set(Math.sin(t) * 1900, 750, Math.cos(t) * 1900).add(target);
      st.pos.lerp(desired, 1 - Math.exp(-3 * dt));
      cam.position.copy(st.pos);
      st.look.lerp(target, 1 - Math.exp(-6 * dt));
      cam.lookAt(st.look);
      st.fov = lerp(st.fov, 75, 1 - Math.exp(-3 * dt));
      cam.fov = st.fov;
      cam.updateProjectionMatrix();
      return;
    }

    if (car.demolished) {
      st.look.lerp(bp, 1 - Math.exp(-5 * dt));
      cam.lookAt(st.look);
      return;
    }

    // ---- Rocket League style camera ----------------------------------------
    // Target yaw: ball cam looks from car toward ball; car cam follows the car's heading.
    const carPos = car.pos;
    const carFwd = car.getForward(_v4);
    carFwd.y = 0;
    if (carFwd.lengthSq() < 1e-4) carFwd.set(0, 0, 1);
    carFwd.normalize();

    let targetYaw;
    let lookAt;
    if (view.ballCam) {
      const toBall = _v.copy(bp).sub(carPos);
      toBall.y = 0;
      if (toBall.lengthSq() < 1) toBall.copy(carFwd);
      targetYaw = Math.atan2(toBall.x, toBall.z);
      lookAt = _v3.copy(bp);
    } else {
      // car cam: camera aligns with the car's velocity/heading, swivels with steering
      const vel = _v.copy(car.vel);
      vel.y = 0;
      const dir = vel.lengthSq() > 300 * 300 && !view.rearView ? vel.normalize().lerp(carFwd, 0.5).normalize() : carFwd.clone();
      if (view.rearView) dir.negate();
      targetYaw = Math.atan2(dir.x, dir.z);
      lookAt = _v3.copy(carPos).addScaledVector(dir, 600);
      lookAt.y += 60;
    }
    if (view.ballCam && view.rearView) {
      targetYaw += Math.PI;
      lookAt = _v3.copy(carPos).addScaledVector(_v.set(Math.sin(targetYaw), 0, Math.cos(targetYaw)), 600);
    }

    // smooth the yaw (swivel speed) – RL camera lags behind quick direction changes
    let dYaw = targetYaw - st.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const swivelK = 4 + cs.swivel * 2.4; // 1..10 -> 6.4..28
    const yawRate = view.snap ? 1 : 1 - Math.exp(-swivelK * dt);
    st.yaw += dYaw * yawRate;

    // desired camera position: behind the car along the smoothed yaw, at height, then tilted by angle
    const back = _v.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    const desired = _v2.copy(carPos).addScaledVector(back, cs.distance).add(_v4.set(0, cs.height, 0));
    // ball cam: as the ball rises, pull the camera up/back so both stay in frame
    if (view.ballCam) {
      const dist = Math.hypot(bp.x - carPos.x, bp.z - carPos.z);
      const rise = clamp((bp.y - carPos.y) / Math.max(400, dist), 0, 1.2);
      desired.y += rise * 140;
      desired.addScaledVector(back, rise * 90);
    }
    // keep inside the arena
    desired.y = Math.max(desired.y, 30);
    desired.x = clamp(desired.x, -ARENA.HALF_WIDTH + 60, ARENA.HALF_WIDTH - 60);
    desired.z = clamp(desired.z, -ARENA.HALF_LENGTH - ARENA.GOAL_DEPTH + 60, ARENA.HALF_LENGTH + ARENA.GOAL_DEPTH - 60);
    if (Math.abs(desired.z) > ARENA.HALF_LENGTH - 30 && (Math.abs(desired.x) > ARENA.GOAL_HALF_WIDTH - 40 || desired.y > ARENA.GOAL_HEIGHT - 40)) {
      desired.z = clamp(desired.z, -ARENA.HALF_LENGTH + 60, ARENA.HALF_LENGTH - 60);
    }
    const cs2 = Math.abs(desired.x) + Math.abs(desired.z);
    if (cs2 > ARENA.CORNER_SUM - 80) {
      const f = (ARENA.CORNER_SUM - 80) / cs2;
      desired.x *= f;
      desired.z *= f;
    }
    if (desired.y > ARENA.HEIGHT - 60) desired.y = ARENA.HEIGHT - 60;

    // position stiffness: 0 = loose (lags at speed), 1 = rigid
    const k = 6 + cs.stiffness * 30;
    if (view.snap) {
      st.pos.copy(desired);
      st.look.copy(lookAt);
    } else {
      st.pos.lerp(desired, 1 - Math.exp(-k * dt));
    }
    st.look.lerp(lookAt, 1 - Math.exp(-(view.ballCam ? 24 : 14) * dt));
    cam.position.copy(st.pos);

    // shake
    if (this.shake > 0.05) {
      this.shakeT += dt * 50;
      const s = this.shake;
      cam.position.x += Math.sin(this.shakeT * 1.3) * s;
      cam.position.y += Math.cos(this.shakeT * 1.7) * s * 0.7;
      cam.position.z += Math.sin(this.shakeT * 0.9) * s * 0.5;
      this.shake *= Math.exp(-6 * dt);
    } else this.shake = 0;

    // look, then apply the camera angle (pitch offset) about the camera's right axis
    _m.lookAt(cam.position, st.look, _v4.set(0, 1, 0));
    cam.quaternion.setFromRotationMatrix(_m);
    if (!view.ballCam) {
      // car cam: angle setting pitches the view down slightly
      _q.setFromAxisAngle(_v.set(1, 0, 0), (cs.angle * Math.PI) / 180);
      cam.quaternion.multiply(_q);
    }

    // FOV: supersonic widens slightly
    const targetFov = cs.fov + (car.supersonic ? 3 : 0);
    st.fov = lerp(st.fov || targetFov, targetFov, 1 - Math.exp(-5 * dt));
    cam.fov = st.fov;
    cam.updateProjectionMatrix();
  }

  replayCamera(game, r, dt) {
    const cam = this.camera;
    const st = this.camState;
    const bp = this.ballMesh.position;
    const scorer = game.lastGoal && game.lastGoal.scorer;
    const m = scorer ? this.carMeshes.get(scorer.id) : null;
    // first half: chase cam behind the scorer; second half: goal-line view of the ball
    const phase = r.progress;
    let desired;
    let look;
    if (m && phase < 0.55) {
      const cp = m.group.position;
      const dir = _v.copy(bp).sub(cp);
      dir.y = 0;
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      desired = _v2.copy(cp).addScaledVector(dir, -420).add(_v4.set(0, 180, 0));
      look = _v3.copy(bp).lerp(cp, 0.35);
    } else {
      const sz = Math.sign(bp.z) || 1;
      desired = _v2.set(bp.x * 0.3 + 900, 520, sz * (ARENA.HALF_LENGTH - 1500) - sz * 400);
      look = _v3.copy(bp);
    }
    desired.x = clamp(desired.x, -ARENA.HALF_WIDTH + 80, ARENA.HALF_WIDTH - 80);
    desired.z = clamp(desired.z, -ARENA.HALF_LENGTH + 80, ARENA.HALF_LENGTH - 80);
    desired.y = clamp(desired.y, 60, ARENA.HEIGHT - 100);
    const first = r.progress < 0.02;
    if (first) {
      st.pos.copy(desired);
      st.look.copy(look);
    } else {
      st.pos.lerp(desired, 1 - Math.exp(-3.5 * dt));
      st.look.lerp(look, 1 - Math.exp(-8 * dt));
    }
    cam.position.copy(st.pos);
    cam.lookAt(st.look);
    st.fov = lerp(st.fov, 70, 1 - Math.exp(-4 * dt));
    cam.fov = st.fov;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------
  spawnParticle(car, type) {
    this.spawnParticleAt(car.pos, car.quat, type, car);
  }

  spawnParticleAt(pos, quat, type, car = null) {
    const p = this.getParticle();
    const back = _v.set(0, 0, -1).applyQuaternion(quat).multiplyScalar(75);
    p.mesh.position.copy(pos).add(back).add(_v2.set(0, 22, 0).applyQuaternion(quat));
    const vel = car ? car.vel : _v3.set(0, 0, 0);
    if (type === 'boost') {
      p.mesh.material.color.setHex(Math.random() < 0.5 ? 0xffaa33 : 0xffe0a0);
      p.vel.copy(vel).multiplyScalar(0.25).add(back.multiplyScalar(14)).add(_v2.set((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220));
      p.life = 0.22 + Math.random() * 0.18;
      p.size = 16 + Math.random() * 16;
    } else if (type === 'trail') {
      p.mesh.material.color.setHex(car ? TEAM_COLORS[car.team] : 0xffffff);
      p.vel.set(0, 20, 0);
      p.life = 0.3;
      p.size = 26;
      p.mesh.position.copy(pos).add(_v2.set(0, 30, 0));
    } else if (type === 'skid') {
      p.mesh.material.color.setHex(0x9aa0aa);
      p.vel.set((Math.random() - 0.5) * 120, 60 + Math.random() * 80, (Math.random() - 0.5) * 120);
      p.life = 0.55;
      p.size = 20 + Math.random() * 24;
      p.mesh.material.blending = THREE.NormalBlending;
      p.mesh.position.copy(pos).add(_v2.set((Math.random() - 0.5) * 70, 6, (Math.random() - 0.5) * 70));
    } else if (type === 'dust') {
      p.mesh.material.color.setHex(0x778090);
      p.vel.set((Math.random() - 0.5) * 60, 30, (Math.random() - 0.5) * 60);
      p.life = 0.4;
      p.size = 14 + Math.random() * 10;
      p.mesh.material.blending = THREE.NormalBlending;
      p.mesh.position.copy(pos).add(_v2.set((Math.random() - 0.5) * 60, 4, (Math.random() - 0.5) * 60));
    }
    p.maxLife = p.life;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(p.size);
  }

  burst(pos, color, count = 40, speed = 900, life = 0.9, size = 30) {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle();
      p.mesh.position.copy(pos);
      p.mesh.material.color.setHex(color);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      p.life = life * (0.6 + Math.random() * 0.6);
      p.maxLife = p.life;
      p.size = size * (0.6 + Math.random());
      p.mesh.visible = true;
      p.mesh.scale.setScalar(p.size);
      p.gravity = true;
    }
  }

  /** Expanding ring (dodges, flip resets, goal shockwave). */
  spawnRing(pos, color, radius = 80, life = 0.35) {
    let ring = this.rings.find((r) => !r.mesh.visible);
    if (!ring) {
      if (this.rings.length > 24) return;
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      ring = { mesh, life: 0, maxLife: 1, radius: 1 };
      this.rings.push(ring);
    }
    ring.mesh.visible = true;
    ring.mesh.position.copy(pos);
    ring.mesh.position.y += 4;
    ring.mesh.material.color.setHex(color);
    ring.life = ring.maxLife = life;
    ring.radius = radius;
  }

  getParticle() {
    for (const p of this.particles) if (!p.mesh.visible) return p.reset();
    if (this.particles.length < 800) {
      const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(mesh);
      const p = {
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 10,
        gravity: false,
        reset() {
          this.gravity = false;
          this.mesh.material.blending = THREE.AdditiveBlending;
          return this;
        },
      };
      this.particles.push(p);
      return p;
    }
    return this.particles[Math.floor(Math.random() * this.particles.length)].reset();
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      if (p.gravity) p.vel.y -= 650 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const f = p.life / p.maxLife;
      p.mesh.material.opacity = f * 0.9;
      p.mesh.scale.setScalar(p.size * (0.5 + f));
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const f = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(r.radius * (0.3 + f));
      r.mesh.material.opacity = 0.8 * (1 - f);
    }
  }

  updateMarkers(game) {
    const rings = game.drill ? game.drill.rings || [] : [];
    while (this.markers.length < rings.length) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(300, 18, 10, 40), new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.85 }));
      this.scene.add(m);
      this.markers.push(m);
    }
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const r = rings[i];
      if (!r) {
        m.visible = false;
        continue;
      }
      m.visible = !r.done;
      m.position.set(r.x, r.y > 0 ? r.y : 40, r.z);
      m.scale.setScalar(r.r / 300);
      if (r.y > 0) m.rotation.set(0, this.clock * 0.8, 0);
      else m.rotation.set(Math.PI / 2, 0, 0);
      const pulse = 0.7 + 0.3 * Math.sin(this.clock * 4 + i);
      m.material.opacity = pulse;
      const nextIdx = rings.findIndex((rr) => !rr.done);
      m.material.color.setHex(i === nextIdx ? 0x44ff88 : 0xffdd44);
    }
  }

  setCameraSettings(s) {
    Object.assign(this.camSettings, s);
  }

  kick(amount) {
    this.shake = Math.max(this.shake, amount * 0.5);
  }

  /** Goal explosion: flash light, shockwave ring, particle burst. */
  goalExplosion(pos, color) {
    this.goalFlash = 1;
    this.goalFlashColor.setHex(color);
    this.goalLight.position.copy(pos).add(_v.set(0, 300, 0));
    this.burst(pos, color, 120, 1800, 1.4, 40);
    this.burst(pos, 0xffffff, 40, 900, 0.8, 26);
    this.spawnRing(pos, color, 1400, 0.8);
    this.kick(40);
  }
}

export { CAR, BOOST_PAD, _q, _q2 };
