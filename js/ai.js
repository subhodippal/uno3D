// Computer opponents. Returns the next action for `seat` given the full state.

import { DECK, WILD, playable, nextSeat } from './rules.js';

const ACTIONS = { skip: 1, rev: 1, d2: 2, w4: 3, wild: 0 };

function bestColor(hand, except = -1) {
  const n = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (const id of hand) {
    if (id === except) continue;
    const c = DECK[id];
    if (c.c === WILD) continue;
    n[c.c]++;
    w[c.c] += typeof c.v === 'number' ? c.v : 15;
  }
  let best = 0;
  for (let c = 1; c < 4; c++) if (n[c] > n[best] || (n[c] === n[best] && w[c] > w[best])) best = c;
  if (!n[best]) best = Math.floor(Math.random() * 4);
  return best;
}

export function chooseAction(G, seat, level = 'normal') {
  const hand = G.hands[seat];
  // say "last card" before playing down to one (easier bots sometimes forget)
  if (hand.length === 2 && !G.called[seat] && hand.some((id) => playable(G, id, seat))) {
    const remember = { easy: 0.6, normal: 0.88, hard: 1 }[level] ?? 0.9;
    if (Math.random() < remember) return { type: 'call' };
  }
  const opts = hand.filter((id) => playable(G, id, seat));
  if (!opts.length) return G.drawn >= 0 ? { type: 'pass' } : { type: 'draw' };

  let pick;
  if (level === 'easy') {
    pick = opts[Math.floor(Math.random() * opts.length)];
  } else {
    const nxt = nextSeat(G);
    const threat = G.hands[nxt].length;
    const leader = Math.min(...G.hands.filter((_, s) => s !== seat).map((h) => h.length));
    const score = (id) => {
      const c = DECK[id];
      let s = 0;
      if (typeof c.v === 'number') s += 10 + c.v * 0.6; // dump high numbers first
      else if (c.v === 'wild') s += hand.length <= 2 ? 30 : 2;
      else if (c.v === 'w4') s += threat <= 2 ? 40 : hand.length <= 2 ? 28 : -2;
      else s += 12 + ACTIONS[c.v] * (threat <= 2 ? 14 : 3);
      // keep the colour I have most of
      if (c.c !== WILD) s += hand.filter((x) => DECK[x].c === c.c).length * 1.5;
      if (level === 'hard') {
        if (leader <= 2 && c.v !== 'wild' && typeof c.v !== 'number') s += 8;
        if (c.v === 'rev' && G.np > 2 && threat <= 2) s += 10;
      }
      return s + Math.random() * (level === 'hard' ? 0.5 : 3);
    };
    pick = opts.reduce((a, b) => (score(b) > score(a) ? b : a));
  }
  const a = { type: 'play', card: pick };
  if (DECK[pick].c === WILD) a.color = level === 'easy' && Math.random() < 0.4 ? Math.floor(Math.random() * 4) : bestColor(hand, pick);
  return a;
}
