// Pure rules engine for the shedding card game (no DOM, no three.js).
// The host / local device owns the full state G; everyone else sees view(G, seat).
//
// Two modes:
//  - classic: 108 cards (numbers 0-9, Skip, Reverse, +2, Wild, Wild +4)
//  - flip:    112 double-sided cards. The light side plays like classic with gentler draws
//             (+1, Wild +2); a Flip card turns everything over to the dark side, which has
//             harsher cards (+5, Skip Everyone, Wild Draw Colour) and its own four colours.

export const GAME_NAME = 'Color Card 3D';

export const COLORS = [
  { name: 'Red', css: '#e53935', hex: 0xe53935 },
  { name: 'Yellow', css: '#f9b800', hex: 0xf9b800 },
  { name: 'Green', css: '#2e9e44', hex: 0x2e9e44 },
  { name: 'Blue', css: '#1e6fd9', hex: 0x1e6fd9 },
];
export const DARK_COLORS = [
  { name: 'Pink', css: '#e8458b', hex: 0xe8458b },
  { name: 'Teal', css: '#00a6a6', hex: 0x00a6a6 },
  { name: 'Orange', css: '#ff7a1a', hex: 0xff7a1a },
  { name: 'Purple', css: '#8e44e8', hex: 0x8e44e8 },
];
export const WILD = 4;
export const MODES = ['classic', 'flip'];

// seat identities (separate from card colours)
export const SEATS = [
  { name: 'Purple', css: '#7e57c2', hex: 0x7e57c2 },
  { name: 'Orange', css: '#f57c00', hex: 0xf57c00 },
  { name: 'Teal', css: '#00897b', hex: 0x00897b },
  { name: 'Pink', css: '#d81b60', hex: 0xd81b60 },
];

// ---------------------------------------------------------------- decks
// classic: per colour one 0, two each of 1-9, Skip, Reverse, +2; plus 4 Wild and 4 Wild +4
export const DECK = [];
for (let c = 0; c < 4; c++) {
  DECK.push({ c, v: 0 });
  for (let v = 1; v <= 9; v++) DECK.push({ c, v }, { c, v });
  for (const v of ['skip', 'rev', 'd2']) DECK.push({ c, v }, { c, v });
}
for (let i = 0; i < 4; i++) DECK.push({ c: WILD, v: 'wild' });
for (let i = 0; i < 4; i++) DECK.push({ c: WILD, v: 'w4' });

// flip: 112 cards, each with a light face [0] and a dark face [1]
function sideFaces(actions, wilds) {
  const out = [];
  for (let c = 0; c < 4; c++) {
    for (let v = 1; v <= 9; v++) out.push({ c, v }, { c, v });
    for (const v of actions) out.push({ c, v }, { c, v });
  }
  for (const v of wilds) for (let i = 0; i < 4; i++) out.push({ c: WILD, v });
  return out;
}
function seeded(seed) { // mulberry32: the same pairing on every device
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LIGHT = sideFaces(['d1', 'rev', 'skip', 'flip'], ['wild', 'w2']);
const DARK = sideFaces(['d5', 'rev', 'skipall', 'flip'], ['wild', 'wdc']);
{
  const r = seeded(20261111);
  for (let i = DARK.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [DARK[i], DARK[j]] = [DARK[j], DARK[i]]; }
}
export const FLIP_DECK = LIGHT.map((f, i) => [f, DARK[i]]);

const modeOf = (S) => (S?.cfg?.mode === 'flip' ? 'flip' : 'classic');
export const deckSize = (mode) => (mode === 'flip' ? FLIP_DECK.length : DECK.length);

// the face a card shows right now (S = state or view; or call faceAt directly)
export function faceAt(mode, side, id) {
  return mode === 'flip' ? FLIP_DECK[id][side ? 1 : 0] : DECK[id];
}
export const face = (S, id) => faceAt(modeOf(S), S.side, id);
export const palette = (S) => (S?.side ? DARK_COLORS : COLORS);
export const paletteAt = (side) => (side ? DARK_COLORS : COLORS);
// texture / identity key for a face: C = classic, L = flip light, D = flip dark
export const faceKeyAt = (mode, side, id) => { const f = faceAt(mode, side, id); return `${mode === 'flip' ? (side ? 'D' : 'L') : 'C'}:${f.c}:${f.v}`; };
export const parseFaceKey = (k) => { const [s, c, v] = k.split(':'); return { dark: s === 'D', flip: s !== 'C', c: +c, v: /^\d+$/.test(v) ? +v : v }; };

export const isWild = (S, id) => face(S, id).c === WILD;
export const isNumber = (S, id) => typeof face(S, id).v === 'number';

// how many cards a draw card adds, and which wild draws can be stacked on anything
const DRAW_N = { d2: 2, w4: 4, d1: 1, w2: 2, d5: 5 };
const BIG_DRAW = new Set(['w4', 'w2']);
export const drawAmount = (v) => DRAW_N[v] || 0;

const POINTS = {
  classic: { skip: 20, rev: 20, d2: 20, wild: 50, w4: 50 },
  light: { d1: 10, rev: 20, skip: 20, flip: 20, wild: 40, w2: 50 },
  dark: { d5: 20, rev: 20, skipall: 30, flip: 20, wild: 40, wdc: 60 },
};
export function points(S, id) {
  const f = face(S, id);
  if (typeof f.v === 'number') return f.v;
  const table = modeOf(S) === 'flip' ? (S.side ? POINTS.dark : POINTS.light) : POINTS.classic;
  return table[f.v] ?? 20;
}
export const NAMES = {
  skip: 'Skip', rev: 'Reverse', d2: 'Pick 2', wild: 'Colour card', w4: 'Pick 4',
  d1: 'Pick 1', w2: 'Wild Pick 2', flip: 'Flip', d5: 'Pick 5', skipall: 'Skip Everyone', wdc: 'Wild Draw Colour',
};

export const HANDS = [5, 7, 10];
export const TARGETS = [0, 100, 250, 500]; // 0 = free play (no match end)
// how much more likely than a number card a special card is to come up after a shuffle
export const SPECIAL_ODDS = { low: 1, medium: 2.5, high: 5 };

export function normalizeCfg(c = {}) {
  let special = c.special;
  if (!SPECIAL_ODDS[special]) special = c.boost === false ? 'low' : 'medium';
  return {
    mode: c.mode === 'flip' ? 'flip' : 'classic',
    np: Math.max(2, Math.min(4, Math.round(+c.np || 2))),
    hand: HANDS.includes(+c.hand) ? +c.hand : 7,
    target: TARGETS.includes(+c.target) ? +c.target : 100,
    stack: c.stack !== false,
    drawMode: c.drawMode === 'until' ? 'until' : 'one',
    callRule: c.callRule !== false,
    special,
  };
}

export function describe(cfg) {
  const c = normalizeCfg(cfg);
  return `${c.mode === 'flip' ? 'Flip · ' : ''}${c.hand} cards · ${c.target ? `to ${c.target} pts` : 'free play'}`;
}

// ---------------------------------------------------------------- rng
function rnd(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Weighted shuffle (Efraimidis-Spirakis): special cards are SPECIAL_ODDS[level] times as likely
// as a number card to sit near the top of the pile (cards are drawn from the end of the array).
function deal(G, ids) {
  const w = SPECIAL_ODDS[G.cfg.special] || 1;
  if (w === 1) return shuffle(ids);
  const key = (id) => {
    const r = (rnd(1e9) + 1) / (1e9 + 1);
    return Math.pow(r, 1 / (isNumber(G, id) ? 1 : w));
  };
  return ids.map((id) => [key(id), id]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

// ---------------------------------------------------------------- game
export function newGame(cfgIn, { round = 1, scores = null, starter = 0 } = {}) {
  const cfg = normalizeCfg(cfgIn);
  const np = cfg.np;
  const G = {
    cfg, np, side: 0,
    deck: [],
    discard: [],
    hands: Array.from({ length: np }, () => []),
    color: 0, turn: starter % np, dir: 1,
    pending: 0, pendType: null, drawn: -1, awaitColor: false,
    called: Array(np).fill(false),
    scores: scores ? scores.slice() : Array(np).fill(0),
    round, starter: starter % np,
    over: null, champ: null,
    seq: 0, evs: [],
  };
  G.deck = deal(G, Array.from({ length: deckSize(cfg.mode) }, (_, i) => i));
  for (let k = 0; k < cfg.hand; k++) for (let s = 0; s < np; s++) G.hands[s].push(G.deck.pop());
  // the first discard is always a number card
  let first = G.deck.pop();
  while (!isNumber(G, first)) { G.deck.unshift(first); first = G.deck.pop(); }
  G.discard.push(first);
  G.color = face(G, first).c;
  G.evs = [{ t: 'deal' }];
  G.seq = 1;
  return G;
}

export function nextRound(G) {
  const fresh = G.champ != null;
  const n = newGame(G.cfg, {
    round: fresh ? 1 : G.round + 1,
    scores: fresh ? null : G.scores,
    starter: (G.starter + 1) % G.np,
  });
  n.seq = G.seq + 1;
  Object.keys(G).forEach((k) => delete G[k]);
  Object.assign(G, n);
  return G;
}

export const top = (G) => G.discard[G.discard.length - 1];
const step = (G, k = 1) => (G.turn + G.dir * k + G.np * 8) % G.np;
export const nextSeat = (G) => step(G, 1);

// Works on a full state or a view (both carry top / color / pending / drawn / side)
export function playable(S, id, seat = S.turn) {
  if (S.over || S.turn !== seat || S.awaitColor) return false;
  if (S.drawn >= 0 && id !== S.drawn) return false;
  const c = face(S, id);
  const t = face(S, S.top ?? top(S));
  if (S.pending > 0) {
    if (BIG_DRAW.has(c.v)) return true; // a wild draw stacks on any draw
    return !!DRAW_N[c.v] && !BIG_DRAW.has(S.pendType) && c.v === S.pendType; // same small draw
  }
  if (c.c === WILD) return true;
  return c.c === S.color || c.v === t.v;
}

function refill(G) {
  if (G.deck.length) return true;
  if (G.discard.length <= 1) return false;
  const t = G.discard.pop();
  G.deck = deal(G, G.discard);
  G.discard = [t];
  G.evs.push({ t: 'shuffle' });
  return true;
}

function draw(G, seat, n, why) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!refill(G)) break;
    const id = G.deck.pop();
    G.hands[seat].push(id);
    got.push(id);
  }
  if (got.length) G.evs.push({ t: 'draw', seat, n: got.length, cards: got, why });
  if (G.hands[seat].length > 1) G.called[seat] = false;
  return got;
}

// Wild Draw Colour: keep drawing until a card of `color` turns up (or the cards run out)
function drawUntilColor(G, seat, color) {
  const got = [];
  for (let guard = 0; guard < 300; guard++) {
    if (!refill(G)) break;
    const id = G.deck.pop();
    G.hands[seat].push(id);
    got.push(id);
    if (face(G, id).c === color) break;
  }
  if (got.length) G.evs.push({ t: 'draw', seat, n: got.length, cards: got, why: 'color' });
  if (G.hands[seat].length > 1) G.called[seat] = false;
  return got;
}

// Flip: every card turns over. The draw and discard piles are turned over as stacks.
function flipAll(G) {
  G.side = G.side ? 0 : 1;
  G.deck.reverse();
  G.discard.reverse();
  G.drawn = -1;
  const f = face(G, top(G));
  G.awaitColor = f.c === WILD; // a colour card on top: the player who flipped picks the colour
  if (!G.awaitColor) G.color = f.c;
  G.evs.push({ t: 'flip', side: G.side, top: top(G), color: G.awaitColor ? -1 : G.color });
}

function endRound(G, w) {
  let pts = 0;
  G.hands.forEach((h, s) => { if (s !== w) pts += h.reduce((a, id) => a + points(G, id), 0); });
  G.scores[w] += pts;
  G.over = { winner: w, pts, hands: G.hands.map((h) => h.slice()) };
  if (G.cfg.target && G.scores[w] >= G.cfg.target) G.champ = w;
  G.evs.push({ t: 'win', seat: w, pts });
}

const validColor = (c) => c !== null && c !== undefined && c !== '' && Number.isInteger(+c) && +c >= 0 && +c < 4;

// Apply an action for seat. Returns true if it was legal.
// a = { type: 'play', card, color } | { type: 'draw' } | { type: 'pass' } | { type: 'call' } | { type: 'color', color }
export function act(G, seat, a) {
  if (!a || G.over || seat !== G.turn) return false;
  const hand = G.hands[seat];
  const evs = [];
  G.evs = evs;

  if (a.type === 'color') { // after a Flip turned up a colour card
    if (!G.awaitColor || !validColor(a.color)) return false;
    G.awaitColor = false;
    G.color = +a.color;
    evs.push({ t: 'color', seat, color: G.color });
    G.turn = step(G);
    G.seq++;
    return true;
  }
  if (G.awaitColor) return false;

  if (a.type === 'call') {
    if (hand.length !== 2 || G.called[seat]) return false;
    G.called[seat] = true;
    evs.push({ t: 'call', seat });
    G.seq++;
    return true;
  }

  if (a.type === 'pass') {
    if (G.drawn < 0) return false;
    G.drawn = -1;
    evs.push({ t: 'pass', seat });
    G.turn = step(G);
    G.seq++;
    return true;
  }

  if (a.type === 'draw') {
    if (G.drawn >= 0) return false;
    if (G.pending > 0) {
      const n = G.pending;
      G.pending = 0; G.pendType = null;
      draw(G, seat, n, 'stack');
      G.turn = step(G);
    } else {
      let got;
      if (G.cfg.drawMode === 'until') {
        do { got = draw(G, seat, 1, 'draw'); } while (got.length && !playable(G, got[0], seat));
      } else got = draw(G, seat, 1, 'draw');
      const last = got[got.length - 1];
      if (got.length && playable(G, last, seat)) G.drawn = last;
      else { evs.push({ t: 'pass', seat }); G.turn = step(G); }
    }
    G.seq++;
    return true;
  }

  if (a.type !== 'play') return false;
  const id = +a.card;
  const at = hand.indexOf(id);
  if (at < 0 || !playable(G, id, seat)) return false;
  const c = face(G, id);
  // a colour card must name its colour (never guess one for the player)
  if (c.c === WILD && !validColor(a.color)) return false;
  hand.splice(at, 1);
  G.discard.push(id);
  G.drawn = -1;
  G.color = c.c === WILD ? +a.color : c.c;
  evs.push({ t: 'play', seat, card: id, color: G.color, v: c.v, side: G.side });

  // last card call
  if (hand.length === 1) {
    if (G.cfg.callRule && !G.called[seat]) draw(G, seat, 2, 'call');
    else evs.push({ t: 'last', seat });
  }
  if (hand.length > 1) G.called[seat] = false;

  if (c.v === 'rev') {
    G.dir *= -1;
    evs.push({ t: 'rev', dir: G.dir });
  }
  const n = DRAW_N[c.v] || 0;
  if (n) { G.pending += n; G.pendType = c.v; }
  if (c.v === 'flip') flipAll(G);

  if (hand.length === 0) {
    // a final draw card still lands on the next player (and counts for the score)
    if (n) {
      const v = step(G);
      const k = G.pending;
      G.pending = 0; G.pendType = null;
      draw(G, v, k, 'stack');
    } else if (c.v === 'wdc') drawUntilColor(G, step(G), G.color);
    G.awaitColor = false;
    endRound(G, seat);
    G.seq++;
    return true;
  }

  if (c.v === 'skip' || (c.v === 'rev' && G.np === 2)) {
    evs.push({ t: 'skip', seat: step(G) });
    G.turn = step(G, 2);
  } else if (c.v === 'skipall') {
    // everyone else is skipped: the same player goes again
    for (let k = 1; k < G.np; k++) evs.push({ t: 'skip', seat: step(G, k) });
  } else if (c.v === 'wdc') {
    const v = step(G);
    drawUntilColor(G, v, G.color);
    evs.push({ t: 'skip', seat: v });
    G.turn = step(G, 2);
  } else if (n && !G.cfg.stack) {
    const v = step(G);
    const k = G.pending;
    G.pending = 0; G.pendType = null;
    draw(G, v, k, 'stack');
    evs.push({ t: 'skip', seat: v });
    G.turn = step(G, 2);
  } else if (c.v === 'flip' && G.awaitColor) {
    // the same player picks the colour of the card that turned up, then play moves on
  } else {
    G.turn = step(G);
  }
  G.seq++;
  return true;
}

// What one seat is allowed to see. seat = -1 for a spectator.
// In flip mode the other side of every card is printed on its back, so players can see the
// other side of opponents' cards and of the top of the draw pile (like the physical game).
export function view(G, seat) {
  const flip = G.cfg.mode === 'flip';
  const other = G.side ? 0 : 1;
  return {
    np: G.np, cfg: G.cfg, viewer: seat, side: G.side || 0,
    my: seat >= 0 ? G.hands[seat].slice() : [],
    counts: G.hands.map((h) => h.length),
    backs: flip ? G.hands.map((h, s) => (s === seat ? null : h.map((id) => faceKeyAt('flip', other, id)))) : null,
    deckBack: flip && G.deck.length ? faceKeyAt('flip', other, G.deck[G.deck.length - 1]) : null,
    pile: G.discard.slice(-10),
    top: top(G),
    deckCount: G.deck.length,
    color: G.color, turn: G.turn, dir: G.dir,
    pending: G.pending, pendType: G.pendType,
    awaitColor: !!G.awaitColor,
    drawn: seat === G.turn ? G.drawn : -1,
    called: G.called.slice(),
    scores: G.scores.slice(),
    round: G.round, over: G.over, champ: G.champ,
    seq: G.seq,
    evs: G.evs.map((e) => (e.t === 'draw' && e.seat !== seat ? { ...e, cards: null } : e)),
  };
}
