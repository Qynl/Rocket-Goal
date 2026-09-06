import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { drawMinimap } from './hudStore.js';

/** Rhythmic rAF loop helper (imperative per-frame visuals, no React renders). */
function useRaf(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id;
    const tick = (t) => {
      ref.current(t);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
}

function Minimap({ store }) {
  const ref = useRef(null);
  useRaf(() => {
    const cv = ref.current;
    if (!cv) return;
    if (!store.visible || store.replay) {
      cv.classList.add('hidden');
      return;
    }
    cv.classList.remove('hidden');
    drawMinimap(cv.getContext('2d'), cv, store.live.minimap);
  });
  return <canvas ref={ref} className="minimap hidden" width={360} height={260} />;
}

function BallArrow({ store }) {
  const ref = useRef(null);
  const arrowRef = useRef(null);
  const labelRef = useRef(null);
  useRaf(() => {
    const root = ref.current;
    const a = store.live.ballArrow;
    if (!root) return;
    if (!a) {
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');
    root.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%)`;
    if (arrowRef.current) arrowRef.current.style.transform = `rotate(${a.ang}deg)`;
    if (labelRef.current) labelRef.current.textContent = a.dist;
  });
  return (
    <div ref={ref} className="ball-arrow hidden">
      <i ref={arrowRef}></i>
      <span ref={labelRef}></span>
    </div>
  );
}

function Vignette({ store }) {
  const ref = useRef(null);
  useRaf(() => {
    if (ref.current) ref.current.style.opacity = store.live.vignette;
  });
  return <div ref={ref} className="vignette" style={{ opacity: 0 }} />;
}

export function Hud({ store }) {
  const subscribe = useMemo(() => store.subscribe.bind(store), [store]);
  const getSnapshot = useMemo(() => store.getSnapshot.bind(store), [store]);
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  if (!snap.visible && !snap.replay) return null;
  const drill = snap.drill;
  const board = snap.board;
  return (
    <div id="hud" className={`${snap.visible ? '' : 'hidden'}${snap.replay ? ' in-replay' : ''}`}>
      <div className={`scoreboard${snap.hideScoreboard ? ' hidden' : ''}${snap.ot ? ' ot' : ''}`}>
        <div className="team blue">{snap.score[0]}</div>
        <div className="clock">
          <span className="t">{snap.clockText}</span>
          <small>{snap.clockSmall}</small>
        </div>
        <div className="team orange">{snap.score[1]}</div>
      </div>

      <div className={`boost${snap.boostLow ? ' low' : ''}`}>
        <div className="ring" style={{ '--p': `${snap.boost}%` }} />
        <div className="amount">
          <span>{snap.boost}</span>
          <small>BOOST</small>
        </div>
      </div>

      <div className="speedo">
        <div className={`val${snap.supersonic ? ' ss' : ''}`}>{snap.speed}</div>
        <small>UU/S</small>
        <div className="bar">
          <i style={{ width: `${snap.speedBar}%` }} />
        </div>
      </div>

      <div className="status" dangerouslySetInnerHTML={{ __html: snap.pills.join(' ') }} />

      {snap.message && <div key={snap.message.html + snap.message.cls} className={`center-msg ${snap.message.cls || ''}`} dangerouslySetInnerHTML={{ __html: snap.message.html }} />}
      {snap.coach && <div className="coach" dangerouslySetInnerHTML={{ __html: snap.coach }} />}

      <div className="feed">
        {snap.feed.map((f) => (
          <div key={f.id} className="item" style={{ opacity: f.fade }} dangerouslySetInnerHTML={{ __html: f.html }} />
        ))}
      </div>

      <div className="stat-pops">
        {snap.stats.map((f) => (
          <div key={f.id} className={`pop${f.mine ? ' mine' : ''}`} style={{ opacity: f.fade }} dangerouslySetInnerHTML={{ __html: f.html }} />
        ))}
      </div>

      <div className="chat">
        {snap.chat.map((f) => (
          <div key={f.id} className="line" style={{ opacity: f.fade }} dangerouslySetInnerHTML={{ __html: f.html }} />
        ))}
      </div>

      {drill && (
        <div className="drill-hud">
          <h3>
            {drill.icon} {drill.name}
          </h3>
          {drill.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          <div className="acc">
            <i style={{ width: `${drill.acc}%` }} />
          </div>
          {drill.message && (
            <div style={{ color: 'var(--accent)', marginTop: 6 }} dangerouslySetInnerHTML={{ __html: drill.message }} />
          )}
        </div>
      )}

      {board && (
        <div className="board">
          <div className="head">
            <span className="blue">BLUE {board.score[0]}</span>
            <span className="muted">{board.ot ? 'OVERTIME' : ''}</span>
            <span className="orange">{board.score[1]} ORANGE</span>
          </div>
          <table>
            <tbody>
              <tr>
                <th>Player</th>
                <th>Score</th>
                <th>Goals</th>
                <th>Assists</th>
                <th>Saves</th>
                <th>Shots</th>
                <th>Boost</th>
              </tr>
              {board.rows.map((r, i) => (
                <tr key={i} className={`${r.team === 0 ? 'blue' : 'orange'}${r.me ? ' me' : ''}${r.team === 1 && board.rows[i - 1]?.team === 0 ? ' gap' : ''}`}>
                  <td>
                    {r.name}
                    {r.me ? ' (you)' : ''}
                  </td>
                  <td>{r.score}</td>
                  <td>{r.goals}</td>
                  <td>{r.assists}</td>
                  <td>{r.saves}</td>
                  <td>{r.shots}</td>
                  <td>{r.boost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="hint">
        <kbd>Esc</kbd> menu &nbsp; <kbd>Tab</kbd> scoreboard &nbsp; <kbd>P</kbd> prediction &nbsp; <kbd>T</kbd> reset ball
      </div>
      <div className={`replay${snap.replay ? '' : ' hidden'}`}>
        <span className="rec">●</span> REPLAY <small>0.5×</small>
      </div>

      <Minimap store={store} />
      <BallArrow store={store} />
      <Vignette store={store} />
    </div>
  );
}
