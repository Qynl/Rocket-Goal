import { Game } from './game.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { Audio } from './audio.js';
import { Coach } from './coach.js';
import { QuickChat } from './chat.js';
import { TEAM_COLORS, TEAM_NAMES } from './constants.js';

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.uiRoot = document.getElementById('ui');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.hud = new HUD(this.uiRoot);
    this.menus = new Menus(this.uiRoot, this);
    this.game = null;
    this.coach = null;
    this.config = null;
    this.view = { ballCam: true, rearView: false, followCar: null, mode: 'play', snap: false };
    this.lastTime = performance.now();
    this.running = false;
    this.replayTimer = 0;

    this.renderer.setCameraSettings(this.menus.settings.camera);
    this.renderer.setQuality(this.menus.settings.quality || 'high');
    this.renderer.showPrediction = this.menus.settings.showPrediction;
    this.audio.setVolume(this.menus.settings.volume);

    this.input.onAction = (a) => {
      if (a === 'ballCam') this.audio.ui();
      if (a === 'pause') this.togglePause();
    };
    this.input.onKey = (code) => this.onKey(code);
    window.addEventListener('pointerdown', () => this.audio.resume(), { once: false });
    window.addEventListener('keydown', () => this.audio.resume());

    this.hud.setVisible(false);
    this.menus.main();
    requestAnimationFrame((t) => this.loop(t));
  }

  onKey(code) {
    if (code === 'Escape') {
      if (this.game) this.togglePause();
      return;
    }
    if (!this.game || this.menus.visible) return;
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
    this.config = { ...config, playerName: this.menus.settings.playerName };
    this.game = new Game(this.config);
    this.coach = new Coach(this.game);
    this.chat = new QuickChat(this.game, this.hud);
    this.chat.enabled = this.menus.settings.quickChat !== false;
    this.view.followCar = this.game.human;
    this.view.mode = 'play';
    this.view.snap = true;
    this.input.ballCam = true;
    this.input.enabled = true;
    this.bindGameEvents();
    this.menus.hide();
    this.hud.setVisible(true);
    this.hud.feed.innerHTML = '';
    this.hud.feedItems = [];
    this.hud.chat.innerHTML = '';
    this.hud.chatItems = [];
    this.hud.stats.innerHTML = '';
    this.hud.statItems = [];
    if (config.mode === 'freeplay') this.hud.addFeed('Free play — <b>T</b> resets the ball', 5);
    if (config.mode === 'drill') this.hud.addFeed(`${this.game.drill.meta.name}: ${this.game.drill.meta.tip}`, 8);
    if (config.mode === 'match') this.hud.addFeed(`${config.teamSize}v${config.teamSize} vs ${this.game.bots[0]?.skill.name || 'bots'} · <b>1–4</b> quick chat`, 4);
    this.running = true;
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
      // show my own events always; teammates' big events too (as RL does)
      if (mine || (teammate && e.points >= 50)) this.hud.addStat(mine ? e.label : `${e.car.name.toUpperCase()} · ${e.label}`, e.points, mine);
      if (mine && e.points >= 20 && e.kind !== 'goal') this.audio.ui();
    });
    g.on('overtime', () => {
      this.hud.showMessage('OVERTIME<small>NEXT GOAL WINS</small>', '', 3);
      this.audio.whistle();
    });
    g.on('coach', (e) => {
      if (this.menus.settings.coach) this.hud.showCoach(e.text, 7);
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
      setTimeout(() => this.menus.results(e.stats, report, this.config), 1200);
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
    this.menus.hide();
    g.paused = false;
    g.endMatch();
  }

  togglePause() {
    if (!this.game || this.game.state === 'ended') return;
    if (this.menus.visible) this.resume();
    else this.pause();
  }
  pause() {
    if (!this.game) return;
    this.game.paused = true;
    this.input.enabled = false;
    this.menus.pause();
  }
  resume() {
    if (!this.game) return;
    this.menus.hide();
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
      this.menus.drillSummary(drill, cfg);
      return;
    }
    this.game = null;
    this.running = false;
    this.hud.setVisible(false);
    this.menus.main();
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
        if (this.coach && g.state === 'play' && this.menus.settings.coach && g.config.mode === 'match') this.coach.update(dt);
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
import { Ball } from './physics/ball.js';
import { BOOST_PADS } from './constants.js';
const idleGame = {
  ball: new Ball(),
  cars: [],
  pads: BOOST_PADS.map((p) => ({ ...p, active: true })),
  prediction: [],
  drill: null,
};
idleGame.ball.pos.set(0, 92.75, 0);

window.app = new App();
