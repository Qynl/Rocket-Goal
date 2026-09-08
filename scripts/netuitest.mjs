// ---------------------------------------------------------------------------
// Online play, driven through the real React screens.
//
// nettest.mjs proves the protocol/prediction/reconciliation with a stubbed
// connection; this test proves the other half: that the *UI wiring* works. Two
// real Engines, two real React roots, two real P2PConnections and NetSessions —
// only the browser's WebRTC implementation is faked (Node has none), with a
// switchboard that pairs the peers by their SDP ice-ufrag exactly like a real
// signalling path would.
//
// It clicks "Host a match", copies the invite code out of the DOM, pastes it
// into the other browser's paste box, copies the reply back, and checks that
// both peers land in the lobby and start the same match. Then it repeats the
// whole thing with the network blocking ICE and checks the failure message the
// user was promised, verbatim, on both screens.
// ---------------------------------------------------------------------------
import { register } from 'node:module';
register('./jsx.hooks.mjs', import.meta.url);
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
globalThis.document = w.document;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.HTMLElement = w.HTMLElement;
globalThis.HTMLCanvasElement = w.HTMLCanvasElement;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.confirm = () => true;
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d')
    return new Proxy({}, {
      get: (t, k) =>
        k === 'measureText' ? () => ({ width: 10 })
        : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4 * 1024 * 1024) })
        : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} })
        : k === 'canvas' ? null
        : () => {},
      set: () => true,
    });
  return null; // no WebGL in jsdom: the Renderer gets an injected stub instead
};

// ---------------------------------------------------------------------------
// fake WebRTC
// ---------------------------------------------------------------------------
const SWITCH = {
  mode: 'ok', // 'ok' | 'blocked' (a symmetric NAT with no TURN to fall back on)
  linkMs: 3, // channel latency
  byUfrag: new Map(),
  reset() { this.byUfrag.clear(); },
  paired(pc) {
    const other = pc._peer;
    if (!other || pc._linkTried) return;
    if (!pc.localDescription || !pc.remoteDescription || !other.localDescription || !other.remoteDescription) return;
    pc._linkTried = other._linkTried = true;
    if (this.mode === 'blocked') {
      setTimeout(() => { ice(pc, 'failed'); ice(other, 'failed'); }, 120);
      return;
    }
    setTimeout(() => {
      ice(pc, 'checking');
      ice(other, 'checking');
      setTimeout(() => connect(pc, other), 15);
    }, 8);
  },
};

function ice(pc, state) {
  if (pc.closed) return;
  pc.iceConnectionState = state;
  pc.connectionState = state === 'failed' ? 'failed' : state === 'connected' ? 'connected' : 'connecting';
  pc._fire('iceconnectionstatechange', {});
  pc._fire('connectionstatechange', {});
}

/** Mirror the offerer's data channels onto the answerer, then open everything. */
function connect(a, b) {
  if (a.closed || b.closed) return;
  for (const ch of a._channels) {
    if (ch.mirror) continue;
    const mirror = new FakeChannel(b, ch.label, ch.opts);
    ch.mirror = mirror;
    mirror.mirror = ch;
    b._channels.push(mirror);
    b._fire('datachannel', { channel: mirror });
  }
  ice(a, 'connected');
  ice(b, 'connected');
  setTimeout(() => {
    for (const pc of [a, b]) for (const ch of pc._channels) if (ch.readyState !== 'closed') { ch.readyState = 'open'; ch._fire('open', {}); }
  }, 6);
}

class FakeTarget {
  constructor() { this._l = new Map(); }
  addEventListener(type, fn) { if (!this._l.has(type)) this._l.set(type, new Set()); this._l.get(type).add(fn); }
  removeEventListener(type, fn) { const s = this._l.get(type); if (s) s.delete(fn); }
  _fire(type, ev) {
    const on = this['on' + type];
    if (typeof on === 'function') on.call(this, ev);
    const s = this._l.get(type);
    if (s) for (const fn of [...s]) fn.call(this, ev);
  }
}

class FakeChannel extends FakeTarget {
  constructor(pc, label, opts = {}) {
    super();
    this.pc = pc;
    this.label = label;
    this.opts = opts;
    this.readyState = 'connecting';
    this.binaryType = 'arraybuffer';
    this.bufferedAmount = 0;
    this.mirror = null;
    this.sent = 0;
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('InvalidStateError: channel not open');
    this.sent++;
    const m = this.mirror;
    if (!m) return;
    setTimeout(() => { if (m.readyState === 'open' && !this.pc.closed && !m.pc.closed) m._fire('message', { data }); }, SWITCH.linkMs);
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this._fire('close', {});
  }
}

let seq = 0;
class FakePC extends FakeTarget {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.iceGatheringState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
    this.remoteDescription = null;
    this._channels = [];
    this._peer = null;
    this._linkTried = false;
    this.closed = false;
    const n = ++seq;
    this._ufrag = 'uf' + n.toString(16) + Math.floor(Math.random() * 4096).toString(16);
    this._pwd = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
    this._fp = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
    this._port = 50000 + n;
    SWITCH.byUfrag.set(this._ufrag, this);
  }
  /** A plausible Chrome data-only SDP — the real trim/untrim codec runs on it. */
  sdp(setup) {
    return [
      'v=0',
      `o=- 461173140043005${seq} 2 IN IP4 127.0.0.1`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=extmap-allow-mixed',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      `a=ice-ufrag:${this._ufrag}`,
      `a=ice-pwd:${this._pwd}`,
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${this._fp}`,
      `a=setup:${setup}`,
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
      `a=candidate:123456789${seq} 1 udp 2122260223 192.168.1.23 ${this._port} typ host generation 0 network-id 1 network-cost 10`,
      `a=candidate:987654321${seq} 1 udp 1686052607 203.0.113.${7 + seq} ${this._port + 1} typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1`,
    ].join('\r\n') + '\r\n';
  }
  createDataChannel(label, opts) {
    const ch = new FakeChannel(this, label, opts || {});
    this._channels.push(ch);
    return ch;
  }
  async createOffer() { return { type: 'offer', sdp: this.sdp('actpass') }; }
  async createAnswer() { return { type: 'answer', sdp: this.sdp('active') }; }
  async setLocalDescription(desc) {
    if (this.closed) throw new Error('closed');
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    this.iceGatheringState = 'gathering';
    this._fire('icegatheringstatechange', {});
    setTimeout(() => {
      if (this.closed) return;
      this.iceGatheringState = 'complete';
      this._fire('icegatheringstatechange', {});
      SWITCH.paired(this);
    }, 5);
  }
  async setRemoteDescription(desc) {
    if (this.closed) throw new Error('closed');
    if (!desc || typeof desc.sdp !== 'string' || !desc.sdp.includes('v=0')) throw new Error('InvalidAccessError: not an SDP');
    this.remoteDescription = desc;
    this.signalingState = 'stable';
    const m = /a=ice-ufrag:(\S+)/.exec(desc.sdp);
    const other = m ? SWITCH.byUfrag.get(m[1]) : null;
    if (other && other !== this && !other.closed) { this._peer = other; other._peer = this; }
    SWITCH.paired(this);
  }
  async addIceCandidate() { return undefined; }
  getStats() { return Promise.resolve(new Map()); }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const ch of this._channels) ch.close();
    SWITCH.byUfrag.delete(this._ufrag);
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
    this._fire('iceconnectionstatechange', {});
    this._fire('connectionstatechange', {});
  }
}
globalThis.RTCPeerConnection = FakePC;
w.RTCPeerConnection = FakePC;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const notes = [];
async function check(name, fn) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL ' + name + ' — ' + (e && e.message ? e.message : String(e)));
    if (process.env.NETUI_DEBUG) console.log(e.stack);
  }
}

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { Menus } = await import('../src/ui/Menus.jsx');
const { Engine } = await import('../src/engine.js');
const { HudStore } = await import('../src/ui/hudStore.js');
const { P2P_FAIL_MESSAGE, ICE_SERVERS } = await import('../src/net/connection.js');

const GL_STUB = () => ({ shadowMap: {}, frames: 0, setPixelRatio() {}, setSize() {}, render() { this.frames++; }, dispose() {} });

/** One "browser": a real Engine + a real React root in its own DOM subtree. */
function makePeer(id, name) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  document.body.appendChild(canvas);
  const engine = new Engine(canvas, new HudStore(), GL_STUB());
  engine.settings.playerName = name;
  engine.settings.loadout = { ...engine.settings.loadout, primary: name === 'Hosty' ? 0x2255cc : 0xcc7722 };
  const api = { id, name, engine, el, canvas, overlay: null, uis: [], feeds: [], root: createRoot(el) };
  const addFeed = engine.hud.addFeed.bind(engine.hud);
  engine.hud.addFeed = (html, sec) => { api.feeds.push(String(html)); return addFeed(html, sec); };
  engine.onUi = (p) => { api.uis.push(p); show(api, p.type === 'hide' ? null : p); };
  show(api, { type: 'menu' });
  return api;
}
function show(api, overlay) {
  api.overlay = overlay;
  api.root.render(
    React.createElement(Menus, {
      engine: api.engine,
      overlay,
      nav: (p) => show(api, p.type === 'hide' ? null : p),
    })
  );
}

// DOM helpers ---------------------------------------------------------------
const all = (api, sel) => Array.from(api.el.querySelectorAll(sel));
const text = (api) => api.el.textContent.replace(/\s+/g, ' ');
const outCode = (api) => { const t = all(api, 'textarea.net-code').find((x) => x.readOnly); return t ? t.value : ''; };
const setValue = (el, value) => {
  const desc = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value');
  desc.set.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const pasteInto = async (api, value) => {
  const box = all(api, 'textarea.net-code').find((t) => !t.readOnly);
  if (!box) throw new Error('no paste box on ' + api.id);
  setValue(box, value);
  await sleep(40);
  if (box.value !== value) throw new Error('paste did not reach React state on ' + api.id);
};
const clickCard = async (api, title) => {
  const card = all(api, '.card').find((c) => c.textContent.includes(title));
  if (!card) throw new Error(`no card "${title}" on ${api.id} (cards: ${all(api, '.card').map((c) => c.textContent.slice(0, 20)).join(' | ')})`);
  card.click();
  await sleep(40);
};
const waitDom = (api, sel, ms = 4000) => waitUntil(() => api.el.querySelector(sel), ms, `${sel} on ${api.id}`);
const clickButton = async (api, label) => {
  // overlay state is set synchronously by engine.onUi but React flushes the
  // render on a later task, so give the button a moment to appear
  await waitUntil(() => all(api, 'button').some((b) => b.textContent.trim() === label && !b.disabled), 4000, `"${label}" on ${api.id}`).catch(() => {});
  const btn = all(api, 'button').find((b) => b.textContent.trim() === label);
  if (!btn) throw new Error(`no button "${label}" on ${api.id} (buttons: ${all(api, 'button').map((b) => b.textContent.trim()).join(' | ')})`);
  if (btn.disabled) throw new Error(`button "${label}" is disabled on ${api.id}`);
  btn.click();
  await sleep(50);
};
const clickSeg = async (api, label) => {
  const b = all(api, '.seg button').find((x) => x.textContent.trim().startsWith(label));
  if (!b) throw new Error(`no segment "${label}" on ${api.id}`);
  b.click();
  await sleep(40);
};
async function waitUntil(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(25);
  }
}

/** Runs the whole copy-a-code-by-hand handshake through the two UIs. */
async function handshake(H, G) {
  await clickCard(H, 'Host a match');
  await waitUntil(() => outCode(H).length > 60, 9000, 'the invite code');
  const invite = outCode(H);
  await clickCard(G, 'Join a match');
  await pasteInto(G, invite);
  await clickButton(G, 'Read invite');
  await waitUntil(() => outCode(G).length > 60, 9000, 'the reply code');
  const reply = outCode(G);
  await pasteInto(H, reply);
  await clickButton(H, 'Connect');
  return { invite, reply };
}

// ---------------------------------------------------------------------------
// 1. happy path
// ---------------------------------------------------------------------------
console.log('\n— online play through the real UI (fake WebRTC, real everything else) —');
const H = makePeer('peer-host', 'Hosty');
const G = makePeer('peer-guest', 'Guesty');
await sleep(60);

let codes = null;
await check('main menu offers online play', async () => {
  if (!text(H).includes('Play online')) throw new Error('no "Play online" card');
  if (!text(H).includes('no account, no server')) throw new Error('the card does not explain the peer-to-peer model');
});

await check('multiplayer screen explains the model before any code', async () => {
  await clickCard(H, 'Play online');
  if (!text(H).includes('Play online')) throw new Error('screen did not open');
  if (!text(H).includes('no server and no account')) throw new Error('missing the no-server explanation');
  const stunLine = all(H, 'p').map((p) => p.textContent).find((t) => t.includes('STUN:'));
  if (!stunLine) throw new Error('the STUN servers are not listed');
  for (const s of ICE_SERVERS) if (!stunLine.includes(s.urls)) throw new Error(`missing ${s.urls} in the UI`);
  if (/turn:/i.test(stunLine)) throw new Error('a TURN server leaked into the UI');
  if (!stunLine.includes('no TURN')) throw new Error('does not say there is no TURN');
  await clickCard(G, 'Play online');
});

await check('host + guest swap codes through the textareas', async () => {
  codes = await handshake(H, G);
  if (/\s/.test(codes.invite)) throw new Error('invite code contains whitespace');
  if (/\s/.test(codes.reply)) throw new Error('reply code contains whitespace');
  notes.push(`invite ${codes.invite.length} chars, reply ${codes.reply.length} chars`);
  if (codes.invite.length < 200 || codes.reply.length < 200) throw new Error('codes look truncated');
});

await check('both peers reach the lobby and see each other', async () => {
  await waitUntil(() => H.engine.net && H.engine.net.phase === 'lobby', 9000, 'host lobby');
  await waitUntil(() => G.engine.net && G.engine.net.phase === 'lobby', 9000, 'guest lobby');
  await waitUntil(() => text(H).includes('Start match'), 4000, 'host start button');
  if (!text(H).includes('Guesty')) throw new Error('host does not see the guest name');
  if (!text(G).includes('Hosty')) throw new Error('guest does not see the host name');
  if (!text(G).includes('Waiting for the host')) throw new Error('guest lobby has no waiting state');
  if (all(G, 'button').some((b) => b.textContent.trim() === 'Start match')) throw new Error('the guest can start the match — only the host may');
  const link = H.engine.net.conn;
  if (link.state !== 'connected') throw new Error('host connection state: ' + link.state);
  if (!link.open) throw new Error('host game channel is not open');
  if (!link.control || link.control.readyState !== 'open') throw new Error('host control channel is not open');
  notes.push(`channels: ${link.game.label} (ordered=${link.game.opts.ordered}) + ${link.control.label}`);
});

await check('the lobby edits the rules and shows them', async () => {
  await clickSeg(H, '2v2');
  if (!text(H).includes('2v2')) throw new Error('team size did not stick');
  await clickSeg(H, 'Orange');
  if (H.engine.settings.humanTeam !== 1) throw new Error('side did not stick');
  if (H.engine.settings.netTeamSize !== 2) throw new Error('netTeamSize is ' + H.engine.settings.netTeamSize);
});

let started = null;
await check('host starts the match on both browsers', async () => {
  await clickButton(H, 'Start match');
  await waitUntil(() => H.engine.game && G.engine.game, 9000, 'both games');
  started = { host: H.engine.config, guest: G.engine.config };
  for (const [who, cfg] of Object.entries(started)) {
    if (cfg.mode !== 'match') throw new Error(`${who} started ${cfg.mode}, not a match`);
    if (!cfg.net || cfg.net.online !== true) throw new Error(`${who} config is not marked online`);
    if (cfg.teamSize !== 2) throw new Error(`${who} teamSize ${cfg.teamSize}, expected the 2v2 the host picked`);
  }
  if (started.host.net.role !== 'host' || started.guest.net.role !== 'guest') throw new Error('roles are wrong');
  if (started.host.net.seat === started.guest.net.seat) throw new Error('both peers got the same seat');
  if (H.engine.game.human.name !== 'Hosty') throw new Error('host human is ' + H.engine.game.human.name);
  if (G.engine.game.human.name !== 'Guesty') throw new Error('guest human is ' + G.engine.game.human.name);
  if (H.engine.game.human.team === G.engine.game.human.team) throw new Error('both humans are on the same team');
  if (started.guest.arena !== started.host.arena) throw new Error('guest plays a different arena');
  if (H.engine.uiOpen || G.engine.uiOpen) throw new Error('a menu is still covering the match');
  if (!H.engine.input.enabled || !G.engine.input.enabled) throw new Error('input is not live');
  const feed = H.feeds.join(' ');
  if (!feed.includes('Online 2v2')) throw new Error('no online HUD feed: ' + feed.slice(0, 160));
  if (!feed.includes('hosting')) throw new Error('the feed does not say who is hosting: ' + feed.slice(0, 160));
  if (!feed.includes('Guesty')) throw new Error('the HUD feed does not name the opponent');
  if (!G.feeds.join(' ').includes('joined')) throw new Error('the guest feed does not say it joined: ' + G.feeds.join(' ').slice(0, 160));
});

await check('the match actually syncs over the link', async () => {
  const t0 = Date.now();
  // give the two engines a moment of real frames: host simulates, guest follows
  H.engine.game.human.controls.throttle = 1;
  G.engine.game.human.controls.throttle = 1;
  await waitUntil(() => H.engine.renderer.renderer.frames > 10 && G.engine.renderer.renderer.frames > 10, 9000, 'frames on both peers');
  await sleep(900);
  const hb = H.engine.game.ball.pos;
  const gb = G.engine.game.ball.pos;
  const d = Math.hypot(hb.x - gb.x, hb.y - gb.y, hb.z - gb.z);
  notes.push(`after ${Date.now() - t0} ms: ball delta ${d.toFixed(1)} uu, host frames ${H.engine.renderer.renderer.frames}`);
  if (!(d < 900)) throw new Error(`guest ball is ${d.toFixed(0)} uu from the host's — snapshots are not arriving`);
  const sent = H.engine.net.conn.stats.sent + G.engine.net.conn.stats.sent;
  if (sent < 1000) throw new Error('barely any snapshot bytes went over the wire: ' + sent);
  notes.push(`${sent} bytes of unreliable frames exchanged`);
});

await check('leaving closes the link and returns to the menu', async () => {
  H.engine.netLeave();
  G.engine.netLeave();
  await sleep(80);
  if (H.engine.net || G.engine.net) throw new Error('a session survived netLeave');
  if (!H.overlay || H.overlay.type !== 'menu') throw new Error('host overlay: ' + JSON.stringify(H.overlay));
  if (H.engine.game || G.engine.game) throw new Error('a game survived netLeave');
  if (H.engine.running || G.engine.running) throw new Error('an engine is still running');
});

await check('the screen survives a settings object without mutators', async () => {
  // regression: defaultMutators() was called but not imported, so any profile
  // missing `mutators` crashed the whole screen with a ReferenceError
  const P = makePeer('peer-bare', 'Bare');
  delete P.engine.settings.mutators;
  delete P.engine.settings.netTeamSize;
  await sleep(30);
  await clickCard(P, 'Play online');
  if (!text(P).includes('Host a match')) throw new Error('the screen did not render: ' + text(P).slice(0, 120));
  if (typeof P.engine.settings.mutators !== 'object') throw new Error('mutators were not defaulted');
  if (P.engine.settings.netTeamSize !== 1) throw new Error('netTeamSize was not defaulted');
  P.engine.netClose();
});

// ---------------------------------------------------------------------------
// 2. the failure the user asked to be told about, verbatim
// ---------------------------------------------------------------------------
console.log('\n— blocked network (symmetric NAT, no TURN) —');
SWITCH.mode = 'blocked';
SWITCH.reset();
const BH = makePeer('peer-blocked-host', 'BlockedHost');
const BG = makePeer('peer-blocked-guest', 'BlockedGuest');
await sleep(60);

await check('the handshake runs and then ICE fails on both sides', async () => {
  await clickCard(BH, 'Play online');
  await clickCard(BG, 'Play online');
  await handshake(BH, BG);
  await waitUntil(() => BH.overlay && BH.overlay.type === 'netError', 12000, 'host netError screen');
  await waitUntil(() => BG.overlay && BG.overlay.type === 'netError', 12000, 'guest netError screen');
});

await check('the promised message is shown verbatim, on both screens', async () => {
  for (const api of [BH, BG]) await waitDom(api, '.net-status.bad');
  for (const api of [BH, BG]) {
    const bad = api.el.querySelector('.net-status.bad');
    if (!bad) throw new Error(`${api.id}: no failure banner`);
    if (!bad.textContent.includes(P2P_FAIL_MESSAGE)) {
      throw new Error(`${api.id}: banner text is "${bad.textContent.trim().slice(0, 140)}" — must contain the message verbatim`);
    }
    const h2 = api.el.querySelector('h2');
    if (!h2 || !/connect/i.test(h2.textContent)) throw new Error(`${api.id}: heading is "${h2 && h2.textContent}"`);
    // verbatim means verbatim: no smart quotes, no ellipsis, no rewording
    if (!/it's plain WebRTC with public STUN, no TURN\. It punches through most home routers, but symmetric NAT, mobile data and strict VPNs can block it/.test(bad.textContent))
      throw new Error(`${api.id}: the message was altered`);
    for (const why of ['mobile data', 'strict VPN', 'symmetric NAT']) if (!api.el.textContent.includes(why)) throw new Error(`${api.id}: does not explain ${why}`);
  }
  notes.push(`failure code: ${BH.overlay.code} / ${BG.overlay.code}`);
});

await check('the failure screen offers a way out', async () => {
  await clickButton(BG, 'Try again');
  await sleep(60);
  if (!BG.overlay || BG.overlay.type !== 'multiplayer') throw new Error('try again did not reopen the multiplayer screen: ' + JSON.stringify(BG.overlay));
  await clickButton(BH, 'Main menu');
  await sleep(60);
  if (!BH.overlay || BH.overlay.type !== 'menu') throw new Error('main menu button did not work');
  if (BH.engine.net) throw new Error('the dead session was kept alive');
});

await check('a mid-match drop says "Connection lost" and keeps the message', async () => {
  SWITCH.mode = 'ok';
  SWITCH.reset();
  const MH = makePeer('peer-drop-host', 'DropHost');
  const MG = makePeer('peer-drop-guest', 'DropGuest');
  await sleep(50);
  await clickCard(MH, 'Play online');
  await clickCard(MG, 'Play online');
  await handshake(MH, MG);
  await waitUntil(() => MH.engine.net.phase === 'lobby', 9000, 'the lobby');
  await clickButton(MH, 'Start match');
  await waitUntil(() => MH.engine.game && MG.engine.game, 12000, 'the match to start');
  // pull the plug: the guest's network dies while the match is running
  SWITCH.mode = 'blocked';
  const pc = MG.engine.net.conn.pc;
  pc._peer = MH.engine.net.conn.pc;
  ice(pc, 'disconnected');
  await waitUntil(() => MH.overlay && MH.overlay.type === 'netError', 12000, 'host to notice the drop');
  if (!MH.overlay.wasPlaying) throw new Error('host was not told the match was in progress');
  await waitDom(MH, '.net-status.bad');
  const h2 = MH.el.querySelector('h2');
  if (!h2 || !/lost/i.test(h2.textContent)) throw new Error('heading is "' + (h2 && h2.textContent) + '", expected "Connection lost"');
  if (!MH.el.querySelector('.net-status.bad').textContent.includes(P2P_FAIL_MESSAGE)) throw new Error('the verbatim message is missing after a drop');
  if (MH.engine.running) throw new Error('the match kept running after the link died');
  if (!MH.engine.game || !MH.engine.game.paused) throw new Error('the match was not paused');
  MH.engine.netLeave();
  MG.engine.netLeave();
});

console.log('\n' + notes.map((n) => '  · ' + n).join('\n'));
console.log(failures ? `\n${failures} ONLINE-UI CHECK(S) FAILED` : '\nALL ONLINE-UI CHECKS PASSED');
process.exit(failures ? 1 : 0);
