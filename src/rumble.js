// ---------------------------------------------------------------------------
// Rumble — the power-up mode. Every car holds one item; using it starts the
// recharge. Boost is unlimited while Rumble is on (see mutators.js), so the
// item button is free to use whenever the meter is ready.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GRAVITY } from './constants.js';

export const ITEMS = {
  boost: { name: 'Boost', icon: '⚡', blurb: 'Instant full tank of boost.' },
  grapple: { name: 'Grapple', icon: '🪝', blurb: 'Rope to the ball — it yanks you in.' },
  boot: { name: 'Boot', icon: '👢', blurb: 'Boots the ball hard away from you.' },
  spike: { name: 'Spike', icon: '📌', blurb: 'The ball sticks to your roof. Flick it off.' },
  tornado: { name: 'Tornado', icon: '🌪️', blurb: 'Launches every nearby car and the ball.' },
  haymaker: { name: 'Haymaker', icon: '🥊', blurb: 'Your next contact demolishes anything.' },
  powershot: { name: 'Power Shot', icon: '💥', blurb: 'Your next touch of the ball explodes.' },
  swapper: { name: 'Swapper', icon: '🔁', blurb: 'Trade places with the closest opponent.' },
};

export const ITEM_IDS = Object.keys(ITEMS);
// duration of each timed effect
const DURATION = { grapple: 1.25, spike: 5, haymaker: 4, powershot: 5 };

const _d = new THREE.Vector3();
const _up = new THREE.Vector3();
const _roof = new THREE.Vector3();

export class Rumble {
  constructor(game, cooldown = 10) {
    this.game = game;
    this.cooldown = cooldown;
    for (const car of game.cars) this.give(car, cooldown * 0.35);
  }

  give(car, cooldown = null) {
    const id = ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)];
    car.item = { id, cooldown: cooldown === null ? this.cooldown : cooldown, timer: 0 };
    return id;
  }

  ready(car) {
    return !!car.item && car.item.cooldown <= 0;
  }

  update(dt) {
    const game = this.game;
    const ball = game.ball;
    for (const car of game.cars) {
      if (car.demolished) continue;
      if (!car.item) this.give(car);
      const it = car.item;
      if (it.cooldown > 0) it.cooldown -= dt;
      if (it.cooldown <= 0 && it.cooldown > -1e6) it.cooldown = 0;
      if (it.timer <= 0) continue;
      it.timer -= dt;

      if (it.id === 'grapple') {
        _d.copy(ball.pos).sub(car.pos);
        const dist = _d.length();
        if (dist > 40) {
          _d.multiplyScalar(1 / dist);
          // the rope lifts you off the floor and hauls you in hard
          car.onGround = false;
          car.vel.addScaledVector(_d, 5000 * dt);
          car.vel.y += GRAVITY * dt; // cancel gravity so the rope does the work
        }
        if (it.timer <= 0) game.emit('rumbleEnd', { car, id: 'grapple' });
      } else if (it.id === 'spike') {
        // ball rides on the roof until the timer ends or the car jumps/flips
        const ev = car.events || {};
        if (ev.jumped || ev.dodged || ev.doubleJumped) {
          it.timer = 0;
          game.emit('rumbleEnd', { car, id: 'spike' });
        } else {
          car.getUp(_up);
          _roof
            .copy(car.getHitboxCenter(new THREE.Vector3()))
            .addScaledVector(_up, car.hitbox.half.y + ball.radius * 0.9 + 4);
          ball.pos.lerp(_roof, Math.min(1, 18 * dt));
          ball.vel.copy(car.vel);
          ball.angVel.multiplyScalar(0.5);
          ball.lastTouch = { car, time: game.time, team: car.team, pos: ball.pos.clone(), vel: ball.vel.clone(), height: car.pos.y, spiked: true };
        }
      } else if ((it.id === 'haymaker' || it.id === 'powershot') && it.timer <= 0) {
        game.emit('rumbleEnd', { car, id: it.id });
      }
    }
  }

  /** Human / bot pressed the item button. */
  use(car) {
    const game = this.game;
    if (car.demolished || !this.ready(car)) return null;
    const it = car.item;
    const id = it.id;
    const ball = game.ball;
    it.cooldown = this.cooldown;
    it.timer = DURATION[id] || 0;
    game.emit('rumbleUse', { car, id, pos: car.pos.clone() });

    switch (id) {
      case 'boost':
        car.boost = 100;
        break;
      case 'boot': {
        _d.copy(ball.pos).sub(car.pos);
        if (_d.length() < 1800) {
          _d.normalize();
          ball.vel.addScaledVector(_d, 3600);
          ball.vel.y += 1100;
          const s = ball.vel.length();
          if (s > ball.maxSpeed) ball.vel.multiplyScalar(ball.maxSpeed / s);
          ball.lastTouch = { car, time: game.time, team: car.team, pos: ball.pos.clone(), vel: ball.vel.clone(), height: car.pos.y };
        } else {
          it.cooldown = 1; // whiffed: give the item back quickly
        }
        break;
      }
      case 'tornado': {
        for (const other of game.cars) {
          if (other === car || other.demolished) continue;
          _d.copy(other.pos).sub(car.pos);
          const dist = _d.length();
          if (dist > 1900) continue;
          _d.multiplyScalar(1 / Math.max(1, dist));
          other.vel.addScaledVector(_d, 1500);
          other.vel.y += 1500;
          other.onGround = false;
          other.angVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
        }
        _d.copy(ball.pos).sub(car.pos);
        if (_d.length() < 2400) {
          _d.normalize();
          ball.vel.addScaledVector(_d, 1500);
          ball.vel.y += 2200;
        }
        break;
      }
      case 'swapper': {
        const foes = game.cars.filter((c) => c.team !== car.team && !c.demolished);
        let best = null;
        let bd = Infinity;
        for (const f of foes) {
          const d = f.pos.distanceToSquared(car.pos);
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
        if (best) {
          const p = car.pos.clone();
          const v = car.vel.clone();
          car.pos.copy(best.pos);
          car.vel.copy(best.vel);
          best.pos.copy(p);
          best.vel.copy(v);
          game.emit('rumbleUse', { car: best, id: 'swapper', pos: best.pos.clone() });
        } else it.cooldown = 1;
        break;
      }
      default:
        break; // grapple / spike / haymaker / powershot are handled in update()
    }
    return id;
  }

  /** Called by the game right after a car touches the ball. */
  onTouch(car) {
    const it = car.item;
    if (!it || it.timer <= 0) return null;
    if (it.id !== 'powershot') return null;
    it.timer = 0;
    const ball = this.game.ball;
    const speed = ball.vel.length();
    const dir = _d.copy(ball.vel);
    if (dir.lengthSq() < 1) car.getForward(dir);
    dir.normalize();
    ball.vel.copy(dir).multiplyScalar(Math.min(ball.maxSpeed, Math.max(speed * 2.2, 3200)));
    ball.vel.y = Math.max(ball.vel.y, 300);
    ball.angVel.multiplyScalar(1.6);
    this.game.emit('rumbleHit', { car, pos: ball.pos.clone() });
    return 'powershot';
  }

  /** Car-car contact: a live haymaker demolishes whoever it catches. */
  contact(attacker, victim) {
    const it = attacker.item;
    if (!it || it.timer <= 0 || it.id !== 'haymaker') return false;
    if (attacker.team === victim.team) return false;
    it.timer = 0;
    return true;
  }

  /** Should this bot fire its item now? Simple, readable policy. */
  botWants(car, role) {
    const game = this.game;
    const it = car.item;
    if (!it || !this.ready(car)) return false;
    const ball = game.ball;
    const dist = car.pos.distanceTo(ball.pos);
    switch (it.id) {
      case 'boost':
        return car.boost < 45;
      case 'boot':
        return dist < 1500;
      case 'powershot':
      case 'spike':
        return dist < 1400 && role === 'attack';
      case 'haymaker':
        return game.cars.some((c) => c.team !== car.team && !c.demolished && c.pos.distanceTo(car.pos) < 900);
      case 'tornado':
        return game.cars.some((c) => c.team !== car.team && !c.demolished && c.pos.distanceTo(car.pos) < 1300) || dist < 700;
      case 'grapple':
        return ball.pos.y > 250 && dist < 3400 && role === 'attack';
      case 'swapper':
        return game.cars.some((c) => c.team !== car.team && !c.demolished && c.pos.distanceTo(car.pos) < 2600) && dist > 2200;
      default:
        return false;
    }
  }
}
