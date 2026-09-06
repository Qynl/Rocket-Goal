import { ARENA, TEAM, CAR } from '../constants.js';
import { ITEMS } from '../rumble.js';

/**
 * Framework-agnostic HUD state. The engine writes here every frame; React
 * subscribes for the declarative parts (score, boost, feed, …) and reads
 * `live` imperatively (minimap, ball arrow, vignette) from rAF loops.
 */
export class HudStore {
  constructor() {
    this.listeners = new Set();
    this.visible = false;
    this.replay = false;
    this.boardOn = false;
    this.msgTimer = 0;
    this.coachTimer = 0;
    this.feedItems = []; // {id, html, t}
    this.statItems = []; // {id, html, t, mine}
    this.chatItems = []; // {id, html, t}
    this.nextId = 1;
    this.notifyAccum = 0;
    // snapshot consumed by React (rebuilt at ~30 Hz)
    this.snap = {
      visible: false,
      replay: false,
      score: [0, 0],
      clockText: '5:00',
      clockSmall: '',
      ot: false,
      hideScoreboard: false,
      boost: 33,
      boostLow: false,
      speed: 0,
      supersonic: false,
      speedBar: 0,
      pills: [],
      item: null, // Rumble power-up {icon, name, ready, frac, active}
      respawn: null, // seconds until the player's car comes back
      mutators: [],
      arena: '',
      rumble: false,
      message: null, // {html, cls}
      coach: null, // html
      drill: null, // {icon, name, lines, acc, message}
      board: null, // {score, ot, rows}
      feed: [],
      stats: [],
      chat: [],
    };
    // imperative per-frame data (never triggers React renders)
    this.live = {
      vignette: 0,
      ballArrow: null, // {x, y, ang, dist, show}
      minimap: null, // {cars, ball, pads}
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot() {
    return this.snap;
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  /** Snapshots must be immutable for useSyncExternalStore: replace, then notify. */
  commit() {
    this.snap = { ...this.snap };
    this.notify();
  }

  setVisible(v) {
    this.visible = v;
    this.snap.visible = v;
    this.commit();
  }

  setReplay(on) {
    this.replay = on;
    this.snap.replay = on;
    this.commit();
  }

  showMessage(html, cls = '', seconds = 2) {
    this.snap.message = { html, cls };
    this.msgTimer = seconds;
    this.commit();
  }

  addFeed(html, seconds = 4) {
    this.feedItems.push({ id: this.nextId++, html, t: seconds });
    while (this.feedItems.length > 5) this.feedItems.shift();
    this.dirty = true;
  }

  clearFeeds() {
    this.feedItems = [];
    this.statItems = [];
    this.chatItems = [];
    this.dirty = true;
  }

  addStat(label, points, mine = true, seconds = 2.2) {
    this.statItems.push({ id: this.nextId++, html: `<b>+${points}</b> ${label}`, t: seconds, mine });
    while (this.statItems.length > 4) this.statItems.shift();
    this.dirty = true;
  }

  addChat(name, team, text, seconds = 5) {
    this.chatItems.push({ id: this.nextId++, html: `<b class="${team === 0 ? 'blue' : 'orange'}">${name}</b> ${text}`, t: seconds });
    while (this.chatItems.length > 4) this.chatItems.shift();
    this.dirty = true;
  }

  showCoach(text, seconds = 6) {
    this.snap.coach = `<b>Coach</b>${text}`;
    this.coachTimer = seconds;
    this.commit();
  }

  setBoard(on, game) {
    const wasOn = this.boardOn;
    this.boardOn = on;
    if (!on || !game) {
      if (this.snap.board) {
        this.snap.board = null;
        this.dirty = true;
      }
      return;
    }
    if (wasOn && game.frame % 15 !== 0) return; // refresh rows at 8 Hz while held
    const rows = game.cars
      .map((c) => ({ c, s: c.stats }))
      .sort((a, b) => a.c.team - b.c.team || b.s.score - a.s.score)
      .map(({ c, s }) => ({
        name: c.name,
        me: c === game.human,
        team: c.team,
        score: s.score,
        goals: s.goals,
        assists: s.assists,
        saves: s.saves,
        shots: s.shots,
        boost: Math.round(c.boost),
      }));
    this.snap.board = { score: [...game.score], ot: game.overtime, rows };
    this.dirty = true;
  }

  /** Called once per frame by the engine. */
  update(game, dt, input, view) {
    const human = game.human;
    const snap = this.snap;

    // scoreboard / clock
    snap.score = [...game.score];
    if (game.clock === Infinity) {
      snap.clockText = game.drill ? '∞' : 'FREE';
      snap.clockSmall = game.drill ? 'TRAINING' : 'PLAY';
    } else {
      const secs = Math.ceil(game.clock);
      snap.clockText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      snap.clockSmall = game.overtime ? 'OVERTIME' : game.clock < 30 && !game.overtime ? 'FINAL 30' : '';
    }
    snap.ot = game.overtime;
    snap.hideScoreboard = !!game.drill && game.drill.id !== 'kickoffs';

    if (human) {
      const b = Math.round(human.boost);
      snap.boost = b;
      snap.boostLow = b < 15;
      const sp = Math.round(human.speed);
      snap.speed = sp;
      snap.supersonic = human.supersonic;
      snap.speedBar = Math.min(100, (sp / (human.maxSpeed || CAR.MAX_SPEED)) * 100);
      const pills = [];
      pills.push(`<span class="pill ${view.ballCam ? 'on' : ''}">${view.ballCam ? 'Ball cam' : 'Car cam'}</span>`);
      if (!human.onGround) pills.push(`<span class="pill ${human.hasFlip ? 'flip' : ''}">${human.hasFlip ? 'Flip ready' : 'No flip'}</span>`);
      if (human.supersonic) pills.push('<span class="pill on">Supersonic</span>');
      if (input.usingGamepad) pills.push('<span class="pill">Gamepad</span>');
      snap.pills = pills;
      snap.respawn = human.demolished ? Math.max(0, human.respawnTimer) : null;
      // Rumble power-up meter
      if (game.rumble && human.item) {
        const info = ITEMS[human.item.id] || { icon: '?', name: human.item.id };
        const cd = game.rumble.cooldown || 10;
        snap.item = {
          icon: info.icon,
          name: info.name,
          ready: human.item.cooldown <= 0,
          frac: human.item.cooldown > 0 ? Math.max(0, 1 - human.item.cooldown / cd) : 1,
          active: human.item.timer > 0,
          blurb: info.blurb,
        };
      } else if (snap.item) snap.item = null;
      this.live.vignette = human.supersonic ? 0.55 : human.boostActive ? 0.25 : 0;
    }
    if (this._mutGame !== game) {
      this._mutGame = game;
      snap.mutators = game.mutatorSummary || [];
      snap.rumble = !!game.rumble;
    }

    // countdown overrides the centre message
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) snap.message = null;
    }
    if (game.state === 'countdown') {
      const n = Math.ceil(game.stateTimer);
      snap.message = { html: n > 0 ? `${n}` : 'GO!', cls: '' };
      this.msgTimer = 0.5;
    }
    if (this.coachTimer > 0) {
      this.coachTimer -= dt;
      if (this.coachTimer <= 0) snap.coach = null;
    }

    // expire transient lists
    let listChanged = false;
    for (const key of ['feedItems', 'statItems', 'chatItems']) {
      const list = this[key];
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].t -= dt;
        if (list[i].t <= 0) {
          list.splice(i, 1);
          listChanged = true;
        }
      }
    }
    if (listChanged) this.dirty = true;

    // scoreboard refresh while held
    if (this.boardOn && game.frame % 15 === 0) this.setBoard(true, game);
    // drill panel
    if (game.drill) {
      const d = game.drill;
      snap.drill = {
        icon: d.meta.icon,
        name: d.meta.name,
        lines: d.hudLines().filter(Boolean),
        acc: Math.round(d.accuracy * 100),
        message: d.messageTimer > 0 ? d.message : null,
      };
    } else if (snap.drill) snap.drill = null;

    this.updateBallArrow(view, human, game);
    this.updateMinimap(game);

    // throttle React updates to ~30 Hz unless something discrete changed
    this.notifyAccum += dt;
    if (this.dirty || this.notifyAccum > 1 / 30) {
      this.notifyAccum = 0;
      this.dirty = false;
      snap.feed = this.feedItems.map((f) => ({ id: f.id, html: f.html, fade: f.t < 0.5 ? Math.max(0, f.t * 2) : 1 }));
      snap.stats = this.statItems.map((f) => ({ id: f.id, html: f.html, mine: f.mine, fade: f.t < 0.4 ? Math.max(0, f.t * 2.5) : 1 }));
      snap.chat = this.chatItems.map((f) => ({ id: f.id, html: f.html, fade: f.t < 0.6 ? Math.max(0, f.t / 0.6) : 1 }));
      this.commit();
    }
  }

  updateBallArrow(view, human, game) {
    const bs = view && view.ballScreen;
    const active = !view || view.mode !== 'goalReplay';
    const show = bs && !bs.onScreen && human && active && this.visible && !this.replay;
    if (!show) {
      this.live.ballArrow = null;
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    let dx = bs.x;
    let dy = -bs.y; // screen y down
    if (bs.behind) dy = Math.abs(dy) < 0.05 ? 1 : dy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const rx = W * 0.5 - 70;
    const ry = H * 0.5 - 70;
    this.live.ballArrow = {
      x: W * 0.5 + dx * rx,
      y: H * 0.5 + dy * ry,
      ang: (Math.atan2(dy, dx) * 180) / Math.PI,
      dist: `${Math.round(bs.dist / 100) / 10}k`,
    };
  }

  updateMinimap(game) {
    const cars = [];
    for (const c of game.cars) {
      if (c.demolished) continue;
      const f = c.getForward();
      cars.push({ x: c.pos.x, z: c.pos.z, fx: f.x, fz: f.z, team: c.team, me: c === game.human });
    }
    this.live.minimap = {
      cars,
      ball: { x: game.ball.pos.x, z: game.ball.pos.z, y: game.ball.pos.y },
      pads: game.pads.filter((p) => p.big).map((p) => ({ z: p.z, x: p.x, active: p.active })),
    };
  }
}

/** Draw the live minimap data onto a canvas (same projection as the old HUD). */
export function drawMinimap(ctx, cv, data) {
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!data) return;
  const pad = 10;
  const fw = W - pad * 2;
  const fh = H - pad * 2;
  const sx = fw / (ARENA.HALF_LENGTH * 2);
  const sy = fh / (ARENA.HALF_WIDTH * 2);
  const px = (z) => pad + (z + ARENA.HALF_LENGTH) * sx;
  const py = (x) => pad + (-x + ARENA.HALF_WIDTH) * sy;
  ctx.fillStyle = 'rgba(8,12,24,0.7)';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, fw, fh, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px(0), pad);
  ctx.lineTo(px(0), H - pad);
  ctx.stroke();
  ctx.fillStyle = 'rgba(42,108,255,0.7)';
  ctx.fillRect(px(-ARENA.HALF_LENGTH) - 6, py(ARENA.GOAL_HALF_WIDTH), 6, ARENA.GOAL_HALF_WIDTH * 2 * sy);
  ctx.fillStyle = 'rgba(255,138,31,0.7)';
  ctx.fillRect(px(ARENA.HALF_LENGTH), py(ARENA.GOAL_HALF_WIDTH), 6, ARENA.GOAL_HALF_WIDTH * 2 * sy);
  for (const p of data.pads) {
    ctx.fillStyle = p.active ? 'rgba(255,190,60,0.9)' : 'rgba(255,190,60,0.2)';
    ctx.beginPath();
    ctx.arc(px(p.z), py(p.x), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const c of data.cars) {
    ctx.save();
    ctx.translate(px(c.z), py(c.x));
    ctx.rotate(Math.atan2(-c.fx, c.fz));
    ctx.fillStyle = c.team === TEAM.BLUE ? '#5b9bff' : '#ffa552';
    if (c.me) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
    }
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    if (c.me) ctx.stroke();
    ctx.restore();
  }
  const b = data.ball;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px(b.z), py(b.x), 4 + Math.min(4, b.y / 400), 0, Math.PI * 2);
  ctx.fill();
}
