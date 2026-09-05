// Real-time and post-match coaching feedback. Watches the human car and
// produces actionable tips like a coach watching over your shoulder.
import { ARENA, BALL, TEAM } from './constants.js';

export class Coach {
  constructor(game) {
    this.game = game;
    this.tips = []; // live tips queue
    this.cooldowns = new Map();
    this.counters = {
      doubleCommit: 0,
      ballChase: 0,
      wastedBoost: 0,
      overcommit: 0,
      lateRotation: 0,
      goodShadow: 0,
      whiffs: 0,
      openNetMiss: 0,
      goodClears: 0,
      centeredClears: 0,
      noBoostChallenges: 0,
      aerialAttempts: 0,
      aerialHits: 0,
      goodPowerShots: 0,
      weakShots: 0,
    };
    this.lastEval = 0;
    this.airborneStart = null;
    this.lastHumanTouch = null;
    this.behindBallSamples = 0;
    this.samples = 0;
    this.game.on('touch', (e) => this.onTouch(e));
    this.game.on('goal', (e) => this.onGoal(e));
  }

  say(id, text, cooldown = 25, priority = 1) {
    const now = this.game.time;
    const last = this.cooldowns.get(id) || -Infinity;
    if (now - last < cooldown) return;
    this.cooldowns.set(id, now);
    this.tips.push({ text, priority, time: now });
    if (this.tips.length > 3) this.tips.shift();
    this.game.emit('coach', { text, id });
  }

  onTouch({ car }) {
    const g = this.game;
    if (car !== g.human) return;
    this.lastHumanTouch = g.time;
    const h = g.human;
    const b = g.ball;
    const atk = h.team === TEAM.BLUE ? 1 : -1;
    const speedAfter = b.vel.length();
    const towardEnemy = b.vel.z * atk > 0;
    const inOwnThird = b.pos.z * atk < -ARENA.HALF_LENGTH / 3;
    const inEnemyThird = b.pos.z * atk > ARENA.HALF_LENGTH / 3;
    if (h.pos.y > 300) {
      this.counters.aerialHits++;
    }
    // clears
    if (inOwnThird && towardEnemy) {
      if (Math.abs(b.vel.x) > speedAfter * 0.45 || Math.abs(b.pos.x) > 1500) {
        this.counters.goodClears++;
      } else {
        this.counters.centeredClears++;
        this.say('centeredClear', 'Clear to the corners, not up the middle — centred clears become their shot.', 40);
      }
    }
    // shot quality
    if (inEnemyThird && towardEnemy) {
      if (speedAfter > 2000) this.counters.goodPowerShots++;
      else if (speedAfter < 1100) {
        this.counters.weakShots++;
        this.say('weakShot', 'Soft shot. Get more speed into the ball: flip into it or hit it with the nose while boosting.', 35);
      }
    }
    // challenge with no boost
    if (h.boost < 5 && speedAfter < 900 && !inEnemyThird) {
      this.counters.noBoostChallenges++;
      this.say('noBoost', "You're challenging with no boost. Pick up pads on your way back so you can commit with power.", 40);
    }
  }

  onGoal(e) {
    const g = this.game;
    const h = g.human;
    if (!h) return;
    if (e.team !== h.team) {
      // conceded — where were you?
      const atk = h.team === TEAM.BLUE ? 1 : -1;
      const inEnemyHalf = h.pos.z * atk > 0;
      if (inEnemyHalf && g.config.teamSize === 1) {
        this.counters.overcommit++;
        this.say('concededUpfield', "Conceded while you were upfield. In 1v1, if you can't beat them to the ball, shadow back instead of chasing.", 5, 2);
      } else if (h.boost < 10) {
        this.say('concededNoBoost', 'Conceded with no boost. Defenders need boost to save fast shots — collect on the way back.', 5, 2);
      } else {
        const mates = g.cars.filter((c) => c.team === h.team && c !== h);
        if (mates.length && mates.every((m) => m.pos.z * atk > 0) && inEnemyHalf) {
          this.counters.doubleCommit++;
          this.say('doubleCommit', 'Whole team was upfield on that goal. Someone always stays back.', 5, 2);
        }
      }
    } else if (e.scorer === h && !e.ownGoal) {
      if (e.speed > 3000) this.say('rocket', 'Absolute rocket! That is how you finish.', 5);
    }
  }

  update(dt) {
    const g = this.game;
    const h = g.human;
    if (!h || g.state !== 'play') return;
    const b = g.ball;
    const atk = h.team === TEAM.BLUE ? 1 : -1;
    this.samples++;
    const goalSide = (b.pos.z - h.pos.z) * atk > 0; // we are between ball and own goal
    if (goalSide) this.behindBallSamples++;

    // periodic evaluation every 2s
    if (g.time - this.lastEval < 2) return;
    this.lastEval = g.time;

    // boost wasted at supersonic
    if (h.stats.wastedBoost > 8 && h.stats.wastedBoost - (this._lastWasted || 0) > 8) {
      this._lastWasted = h.stats.wastedBoost;
      this.counters.wastedBoost++;
      this.say('wastedBoost', "You're boosting while already supersonic. Feather it — save boost for the next play.", 45);
    }

    // ball chasing: both teammates near the ball while the net is open
    const mates = g.cars.filter((c) => c.team === h.team && c !== h && !c.demolished);
    if (mates.length) {
      const closeToBall = h.pos.distanceTo(b.pos) < 1400;
      const mateClose = mates.some((m) => m.pos.distanceTo(b.pos) < 1400);
      const ownGoalZ = -atk * ARENA.HALF_LENGTH;
      const anyoneBack = [h, ...mates].some((c) => Math.abs(c.pos.z - ownGoalZ) < 3000);
      if (closeToBall && mateClose && !anyoneBack && b.pos.z * atk > 0) {
        this.counters.doubleCommit++;
        this.say('doubleCommit2', 'Double commit! Your teammate has the ball — rotate back and get boost.', 30);
      }
    }
    // 1v1 overcommit: we're in the enemy half, the opponent is closer to the ball than us, and the ball is behind us
    if (g.config.teamSize === 1) {
      const opp = g.cars.find((c) => c.team !== h.team);
      if (opp && !opp.demolished) {
        const oppCloser = opp.pos.distanceTo(b.pos) < h.pos.distanceTo(b.pos) - 800;
        const ballBehind = (b.pos.z - h.pos.z) * atk < -300;
        if (oppCloser && ballBehind && h.pos.z * atk > 0 && h.speed > 800) {
          this.counters.ballChase++;
          this.say('overcommit', "They've got the ball behind you. Turn and shadow: match their speed, stay between the ball and your net.", 30);
        }
      }
    }
    // good shadow feedback
    if (this.samples > 600 && this.behindBallSamples / this.samples > 0.75 && g.time > 60) {
      this.say('goodPositioning', 'Great positioning — you keep the ball in front of you.', 120);
    }
    // sitting at full boost without using it
    if (h.boost >= 100 && h.stats.fullBoostTime > 25 && h.stats.fullBoostTime - (this._lastFull || 0) > 25) {
      this._lastFull = h.stats.fullBoostTime;
      this.say('fullBoost', "You've been sitting at 100 boost for a while. Boost is for speed — use it to beat them to the ball.", 60);
    }
    // whiffs: ball passed close but no touch
    if (h.pos.distanceTo(b.pos) < 260 && b.pos.y < 200 && g.time - (this.lastHumanTouch || -9) > 1) {
      this._nearBall = g.time;
    }
    if (this._nearBall && g.time - this._nearBall > 0.6 && g.time - (this.lastHumanTouch || -9) > 2 && h.pos.distanceTo(b.pos) > 700) {
      this._nearBall = null;
      this.counters.whiffs++;
      if (this.counters.whiffs % 3 === 0) this.say('whiff', 'A few whiffs recently. Slow down on your approach: control first, power second.', 60);
    }
  }

  /** Summarise the match into a coaching report. */
  report(stats) {
    const h = stats.cars.find((c) => c.isHuman);
    if (!h) return [];
    const out = [];
    const c = this.counters;
    const scoreDiff = stats.score[h.team] - stats.score[1 - h.team];
    out.push({
      title: scoreDiff > 0 ? 'You won!' : scoreDiff < 0 ? 'You lost.' : 'Draw.',
      text: `Final ${stats.score[0]}–${stats.score[1]}. You had ${h.touches} touches, ${h.shots} shots, ${h.saves} saves, ${h.goals} goals.`,
      grade: scoreDiff > 0 ? 'good' : scoreDiff < 0 ? 'bad' : 'neutral',
    });
    // boost management
    if (h.zeroBoostPct > 0.25) out.push({ title: 'Boost management', text: `You were at 0 boost ${Math.round(h.zeroBoostPct * 100)}% of the time. Pick up small pads on your rotation — they add up fast, and they're on your way.`, grade: 'bad' });
    else if (h.fullBoostPct > 0.3) out.push({ title: 'Use your boost', text: `You sat at 100 boost ${Math.round(h.fullBoostPct * 100)}% of the time. Boost is speed; speed wins 50/50s.`, grade: 'neutral' });
    else out.push({ title: 'Boost management', text: `Average boost ${Math.round(h.avgBoost)}. Good balance of collecting and spending.`, grade: 'good' });
    // speed
    out.push({
      title: 'Pace',
      text: `Average speed ${Math.round(h.avgSpeed)} uu/s, supersonic ${Math.round(h.supersonicPct * 100)}% of the time. ${h.avgSpeed < 1000 ? 'Try to keep moving even when you are not on the ball — flip and wavedash to conserve momentum.' : h.avgSpeed > 1500 ? 'Fast! Make sure you are not out-driving your control.' : 'Solid.'}`,
      grade: h.avgSpeed < 900 ? 'bad' : 'good',
    });
    // positioning
    const pct = Math.round(stats.humanBehindBallPct * 100);
    out.push({
      title: 'Positioning',
      text: `You were goal-side of the ball ${pct}% of the time. ${pct < 55 ? 'You are getting caught upfield. Rotate back through the middle after every challenge.' : pct > 80 ? 'Very safe — you could afford to be more aggressive when you have boost.' : 'Good balance of pressure and safety.'}`,
      grade: pct < 55 ? 'bad' : 'good',
    });
    if (c.doubleCommit + c.ballChase + c.overcommit > 2) out.push({ title: 'Over-committing', text: `Flagged ${c.doubleCommit + c.ballChase + c.overcommit} times for chasing when you should have shadowed. Ask yourself before every challenge: "If I miss, are we scored on?"`, grade: 'bad' });
    if (c.centeredClears > c.goodClears) out.push({ title: 'Clears', text: `${c.centeredClears} of your clears went up the middle. Aim for the corners; it buys time to rotate and collect boost.`, grade: 'bad' });
    else if (c.goodClears > 2) out.push({ title: 'Clears', text: `${c.goodClears} wide clears. Nice defensive habits.`, grade: 'good' });
    if (c.weakShots > c.goodPowerShots && c.weakShots > 2) out.push({ title: 'Shot power', text: `${c.weakShots} weak shots. Flip into the ball at contact and hit it with the front of your car for power.`, grade: 'bad' });
    else if (c.goodPowerShots > 2) out.push({ title: 'Shot power', text: `${c.goodPowerShots} powerful shots (2000+ uu/s). Keep it up.`, grade: 'good' });
    if (h.aerialTouches > 0) out.push({ title: 'Aerials', text: `${h.aerialTouches} aerial touches. ${h.aerialTouches > 4 ? 'Confident in the air.' : 'Try the Aerials drill to make these automatic.'}`, grade: 'good' });
    else out.push({ title: 'Aerials', text: 'No aerial touches this match. High balls were free for the bots; train in the Aerials drill.', grade: 'neutral' });
    if (c.whiffs > 4) out.push({ title: 'Consistency', text: `${c.whiffs} whiffs. Slow your approach a little and watch the ball, not the target, at contact.`, grade: 'bad' });
    // recommendation
    const rec = [];
    if (pct < 55 || c.doubleCommit + c.ballChase > 2) rec.push('Play 1v1 against the Pro bot and focus only on staying goal-side.');
    if (h.zeroBoostPct > 0.25) rec.push('Run the Speed & Recovery drill and take pads along the route.');
    if (c.weakShots > 2) rec.push('Shooting drill, levels 2–3.');
    if (h.aerialTouches < 2) rec.push('Aerials drill, level 1–2, ten minutes a day.');
    if (h.saves === 0 && stats.score[1 - h.team] > 2) rec.push('Goalkeeping drill — you conceded without recording a save.');
    if (!rec.length) rec.push('Bump the bot difficulty up a level — you are ready.');
    out.push({ title: 'Next steps', text: rec.join(' '), grade: 'neutral' });
    return out;
  }
}

export { BALL };
