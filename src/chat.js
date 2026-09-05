// Quick chat: the player's 1-4 keys, plus bots reacting to what happens on the pitch
// (compliments, reactions, apologies) the way Rocket League lobbies do.
const CHATS = {
  1: 'Nice shot!',
  2: 'What a save!',
  3: 'Great pass!',
  4: 'Thanks!',
};
export const QUICK_CHATS = CHATS;

const REACTIONS = {
  goalFor: ['Nice shot!', 'Great pass!', 'Siiiick!', 'Calculated.', 'Nice one!'],
  goalAgainst: ['Nice shot!', 'Wow!', 'Savage!', 'Close one!'],
  ownGoal: ['Sorry!', 'My bad...', 'Whoops.', 'No problem.'],
  savedByUs: ['What a save!', 'Great clear!', 'Nice block!'],
  savedByThem: ['What a save!', 'Close one!', 'Nooo!'],
  humanNice: ['Nice shot!', 'Wow!', 'Siiiick!'],
  demoed: ['Wow!', 'Okay.', 'Savage!'],
  thanks: ['Thanks!', 'No problem.', 'Nice one!'],
  whatASave: ['Thanks!', 'No problem.'],
  ot: ['Here we go...', 'Calculated.', 'Nice one!'],
  kickoffFT: ['I got it!', 'Take the shot!', 'Go for it!'],
};

export class QuickChat {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.enabled = true;
    this.lastBotChat = -10;
    this.lastHumanChat = 0;
    game.on('goal', (e) => this.onGoal(e));
    game.on('save', (e) => this.onSave(e));
    game.on('demo', (e) => this.onDemo(e));
    game.on('overtime', () => this.botSay(this.game.bots[0]?.car, 'ot', 0.8));
  }

  pickBot(filter) {
    const bots = this.game.bots.filter((b) => !b.car.demolished && (!filter || filter(b.car)));
    return bots.length ? bots[Math.floor(Math.random() * bots.length)].car : null;
  }

  botSay(car, kind, chance = 0.6, delay = 0.6 + Math.random() * 0.9) {
    if (!this.enabled || !car || !this.game.human) return;
    if (this.game.time - this.lastBotChat < 2.5) return;
    if (Math.random() > chance) return;
    const pool = REACTIONS[kind];
    const text = pool[Math.floor(Math.random() * pool.length)];
    this.lastBotChat = this.game.time;
    setTimeout(() => {
      if (this.hud) this.hud.addChat(car.name, car.team, text);
    }, delay * 1000);
  }

  humanSay(n) {
    const g = this.game;
    if (!this.enabled || !g.human) return;
    const now = Date.now();
    if (now - this.lastHumanChat < 800) return; // RL's spam throttle
    this.lastHumanChat = now;
    const text = CHATS[n];
    if (!text) return;
    this.hud.addChat(g.human.name, g.human.team, text);
    // bots answer "Thanks!" to compliments, and "Nice shot!" back sometimes
    if (n === 1 || n === 2 || n === 3) this.botSay(this.pickBot(), 'thanks', 0.45, 1.2);
  }

  onGoal(e) {
    const g = this.game;
    const h = g.human;
    if (!h) return;
    const scorer = e.scorer;
    if (e.ownGoal && scorer && scorer.isBot) return this.botSay(scorer, 'ownGoal', 0.9, 1.2);
    if (scorer === h) {
      const mate = this.pickBot((c) => c.team === h.team);
      const opp = this.pickBot((c) => c.team !== h.team);
      if (mate && Math.random() < 0.7) return this.botSay(mate, 'goalFor', 1, 1);
      if (opp && e.speed > 2200) return this.botSay(opp, 'humanNice', 0.5, 1.4);
      return;
    }
    if (scorer && scorer.isBot) {
      if (scorer.team === h.team) return this.botSay(this.pickBot((c) => c.team === h.team && c !== scorer) || scorer, scorer === this.pickBot((c) => c === scorer) ? 'goalFor' : 'goalFor', 0.5, 1);
      // opponent scored: teammates apologise, opponents celebrate
      const mate = this.pickBot((c) => c.team === h.team);
      if (mate && Math.random() < 0.4) return this.botSay(mate, 'ownGoal', 1, 1.2);
      return this.botSay(scorer, 'goalAgainst', 0.35, 1.5);
    }
  }

  onSave(e) {
    const h = this.game.human;
    if (!h) return;
    if (e.car === h) return this.botSay(this.pickBot((c) => c.team === h.team) || this.pickBot(), e.epic ? 'savedByUs' : 'savedByUs', e.epic ? 0.9 : 0.4, 0.8);
    if (e.car.isBot && e.epic) return this.botSay(this.pickBot((c) => c !== e.car), e.car.team === h.team ? 'savedByUs' : 'savedByThem', 0.5, 1);
  }

  onDemo(e) {
    const h = this.game.human;
    if (!h) return;
    if (e.demolisher === h && e.victim.isBot) this.botSay(e.victim, 'demoed', 0.4, 1.5);
  }
}
