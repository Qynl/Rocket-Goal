# Rocket-Goal

A Rocket League–style car-soccer game built for **training**: skilled bots to play against, focused drills for the mechanics that matter, a coach that tells you what to fix — plus the parts of RL that make it feel like RL: a **garage**, **mutators**, **Rumble**, five **arenas** and a local **rank**. And when you want a real opponent, **online play**: two browsers, peer-to-peer, no server and no account.

Runs entirely in the browser (**React + Three.js + Vite**). Everything offline needs no network after `npm install`; online play needs nothing but the two players swapping a code.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ (open with `npm run preview`)
npm test           # headless checks: UI, cars, mutators, rumble, online, training, renderer, replay
```

Works with keyboard + mouse or any gamepad (Xbox/PlayStation layouts). Two keyboard presets: **Keyboard** (WASD + Space jump / Shift boost) and **RL default** (LMB boost, RMB jump, Shift powerslide/air roll). Everything can be rebound in Settings.

## What's inside

**Physics** — Rocket League units and field layout (34 boost pads, 5-spawn kickoffs, RL gravity/ball/car constants). Jumps, double jumps, dodges, flip cancels (speed flips), air roll, free air roll (powerslide key + steer), powerslide, wall and ceiling driving with speed preserved through the curved ramps, wavedashes, demolitions, Psyonix hit impulse, supersonic. Fixed 120 Hz sim, boost locked during the countdown exactly like RL. Ball-cam lifts and pulls back as the ball climbs so high aerials stay framed.

**Cars & garage** — twelve cars across the six real hitbox classes (Octane, Dominus, Breakout, Plank, Hybrid, Merc) with Psyonix's actual hitbox dimensions, so a Batmobile really is 18 uu tall and a Merc really is 47. Only the hitbox differs — engine, boost, jump and flip are identical for every car, exactly like RL. The garage paints them: 20 colours × primary/accent, 8 finishes (glossy → chrome, metalflake, pearlescent, carbon), 6 wheel styles, 8 boost trails and 5 goal explosions, all previewed on a turntable behind the menu.

**Mutators** — the full private-match rule set: match length, max score, overtime (unlimited / 5 min / 10 min / off), ball size, weight, bounciness, speed and type (default or **puck** for Snow Day), boost (normal / unlimited / slow recharge / rapid recharge / none), boost strength (0.5×–10×), respawn time and demolition rules (default / disabled / always / instant / 3 s). One-click presets: Standard, Quick match, Rumble, Snow Day, Chaos.

**Rumble** — the power-up mode. Every car carries one of eight items — Boost, Grapple, Boot, Spike, Tornado, Haymaker, Power Shot, Swapper — boost is unlimited, and the item button (`X`, or D-pad up on a gamepad) fires it and starts a 10 s recharge (slow / turbo recharge available as mutators). Bots use their items too, with their own policy for each one.

**Online play** — one friend, peer-to-peer, over **plain WebRTC with public STUN and no TURN**. There is no signalling server, no relay, no account and no data of yours on any machine but the two playing: the "connection" is two short codes you copy to each other by whatever means you like (messenger, mail, a sticky note). The host simulates the match and is authoritative; each player sees their own car with zero input latency (client-side prediction + server reconciliation), everything else is interpolated with a jitter buffer, and events — goals, saves, demos, chat, Rumble items — are mirrored so both sides see the same game. 1v1, or 2v2/3v3 filled with bots. Snapshot traffic is bit-packed (~220 bytes per car, ≈12 KB/s for a 1v1). If the link drops mid-match the game pauses and says so instead of desyncing.

Because there is no relay, the connection can fail, and the game says exactly why: *"it's plain WebRTC with public STUN, no TURN. It punches through most home routers, but symmetric NAT, mobile data and strict VPNs can block it."* That message is shown verbatim on the failure screen, together with the usual suspects (carrier-grade NAT on mobile data, a strict VPN or corporate firewall, both peers behind symmetric NAT) and a reminder that everything else — bots, training, garage, mutators, Rumble — still works offline.

**Arenas** — Night Stadium, DFH Day, Wasteland, Salty Shores and Mannfield. Each is a full re-theme: sky, sun, fog, exposure, pitch colour, wall panels, glass, LED strips, ceiling, stands, crowd and outer floor.

**Bots** — four difficulty levels: *Rookie*, *Pro*, *All-Star*, *Grand Champion*. Bots read a ball-prediction, choose roles (attack / shadow / save / boost) with teammates, take varied kickoffs (side-hits, diagonal flips, Champion speed-flips), defend rolling balls toward their own net, drive walls, jump-shot, dodge and aerial. All-Star and Grand Champion punish slow rotations and whiffs; Rookie and Pro make human-like reading and timing mistakes. Bots drive their own cars out of the catalogue.

**Presentation** — stadium arena with lit goals, boost pad glow, per-car models with wheels/boost trails/supersonic effects, cars grounded by a soft contact shadow plus a team-coloured underglow that fades out as they leave the floor (no floating-on-ice look, no blob stuck under an airborne car), 4096² sun shadows, five goal-explosion styles and slow-motion replays with a cinematic camera, ball-cam / free-cam with RL-style camera settings (FOV, distance, height, stiffness), engine/boost/impact audio, and a full HUD (boost gauge, speed, score, clock, kill feed, RL-style stat pop-ups — "+50 SAVE", "+75 EPIC SAVE", "+20 CLEAR BALL" —, hold-Tab scoreboard, MVP on the results screen, off-screen ball indicator, Rumble item meter, demolition/respawn timer, quick chat). Forfeit from the pause menu.

**Modes**
- **Match** — 1v1 / 2v2 / 3v3 vs bots, any arena, any mutator set, overtime, replays, boost management.
- **Training drills** — nine packs: Shooting, Saves, Aerials, **Air shots**, **Aerial saves**, Dribbling, Kickoffs, Wall shots, Recovery. Each drill has levels that unlock as you succeed and gives feedback after every attempt. Drills always run on standard rules.
  - **Aerials** covers straight lobs, side aerials, drifting balls and ceiling drop shots, auto-enables the ball landing marker, and reports touch height / air time / boost left.
  - **Air shots** lobs the ball into the shooting lane and asks you to meet it *in the air* and put it on goal — the ring marks the contact point, the ground marker shows where the ball would land if you let it drop, and a goalie joins from level 4. Feedback separates a real aerial from "just under" from a genuine ground hit.
  - **Aerial saves** is the keeper's side of the same ball: high drops into your own box that you have to meet in the air and clear wide. From level 4 a grounded punch no longer counts, and level 5 drops them inside the six-yard box.
  - Aerial balls are also folded into the normal **Shooting** and **Saves** packs from level 3 up (~⅓ and ~⅖ of feeds), so the standard drills stop being ground-only.
- **Free play** — you, the ball and your chosen arena. `T` resets.
- **Progress** — local XP, level and season rank (Unranked → Supersonic Legend), per-drill best scores and streaks, match record, shot accuracy and the coach's notes.

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
| Free air roll (hold) + steer | Ctrl/Shift + A/D — A rolls left, D rolls right |
| Use Rumble item | X (gamepad: D-pad up) |
| Ball cam | C |
| Scoreboard (hold) | Tab |
| Quick chat | 1 – 4 |
| Rear view | R |
| Ball prediction | P |
| Hitbox overlay | H |
| Pause | Esc |

## Dev scripts

Headless simulations and checks (Node, no browser needed):

```bash
npm test                          # UI + cars + mutators + rumble + online + training + renderer + replay
node scripts/sim.mjs champion 2 120   # bot-vs-bot match: difficulty, team size, seconds
node scripts/cartest.mjs          # hitbox table, per-car physics, 576 cosmetic combos, mutator math
node scripts/mutatortest.mjs      # every rule modifier applied to a real match
node scripts/rumbletest.mjs       # each power-up fired and its effect measured
node scripts/drills.mjs           # run every drill with a Champion bot as the "player"
node scripts/drilltrace.mjs wallshots
node scripts/hit.mjs              # hit/dodge/jump physics numbers
node scripts/uitest.mjs           # jsdom smoke test of menus/HUD/input/garage/XP/every drill
node scripts/nettest.mjs          # two real games over a fake link: latency, jitter, 10% loss, dead NAT
NET_SEED=7 node scripts/nettest.mjs   # the same match with a different random seed
node scripts/netuitest.mjs        # the online screens driven in jsdom: codes, lobby, match, failure text
node scripts/trainingtest.mjs     # every training feed flown through real ball physics + grading
node scripts/rendertest.mjs       # renderer: arenas, turntable, loadouts, goal explosions
node scripts/replaytest.mjs       # goal → replay → countdown state machine
node scripts/walltest.mjs         # wall driving speed / height numbers
node scripts/kosym.mjs allstar    # kickoff 50/50 outcomes (both bots)
node scripts/kodrill.mjs champion # kickoff drill with a bot as the player
```
