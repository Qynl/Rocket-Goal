// ---------------------------------------------------------------------------
// Online play (peer-to-peer). Written as a separate chunk so Menus.jsx stays
// readable; it is imported by the menu switch below.
// ---------------------------------------------------------------------------
import { useEffect, useReducer, useRef, useState } from 'react';
import { SKILLS } from '../bot/bot.js';
import { describe as describeMutators, defaultMutators } from '../mutators.js';
import { ARENA_LIST } from '../arenas.js';
import { P2P_FAIL_MESSAGE, ICE_SERVERS } from '../net/connection.js';

function Seg({ label, options, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="seg">
        {options.map((o) => (
          <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A code the user has to copy out (or paste in). Big, monospace, one click. */
function CodeOut({ label, value, step }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = value || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else if (ref.current) {
        ref.current.focus();
        ref.current.select();
        document.execCommand && document.execCommand('copy');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      if (ref.current) ref.current.select();
    }
  };
  return (
    <div className="net-step section">
      <div className="row between">
        <label>
          <b>{step}</b> {label}
        </label>
        <button className="small" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy code'}
        </button>
      </div>
      <textarea ref={ref} className="net-code" readOnly value={value} onFocus={(e) => e.target.select()} rows={4} spellCheck={false} />
      <small className="muted">
        {value ? value.length : 0} characters · send it over anything — messenger, mail, a sticky note
      </small>
    </div>
  );
}

function CodeIn({ label, step, value, onChange, onSubmit, busy, cta }) {
  return (
    <div className="net-step section">
      <label>
        <b>{step}</b> {label}
      </label>
      <textarea
        className="net-code"
        rows={4}
        spellCheck={false}
        placeholder="Paste the code here…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="row between">
        <small className="muted">{value ? value.length : 0} characters pasted</small>
        <button className="primary" disabled={!value.trim() || !!busy} onClick={onSubmit}>
          {busy || cta}
        </button>
      </div>
    </div>
  );
}

function LinkNote() {
  const isHttp = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  if (!isHttp) return null;
  return (
    <small className="muted">
      Tip: because the code lives in a text box you can also copy the whole page address after creating a room — the code is not in the URL, so send the
      code itself.
    </small>
  );
}

function StatusLine({ session, busy }) {
  if (!session) return null;
  const conn = session.conn;
  const st = conn ? conn.state : 'idle';
  let text = busy || '';
  let cls = 'muted';
  if (session.phase === 'lobby') {
    text = `Connected to ${session.peer ? session.peer.name : 'your friend'}${session.rtt ? ` · ${Math.round(session.rtt * 1000)} ms` : ''}`;
    cls = 'good';
  } else if (session.phase === 'lost') {
    text = 'Connection failed';
    cls = 'bad';
  } else if (st === 'connected') {
    text = 'Link established — saying hello…';
    cls = 'good';
  } else if (st === 'connecting') {
    text = 'Punching through the router…';
  } else if (st === 'signaling') {
    text = session.detail || 'Waiting for codes';
  } else if (st === 'failed') {
    text = 'Connection failed';
    cls = 'bad';
  }
  return (
    <div className={`net-status ${cls}`}>
      <span className="dot" /> {text}
    </div>
  );
}

export function MultiplayerScreen({ nav, engine, step }) {
  const s = engine.settings;
  if (!s.mutators) s.mutators = defaultMutators();
  if (!s.netTeamSize) s.netTeamSize = 1;
  const [stage, setStage] = useState(step === 'lobby' ? 'lobby' : 'choose');
  const [role, setRole] = useState(step === 'lobby' && engine.net ? engine.net.role : null);
  const [invite, setInvite] = useState('');
  const [reply, setReply] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [, tick] = useReducer((c) => c + 1, 0);
  const session = engine.net;
  const phase = session ? session.phase : 'idle';

  // follow ICE + the handshake without wiring more callbacks into React
  useEffect(() => {
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === 'lobby') setStage('lobby');
    else if (phase === 'lost') {
      setError((session && session.detail) || P2P_FAIL_MESSAGE);
      setStage('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // an invite code in the address bar (#join=…) fills the join box for you
  useEffect(() => {
    if (typeof location === 'undefined' || !location.hash) return;
    const m = /[#&]join=([^&]+)/.exec(location.hash);
    if (!m) return;
    setRole('guest');
    engine.netCreate('guest');
    setPasted(decodeURIComponent(m[1]));
    setStage('paste');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    engine.netClose();
    nav({ type: 'menu' });
  };

  const host = async () => {
    setError('');
    setBusy('Creating the room…');
    setRole('host');
    engine.netCreate('host');
    const code = await engine.netInvite();
    setBusy('');
    if (!code) {
      setError('This browser could not create a WebRTC invite.');
      setStage('error');
      return;
    }
    setInvite(code);
    setStage('invite');
  };

  const join = () => {
    setError('');
    setRole('guest');
    engine.netCreate('guest');
    setStage('paste');
  };

  const submitInvite = async () => {
    setBusy('Reading the invite…');
    setError('');
    const res = await engine.netAcceptInvite(pasted.trim());
    setBusy('');
    if (!res || res.error) {
      setError((res && res.error) || 'That invite could not be used.');
      return;
    }
    setReply(res.reply);
    setStage('reply');
  };

  const submitReply = async () => {
    setBusy('Connecting…');
    setError('');
    const res = await engine.netAcceptReply(pasted.trim());
    setBusy('');
    if (!res || res.error) {
      setError((res && res.error) || 'That reply could not be used.');
      return;
    }
    setPasted('');
    setStage('connecting');
  };

  const start = () => {
    engine.applySettings(s);
    engine.netStart({
      teamSize: s.netTeamSize,
      arena: s.arena,
      mutators: s.mutators,
      difficulty: s.difficulty,
      duration: s.mutators.length,
      humanTeam: s.humanTeam,
      replays: s.replays !== false,
    });
  };

  const mods = describeMutators(s.mutators);
  const arenaName = (ARENA_LIST.find((a) => a.id === s.arena) || {}).name || s.arena;

  return (
    <div className="screen">
      <div className="panel" style={{ maxWidth: 880 }}>
        <h2>Play online</h2>
        <p className="muted net-why">
          Two browsers, one match, <b>no server and no account</b>: {P2P_FAIL_MESSAGE.charAt(0).toUpperCase() + P2P_FAIL_MESSAGE.slice(1)}.
          <br />
          Signalling is you and your friend swapping two short codes — that is the whole setup.
        </p>

        {stage === 'choose' && (
          <>
            <div className="menu-grid">
              <div
                className="card"
                onClick={() => {
                  engine.audio.ui();
                  host();
                }}
              >
                <div className="icon">🛰️</div>
                <h3>Host a match</h3>
                <p>You get a code. Send it to your friend, paste their reply back, pick the rules and start.</p>
              </div>
              <div
                className="card"
                onClick={() => {
                  engine.audio.ui();
                  join();
                }}
              >
                <div className="icon">🔗</div>
                <h3>Join a match</h3>
                <p>Paste your friend's code, send the reply code back, and wait for them to kick off.</p>
              </div>
            </div>
            <div className="tip section">
              💡 The host simulates the match, so the host's machine should be the faster one. Both players see their own car with zero input latency;
              everything else is interpolated.
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              STUN: {ICE_SERVERS.map((i) => i.urls).join(' · ')} — no TURN, nothing is relayed through us.
            </p>
          </>
        )}

        {stage === 'invite' && role === 'host' && (
          <>
            <CodeOut step="1" label="Send this invite code to your friend" value={invite} />
            <CodeIn step="2" label="Paste the reply code they send back" value={pasted} onChange={setPasted} onSubmit={submitReply} busy={busy} cta="Connect" />
            <StatusLine session={session} busy={busy} />
            <LinkNote />
          </>
        )}

        {stage === 'paste' && role === 'guest' && (
          <>
            <CodeIn step="1" label="Paste the invite code from your friend" value={pasted} onChange={setPasted} onSubmit={submitInvite} busy={busy} cta="Read invite" />
            <StatusLine session={session} busy={busy} />
          </>
        )}

        {stage === 'reply' && role === 'guest' && (
          <>
            <CodeOut step="2" label="Send this reply code back to the host" value={reply} />
            <StatusLine session={session} busy={busy} />
            <p className="muted" style={{ fontSize: 13 }}>
              The host pastes it, the two browsers connect directly, and the match starts from their screen. Nothing else to do here.
            </p>
          </>
        )}

        {stage === 'connecting' && (
          <>
            <StatusLine session={session} busy={busy} />
            <div className="tip section">
              ⏳ Connecting directly. If it does not link up in ~20 seconds the network is blocking it — {P2P_FAIL_MESSAGE}.
            </div>
          </>
        )}

        {stage === 'lobby' && (
          <>
            <div className="net-status good section">
              <span className="dot" /> Connected to <b>&nbsp;{session && session.peer ? session.peer.name : 'your friend'}&nbsp;</b>
              {session && session.rtt ? ` · ${Math.round(session.rtt * 1000)} ms · you are the ${role}` : ''}
            </div>
            {role === 'host' ? (
              <>
                <div className="row section">
                  <Seg
                    label="Teams"
                    options={[1, 2, 3].map((n) => ({ v: n, label: n === 1 ? '1v1' : `${n}v${n} (with bots)` }))}
                    value={s.netTeamSize}
                    onChange={(v) => {
                      s.netTeamSize = v;
                      tick();
                    }}
                  />
                  <Seg
                    label="Your side"
                    options={[
                      { v: 0, label: 'Blue' },
                      { v: 1, label: 'Orange' },
                    ]}
                    value={s.humanTeam}
                    onChange={(v) => {
                      s.humanTeam = v;
                      tick();
                    }}
                  />
                  <Seg label="Arena" options={ARENA_LIST.map((a) => ({ v: a.id, label: a.name }))} value={s.arena} onChange={(v) => { s.arena = v; engine.applySettings(s); tick(); }} />
                </div>
                <div className="row section">
                  <Seg label="Bots" options={Object.keys(SKILLS).map((k) => ({ v: k, label: SKILLS[k].name }))} value={s.difficulty} onChange={(v) => { s.difficulty = v; tick(); }} />
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Rules: {mods.length ? mods.join(' · ') : 'Standard'} · arena {arenaName} · your friend plays with the car and name from their own garage.
                </p>
                <div className="row between section">
                  <button className="ghost" onClick={leave}>
                    Cancel
                  </button>
                  <button className="primary" onClick={start}>
                    Start match
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted section">Waiting for the host to pick the rules and start the match…</p>
                <div className="row between section">
                  <button className="ghost" onClick={leave}>
                    Cancel
                  </button>
                  <span className="muted">
                    You play as <b>{s.playerName}</b> with your garage loadout.
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="net-status bad section">
              <span className="dot" /> Couldn't connect — {error}
            </div>
            <div className="tip section">
              💡 Both players need the same build of the game, and both codes must be copied in full. If the codes are right and it still fails, the network
              is the reason: {P2P_FAIL_MESSAGE}.
            </div>
            <div className="row between section">
              <button className="ghost" onClick={leave}>
                Back to menu
              </button>
              <button
                onClick={() => {
                  setError('');
                  setPasted('');
                  setInvite('');
                  setReply('');
                  setStage('choose');
                  engine.netClose();
                }}
              >
                Try again
              </button>
            </div>
          </>
        )}

        {stage !== 'choose' && stage !== 'error' && (
          <div className="row between section muted" style={{ fontSize: 12 }}>
            <span>Direct peer-to-peer · no data ever touches a server</span>
            <button className="small ghost" onClick={leave}>
              Cancel and go back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown when a link fails or drops mid-match. The message is verbatim. */
export function NetErrorScreen({ engine, message, wasPlaying, code }) {
  return (
    <div className="screen">
      <div className="panel" style={{ maxWidth: 760 }}>
        <h2>{wasPlaying ? 'Connection lost' : "Couldn't connect"}</h2>
        <div className="net-status bad section">
          <span className="dot" /> {message || P2P_FAIL_MESSAGE}
        </div>
        <div className="muted section">
          {wasPlaying ? (
            <p>The direct link to your friend dropped, so the match stopped. What usually causes it:</p>
          ) : (
            <p>The two browsers never found a direct route. What usually causes it:</p>
          )}
          <ul style={{ lineHeight: 1.7 }}>
            <li>One of you is on <b>mobile data</b> (carrier-grade NAT) — try the same Wi-Fi, or a network without it.</li>
            <li>A <b>strict VPN</b>, a corporate/school firewall, or a router with UPnP off and no port forwarding.</li>
            <li>Both peers behind <b>symmetric NAT</b>: without a TURN relay there is no hole to punch through.</li>
            <li>A code that was copied incompletely, or a different build of the game on the other side{code ? ` (reason: ${code})` : ''}.</li>
          </ul>
          <p>
            There is no relay in this game — no server, no account, nothing to host. Everything else still works offline: bots, training, garage, mutators
            and Rumble.
          </p>
        </div>
        <div className="row between section">
          <button className="ghost" onClick={() => engine.netLeave()}>
            Main menu
          </button>
          <button
            className="primary"
            onClick={() => {
              engine.netClose();
              engine.ui({ type: 'multiplayer' });
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

