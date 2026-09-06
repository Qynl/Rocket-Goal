import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
const _c = new THREE.Color();

// Rocket League camera presets (RL units / degrees)
export const CAMERA_PRESETS = {
  default: { fov: 90, distance: 270, height: 110, angle: -3, stiffness: 0.5, swivel: 2.5, transition: 1.2 },
  pro: { fov: 110, distance: 270, height: 100, angle: -3, stiffness: 0.45, swivel: 5, transition: 1.0 },
  wide: { fov: 110, distance: 300, height: 120, angle: -5, stiffness: 0.35, swivel: 4, transition: 1.2 },
};

const SKY_TOP = new THREE.Color(0x070d1f);
const SKY_MID = new THREE.Color(0x12204a);
const SKY_BOTTOM = new THREE.Color(0x2a4470);

/** Vignette + saturation + edge chromatic aberration grade. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSat: { value: 1.12 },
    uCA: { value: 0.0016 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform float uCA;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + d * uCA * r2 * 4.0).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - d * uCA * r2 * 4.0).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col *= 1.0 - uVignette * smoothstep(0.12, 0.9, r2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const QUALITY = {
  low: { dpr: 1, shadows: 0, samples: 0, bloom: false, bloomStrength: 0, env: true },
  medium: { dpr: 1.25, shadows: 2048, samples: 2, bloom: true, bloomStrength: 0.28, env: true },
  high: { dpr: 2, shadows: 4096, samples: 4, bloom: true, bloomStrength: 0.38, env: true },
  ultra: { dpr: 2, shadows: 4096, samples: 8, bloom: true, bloomStrength: 0.5, env: true },
};

export class Renderer {
  constructor(canvas, glRenderer = null) {
    this.canvas = canvas;
    this.renderer = glRenderer || new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.isStub = !!glRenderer;

    this.scene = new THREE.Scene();
    this.scene.background = SKY_TOP.clone();
    this.scene.fog = new THREE.Fog(0x16264c, 14000, 42000);

    this.camera = new THREE.PerspectiveCamera(90, 1, 5, 60000);
    this.camState = {
      pos: new THREE.Vector3(0, 500, -5000),
      look: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      fov: 90,
      transition: 0,
    };
    this.camSettings = { ...CAMERA_PRESETS.default };
    this.camera.fov = this.camSettings.fov;
    this.flashes = [];
    this.flashTimer = 0;
    this.ballGlow = 0;
    this.pillar = null;

    this.setupLights();
    if (!this.isStub) this.buildEnvironment();
    this.buildSky();
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

    // goal explosion light + pillar
    this.goalLight = new THREE.PointLight(0xffffff, 0, 6000, 1.2);
    this.scene.add(this.goalLight);

    this.setupPost();
    this.setQuality('high');
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  // ------------------------------------------------------------------ post
  setupPost() {
    if (this.isStub) {
      this.composer = null;
      return;
    }
    const q = QUALITY[this.quality] || QUALITY.high;
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: q.samples,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, q.bloomStrength, 0.55, 0.82);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setQuality(qname) {
    if (!QUALITY[qname]) qname = 'high';
    this.quality = qname;
    const q = QUALITY[qname];
    if (this.isStub) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.dpr));
    this.renderer.shadowMap.enabled = q.shadows > 0;
    if (this.sun) {
      this.sun.castShadow = q.shadows > 0;
      if (q.shadows > 0) this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    if (this.bloom) {
      this.bloom.enabled = q.bloom;
      this.bloom.strength = q.bloomStrength;
    }
    // MSAA sample count lives on the composer's render targets -> rebuild
    this.disposeComposer();
    this.setupPost();
    this.onResize();
  }

  disposeComposer() {
    if (!this.composer) return;
    this.composer.dispose && this.composer.dispose();
    this.composer = null;
  }

  // ------------------------------------------------------------------ light
  setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x141c2c, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
    sun.position.set(2600, 7000, -2800);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -6500;
    sun.shadow.camera.right = 6500;
    sun.shadow.camera.top = 7500;
    sun.shadow.camera.bottom = -7500;
    sun.shadow.camera.near = 500;
    sun.shadow.camera.far = 18000;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 3;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x86a8ff, 0.5);
    fill.position.set(-3000, 3200, 4000);
    this.scene.add(fill);
    const fill2 = new THREE.DirectionalLight(0xffd9b0, 0.25);
    fill2.position.set(2000, 2400, 6000);
    this.scene.add(fill2);
    // goal glow lights
    this.goalGlow = [];
    for (const sz of [-1, 1]) {
      const p = new THREE.PointLight(TEAM_COLORS[sz < 0 ? 0 : 1], 4, 5000, 1.6);
      p.position.set(0, 400, sz * 5300);
      this.scene.add(p);
      this.goalGlow.push(p);
    }
    // corner floodlight rigs (visual + gentle spotlights, sun keeps the shadows)
    this.floodSpots = [];
    const R = ARENA.HALF_WIDTH + 3800;
    const L = ARENA.HALF_LENGTH + 4500;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const spot = new THREE.SpotLight(0xeaf2ff, 1.1, 26000, Math.PI / 5, 0.5, 1.2);
        spot.position.set(sx * R, 5300, sz * L);
        spot.target.position.set(sx * 1500, 0, sz * 1500);
        this.scene.add(spot, spot.target);
        this.floodSpots.push(spot);
      }
    }
  }

  /** Night-stadium reflections for paint/glass/metal (PMREM from a tiny procedural scene). */
  buildEnvironment() {
    const envScene = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.SphereGeometry(100, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x0a1128, side: THREE.BackSide })
    );
    envScene.add(room);
    // light panels overhead
    const panel = new THREE.MeshBasicMaterial({ color: 0xdfe9ff });
    for (let i = 0; i < 4; i++) {
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(50, 14), panel);
      lp.position.set(Math.cos((i / 4) * Math.PI * 2) * 35, 60, Math.sin((i / 4) * Math.PI * 2) * 35);
      lp.lookAt(0, 0, 0);
      envScene.add(lp);
    }
    // team glows at both ends
    for (const sz of [-1, 1]) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(22, 12, 8), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[sz < 0 ? 0 : 1] }));
      glow.position.set(0, 10, sz * 80);
      envScene.add(glow);
    }
    // floor bounce
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshBasicMaterial({ color: 0x27324e }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -40;
    envScene.add(floor);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    this.envRT = rt;
    pmrem.dispose();
  }

  // ------------------------------------------------------------------ sky
  buildSky() {
    // gradient dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP.clone() },
        mid: { value: SKY_MID.clone() },
        bottom: { value: SKY_BOTTOM.clone() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = h > 0.18
            ? mix(mid, top, smoothstep(0.18, 0.85, h))
            : mix(bottom, mid, smoothstep(-0.05, 0.18, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(52000, 32, 20), skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);

    // stars (upper hemisphere only, additive)
    const N = 1600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(Math.random() * 0.85 + 0.15); // 0..~49° from zenith
      const r = 48000;
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p);
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 90, sizeAttenuation: true, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
    this.scene.add(this.stars);

    // moon
    const moon = new THREE.Mesh(new THREE.CircleGeometry(1800, 32), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, toneMapped: false }));
    moon.position.set(-19000, 22000, 26000);
    moon.lookAt(0, 0, 0);
    this.scene.add(moon);
    const moonGlow = new THREE.Mesh(new THREE.CircleGeometry(3600, 32), new THREE.MeshBasicMaterial({ color: 0x8fa8dd, transparent: true, opacity: 0.25, fog: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    moonGlow.position.copy(moon.position).multiplyScalar(0.999);
    moonGlow.lookAt(0, 0, 0);
    this.scene.add(moonGlow);

    this.buildSkyline();
  }

  /** Distant city silhouette ring with lit windows (canvas texture on a cylinder). */
  buildSkyline() {
    const W = 4096;
    const H = 640;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    let x = 0;
    while (x < W) {
      const bw = 60 + Math.random() * 140;
      const bh = 120 + Math.random() * 440;
      ctx.fillStyle = '#0b1122';
      ctx.fillRect(x, H - bh, bw, bh);
      // windows
      ctx.fillStyle = 'rgba(255,214,140,0.85)';
      for (let wy = H - bh + 14; wy < H - 18; wy += 22) {
        for (let wx = x + 8; wx < x + bw - 8; wx += 16) {
          if (Math.random() < 0.32) ctx.fillRect(wx, wy, 6, 9);
        }
      }
      // antenna sometimes
      if (Math.random() < 0.3) {
        ctx.strokeStyle = '#0b1122';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x + bw / 2, H - bh);
        ctx.lineTo(x + bw / 2, H - bh - 40);
        ctx.stroke();
      }
      x += bw + 14;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const skyline = new THREE.Mesh(
      new THREE.CylinderGeometry(38000, 38000, H * 4, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, side: THREE.BackSide, depthWrite: false })
    );
    skyline.position.y = H * 2 - 600;
    this.scene.add(skyline);
  }

  // ------------------------------------------------------------------ stadium
  buildStadium() {
    const group = new THREE.Group();
    const R = ARENA.HALF_WIDTH + 700;
    const L = ARENA.HALF_LENGTH + 700;
    const tiers = 16;
    const seatMats = [0x27365e, 0x2e3a5c, 0x223055, 0x33406b].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0.05 }));
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x1a2136, roughness: 0.6, metalness: 0.3 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x2fa9ff, toneMapped: false });
    for (let t = 0; t < tiers; t++) {
      const y = 300 + t * 230;
      const inset = t * 250;
      const mat = seatMats[t % seatMats.length];
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(250, 230, L * 2 - 1200), mat);
        m.position.set(sx * (R + inset + 125), y, 0);
        group.add(m);
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(14, 60, L * 2 - 1200), fasciaMat);
        fascia.position.set(sx * (R + inset - 2), y + 100, 0);
        group.add(fascia);
      }
      for (const sz of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(R * 2 - 1200, 230, 250), mat);
        m.position.set(0, y, sz * (L + inset + 125 + 900));
        group.add(m);
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(R * 2 - 1200, 60, 14), fasciaMat);
        fascia.position.set(0, y + 100, sz * (L + inset + 1223));
        group.add(fascia);
      }
      // LED band on the front of the first tier
      if (t === 2) {
        for (const sx of [-1, 1]) {
          const led = new THREE.Mesh(new THREE.BoxGeometry(6, 22, L * 2 - 1500), ledMat);
          led.position.set(sx * (R + inset - 12), y + 80, 0);
          group.add(led);
        }
        for (const sz of [-1, 1]) {
          const led = new THREE.Mesh(new THREE.BoxGeometry(R * 2 - 1500, 22, 6), ledMat);
          led.position.set(0, y + 80, sz * (L + inset + 1110));
          group.add(led);
        }
      }
    }
    // outer floor
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3;
    group.add(ground);
    // crowd — denser, mixed fans, two blobs so the "wave" has depth
    const crowdGeo = new THREE.BufferGeometry();
    const pts = [];
    const cols = [];
    for (const blob of [0, 1]) {
      const count = blob === 0 ? 11000 : 5000;
      for (let i = 0; i < count; i++) {
        const t = Math.floor(Math.random() * tiers);
        const y = 300 + t * 230 + 140 + blob * 30;
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
        const c = _c.setHex(TEAM_COLORS[team]).offsetHSL((Math.random() - 0.5) * 0.06, -0.25, (Math.random() - 0.5) * 0.35);
        if (Math.random() < 0.3) c.setHSL(Math.random(), 0.45, 0.55);
        cols.push(c.r, c.g, c.b);
      }
    }
    crowdGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    crowdGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.crowd = new THREE.Points(crowdGeo, new THREE.PointsMaterial({ size: 62, vertexColors: true, sizeAttenuation: true }));
    group.add(this.crowd);
    // camera-flash sparkles in the stands
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(180);
      group.add(sp);
      this.flashes.push({ sp, t: 0 });
    }
    this.stadiumGroup = group;
    // flood lights at the four corners (towers)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(40, 70, 5200, 10), new THREE.MeshStandardMaterial({ color: 0x4b5262, roughness: 0.6, metalness: 0.5 }));
        pole.position.set(sx * (R + 3800), 2600, sz * (L + 4500));
        group.add(pole);
        const head = new THREE.Group();
        for (let i = 0; i < 8; i++) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(150, 90, 40), new THREE.MeshBasicMaterial({ color: 0xf6faff, toneMapped: false }));
          lamp.position.set((i % 4 - 1.5) * 170, Math.floor(i / 4) * 110, 0);
          head.add(lamp);
        }
        head.position.set(sx * (R + 3800), 5300, sz * (L + 4500));
        head.lookAt(0, 0, 0);
        group.add(head);
      }
    }
    this.buildJumbotrons(group);
    this.scene.add(group);
  }

  /** Big score screens hanging above each goal. */
  buildJumbotrons(group) {
    this.jumbotrons = [];
    for (const sz of [-1, 1]) {
      const cv = document.createElement('canvas');
      cv.width = 1024;
      cv.height = 512;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1300), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(0, 3000, sz * (ARENA.HALF_LENGTH + 2600));
      screen.lookAt(0, 1200, 0);
      group.add(screen);
      // frame + struts
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2760, 1460, 90), new THREE.MeshStandardMaterial({ color: 0x232a3c, roughness: 0.6, metalness: 0.5 }));
      frame.position.copy(screen.position);
      frame.quaternion.copy(screen.quaternion);
      frame.translateZ(-60);
      group.add(frame);
      this.jumbotrons.push({ cv, tex, ctx: cv.getContext('2d'), lastKey: '' });
    }
  }

  drawJumbotron(j, score, clockText, ot) {
    const key = `${score[0]}-${score[1]}-${clockText}-${ot}`;
    if (key === j.lastKey) return;
    j.lastKey = key;
    const ctx = j.ctx;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, 1024, 512);
    const grad = ctx.createLinearGradient(0, 0, 1024, 0);
    grad.addColorStop(0, '#123a8f');
    grad.addColorStop(0.5, '#0a1030');
    grad.addColorStop(1, '#8f4a12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);
    ctx.font = 'bold 300px Rajdhani, Arial Narrow, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7fb3ff';
    ctx.fillText(String(score[0]), 240, 250);
    ctx.fillStyle = '#ffb066';
    ctx.fillText(String(score[1]), 784, 250);
    ctx.fillStyle = '#dfe6ff';
    ctx.font = 'bold 150px Rajdhani, Arial Narrow, Arial';
    ctx.fillText('–', 512, 235);
    ctx.font = 'bold 84px Rajdhani, Arial Narrow, Arial';
    ctx.fillStyle = '#9fb0d8';
    ctx.fillText(ot ? 'OVERTIME' : clockText, 512, 430);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 1008, 496);
    j.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ ball
  buildBall() {
    const cv = document.createElement('canvas');
    cv.width = 2048;
    cv.height = 1024;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#cdd3e0';
    ctx.fillRect(0, 0, 2048, 1024);
    // hex panel pattern
    ctx.fillStyle = '#8d97ad';
    const hexR = 52;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 24; col++) {
        const x = col * 88 + (row % 2 ? 44 : 0);
        const y = 30 + row * 82;
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
    // seams
    ctx.strokeStyle = '#39445e';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(2048, 512);
    ctx.stroke();
    ctx.lineWidth = 9;
    for (const y of [235, 789]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(2048, y);
      ctx.stroke();
    }
    // subtle glow triangles like the RL ball
    ctx.strokeStyle = 'rgba(120,190,255,0.35)';
    ctx.lineWidth = 5;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 24; col++) {
        if ((row + col) % 5 !== 0) continue;
        const x = col * 88 + (row % 2 ? 44 : 0);
        const y = 30 + row * 82;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * hexR * 0.95;
          const py = y + Math.sin(a) * hexR * 0.95;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.32,
      metalness: 0.42,
      envMapIntensity: 1.2,
      emissive: new THREE.Color(0x88bbff),
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.RADIUS, 48, 32), mat);
    mesh.castShadow = true;
    this.ballMat = mat;
    return mesh;
  }

  /** Called by the engine on ball touches: flashes the ball's glow seams. */
  ballTouch(speed) {
    this.ballGlow = Math.min(1, this.ballGlow + speed / 2300);
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
    if (this.composer) {
      // keep the composer's render targets in sync with the device pixel ratio
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
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
    void color;
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

  // ------------------------------------------------------------------ frame
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
    // ball glow seams fade after touches
    if (this.ballGlow > 0) {
      this.ballGlow = Math.max(0, this.ballGlow - dt * 1.6);
      this.ballMat.emissiveIntensity = this.ballGlow * 0.8;
    }

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
      pm.ringMat.opacity = p.active ? 0.9 : 0.15;
      if (pm.beam) pm.beam.material.opacity = p.active ? 0.1 + 0.06 * Math.sin(this.clock * 2.5 + i) : 0;
      if (p.active) {
        pm.orb.rotation.y += dt * 1.6;
        pm.orb.rotation.x += dt * 0.7;
        pm.orb.position.y = (p.big ? 110 : 55) + Math.sin(this.clock * 3 + i) * 6;
      } else if (p.timer > 0) {
        const total = p.big ? BOOST_PAD.BIG_RESPAWN : BOOST_PAD.SMALL_RESPAWN;
        pm.ringMat.opacity = 0.15 + 0.55 * (1 - p.timer / total);
      }
    }

    // arena ambience: LED pulse, scrolling ads, goal mouth glow
    const anim = this.arena.animated;
    if (anim) {
      for (const led of anim.leds) {
        led.mat.color.copy(led.base).multiplyScalar(0.75 + 0.35 * Math.sin(this.clock * 2 + led.phase));
      }
      for (const ad of anim.ads) {
        ad.map.offset.x = (this.clock * 0.012) % 1;
      }
      const goalPulse = 0.2 + 0.12 * Math.sin(this.clock * 2.2);
      for (const g of anim.goalGlow) {
        g.material.opacity = goalPulse + this.goalFlash * 0.5;
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
        this.landingMarker.rotation.z += dt * 0.8;
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
    if (this.pillar) {
      this.pillar.life -= dt;
      const f = Math.max(0, this.pillar.life / this.pillar.maxLife);
      this.pillar.mesh.material.opacity = 0.5 * f;
      this.pillar.mesh.scale.set(1 + (1 - f) * 2.5, 1, 1 + (1 - f) * 2.5);
      if (this.pillar.life <= 0) {
        this.scene.remove(this.pillar.mesh);
        this.pillar = null;
      }
    }

    // crowd: gentle sway + camera flashes (more after goals)
    if (this.crowd) {
      this.crowd.position.y = Math.sin(this.clock * 2.2) * 6;
      this.crowd.position.x = Math.sin(this.clock * 1.1) * 10;
      this.flashTimer -= dt;
      const rate = this.goalFlash > 0 ? 18 : 2.2;
      if (this.flashTimer <= 0) {
        this.flashTimer = 1 / rate;
        const f = this.flashes.find((x) => x.t <= 0);
        if (f) {
          f.t = 0.14;
          const side = Math.floor(Math.random() * 4);
          const t = Math.floor(Math.random() * 16);
          const inset = t * 250;
          const R2 = ARENA.HALF_WIDTH + 700;
          const L2 = ARENA.HALF_LENGTH + 700;
          if (side < 2) f.sp.position.set((side === 0 ? -1 : 1) * (R2 + inset + 150), 300 + t * 230 + 150, (Math.random() - 0.5) * (L2 * 2 - 1400));
          else f.sp.position.set((Math.random() - 0.5) * (R2 * 2 - 1400), 300 + t * 230 + 150, (side === 2 ? -1 : 1) * (L2 + inset + 150 + 900));
        }
      }
      for (const f of this.flashes) {
        if (f.t > 0) {
          f.t -= dt;
          f.sp.material.opacity = clamp(f.t / 0.14, 0, 1);
        } else f.sp.material.opacity = 0;
      }
    }

    // jumbotrons follow the score/clock
    if (this.jumbotrons && game.score) {
      const clockText = game.clock === Infinity ? (game.drill ? 'TRAINING' : 'FREE PLAY') : `${Math.floor(Math.ceil(game.clock) / 60)}:${String(Math.ceil(game.clock) % 60).padStart(2, '0')}`;
      for (const j of this.jumbotrons) this.drawJumbotron(j, game.score, clockText, game.overtime);
    }

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
      if (w.front) w.pivot.rotation.y = car.steerVisual * 0.45;
      // wheel droop in the air
      w.pivot.position.y = car.onGround ? -squat * 0.5 : -4;
    }
    const boosting = car.boostActive;
    m.flame.visible = boosting;
    m.flameCore.visible = boosting;
    m.flameLight.intensity = boosting ? 7 + Math.random() * 4 : 0;
    if (boosting) {
      const s = 0.85 + Math.random() * 0.4;
      m.flame.scale.set(1, s, 1);
      m.flameCore.scale.set(1, s * 1.1, 1);
      if (Math.random() < 0.7) this.spawnParticle(car, 'boost');
    }
    // brake lights
    if (m.brakeMat) {
      const braking = car.controls.throttle < -0.1 || (car.controls.throttle === 0 && car.onGround && car.speed > 200);
      m.brakeMat.emissiveIntensity = lerp(m.brakeMat.emissiveIntensity, braking ? 6 : 1.2, 1 - Math.exp(-12 * dt));
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
    m.underglow.visible = car.onGround || car.boostActive;
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
        if (w.front) w.pivot.rotation.y = lerp(fa.steer, fb.steer, u) * 0.45;
      }
      m.flame.visible = fa.boost;
      m.flameCore.visible = fa.boost;
      m.flameLight.intensity = fa.boost ? 7 : 0;
      if (fa.boost && Math.random() < 0.5) this.spawnParticleAt(m.group.position, m.group.quaternion, 'boost');
      m.trail.mat.uniforms.opacity.value = 0;
      m.underglow.visible = true;
    }
  }

  // ---------------------------------------------------------------- camera
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
    const swivelK = 4 + cs.swivel * 2.4;
    const yawRate = view.snap ? 1 : 1 - Math.exp(-swivelK * dt);
    st.yaw += dYaw * yawRate;

    // desired camera position: behind the car along the smoothed yaw, at height, then tilted by angle
    const back = _v.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
    const desired = _v2.copy(carPos).addScaledVector(back, cs.distance).add(_v4.set(0, cs.height, 0));
    // ball cam: as the ball climbs, lift and pull the camera back so a high
    // aerial ball stays comfortably in frame (aerial-friendly camera)
    if (view.ballCam) {
      const dist = Math.hypot(bp.x - carPos.x, bp.z - carPos.z);
      const climb = clamp(bp.y - carPos.y, 0, 2600);
      const rise = climb > 150 ? climb : 0;
      desired.y += rise * 0.38;
      desired.addScaledVector(back, Math.min(rise * 0.3, 850));
      // never let the camera drop below the look line for high balls
      void dist;
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

  // ---------------------------------------------------------------- particles
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

  /** Goal explosion: flash light, shockwave ring, particle burst, light pillar. */
  goalExplosion(pos, color) {
    this.goalFlash = 1;
    this.goalFlashColor.setHex(color);
    this.goalLight.position.copy(pos).add(_v.set(0, 300, 0));
    this.burst(pos, color, 140, 1900, 1.4, 42);
    this.burst(pos, 0xffffff, 50, 1000, 0.8, 26);
    this.burst(pos, color, 60, 3200, 1.8, 30);
    this.spawnRing(pos, color, 1600, 0.9);
    this.spawnRing(pos, 0xffffff, 900, 0.6);
    this.kick(46);
    if (!this.isStub) {
      if (this.pillar) this.scene.remove(this.pillar.mesh);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(120, 260, 3600, 24, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })
      );
      mesh.position.copy(pos).add(_v.set(0, 1800, 0));
      this.scene.add(mesh);
      this.pillar = { mesh, life: 1.1, maxLife: 1.1 };
    }
  }
}

export { CAR, BOOST_PAD, _q, _q2 };
