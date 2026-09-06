// Procedural sound effects with WebAudio — no asset files required.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = parseFloat(localStorage.getItem('rocketgoal.volume') ?? '0.6');
    this.engine = null;
    this.boostNode = null;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.setupEngine();
      return true;
    } catch (e) {
      this.enabled = false;
      return false;
    }
  }

  resume() {
    if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    localStorage.setItem('rocketgoal.volume', String(v));
    if (this.master) this.master.gain.value = v;
  }

  setupEngine() {
    const ctx = this.ctx;
    // engine: two detuned saws through a lowpass
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 60;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 61;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o1.start();
    o2.start();
    this.engine = { g, lp, o1, o2 };
    // boost: filtered noise
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const bg = ctx.createGain();
    bg.gain.value = 0;
    noise.connect(bp);
    bp.connect(bg);
    bg.connect(this.master);
    noise.start();
    this.boostNode = { g: bg, bp };
    // wind / supersonic
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 500;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wind.connect(wlp);
    wlp.connect(wg);
    wg.connect(this.master);
    wind.start();
    this.windNode = { g: wg, lp: wlp };
  }

  /** Called every frame with the human car */
  updateEngine(car, dt) {
    if (!this.ctx || !this.engine || !this.enabled) return;
    const t = this.ctx.currentTime;
    const speed = car ? car.speed : 0;
    const thr = car ? Math.abs(car.controls.throttle) : 0;
    const f = 55 + (speed / 2300) * 160 + thr * 20;
    this.engine.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.o2.frequency.setTargetAtTime(f * 1.01 + 1, t, 0.05);
    this.engine.lp.frequency.setTargetAtTime(300 + speed * 0.5 + thr * 300, t, 0.05);
    const vol = car && !car.demolished ? 0.05 + thr * 0.05 + (speed / 2300) * 0.04 : 0;
    this.engine.g.gain.setTargetAtTime(vol, t, 0.05);
    const boosting = car && car.boostActive;
    this.boostNode.g.gain.setTargetAtTime(boosting ? 0.16 : 0, t, boosting ? 0.03 : 0.08);
    this.boostNode.bp.frequency.setTargetAtTime(700 + speed * 0.4, t, 0.05);
    const wind = car ? Math.max(0, (speed - 1400) / 900) : 0;
    this.windNode.g.gain.setTargetAtTime(wind * 0.12, t, 0.1);
  }

  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
    if (!this.ensure() || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, vol = 0.3, freq = 1000, q = 1) {
    if (!this.ensure() || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  ballHit(strength, own = false) {
    const s = Math.min(1, strength / 2500);
    // thump (low sine with pitch drop) + slap (bandpassed noise)
    this.noise(0.1 + s * 0.16, (0.25 + s * 0.55) * (own ? 1 : 0.8), 220 + s * 260, 0.9);
    this.tone(110 + s * 30, 0.16 + s * 0.12, 'sine', 0.3 + s * 0.35, -60);
    if (s > 0.6) this.tone(1800, 0.05, 'square', 0.05 * s);
  }
  ballBounce(strength) {
    const s = Math.min(1, strength / 1500);
    if (s < 0.05) return;
    this.noise(0.08, 0.06 + s * 0.2, 180, 1);
    this.tone(95, 0.1, 'sine', 0.08 + s * 0.15, -30);
  }
  jump(gain = 1) {
    this.noise(0.1, 0.16 * gain, 700, 1.5);
    this.tone(240, 0.1, 'triangle', 0.12 * gain, 140);
  }
  flip(gain = 1) {
    this.noise(0.28, 0.2 * gain, 1000, 0.8);
    this.tone(180, 0.2, 'sawtooth', 0.05 * gain, -90);
  }
  land(strength, gain = 1) {
    const s = Math.min(1, strength / 1000);
    this.noise(0.08 + s * 0.08, (0.1 + s * 0.3) * gain, 160, 0.8);
    this.tone(70, 0.1, 'sine', 0.15 * s * gain, -20);
  }
  pad(big) {
    this.tone(big ? 660 : 880, 0.12, 'sine', 0.22, big ? 220 : 120);
    if (big) this.tone(990, 0.2, 'sine', 0.15, 200);
  }
  goal(scored) {
    const base = scored ? 523 : 220;
    const seq = scored ? [0, 4, 7, 12, 16] : [0, -1, -3, -5];
    seq.forEach((n, i) => setTimeout(() => this.tone(base * Math.pow(2, n / 12), 0.4, scored ? 'triangle' : 'sawtooth', 0.25), i * 90));
    this.explosion();
    this.crowd(scored ? 1 : 0.5);
  }
  explosion() {
    this.noise(0.9, 0.9, 120, 0.5);
    this.tone(60, 0.6, 'sine', 0.5, -40);
  }
  countdown(n) {
    if (n === 0) {
      this.tone(880, 0.35, 'square', 0.18);
      this.tone(1320, 0.5, 'square', 0.12);
    } else this.tone(440, 0.15, 'square', 0.15);
  }
  demo() {
    this.explosion();
  }
  ui() {
    this.tone(1200, 0.06, 'sine', 0.12);
  }
  wallHit(strength, gain = 1) {
    const s = Math.min(1, strength / 1500);
    this.noise(0.15, (0.12 + s * 0.35) * gain, 240, 0.7);
    this.tone(60, 0.14, 'sine', 0.2 * s * gain, -20);
  }
  crowd(level) {
    // short crowd swell (goal / big save)
    if (!this.ensure() || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * level, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 3.6);
  }
  success() {
    [0, 4, 7].forEach((n, i) => setTimeout(() => this.tone(660 * Math.pow(2, n / 12), 0.2, 'triangle', 0.2), i * 70));
  }
  fail() {
    this.tone(200, 0.3, 'sawtooth', 0.15, -60);
  }
  whistle() {
    this.tone(2200, 0.5, 'sine', 0.12, 50);
  }
}
