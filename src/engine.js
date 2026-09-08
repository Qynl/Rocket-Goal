import { Game } from './game.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Coach } from './coach.js';
import { QuickChat } from './chat.js';
import { TEAM_COLORS, TEAM_NAMES, BOOST_PADS, CAR } from './constants.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { NetSession } from './net/session.js';
import { P2PConnection, P2P_FAIL_MESSAGE } from './net/connection.js';
import { Ball } from './physics/ball.js';
import { Car } from './physics/car.js';
import { ITEMS } from './rumble.js';
import { awardMatch } from './progress.js';
import { escapeHtml } from './ui/hudStore.js';

/**
 * Game engine controller. Owns the simulation, renderer, input and audio and
 * exposes an imperative API that the React shell (App.jsx) drives. UI screens
 * are requested through the `onUi` callback.
 */
export class Engine {
  constructor(canvas, hud, glRenderer = null) {
    this.canvas = canvas;
    this.hud = hud;
    // glRenderer is only injected by the headless tests (scripts/*test.mjs); the
    // browser always passes null and gets a real WebGLRenderer.
    this.renderer = new Renderer(canvas, glRenderer);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.game = null;
    this.coach = null;
    this.settings = loadSettings();
    this.onUi = null; // (payload) => void — set by React
    this.uiOpen = true; // a menu screen is showing (blocks gameplay hotkeys)
    this.config = null;
    this.view = { ballCam: true, rearView: false, followCar: null, mode: 'play', snap: false };
    this.lastTime = performance.now();
    this.running = false;
    this.replayTimer = 0;
    this.countdownLast = 4;
    this.net = null; // live NetSession (online play), created from the menu

    this.renderer.setCameraSettings(this.settings.camera);
    this.renderer.setQuality(this.settings.quality || 'high');
    this.renderer.setArenaTheme(this.settings.arena || 'stadium');
    this.renderer.showPrediction = this.settings.showPrediction;
    this.audio.setVolume(this.settings.volume);
    this.prevUseItem = false;

    this.input.onAction = (a) => {
      if (a === 'ballCam') this.audio.ui();
      if (a === 'pause') this.togglePause();
    };
    this.input.onKey = (code) => this.onKey(code);
    window.addEventListener('pointerdown', () => this.audio.resume(), { once: false });
    window.addEventListener('keydown', () => this.audio.resume());

    this.hud.setVisible(false);
    requestAnimationFrame((t) => this.loop(t));
  }

  ui(payload) {
    this.uiOpen = payload.type !== 'hide';
    this.input.enabled = !this.uiOpen && !!this.game;
    if (this.onUi) this.onUi(payload);
  }

  /** Apply + persist a settings object (React owns the object; we apply side effects). */
  applySettings(s) {
    this.settings = s;
    saveSettings(s);
    this.renderer.setCameraSettings(s.camera);
    this.renderer.setQuality(s.quality || 'high');
    this.renderer.setArenaTheme(s.arena || 'stadium');
    this.renderer.showPrediction = s.showPrediction;
    this.audio.setVolume(s.volume);
    if (this.chat) this.chat.enabled = s.quickChat !== false;
    if (this.renderer.showcase) this.setGaragePreview(s.loadout);
  }

  // ---- garage preview (menu turntable) ------------------------------------
  /** Put a car on the turntable behind the menus so the garage shows the real model. */
  setGaragePreview(loadout) {
    const car = new Car(this.settings.humanTeam || 0, this.settings.playerName || 'You', false, loadout || this.settings.loadout);
    car.setPose(0, 0, Math.PI * 0.25, 100);
    car.pos.y = CAR.REST_HEIGHT;
    this.previewCar = car;
    this.renderer.showcase = { car };
    return car;
  }

  clearGaragePreview() {
    this.previewCar = null;
    this.renderer.showcase = null;
  }

  onKey(code) {
    if (code === 'Escape') {
      if (this.game) this.togglePause();
      return;
    }
    if (!this.game || this.uiOpen) return;
    if (code.startsWith('Digit') && this.chat && this.game.config.mode === 'match') {
      this.chat.humanSay(Number(code.slice(5)));
      this.audio.ui();
      return;
    }
    if (code === 'KeyP') {
      this.renderer.showPrediction = !this.renderer.showPrediction;
      this.hud.addFeed(`Prediction ${this.renderer.showPrediction ? 'on' : 'off'}`);
    }
    if (code === 'KeyT' && (this.game.config.mode === 'freeplay' || this.game.drill)) {
      if (this.game.drill) this.game.drill.nextAttempt();
      else this.game.resetFreeplay();
    }
    if (code === 'KeyH') {
      this.renderer.showHitbox = !this.renderer.showHitbox;
    }
  }

  startGame(config) {
    this.audio.resume();
    const online = !!(config.net && config.net.online);
    const mySeat = online && config.roster ? config.roster[config.net.seat] : null;
    this.config = {
      ...config,
      playerName: online ? (mySeat ? mySeat.name : this.settings.playerName) : this.settings.playerName,
      // an online match is played in the host's arena, with the host's rules
      arena: (online ? config.arena : null) || this.settings.arena || 'stadium',
      loadout: this.settings.loadout,
      // training packs always run on standard rules; matches honour the mutators
      mutators: config.mode === 'drill' ? {} : config.mutators || this.settings.mutators,
    };
    this.clearGaragePreview();
    this.renderer.setArenaTheme(this.config.arena);
    this.game = new Game(this.config);
    if (online && this.net) this.net.attach(this.game);
    this.coach = new Coach(this.game);
    this.chat = new QuickChat(this.game, this.hud);
    this.chat.enabled = this.settings.quickChat !== false;
    this.view.followCar = this.game.human;
    this.view.mode = 'play';
    this.view.snap = true;
    this.input.ballCam = true;
    this.input.enabled = true;
    this.bindGameEvents();
    this.hud.clearFeeds();
    this.hud.setVisible(true);
    this.ui({ type: 'hide' });
    if (config.mode === 'freeplay') this.hud.addFeed('Free play — <b>T</b> resets the ball', 5);
    if (config.mode === 'drill') {
      this.hud.addFeed(`${this.game.drill.meta.name}: ${this.game.drill.meta.tip}`, 8);
      // aerials want the landing marker visible from the start
      if (this.game.drill.id === 'aerials') {
        this.renderer.showPrediction = true;
        this.settings.showPrediction = true;
      }
    }
    if (config.mode === 'match') {
      const rumble = this.game.rumble ? ' · <b>RUMBLE</b> — <b>X</b> uses your item' : '';
      if (online) {
        const role = this.config.net.role === 'host' ? 'hosting' : 'joined';
        const bots = this.game.bots.length ? ` + ${this.game.bots.length} bot${this.game.bots.length > 1 ? 's' : ''}` : '';
        this.hud.addFeed(`Online ${config.teamSize}v${config.teamSize} — ${role} vs <b>${escapeName(config.peerName || 'your friend')}</b>${bots} · <b>1–4</b> quick chat${rumble}`, 6);
      } else {
        this.hud.addFeed(`${config.teamSize}v${config.teamSize} vs ${this.game.bots[0]?.skill.name || 'bots'} · <b>1–4</b> quick chat${rumble}`, 5);
      }
      const mods = this.game.mutatorSummary;
      if (mods.length) this.hud.addFeed(`Mutators: ${mods.join(' · ')}`, 6);
    }
    this.running = true;
    this.lastTime = performance.now();
  }

  bindGameEvents() {
    const g = this.game;
    g.on('goal', (e) => {
      const team = TEAM_NAMES[e.team];
      // an online peer controls their own display name, and these lines are
      // rendered as HTML — escape anything that came from the wire
      const who = e.scorer ? escapeHtml(e.ownGoal ? `${e.scorer.name} (own goal)` : e.scorer.name, 24) : team;
      this.hud.showMessage(`GOAL!<small>${who} · ${Math.round(e.speed * 0.036)} km/h</small>`, e.team === 0 ? 'blue' : 'orange', 3);
      this.hud.addFeed(`<b>${who}</b> scored for ${team}`, 5);
      const scored = g.human ? e.team === g.human.team : true;
      this.audio.goal(scored);
      this.renderer.goalExplosion(g.ball.pos, TEAM_COLORS[e.team], (e.scorer && e.scorer.spec.explosion.id) || 'default');
      this.view.mode = 'goalReplay';
    });
    g.on('replayStart', () => {
      this.hud.setReplay(true);
    });
    g.on('kickoff', () => {
      this.view.mode = 'play';
      this.view.snap = true;
      this.countdownLast = 4;
      this.hud.setReplay(false);
    });
    g.on('go', () => this.audio.countdown(0));
    g.on('touch', (e) => {
      this.audio.ballHit(e.speed, e.car === g.human);
      this.renderer.ballTouch(e.speed);
      if (e.car === g.human && e.speed > 1200) this.renderer.kick(Math.min(16, e.speed / 180));
      if (e.speed > 1800) this.renderer.burst(g.ball.pos, 0xffffff, Math.min(20, e.speed / 150), 500, 0.35, 18);
    });
    g.on('ballBounce', (e) => this.audio.ballBounce(e.speed));
    g.on('pad', (e) => {
      if (e.car === g.human) this.audio.pad(e.big);
    });
    g.on('demo', (e) => {
      this.audio.demo();
      this.renderer.burst(e.victim.pos.clone().add({ x: 0, y: 40, z: 0 }), 0xff5533, 60, 1200);
      this.hud.addFeed(`<b>${escapeHtml(e.demolisher.name, 20)}</b> demolished ${escapeHtml(e.victim.name, 20)}`);
      if (e.victim === g.human) this.renderer.kick(40);
    });
    g.on('save', (e) => {
      this.hud.addFeed(`<b>${escapeHtml(e.car.name, 20)}</b> ${e.epic ? 'epic save!' : 'save!'}`, 3);
      if (e.car === g.human) this.audio.success();
    });
    g.on('stat', (e) => {
      if (g.config.mode !== 'match') return;
      const mine = e.car === g.human;
      const teammate = g.human && e.car.team === g.human.team;
      if (mine || (teammate && e.points >= 50)) this.hud.addStat(mine ? e.label : `${e.car.name.toUpperCase()} · ${e.label}`, e.points, mine);
      if (mine && e.points >= 20 && e.kind !== 'goal') this.audio.ui();
    });
    g.on('rumbleUse', (e) => {
      const info = ITEMS[e.id] || { name: e.id, icon: '❔' };
      const color = e.car === g.human ? 0xffffff : TEAM_COLORS[e.car.team];
      this.renderer.spawnRing(e.pos, color, 260, 0.5);
      this.renderer.burst(e.pos, color, 30, 700, 0.5, 16);
      if (e.car === g.human) {
        this.audio.ui();
        this.hud.addFeed(`${info.icon} <b>${info.name}</b>`, 2.5);
      }
      if (e.id === 'tornado') this.renderer.kick(26);
      if (e.id === 'swapper') this.renderer.kick(14);
    });
    g.on('rumbleHit', (e) => {
      this.renderer.burst(e.pos, 0xffffff, 90, 2600, 1.0, 40);
      this.renderer.spawnRing(e.pos, 0xffe08a, 900, 0.7);
      this.renderer.kick(34);
      this.audio.ballHit(3000, e.car === g.human);
    });
    g.on('rumbleEnd', (e) => {
      if (e.car === g.human) this.renderer.spawnRing(e.car.pos, 0x9fd8ff, 120, 0.3);
    });
    g.on('overtime', () => {
      this.hud.showMessage('OVERTIME<small>NEXT GOAL WINS</small>', '', 3);
      this.audio.whistle();
    });
    g.on('coach', (e) => {
      if (this.settings.coach) this.hud.showCoach(e.text, 7);
    });
    g.on('drillResult', (e) => {
      if (e.ok) this.audio.success();
      else this.audio.fail();
      this.hud.showMessage(e.ok ? 'NICE' : 'MISS', e.ok ? 'blue' : 'orange', 1);
      if (e.feedback) this.hud.addFeed(e.feedback, 4);
    });
    g.on('levelUp', (e) => {
      this.hud.showMessage(`LEVEL ${e.level}<small>DIFFICULTY UP</small>`, 'blue', 2.5);
      this.audio.goal(true);
    });
    g.on('netChat', (e) => {
      this.hud.addChat(e.name, e.team, e.text);
      if (!e.mine) this.audio.ui();
    });
    g.on('ended', (e) => {
      this.running = false;
      this.input.enabled = false;
      const report = this.coach.report(e.stats);
      this.recordMatch(e.stats);
      const cfg = this.config;
      // local progression: XP, level and season rank
      let xp = null;
      try {
        xp = awardMatch(e.stats, cfg);
        if (xp.rankUp) this.hud.showMessage(`RANK UP<small>${xp.after.rank.label}</small>`, 'blue', 3);
      } catch (err) {
        xp = null;
      }
      setTimeout(() => this.ui({ type: 'results', stats: e.stats, report, config: cfg, xp }), 1200);
      this.hud.showMessage(e.score[0] === e.score[1] ? 'DRAW' : `${TEAM_NAMES[e.score[0] > e.score[1] ? 0 : 1]} WINS`, e.score[0] > e.score[1] ? 'blue' : 'orange', 3);
      this.audio.whistle();
    });
  }

  playCarSounds(g) {
    for (const c of g.cars) {
      const ev = c.events;
      if (!ev) continue;
      const isHuman = c === g.human;
      const dist = isHuman ? 0 : c.pos.distanceTo(g.human ? g.human.pos : c.pos);
      const gain = isHuman ? 1 : Math.max(0, 1 - dist / 4000) * 0.6;
      if (gain <= 0.02) continue;
      if (ev.jumped) this.audio.jump(gain);
      if (ev.doubleJumped) this.audio.jump(gain * 0.8);
      if (ev.dodged) this.audio.flip(gain);
      if (ev.landed > 150) this.audio.land(ev.landed, gain);
      if (ev.wallHit > 300) this.audio.wallHit(ev.wallHit, gain);
      if (ev.flipReset && isHuman) this.audio.ui();
    }
  }

  recordMatch(stats) {
    const h = stats.cars.find((c) => c.isHuman);
    if (!h || this.config.mode !== 'match') return;
    const list = JSON.parse(localStorage.getItem('rocketgoal.matches') || '[]');
    list.push({
      date: Date.now(),
      teamSize: this.config.teamSize,
      difficulty: this.config.online ? 'online' : this.config.difficulty,
      online: !!this.config.online,
      peer: this.config.peerName || '',
      score: `${stats.score[h.team]}–${stats.score[1 - h.team]}`,
      won: stats.score[h.team] > stats.score[1 - h.team],
      draw: stats.score[0] === stats.score[1],
      goals: h.goals,
      saves: h.saves,
      shots: h.shots,
      avgBoost: h.avgBoost,
      goalSide: stats.humanBehindBallPct,
    });
    while (list.length > 50) list.shift();
    localStorage.setItem('rocketgoal.matches', JSON.stringify(list));
  }

  /** Concede the match: RL-style forfeit ends the game immediately with the results screen. */
  forfeit() {
    const g = this.game;
    if (!g || g.state === 'ended') return this.quitToMenu();
    if (g.net) return this.netLeave();
    if (g.human && g.score[g.human.team] >= g.score[1 - g.human.team]) g.score[1 - g.human.team] = g.score[g.human.team] + 1;
    g.forfeited = true;
    this.ui({ type: 'hide' });
    g.paused = false;
    g.endMatch();
  }

  togglePause() {
    if (!this.game || this.game.state === 'ended') return;
    if (this.uiOpen) this.resume();
    else this.pause();
  }
  pause() {
    if (!this.game) return;
    if (this.game.net) {
      // Online: the match cannot be paused — your friend is still playing.
      // Only your input is taken away, exactly like a menu overlay in RL.
      this.input.enabled = false;
      this.ui({ type: 'pause', online: true });
      return;
    }
    this.game.paused = true;
    this.input.enabled = false;
    this.ui({ type: 'pause' });
  }
  resume() {
    if (!this.game) return;
    this.ui({ type: 'hide' });
    this.game.paused = false;
    this.input.enabled = true;
    this.lastTime = performance.now();
  }
  /** Online: "restart" makes no sense — the host owns the match. Go to the lobby. */
  restart() {
    if (this.config && this.config.net && this.config.net.online) return this.netToLobby();
    this.startGame(this.config);
  }
  quitToMenu() {
    this.netClose();
    if (this.game && this.game.drill && this.game.drill.attempts > 0) {
      const drill = this.game.drill;
      const cfg = this.config;
      this.game = null;
      this.running = false;
      this.hud.setVisible(false);
      this.ui({ type: 'drillSummary', drill, config: cfg });
      return;
    }
    this.game = null;
    this.running = false;
    this.hud.setVisible(false);
    this.ui({ type: 'menu' });
  }

  // ===========================================================================
  // Online (peer-to-peer). No servers: the two browsers are wired together with
  // a hand-exchanged code (see net/sdp.js) over plain WebRTC + public STUN.
  // ===========================================================================
  /** Create a fresh session. `role` is 'host' or 'guest'. */
  netCreate(role) {
    this.netClose();
    const conn = new P2PConnection({ role });
    const session = new NetSession({
      role,
      connection: conn,
      name: this.settings.playerName || 'You',
      loadout: this.settings.loadout,
      onStart: (config) => {
        // both peers land here: the host right after "Start match", the guest
        // when the host's config arrives
        this.startGame(config);
      },
      onLobby: () => {
        this.audio.ui();
        if (this.uiOpen) this.onUi && this.onUi({ type: 'multiplayer', step: 'lobby' });
      },
      onNotify: (n) => this.hud.addFeed(n.text, 3),
      onFail: (info) => this.netFailed(info),
    });
    this.net = session;
    return session;
  }

  /** Host step 1: build the invite code. */
  netInvite() {
    return this.net ? this.net.conn.createInvite() : Promise.resolve(null);
  }

  /** Guest step 1: read the host's invite, produce the reply code. */
  netAcceptInvite(code) {
    return this.net ? this.net.conn.acceptInvite(code) : Promise.resolve({ error: 'No session.' });
  }

  /** Host step 2: read the guest's reply and finish the handshake. */
  netAcceptReply(code) {
    return this.net ? this.net.conn.acceptReply(code) : Promise.resolve({ error: 'No session.' });
  }

  /** Host: send the rules over and kick off the match on both peers. */
  netStart(opts) {
    if (!this.net) return null;
    this.net.me.name = this.settings.playerName || 'You';
    this.net.me.loadout = this.settings.loadout;
    return this.net.startMatch(opts);
  }

  /** Connection lost / refused. The message shown here is verbatim. */
  netFailed(info) {
    const message = info && info.message ? info.message : P2P_FAIL_MESSAGE;
    if (this.game) {
      this.game.paused = true;
      this.running = false;
      this.input.enabled = false;
    }
    this.audio.fail ? this.audio.fail() : this.audio.ui();
    this.ui({ type: 'netError', message, code: info && info.code, wasPlaying: !!(info && info.wasPlaying), verbatim: P2P_FAIL_MESSAGE });
  }

  /** Leave the match but keep the link, so you can immediately rematch. */
  netToLobby() {
    const s = this.net;
    this.game = null;
    this.running = false;
    this.hud.setVisible(false);
    if (s) {
      s.returnToLobby();
      this.ui({ type: 'multiplayer', step: 'lobby' });
      return;
    }
    this.ui({ type: 'menu' });
  }

  /** Hang up: close the peer connection and go back to the main menu. */
  netLeave() {
    this.netClose();
    this.game = null;
    this.running = false;
    this.hud.setVisible(false);
    this.ui({ type: 'menu' });
  }

  netClose() {
    if (!this.net) return;
    const s = this.net;
    this.net = null;
    try {
      s.destroy();
    } catch (e) {
      /* the connection is already gone */
    }
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;
    const g = this.game;
    if (g) {
      const controls = this.input.update();
      if (g.human && !g.paused) {
        const pressedItem = !!controls.useItem && !this.prevUseItem;
        this.prevUseItem = !!controls.useItem;
        Object.assign(g.human.controls, controls);
        if (pressedItem && g.rumble) {
          const id = g.useItem(g.human);
          if (!id && g.human.item && g.human.item.cooldown > 0) this.audio.ui();
        }
      } else {
        this.prevUseItem = false;
      }
      if (!g.paused) {
        g.update(dt);
        if (this.coach && g.state === 'play' && this.settings.coach && g.config.mode === 'match') this.coach.update(dt);
      }
      // countdown sounds
      if (g.state === 'countdown') {
        const n = Math.ceil(g.stateTimer);
        if (n !== this.countdownLast && n > 0) {
          this.countdownLast = n;
          this.audio.countdown(n);
        }
      }
      this.hud.setBoard(this.input.scoreboard && g.config.mode === 'match', g);
      this.view.ballCam = this.input.ballCam;
      this.view.rearView = this.input.rearView;
      this.view.followCar = g.human;
      if (g.state === 'goal') this.view.mode = 'goalReplay';
      else if (this.view.mode === 'goalReplay') {
        this.view.mode = 'play';
        this.view.snap = true;
      }
      this.renderer.update(g, dt, this.view);
      this.view.snap = false;
      this.view.ballScreen = this.renderer.ballScreen;
      this.hud.update(g, dt, this.input, this.view);
      this.audio.updateEngine(g.human, dt);
      this.playCarSounds(g);
    } else {
      // idle: slowly orbit an empty arena behind the menu
      this.renderer.update(idleGame, dt, { followCar: null, mode: 'goalReplay', ballCam: true });
      this.audio.updateEngine(null, dt);
    }
  }
}

/** Player names travel over the wire and end up in the HTML feed: never trust them. */
/** Escape a name that came off the network (see hudStore.escapeHtml). */
export function escapeName(name) {
  return escapeHtml(name, 16);
}

// A minimal stand-in game object so the renderer can draw the arena behind the menu
const idleGame = {
  ball: new Ball(),
  cars: [],
  pads: BOOST_PADS.map((p) => ({ ...p, active: true })),
  prediction: [],
  drill: null,
};
idleGame.ball.pos.set(0, 92.75, 0);
