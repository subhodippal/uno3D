// Pure rules engine for the shedding card game (no DOM, no three.js).
// The host / local device owns the full state G; everyone else sees view(G, seat).

export const GAME_NAME = 'Color Card 3D';

export const COLORS = [
  { name: 'Red', css: '#e53935', hex: 0xe53935 },
  { name: 'Yellow', css: '#f9b800', hex: 0xf9b800 },
  { name: 'Green', css: '#2e9e44', hex: 0x2e9e44 },
  { name: 'Blue', css: '#1e6fd9', hex: 0x1e6fd9 },
];
export const WILD = 4;

// seat identities (separate from card colours)
export const SEATS = [
  { name: 'Purple', css: '#7e57c2', hex: 0x7e57c2 },
  { name: 'Orange', css: '#f57c00', hex: 0xf57c00 },
  { name: 'Teal', css: '#00897b', hex: 0x00897b },
  { name: 'Pink', css: '#d81b60', hex: 0xd81b60 },
];

// 108 cards: per colour one 0, two each of 1-9, Skip, Reverse, +2; plus 4 Wild and 4 Wild +4
export const DECK = [];
for (let c = 0; c < 4; c++) {
  DECK.push({ c, v: 0 });
  for (let v = 1; v <= 9; v++) DECK.push({ c, v }, { c, v });
  for (const v of ['skip', 'rev', 'd2']) DECK.push({ c, v }, { c, v });
}
for (let i = 0; i < 4; i++) DECK.push({ c: WILD, v: 'wild' });
for (let i = 0; i < 4; i++) DECK.push({ c: WILD, v: 'w4' });

export const card = (id) => DECK[id];
export const isWild = (id) => DECK[id].c === WILD;
export const isNumber = (id) => typeof DECK[id].v === 'number';
export const faceKey = (id) => `${DECK[id].c}:${DECK[id].v}`;
export function points(id) {
  const { v } = DECK[id];
  if (typeof v === 'number') return v;
  return v === 'wild' || v === 'w4' ? 50 : 20;
}
export function label(id) {
  const { c, v } = DECK[id];
  const L = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', w4: 'Wild +4' }[v] ?? String(v);
  return c === WILD ? L : `${COLORS[c].name} ${L}`;
}

export const HANDS = [5, 7, 10];
export const TARGETS = [0, 100, 250, 500]; // 0 = free play (no match end)

export function normalizeCfg(c = {}) {
  return {
    np: Math.max(2, Math.min(4, Math.round(+c.np || 2))),
    hand: HANDS.includes(+c.hand) ? +c.hand : 7,
    target: TARGETS.includes(+c.target) ? +c.target : 100,
    stack: c.stack !== false,
    drawMode: c.drawMode === 'until' ? 'until' : 'one',
    callRule: c.callRule !== false,
  };
}

export function describe(cfg) {
  const c = normalizeCfg(cfg);
  return `${c.hand} cards · ${c.target ? `to ${c.target} pts` : 'free play'}`;
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

// ---------------------------------------------------------------- game
export function newGame(cfgIn, { round = 1, scores = null, starter = 0 } = {}) {
  const cfg = normalizeCfg(cfgIn);
  const np = cfg.np;
  const G = {
    cfg, np,
    deck: shuffle(DECK.map((_, i) => i)),
    discard: [],
    hands: Array.from({ length: np }, () => []),
    color: 0, turn: starter % np, dir: 1,
    pending: 0, pendType: null, drawn: -1,
    called: Array(np).fill(false),
    scores: scores ? scores.slice() : Array(np).fill(0),
    round, starter: starter % np,
    over: null, champ: null,
    seq: 0, evs: [],
  };
  for (let k = 0; k < cfg.hand; k++) for (let s = 0; s < np; s++) G.hands[s].push(G.deck.pop());
  // the first discard is always a number card
  let first = G.deck.pop();
  while (!isNumber(first)) { G.deck.unshift(first); first = G.deck.pop(); }
  G.discard.push(first);
  G.color = DECK[first].c;
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

// Works on a full state or a view (both carry top / color / pending / drawn)
export function playable(S, id, seat = S.turn) {
  if (S.over || S.turn !== seat) return false;
  if (S.drawn >= 0 && id !== S.drawn) return false;
  const c = DECK[id];
  const t = DECK[S.top ?? top(S)];
  if (S.pending > 0) return c.v === 'w4' || (c.v === 'd2' && S.pendType === 'd2');
  if (c.c === WILD) return true;
  return c.c === S.color || c.v === t.v;
}

function draw(G, seat, n, why) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!G.deck.length) {
      if (G.discard.length <= 1) break;
      const t = G.discard.pop();
      G.deck = shuffle(G.discard);
      G.discard = [t];
      G.evs.push({ t: 'shuffle' });
    }
    const id = G.deck.pop();
    G.hands[seat].push(id);
    got.push(id);
  }
  if (got.length) G.evs.push({ t: 'draw', seat, n: got.length, cards: got, why });
  if (G.hands[seat].length > 1) G.called[seat] = false;
  return got;
}

function endRound(G, w) {
  let pts = 0;
  G.hands.forEach((h, s) => { if (s !== w) pts += h.reduce((a, id) => a + points(id), 0); });
  G.scores[w] += pts;
  G.over = { winner: w, pts, hands: G.hands.map((h) => h.slice()) };
  if (G.cfg.target && G.scores[w] >= G.cfg.target) G.champ = w;
  G.evs.push({ t: 'win', seat: w, pts });
}

// Apply an action for seat. Returns true if it was legal.
// a = { type: 'play', card, color } | { type: 'draw' } | { type: 'pass' } | { type: 'call' }
export function act(G, seat, a) {
  if (!a || G.over || seat !== G.turn) return false;
  const hand = G.hands[seat];
  const evs = [];
  G.evs = evs;

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
  const c = DECK[id];
  hand.splice(at, 1);
  G.discard.push(id);
  G.drawn = -1;
  G.color = c.c === WILD ? (COLORS[a.color] ? +a.color : 0) : c.c;
  evs.push({ t: 'play', seat, card: id, color: G.color });

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
  const isDraw = c.v === 'd2' || c.v === 'w4';
  if (isDraw) { G.pending += c.v === 'd2' ? 2 : 4; G.pendType = c.v; }

  if (hand.length === 0) {
    // a final draw card still lands on the next player (and counts for the score)
    if (isDraw) {
      const v = step(G);
      const n = G.pending;
      G.pending = 0; G.pendType = null;
      draw(G, v, n, 'stack');
    }
    endRound(G, seat);
    G.seq++;
    return true;
  }

  if (c.v === 'skip' || (c.v === 'rev' && G.np === 2)) {
    evs.push({ t: 'skip', seat: step(G) });
    G.turn = step(G, 2);
  } else if (isDraw && !G.cfg.stack) {
    const v = step(G);
    const n = G.pending;
    G.pending = 0; G.pendType = null;
    draw(G, v, n, 'stack');
    evs.push({ t: 'skip', seat: v });
    G.turn = step(G, 2);
  } else {
    G.turn = step(G);
  }
  G.seq++;
  return true;
}

// What one seat is allowed to see. seat = -1 for a spectator.
export function view(G, seat) {
  return {
    np: G.np, cfg: G.cfg, viewer: seat,
    my: seat >= 0 ? G.hands[seat].slice() : [],
    counts: G.hands.map((h) => h.length),
    pile: G.discard.slice(-10),
    top: top(G),
    deckCount: G.deck.length,
    color: G.color, turn: G.turn, dir: G.dir,
    pending: G.pending, pendType: G.pendType,
    drawn: seat === G.turn ? G.drawn : -1,
    called: G.called.slice(),
    scores: G.scores.slice(),
    round: G.round, over: G.over, champ: G.champ,
    seq: G.seq,
    evs: G.evs.map((e) => (e.t === 'draw' && e.seat !== seat ? { ...e, cards: null } : e)),
  };
}
