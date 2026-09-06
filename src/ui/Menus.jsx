import { useEffect, useReducer, useState } from 'react';
import { SKILLS } from '../bot/bot.js';
import { DRILLS, loadProgress } from '../training.js';
import { PRESETS, BIND_LABELS, prettyCode } from '../input.js';
import { CAMERA_PRESETS } from '../render/renderer.js';

// ---------------------------------------------------------------------------
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

function Toggle({ value, onChange, save }) {
  return (
    <div className="seg">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          className={value === v ? 'on' : ''}
          onClick={() => {
            onChange(v);
            save();
          }}
        >
          {v ? 'On' : 'Off'}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MainScreen({ nav, engine }) {
  const cards = [
    { icon: '🏟️', title: 'Play match', desc: 'Full match vs bots. 1v1, 2v2 or 3v3, four difficulty tiers, boost pads, overtime, demos, the works.', fn: () => nav({ type: 'matchSetup' }) },
    { icon: '🎓', title: 'Training', desc: 'Seven drills with levels that adapt to you: shooting, saves, aerials, dribbling, kickoffs, wall play, recovery.', fn: () => nav({ type: 'training' }) },
    { icon: '🕹️', title: 'Free play', desc: 'Just you and the ball. Press T to reset. Great for warm-ups and mechanics.', fn: () => engine.startGame({ mode: 'freeplay' }) },
    { icon: '📈', title: 'Progress', desc: 'Your training history, accuracy per drill and match results.', fn: () => nav({ type: 'progress' }) },
    { icon: '⚙️', title: 'Settings', desc: 'Controls, camera, audio, coach.', fn: () => nav({ type: 'settings' }) },
    { icon: '📖', title: 'How to play', desc: 'Controls, mechanics and the basics of good car soccer.', fn: () => nav({ type: 'howto' }) },
  ];
  return (
    <div className="screen">
      <div className="panel">
        <div className="logo">
          ROCKET GOAL
          <small>OFFLINE CAR SOCCER TRAINER</small>
        </div>
        <div className="menu-grid">
          {cards.map((c) => (
            <div
              key={c.title}
              className="card"
              onClick={() => {
                engine.audio.ui();
                c.fn();
              }}
            >
              <div className="icon">{c.icon}</div>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
        <div className="row between section muted" style={{ fontSize: 13 }}>
          <span>
            Keyboard: <b>WASD</b> drive · <b>Space</b> jump · <b>Shift</b> boost · <b>Ctrl</b> powerslide/air roll · <b>Q/E</b> air roll · <b>C</b> ball cam
          </span>
          <span>Gamepad supported</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function MatchSetupScreen({ nav, engine, force }) {
  const s = engine.settings;
  const descs = {
    rookie: 'Slow reactions, no aerials, wasteful. Learn the controls.',
    pro: 'Solid positioning, shadows you, jump shots. Fair fight for most players.',
    allstar: 'Fast, boosts well, aerials up to ~1200 uu, speed flips on kickoff, rotates. A real challenge.',
    champion: 'Near-instant reactions, high aerials, demos, tight defence. Beating this consistently means you are genuinely good.',
  };
  const start = () => {
    engine.applySettings(s);
    engine.startGame({ mode: 'match', teamSize: s.teamSize, difficulty: s.difficulty, duration: s.duration, humanTeam: s.humanTeam, mutators: { boost: s.boostMutator }, replays: s.replays !== false });
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>Match setup</h2>
        <div className="row section">
          <Seg label="Team size" options={[1, 2, 3].map((n) => ({ v: n, label: `${n}v${n}` }))} value={s.teamSize} onChange={(v) => { s.teamSize = v; force(); }} />
          <Seg label="Match length" options={[{ v: 120, label: '2 min' }, { v: 300, label: '5 min' }, { v: 600, label: '10 min' }]} value={s.duration} onChange={(v) => { s.duration = v; force(); }} />
          <Seg label="Your team" options={[{ v: 0, label: 'Blue' }, { v: 1, label: 'Orange' }]} value={s.humanTeam} onChange={(v) => { s.humanTeam = v; force(); }} />
          <Seg label="Boost" options={[{ v: 'normal', label: 'Normal' }, { v: 'unlimited', label: 'Unlimited' }]} value={s.boostMutator} onChange={(v) => { s.boostMutator = v; force(); }} />
        </div>
        <h3 className="section">Bot difficulty</h3>
        <div className="menu-grid">
          {Object.keys(SKILLS).map((key) => (
            <div
              key={key}
              className={`card${s.difficulty === key ? ' selected' : ''}`}
              onClick={() => {
                s.difficulty = key;
                engine.audio.ui();
                force();
              }}
            >
              <h3>{SKILLS[key].name}</h3>
              <p>{descs[key]}</p>
            </div>
          ))}
        </div>
        <div className="row between section">
          <button className="ghost" onClick={() => nav({ type: 'menu' })}>Back</button>
          <button className="primary" onClick={start}>Start match</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TrainingScreen({ nav, engine, force }) {
  const s = engine.settings;
  const prog = loadProgress();
  const [selected, setSelected] = useState(s.lastDrill);
  const drill = DRILLS.find((d) => d.id === selected) || DRILLS[0];
  const start = () => {
    s.lastDrill = selected;
    engine.applySettings(s);
    engine.startGame({ mode: 'drill', drill: selected, level: s.drillLevel, humanTeam: s.humanTeam, teamSize: 1, difficulty: 'champion', drillBots: drill.hasBots });
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>Training</h2>
        <p className="muted">Each drill has 5 levels. Land 8 of your last 10 attempts and it levels up automatically. Your accuracy and streaks are saved.</p>
        <div className="menu-grid">
          {DRILLS.map((d) => {
            const pr = prog[d.id];
            const stat = pr && pr.attempts ? `${Math.round((pr.successes / pr.attempts) * 100)}% over ${pr.attempts} attempts · best streak ${pr.best}` : 'Not attempted yet';
            return (
              <div
                key={d.id}
                className={`card${selected === d.id ? ' selected' : ''}`}
                onClick={() => {
                  setSelected(d.id);
                  s.lastDrill = d.id;
                  engine.audio.ui();
                  force();
                }}
              >
                <div className="icon">{d.icon}</div>
                <h3>{d.name}</h3>
                <p>{d.desc}</p>
                <div className="stat">{stat}</div>
              </div>
            );
          })}
        </div>
        <div className="tip section">💡 {drill.tip}</div>
        <div className="row between section">
          <div className="row">
            <Seg label="Start level" options={[1, 2, 3, 4, 5].map((n) => ({ v: n, label: String(n) }))} value={s.drillLevel} onChange={(v) => { s.drillLevel = v; force(); }} />
            <Seg label="Your team" options={[{ v: 0, label: 'Blue' }, { v: 1, label: 'Orange' }]} value={s.humanTeam} onChange={(v) => { s.humanTeam = v; force(); }} />
          </div>
          <div className="row">
            <button className="ghost" onClick={() => nav({ type: 'menu' })}>Back</button>
            <button className="primary" onClick={start}>Start drill</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProgressScreen({ nav, force }) {
  const prog = loadProgress();
  const matches = JSON.parse(localStorage.getItem('rocketgoal.matches') || '[]');
  const reset = () => {
    if (confirm('Delete all saved progress?')) {
      localStorage.removeItem('rocketgoal.training.v1');
      localStorage.removeItem('rocketgoal.matches');
      force();
    }
  };
  return (
    <div className="screen">
      <div className="panel">
        <h2>Progress</h2>
        <h3 className="section">Drills</h3>
        <div className="progress-grid">
          {DRILLS.map((d) => {
            const pr = prog[d.id];
            const acc = pr && pr.attempts ? Math.round((pr.successes / pr.attempts) * 100) + '%' : '—';
            const levels = pr ? Object.keys(pr.levelBest || {}).map(Number) : [];
            const maxLevel = levels.length ? Math.max(...levels) : '—';
            return (
              <div key={d.id} className="p">
                <b>
                  {d.icon} {d.name}
                </b>
                Accuracy {acc}
                <br />
                Attempts {pr?.attempts || 0}
                <br />
                Best streak {pr?.best || 0}
                <br />
                Highest level {maxLevel}
                {pr?.bestTime ? (
                  <>
                    <br />
                    Best time {pr.bestTime.toFixed(2)}s
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        <h3 className="section">Recent matches</h3>
        {!matches.length ? (
          <p className="muted">No matches played yet.</p>
        ) : (
          <table className="stats">
            <tbody>
              <tr>
                <th>When</th>
                <th>Mode</th>
                <th>Bots</th>
                <th>Result</th>
                <th>Goals</th>
                <th>Saves</th>
                <th>Shots</th>
                <th>Boost avg</th>
                <th>Goal-side</th>
              </tr>
              {matches
                .slice(-12)
                .reverse()
                .map((m, i) => (
                  <tr key={i}>
                    <td>{new Date(m.date).toLocaleString()}</td>
                    <td>{m.teamSize}v{m.teamSize}</td>
                    <td>{m.difficulty}</td>
                    <td style={{ color: m.won ? 'var(--good)' : m.draw ? 'var(--muted)' : 'var(--danger)' }}>{m.score}</td>
                    <td>{m.goals}</td>
                    <td>{m.saves}</td>
                    <td>{m.shots}</td>
                    <td>{Math.round(m.avgBoost)}</td>
                    <td>{Math.round(m.goalSide * 100)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <div className="row between section">
          <button className="ghost" onClick={() => nav({ type: 'menu' })}>Back</button>
          <button className="danger small" onClick={reset}>Reset all progress</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SettingsScreen({ nav, engine, force, fromPause = false }) {
  const s = engine.settings;
  const input = engine.input;
  const [tab, setTab] = useState('controls');
  const [listening, setListening] = useState(null); // action being rebound
  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      e.preventDefault();
      cleanup();
      input.rebind(listening, e.code);
      setListening(null);
    };
    const onMouse = (e) => {
      e.preventDefault();
      cleanup();
      input.rebind(listening, 'Mouse' + e.button);
      setListening(null);
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
    const id = setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
    }, 50);
    return () => {
      clearTimeout(id);
      cleanup();
    };
  }, [listening, input]);

  const camFields = [
    ['fov', 'Field of view', 60, 110, 1],
    ['distance', 'Distance', 100, 400, 10],
    ['height', 'Height', 40, 200, 10],
    ['angle', 'Angle', -15, 0, 1],
    ['stiffness', 'Stiffness', 0, 1, 0.05],
    ['swivel', 'Swivel speed', 1, 10, 0.5],
  ];
  return (
    <div className="screen">
      <div className="panel">
        <h2>Settings</h2>
        <div className="tabs section">
          {['controls', 'camera', 'game'].map((t) => (
            <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'controls' && (
          <>
            <div className="row">
              <Seg
                label="Preset"
                options={Object.keys(PRESETS).map((k) => ({ v: k, label: PRESETS[k].name }))}
                value={input.presetName}
                onChange={(v) => {
                  input.setPreset(v);
                  force();
                }}
              />
            </div>
            <div className="bind-grid section">
              {Object.keys(BIND_LABELS).map((action) => (
                <span key={action} style={{ display: 'contents' }}>
                  <div>{BIND_LABELS[action]}</div>
                  <button className={`small${listening === action ? ' listening' : ''}`} onClick={() => setListening(action)}>
                    {listening === action ? 'Press a key…' : input.binds[action].map(prettyCode).join(' / ')}
                  </button>
                </span>
              ))}
            </div>
            <p className="muted section">Gamepad (Xbox layout): RT throttle · LT reverse · A jump · B boost · X powerslide / air roll · LB/RB air roll left/right · Y ball cam · Start pause. Plug in and press any button.</p>
          </>
        )}
        {tab === 'camera' && (
          <>
            <div className="bind-grid section">
              {camFields.map(([key, label, min, max, step]) => (
                <span key={key} style={{ display: 'contents' }}>
                  <div>
                    {label} <span className="muted">({s.camera[key]})</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    defaultValue={s.camera[key]}
                    onInput={(e) => {
                      s.camera[key] = parseFloat(e.target.value);
                      engine.renderer.setCameraSettings(s.camera);
                      e.target.previousElementSibling.querySelector('.muted').textContent = `(${s.camera[key]})`;
                      engine.applySettings(s);
                    }}
                  />
                </span>
              ))}
            </div>
            <div className="row section">
              {Object.keys(CAMERA_PRESETS).map((k) => (
                <button
                  key={k}
                  className="small"
                  onClick={() => {
                    Object.assign(s.camera, CAMERA_PRESETS[k]);
                    engine.renderer.setCameraSettings(s.camera);
                    engine.applySettings(s);
                    force();
                  }}
                >
                  Preset: {k}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === 'game' && (
          <div className="bind-grid section">
            <div>Master volume</div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={s.volume}
              onInput={(e) => {
                s.volume = parseFloat(e.target.value);
                engine.audio.setVolume(s.volume);
                engine.applySettings(s);
              }}
            />
            <div>Quality</div>
            <Seg
              label=""
              options={[{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }]}
              value={s.quality}
              onChange={(v) => {
                s.quality = v;
                engine.applySettings(s);
                force();
              }}
            />
            <div>Goal replays</div>
            <Toggle value={s.replays !== false} onChange={(v) => (s.replays = v)} save={() => engine.applySettings(s)} />
            <div>Coach tips during matches</div>
            <Toggle value={s.coach !== false} onChange={(v) => (s.coach = v)} save={() => engine.applySettings(s)} />
            <div>Quick chat</div>
            <Toggle value={s.quickChat !== false} onChange={(v) => (s.quickChat = v)} save={() => engine.applySettings(s)} />
            <div>Prediction line</div>
            <Toggle
              value={s.showPrediction !== false}
              onChange={(v) => {
                s.showPrediction = v;
                engine.renderer.showPrediction = v;
              }}
              save={() => engine.applySettings(s)}
            />
            <div>Player name</div>
            <input
              type="text"
              maxLength={12}
              defaultValue={s.playerName}
              onChange={(e) => {
                s.playerName = e.target.value || 'You';
                engine.applySettings(s);
              }}
            />
          </div>
        )}
        <div className="row between section">
          <button
            className="ghost"
            onClick={() => {
              engine.applySettings(s);
              nav(fromPause ? { type: 'pause' } : { type: 'menu' });
            }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function HowToScreen({ nav, engine }) {
  const input = engine.input;
  const b = (a) => input.binds[a].map(prettyCode).join(' / ');
  const extra = [
    ['Pause / menu', 'Esc'],
    ['Toggle prediction line', 'P'],
    ['Reset ball (free play / drills)', 'T'],
  ];
  return (
    <div className="screen">
      <div className="panel">
        <h2>How to play</h2>
        <h3 className="section">Controls</h3>
        <div className="controls-list">
          {Object.keys(BIND_LABELS).map((a) => (
            <div key={a}>
              <span>{BIND_LABELS[a]}</span>
              <kbd>{b(a)}</kbd>
            </div>
          ))}
          {extra.map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
        <h3 className="section">Mechanics</h3>
        <div className="muted">
          <p><b>Jump &amp; flip:</b> press jump once to jump; press it again in the air within 1.25s while holding a direction to <b>flip</b> (dodge) that way. Flips add speed on the ground and power to shots. Holding no direction gives a <b>double jump</b>.</p>
          <p><b>Aerials:</b> jump, hold jump briefly for extra height, pull the nose up (S / stick back) and boost. Small corrections early beat big corrections late.</p>
          <p><b>Powerslide:</b> hold it while turning to drift. Tap it when landing at an angle to keep speed.</p>
          <p><b>Air roll:</b> Q/E (or hold powerslide + steer) rotate the car around its long axis. Land on your wheels to keep momentum.</p>
          <p><b>Speed flip:</b> diagonal flip, then cancel by pulling back — the fastest way to get to a ball. Practice on kickoffs.</p>
          <p><b>Wavedash:</b> flip just as your wheels touch the ground after a small hop to get a burst of speed for free.</p>
        </div>
        <h3 className="section">Getting better (what the bots punish)</h3>
        <div className="muted">
          <ul style={{ lineHeight: 1.6 }}>
            <li><b>Stay goal-side.</b> If you cannot win the race to the ball, do not go. Shadow back at the ball's speed.</li>
            <li><b>Never clear up the middle.</b> Corners buy time.</li>
            <li><b>Boost is time.</b> Pick up small pads along your path instead of driving out of position for big ones.</li>
            <li><b>Hit the ball where you want it to go.</b> Approach from behind on the line ball → target.</li>
            <li><b>Kickoffs decide 1v1s.</b> Practice them until you win 70%.</li>
            <li>Play the <b>Pro</b> bot until you win comfortably, then <b>All-Star</b>, then <b>Grand Champion</b>.</li>
          </ul>
        </div>
        <div className="row between section">
          <button className="ghost" onClick={() => nav({ type: 'menu' })}>Back</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PauseScreen({ nav, engine, force }) {
  const g = engine.game;
  const h = g && g.human ? g.human.stats : null;
  const isMatch = g && g.config.mode === 'match' && g.state !== 'ended';
  return (
    <div className="screen">
      <div className="panel">
        <h2>Paused</h2>
        <div className="row section">
          <button className="primary" onClick={() => engine.resume()}>Resume</button>
          <button onClick={() => engine.restart()}>Restart</button>
          <button onClick={() => nav({ type: 'settings', fromPause: true })}>Settings</button>
          <button className="danger" onClick={() => (isMatch ? engine.forfeit() : engine.quitToMenu())}>
            {isMatch ? 'Forfeit' : 'Quit to menu'}
          </button>
        </div>
        {h && (
          <>
            <h3 className="section">Your stats so far</h3>
            <div className="kv">
              <span>Touches</span>
              <span>{h.touches}</span>
              <span>Shots</span>
              <span>{h.shots}</span>
              <span>Goals</span>
              <span>{h.goals}</span>
              <span>Saves</span>
              <span>{h.saves}</span>
              <span>Boost used</span>
              <span>{Math.round(h.boostUsed)}</span>
              <span>Avg speed</span>
              <span>{Math.round(h.speedSamples ? h.speedSum / h.speedSamples : 0)}</span>
            </div>
          </>
        )}
        {g && g.drill && (
          <>
            <h3 className="section">Drill level</h3>
            <div className="row section">
              {[1, 2, 3, 4, 5].map((l) => (
                <button
                  key={l}
                  className={`small${g.drill.level === l ? ' primary' : ''}`}
                  onClick={() => {
                    g.drill.level = l;
                    g.drill.results = [];
                    engine.resume();
                    g.drill.nextAttempt();
                    force();
                  }}
                >
                  Level {l}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="muted section">Press Esc to resume.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ResultsScreen({ nav, engine, stats, report, config }) {
  const h = stats.cars.find((c) => c.isHuman);
  const won = h && stats.score[h.team] > stats.score[1 - h.team];
  const draw = stats.score[0] === stats.score[1];
  const winTeam = draw ? -1 : stats.score[0] > stats.score[1] ? 0 : 1;
  const mvp = stats.cars
    .filter((c) => winTeam < 0 || c.team === winTeam)
    .reduce((a, c) => (!a || c.score > a.score ? c : a), null);
  const rows = stats.cars.slice().sort((a, b) => a.team - b.team || b.score - a.score);
  return (
    <div className="screen">
      <div className="panel">
        <h2 style={{ color: won ? 'var(--good)' : draw ? 'var(--muted)' : 'var(--danger)' }}>
          {won ? 'Victory' : draw ? 'Draw' : stats.forfeited ? 'Forfeit' : 'Defeat'}{' '}
          <span className="muted" style={{ fontSize: 20 }}>
            {stats.score[0]} – {stats.score[1]}
            {stats.overtime ? ' (OT)' : ''}
          </span>
        </h2>
        <table className="stats section">
          <tbody>
            <tr>
              <th>Player</th>
              <th>Score</th>
              <th>Goals</th>
              <th>Assists</th>
              <th>Saves</th>
              <th>Shots</th>
              <th>Touches</th>
              <th>Demos</th>
              <th>Avg boost</th>
              <th>Avg speed</th>
            </tr>
            {rows.map((c, i) => (
              <tr key={i} className={`${c.team === 0 ? 'blue' : 'orange'}${c.isHuman ? ' me' : ''}`}>
                <td>
                  {c.name}
                  {c.isBot ? '' : ' (you)'}
                  {c === mvp ? <span className="mvp">MVP</span> : null}
                </td>
                <td>{c.score}</td>
                <td>{c.goals}</td>
                <td>{c.assists}</td>
                <td>{c.saves}</td>
                <td>{c.shots}</td>
                <td>{c.touches}</td>
                <td>{c.demos}</td>
                <td>{Math.round(c.avgBoost)}</td>
                <td>{Math.round(c.avgSpeed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="section">Coach report</h3>
        <div className="report">
          {report.map((r, i) => (
            <div key={i} className={`item ${r.grade}`}>
              <b>{r.title}</b>
              {r.text}
            </div>
          ))}
        </div>
        <div className="row between section">
          <button className="ghost" onClick={() => engine.quitToMenu()}>Main menu</button>
          <button className="primary" onClick={() => engine.startGame(config)}>Rematch</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DrillSummaryScreen({ nav, engine, drill, config }) {
  const fails = {};
  for (const r of drill.results) if (!r.ok && r.feedback) fails[r.feedback] = (fails[r.feedback] || 0) + 1;
  const topFail = Object.entries(fails).sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="screen">
      <div className="panel">
        <h2>
          {drill.meta.icon} {drill.meta.name} — session
        </h2>
        <div className="kv section">
          <span>Attempts</span>
          <span>{drill.attempts}</span>
          <span>Successes</span>
          <span>{drill.successes}</span>
          <span>Accuracy</span>
          <span>{Math.round(drill.accuracy * 100)}%</span>
          <span>Best streak</span>
          <span>{drill.bestStreak}</span>
          <span>Level reached</span>
          <span>{drill.level}</span>
        </div>
        <div className="tip section">
          {topFail ? (
            <>
              Most common miss ({topFail[1]}×): {topFail[0]}
              <br />
              <br />
            </>
          ) : null}
          💡 {drill.meta.tip}
        </div>
        <div className="row between section">
          <button className="ghost" onClick={() => nav({ type: 'training' })}>Training menu</button>
          <button className="primary" onClick={() => engine.startGame({ ...config, level: drill.level })}>Go again</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Menus({ engine, overlay, nav }) {
  const [, force] = useReducer((c) => c + 1, 0);
  if (!overlay || !engine) return null;
  switch (overlay.type) {
    case 'menu':
      return <MainScreen nav={nav} engine={engine} />;
    case 'matchSetup':
      return <MatchSetupScreen nav={nav} engine={engine} force={force} />;
    case 'training':
      return <TrainingScreen nav={nav} engine={engine} force={force} />;
    case 'progress':
      return <ProgressScreen nav={nav} force={force} />;
    case 'settings':
      return <SettingsScreen nav={nav} engine={engine} force={force} fromPause={overlay.fromPause} />;
    case 'howto':
      return <HowToScreen nav={nav} engine={engine} />;
    case 'pause':
      return <PauseScreen nav={nav} engine={engine} force={force} />;
    case 'results':
      return <ResultsScreen nav={nav} engine={engine} stats={overlay.stats} report={overlay.report} config={overlay.config} />;
    case 'drillSummary':
      return <DrillSummaryScreen nav={nav} engine={engine} drill={overlay.drill} config={overlay.config} />;
    default:
      return null;
  }
}
