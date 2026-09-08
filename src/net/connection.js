// ---------------------------------------------------------------------------
// The peer connection itself.
//
// Plain WebRTC + public STUN. No TURN server, no signalling server, no account:
// the two browsers are wired together by hand with the codes from sdp.js and
// then talk over two data channels:
//
//   "rg-game"    unreliable + unordered — inputs and world snapshots
//   "rg-control" reliable  + ordered   — handshake, match config, events, chat
//
// Everything the UI needs to know is reported through `onState`.
// ---------------------------------------------------------------------------
import { decodeSdpCode, encodeSdpCode } from './sdp.js';

/** Public STUN servers. Deliberately no TURN: relay credentials would need a
 *  server, and this game does not have one. */
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * Shown verbatim in the UI whenever a peer-to-peer connection cannot be made
 * (ICE failure, timeout, or a channel that never opens).
 */
export const P2P_FAIL_MESSAGE =
  "it's plain WebRTC with public STUN, no TURN. It punches through most home routers, but symmetric NAT, mobile data and strict VPNs can block it";

export const CONNECTION_STATES = ['idle', 'signaling', 'connecting', 'connected', 'failed', 'closed'];

const GAME_CHANNEL = 'rg-game';
const CONTROL_CHANNEL = 'rg-control';
const ICE_GATHER_TIMEOUT = 4000;
const CONNECT_TIMEOUT = 25000;
const DISCONNECT_GRACE = 4000;

export class P2PConnection {
  /**
   * @param {object} opts
   * @param {'host'|'guest'} opts.role
   * @param {(state:object)=>void} [opts.onState]  {state, detail, message, code}
   */
  constructor(opts = {}) {
    this.role = opts.role === 'guest' ? 'guest' : 'host';
    this.onState = opts.onState || (() => {});
    this.onBinary = opts.onBinary || (() => {});
    this.onJson = opts.onJson || (() => {});
    this.pc = null;
    this.game = null;
    this.control = null;
    this.state = 'idle';
    this.detail = '';
    this.closed = false;
    this.timers = [];
    this.stats = { sent: 0, received: 0, reliableSent: 0 };
  }

  // -- state reporting ------------------------------------------------------
  set(state, detail = '', extra = {}) {
    if (this.closed && state !== 'closed') return;
    this.state = state;
    this.detail = detail;
    this.onState({ state, detail, role: this.role, ...extra });
  }

  fail(detail, extra = {}) {
    if (this.state === 'failed' || this.state === 'closed') return;
    this.set('failed', detail, { message: `${P2P_FAIL_MESSAGE}`, code: detail, ...extra });
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
    return id;
  }

  // -- channels -------------------------------------------------------------
  makeChannels() {
    const game = this.pc.createDataChannel(GAME_CHANNEL, { ordered: false, maxRetransmits: 0 });
    const control = this.pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
    this.wire(game, false);
    this.wire(control, true);
    this.game = game;
    this.control = control;
  }

  wire(channel, reliable) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (reliable) this.control = channel;
      else this.game = channel;
      this.maybeConnected();
    };
    channel.onclose = () => {
      if (!this.closed && this.state === 'connected') this.fail('channel-closed', { reason: 'The connection was closed by the other side.' });
    };
    channel.onerror = () => {
      /* the state handlers report this */
    };
    channel.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          this.onJson(JSON.parse(ev.data));
        } catch (e) {
          /* ignore malformed control messages */
        }
      } else {
        this.stats.received += ev.data.byteLength || 0;
        this.onBinary(new Uint8Array(ev.data));
      }
    };
  }

  maybeConnected() {
    const ready = (c) => c && (c.readyState === 'open' || c.readyState === 'connecting');
    if (this.state === 'connected') return;
    // both channels open => the SCTP association is up and DTLS is done
    if (this.game && this.control && this.game.readyState === 'open' && this.control.readyState === 'open') {
      for (const t of this.timers.splice(0)) clearTimeout(t);
      this.set('connected', 'Peer-to-peer link established');
    } else if (ready(this.game) || ready(this.control)) {
      this.set('connecting', 'Negotiating the peer-to-peer link…');
    }
  }

  makePc() {
    const RTCPeer = typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : null;
    if (!RTCPeer) {
      this.fail('no-webrtc', { reason: 'This browser has no WebRTC support.' });
      return null;
    }
    const pc = new RTCPeer({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 2 });
    this.pc = pc;
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') this.maybeConnected();
      else if (s === 'disconnected') {
        if (this.state === 'connected') this.set('connecting', 'Connection interrupted — trying to recover…');
        this.later(() => {
          if (!this.closed && this.state !== 'connected' && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
            this.fail('ice-disconnected');
          }
        }, DISCONNECT_GRACE);
      } else if (s === 'failed') this.fail('ice-failed');
      else if (s === 'closed') this.close();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed') this.fail('connection-failed');
      else if (s === 'closed') this.close();
      else if (s === 'connected') this.maybeConnected();
    };
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      this.wire(ch, ch.label === CONTROL_CHANNEL);
      if (ch.label === CONTROL_CHANNEL) this.control = ch;
      else this.game = ch;
      this.maybeConnected();
    };
    return pc;
  }

  // -- signalling -----------------------------------------------------------
  /** Host side: build the offer and return the code to hand to your friend. */
  async createInvite() {
    if (!this.makePc()) return null;
    this.set('signaling', 'Creating the room…');
    this.makeChannels();
    const offer = await this.pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await this.pc.setLocalDescription(offer);
    await waitForGathering(this.pc, ICE_GATHER_TIMEOUT);
    const desc = this.pc.localDescription;
    if (!desc) {
      this.fail('no-offer');
      return null;
    }
    const code = await encodeSdpCode(desc.sdp);
    this.set('signaling', 'Waiting for your friend to paste their reply code');
    // nothing will happen until the reply is pasted; do not time out here
    return code;
  }

  /**
   * Guest side: accept the host's invite code and produce the reply code.
   * @returns {Promise<string|null>}
   */
  async acceptInvite(code) {
    const sdp = await decodeSdpCode(code);
    if (!sdp) return { error: 'That code is not a Rocket Goal invite. Ask your friend to copy the whole thing.' };
    if (!this.makePc()) return { error: 'WebRTC is unavailable in this browser.' };
    this.set('connecting', 'Reading the invite…');
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
    } catch (e) {
      this.fail('bad-invite', { reason: 'That invite code was rejected by WebRTC.' });
      return { error: 'That invite code was rejected by WebRTC (it may be truncated or from another version).' };
    }
    this.armConnectTimeout();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForGathering(this.pc, ICE_GATHER_TIMEOUT);
    const desc = this.pc.localDescription;
    if (!desc) {
      this.fail('no-answer');
      return { error: 'Could not create an answer.' };
    }
    const reply = await encodeSdpCode(desc.sdp);
    this.set('connecting', 'Waiting for the host to accept your reply…');
    return { reply };
  }

  /** Host side: accept the guest's reply code and finish the handshake. */
  async acceptReply(code) {
    if (!this.pc) return { error: 'Create the room first.' };
    const sdp = await decodeSdpCode(code);
    if (!sdp) return { error: 'That code is not a reply. Ask your friend to copy the whole reply code.' };
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (e) {
      this.fail('bad-reply', { reason: 'That reply code was rejected by WebRTC.' });
      return { error: 'That reply code was rejected by WebRTC (it may be truncated, or pasted twice).' };
    }
    this.armConnectTimeout();
    this.set('connecting', 'Punching through to your friend…');
    return {};
  }

  armConnectTimeout() {
    this.later(() => {
      if (!this.closed && this.state !== 'connected') this.fail('timeout');
    }, CONNECT_TIMEOUT);
  }

  // -- data -----------------------------------------------------------------
  get open() {
    return this.state === 'connected' && this.game && this.game.readyState === 'open';
  }

  /** Unreliable frame (inputs / snapshots). Silently dropped when not ready. */
  send(data) {
    const ch = this.game;
    if (!ch || ch.readyState !== 'open') return false;
    try {
      ch.send(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      this.stats.sent += data.byteLength || 0;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Reliable JSON (handshake, events, chat). Queued by the browser. */
  sendJson(obj) {
    const ch = this.control;
    if (!ch || ch.readyState !== 'open') return false;
    try {
      const s = JSON.stringify(obj);
      ch.send(s);
      this.stats.reliableSent += s.length;
      return true;
    } catch (e) {
      return false;
    }
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers.splice(0)) clearTimeout(t);
    try {
      if (this.control && this.control.readyState === 'open') this.control.close();
      if (this.game && this.game.readyState === 'open') this.game.close();
      if (this.pc) this.pc.close();
    } catch (e) {
      /* already gone */
    }
    this.game = null;
    this.control = null;
    this.pc = null;
    this.set('closed', reason);
  }
}

/** Resolve when ICE gathering finished (or after `timeout` ms — the offer is
 *  still usable, we just may have missed a slow relay-less candidate). */
export function waitForGathering(pc, timeout = 3000) {
  return new Promise((resolve) => {
    if (!pc || pc.iceGatheringState === 'complete') return resolve();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        pc.removeEventListener('icegatheringstatechange', onChange);
      } catch (e) {
        /* noop */
      }
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    const timer = setTimeout(done, timeout);
  });
}

export { GAME_CHANNEL, CONTROL_CHANNEL };
