import { ARENA, TEAM, TEAM_NAMES, CAR } from '../constants.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class HUD {
  constructor(root) {
    this.root = el('div');
    this.root.id = 'hud';
    root.appendChild(this.root);

    this.scoreboard = el('div', 'scoreboard');
    this.scoreboard.innerHTML = `<div class="team blue">0</div><div class="clock"><span class="t">5:00</span><small></small></div><div class="team orange">0</div>`;
    this.root.appendChild(this.scoreboard);

    this.boost = el('div', 'boost');
    this.boost.innerHTML = `<div class="ring" style="--p:33%"></div><div class="amount"><span>33</span><small>BOOST</small></div>`;
    this.root.appendChild(this.boost);

    this.speedo = el('div', 'speedo');
    this.speedo.innerHTML = `<div class="val">0</div><small>UU/S</small><div class="bar"><i style="width:0%"></i></div>`;
    this.root.appendChild(this.speedo);

    this.status = el('div', 'status');
    this.root.appendChild(this.status);

    this.centerMsg = el('div', 'center-msg hidden');
    this.root.appendChild(this.centerMsg);

    this.feed = el('div', 'feed');
    this.root.appendChild(this.feed);

    this.coach = el('div', 'coach hidden');
    this.root.appendChild(this.coach);

    this.drillHud = el('div', 'drill-hud hidden');
    this.root.appendChild(this.drillHud);

    this.hint = el('div', 'hint', `<kbd>Esc</kbd> menu &nbsp; <kbd>Tab</kbd> scoreboard &nbsp; <kbd>P</kbd> prediction &nbsp; <kbd>T</kbd> reset ball`);
    this.root.appendChild(this.hint);

    this.replayBanner = el('div', 'replay hidden', `<span class="rec">●</span> REPLAY <small>0.5×</small>`);
    this.root.appendChild(this.replayBanner);
    this.vignette = el('div', 'vignette');
    this.root.appendChild(this.vignette);

    // RL-style stat pop-ups ("+50 SAVE") stacked above the boost gauge
    this.stats = el('div', 'stat-pops');
    this.root.appendChild(this.stats);
    this.statItems = [];

    // hold Tab (or the scoreboard button on a pad) for the live scoreboard
    this.board = el('div', 'board hidden');
    this.root.appendChild(this.board);
    this.boardVisible = false;

    this.minimap = document.createElement('canvas');
    this.minimap.className = 'minimap';
    this.minimap.width = 180 * 2;
    this.minimap.height = 130 * 2;
    this.root.appendChild(this.minimap);

    this.msgTimer = 0;
    this.coachTimer = 0;
    this.feedItems = [];
  }

  setVisible(v) {
    this.root.classList.toggle('hidden', !v);
  }

  setReplay(on) {
    this.replayBanner.classList.toggle('hidden', !on);
    this.root.classList.toggle('in-replay', on);
  }

  showMessage(html, cls = '', seconds = 2) {
    this.centerMsg.innerHTML = html;
    this.centerMsg.className = 'center-msg ' + cls;
    this.msgTimer = seconds;
  }

  addFeed(html, seconds = 4) {
    const item = el('div', 'item', html);
    this.feed.appendChild(item);
    this.feedItems.push({ item, t: seconds });
    while (this.feedItems.length > 5) {
      const old = this.feedItems.shift();
      old.item.remove();
    }
  }

  addStat(label, points, mine = true, seconds = 2.2) {
    const item = el('div', 'pop' + (mine ? ' mine' : ''), `<b>+${points}</b> ${label}`);
    this.stats.appendChild(item);
    this.statItems.push({ item, t: seconds });
    while (this.statItems.length > 4) this.statItems.shift().item.remove();
  }

  setBoard(on, game) {
    if (on === this.boardVisible && !on) return;
    this.boardVisible = on;
    this.board.classList.toggle('hidden', !on);
    if (!on || !game) return;
    const rows = game.cars
      .map((c) => ({ c, s: c.stats }))
      .sort((a, b) => a.c.team - b.c.team || b.s.score - a.s.score);
    const row = (r) => {
      const c = r.c;
      const s = r.s;
      return `<tr class="${c.team === 0 ? 'blue' : 'orange'}${c === game.human ? ' me' : ''}"><td>${c.name}${c === game.human ? ' (you)' : ''}</td><td>${s.score}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.saves}</td><td>${s.shots}</td><td>${Math.round(c.boost)}</td></tr>`;
    };
    const head = `<tr><th>Player</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Boost</th></tr>`;
    const blue = rows.filter((r) => r.c.team === 0).map(row).join('');
    const orange = rows.filter((r) => r.c.team === 1).map(row).join('');
    this.board.innerHTML = `<div class="head"><span class="blue">BLUE ${game.score[0]}</span><span class="muted">${game.overtime ? 'OVERTIME' : ''}</span><span class="orange">${game.score[1]} ORANGE</span></div><table>${head}${blue}<tr class="gap"><td colspan="7"></td></tr>${orange}</table>`;
  }

  showCoach(text, seconds = 6) {
    this.coach.innerHTML = `<b>Coach</b>${text}`;
    this.coach.classList.remove('hidden');
    this.coachTimer = seconds;
  }

  update(game, dt, input, view) {
    const human = game.human;
    // scoreboard
    const teams = this.scoreboard.querySelectorAll('.team');
    teams[0].textContent = game.score[0];
    teams[1].textContent = game.score[1];
    const clock = this.scoreboard.querySelector('.clock');
    const t = this.scoreboard.querySelector('.t');
    const small = this.scoreboard.querySelector('small');
    if (game.clock === Infinity) {
      t.textContent = game.drill ? '∞' : 'FREE';
      small.textContent = game.drill ? 'TRAINING' : 'PLAY';
    } else {
      const secs = Math.ceil(game.clock);
      t.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      small.textContent = game.overtime ? 'OVERTIME' : game.clock < 30 && !game.overtime ? 'FINAL 30' : '';
    }
    clock.classList.toggle('ot', game.overtime);
    this.scoreboard.classList.toggle('hidden', !!game.drill && game.drill.id !== 'kickoffs');

    if (human) {
      const b = Math.round(human.boost);
      this.boost.querySelector('.ring').style.setProperty('--p', b + '%');
      this.boost.querySelector('.amount span').textContent = b;
      this.boost.classList.toggle('low', b < 15);
      const sp = Math.round(human.speed);
      const val = this.speedo.querySelector('.val');
      val.textContent = sp;
      val.classList.toggle('ss', human.supersonic);
      this.speedo.querySelector('.bar i').style.width = Math.min(100, (sp / CAR.MAX_SPEED) * 100) + '%';
      this.vignette.style.opacity = human.supersonic ? 0.55 : human.boostActive ? 0.25 : 0;
      const pills = [];
      pills.push(`<span class="pill ${view.ballCam ? 'on' : ''}">${view.ballCam ? 'Ball cam' : 'Car cam'}</span>`);
      if (!human.onGround) pills.push(`<span class="pill ${human.hasFlip ? 'flip' : ''}">${human.hasFlip ? 'Flip ready' : 'No flip'}</span>`);
      if (human.supersonic) pills.push(`<span class="pill on">Supersonic</span>`);
      if (input.usingGamepad) pills.push(`<span class="pill">Gamepad</span>`);
      this.status.innerHTML = pills.join(' ');
    }

    // centre message
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.centerMsg.classList.add('hidden');
    }
    if (game.state === 'countdown') {
      const n = Math.ceil(game.stateTimer);
      this.centerMsg.innerHTML = n > 0 ? `${n}` : 'GO!';
      this.centerMsg.className = 'center-msg';
      this.msgTimer = 0.5;
    }
    // coach
    if (this.coachTimer > 0) {
      this.coachTimer -= dt;
      if (this.coachTimer <= 0) this.coach.classList.add('hidden');
    }
    // stat pop-ups
    for (let i = this.statItems.length - 1; i >= 0; i--) {
      const f = this.statItems[i];
      f.t -= dt;
      if (f.t <= 0) {
        f.item.remove();
        this.statItems.splice(i, 1);
      } else if (f.t < 0.4) f.item.style.opacity = f.t * 2.5;
    }
    if (this.boardVisible && game.frame % 15 === 0) this.setBoard(true, game);
    // feed
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const f = this.feedItems[i];
      f.t -= dt;
      if (f.t <= 0) {
        f.item.remove();
        this.feedItems.splice(i, 1);
      } else if (f.t < 0.5) f.item.style.opacity = f.t * 2;
    }
    // drill HUD
    if (game.drill) {
      const d = game.drill;
      this.drillHud.classList.remove('hidden');
      const lines = d.hudLines().filter(Boolean);
      this.drillHud.innerHTML = `<h3>${d.meta.icon} ${d.meta.name}</h3>${lines.map((l) => `<div>${l}</div>`).join('')}<div class="acc"><i style="width:${Math.round(d.accuracy * 100)}%"></i></div>${d.messageTimer > 0 ? `<div style="color:var(--accent);margin-top:6px">${d.message}</div>` : ''}`;
    } else this.drillHud.classList.add('hidden');

    this.drawMinimap(game);
  }

  drawMinimap(game) {
    const cv = this.minimap;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // field drawn horizontally: x axis = field z (length), y axis = field x (width)
    const pad = 10;
    const fw = W - pad * 2;
    const fh = H - pad * 2;
    const sx = fw / (ARENA.HALF_LENGTH * 2);
    const sy = fh / (ARENA.HALF_WIDTH * 2);
    const px = (z) => pad + (z + ARENA.HALF_LENGTH) * sx;
    const py = (x) => pad + (-x + ARENA.HALF_WIDTH) * sy;
    ctx.fillStyle = 'rgba(8,12,24,0.7)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(pad, pad, fw, fh, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(0), pad);
    ctx.lineTo(px(0), H - pad);
    ctx.stroke();
    // goals
    ctx.fillStyle = 'rgba(42,108,255,0.7)';
    ctx.fillRect(px(-ARENA.HALF_LENGTH) - 6, py(ARENA.GOAL_HALF_WIDTH), 6, ARENA.GOAL_HALF_WIDTH * 2 * sy);
    ctx.fillStyle = 'rgba(255,138,31,0.7)';
    ctx.fillRect(px(ARENA.HALF_LENGTH), py(ARENA.GOAL_HALF_WIDTH), 6, ARENA.GOAL_HALF_WIDTH * 2 * sy);
    // pads
    for (const p of game.pads) {
      if (!p.big) continue;
      ctx.fillStyle = p.active ? 'rgba(255,190,60,0.9)' : 'rgba(255,190,60,0.2)';
      ctx.beginPath();
      ctx.arc(px(p.z), py(p.x), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // cars
    for (const c of game.cars) {
      if (c.demolished) continue;
      const f = c.getForward();
      const x = px(c.pos.z);
      const y = py(c.pos.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-f.x, f.z));
      ctx.fillStyle = c.team === TEAM.BLUE ? '#5b9bff' : '#ffa552';
      if (c === game.human) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
      }
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -5);
      ctx.lineTo(-6, 5);
      ctx.closePath();
      ctx.fill();
      if (c === game.human) ctx.stroke();
      ctx.restore();
    }
    // ball
    const b = game.ball;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px(b.pos.z), py(b.pos.x), 4 + Math.min(4, b.pos.y / 400), 0, Math.PI * 2);
    ctx.fill();
  }
}

export { TEAM_NAMES };
