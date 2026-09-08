// ---------------------------------------------------------------------------
// Manual signalling.
//
// There is no server in this game — not for matchmaking, not for signalling.
// Two browsers are connected with plain WebRTC and a public STUN server, so the
// only thing that has to travel between them by hand is the SDP: the host shows
// a code, the friend pastes it and pastes a reply code back.
//
// A raw SDP is a couple of kilobytes, which nobody wants to copy. So it is
// trimmed (the lines a browser can regenerate anyway), gzipped when the browser
// has CompressionStream, and base64url'd. Typical result: ~600 characters.
// ---------------------------------------------------------------------------

const PREFIX_GZ = 'RG2';
const PREFIX_RAW = 'RG1';

const b64alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToB64(bytes) {
  // chunked so a long SDP never hits String.fromCharCode's argument limit
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  const std = typeof btoa === 'function' ? btoa(out) : base64Fallback(bytes);
  return std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64Fallback(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += b64alphabet[b0 >> 2];
    out += b64alphabet[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? '=' : b64alphabet[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? '=' : b64alphabet[b2 & 63];
  }
  return out;
}

function b64ToBytes(str) {
  const std = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 ? '='.repeat(4 - (std.length % 4)) : '';
  const bin = typeof atob === 'function' ? atob(std + pad) : null;
  if (bin === null) throw new Error('no atob');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Drop the SDP lines the peer does not need (they are regenerated locally). */
export function trimSdp(sdp) {
  return (
    sdp
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line) => {
        if (!line) return false;
        // hints, not requirements — the browser regenerates what it needs
        if (line.startsWith('a=ice-options')) return false;
        if (line.startsWith('a=extmap')) return false;
        if (line.startsWith('a=rtcp-rsize')) return false;
        if (line.startsWith('a=msid')) return false;
        if (line.startsWith('a=ssrc')) return false;
        return true;
      })
      .join('\n')
      // the long attribute names get a two-character tag (upper case, so they
      // can never be confused with a real SDP line type like `c=IN IP4 …`)
      .replace(/^a=candidate:/gm, 'C=')
      .replace(/^a=ice-ufrag:/gm, 'U=')
      .replace(/^a=ice-pwd:/gm, 'P=')
      .replace(/^a=fingerprint:/gm, 'F=')
      .replace(/^a=mid:/gm, 'M=')
      .replace(/^a=setup:/gm, 'S=')
      .replace(/^a=sctp-port:/gm, 'T=')
      .replace(/^a=max-message-size:/gm, 'X=')
  );
}

const TAGS = {
  C: 'a=candidate:',
  U: 'a=ice-ufrag:',
  P: 'a=ice-pwd:',
  F: 'a=fingerprint:',
  M: 'a=mid:',
  S: 'a=setup:',
  T: 'a=sctp-port:',
  X: 'a=max-message-size:',
};

export function untrimSdp(text) {
  const out = text
    .split('\n')
    .map((line) => {
      if (line.length > 2 && line[1] === '=') {
        const tag = TAGS[line[0]];
        if (tag) return tag + line.slice(2);
      }
      return line;
    })
    .join('\r\n');
  return out.endsWith('\r\n') ? out : out + '\r\n';
}

async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Turn an SDP blob into a short shareable code.
 * Falls back to an uncompressed code when gzip is unavailable.
 */
export async function encodeSdpCode(sdp) {
  const trimmed = trimSdp(sdp);
  const raw = enc.encode(trimmed);
  const gz = await gzip(raw);
  if (gz && gz.length < raw.length) return `${PREFIX_GZ}.${bytesToB64(gz)}`;
  return `${PREFIX_RAW}.${bytesToB64(raw)}`;
}

/** Reverse of encodeSdpCode. Returns null when the code is not usable. */
export async function decodeSdpCode(code) {
  const text = String(code || '')
    .trim()
    .replace(/\s+/g, '');
  if (!text) return null;
  // tolerate a pasted raw SDP (some people copy the whole thing)
  if (text.startsWith('v=0')) return text.replace(/\n/g, '\r\n');
  const dot = text.indexOf('.');
  if (dot < 0) return null;
  const kind = text.slice(0, dot);
  const body = text.slice(dot + 1);
  if (kind !== PREFIX_GZ && kind !== PREFIX_RAW) return null;
  let bytes;
  try {
    bytes = b64ToBytes(body);
  } catch (e) {
    return null;
  }
  let out = null;
  if (kind === PREFIX_GZ) out = await gunzip(bytes);
  if (!out) out = bytes;
  let sdp;
  try {
    sdp = dec.decode(out);
  } catch (e) {
    return null;
  }
  if (!sdp.includes('v=0')) return null;
  return untrimSdp(sdp);
}

/** A short, human friendly room label ("K7QF-2MXD") shown next to the code. */
export function roomLabel(code) {
  const body = String(code || '').replace(/[^A-Za-z0-9]/g, '');
  if (!body.length) return '';
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const part = (n) => {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += b64alphabet[(n >>> (i * 6)) & 63];
      n = Math.imul(n, 1103515245) + 12345 >>> 0;
    }
    return s;
  };
  return `${part(h)}-${part((h >>> 7) ^ 0x5bf03635)}`;
}

export const CODE_PREFIXES = { gzip: PREFIX_GZ, raw: PREFIX_RAW };
