import { defaultControls } from './physics/car.js';

// Two keyboard presets. "rl" mirrors Rocket League's default KBM layout.
export const PRESETS = {
  rl: {
    name: 'Rocket League default (KBM)',
    throttle: ['KeyW'],
    reverse: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    jump: ['Mouse2'],
    boost: ['Mouse0'],
    handbrake: ['ShiftLeft', 'ShiftRight'],
    airRollLeft: ['KeyQ'],
    airRollRight: ['KeyE'],
    useItem: ['KeyX'],
    ballCam: ['Space'],
    rearView: ['Mouse1'],
    scoreboard: ['Tab'],
    pitchUp: ['KeyS'],
    pitchDown: ['KeyW'],
    yawLeft: ['KeyA'],
    yawRight: ['KeyD'],
  },
  keyboard: {
    name: 'Keyboard only',
    throttle: ['KeyW', 'ArrowUp'],
    reverse: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space'],
    boost: ['ShiftLeft', 'ShiftRight'],
    handbrake: ['ControlLeft', 'ControlRight', 'KeyF'],
    airRollLeft: ['KeyQ'],
    airRollRight: ['KeyE'],
    useItem: ['KeyX'],
    ballCam: ['KeyC'],
    rearView: ['KeyR'],
    scoreboard: ['Tab'],
    pitchUp: ['KeyS', 'ArrowDown'],
    pitchDown: ['KeyW', 'ArrowUp'],
    yawLeft: ['KeyA', 'ArrowLeft'],
    yawRight: ['KeyD', 'ArrowRight'],
  },
};

const STORAGE_KEY = 'rocketgoal.input.v1';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = new Set();
    this.presetName = localStorage.getItem(STORAGE_KEY + '.preset') || 'keyboard';
    this.binds = JSON.parse(JSON.stringify(PRESETS[this.presetName] || PRESETS.keyboard));
    try {
      const custom = localStorage.getItem(STORAGE_KEY + '.binds');
      if (custom) this.binds = { ...this.binds, ...JSON.parse(custom) };
    } catch (e) {
      /* ignore */
    }
    this.ballCam = true;
    this.rearView = false;
    this.scoreboard = false;
    this.toggleBallCamRequested = false;
    this.enabled = true;
    this.controls = defaultControls();
    this.gamepadIndex = null;
    this.gamepadDeadzone = 0.12;
    this.usingGamepad = false;
    this.lastGamepadButtons = [];
    this.onAction = null; // callback(actionName)
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      this.usingGamepad = false;
      this.handleAction(e.code);
      if (this.enabled && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.add('Mouse' + e.button);
      this.usingGamepad = false;
      this.handleAction('Mouse' + e.button);
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => this.mouse.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    this.presetName = name;
    this.binds = JSON.parse(JSON.stringify(PRESETS[name]));
    localStorage.setItem(STORAGE_KEY + '.preset', name);
    localStorage.removeItem(STORAGE_KEY + '.binds');
  }

  rebind(action, code) {
    this.binds[action] = [code];
    // keep pitch/yaw in sync with drive keys
    if (action === 'throttle') this.binds.pitchDown = [code];
    if (action === 'reverse') this.binds.pitchUp = [code];
    if (action === 'left') this.binds.yawLeft = [code];
    if (action === 'right') this.binds.yawRight = [code];
    localStorage.setItem(STORAGE_KEY + '.binds', JSON.stringify(this.binds));
  }

  handleAction(code) {
    if (!this.enabled) return;
    if (this.binds.ballCam.includes(code)) {
      this.ballCam = !this.ballCam;
      if (this.onAction) this.onAction('ballCam');
    }
  }

  isDown(action) {
    const codes = this.binds[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c) || this.mouse.has(c)) return true;
    return false;
  }

  pollGamepad() {
    if (this.gamepadIndex === null) {
      // pick up pads that were connected before page load
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p) this.gamepadIndex = p.index;
      if (this.gamepadIndex === null) return null;
    }
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < this.gamepadDeadzone ? 0 : (v - Math.sign(v) * this.gamepadDeadzone) / (1 - this.gamepadDeadzone));
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);
    const bv = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const lx = dz(gp.axes[0] || 0);
    const ly = dz(gp.axes[1] || 0);
    const rt = bv(7);
    const lt = bv(6);
    const anyInput = Math.abs(lx) > 0 || Math.abs(ly) > 0 || rt > 0 || lt > 0 || gp.buttons.some((x) => x.pressed);
    if (anyInput) this.usingGamepad = true;
    if (!this.usingGamepad) return null;
    // Standard mapping (Xbox): A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7
    const out = {
      throttle: rt - lt,
      steer: lx,
      pitch: -ly, // stick down (ly>0) => pitch down? RL: stick back = nose up.  We define +pitch = nose up => stick back (ly>0) => +pitch
      yaw: lx,
      roll: 0,
      jump: b(0),
      boost: b(1),
      handbrake: b(2),
      airRoll: b(2),
      airRollLeft: b(4),
      airRollRight: b(5),
      ballCamPressed: b(3) && !this.lastGamepadButtons[3],
      rearView: b(10),
      scoreboard: b(8),
      item: b(12), // D-pad up
      startPressed: b(9) && !this.lastGamepadButtons[9],
    };
    out.pitch = ly; // stick back (positive y) => nose up
    this.lastGamepadButtons = gp.buttons.map((x) => x.pressed);
    return out;
  }

  /** Build the control state for this frame. */
  update() {
    const c = this.controls;
    const gp = this.pollGamepad();
    // Start pauses/resumes even while a menu has taken the controls away
    if (gp && gp.startPressed && this.onAction) this.onAction('pause');
    if (!this.enabled) {
      Object.assign(c, defaultControls());
      return c;
    }
    if (gp) {
      if (gp.ballCamPressed) {
        this.ballCam = !this.ballCam;
        if (this.onAction) this.onAction('ballCam');
      }
      c.throttle = gp.throttle;
      c.steer = gp.steer;
      c.pitch = gp.pitch;
      c.yaw = gp.yaw;
      c.jump = gp.jump;
      c.boost = gp.boost;
      c.handbrake = gp.handbrake;
      c.roll = 0;
      if (gp.airRollLeft) c.roll = -1;
      else if (gp.airRollRight) c.roll = 1;
      else if (gp.airRoll) {
        c.roll = gp.steer; // free air roll: stick left => roll left
        c.yaw = 0;
      }
      c.useItem = gp.item;
      this.rearView = gp.rearView;
      this.scoreboard = gp.scoreboard;
      return c;
    }
    const fwd = this.isDown('throttle') ? 1 : 0;
    const back = this.isDown('reverse') ? 1 : 0;
    const left = this.isDown('left') ? 1 : 0;
    const right = this.isDown('right') ? 1 : 0;
    c.throttle = fwd - back;
    c.steer = right - left;
    // In the air: W = nose down, S = nose up (RL convention), A/D = yaw
    c.pitch = (this.isDown('pitchUp') ? 1 : 0) - (this.isDown('pitchDown') ? 1 : 0);
    c.yaw = right - left;
    c.jump = this.isDown('jump');
    c.boost = this.isDown('boost');
    c.handbrake = this.isDown('handbrake');
    c.roll = 0;
    if (this.isDown('airRollLeft')) c.roll = -1;
    else if (this.isDown('airRollRight')) c.roll = 1;
    else if (c.handbrake) {
      // free air roll on the powerslide key (RL default): A rolls left, D rolls right
      c.roll = right - left;
      c.yaw = 0;
    }
    c.useItem = this.isDown('useItem');
    this.rearView = this.isDown('rearView');
    this.scoreboard = this.isDown('scoreboard');
    return c;
  }
}

export const BIND_LABELS = {
  throttle: 'Throttle / Pitch down',
  reverse: 'Reverse / Pitch up',
  left: 'Steer left / Yaw left',
  right: 'Steer right / Yaw right',
  jump: 'Jump',
  boost: 'Boost',
  handbrake: 'Powerslide / Air roll',
  airRollLeft: 'Air roll left',
  airRollRight: 'Air roll right',
  useItem: 'Use Rumble item',
  ballCam: 'Toggle ball cam',
  rearView: 'Rear view',
  scoreboard: 'Scoreboard (hold)',
};

export function prettyCode(code) {
  if (!code) return '—';
  if (code === 'Mouse0') return 'Left click';
  if (code === 'Mouse1') return 'Middle click';
  if (code === 'Mouse2') return 'Right click';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  return code.replace('Left', ' L').replace('Right', ' R');
}
