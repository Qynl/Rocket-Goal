import { Game } from './game.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Coach } from './coach.js';
import { QuickChat } from './chat.js';
import { TEAM_COLORS, TEAM_NAMES, BOOST_PADS } from './constants.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { Ball } from './physics/ball.js';

/**
 * Game engine controller. Owns the simulation, renderer, input and audio and
 * exposes an imperative API that the React shell (App.jsx) drives. UI screens
 * are requested through the `onUi` callback.
 */
export class Engine {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.renderer = new Renderer(canvas);
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

    this.renderer.setCameraSettings(this.settings.camera);
    this.renderer.setQuality(this.settings.quality || 'high');
    this.renderer.showPrediction = this.settings.showPrediction;
    this.audio.setVolume(this.settings.volume);

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
    this.renderer.showPrediction = s.showPrediction;
    this.audio.setVolume(s.volume);
    if (this.chat) this.chat.enabled = s.quickChat !== false;
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
    this.config = { ...config, playerName: this.settings.playerName };
    this.game = new Game(this.config);
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
    if (config.mode === 'match') this.hud.addFeed(`${config.teamSize}v${config.teamSize} vs ${this.game.bots[0]?.skill.name || 'bots'} · <b>1–4</b> quick chat`, 4);
    this.running = true;
    this.lastTime = performance.now();
  }

  bindGameEvents() {
    const g = this.game;
    g.on('goal', (e) => {
      const team = TEAM_NAMES[e.team];
      const who = e.scorer ? (e.ownGoal ? `${e.scorer.name} (own goal)` : e.scorer.name) : team;
      this.hud.showMessage(`GOAL!<small>${who} · ${Math.round(e.speed * 0.036)} km/h</small>`, e.team === 0 ? 'blue' : 'orange', 3);
      this.hud.addFeed(`<b>${who}</b> scored for ${team}`, 5);
      const scored = g.human ? e.team === g.human.team : true;
      this.audio.goal(scored);
      this.renderer.goalExplosion(g.ball.pos, TEAM_COLORS[e.team]);
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
      this.hud.addFeed(`<b>${e.demolisher.name}</b> demolished ${e.victim.name}`);
      if (e.victim === g.human) this.renderer.kick(40);
    });
    g.on('save', (e) => {
      this.hud.addFeed(`<b>${e.car.name}</b> ${e.epic ? 'epic save!' : 'save!'}`, 3);
      if (e.car === g.human) this.audio.success();
    });
    g.on('stat', (e) => {
      if (g.config.mode !== 'match') return;
      const mine = e.car === g.human;
      const teammate = g.human && e.car.team === g.human.team;
      if (mine || (teammate && e.points >= 50)) this.hud.addStat(mine ? e.label : `${e.car.name.toUpperCase()} · ${e.label}`, e.points, mine);
      if (mine && e.points >= 20 && e.kind !== 'goal') this.audio.ui();
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
    g.on('ended', (e) => {
      this.running = false;
      this.input.enabled = false;
      const report = this.coach.report(e.stats);
      this.recordMatch(e.stats);
      const cfg = this.config;
      setTimeout(() => this.ui({ type: 'results', stats: e.stats, report, config: cfg }), 1200);
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
      difficulty: this.config.difficulty,
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
  restart() {
    this.startGame(this.config);
  }
  quitToMenu() {
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

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;
    const g = this.game;
    if (g) {
      const controls = this.input.update();
      if (g.human && !g.paused) {
        Object.assign(g.human.controls, controls);
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

// A minimal stand-in game object so the renderer can draw the arena behind the menu
const idleGame = {
  ball: new Ball(),
  cars: [],
  pads: BOOST_PADS.map((p) => ({ ...p, active: true })),
  prediction: [],
  drill: null,
};
idleGame.ball.pos.set(0, 92.75, 0);
