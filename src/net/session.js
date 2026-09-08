// ---------------------------------------------------------------------------
// NetSession — the online match, on top of a P2PConnection.
//
// Model: **host authoritative**, plus the three things that make a
// peer-to-peer car game feel local instead of laggy:
//
//   * the guest predicts its own car (zero input latency) and reconciles
//     against the host's snapshots — gliding back for small errors, snapping
//     only when the disagreement is real (a demo, a respawn, a lost burst);
//   * the guest free-runs the ball with the real ball physics and blends it
//     toward each authoritative snapshot, so the ball is never choppy;
//   * remote cars are interpolated with an adaptive delay derived from the
//     measured jitter, so packet timing never shows up as stutter.
//
// Inputs are sent **per physics step** (batched into one packet at 60 Hz) and
// quantised, so the predicting guest and the authoritative host step the car
// with byte-identical numbers. Every snapshot acks the last consumed input
// sequence, which is what makes the reconciliation exact.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { NET, MSG, packInputs, readInputs, packSnapshot, readSnapshot, writeCarState, quantizeControls, ITEM_ORDER } from './protocol.js';
import { P2P_FAIL_MESSAGE } from './connection.js';
import { PHYSICS_DT, BOOST_PAD, TEAM } from '../constants.js';
import { Ball } from '../physics/ball.js';
import { collideCarBall } from '../physics/collision.js';
import { QUICK_CHATS } from '../chat.js';

/**
 * Input-consumer tuning (host side).
 * GAP_TOLERANCE is how many physics steps we wait for a record that has not
 * arrived yet — data channels are unordered, so a slightly late packet is
 * normal and worth waiting ~17 ms for. Past that it counts as lost and we move
 * on rather than stalling the other player's car. BACKLOG is the queue depth at
 * which we stop being polite and fast-forward to the newest input, so a host
 * that briefly ran slow can never accumulate unbounded input latency.
 */
/** How long we trust our own predicted ball hit over a stale snapshot. Long
 * enough to cover a round trip on a bad link, short enough that a genuinely
 * wrong prediction is still corrected quickly. */
const TOUCH_GUARD = 0.3;

const INPUT_GAP_TOLERANCE = 2;
const INPUT_BACKLOG = 24;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Events the host mirrors to the guest (indices on the wire, never objects). */
const FORWARDED = {
  goal: (g, e) => ({ team: e.team, car: idxOf(g, e.scorer), ownGoal: !!e.ownGoal, speed: e.speed }),
  kickoff: () => ({}),
  go: () => ({}),
  overtime: () => ({}),
  touch: (g, e) => ({ car: idxOf(g, e.car), speed: e.speed }),
  ballBounce: (g, e) => ({ speed: e.speed }),
  pad: (g, e) => ({ car: idxOf(g, e.car), big: e.big }),
  demo: (g, e) => ({ by: idxOf(g, e.demolisher), victim: idxOf(g, e.victim) }),
  save: (g, e) => ({ car: idxOf(g, e.car), epic: !!e.epic }),
  stat: (g, e) => ({ car: idxOf(g, e.car), kind: e.kind, points: e.points, label: e.label }),
  shot: (g, e) => ({ car: idxOf(g, e.car) }),
  rumbleUse: (g, e) => ({ car: idxOf(g, e.car), id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z }),
  rumbleHit: (g, e) => ({ x: e.pos.x, y: e.pos.y, z: e.pos.z }),
  rumbleEnd: (g, e) => ({ car: idxOf(g, e.car) }),
};

function idxOf(game, car) {
  void game;
  return car && car.netIdx !== undefined ? car.netIdx : -1;
}

/** Which stat counter a forwarded 'stat' event implies, so the guest's
 *  scoreboard matches the host without shipping every stats object. */
/**
 * Which counters a forwarded `stat` event owns on the guest. The host bumps
 * these itself right before awarding the stat, so the guest has to bump exactly
 * the same ones — no more (the demo counters live in the `demo` event, which
 * also carries the victim) and no less (an epic save is *also* a save).
 */
const STAT_FIELD = {
  goal: ['goals'],
  shot: ['shots'],
  assist: ['assists'],
  save: ['saves'],
  epicSave: ['saves', 'epicSaves'],
  clear: ['clears'],
};

export class NetSession {
  constructor(opts = {}) {
    this.role = opts.role === 'guest' ? 'guest' : 'host';
    this.conn = opts.connection || null;
    this.onStart = opts.onStart || (() => {});
    this.onLobby = opts.onLobby || (() => {});
    this.onNotify = opts.onNotify || (() => {});
    this.onFail = opts.onFail || (() => {});
    this.me = { name: opts.name || 'You', loadout: opts.loadout || null };
    this.peer = null;
    this.phase = 'idle'; // idle | waiting | lobby | playing | ended | lost | closed
    this.reason = '';
    this.detail = '';
    this.game = null;
    this.config = null;
    this.version = NET.VERSION;

    // ---- clocks / link quality
    this.t0 = perfNow();
    this.localTime = 0;
    this.timeOffset = 0; // local time when the host's sim clock read 0
    this.offsetSamples = [];
    this.rtt = 0;
    this.rttMin = Infinity;
    this.jitter = 0;
    this.quality = 1; // 1 = perfect, 0 = unusable (HUD)
    this.packetsIn = 0;
    this.packetsLost = 0;
    // reconciliation health (see reconcile()): these are what "does it feel
    // laggy?" reduces to, and they are shown in the pause screen diagnostics
    this.residual = 0;
    this.residualVel = 0;
    this.residualMax = 0;
    this.snaps = 0;
    this.glides = 0;
    this.lastSnap = null;
    this.lastRecv = this.now();
    this.lastSnapshotRecv = -10;
    this.lastPingSent = 0;
    this.pingSeq = 0;
    this.pings = new Map();
    this.snapshots = 0;

    // ---- wire buffers
    this.inbox = [];
    this.jsonInbox = [];
    this.sendBuf = [];
    this.inputSeq = 0;
    this.pending = []; // guest: {seq, c} waiting for an ack
    this.remote = null; // host: the one remote human's input stream
    this.buffer = []; // guest: snapshot history for interpolation
    this.interpDelay = NET.INTERP_BASE;
    this.starved = 0;
    this.correction = null;
    this.ballCorrection = null;
    this.ballSim = null;
    this.snapOut = null;
    this.snapIn = null;
    this.savedState = null;
    this.savedStats = null;
    this.savedEvents = null;
    this.recPos = new THREE.Vector3();
    this.recVel = new THREE.Vector3();
    this.helloSent = false;
    this.matchStarted = false;
    this.disconnectNotified = false;
    this.replayDelay = undefined;
    this.lastPredictedTouch = -10;
    this.touchCool = 0;
    this.ballPrev = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this._boundGame = null;
    this.watchdog = null;

    if (this.conn) {
      this.conn.onBinary = (data) => this.onBinary(data);
      this.conn.onJson = (msg) => this.onJsonMessage(msg);
      this.conn.onState = (s) => this.onConnState(s);
    }
  }

  // ------------------------------------------------------------------ clocks
  now() {
    return (perfNow() - this.t0) / 1000;
  }

  /** The host's simulation clock, as seen from here. */
  hostTime() {
    return this.localTime - this.timeOffset;
  }

  // ------------------------------------------------------------------ lifecycle
  handshake() {
    if (this.helloSent) return;
    this.helloSent = true;
    this.phase = 'waiting';
    this.send({ t: 'hello', v: this.version, name: this.me.name, loadout: this.me.loadout });
  }

  close(reason = 'left') {
    if (this.phase === 'closed') return;
    const wasLost = this.phase === 'lost';
    this.phase = 'closed';
    this.reason = reason;
    if (!wasLost) this.send({ t: 'bye', reason });
    this.stopWatchdog();
    if (this.conn) this.conn.close(reason);
  }

  destroy() {
    this.detach();
    this.close('destroyed');
    if (this.conn) this.conn.close('destroyed');
  }

  onConnState(s) {
    if (s.state === 'connected') {
      this.lastRecv = this.now();
      if (!this.helloSent) this.handshake();
      if (this.game) this.game.netStalled = false;
    } else if (s.state === 'connecting') {
      if (this.game) this.game.netStalled = true;
    } else if (s.state === 'failed') {
      this.lose(s.code || 'failed', s.message || P2P_FAIL_MESSAGE);
    } else if (s.state === 'closed' && this.phase !== 'closed') {
      this.lose('closed', 'The connection was closed.');
    }
  }

  /** The link is gone. `message` is what the UI shows. */
  lose(code, message) {
    if (this.phase === 'lost' || this.phase === 'closed') return;
    const wasPlaying = this.phase === 'playing';
    this.phase = 'lost';
    this.reason = code || 'lost';
    this.detail = message || P2P_FAIL_MESSAGE;
    this.stopWatchdog();
    if (this.game) this.game.netLost = true;
    this.onFail({ code: this.reason, message: this.detail, wasPlaying, verbatim: P2P_FAIL_MESSAGE });
  }

  notify(text) {
    this.onNotify({ text });
  }

  // ------------------------------------------------------------------ transport
  send(obj) {
    if (!this.conn) return false;
    return this.conn.sendJson(obj);
  }

  onJsonMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.lastRecv = this.now();
    switch (msg.t) {
      case 'hello':
        this.onHello(msg);
        break;
      case 'start':
        this.onStartRequested(msg);
        break;
      case 'event':
      case 'chat':
        this.jsonInbox.push(msg);
        break;
      case 'ping':
        if (this.conn) this.conn.send(pingFrame(MSG.PONG, msg.id, msg.t0));
        break;
      case 'bye':
        this.lose('peer-left', msg.reason === 'left' ? 'Your friend left the match.' : 'Your friend closed the game.');
        break;
      case 'version':
        this.lose('version', `Version mismatch (they are on protocol ${msg.v}, you are on ${this.version}). Both browsers need the same build.`);
        break;
      default:
        break;
    }
  }

  onHello(msg) {
    if (msg.v !== this.version) {
      this.send({ t: 'version', v: this.version });
      this.lose('version', `Version mismatch — your friend is on protocol ${msg.v}, you are on ${this.version}. Both browsers need the same build.`);
      return;
    }
    this.peer = { name: String(msg.name || 'Friend').slice(0, 16), loadout: msg.loadout || null };
    if (this.phase === 'idle' || this.phase === 'waiting') {
      this.phase = 'lobby';
      this.onLobby({ peer: this.peer, role: this.role });
    }
  }

  onBinary(data) {
    if (!data || data.length < 1) return;
    this.lastRecv = this.now();
    const kind = data[0];
    if (kind === MSG.PONG) {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const id = v.getUint32(1, true);
      const sent = this.pings.get(id);
      if (sent !== undefined) {
        this.pings.delete(id);
        const rtt = this.now() - sent;
        this.rttMin = Math.min(this.rttMin, rtt);
        const prev = this.rtt;
        this.rtt = prev ? prev * 0.7 + rtt * 0.3 : rtt;
        this.jitter = this.jitter * 0.8 + Math.abs(rtt - (prev || rtt)) * 0.2;
        this.updateQuality();
      }
      return;
    }
    if (kind === MSG.PING) {
      // the peer is measuring us: answer immediately with their id
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const id = v.getUint32(1, true);
      if (this.conn && this.conn.open) this.conn.send(pingFrame(MSG.PONG, id, 0));
      return;
    }
    this.packetsIn++;
    if (kind === MSG.INPUT || kind === MSG.SNAPSHOT) this.inbox.push(data.slice());
  }

  updateQuality() {
    let q = 1;
    if (this.rtt > 0.05) q -= Math.min(0.4, (this.rtt - 0.05) * 2.2);
    if (this.jitter > 0.03) q -= Math.min(0.3, (this.jitter - 0.03) * 3);
    const total = this.packetsIn + this.packetsLost;
    const loss = total > 40 ? this.packetsLost / total : 0;
    if (loss > 0.02) q -= Math.min(0.3, loss * 2);
    this.quality = Math.max(0, Math.min(1, q));
  }

  // ------------------------------------------------------------------ lobby
  /** Host: pick the rules, build the roster and pull the guest into the match. */
  startMatch(opts) {
    if (this.role !== 'host' || this.phase !== 'lobby') return null;
    const roster = buildRoster(opts, this.me, this.peer);
    const hostSeat = roster.findIndex((s) => s.peer === 'host');
    const guestSeat = roster.findIndex((s) => s.peer === 'guest');
    const base = {
      mode: 'match',
      teamSize: opts.teamSize || 1,
      difficulty: opts.difficulty || 'allstar',
      duration: opts.duration,
      arena: opts.arena || 'stadium',
      mutators: opts.mutators || {},
      replays: opts.replays !== false,
      roster,
      online: true,
      peerName: this.peer ? this.peer.name : 'Friend',
    };
    this.config = { ...base, net: { online: true, role: 'host', seat: hostSeat, peerSeat: guestSeat } };
    this.send({ t: 'start', config: { ...base, net: { online: true, role: 'guest', seat: guestSeat, peerSeat: hostSeat } } });
    this.phase = 'playing';
    this.matchStarted = true;
    this.onStart(this.config);
    return this.config;
  }

  onStartRequested(msg) {
    if (this.role !== 'guest' || !msg.config || !msg.config.roster) return;
    this.config = msg.config;
    this.phase = 'playing';
    this.matchStarted = true;
    this.onStart(msg.config);
  }

  /** Quick chat: local lines go out, remote lines come back as `netChat`. */
  say(name, team, text) {
    this.sendChat(name, team, text);
    if (this.game) this.game.emit('netChat', { name, team, text, mine: true });
  }

  /** Send only — used for lines the local HUD already showed (bot chatter). */
  sendChat(name, team, text) {
    this.send({ t: 'chat', name, team, text });
  }

  quickChat(n) {
    const text = QUICK_CHATS[n];
    if (text && this.game && this.game.human) this.say(this.game.human.name, this.game.human.team, text);
  }

  /** Match over / left: keep the link, drop the match, go back to the lobby. */
  returnToLobby() {
    this.detach();
    this.config = null;
    this.matchStarted = false;
    this.buffer = [];
    this.pending = [];
    this.sendBuf = [];
    this.inbox = [];
    this.jsonInbox = [];
    this.replayDelay = undefined;
    this.correction = null;
    this.ballCorrection = null;
    if (this.phase === 'ended' || this.phase === 'playing') {
      this.phase = this.conn && this.conn.state === 'connected' ? 'lobby' : 'idle';
    }
  }

  // ------------------------------------------------------------------ attach
  attach(game) {
    this.detach();
    this.game = game;
    game.net = this;
    game.netRole = this.role;
    game.netLost = false;
    game.netStalled = false;
    this.t0 = perfNow();
    this.localTime = 0;
    this.buffer = [];
    this.pending = [];
    this.sendBuf = [];
    this.inbox = [];
    this.jsonInbox = [];
    this.inputSeq = 0;
    this.correction = null;
    this.ballCorrection = null;
    this.timeOffset = 0;
    this.offsetSamples = [];
    this.snapshots = 0;
    this.starved = 0;
    this.interpDelay = NET.INTERP_BASE;
    this.replayDelay = undefined;
    this.lastPredictedTouch = -10;
    // After we predict our own hit on the ball, the host has not seen it yet:
    // for about one round trip its snapshots describe a world where the hit has
    // not happened. Accepting authority from that world would yank the car and
    // the ball backwards on every single kick, so we hold our prediction until
    // the host has acked the input we were on when we made contact.
    this.touchGuard = 0;
    this.touchGuardSeq = 0;
    this.ballSim = new Ball(game.ball.config);
    this.savedState = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), quat: new THREE.Quaternion(), boost: 0, demolished: false, onGround: true };
    this.savedStats = {};
    this.savedEvents = {};
    this.snapOut = { cars: [], ball: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), quat: new THREE.Quaternion(), lastTouch: -1 }, pads: [] };
    this.snapIn = null;
    this.remote = null;
    if (this.role === 'host') {
      const remoteCar = game.cars.find((c) => c.isRemote);
      if (remoteCar) this.remote = { car: remoteCar, idx: remoteCar.netIdx, nextSeq: 1, last: null, dropped: 0, prevItem: false, ackSeq: 0, gapSteps: 0, queue: [] };
      this.bindHostEvents(game);
      this.snapAccum = 0;
    } else {
      this.myIdx = game.human ? game.human.netIdx : 0;
    }
    this.startWatchdog();
  }

  detach() {
    this.stopWatchdog();
    if (this.game) {
      this.game.net = null;
      this.game.netRole = null;
    }
    this.game = null;
    this.remote = null;
    this.buffer = [];
    this.pending = [];
    this.sendBuf = [];
    this.inbox = [];
    this.jsonInbox = [];
  }

  startWatchdog() {
    this.stopWatchdog();
    if (typeof setInterval === 'function') this.watchdog = setInterval(() => this.tick(), 250);
  }
  stopWatchdog() {
    if (this.watchdog && typeof clearInterval === 'function') clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** Host mirrors the interesting match events to the guest. */
  bindHostEvents(game) {
    if (this._boundGame === game) return;
    this._boundGame = game;
    for (const name of Object.keys(FORWARDED)) {
      const encode = FORWARDED[name];
      game.on(name, (e) => {
        if (this.phase !== 'playing') return;
        try {
          this.send({ t: 'event', name, data: encode(game, e || {}) });
        } catch (err) {
          /* a broken event must never kill the match */
        }
      });
    }
    game.on('ended', (e) => {
      if (this.phase !== 'playing') return;
      this.phase = 'ended';
      const mySeat = this.config && this.config.net ? this.config.net.peerSeat : 0;
      this.send({ t: 'event', name: 'ended', data: { stats: e.stats, mySeat } });
    });
  }

  /** Background tick: pings, watchdog, quality. Runs even before a match. */
  tick() {
    if (this.phase === 'closed' || this.phase === 'lost') return;
    const now = this.now();
    if (this.conn && (this.conn.state === 'connected' || this.conn.state === 'connecting') && now - this.lastPingSent > NET.PING_EVERY) {
      this.lastPingSent = now;
      const id = ++this.pingSeq;
      this.pings.set(id, now);
      for (const [k, t] of this.pings) {
        if (now - t > 2.5) {
          this.pings.delete(k);
          this.packetsLost++;
        }
      }
      this.updateQuality();
      if (this.conn.open) this.conn.send(pingFrame(MSG.PING, id, 0));
    }
    if (this.phase === 'playing' && now - this.lastRecv > NET.TIMEOUT) {
      this.lose('silent', `No data from your friend for ${Math.round(now - this.lastRecv)}s — ${P2P_FAIL_MESSAGE}`);
    }
  }

  /** Once per rendered frame: advance the local clock and drain the inbox. */
  frame(game, dt) {
    this.localTime += Math.min(dt, 0.1);
    this.pump();
    if (this.role === 'guest' && game) {
      for (let i = 0; i < game.pads.length; i++) {
        const p = game.pads[i];
        if (!p.active && p.timer > 0) p.timer = Math.max(0, p.timer - dt);
      }
    }
  }

  // =================================================================== inputs
  pump() {
    if (this.jsonInbox.length) for (const msg of this.jsonInbox.splice(0)) this.applyReliable(msg);
    if (!this.inbox.length) return;
    if (this.role === 'host') {
      const remote = this.remote;
      for (const data of this.inbox.splice(0)) {
        const recs = readInputs(data);
        if (!recs || !remote) continue;
        for (const rec of recs) {
          if (remote.queue.length > 90) remote.queue.splice(0, remote.queue.length - 90);
          const last = remote.queue[remote.queue.length - 1];
          if (!last || rec.seq > last.seq) remote.queue.push(rec);
        }
      }
      return;
    }
    for (const data of this.inbox.splice(0)) {
      this.snapIn = readSnapshot(data, this.snapIn);
      if (this.snapIn) this.onSnapshot(this.snapIn);
    }
  }

  /** Host, once per physics step before the cars move. */
  applyHostInputs(game) {
    const r = this.remote;
    if (!r) return;
    const car = r.car;
    if (car.demolished) {
      r.queue.length = 0;
      return;
    }
    let rec = null;
    // forget anything already applied (late duplicates after a skip)
    while (r.queue.length && r.queue[0].seq < r.nextSeq) r.queue.shift();
    if (r.queue.length && r.queue[0].seq === r.nextSeq) {
      rec = r.queue.shift();
      r.gapSteps = 0;
    } else if (r.queue.length) {
      // There is a gap: a record is either still in flight (data channels are
      // unordered) or gone for good. Give reordering a couple of steps, then
      // jump to what we have instead of freezing on the missing one.
      r.gapSteps++;
      if (r.queue.length > INPUT_BACKLOG || r.gapSteps > INPUT_GAP_TOLERANCE) {
        const skipped = r.queue[r.queue.length - 1].seq - r.nextSeq;
        if (r.queue.length > INPUT_BACKLOG) {
          // we are falling behind the sender: fast-forward to the newest input
          r.queue.splice(0, r.queue.length - 1);
        }
        r.dropped += skipped;
        this.packetsLost += skipped;
        r.nextSeq = r.queue[0].seq;
        rec = r.queue.shift();
        r.gapSteps = 0;
        this.updateQuality();
      }
    }
    if (rec) {
      r.last = rec.c;
      r.ackSeq = rec.seq;
      r.nextSeq = rec.seq + 1; // only ever advance on a record we actually used
    } else {
      // starved: hold the last known input so the car keeps rolling smoothly
      if (r.last) {
        r.dropped++;
        this.packetsLost++;
        this.updateQuality();
      }
    }
    if (r.last) {
      Object.assign(car.controls, r.last);
      if (car.controls.useItem && !r.prevItem && game.rumble) game.useItem(car);
      r.prevItem = !!car.controls.useItem;
    }
  }

  /** Host, once per physics step after everything moved: 30 Hz snapshots. */
  afterHostStep(game, dt) {
    this.snapAccum = (this.snapAccum || 0) + dt;
    const interval = 1 / NET.SNAPSHOT_HZ;
    if (this.snapAccum + 1e-6 < interval) return;
    this.snapAccum -= interval;
    if (this.snapAccum > interval) this.snapAccum = 0;
    this.sendSnapshot(game);
  }

  sendSnapshot(game) {
    if (!this.conn || !this.conn.open) return;
    const s = this.snapOut;
    s.frame = game.frame;
    s.simTime = game.time;
    s.state = game.state;
    s.stateTimer = game.stateTimer;
    s.score = game.score;
    s.clock = game.clock;
    s.overtime = !!game.overtime;
    s.ballFrozen = !!game.ball.frozen;
    s.kickoffPending = !!game.kickoffPending;
    s.rumble = !!game.rumble;
    const b = game.ball;
    s.ball.pos.copy(b.pos);
    s.ball.vel.copy(b.vel);
    s.ball.angVel.copy(b.angVel);
    s.ball.quat.copy(b.quat);
    s.ball.lastTouch = b.lastTouch && b.lastTouch.car && b.lastTouch.car.netIdx !== undefined ? b.lastTouch.car.netIdx : -1;
    s.pads.length = game.pads.length;
    for (let i = 0; i < game.pads.length; i++) s.pads[i] = game.pads[i].active;
    s.cars.length = game.cars.length;
    for (let i = 0; i < game.cars.length; i++) {
      const car = game.cars[i];
      const ack = this.remote && this.remote.idx === i ? this.remote.ackSeq : 0;
      s.cars[i] = writeCarState(car, s.cars[i], ack);
    }
    this.conn.send(packSnapshot(s));
    this.snapshots++;
  }

  // =================================================================== guest
  onSnapshot(s) {
    const game = this.game;
    if (!game) return;
    const arrived = this.localTime;

    // clock offset: min over a sliding window = the least-delayed path
    this.offsetSamples.push({ t: arrived, v: arrived - s.simTime });
    while (this.offsetSamples.length && arrived - this.offsetSamples[0].t > 4) this.offsetSamples.shift();
    let min = Infinity;
    for (const o of this.offsetSamples) if (o.v < min) min = o.v;
    if (isFinite(min)) this.timeOffset = min;

    // arrival jitter drives the interpolation delay
    const gap = arrived - this.lastSnapshotRecv;
    this.lastSnapshotRecv = arrived;
    if (this.snapshots > 0 && gap > 0 && gap < 1) {
      this.jitter = this.jitter * 0.85 + Math.abs(gap - 1 / NET.SNAPSHOT_HZ) * 0.15;
    }
    this.snapshots++;
    const target = Math.max(NET.INTERP_MIN, Math.min(NET.INTERP_MAX, this.jitter * 2.5 + this.rtt * 0.3 + 0.045));
    this.interpDelay += (target - this.interpDelay) * 0.06;

    const copy = cloneSnapshot(s);
    this.buffer.push(copy);
    while (this.buffer.length > 96) this.buffer.shift();

    // match meta is applied immediately
    game.state = s.state;
    game.stateTimer = s.stateTimer;
    game.score[0] = s.score[0];
    game.score[1] = s.score[1];
    game.clock = s.clock;
    game.overtime = s.overtime;
    game.kickoffPending = s.kickoffPending;
    game.ball.frozen = s.ballFrozen;
    game.predictionDirty = true;
    game.time = this.hostTime();

    // boost pads
    for (let i = 0; i < game.pads.length; i++) {
      const want = !!s.pads[i];
      const p = game.pads[i];
      if (p.active !== want) {
        p.active = want;
        p.timer = want ? 0 : p.big ? BOOST_PAD.BIG_RESPAWN : BOOST_PAD.SMALL_RESPAWN;
      }
    }

    // counters no event mirrors: boost collected is tracked by the host's pad
    // loop, which the guest never runs, so it arrives with the snapshot
    for (let i = 0; i < s.cars.length && i < game.cars.length; i++) {
      const c = game.cars[i];
      if (c && s.cars[i]) c.stats.boostCollected = s.cars[i].boostCollected;
    }

    // Is this snapshot from before our own predicted hit? Then it cannot be
    // used to correct the car or the ball yet — see touchGuard above.
    const mine = s.cars[this.myIdx];
    const guarded = this.role === 'guest' && this.touchGuard > 0 && !!mine && mine.ackSeq < this.touchGuardSeq;
    this.syncBall(game, s, guarded);
    if (!guarded) this.reconcile(game, s);
  }

  /** Take the authoritative ball, re-run the real ball physics forward by the
   *  snapshot's age, then blend the difference away instead of snapping. */
  syncBall(game, s, soft = false) {
    const ball = game.ball;
    const sim = this.ballSim;
    const age = Math.max(0, this.hostTime() - s.simTime);
    const had = this.ballPrev;
    had.pos.copy(ball.pos);
    had.vel.copy(ball.vel);
    had.angVel.copy(ball.angVel);
    had.quat.copy(ball.quat);

    sim.pos.set(s.ball.pos.x, s.ball.pos.y, s.ball.pos.z);
    sim.vel.set(s.ball.vel.x, s.ball.vel.y, s.ball.vel.z);
    sim.angVel.set(s.ball.angVel.x, s.ball.angVel.y, s.ball.angVel.z);
    sim.quat.set(s.ball.quat.x, s.ball.quat.y, s.ball.quat.z, s.ball.quat.w);
    sim.frozen = false;
    const steps = Math.min(48, Math.round(age / PHYSICS_DT));
    for (let i = 0; i < steps; i++) sim.step(PHYSICS_DT);

    const ltIdx = s.ball.lastTouch;
    if (ltIdx >= 0 && game.cars[ltIdx]) {
      const car = game.cars[ltIdx];
      if (!ball.lastTouch || ball.lastTouch.car !== car) ball.lastTouch = { car, team: car.team, time: game.time };
    } else if (ltIdx < 0) ball.lastTouch = null;

    if (s.ballFrozen) {
      ball.frozen = true;
      ball.pos.copy(sim.pos);
      ball.vel.set(0, 0, 0);
      ball.quat.copy(sim.quat);
      this.ballCorrection = null;
      return;
    }
    ball.frozen = false;
    // soft: keep the locally predicted flight (we just hit it, the host has not
    // caught up yet) instead of bending the ball back toward a stale state
    if (soft) return;
    const err = _v1.copy(sim.pos).sub(had.pos).length();
    if (!isFinite(err) || err > NET.BALL_SNAP_DIST) {
      ball.pos.copy(sim.pos);
      ball.vel.copy(sim.vel);
      ball.angVel.copy(sim.angVel);
      ball.quat.copy(sim.quat);
      this.ballCorrection = null;
      return;
    }
    if (err > 0.35) {
      const c = this.ballCorrection || (this.ballCorrection = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), angVel: new THREE.Vector3() });
      c.pos.copy(sim.pos).sub(had.pos);
      c.vel.copy(sim.vel).sub(had.vel);
      c.angVel.copy(sim.angVel).sub(had.angVel);
    } else this.ballCorrection = null;
  }

  applyBallCorrection(dt) {
    const c = this.ballCorrection;
    const game = this.game;
    if (!c || !game) return;
    const ball = game.ball;
    const k = 1 - Math.exp(-18 * dt);
    ball.pos.addScaledVector(c.pos, k);
    ball.vel.addScaledVector(c.vel, k);
    ball.angVel.addScaledVector(c.angVel, k);
    c.pos.multiplyScalar(1 - k);
    c.vel.multiplyScalar(1 - k);
    c.angVel.multiplyScalar(1 - k);
    if (c.pos.lengthSq() < 0.04 && c.vel.lengthSq() < 4) this.ballCorrection = null;
  }

  /** Replay every input the host has not acked yet on top of its car state. */
  reconcile(game, s) {
    const car = game.human;
    if (!car) return;
    const cs = s.cars[this.myIdx];
    if (!cs) return;

    const ack = cs.ackSeq;
    let i = 0;
    while (i < this.pending.length && this.pending[i].seq <= ack) i++;
    if (i > 0) this.pending.splice(0, i);
    if (this.pending.length > 360) this.pending.splice(0, this.pending.length - 360);

    const st = this.savedState;
    saveCarState(car, st);
    copyStats(car.stats, this.savedStats);
    copyEvents(car.events, this.savedEvents);

    applyCarState(car, cs);
    for (const rec of this.pending) {
      Object.assign(car.controls, rec.c);
      car.step(PHYSICS_DT);
    }
    this.recPos.copy(car.pos);
    this.recVel.copy(car.vel);
    const recBoost = car.boost;

    const dPos = _v2.copy(this.recPos).sub(st.pos);
    const dVel = _v3.copy(this.recVel).sub(st.vel);
    const dist = dPos.length();
    const angle = angleBetween(car.quat, st.quat);
    const demoChanged = car.demolished !== st.demolished;

    // Diagnostics that matter for feel: `residual` is how far the authoritative
    // re-simulation disagrees with what the player was shown. Small residuals
    // are float drift and vanish in the glide; a large one means the two peers
    // are simulating differently, and that is a bug, not lag.
    this.residual = dist;
    this.residualVel = dVel.length();
    if (dist > this.residualMax) this.residualMax = dist;

    if (dist > NET.SNAP_DIST || angle > NET.SNAP_ANGLE || demoChanged || dVel.length() > 900) {
      // real disagreement: trust the host outright. This is expected after
      // something the guest cannot predict locally — a demo, a bump from
      // another car, a touch where the two peers' balls differed by a hair —
      // and it is a bug if it happens while driving around on your own.
      this.correction = null;
      this.snaps++;
      this.lastSnap = {
        reason: demoChanged ? 'demo' : dist > NET.SNAP_DIST ? 'distance' : angle > NET.SNAP_ANGLE ? 'angle' : 'velocity',
        dist,
        angle,
        dVel: dVel.length(),
        time: game.time,
      };
    } else {
      // float drift / a step of input skew: keep showing the predicted car and
      // glide the residual away over ~100 ms
      restoreCarState(car, st);
      if (dist > 0.1 || dVel.length() > 1 || Math.abs(recBoost - st.boost) > 0.4) {
        const c = this.correction || (this.correction = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), boost: 0 });
        c.pos.copy(dPos);
        c.vel.copy(dVel);
        c.boost = recBoost - st.boost;
      } else this.correction = null;
      if (dist > 0.1 || dVel.length() > 1) this.glides++;
    }
    // stats and per-step events belong to the local timeline, not the replay
    copyStats(this.savedStats, car.stats);
    copyEvents(this.savedEvents, car.events);
  }

  applyCarCorrection(dt) {
    const c = this.correction;
    const game = this.game;
    if (!c || !game || !game.human) return;
    const car = game.human;
    const k = 1 - Math.exp(-22 * dt);
    car.pos.addScaledVector(c.pos, k);
    car.vel.addScaledVector(c.vel, k);
    car.boost = Math.max(0, Math.min(100, car.boost + c.boost * k));
    c.pos.multiplyScalar(1 - k);
    c.vel.multiplyScalar(1 - k);
    c.boost *= 1 - k;
    if (c.pos.lengthSq() < 0.04 && c.vel.lengthSq() < 4 && Math.abs(c.boost) < 0.05) this.correction = null;
  }

  /** Guest: one physics step of local prediction. */
  guestStep(game, dt) {
    game.frame++;
    const car = game.human;
    if (!car) return;
    if (game.state === 'countdown') {
      // exactly like the host: locked in place, boost locked, until GO
      car.controls.throttle = 0;
      car.controls.steer = 0;
      car.controls.jump = false;
      car.controls.boost = false;
      car.vel.set(0, 0, 0);
    }
    if (car.demolished) {
      car.respawnTimer -= dt;
      return;
    }
    quantizeControls(car.controls, car.controls);
    this.inputSeq++;
    const rec = { seq: this.inputSeq, c: { ...car.controls } };
    this.pending.push(rec);
    this.sendBuf.push(rec);
    car.step(dt);
    if (!game.ball.frozen) game.ball.step(dt);
    // Our own hit on the ball is predicted, in the same order the host does it
    // (car, then ball, then contact). Without this the car would drive straight
    // through the ball and only react a round trip later — that is exactly the
    // "lag" a player feels on every kick, save and dribble.
    if (!game.ball.frozen && collideCarBall(car, game.ball, game.time)) {
      this.touchGuardSeq = this.inputSeq;
      this.touchGuard = TOUCH_GUARD;
      this.lastPredictedTouch = game.time;
      game.emit('touch', { car, speed: car.vel.distanceTo(game.ball.vel), predicted: true });
    }
    this.applyBallCorrection(dt);
    this.applyCarCorrection(dt);
  }

  /** Guest: end of a rendered frame — ship inputs, interpolate, record replay. */
  guestEndFrame(game, dt) {
    if (this.touchGuard > 0) this.touchGuard -= dt;
    if (this.sendBuf.length && this.conn && this.conn.open) {
      const batch = this.sendBuf.splice(0, this.sendBuf.length);
      this.conn.send(packInputs(batch));
    } else if (this.sendBuf.length > 240) {
      this.sendBuf.splice(0, this.sendBuf.length - 240);
    }
    this.interpolate(game);
    this.predictedTouches(game, dt);
    this.guestReplayTick(game, dt);
    if (game.state === 'play' && game.frame % 4 === 0) game.recordReplayFrame();
    if (game.replay) {
      game.replay.t += dt * game.replay.speed;
      if (game.replay.t >= game.replay.duration) game.replay = null;
    }
  }

  /** Remote cars (the opponent and any bots) are drawn `interpDelay` behind. */
  interpolate(game) {
    const buf = this.buffer;
    if (!buf.length) return;
    const target = this.hostTime() - this.interpDelay;
    let a = null;
    let b = null;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].simTime <= target) a = buf[i];
      else {
        b = buf[i];
        break;
      }
    }
    if (!a) a = buf[0]; // the whole buffer is in the future: hold the oldest frame
    if (!b) {
      // nothing new enough: dead-reckon from the last frame we have, briefly
      b = a;
      const over = target - a.simTime;
      this.starved++;
      this.applySnapshotCars(game, a, b, 0, over > 0 && over < 0.25 ? over : 0);
      return;
    }
    this.starved = 0;
    const span = b.simTime - a.simTime;
    const u = span > 1e-6 ? Math.max(0, Math.min(1, (target - a.simTime) / span)) : 0;
    this.applySnapshotCars(game, a, b, u);
  }

  applySnapshotCars(game, a, b, u, extrapolate = 0) {
    for (let i = 0; i < game.cars.length; i++) {
      const car = game.cars[i];
      if (car === game.human) continue;
      const ca = a.cars[i];
      const cb = b.cars[i] || ca;
      if (!ca) continue;
      if (ca.demolished || cb.demolished) {
        car.demolished = true;
        car.respawnTimer = Math.min(ca.respawnTimer, cb.respawnTimer);
        continue;
      }
      car.demolished = false;
      car.respawnTimer = 0;
      if (extrapolate > 0) {
        car.pos.set(ca.pos.x + ca.vel.x * extrapolate, ca.pos.y + ca.vel.y * extrapolate, ca.pos.z + ca.vel.z * extrapolate);
        car.vel.set(ca.vel.x, ca.vel.y, ca.vel.z);
        car.quat.set(ca.quat.x, ca.quat.y, ca.quat.z, ca.quat.w);
        car.angVel.set(ca.angVel.x, ca.angVel.y, ca.angVel.z);
      } else {
        car.pos.set(lerp3(ca.pos.x, cb.pos.x, u), lerp3(ca.pos.y, cb.pos.y, u), lerp3(ca.pos.z, cb.pos.z, u));
        car.vel.set(lerp3(ca.vel.x, cb.vel.x, u), lerp3(ca.vel.y, cb.vel.y, u), lerp3(ca.vel.z, cb.vel.z, u));
        car.angVel.set(lerp3(ca.angVel.x, cb.angVel.x, u), lerp3(ca.angVel.y, cb.angVel.y, u), lerp3(ca.angVel.z, cb.angVel.z, u));
        _q1.set(ca.quat.x, ca.quat.y, ca.quat.z, ca.quat.w);
        _q2.set(cb.quat.x, cb.quat.y, cb.quat.z, cb.quat.w);
        car.quat.copy(_q1).slerp(_q2, u);
      }
      car.boost = lerp3(ca.boost, cb.boost, u);
      car.wheelSpin = lerp3(ca.wheelSpin, cb.wheelSpin, u);
      car.steerVisual = lerp3(ca.steerVisual, cb.steerVisual, u);
      car.suspension = lerp3(ca.suspension, cb.suspension, u);
      car.supersonic = cb.supersonic;
      car.boostActive = cb.boostActive;
      car.handbraking = cb.handbraking;
      car.onGround = cb.onGround;
      car.airRollActive = cb.airRollActive;
      if (cb.itemId >= 0) {
        const id = ITEM_ORDER[cb.itemId];
        if (!car.item || car.item.id !== id) car.item = { id, cooldown: cb.itemCooldown, timer: cb.itemTimer };
        else {
          car.item.cooldown = cb.itemCooldown;
          car.item.timer = cb.itemTimer;
        }
      } else car.item = null;
    }
  }

  /** Instant audio/VFX for your own touches: the host confirms a moment later,
   *  but the thump should never wait for the round trip. */
  predictedTouches(game, dt) {
    // Audio-only fallback for the rare hit the local physics did not register
    // (the authoritative ball was a hair away from our predicted one). It reads
    // car.lastBallTouch but must never write it: that field decides whether the
    // next real contact is a hit or a dribble, and poisoning it would change the
    // ball's response and desync the two peers.
    const car = game.human;
    if (!car || car.demolished || game.ball.frozen) return;
    this.touchCool -= dt;
    if (this.touchCool > 0) return;
    const b = game.ball;
    car.getHitboxCenter(_v1);
    const reach = Math.max(car.hitbox.half.z, car.hitbox.half.x) + b.radius + 8;
    if (_v1.distanceTo(b.pos) < reach && game.time - car.lastBallTouch > 0.25) {
      this.touchCool = 0.3;
      this.lastPredictedTouch = game.time;
      game.emit('touch', { car, speed: car.vel.distanceTo(b.vel), predicted: true });
    }
  }

  /** Reliable messages that arrive mid-match (events, chat, final stats). */
  applyReliable(msg) {
    const game = this.game;
    if (!game) return;
    if (msg.t === 'chat') {
      game.emit('netChat', { name: msg.name, team: msg.team, text: msg.text });
      return;
    }
    if (msg.t !== 'event') return;
    const { name, data } = msg;
    const car = (i) => (i >= 0 && game.cars[i] ? game.cars[i] : null);
    switch (name) {
      case 'goal': {
        const scorer = car(data.car);
        game.lastGoal = { team: data.team, scorer, ownGoal: data.ownGoal, speed: data.speed, time: game.time };
        game.emit('goal', game.lastGoal);
        this.replayDelay = 1.6;
        break;
      }
      case 'kickoff':
        game.emit('kickoff', { countdown: 3 });
        break;
      case 'go':
        game.emit('go');
        break;
      case 'overtime':
        game.emit('overtime');
        break;
      case 'touch': {
        const c = car(data.car);
        if (c) {
          c.stats.touches++;
          if (c.pos.y > 300) c.stats.aerialTouches++;
        }
        // the local player already heard/ saw this touch through prediction
        const duplicate = c === game.human && Math.abs(game.time - this.lastPredictedTouch) < 0.4;
        if (!duplicate) game.emit('touch', { car: c, speed: data.speed });
        break;
      }
      case 'ballBounce':
        game.emit('ballBounce', { speed: data.speed });
        break;
      case 'pad':
        game.emit('pad', { car: car(data.car), big: data.big });
        break;
      case 'demo': {
        const victim = car(data.victim);
        const by = car(data.by);
        if (by) by.stats.demos++;
        if (victim) victim.stats.demoed++;
        game.emit('demo', { demolisher: by, victim });
        break;
      }
      case 'save':
        game.emit('save', { car: car(data.car), epic: data.epic });
        break;
      case 'shot':
        game.emit('shot', { car: car(data.car) });
        break;
      case 'stat': {
        const c = car(data.car);
        if (c) {
          c.stats.score += data.points;
          const fields = STAT_FIELD[data.kind];
          if (fields) for (const f of fields) c.stats[f] = (c.stats[f] || 0) + 1;
          c.stats.events = c.stats.events || {};
          c.stats.events[data.kind] = (c.stats.events[data.kind] || 0) + 1;
        }
        game.emit('stat', { car: c, kind: data.kind, points: data.points, label: data.label });
        break;
      }
      case 'rumbleUse':
        game.emit('rumbleUse', { car: car(data.car), id: data.id, pos: new THREE.Vector3(data.x, data.y, data.z) });
        break;
      case 'rumbleHit':
        game.emit('rumbleHit', { pos: new THREE.Vector3(data.x, data.y, data.z) });
        break;
      case 'rumbleEnd':
        game.emit('rumbleEnd', { car: car(data.car) });
        break;
      case 'ended': {
        const stats = data.stats;
        if (stats && Array.isArray(stats.cars)) {
          for (let i = 0; i < stats.cars.length; i++) {
            stats.cars[i].isHuman = i === data.mySeat;
            stats.cars[i].isBot = !stats.cars[i].isHuman && !!game.cars[i] && game.cars[i].isBot;
          }
        }
        this.phase = 'ended';
        game.emit('ended', { score: game.score.slice(), stats, net: true });
        break;
      }
      default:
        break;
    }
  }

  guestReplayTick(game, dt) {
    if (this.replayDelay === undefined) return;
    this.replayDelay -= dt;
    if (this.replayDelay > 0) return;
    this.replayDelay = undefined;
    if (game.config.replays !== false) {
      game.startReplay();
      if (game.replay) game.emit('replayStart');
    }
  }

  /** What the HUD shows for the connection. */
  linkInfo() {
    return {
      ping: Math.round(this.rtt * 1000),
      quality: this.quality,
      loss: this.packetsIn + this.packetsLost > 0 ? this.packetsLost / (this.packetsIn + this.packetsLost) : 0,
      delay: Math.round(this.interpDelay * 1000),
      peer: this.peer ? this.peer.name : '',
      role: this.role,
      phase: this.phase,
    };
  }
}

// ---------------------------------------------------------------------------
function perfNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function lerp3(a, b, t) {
  return a + (b - a) * t;
}

function pingFrame(kind, id, t0) {
  const buf = new ArrayBuffer(16);
  const v = new DataView(buf);
  v.setUint8(0, kind);
  v.setUint32(1, id, true);
  v.setFloat64(5, t0, true);
  return new Uint8Array(buf);
}

function angleBetween(a, b) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}

function saveCarState(car, o) {
  o.pos.copy(car.pos);
  o.vel.copy(car.vel);
  o.angVel.copy(car.angVel);
  o.quat.copy(car.quat);
  o.boost = car.boost;
  o.demolished = car.demolished;
  o.onGround = car.onGround;
  return o;
}

function restoreCarState(car, s) {
  car.pos.copy(s.pos);
  car.vel.copy(s.vel);
  car.angVel.copy(s.angVel);
  car.quat.copy(s.quat);
  car.boost = s.boost;
  car.demolished = s.demolished;
  car.onGround = s.onGround;
}

/** Authoritative wire state -> a live Car (every field the physics reads). */
export function applyCarState(car, cs) {
  car.pos.set(cs.pos.x, cs.pos.y, cs.pos.z);
  car.vel.set(cs.vel.x, cs.vel.y, cs.vel.z);
  car.angVel.set(cs.angVel.x, cs.angVel.y, cs.angVel.z);
  car.quat.set(cs.quat.x, cs.quat.y, cs.quat.z, cs.quat.w);
  car.surfaceNormal.set(cs.normal.x, cs.normal.y, cs.normal.z);
  if (!car._prevN) car._prevN = new THREE.Vector3();
  car._prevN.set(cs.prevN.x, cs.prevN.y, cs.prevN.z);
  car.boost = cs.boost;
  car.onGround = cs.onGround;
  car.hasJumped = cs.hasJumped;
  car.hasFlip = cs.hasFlip;
  car.jumpHolding = cs.jumpHolding;
  car.jumpHoldTime = cs.jumpHoldTime;
  car.flipping = cs.flipping;
  car.flipTimer = cs.flipTimer;
  car.flipWindow = cs.flipWindow;
  car.flipCancelled = cs.flipCancelled;
  car.flipDir = { f: cs.flipF, s: cs.flipS };
  car.airTime = cs.airTime;
  car.supersonic = cs.supersonic;
  car.boostActive = cs.boostActive;
  car.handbraking = cs.handbraking;
  car.prevJump = cs.prevJump;
  car.airRollActive = cs.airRollActive;
  car.suspension = cs.suspension;
  car.wheelSpin = cs.wheelSpin;
  car.steerVisual = cs.steerVisual;
  const wasDemo = car.demolished;
  car.demolished = cs.demolished;
  car.respawnTimer = cs.respawnTimer;
  if (car.demolished && !wasDemo) car.pos.set(0, -5000, 0);
  if (cs.itemId >= 0) car.item = { id: ITEM_ORDER[cs.itemId], cooldown: cs.itemCooldown, timer: cs.itemTimer };
  else car.item = null;
}

function copyStats(from, to) {
  for (const k in from) if (typeof from[k] === 'number') to[k] = from[k];
  return to;
}

function copyEvents(from, to) {
  to.jumped = from.jumped;
  to.doubleJumped = from.doubleJumped;
  to.dodged = from.dodged;
  to.landed = from.landed;
  to.wallHit = from.wallHit;
  to.flipReset = from.flipReset;
  return to;
}

function cloneSnapshot(s) {
  const out = { simTime: s.simTime, cars: [] };
  for (const c of s.cars) {
    out.cars.push({
      pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z },
      vel: { x: c.vel.x, y: c.vel.y, z: c.vel.z },
      angVel: { x: c.angVel.x, y: c.angVel.y, z: c.angVel.z },
      quat: { x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w },
      boost: c.boost,
      wheelSpin: c.wheelSpin,
      steerVisual: c.steerVisual,
      suspension: c.suspension,
      supersonic: c.supersonic,
      boostActive: c.boostActive,
      handbraking: c.handbraking,
      onGround: c.onGround,
      airRollActive: c.airRollActive,
      demolished: c.demolished,
      respawnTimer: c.respawnTimer,
      itemId: c.itemId,
      itemCooldown: c.itemCooldown,
      itemTimer: c.itemTimer,
    });
  }
  return out;
}

/**
 * The seat list both peers build their cars from, so car order — and therefore
 * every index that travels over the wire — matches exactly on both sides.
 */
export function buildRoster(opts, me, peer) {
  const teamSize = Math.max(1, Math.min(3, opts.teamSize || 1));
  const myTeam = opts.humanTeam === TEAM.ORANGE ? TEAM.ORANGE : TEAM.BLUE;
  const theirTeam = 1 - myTeam;
  const botNames = { 0: ['Nova', 'Zephyr', 'Bolt', 'Ion', 'Vex'], 1: ['Ember', 'Rogue', 'Titan', 'Flare', 'Onyx'] };
  const seats = [
    { name: (me && me.name) || 'Host', team: myTeam, bot: false, peer: 'host', loadout: (me && me.loadout) || null },
    { name: (peer && peer.name) || 'Guest', team: theirTeam, bot: false, peer: 'guest', loadout: (peer && peer.loadout) || null },
  ];
  for (let team = 0; team < 2; team++) {
    for (let i = 1; i < teamSize; i++) {
      seats.push({ name: botNames[team][i % botNames[team].length], team, bot: true, peer: null, loadout: null, botIndex: i });
    }
  }
  // stable order: team blue first, humans before bots
  seats.sort((a, b) => a.team - b.team || Number(a.bot) - Number(b.bot));
  return seats;
}

export { P2P_FAIL_MESSAGE, FORWARDED };
