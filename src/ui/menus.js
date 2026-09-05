import { SKILLS } from '../bot/bot.js';
import { DRILLS, loadProgress } from '../training.js';
import { PRESETS, BIND_LABELS, prettyCode } from '../input.js';
import { CAMERA_PRESETS } from '../render/renderer.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const SETTINGS_KEY = 'rocketgoal.settings.v1';
export function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (e) {
    return defaultSettings();
  }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function defaultSettings() {
  return {
    teamSize: 1,
    difficulty: 'allstar',
    duration: 300,
    humanTeam: 0,
    boostMutator: 'normal',
    camera: { ...CAMERA_PRESETS.default },
    quality: 'high',
    replays: true,
    showPrediction: false,
    coach: true,
    volume: 0.6,
    playerName: 'You',
    drillLevel: 1,
    lastDrill: 'shooting',
  };
}

export class Menus {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.settings = loadSettings();
    this.screen = null;
    this.container = el('div');
    root.appendChild(this.container);
  }

  show(screenFn) {
    this.container.innerHTML = '';
    const scr = el('div', 'screen');
    const panel = el('div', 'panel');
    scr.appendChild(panel);
    this.container.appendChild(scr);
    screenFn(panel);
    this.screen = scr;
    this.container.classList.remove('hidden');
  }
  hide() {
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
    this.screen = null;
  }
  get visible() {
    return !!this.screen;
  }
  save() {
    saveSettings(this.settings);
  }

  // ----------------------------------------------------------------------
  main() {
    this.show((p) => {
      p.innerHTML = `<div class="logo">ROCKET GOAL<small>OFFLINE CAR SOCCER TRAINER</small></div>`;
      const grid = el('div', 'menu-grid');
      const cards = [
        { icon: '🏟️', title: 'Play match', desc: 'Full match vs bots. 1v1, 2v2 or 3v3, four difficulty tiers, boost pads, overtime, demos, the works.', fn: () => this.matchSetup() },
        { icon: '🎓', title: 'Training', desc: 'Seven drills with levels that adapt to you: shooting, saves, aerials, dribbling, kickoffs, wall play, recovery.', fn: () => this.training() },
        { icon: '🕹️', title: 'Free play', desc: 'Just you and the ball. Press T to reset. Great for warm-ups and mechanics.', fn: () => this.app.startGame({ mode: 'freeplay' }) },
        { icon: '📈', title: 'Progress', desc: 'Your training history, accuracy per drill and match results.', fn: () => this.progress() },
        { icon: '⚙️', title: 'Settings', desc: 'Controls, camera, audio, coach.', fn: () => this.settingsScreen() },
        { icon: '📖', title: 'How to play', desc: 'Controls, mechanics and the basics of good car soccer.', fn: () => this.howTo() },
      ];
      for (const c of cards) {
        const card = el('div', 'card', `<div class="icon">${c.icon}</div><h3>${c.title}</h3><p>${c.desc}</p>`);
        card.onclick = () => {
          this.app.audio.ui();
          c.fn();
        };
        grid.appendChild(card);
      }
      p.appendChild(grid);
      const foot = el('div', 'row between section muted', `<span>Keyboard: <b>WASD</b> drive · <b>Space</b> jump · <b>Shift</b> boost · <b>Ctrl</b> powerslide/air roll · <b>Q/E</b> air roll · <b>C</b> ball cam</span><span>Gamepad supported</span>`);
      foot.style.fontSize = '13px';
      p.appendChild(foot);
    });
  }

  // ----------------------------------------------------------------------
  matchSetup() {
    const s = this.settings;
    this.show((p) => {
      p.innerHTML = `<h2>Match setup</h2>`;
      const row = el('div', 'row section');
      row.appendChild(this.segField('Team size', [1, 2, 3].map((n) => ({ v: n, label: `${n}v${n}` })), s.teamSize, (v) => (s.teamSize = v)));
      row.appendChild(this.segField('Match length', [{ v: 120, label: '2 min' }, { v: 300, label: '5 min' }, { v: 600, label: '10 min' }], s.duration, (v) => (s.duration = v)));
      row.appendChild(this.segField('Your team', [{ v: 0, label: 'Blue' }, { v: 1, label: 'Orange' }], s.humanTeam, (v) => (s.humanTeam = v)));
      row.appendChild(this.segField('Boost', [{ v: 'normal', label: 'Normal' }, { v: 'unlimited', label: 'Unlimited' }], s.boostMutator, (v) => (s.boostMutator = v)));
      p.appendChild(row);
      p.appendChild(el('h3', 'section', 'Bot difficulty'));
      const grid = el('div', 'menu-grid');
      const descs = {
        rookie: 'Slow reactions, no aerials, wasteful. Learn the controls.',
        pro: 'Solid positioning, shadows you, jump shots. Fair fight for most players.',
        allstar: 'Fast, boosts well, aerials up to ~1200 uu, speed flips on kickoff, rotates. A real challenge.',
        champion: 'Near-instant reactions, high aerials, demos, tight defence. Beating this consistently means you are genuinely good.',
      };
      for (const key of Object.keys(SKILLS)) {
        const card = el('div', 'card' + (s.difficulty === key ? ' selected' : ''), `<h3>${SKILLS[key].name}</h3><p>${descs[key]}</p>`);
        card.onclick = () => {
          s.difficulty = key;
          grid.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          this.app.audio.ui();
        };
        grid.appendChild(card);
      }
      p.appendChild(grid);
      const btns = el('div', 'row between section');
      const back = el('button', 'ghost', 'Back');
      back.onclick = () => this.main();
      const start = el('button', 'primary', 'Start match');
      start.onclick = () => {
        this.save();
        this.app.startGame({ mode: 'match', teamSize: s.teamSize, difficulty: s.difficulty, duration: s.duration, humanTeam: s.humanTeam, mutators: { boost: s.boostMutator }, replays: s.replays !== false });
      };
      btns.appendChild(back);
      btns.appendChild(start);
      p.appendChild(btns);
    });
  }

  segField(label, options, value, onChange) {
    const f = el('div', 'field');
    f.appendChild(el('label', '', label));
    const seg = el('div', 'seg');
    for (const o of options) {
      const b = el('button', o.v === value ? 'on' : '', o.label);
      b.onclick = () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onChange(o.v);
        this.app.audio.ui();
      };
      seg.appendChild(b);
    }
    f.appendChild(seg);
    return f;
  }

  // ----------------------------------------------------------------------
  training() {
    const s = this.settings;
    const prog = loadProgress();
    this.show((p) => {
      p.innerHTML = `<h2>Training</h2><p class="muted">Each drill has 5 levels. Land 8 of your last 10 attempts and it levels up automatically. Your accuracy and streaks are saved.</p>`;
      const grid = el('div', 'menu-grid');
      let selected = s.lastDrill;
      for (const d of DRILLS) {
        const pr = prog[d.id];
        const stat = pr && pr.attempts ? `${Math.round((pr.successes / pr.attempts) * 100)}% over ${pr.attempts} attempts · best streak ${pr.best}` : 'Not attempted yet';
        const card = el('div', 'card' + (selected === d.id ? ' selected' : ''), `<div class="icon">${d.icon}</div><h3>${d.name}</h3><p>${d.desc}</p><div class="stat">${stat}</div>`);
        card.onclick = () => {
          selected = d.id;
          s.lastDrill = d.id;
          grid.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          tipBox.textContent = '💡 ' + d.tip;
          this.app.audio.ui();
        };
        grid.appendChild(card);
      }
      p.appendChild(grid);
      const tipBox = el('div', 'tip section', '💡 ' + (DRILLS.find((d) => d.id === selected) || DRILLS[0]).tip);
      p.appendChild(tipBox);
      const row = el('div', 'row between section');
      const left = el('div', 'row');
      left.appendChild(this.segField('Start level', [1, 2, 3, 4, 5].map((n) => ({ v: n, label: String(n) })), s.drillLevel, (v) => (s.drillLevel = v)));
      left.appendChild(this.segField('Your team', [{ v: 0, label: 'Blue' }, { v: 1, label: 'Orange' }], s.humanTeam, (v) => (s.humanTeam = v)));
      row.appendChild(left);
      const right = el('div', 'row');
      const back = el('button', 'ghost', 'Back');
      back.onclick = () => this.main();
      const start = el('button', 'primary', 'Start drill');
      start.onclick = () => {
        this.save();
        const d = DRILLS.find((x) => x.id === selected);
        this.app.startGame({ mode: 'drill', drill: selected, level: s.drillLevel, humanTeam: s.humanTeam, teamSize: 1, difficulty: 'champion', drillBots: d.hasBots });
      };
      right.appendChild(back);
      right.appendChild(start);
      row.appendChild(right);
      p.appendChild(row);
    });
  }

  // ----------------------------------------------------------------------
  progress() {
    const prog = loadProgress();
    const matches = JSON.parse(localStorage.getItem('rocketgoal.matches') || '[]');
    this.show((p) => {
      p.innerHTML = `<h2>Progress</h2>`;
      p.appendChild(el('h3', 'section', 'Drills'));
      const grid = el('div', 'progress-grid');
      for (const d of DRILLS) {
        const pr = prog[d.id];
        const acc = pr && pr.attempts ? Math.round((pr.successes / pr.attempts) * 100) + '%' : '—';
        const levels = pr ? Object.keys(pr.levelBest || {}).map(Number) : [];
        const maxLevel = levels.length ? Math.max(...levels) : '—';
        grid.appendChild(el('div', 'p', `<b>${d.icon} ${d.name}</b>Accuracy ${acc}<br>Attempts ${pr?.attempts || 0}<br>Best streak ${pr?.best || 0}<br>Highest level ${maxLevel}${pr?.bestTime ? `<br>Best time ${pr.bestTime.toFixed(2)}s` : ''}`));
      }
      p.appendChild(grid);
      p.appendChild(el('h3', 'section', 'Recent matches'));
      if (!matches.length) p.appendChild(el('p', 'muted', 'No matches played yet.'));
      else {
        const tbl = el('table', 'stats');
        tbl.innerHTML = `<tr><th>When</th><th>Mode</th><th>Bots</th><th>Result</th><th>Goals</th><th>Saves</th><th>Shots</th><th>Boost avg</th><th>Goal-side</th></tr>` + matches
          .slice(-12)
          .reverse()
          .map((m) => `<tr><td>${new Date(m.date).toLocaleString()}</td><td>${m.teamSize}v${m.teamSize}</td><td>${m.difficulty}</td><td style="color:${m.won ? 'var(--good)' : m.draw ? 'var(--muted)' : 'var(--danger)'}">${m.score}</td><td>${m.goals}</td><td>${m.saves}</td><td>${m.shots}</td><td>${Math.round(m.avgBoost)}</td><td>${Math.round(m.goalSide * 100)}%</td></tr>`)
          .join('');
        p.appendChild(tbl);
      }
      const row = el('div', 'row between section');
      const back = el('button', 'ghost', 'Back');
      back.onclick = () => this.main();
      const clear = el('button', 'danger small', 'Reset all progress');
      clear.onclick = () => {
        if (confirm('Delete all saved progress?')) {
          localStorage.removeItem('rocketgoal.training.v1');
          localStorage.removeItem('rocketgoal.matches');
          this.progress();
        }
      };
      row.appendChild(back);
      row.appendChild(clear);
      p.appendChild(row);
    });
  }

  // ----------------------------------------------------------------------
  settingsScreen(fromPause = false) {
    const s = this.settings;
    const input = this.app.input;
    let tab = 'controls';
    const render = () => {
      this.show((p) => {
        p.innerHTML = `<h2>Settings</h2>`;
        const tabs = el('div', 'tabs section');
        for (const t of ['controls', 'camera', 'game']) {
          const b = el('button', t === tab ? 'on' : '', t);
          b.onclick = () => {
            tab = t;
            render();
          };
          tabs.appendChild(b);
        }
        p.appendChild(tabs);
        if (tab === 'controls') {
          const row = el('div', 'row');
          row.appendChild(this.segField('Preset', Object.keys(PRESETS).map((k) => ({ v: k, label: PRESETS[k].name })), input.presetName, (v) => {
            input.setPreset(v);
            render();
          }));
          p.appendChild(row);
          const grid = el('div', 'bind-grid section');
          for (const action of Object.keys(BIND_LABELS)) {
            grid.appendChild(el('div', '', BIND_LABELS[action]));
            const b = el('button', 'small', input.binds[action].map(prettyCode).join(' / '));
            b.onclick = () => {
              b.textContent = 'Press a key…';
              b.classList.add('listening');
              const onKey = (e) => {
                e.preventDefault();
                cleanup();
                input.rebind(action, e.code);
                render();
              };
              const onMouse = (e) => {
                if (e.target === b) return;
                e.preventDefault();
                cleanup();
                input.rebind(action, 'Mouse' + e.button);
                render();
              };
              const cleanup = () => {
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('mousedown', onMouse, true);
              };
              setTimeout(() => {
                window.addEventListener('keydown', onKey, true);
                window.addEventListener('mousedown', onMouse, true);
              }, 50);
            };
            grid.appendChild(b);
          }
          p.appendChild(grid);
          p.appendChild(el('p', 'muted section', 'Gamepad (Xbox layout): RT throttle · LT reverse · A jump · B boost · X powerslide / air roll · LB/RB air roll left/right · Y ball cam · Start pause. Plug in and press any button.'));
        } else if (tab === 'camera') {
          const cam = s.camera;
          const fields = [
            ['fov', 'Field of view', 60, 110, 1],
            ['distance', 'Distance', 100, 400, 10],
            ['height', 'Height', 40, 200, 10],
            ['angle', 'Angle', -15, 0, 1],
            ['stiffness', 'Stiffness', 0, 1, 0.05],
            ['swivel', 'Swivel speed', 1, 10, 0.5],
          ];
          const grid = el('div', 'bind-grid section');
          for (const [key, label, min, max, step] of fields) {
            grid.appendChild(el('div', '', `${label} <span class="muted">(${cam[key]})</span>`));
            const r = document.createElement('input');
            r.type = 'range';
            r.min = min;
            r.max = max;
            r.step = step;
            r.value = cam[key];
            r.oninput = () => {
              cam[key] = parseFloat(r.value);
              this.app.renderer.setCameraSettings(cam);
              grid.children[Array.from(grid.children).indexOf(r) - 1].innerHTML = `${label} <span class="muted">(${cam[key]})</span>`;
              this.save();
            };
            grid.appendChild(r);
          }
          p.appendChild(grid);
          const row = el('div', 'row section');
          for (const k of Object.keys(CAMERA_PRESETS)) {
            const b = el('button', 'small', `Preset: ${k}`);
            b.onclick = () => {
              Object.assign(cam, CAMERA_PRESETS[k]);
              this.app.renderer.setCameraSettings(cam);
              this.save();
              render();
            };
            row.appendChild(b);
          }
          p.appendChild(row);
        } else {
          const grid = el('div', 'bind-grid section');
          grid.appendChild(el('div', '', 'Master volume'));
          const vol = document.createElement('input');
          vol.type = 'range';
          vol.min = 0;
          vol.max = 1;
          vol.step = 0.05;
          vol.value = s.volume;
          vol.oninput = () => {
            s.volume = parseFloat(vol.value);
            this.app.audio.setVolume(s.volume);
            this.save();
          };
          grid.appendChild(vol);
          grid.appendChild(el('div', '', 'Graphics quality'));
          const q = el('div', 'seg');
          for (const [v, label] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
            const b = el('button', (s.quality || 'high') === v ? 'on' : '', label);
            b.onclick = () => {
              s.quality = v;
              this.app.renderer.setQuality(v);
              this.save();
              render();
            };
            q.appendChild(b);
          }
          grid.appendChild(q);
          grid.appendChild(el('div', '', 'Goal replays'));
          grid.appendChild(this.toggle(s.replays !== false, (v) => (s.replays = v)));
          grid.appendChild(el('div', '', 'Live coach tips during matches'));
          grid.appendChild(this.toggle(s.coach, (v) => (s.coach = v)));
          grid.appendChild(el('div', '', 'Ball prediction line (training aid, toggle with P)'));
          grid.appendChild(this.toggle(s.showPrediction, (v) => {
            s.showPrediction = v;
            this.app.renderer.showPrediction = v;
          }));
          grid.appendChild(el('div', '', 'Player name'));
          const name = document.createElement('input');
          name.type = 'text';
          name.value = s.playerName;
          name.maxLength = 12;
          name.onchange = () => {
            s.playerName = name.value || 'You';
            this.save();
          };
          grid.appendChild(name);
          p.appendChild(grid);
        }
        const row = el('div', 'row between section');
        const back = el('button', 'ghost', 'Back');
        back.onclick = () => {
          this.save();
          fromPause ? this.pause() : this.main();
        };
        row.appendChild(back);
        p.appendChild(row);
      });
    };
    render();
  }

  toggle(value, onChange) {
    const seg = el('div', 'seg');
    const on = el('button', value ? 'on' : '', 'On');
    const off = el('button', value ? '' : 'on', 'Off');
    on.onclick = () => {
      on.classList.add('on');
      off.classList.remove('on');
      onChange(true);
      this.save();
    };
    off.onclick = () => {
      off.classList.add('on');
      on.classList.remove('on');
      onChange(false);
      this.save();
    };
    seg.appendChild(on);
    seg.appendChild(off);
    return seg;
  }

  // ----------------------------------------------------------------------
  howTo() {
    const input = this.app.input;
    const b = (a) => input.binds[a].map(prettyCode).join(' / ');
    this.show((p) => {
      p.innerHTML = `<h2>How to play</h2>`;
      p.appendChild(el('h3', 'section', 'Controls'));
      const list = el('div', 'controls-list');
      for (const a of Object.keys(BIND_LABELS)) list.appendChild(el('div', '', `<span>${BIND_LABELS[a]}</span><kbd>${b(a)}</kbd>`));
      list.appendChild(el('div', '', `<span>Pause / menu</span><kbd>Esc</kbd>`));
      list.appendChild(el('div', '', `<span>Toggle prediction line</span><kbd>P</kbd>`));
      list.appendChild(el('div', '', `<span>Reset ball (free play / drills)</span><kbd>T</kbd>`));
      p.appendChild(list);
      p.appendChild(el('h3', 'section', 'Mechanics'));
      p.appendChild(
        el(
          'div',
          'muted',
          `<p><b>Jump &amp; flip:</b> press jump once to jump; press it again in the air within 1.25s while holding a direction to <b>flip</b> (dodge) that way. Flips add speed on the ground and power to shots. Holding no direction gives a <b>double jump</b>.</p>
           <p><b>Aerials:</b> jump, hold jump briefly for extra height, pull the nose up (S / stick back) and boost. Small corrections early beat big corrections late.</p>
           <p><b>Powerslide:</b> hold it while turning to drift. Tap it when landing at an angle to keep speed.</p>
           <p><b>Air roll:</b> Q/E (or hold powerslide + steer) rotate the car around its long axis. Land on your wheels to keep momentum.</p>
           <p><b>Speed flip:</b> diagonal flip, then cancel by pulling back — the fastest way to get to a ball. Practice on kickoffs.</p>
           <p><b>Wavedash:</b> flip just as your wheels touch the ground after a small hop to get a burst of speed for free.</p>`
        )
      );
      p.appendChild(el('h3', 'section', 'Getting better (what the bots punish)'));
      p.appendChild(
        el(
          'div',
          'muted',
          `<ul style="line-height:1.6">
            <li><b>Stay goal-side.</b> If you cannot win the race to the ball, do not go. Shadow back at the ball's speed.</li>
            <li><b>Never clear up the middle.</b> Corners buy time.</li>
            <li><b>Boost is time.</b> Pick up small pads along your path instead of driving out of position for big ones.</li>
            <li><b>Hit the ball where you want it to go.</b> Approach from behind on the line ball → target.</li>
            <li><b>Kickoffs decide 1v1s.</b> Practice them until you win 70%.</li>
            <li>Play the <b>Pro</b> bot until you win comfortably, then <b>All-Star</b>, then <b>Grand Champion</b>.</li>
          </ul>`
        )
      );
      const row = el('div', 'row between section');
      const back = el('button', 'ghost', 'Back');
      back.onclick = () => this.main();
      row.appendChild(back);
      p.appendChild(row);
    });
  }

  // ----------------------------------------------------------------------
  pause() {
    this.show((p) => {
      p.innerHTML = `<h2>Paused</h2>`;
      const col = el('div', 'row section');
      const resume = el('button', 'primary', 'Resume');
      resume.onclick = () => this.app.resume();
      const restart = el('button', '', 'Restart');
      restart.onclick = () => this.app.restart();
      const settings = el('button', '', 'Settings');
      settings.onclick = () => this.settingsScreen(true);
      const quit = el('button', 'danger', 'Quit to menu');
      quit.onclick = () => this.app.quitToMenu();
      col.append(resume, restart, settings, quit);
      p.appendChild(col);
      const g = this.app.game;
      if (g && g.human) {
        const h = g.human.stats;
        p.appendChild(el('h3', 'section', 'Your stats so far'));
        p.appendChild(el('div', 'kv', `<span>Touches</span><span>${h.touches}</span><span>Shots</span><span>${h.shots}</span><span>Goals</span><span>${h.goals}</span><span>Saves</span><span>${h.saves}</span><span>Boost used</span><span>${Math.round(h.boostUsed)}</span><span>Avg speed</span><span>${Math.round(h.speedSamples ? h.speedSum / h.speedSamples : 0)}</span>`));
      }
      if (g && g.drill) {
        const row = el('div', 'row section');
        for (const l of [1, 2, 3, 4, 5]) {
          const b = el('button', 'small' + (g.drill.level === l ? ' primary' : ''), `Level ${l}`);
          b.onclick = () => {
            g.drill.level = l;
            g.drill.results = [];
            this.app.resume();
            g.drill.nextAttempt();
          };
          row.appendChild(b);
        }
        p.appendChild(el('h3', 'section', 'Drill level'));
        p.appendChild(row);
      }
      p.appendChild(el('p', 'muted section', 'Press Esc to resume.'));
    });
  }

  // ----------------------------------------------------------------------
  results(stats, report, config) {
    this.show((p) => {
      const h = stats.cars.find((c) => c.isHuman);
      const won = h && stats.score[h.team] > stats.score[1 - h.team];
      const draw = stats.score[0] === stats.score[1];
      p.innerHTML = `<h2 style="color:${won ? 'var(--good)' : draw ? 'var(--muted)' : 'var(--danger)'}">${won ? 'Victory' : draw ? 'Draw' : 'Defeat'} <span class="muted" style="font-size:20px">${stats.score[0]} – ${stats.score[1]}${stats.overtime ? ' (OT)' : ''}</span></h2>`;
      // MVP: top scorer on the winning team (RL rule); on a draw, the top scorer overall
      const winTeam = draw ? -1 : stats.score[0] > stats.score[1] ? 0 : 1;
      const mvp = stats.cars
        .filter((c) => winTeam < 0 || c.team === winTeam)
        .reduce((a, c) => (!a || c.score > a.score ? c : a), null);
      const tbl = el('table', 'stats section');
      tbl.innerHTML =
        `<tr><th>Player</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Touches</th><th>Demos</th><th>Avg boost</th><th>Avg speed</th></tr>` +
        stats.cars
          .slice()
          .sort((a, b) => a.team - b.team || b.score - a.score)
          .map((c) => `<tr class="${c.team === 0 ? 'blue' : 'orange'}${c.isHuman ? ' me' : ''}"><td>${c.name}${c.isBot ? '' : ' (you)'}${c === mvp ? ' <span class="mvp">MVP</span>' : ''}</td><td>${c.score}</td><td>${c.goals}</td><td>${c.assists}</td><td>${c.saves}</td><td>${c.shots}</td><td>${c.touches}</td><td>${c.demos}</td><td>${Math.round(c.avgBoost)}</td><td>${Math.round(c.avgSpeed)}</td></tr>`)
          .join('');
      p.appendChild(tbl);
      p.appendChild(el('h3', 'section', 'Coach report'));
      const rep = el('div', 'report');
      for (const r of report) rep.appendChild(el('div', 'item ' + r.grade, `<b>${r.title}</b>${r.text}`));
      p.appendChild(rep);
      const row = el('div', 'row between section');
      const menu = el('button', 'ghost', 'Main menu');
      menu.onclick = () => this.app.quitToMenu();
      const again = el('button', 'primary', 'Rematch');
      again.onclick = () => this.app.startGame(config);
      row.append(menu, again);
      p.appendChild(row);
    });
  }

  drillSummary(drill, config) {
    this.show((p) => {
      p.innerHTML = `<h2>${drill.meta.icon} ${drill.meta.name} — session</h2>`;
      const last = drill.results.slice(-20);
      p.appendChild(el('div', 'kv section', `<span>Attempts</span><span>${drill.attempts}</span><span>Successes</span><span>${drill.successes}</span><span>Accuracy</span><span>${Math.round(drill.accuracy * 100)}%</span><span>Best streak</span><span>${drill.bestStreak}</span><span>Level reached</span><span>${drill.level}</span>`));
      const fails = {};
      for (const r of drill.results) if (!r.ok && r.feedback) fails[r.feedback] = (fails[r.feedback] || 0) + 1;
      const topFail = Object.entries(fails).sort((a, b) => b[1] - a[1])[0];
      p.appendChild(el('div', 'tip section', topFail ? `Most common miss (${topFail[1]}×): ${topFail[0]}<br><br>💡 ${drill.meta.tip}` : `💡 ${drill.meta.tip}`));
      void last;
      const row = el('div', 'row between section');
      const menu = el('button', 'ghost', 'Training menu');
      menu.onclick = () => this.training();
      const again = el('button', 'primary', 'Go again');
      again.onclick = () => this.app.startGame({ ...config, level: drill.level });
      row.append(menu, again);
      p.appendChild(row);
    });
  }
}
