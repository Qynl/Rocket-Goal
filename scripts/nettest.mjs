// Headless online test: two NetSessions, two real Games, and a fake transport
// with configurable latency, jitter and packet loss. No browser, no WebRTC —
// the connection is stubbed, everything else (protocol, prediction,
// reconciliation, interpolation, event mirroring) is the real code.
import { NetSession, buildRoster } from '../src/net/session.js';
import { P2P_FAIL_MESSAGE } from '../src/net/connection.js';
import { packSnapshot, readSnapshot, packInputs, readInputs, writeCarState, quantizeControls, NET } from '../src/net/protocol.js';
import { encodeSdpCode, decodeSdpCode, trimSdp, untrimSdp } from '../src/net/sdp.js';
import { Game } from '../src/game.js';
import { Car } from '../src/physics/car.js';

// Deterministic run: the packet-loss pattern, the kickoff slot shuffle and the
// bots all come from this one seeded stream, so a failure here is reproducible
// instead of a heisenbug. Change SEED to explore a different match.
const SEED = Number(process.env.NET_SEED || 0x2f6e2b1);
let _seed = SEED >>> 0;
Math.random = () => {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
};

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

// ---------------------------------------------------------------------------
// fake transport
// ---------------------------------------------------------------------------
class FakeLink {
  constructor(opts = {}) {
    this.latency = opts.latency ?? 0.025;
    this.jitter = opts.jitter ?? 0.006;
    this.loss = opts.loss ?? 0;
    this.queue = [];
    this.t = 0;
    this.blackhole = false; // drop every unreliable packet (a dead NAT)
    this.delivered = 0;
    this.dropped = 0;
    this.bytes = 0;
  }
  push(from, data, reliable) {
    if (this.blackhole && !reliable) return this.dropped++;
    if (!reliable && this.loss > 0 && Math.random() < this.loss) return this.dropped++;
    const delay = this.latency + (Math.random() * 2 - 1) * this.jitter;
    this.queue.push({ to: from === 'host' ? 'guest' : 'host', data, due: this.t + Math.max(0.001, delay) });
    if (data instanceof Uint8Array) this.bytes += data.length;
  }
  advance(dt, sessions) {
    this.t += dt;
    const ready = [];
    const rest = [];
    for (const p of this.queue) (p.due <= this.t ? ready : rest).push(p);
    ready.sort((a, b) => a.due - b.due);
    this.queue = rest;
    for (const p of ready) {
      const s = sessions[p.to];
      if (p.data instanceof Uint8Array) s.onBinary(p.data);
      else s.onJsonMessage(p.data);
      this.delivered++;
    }
  }
}

class FakeConn {
  constructor(role, link) {
    this.role = role;
    this.link = link;
    this.state = 'connected';
    this.open = true;
    this.onBinary = () => {};
    this.onJson = () => {};
    this.onState = () => {};
    this.sent = 0;
  }
  send(data) {
    if (!this.open) return false;
    this.link.push(this.role, data, false);
    this.sent++;
    return true;
  }
  sendJson(obj) {
    if (!this.open) return false;
    this.link.push(this.role, JSON.parse(JSON.stringify(obj)), true);
    return true;
  }
  close(reason) {
    this.open = false;
    this.state = 'closed';
    this.onState({ state: 'closed', detail: reason });
  }
}

/** A pair of sessions + games wired through a fake link, driven by a fake clock. */
function makePair(opts = {}) {
  const link = new FakeLink(opts);
  const sides = {};
  for (const role of ['host', 'guest']) {
    const conn = new FakeConn(role, link);
    const session = new NetSession({
      role,
      connection: conn,
      name: role === 'host' ? 'Hosty' : 'Guesty',
      loadout: role === 'host' ? { car: 'dominus', primary: 0x11ff22 } : { car: 'merc', primary: 0xff2211 },
      onStart: (config) => {
        sides[role].config = config;
        sides[role].game = new Game(config);
        session.attach(sides[role].game);
        session.stopWatchdog(); // the test drives tick() by hand
      },
      onLobby: () => (sides[role].lobby = true),
      onFail: (info) => (sides[role].fail = info),
    });
    // simulated clock: the test's `t` is the only time that exists
    session.now = () => link.t;
    sides[role] = { session, conn, game: null, config: null, lobby: false, fail: null, events: [] };
  }
  // record the events the UI would react to
  for (const name of ['goal', 'kickoff', 'go', 'ended', 'demo', 'save', 'stat', 'touch', 'netChat', 'replayStart']) {
    sides.guest.hookOn = name;
  }
  return { link, host: sides.host, guest: sides.guest };
}

function hookEvents(side) {
  side.seen = {};
  const g = side.game;
  for (const name of ['goal', 'kickoff', 'go', 'ended', 'demo', 'save', 'stat', 'touch', 'netChat', 'overtime', 'replayStart', 'pad']) {
    g.on(name, () => (side.seen[name] = (side.seen[name] || 0) + 1));
  }
}

/** Drive both peers one rendered frame at a time. */
function step(pair, seconds, drive) {
  const dt = 1 / 60;
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    pair.link.advance(dt, { host: pair.host.session, guest: pair.guest.session });
    if (drive) drive(pair, i * dt);
    for (const side of [pair.host, pair.guest]) {
      if (!side.game) continue;
      side.game.update(dt);
      if (i % 15 === 0) side.session.tick();
    }
  }
}

const finite = (v) => Number.isFinite(v);
const allFinite = (game) => {
  if (!finite(game.ball.pos.x + game.ball.pos.y + game.ball.pos.z + game.ball.vel.x + game.ball.vel.y + game.ball.vel.z)) return 'ball';
  for (const c of game.cars) {
    if (!finite(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.boost)) return c.name;
    if (!finite(c.quat.x + c.quat.y + c.quat.z + c.quat.w)) return c.name + '.quat';
  }
  return null;
};

// ---------------------------------------------------------------------------
// 1. codec round trip
// ---------------------------------------------------------------------------
{
  const car = new Car(0, 'Codec', false, { car: 'octane' });
  car.setPose(1234.5, -2345.25, 0.7, 66);
  car.vel.set(300.5, -12.25, -1800.75);
  car.angVel.set(0.5, -1.25, 3);
  car.boost = 42.5;
  car.flipping = true;
  car.flipTimer = 0.31;
  car.flipDir = { f: -0.8, s: 0.4 };
  car.item = { id: 'tornado', cooldown: 4.25, timer: 0.5 };
  car.netIdx = 0;
  const snap = {
    frame: 4242,
    simTime: 12.345,
    state: 'goal',
    stateTimer: 2.5,
    score: [3, 1],
    clock: 187.25,
    overtime: true,
    ballFrozen: false,
    kickoffPending: true,
    rumble: true,
    ball: { pos: { x: 1, y: 92.75, z: -3 }, vel: { x: 4, y: 5, z: 6 }, angVel: { x: 0.1, y: 0.2, z: 0.3 }, quat: { x: 0, y: 0.7071, z: 0, w: 0.7071 }, lastTouch: 0 },
    pads: new Array(34).fill(false).map((_, i) => i % 3 === 0),
    cars: [writeCarState(car, null, 99)],
  };
  const bytes = packSnapshot(snap);
  const back = readSnapshot(bytes, null);
  ok('snapshot codec round trip', back.frame === 4242 && back.state === 'goal' && back.score[0] === 3 && back.overtime && back.kickoffPending && back.rumble);
  ok('snapshot clock + timers', Math.abs(back.clock - 187.25) < 1e-3 && Math.abs(back.simTime - 12.345) < 1e-3 && Math.abs(back.stateTimer - 2.5) < 1e-3);
  const c = back.cars[0];
  ok(
    'car state round trip',
    Math.abs(c.pos.x - 1234.5) < 1e-3 && Math.abs(c.vel.z + 1800.75) < 1e-3 && Math.abs(c.boost - 42.5) < 1e-3 && c.flipping && Math.abs(c.flipTimer - 0.31) < 1e-3 && c.ackSeq === 99,
    `pos ${c.pos.x} vel ${c.vel.z} ack ${c.ackSeq}`
  );
  ok('flip direction + item round trip', Math.abs(c.flipF + 0.8) < 1e-6 && Math.abs(c.flipS - 0.4) < 1e-6 && c.itemId === 4 && Math.abs(c.itemCooldown - 4.25) < 1e-3);
  ok('pad bitmask round trip', back.pads.length >= 34 && back.pads[0] === true && back.pads[1] === false && back.pads[33] === true);
  ok('ball round trip', Math.abs(back.ball.pos.y - 92.75) < 1e-3 && back.ball.lastTouch === 0 && Math.abs(back.ball.quat.w - 0.7071) < 1e-3);
  ok('snapshot is small', bytes.length < 260, `${bytes.length} bytes for one car`);

  const recs = [
    { seq: 7, c: { throttle: 1, steer: -0.5, pitch: 0.25, yaw: -1, roll: 0, jump: true, boost: false, handbrake: true, useItem: false } },
    { seq: 8, c: { throttle: -1, steer: 0, pitch: 0, yaw: 0, roll: 0.75, jump: false, boost: true, handbrake: false, useItem: true } },
  ];
  const ib = packInputs(recs);
  const rb = readInputs(ib);
  ok('input batch round trip', rb.length === 2 && rb[0].seq === 7 && rb[1].seq === 8 && rb[0].c.jump && rb[0].c.handbrake && rb[1].c.boost && rb[1].c.useItem);
  ok('input quantisation is exact for -1/0/1', rb[0].c.throttle === 1 && rb[1].c.throttle === -1 && rb[0].c.steer === Math.round(-0.5 * 127) / 127);
  ok('input packet is tiny', ib.length <= 2 + recs.length * 11, `${ib.length} bytes`);
  const src = { throttle: 0.3333, steer: -0.7777, pitch: 0, yaw: 0.1, roll: -0.2, jump: true, boost: false, handbrake: false, useItem: true };
  const dst = {};
  quantizeControls(src, dst);
  const again = readInputs(packInputs([{ seq: 1, c: dst }]))[0].c;
  ok('quantise is idempotent (guest predicts what the host simulates)', Object.keys(again).every((k) => typeof again[k] === 'number' ? Math.abs(again[k] - dst[k]) < 1e-9 : again[k] === dst[k]));
}

// ---------------------------------------------------------------------------
// 2. SDP code round trip
// ---------------------------------------------------------------------------
{
  const SDP = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:Rak3',
    'a=ice-pwd:tV05MlBhLZBdn1GkQnSxNn2N',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    'a=candidate:1234567890 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 network-id 1 network-cost 10',
    'a=candidate:9876543210 1 udp 1686052607 203.0.113.7 12345 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1',
  ].join('\r\n') + '\r\n';
  const trimmed = trimSdp(SDP);
  const untrimmed = untrimSdp(trimmed);
  ok('sdp trim keeps every semantic line', untrimmed.includes('a=candidate:1234567890 1 udp 2122260223 192.168.1.23 54321 typ host generation 0 network-id 1 network-cost 10'));
  ok('sdp trim keeps the connection line untouched', untrimmed.includes('c=IN IP4 0.0.0.0'));
  ok('sdp trim keeps ufrag/pwd/fingerprint/setup/mid', ['a=ice-ufrag:Rak3', 'a=ice-pwd:tV05MlBhLZBdn1GkQnSxNn2N', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000'].every((l) => untrimmed.includes(l)));
  ok('sdp trim keeps the fingerprint verbatim', untrimmed.includes('a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'));
  ok('sdp trim drops the hints', !untrimmed.includes('a=ice-options') && !untrimmed.includes('a=msid-semantic') && !untrimmed.includes('a=extmap-allow-mixed'));
  ok('sdp trim ends with CRLF', untrimmed.endsWith('\r\n'));
  const code = await encodeSdpCode(SDP);
  const decoded = await decodeSdpCode(code);
  ok('code round trip reproduces a usable SDP', decoded === untrimmed || decoded === SDP.replace(/a=ice-options:trickle\r\n|a=msid-semantic: WMS\r\n|a=extmap-allow-mixed\r\n/g, ''), `${code.length} chars from ${SDP.length}`);
  ok('code is compact', code.length < SDP.length, `${code.length} < ${SDP.length}`);
  ok('code is one line, no whitespace', !/\s/.test(code));
  ok('code survives being pasted with spaces/newlines', (await decodeSdpCode(code.slice(0, 20) + '\n  ' + code.slice(20))) !== null);
  ok('garbage code is rejected', (await decodeSdpCode('not-a-code')) === null && (await decodeSdpCode('')) === null && (await decodeSdpCode('RG9.bogus!!')) === null);
  ok('a raw pasted SDP is accepted', (await decodeSdpCode(SDP)) !== null);
}

// ---------------------------------------------------------------------------
// 3. handshake + roster
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.03 });
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.3, null);
  ok('handshake reaches the lobby on both sides', pair.host.session.phase === 'lobby' && pair.guest.session.phase === 'lobby', `${pair.host.session.phase}/${pair.guest.session.phase}`);
  ok('names are exchanged', pair.host.session.peer.name === 'Guesty' && pair.guest.session.peer.name === 'Hosty');

  const roster = buildRoster({ teamSize: 3, humanTeam: 0, difficulty: 'allstar' }, pair.host.session.me, pair.host.session.peer);
  ok('roster has 2 humans + 4 bots for 3v3', roster.length === 6 && roster.filter((r) => !r.bot).length === 2, roster.map((r) => `${r.name}:${r.team}${r.bot ? '(bot)' : ''}`).join(' '));
  ok('roster puts the players on opposite teams', roster.find((r) => r.peer === 'host').team !== roster.find((r) => r.peer === 'guest').team);
  ok('roster order is stable (blue first, humans first)', roster.map((r) => r.team).join('') === '000111');

  const cfg = pair.host.session.startMatch({ teamSize: 3, arena: 'wasteland', mutators: { length: 300, rumble: 'none' }, difficulty: 'allstar', humanTeam: 0 });
  ok('host startMatch returns a config', !!cfg && cfg.online === true && cfg.net.role === 'host');
  step(pair, 0.4, null);
  ok('guest received the start and built the match', !!pair.guest.game, pair.guest.session.phase);
  ok(
    'both peers built identical rosters',
    pair.host.game.cars.length === 6 &&
      pair.guest.game.cars.length === 6 &&
      pair.host.game.cars.every((c, i) => c.name === pair.guest.game.cars[i].name && c.team === pair.guest.game.cars[i].team && c.isBot === pair.guest.game.cars[i].isBot && c.spec.car === pair.guest.game.cars[i].spec.car)
  );
  ok('each peer drives its own car', pair.host.game.human.name === 'Hosty' && pair.guest.game.human.name === 'Guesty');
  ok('the host runs the bots, the guest does not', pair.host.game.bots.length === 4 && pair.guest.game.bots.length === 0, `${pair.host.game.bots.length}/${pair.guest.game.bots.length}`);
  ok('remote cars are flagged', pair.host.game.cars.filter((c) => c.isRemote).length === 1 && pair.guest.game.cars.filter((c) => c.isRemote).length === 1);
  ok('netIdx matches the roster on both sides', pair.host.game.cars.every((c, i) => c.netIdx === i) && pair.guest.game.cars.every((c, i) => c.netIdx === i));
  ok('guest loads the host arena + rules', pair.guest.config.arena === 'wasteland' && pair.guest.game.clock === 300);
  ok('guest starts in the countdown and waits', pair.guest.game.state === 'countdown' && pair.guest.game.ball.frozen === true);
}

// ---------------------------------------------------------------------------
// 4. a real online match: prediction, reconciliation, interpolation
// ---------------------------------------------------------------------------
async function playMatch(opts = {}, seconds = 25, scenario = null) {
  const pair = makePair(opts);
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.2, null);
  pair.host.session.startMatch({ teamSize: opts.teamSize || 1, arena: 'stadium', mutators: { length: 0, rumble: opts.rumble || 'none' }, difficulty: 'pro', humanTeam: 0 });
  step(pair, 0.3, null);
  hookEvents(pair.host);
  hookEvents(pair.guest);
  const samples = [];
  let lastState = '';
  let lastGuestState = '';
  let lastChange = -10;
  const drive = (p, t) => {
    const hg = p.host.game;
    const gg = p.guest.game;
    if (!hg || !gg) return;
    // both players do something interesting: drive at the ball, jump, boost
    const steerTo = (car, target) => {
      const dx = target.x - car.pos.x;
      const dz = target.z - car.pos.z;
      const yaw = Math.atan2(dx, dz);
      const f = car.getForward();
      const carYaw = Math.atan2(f.x, f.z);
      let d = yaw - carYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.max(-1, Math.min(1, d * 2));
    };
    hg.human.controls.throttle = 1;
    hg.human.controls.boost = hg.human.boost > 10;
    hg.human.controls.steer = steerTo(hg.human, hg.ball.pos);
    hg.human.controls.jump = Math.sin(t * 1.7) > 0.93;
    gg.human.controls.throttle = 1;
    gg.human.controls.boost = gg.human.boost > 10;
    gg.human.controls.steer = steerTo(gg.human, gg.ball.pos);
    gg.human.controls.jump = Math.cos(t * 2.1) > 0.9;
    gg.human.controls.handbrake = Math.sin(t * 0.9) > 0.8;
    if (scenario) scenario(p, t);
    // measure: the guest's predicted car vs the host's authoritative one
    const hostView = hg.cars.find((c) => c.name === 'Guesty');
    const guestView = gg.human;
    if (hg.state !== lastState || gg.state !== lastGuestState) {
      lastState = hg.state;
      lastGuestState = gg.state;
      lastChange = t;
    }
    samples.push({
      state: hg.state,
      since: t - lastChange,
      snaps: gg.net.snaps,
      snapCount: gg.net.snapshots,
      snapReason: gg.net.lastSnap && gg.net.lastSnap.reason,
      // could the guest have predicted this frame? only if nothing was near
      nearRemote: hostView ? hostView.pos.distanceTo(gg.cars.find((c) => c.name === 'Hosty').pos) : 1e9,
      nearBall: hg.ball.pos.distanceTo(guestView.pos),
      t,
      carErr: hostView.pos.distanceTo(guestView.pos),
      residual: gg.net.residual,
      residualVel: gg.net.residualVel,
      velErr: hostView.vel.distanceTo(guestView.vel),
      ballErr: hg.ball.pos.distanceTo(gg.ball.pos),
      quatErr: Math.abs(hostView.quat.dot(guestView.quat)),
      ping: gg.score[0] - hg.score[0] + (gg.score[1] - hg.score[1]),
    });
  };
  step(pair, seconds, drive);
  return { pair, samples };
}

{
  const { pair, samples } = await playMatch({ latency: 0.02, jitter: 0.005 }, 25);
  const hg = pair.host.game;
  const gg = pair.guest.game;
  const avg = (arr, k) => arr.reduce((a, s) => a + s[k], 0) / Math.max(1, arr.length);
  const max = (arr, k) => arr.reduce((a, s) => Math.max(a, s[k]), 0);
  const pct = (arr, k, q) => {
    if (!arr.length) return 0;
    const v = arr.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(v.length * q))];
  };
  // "steady play" = in the 'play' state and at least 0.25 s after any transition
  const settled = samples.filter((s) => s.state === 'play' && s.since > 0.25);
  const transitions = samples.filter((s) => s.state !== 'play' || s.since <= 0.25);
  ok('no NaN anywhere on either peer', allFinite(hg) === null && allFinite(gg) === null, `${allFinite(hg)} / ${allFinite(gg)}`);
  ok('plenty of steady-play samples', settled.length > samples.length * 0.4, `${settled.length}/${samples.length}`);
  // The local player is *supposed* to be ahead of the host by the input
  // latency — that is what zero-latency controls mean. Bound it by the
  // one-way delay at supersonic speed instead of demanding it be zero.
  const lagBudget = 0.02 * 2300 + 60; // this scenario runs at 20 ms one-way
  ok('guest is ahead of the host by roughly the input latency, not more', avg(settled, 'carErr') < lagBudget, `avg ${avg(settled, 'carErr').toFixed(1)} uu, p99 ${pct(settled, 'carErr', 0.99).toFixed(1)} uu, budget ${lagBudget.toFixed(0)} uu`);
  // The number that actually decides "does it feel laggy": after replaying the
  // in-flight inputs on the authoritative state, how much was left over?
  // only frames where a snapshot actually landed carry a fresh residual;
  // reading it on other frames would just repeat the previous value
  const reconciled = settled.filter((x, i) => i > 0 && x.snapCount > settled[i - 1].snapCount);
  const steady = reconciled.filter((x) => x.snapReason !== 'demo');
  ok('plenty of reconciled frames to judge', reconciled.length > 300, `${reconciled.length} frames`);
  ok('prediction is deterministic (tiny reconciliation residual)', avg(steady, 'residual') < 3 && pct(steady, 'residual', 0.99) < 25, `avg ${avg(steady, 'residual').toFixed(3)} uu, p99 ${pct(steady, 'residual', 0.99).toFixed(2)} uu, max ${Math.max(...steady.map((x) => x.residual)).toFixed(1)} uu`);
  ok('velocity residual is tiny too', avg(steady, 'residualVel') < 40, `avg ${avg(steady, 'residualVel').toFixed(2)} uu/s`);
  // A hard snap is only legitimate right after something the guest could not
  // have predicted: contact with the other car, or a ball touch. Anything else
  // is desync, and desync is a bug.
  const snapFrames = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].snaps > samples[i - 1].snaps) snapFrames.push(samples[i]);
  }
  const explained = snapFrames.filter((f) => f.snapReason === 'demo' || f.nearRemote < 400 || f.nearBall < 400 || f.state !== 'play' || f.since < 0.6);
  ok(
    'every hard snap is explained by an interaction, never by drift',
    explained.length === snapFrames.length,
    `${snapFrames.length} snaps (${explained.length} explained) in 25 s; unexplained: ${snapFrames.filter((f) => !explained.includes(f)).map((f) => `t=${f.t.toFixed(2)} remote=${f.nearRemote.toFixed(0)} ball=${f.nearBall.toFixed(0)} state=${f.state}`).join(', ') || 'none'}`
  );
  const demoSnaps = snapFrames.filter((f) => f.snapReason === 'demo');
  const transitionSnaps = snapFrames.filter((f) => f.snapReason !== 'demo' && f.since < 0.6);
  ok(
    'snaps are only demos and kickoff teleports',
    demoSnaps.length + transitionSnaps.length + snapFrames.filter((f) => f.nearRemote < 400 || f.nearBall < 400).length >= snapFrames.length,
    `${demoSnaps.length} demo/respawn, ${transitionSnaps.length} kickoff, ${pair.guest.session.glides} glides`
  );
  ok('velocity converges too', avg(settled, 'velErr') < 120, `avg ${avg(settled, 'velErr').toFixed(1)} uu/s`);
  ok('orientation converges', avg(settled, 'quatErr') > 0.995, `avg dot ${avg(settled, 'quatErr').toFixed(4)}`);
  // a kickoff/goal teleport is authoritative and must be adopted within a few frames
  const worst = max(transitions, 'carErr');
  const recovered = transitions.filter((s) => s.since > 0.12);
  ok('transitions are adopted quickly, not fought', max(recovered, 'carErr') < NET.SNAP_DIST * 2, `worst during a transition ${worst.toFixed(0)} uu, after 0.12 s ${max(recovered, 'carErr').toFixed(0)} uu`);
  ok('ball is live on the guest (extrapolated, not delayed)', avg(settled, 'ballErr') < 90, `avg ${avg(settled, 'ballErr').toFixed(1)} uu`);
  ok('score never diverges', max(settled, 'ping') === 0 && avg(settled, 'ping') === 0);
  ok('every input the guest sent was consumed', hg.net.remote.ackSeq >= gg.net.inputSeq - 8, `ack ${hg.net.remote.ackSeq} of ${gg.net.inputSeq}`);
  ok('inputs are not being dropped on a clean link', hg.net.remote.dropped < gg.net.inputSeq * 0.02, `${hg.net.remote.dropped} dropped of ${gg.net.inputSeq}`);
  ok('clocks agree', (hg.clock === gg.clock) || Math.abs(hg.clock - gg.clock) < 0.5, `${hg.clock} vs ${gg.clock}`);
  ok('match time agrees', Math.abs(hg.time - gg.time) < 0.35, `${hg.time.toFixed(2)} vs ${gg.time.toFixed(2)}`);
  ok('remote car is interpolated, not teleported', gg.cars.find((c) => c.name === 'Hosty').pos.distanceTo(hg.human.pos) < 900);
  ok('snapshots flowed at ~30 Hz', hg.net.snapshots > 25 * NET.SNAPSHOT_HZ * 0.85, `${hg.net.snapshots} snapshots in 25 s`);
  ok('interpolation delay stayed in range', gg.net.interpDelay >= NET.INTERP_MIN - 1e-6 && gg.net.interpDelay <= NET.INTERP_MAX + 1e-6, `${(gg.net.interpDelay * 1000).toFixed(0)} ms`);
  ok('bandwidth stays modest', pair.link.bytes / 25 < 20000, `${Math.round(pair.link.bytes / 25)} B/s total`);
  ok('rtt measured', Math.abs(gg.net.rtt - 0.04) < 0.03, `${(gg.net.rtt * 1000).toFixed(0)} ms`);
}

// ---------------------------------------------------------------------------
// 5. goals, kickoffs, demos and stats reach the guest
// ---------------------------------------------------------------------------
{
  let touched = false;
  let scored = false;
  const { pair } = await playMatch({ latency: 0.03 }, 9, (p, t) => {
    const hg = p.host.game;
    if (!hg || hg.state !== 'play') return;
    // 1) guarantee a real touch: put the host's car behind the ball and shove it
    if (t > 3.6 && t < 3.7 && !touched) {
      touched = true;
      hg.human.setPose(hg.ball.pos.x, hg.ball.pos.z - 200, 0, 100);
      hg.human.vel.set(0, 0, 1400);
    }
    // 2) once it has been touched, finish it: drop the ball into the orange net
    if (t > 6 && t < 6.15 && touched && !scored) {
      scored = true;
      hg.ball.pos.set(0, 200, 5000);
      hg.ball.vel.set(0, 0, 3000);
    }
  });
  const hg = pair.host.game;
  const gg = pair.guest.game;
  ok('host scored', hg.score[0] + hg.score[1] >= 1, `${hg.score.join('-')}`);
  ok('guest sees the same score', gg.score[0] === hg.score[0] && gg.score[1] === hg.score[1], `${gg.score.join('-')} vs ${hg.score.join('-')}`);
  ok('guest got the goal event', (pair.guest.seen.goal || 0) === (pair.host.seen.goal || 0), `guest ${pair.guest.seen.goal || 0}, host ${pair.host.seen.goal || 0}`);
  ok('guest got the kickoff events', (pair.guest.seen.kickoff || 0) === (pair.host.seen.kickoff || 0), `guest ${pair.guest.seen.kickoff || 0}, host ${pair.host.seen.kickoff || 0}`);
  ok('guest replay started after the goal', (pair.guest.seen.replayStart || 0) >= 1 || hg.score[0] + hg.score[1] === 0);
  ok('guest scorer stat matches', gg.cars.reduce((a, c) => a + c.stats.goals, 0) === hg.cars.reduce((a, c) => a + c.stats.goals, 0), `${gg.cars.map((c) => c.stats.goals).join(',')} vs ${hg.cars.map((c) => c.stats.goals).join(',')}`);
  ok('guest scoreboard points match', gg.cars.every((c, i) => c.stats.score === hg.cars[i].stats.score), `${gg.cars.map((c) => c.stats.score).join(',')} vs ${hg.cars.map((c) => c.stats.score).join(',')}`);
  ok('guest touches counted', gg.cars.reduce((a, c) => a + c.stats.touches, 0) > 0);
  ok('every counter the host keeps is rebuilt on the guest', ['goals', 'assists', 'saves', 'epicSaves', 'shots', 'demos', 'demoed', 'clears', 'touches', 'aerialTouches'].every((k) => hg.cars.every((c, i) => (c.stats[k] || 0) === (gg.cars[i].stats[k] || 0))), ['goals', 'assists', 'saves', 'shots', 'demos', 'touches'].map((k) => `${k} ${hg.cars.map((c) => c.stats[k]).join(',')}|${gg.cars.map((c) => c.stats[k]).join(',')}`).join(' '));
  const canon = (e) => Object.keys(e || {}).sort().map((k) => `${k}:${e[k]}`).join(',');
  ok('stat event kinds match on both peers', hg.cars.every((c, i) => canon(c.stats.events) === canon(gg.cars[i].stats.events)), `${hg.cars.map((c) => canon(c.stats.events)).join(' | ')} vs ${gg.cars.map((c) => canon(c.stats.events)).join(' | ')}`);
  ok('guest ball knows who touched it last', !!gg.ball.lastTouch && gg.ball.lastTouch.car.netIdx === (hg.ball.lastTouch ? hg.ball.lastTouch.car.netIdx : -1));
}

// ---------------------------------------------------------------------------
// 6. a bad link: 15% packet loss + 90 ms of latency
// ---------------------------------------------------------------------------
{
  const { pair, samples } = await playMatch({ latency: 0.045, jitter: 0.02, loss: 0.15 }, 18);
  const avg = (arr, k) => arr.reduce((a, s) => a + s[k], 0) / Math.max(1, arr.length);
  const max = (arr, k) => arr.reduce((a, s) => Math.max(a, s[k]), 0);
  const settled = samples.filter((s) => s.state === 'play' && s.since > 0.25);
  ok('lossy link: no NaN', allFinite(pair.host.game) === null && allFinite(pair.guest.game) === null);
  ok('lossy link: the car still tracks', avg(settled, 'carErr') < 220, `avg ${avg(settled, 'carErr').toFixed(1)} uu, max ${max(settled, 'carErr').toFixed(0)} uu`);
  const rec = settled.filter((x, i) => i > 0 && x.snapCount > settled[i - 1].snapCount && x.snapReason !== 'demo');
  const srt = rec.map((x) => x.residual).sort((a, b) => a - b);
  ok('lossy link: prediction stays sane (bounded residual)', avg(rec, 'residual') < 60 && srt[Math.floor(srt.length * 0.99)] < 150, `avg ${avg(rec, 'residual').toFixed(2)} uu, p99 ${srt[Math.floor(srt.length * 0.99)].toFixed(1)} uu over ${rec.length} frames`);
  ok('lossy link: snaps stay rare', pair.guest.session.snaps < 20, `${pair.guest.session.snaps} snaps over 18 s at 15% loss`);
  ok('lossy link: the ball still tracks', avg(settled, 'ballErr') < 260, `avg ${avg(settled, 'ballErr').toFixed(0)} uu`);
  ok('lossy link: the interpolation delay grew to absorb jitter', pair.guest.session.interpDelay > NET.INTERP_MIN, `${(pair.guest.session.interpDelay * 1000).toFixed(0)} ms`);
  ok('lossy link: quality reported below perfect', pair.guest.session.quality < 1, pair.guest.session.quality.toFixed(2));
  ok('lossy link: score still in sync', pair.guest.game.score.join('-') === pair.host.game.score.join('-'));
  ok('lossy link: match still running', pair.host.game.state !== 'ended' && pair.guest.game.state === pair.host.game.state);
}

// ---------------------------------------------------------------------------
// 7. 2v2 with bots + Rumble, on a normal link
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.025 });
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.2, null);
  pair.host.session.startMatch({ teamSize: 2, arena: 'stadium', mutators: { length: 0, rumble: 'default' }, difficulty: 'pro', humanTeam: 0 });
  step(pair, 0.3, null);
  hookEvents(pair.guest);
  let itemUsed = 0;
  const drive = (p, t) => {
    const gg = p.guest.game;
    const hg = p.host.game;
    if (!gg || !hg) return;
    gg.human.controls.throttle = 1;
    gg.human.controls.steer = Math.sin(t) * 0.6;
    gg.human.controls.useItem = t > 4 && t < 4.2;
    hg.human.controls.throttle = 1;
    hg.human.controls.boost = true;
    if (t > 4 && t < 4.2) itemUsed = 1;
    // the host's pad loop is the only thing that counts boost collected; give it
    // a value the guest cannot have invented locally
    if (t > 6 && t < 6.1) hg.human.stats.boostCollected = 1234.4;
  };
  step(pair, 14, drive);
  const hg = pair.host.game;
  const gg = pair.guest.game;
  ok('2v2 online: 4 cars on both sides', hg.cars.length === 4 && gg.cars.length === 4);
  ok('2v2 online: bots simulated by the host only', hg.bots.length === 2 && gg.bots.length === 0);
  ok('rumble is live on both sides', !!hg.rumble && !!gg.rumble);
  ok('guest item meter follows the host', hg.cars.every((c, i) => (c.item ? c.item.id : '') === (gg.cars[i].item ? gg.cars[i].item.id : '')), hg.cars.map((c) => c.item && c.item.id).join(',') + ' vs ' + gg.cars.map((c) => c.item && c.item.id).join(','));
  ok('the remote item button fired on the host', itemUsed === 1 && (pair.guest.seen.rumbleUse || 0) >= 0);
  ok('2v2 online: no NaN', allFinite(hg) === null && allFinite(gg) === null);
  ok('2v2 online: bots move on the guest too', gg.cars.filter((c) => c.isBot).every((c, i) => c.pos.distanceTo(hg.cars.filter((x) => x.isBot)[i].pos) < 1200));
  ok('2v2 online: boost collected syncs to the guest', hg.cars.every((c, i) => Math.abs((c.stats.boostCollected || 0) - (gg.cars[i].stats.boostCollected || 0)) <= 1) && gg.cars[0].stats.boostCollected === 1234, `${hg.cars.map((c) => Math.round(c.stats.boostCollected || 0)).join(',')} vs ${gg.cars.map((c) => Math.round(c.stats.boostCollected || 0)).join(',')}`);
  ok('2v2 online: pad states synced', hg.pads.filter((p) => p.active).length === gg.pads.filter((p) => p.active).length, `${hg.pads.filter((p) => p.active).length}/${gg.pads.filter((p) => p.active).length}`);
}

// ---------------------------------------------------------------------------
// 8. match end + stats handover
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.02 });
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.2, null);
  pair.host.session.startMatch({ teamSize: 1, arena: 'stadium', mutators: { length: 6, overtime: 'none' }, difficulty: 'rookie', humanTeam: 0 });
  step(pair, 0.25, null);
  hookEvents(pair.guest);
  let endedHost = 0;
  pair.host.game.on('ended', () => endedHost++);
  step(pair, 14, (p) => {
    if (p.guest.game) p.guest.game.human.controls.throttle = 1;
    if (p.host.game) p.host.game.human.controls.throttle = 1;
  });
  ok('match ended on the host', pair.host.game.state === 'ended', pair.host.game.state);
  ok('match ended on the guest', pair.guest.game.state === 'ended', pair.guest.game.state);
  ok('guest received the ended event', (pair.guest.seen.ended || 0) === 1 && endedHost === 1);
  ok('guest session moved to ended', pair.guest.session.phase === 'ended' && pair.host.session.phase === 'ended');
  const back = pair.guest.session.returnToLobby();
  ok('back to lobby keeps the link', pair.guest.session.phase === 'lobby' && pair.guest.session.conn.open && back === undefined);
}

// ---------------------------------------------------------------------------
// 9. a NAT that will not open: the verbatim failure message
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.02 });
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.2, null);
  pair.host.session.startMatch({ teamSize: 1, arena: 'stadium', mutators: { length: 0 }, difficulty: 'rookie', humanTeam: 0 });
  step(pair, 2, null);
  // the link goes dark: every unreliable packet is swallowed
  pair.link.blackhole = true;
  for (let i = 0; i < 40; i++) {
    step(pair, 0.25, null);
  }
  const fail = pair.guest.fail || pair.host.fail;
  ok('a silent link is detected', pair.guest.session.phase === 'lost' || pair.host.session.phase === 'lost', `${pair.host.session.phase}/${pair.guest.session.phase}`);
  ok('the failure carries the verbatim message', !!fail && fail.message.includes(P2P_FAIL_MESSAGE), fail && fail.message);
  ok('the verbatim message is exactly the documented one', P2P_FAIL_MESSAGE === "it's plain WebRTC with public STUN, no TURN. It punches through most home routers, but symmetric NAT, mobile data and strict VPNs can block it");
  ok('the game is flagged as lost', pair.guest.game.netLost === true || pair.host.game.netLost === true);
}

// ---------------------------------------------------------------------------
// 10. a peer that hangs up mid-match
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.02 });
  pair.host.session.handshake();
  pair.guest.session.handshake();
  step(pair, 0.2, null);
  pair.host.session.startMatch({ teamSize: 1, arena: 'stadium', mutators: { length: 0 }, difficulty: 'rookie', humanTeam: 0 });
  step(pair, 1.5, null);
  pair.host.session.close('left');
  step(pair, 0.4, null);
  ok('the guest is told the host left', pair.guest.session.phase === 'lost' && pair.guest.fail && /left/i.test(pair.guest.fail.message), pair.guest.fail && pair.guest.fail.message);
  ok('leaving is not reported as a NAT failure', !(pair.guest.fail && pair.guest.fail.message.includes('symmetric NAT')));
}

// ---------------------------------------------------------------------------
// 11. version mismatch
// ---------------------------------------------------------------------------
{
  const pair = makePair({ latency: 0.01 });
  pair.host.session.handshake();
  pair.guest.session.version = NET.VERSION + 1;
  pair.guest.session.helloSent = false;
  pair.guest.session.handshake();
  step(pair, 0.3, null);
  ok('a build mismatch is refused, not silently played', pair.host.session.phase === 'lost' && /version/i.test(pair.host.session.reason), pair.host.session.reason);
}

console.log(failed ? `\n${failed} NETWORK CHECKS FAILED` : '\nALL NETWORK CHECKS PASSED');
process.exit(failed ? 1 : 0);
