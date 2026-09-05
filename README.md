# Rocket-Goal

A local, offline Rocket League–style car-soccer game built for **training**: skilled bots to play against, focused drills for the mechanics that matter, and a coach that tells you what to fix.

Runs entirely in the browser (Three.js + Vite). No servers, no accounts, no network needed after `npm install`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (open with `npm run preview`)
```

Works with keyboard + mouse or any gamepad (Xbox/PlayStation layouts). Two keyboard presets: **Keyboard** (WASD + Space jump / Shift boost) and **RL default** (LMB boost, RMB jump, Shift powerslide/air roll). Everything can be rebound in Settings.

## What's inside

**Physics** — Rocket League units and field layout (Octane hitbox, 34 boost pads, 5-spawn kickoffs, RL gravity/ball/car constants). Jumps, double jumps, dodges, flip cancels (speed flips), air roll, powerslide, wall and ceiling driving with speed preserved through the curved ramps, wavedashes, demolitions, Psyonix hit impulse, supersonic. Fixed 120 Hz sim, boost locked during the countdown exactly like RL.

**Bots** — four difficulty levels: *Rookie*, *Pro*, *All-Star*, *Champion*. Bots read a ball-prediction, choose roles (attack / shadow / save / boost) with teammates, take varied kickoffs (side-hits, diagonal flips, Champion speed-flips), defend rolling balls toward their own net, drive walls, jump-shot, dodge, and aerial. All-Star and Champion are meant to punish slow rotations and whiffs; Rookie and Pro make human-like reading and timing mistakes.

**Presentation** — stadium arena with lit goals, boost pad glow, car models with wheels/boost trails/supersonic effects, goal explosions and slow-motion replays with a cinematic camera, ball-cam / free-cam with RL-style camera settings (FOV, distance, height, stiffness), engine/boost/impact audio, and a full HUD (boost gauge, speed, score, clock, kill feed, RL-style stat pop-ups — "+50 SAVE", "+75 EPIC SAVE", "+20 CLEAR BALL" —, hold-Tab scoreboard and an MVP on the results screen).

**Modes**
- **Match** — 1v1 / 2v2 / 3v3 vs bots, with or without bot teammates, 5-minute (configurable) games, overtime, replays, boost management.
- **Training drills** — Shooting, Saves, Aerials, Dribbling, Kickoffs, Wall shots, Recovery. Each drill has levels that unlock as you succeed and gives feedback after every attempt.
- **Progress** — per-drill best scores and streaks, match record, and the coach's notes are saved locally.

**Coach** — watches your match and reports concrete things to work on (boost starvation, slow rotations, whiffed challenges, kickoffs lost, etc.).

## Controls (Keyboard preset)

| Action | Key |
|---|---|
| Throttle / Reverse | W / S |
| Steer | A / D |
| Jump | Space |
| Boost | Shift |
| Powerslide / Air roll | Ctrl or F |
| Air roll left / right | Q / E |
| Ball cam | C |
| Scoreboard (hold) | Tab |
| Rear view | R |
| Pause | Esc |

## Dev scripts

Headless simulations and checks (Node, no browser needed):

```bash
node scripts/sim.mjs champion 2 120     # bot-vs-bot match: difficulty, team size, seconds
node scripts/drills.mjs                 # run every drill with a Champion bot as the "player"
node scripts/drilltrace.mjs wallshots   # per-frame trace of one drill
node scripts/hit.mjs                    # hit/dodge/jump physics numbers
node scripts/uitest.mjs                 # jsdom smoke test of menus/HUD/input
node scripts/rendertest.mjs             # renderer smoke test with a stub WebGL renderer
node scripts/replaytest.mjs             # goal → replay → countdown state machine
node scripts/walltest.mjs               # wall driving speed / height numbers
node scripts/kosym.mjs allstar          # kickoff 50/50 outcomes (both bots)
node scripts/kodrill.mjs champion       # kickoff drill with a bot as the player
```
