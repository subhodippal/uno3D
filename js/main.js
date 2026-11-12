// Game controller: menus, setup, turns, CPU, pass & play, online sync, celebrations.

import { Arena } from './scene.js';
import * as R from './rules.js';
import { chooseAction } from './ai.js';
import { sfx } from './audio.js';
import * as bg from './bgfx.js';
import { HostNet, ClientNet, findMatch, findLowerTable } from './net.js';
import { flushTweens } from './anim.js';
import { view } from './view.js';
import { LanHost, LanClient, drawQR, startScanner } from './lan.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAVE_KEY = 'last3d-save';
const SET_KEY = 'last3d-settings';
const SETUP_KEY = 'last3d-setup';
const NAME_KEY = 'last3d-name';
const ROOM_KEY = 'last3d-room';    // the online room this device is in (to get back in after a reload)
const CID_KEY = 'last3d-cid';      // this device's id, so a host recognises a returning player
const AWAY_TURN_MS = 15000;        // a disconnected player's turn waits this long, then a bot plays it
const AWAY_DROP_MS = 180000;       // gone this long: a bot takes the seat for good
const EMOJIS = ['👏', '😂', '😮', '🔥', '😭', '😎', '🤯', '💀'];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const CID = store.get(CID_KEY) || (() => { const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); store.set(CID_KEY, id); return id; })();
const savedName = () => store.get(NAME_KEY) || '';
const coarse = matchMedia('(pointer: coarse)').matches;
const lowEnd = (navigator.hardwareConcurrency || 4) <= 2;
const settings = Object.assign({ special: 'medium', view: '3d', orient: 'auto', sound: true, voice: true, music: true, muted: false, vibrate: true, quality: lowEnd ? 'low' : 'high', speed: 'normal' }, store.get(SET_KEY) || {});
// the HUD speaker button mutes everything; the settings screen switches each part
if (!settings.orientSet) settings.orient = coarse ? 'portrait' : 'auto';
function applyAudio() {
  sfx.enabled = settings.sound && !settings.muted;
  sfx.voiceOn = settings.voice && !settings.muted;
  sfx.setMusic(settings.music && !settings.muted);
}
applyAudio();
sfx.vibrate = settings.vibrate;
const cpuDelay = () => ({ relaxed: 1300, normal: 850, fast: 420 }[settings.speed] || 850);

const seatCss = (s) => R.SEATS[s].css;
const avatar = (s, name) => `<span class="av" style="--c:${seatCss(s)}">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;

// ---------------------------------------------------------------- arena
// ---------------------------------------------------------------- screen orientation
const isTouch = matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('touch', isTouch);
function updateRot() {
  const physPortrait = window.innerHeight >= window.innerWidth;
  const rot = isTouch && settings.orient !== 'auto' && (settings.orient === 'portrait') !== physPortrait;
  const de = document.documentElement;
  de.style.setProperty('--rot-w', window.innerHeight + 'px');
  de.style.setProperty('--rot-h', window.innerWidth + 'px');
  if (rot !== view.rot) {
    view.rot = rot;
    de.classList.toggle('rot', rot);
    window.dispatchEvent(new Event('resize'));
  }
}
window.addEventListener('resize', () => updateRot());
window.addEventListener('orientationchange', () => setTimeout(updateRot, 200));
// Turning the screen works whatever the phone's own rotation setting is:
// 1. Android/Chrome: go fullscreen and lock the real screen rotation (this overrides the
//    phone's auto-rotate switch, but needs a tap).
// 2. If the lock isn't allowed (iPhone, some browsers, desktop-mode sites), the page itself is
//    turned 90 degrees with CSS, so the game still shows in the chosen orientation.
async function lockOrientation() {
  if (!isTouch) return;
  const so = screen.orientation;
  try {
    if (settings.orient === 'auto') { so?.unlock?.(); return; }
    if (!so?.lock) return;
    const de = document.documentElement;
    const fs = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!document.fullscreenElement && !document.webkitFullscreenElement && fs) {
      await Promise.resolve(fs.call(de, { navigationUI: 'hide' })).catch(() => {});
    }
    // don't wait forever on browsers that never settle the promise
    await Promise.race([so.lock(settings.orient), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    await new Promise((r) => setTimeout(r, 250)); // let the resize land
  } catch { /* not allowed here: the CSS turn takes over */ } finally {
    updateRot();
  }
}
updateRot();
// a mode picked in Settings: lock it for real on the first tap (Android). The default portrait
// needs no fullscreen: the page simply stays upright.
window.addEventListener('pointerdown', () => { if (settings.orientSet && settings.orient !== 'auto') lockOrientation(); }, { once: true });

const arena = new Arena($('#c'), { quality: settings.quality });
arena.setFlat(settings.view === '2d');
bg.setEnabled(settings.view !== '2d');

function syncViewChips() {
  $$('[data-act="view"]').forEach((b) => { b.classList.toggle('is2d', settings.view === '2d'); b.setAttribute('aria-checked', settings.view === '2d'); });
  $$('#segView button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.view));
  $$('#segOrient button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.orient));
}
function setView(v) {
  settings.view = v;
  store.set(SET_KEY, settings);
  arena.setFlat(v === '2d');
  bg.setEnabled(v !== '2d'); // 2D is the battery saver: no background fireworks
  syncViewChips();
  toast(v === '2d' ? '2D · battery saver: fewer effects, no shadows' : '3D view', 1500);
}
function setOrient(o) {
  settings.orient = o;
  settings.orientSet = true;
  store.set(SET_KEY, settings);
  // try the real lock first; the CSS turn only kicks in if the phone refuses
  lockOrientation().then(syncViewChips);
  if (!screen.orientation?.lock || o === 'auto') updateRot();
  syncViewChips();
  toast(o === 'auto' ? 'Screen follows your phone' : `${o[0].toUpperCase() + o.slice(1)} mode`, 1400);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  sfx.unlock(); sfx.click();
  if (b.dataset.act === 'view') setView(settings.view === '2d' ? '3d' : '2d');
  else if (b.dataset.act === 'orient') setOrient(view.w > view.h ? 'portrait' : 'landscape');
});
window.addEventListener('resize', () => syncViewChips());
syncViewChips();
arena._sfx = (name, arg) => sfx[name]?.(arg);
// bottom safe-area inset (iPhone home bar), measured once from CSS env()
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
document.body.appendChild(safeProbe);
function measureBottom() {
  arena.handBottomPx = (safeProbe.offsetHeight || 0) + 2;
  document.documentElement.style.setProperty('--hand-top', Math.round(arena.handTopPx()) + 'px');
}
window.addEventListener('resize', () => { measureBottom(); placeTags(); });

// ---------------------------------------------------------------- screens
const SCREENS = ['scrLan', 'scrMenu', 'scrSetup', 'scrOnline', 'scrSearch', 'scrLobby', 'scrPass', 'scrRound', 'scrPause', 'scrSettings', 'scrHelp', 'scrMsg'];
let current = 'scrMenu';
let overlayBack = null;
function show(id) {
  current = id;
  SCREENS.forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
}
function hideScreens() { current = null; SCREENS.forEach((s) => $('#' + s).classList.add('hidden')); }
function overlay(id) { overlayBack = current; show(id); }
function closeOverlay() { if (overlayBack) show(overlayBack); else hideScreens(); overlayBack = null; }

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function message(title, text, after) {
  $('#msgTitle').textContent = title;
  $('#msgText').textContent = text;
  show('scrMsg');
  $('#btnMsgOk').onclick = () => { sfx.click(); after ? after() : goMenu(); };
}

// ---------------------------------------------------------------- setup
const setup = Object.assign({
  mode: 'cpu', variant: 'classic', np: 4, hand: 7, target: 100, stack: true, drawMode: 'one', callRule: true, level: 'normal',
  kinds: ['human', 'cpu', 'cpu', 'cpu'], names: ['', '', '', ''],
}, store.get(SETUP_KEY) || {});

function defaultName(s, kind, kinds) {
  if (kind === 'cpu') return kinds.filter((k) => k === 'cpu').length > 1 ? `Bot ${s + 1}` : 'Bot';
  if (setup.mode === 'cpu' && kinds.filter((k) => k === 'human').length === 1) return 'You';
  return `Player ${s + 1}`;
}

function openSetup(mode) {
  setup.mode = mode;
  if (mode === 'cpu') setup.kinds = ['human', 'cpu', 'cpu', 'cpu'];
  $('#setupTitle').textContent = mode === 'host' ? 'Room settings' : mode === 'lan' ? 'Nearby game' : 'Single play';
  $('#btnStart').textContent = mode === 'host' ? 'Create room' : mode === 'lan' ? 'Create nearby game' : 'Start game';
  $('#setupErr').textContent = '';
  renderSetup();
  show('scrSetup');
}

// game config from the setup screen (setup.mode is the screen mode: 'cpu' or 'host')
function setupCfg() { return R.normalizeCfg({ ...setup, mode: setup.variant, special: settings.special }); }
function renderSetup() {
  const room = setup.mode === 'host' || setup.mode === 'lan';
  if (!room && setup.np > 4) setup.np = 4;
  $$('#pickPlayers .room-only').forEach((b) => b.classList.toggle('hidden', !room));
  const { mode: variant, special, ...c } = setupCfg();
  Object.assign(setup, c);
  setup.variant = variant;
  $$('#pickPlayers button').forEach((b) => b.classList.toggle('on', +b.dataset.v === setup.np));
  $$('#pickHand button').forEach((b) => b.classList.toggle('on', +b.dataset.v === setup.hand));
  $('#pickTarget').innerHTML = R.TARGETS.map((t) => `<button data-v="${t}" class="${t === setup.target ? 'on' : ''}"><b>${t || '∞'}</b><small>${t ? 'points' : 'free play'}</small></button>`).join('');
  $('#optStack').checked = setup.stack;
  $('#optUntil').checked = setup.drawMode === 'until';
  $('#optCall').checked = setup.callRule;
  const local = !room;
  $('#seatRows').classList.toggle('hidden', !local);
  if (local) {
    const kinds = setup.kinds.slice(0, setup.np);
    $('#seatRows').innerHTML = Array.from({ length: setup.np }, (_, s) => {
      const k = setup.kinds[s];
      const dn = defaultName(s, k, kinds);
      return `<div class="seat" style="--c:${seatCss(s)}">${avatar(s, setup.names[s] || dn)}
        <input data-seat="${s}" maxlength="12" value="${esc((k === 'human' ? setup.names[s] || savedName() : setup.names[s]) || '')}" placeholder="${esc(k === 'human' ? 'Your name' : dn)}" aria-label="Player ${s + 1} name">
        <span class="role">${k === 'human' ? 'You' : '🤖 Bot'}</span></div>`;
    }).join('');
  }
  const anyCpu = room || setup.kinds.slice(0, setup.np).includes('cpu');
  $('#levelBox').classList.toggle('hidden', !anyCpu);
  $('#levelBox .optlbl').textContent = room ? 'Bot skill (empty seats)' : 'Bot skill';
  $$('#segLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === setup.level));
}

function saveSetup() {
  store.set(SETUP_KEY, { np: setup.np, hand: setup.hand, target: setup.target, stack: setup.stack, drawMode: setup.drawMode, callRule: setup.callRule, variant: setup.variant, level: setup.level, names: setup.names });
}

const segPick = (sel, key) => $(sel).addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  sfx.click(); setup[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; renderSetup();
});
segPick('#pickPlayers', 'np');
segPick('#pickHand', 'hand');
segPick('#pickTarget', 'target');
segPick('#segLevel', 'level');
$('#optStack').addEventListener('change', (e) => { sfx.click(); setup.stack = e.target.checked; });
$('#optUntil').addEventListener('change', (e) => { sfx.click(); setup.drawMode = e.target.checked ? 'until' : 'one'; });
$('#optCall').addEventListener('change', (e) => { sfx.click(); setup.callRule = e.target.checked; });
$('#seatRows').addEventListener('click', (e) => {
  const b = e.target.closest('.kind button'); if (!b) return;
  sfx.click();
  setup.kinds[+b.parentElement.dataset.seat] = b.dataset.k;
  renderSetup();
});
$('#seatRows').addEventListener('input', (e) => {
  const i = e.target.closest('input'); if (!i) return;
  const k = +i.dataset.seat;
  setup.names[k] = i.value.trim().slice(0, 12);
  if (setup.kinds[k] === 'human') store.set(NAME_KEY, setup.names[k]); // your name, remembered for next time
});
$('#inpName').addEventListener('input', () => store.set(NAME_KEY, $('#inpName').value.trim().slice(0, 12)));

$('#btnStart').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  saveSetup();
  if (setup.mode === 'host') return hostCreate();
  if (setup.mode === 'lan') return lanCreate();
  const cfg = setupCfg();
  const kinds = setup.kinds.slice(0, cfg.np);
  const seats = kinds.map((k, s) => ({ name: (k === 'human' && (setup.names[s] || savedName())) || defaultName(s, k, kinds), kind: k }));
  startSession({ mode: 'local', cfg, seats, level: setup.level, G: R.newGame(cfg, { starter: Math.floor(Math.random() * cfg.np) }) });
});

// ---------------------------------------------------------------- session
let S = null;      // current game session
let paused = false;
let cpuTimer = null;
let shown = null;  // { seq, round, viewer, hide }
let chain = Promise.resolve();
let busy = false;  // animations running
let guestTimer = null;
let pendingWild = -1;

const humans = () => S.seats.filter((s) => s.kind === 'human').length;
const multiLocal = () => S?.mode === 'local' && humans() > 1;

// which seat's cards are on this device
function viewerSeat() {
  if (!S) return -1;
  if (S.mode !== 'local') return S.mySeat;
  const hs = S.seats.map((s, i) => (s.kind === 'human' ? i : -1)).filter((i) => i >= 0);
  if (!hs.length) return -1;
  if (hs.length === 1) return hs[0];
  if (S.viewer == null || !hs.includes(S.viewer)) S.viewer = hs[0];
  return S.viewer;
}
const hidden = () => multiLocal() && S.revealed !== viewerSeat();

function curView() {
  if (!S) return null;
  if (S.mode === 'guest') return S.V;
  return R.view(S.G, viewerSeat());
}

function isMyTurn(V) {
  if (!S || !V || V.over || busy || paused) return false;
  if (hidden()) return false;
  const me = viewerSeat();
  if (me < 0 || V.turn !== me) return false;
  if (S.mode === 'local') return S.seats[me]?.kind === 'human';
  if (S.reconnecting) return false;
  return true;
}

function startSession(sess) {
  S = { mySeat: -1, viewer: null, revealed: -1, ...sess };
  if (S.mode === 'local') persist();
  enterGame();
}

function enterGame() {
  stopDemo();
  bg.ambient(null);
  paused = false;
  hideScreens();
  $('#hud').classList.remove('hidden');
  measureBottom();
  hideBanner();
  const online = S.mode !== 'local';
  $('#roomTag').classList.toggle('hidden', !online);
  if (online) $('#roomTag').textContent = S.code;
  $('#btnEmoji').classList.toggle('hidden', !online);
  $('#emojiPanel').classList.add('hidden');
  closePicker();
  chain = Promise.resolve();
  shown = null;
  present(curView(), true);
}

function persist() {
  if (S?.mode === 'host') { saveRoom(); return; }
  if (S?.mode !== 'local') return;
  store.set(SAVE_KEY, { cfg: S.cfg, seats: S.seats, level: S.level, G: S.G, viewer: S.viewer });
}

// online: remember the room so a reload (or a dropped connection) gets you back in
function saveRoom() {
  if (!S || S.mode === 'local' || !S.code || S.lan) return;
  if (S.mode === 'guest') { store.set(ROOM_KEY, { role: 'guest', code: S.code, at: Date.now() }); return; }
  if (S.mm && !S.started) return; // a quick-match table that hasn't started isn't worth reopening
  store.set(ROOM_KEY, {
    role: 'host', code: S.code, cfg: S.cfg, level: S.level, started: !!S.started, G: S.G, at: Date.now(),
    seats: S.seats.map(({ peer, ...rest }) => rest),
  });
}
const clearRoom = () => store.del(ROOM_KEY);

// Host / local authority: apply an action, then share and show it
function commit(seat, a) {
  if (!R.act(S.G, seat, a)) return false;
  if (S.mode === 'local' && S.revealed >= 0 && S.G.turn !== S.revealed && !S.G.over && a.type !== 'call') S.pendingHide = true;
  persist();
  broadcastState();
  present(curView());
  return true;
}

function doNextRound() {
  if (!S?.G?.over) return;
  R.nextRound(S.G);
  S.revealed = -1;
  persist();
  broadcastState();
  present(curView());
}

function restartMatch() {
  if (!S || S.mode === 'guest') return;
  S.G = R.newGame(S.cfg, { starter: Math.floor(Math.random() * S.cfg.np) });
  S.revealed = -1;
  persist();
  if (S.mode === 'host') { S.net.broadcast({ t: 'start', cfg: S.cfg, seats: pubSeats(), code: S.code }); broadcastState(); }
  present(curView(), true);
}

// ---------------------------------------------------------------- presentation
// Serialised so animations never overlap
let presenting = 0; // presentations queued or running
function present(V, fresh = false) {
  if (!V) return chain;
  const snap = clone(V);
  presenting++;
  chain = chain.then(() => doPresent(snap, fresh)).catch((e) => console.error(e)).finally(() => { presenting--; });
  return chain;
}

async function doPresent(V, fresh) {
  if (!S) return;
  busy = true;
  arena.setInteractive(false);
  updateButtons(V);
  const hide = hidden();
  const mode = { handMode: V.viewer >= 0, hideHand: hide };
  const isDeal = V.evs.some((e) => e.t === 'deal');
  await arena.ready;
  if (!shown || fresh || V.round !== shown.round || V.viewer !== shown.viewer || (isDeal && V.seq !== shown.seq)) {
    if (current === 'scrRound') hideScreens();
    hideBanner();
    renderTags(V);
    const sameSeat = !shown || shown.viewer === V.viewer;
    if (isDeal && sameSeat && !(fresh && S.loaded) && (!shown || V.seq !== shown.seq)) {
      sfx.shuffle();
      Object.assign(arena, mode);
      await arena.deal(V);
    } else {
      await arena.reset(V, mode);
    }
    shown = { seq: V.seq, round: V.round, viewer: V.viewer };
  } else if (V.seq !== shown.seq) {
    if (arena.hideHand !== hide && !S.pendingHide) await arena.setHidden(hide);
    for (let i = 0; i < V.evs.length; i++) {
      if (!S) return;
      await animateEvent(V.evs[i], V, i);
    }
    shown.seq = V.seq;
    await arena.reconcile(V);
  }
  if (!S) return;
  S.loaded = true;
  if (S.pendingHide) { S.pendingHide = false; S.revealed = -1; }
  if (arena.hideHand !== hidden()) await arena.setHidden(hidden());
  busy = false;
  renderTags(V);
  checkPicker(V);
  if (V.over) {
    if (!shown.over) { shown.over = true; await showOutcome(V); } else showRoundScreen(V);
    return;
  }
  setTurnUI(V);
  maybePass(V);
  maybeCpu();
}

function popWord(text, x, y, css = '#fff') {
  const el = document.createElement('span');
  el.className = 'pop-word';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--c', css);
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
function seatPoint(s) {
  const p = arena.seatScreen(s);
  if (p) return p;
  return { x: view.w / 2, y: view.h - arena.handBottomPx - 150 };
}
function pileWord(text, css) {
  const p = arena.pileScreen();
  popWord(text, view.w / 2, Math.max(120, p.y - 30), css);
}

// card colours of the side being shown (flip mode has a light and a dark side)
const pal = (side = arena.side) => R.paletteAt(side);

async function animateEvent(ev, V, idx) {
  const name = (s) => S.seats[s]?.name || `Player ${s + 1}`;
  switch (ev.t) {
    case 'play': {
      const side = ev.side || 0;
      const c = R.faceAt(V.cfg.mode, side, ev.card);
      const p = await arena.playCard(ev.seat, ev.card);
      arena.setTable({ dir: arena.dir, color: ev.color, turn: V.turn, over: V.over, side });
      updateColorTag(ev.color, arena.dir, false, side);
      sfx.thwack(typeof c.v === 'number' ? 0.8 : 1.2);
      arena.cardFx(p, ev.card, ev.color);
      const P = pal(side);
      const css = P[ev.color].css;
      const cname = P[ev.color].name;
      const cvoice = cname.toLowerCase();
      const who = name(ev.seat);
      if (c.c === R.WILD) {
        sfx.wild();
        bg.flash(css);
        P.forEach((cc, i) => setTimeout(() => bg.launch(cc.css, 1, 0.75, true), i * 120));
        if (c.v === 'w4' || c.v === 'w2') {
          const n = R.drawAmount(c.v);
          callout(`+${n} ${cname.toUpperCase()}!`, `${who} · Pick ${n} · colour is now ${cname}`, css, [`pick${n}`, cvoice]);
          setTimeout(() => sfx.punch(), 120); setTimeout(() => sfx.plus(n), 260);
        } else if (c.v === 'wdc') {
          callout(`DRAW ${cname.toUpperCase()}!`, `${who} · next player draws until they get ${cname}`, css, ['until', cvoice]);
          setTimeout(() => sfx.punch(), 120); setTimeout(() => sfx.plus(5), 260);
          arena.shake(0.4);
        } else callout(`${cname.toUpperCase()}!`, `${who} · Colour card`, css, ['colorcard', cvoice]);
      } else if (c.v === 'd2' || c.v === 'd1' || c.v === 'd5') {
        const n = R.drawAmount(c.v);
        sfx.punch(); setTimeout(() => sfx.plus(Math.min(n, 4)), 120); bg.launch(css, n >= 5 ? 4 : 2, 0.7, true);
        if (n >= 5) arena.shake(0.35);
        callout(`PICK ${n}!`, `${who} · +${n} card${n > 1 ? 's' : ''}`, css, `pick${n}`);
      } else if (c.v === 'rev') sfx.reverse();
      else if (c.v === 'skip') { sfx.punch(); callout('SKIP!', `${who} · next player misses a turn`, css); }
      else if (c.v === 'skipall') { sfx.punch(); arena.shake(0.3); callout('SKIP EVERYONE!', `${who} plays again`, css, 'skipall'); }
      break;
    }
    case 'flip': {
      sfx.wild();
      sfx.voice('flip', { queue: true });
      const css = ev.side ? '#8e44e8' : '#1e6fd9';
      bg.flash(css);
      showBanner('FLIP!', ev.side ? 'Dark side · Pick 5, Skip Everyone, Draw Colour' : 'Back to the light side', css, 1600);
      arena.shake(0.3);
      await arena.flipAll(V);
      updateColorTag(ev.color, arena.dir, true, ev.side);
      if (ev.color >= 0) setTimeout(() => sfx.voice(pal(ev.side)[ev.color].name.toLowerCase(), { queue: true }), 200);
      break;
    }
    case 'color': {
      const P = pal();
      arena.setTable({ dir: arena.dir, color: ev.color, turn: V.turn, over: V.over, side: arena.side });
      updateColorTag(ev.color, arena.dir, false, arena.side);
      callout(`${P[ev.color].name.toUpperCase()}!`, `${name(ev.seat)} picked the colour`, P[ev.color].css, P[ev.color].name.toLowerCase());
      await sleep(300);
      break;
    }
    case 'rev': {
      const css = pal()[arena.color]?.css || '#8a5cff';
      arena.setTable({ dir: ev.dir, color: arena.color, turn: V.turn, over: V.over, side: arena.side });
      updateColorTag(arena.color, ev.dir, true, arena.side);
      const way = ev.dir > 0 ? 'Clockwise' : 'Anticlockwise';
      // let a "UNO!" shout finish first
      const wait = V.evs.some((e) => e.t === 'last' && e.seat !== undefined) ? 900 : 0;
      setTimeout(() => callout(`REVERSE ${ev.dir > 0 ? '↻' : '↺'}`, `Play now goes ${way.toLowerCase()}`, css, 'reverse', true), wait);
      await sleep(350);
      break;
    }
    case 'draw': {
      if (ev.why === 'draw') sfx.voice('draw');
      await arena.drawCards(ev.seat, ev.n, ev.cards);
      if (ev.why === 'call') {
        sfx.voice('forgot', { queue: true });
        const pt = seatPoint(ev.seat);
        popWord('FORGOT! +2', pt.x, pt.y, '#ff5d7a');
        toast(`${name(ev.seat)} forgot to call UNO! and draws 2`, 2600);
        sfx.error();
      } else if (ev.why === 'color') {
        const pt = seatPoint(ev.seat);
        popWord(`+${ev.n}`, pt.x, pt.y, '#ff5d7a');
        if (ev.n >= 4) bg.launch(seatCss(ev.seat), 2, 0.7, true);
      } else if (ev.why === 'stack' && ev.n >= 2) {
        const pt = seatPoint(ev.seat);
        popWord(`+${ev.n}`, pt.x, pt.y, '#ff5d7a');
        if (ev.n >= 6) bg.launch(seatCss(ev.seat), 2, 0.7, true);
      }
      break;
    }
    case 'shuffle': {
      sfx.shuffle();
      toast('Reshuffling the pile', 1400);
      const later = V.evs.slice(idx + 1).filter((e) => e.t === 'draw').reduce((a, e) => a + e.n, 0);
      await arena.reshuffle(V.deckCount + later);
      break;
    }
    case 'skip': {
      sfx.skip();
      if (!V.evs.some((e) => e.t === 'play' && e.v === 'skipall')) sfx.voice('skip', { queue: true });
      const pt = seatPoint(ev.seat);
      popWord('SKIPPED', pt.x, pt.y, '#ff5d7a');
      arena.seatFx(ev.seat, 0xff5d7a);
      await sleep(250);
      break;
    }
    case 'pass': {
      const pt = seatPoint(ev.seat);
      popWord('PASS', pt.x, pt.y, '#a49cc8');
      sfx.voice('pass');
      break;
    }
    case 'call':
    case 'last': {
      if (ev.t === 'last' && V.evs.some((e) => e.t === 'call')) break;
      sfx.call();
      // you already heard it when you pressed the button
      if (!(ev.seat === V.viewer && performance.now() - saidLast < 3000)) sfx.voice('uno', { queue: ev.t === 'uno' });
      setTimeout(() => sfx.boom(), 200);
      const css = seatCss(ev.seat);
      showBanner('UNO!', name(ev.seat), css, 1500);
      bg.launch(css, 4, 0.9);
      arena.shake(0.25);
      arena.seatFx(ev.seat, R.SEATS[ev.seat].hex, true);
      await sleep(ev.t === 'call' ? 300 : 150);
      break;
    }
    default:
  }
}

// HUD badge: a circular arrow in the current colour that turns the way play goes
const DIR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2A8.8 8.8 0 1 1 4.4 7.6"/><polygon points="6.2,3.4 7.2,9.2 1.6,6.8"/></svg>';
function updateColorTag(color, dir, flip = false, side = arena.side) {
  const el = $('#colorTag');
  if (color == null || color < 0) { el.innerHTML = ''; el.dataset.c = ''; return; }
  const c = R.paletteAt(side)[color];
  const changed = el.dataset.c !== String(color) || el.dataset.d !== String(dir);
  el.dataset.c = color; el.dataset.d = dir;
  el.style.setProperty('--c', c.css);
  el.innerHTML = `<i class="dirc ${dir > 0 ? 'cw' : 'ccw'}">${DIR_SVG}</i><span class="ct"><b>${c.name}</b><small>${dir > 0 ? 'Clockwise' : 'Anticlockwise'}</small></span>`;
  if (changed || flip) { el.classList.remove('bump', 'flip'); void el.offsetWidth; el.classList.add(flip ? 'flip' : 'bump'); }
  document.documentElement.style.setProperty('--turn', c.css);
}

// big highlighted text + spoken call-out for action cards
function callout(title, sub, css, voice, queue = false) {
  showBanner(title, sub, css, 1300);
  if (voice) sfx.voice(voice, { queue });
}

function renderTags(V) {
  if (!S) { $('#tags').innerHTML = ''; return; }
  $('#tags').classList.toggle('many', V.np > 4);
  // big "your turn" marker over your hand
  const meTurn = V.viewer >= 0 && !V.over && V.turn === V.viewer && !hidden();
  $('#myTurn').classList.toggle('hidden', !meTurn);
  $('#myTurn').style.setProperty('--c', seatCss(Math.max(0, V.viewer)));
  const me = V.viewer;
  const handMode = me >= 0;
  $('#tags').innerHTML = S.seats.map((seat, s) => {
    if (handMode && s === me) return '';
    const on = V.over ? V.over.winner === s : V.turn === s;
    const thinking = on && !V.over && (seat.kind === 'cpu' || (S.mode !== 'local' && s !== S.mySeat));
    const sub = seat.away ? 'Reconnecting…' : seat.left ? 'Left · Bot' : `${V.scores[s]} pts`;
    return `<div class="seat-tag ${on ? 'on' : ''} ${seat.left || seat.away ? 'gone' : ''}" data-seat="${s}" style="--c:${seatCss(s)}">
      ${on && !V.over ? '<span class="turn-mark" aria-label="Their turn">▼</span>' : ''}${avatar(s, seat.name)}<span class="nm"><b class="${thinking ? 'thinking' : ''}">${esc(seat.name)}</b><small>${esc(sub)}</small></span>
      <span class="cnt">${V.counts[s]}</span>${V.counts[s] === 1 && !V.over ? '<span class="one">1 CARD</span>' : ''}</div>`;
  }).join('');
  placeTags();
  updateColorTag(V.awaitColor ? -1 : V.color, V.dir, false, V.side);
  // pending draw badge on the pile
  const pd = $('#pending');
  if (V.pending > 0 && !V.over) {
    const p = arena.pileScreen();
    pd.textContent = `+${V.pending}`;
    pd.style.left = p.x + 'px';
    pd.style.top = p.y + 'px';
    pd.classList.remove('hidden');
  } else pd.classList.add('hidden');
}

function placeTags() {
  $$('#tags .seat-tag').forEach((el) => {
    const p = arena.seatScreen(+el.dataset.seat);
    if (!p) return;
    const w = el.offsetWidth / 2 + 8;
    el.style.left = Math.max(w, Math.min(view.w - w, p.x)) + 'px';
    el.style.top = Math.max(90, Math.min(view.h - 120, p.y)) + 'px';
  });
}
arena.onLayout = () => { placeTags(); document.documentElement.style.setProperty('--hand-top', Math.round(arena.handTopPx()) + 'px'); };

function setTurnUI(V) {
  const me = V.viewer;
  const mine = isMyTurn(V);
  arena.setInteractive(mine);
  const ids = mine ? V.my.filter((id) => R.playable(V, id, me)) : [];
  arena.setPlayable(ids);
  const seat = S.seats[V.turn];
  let text;
  if (mine && V.awaitColor) {
    text = 'Choose the colour';
    if (pendingWild !== AFTER_FLIP) openPicker(AFTER_FLIP);
  } else if (mine) {
    if (V.pending > 0) text = ids.length ? `Stack or draw ${V.pending}` : `Draw ${V.pending}`;
    else if (V.drawn >= 0) text = 'Play it or pass';
    else text = ids.length ? 'Your turn' : 'No match · draw';
  } else if (S.mode === 'local' && seat.kind === 'human') text = `${seat.name}'s turn`;
  else text = seat.kind === 'cpu' ? `${seat.name} is thinking` : seat.away ? `${seat.name} is reconnecting` : `Waiting for ${seat.name}`;
  const showCount = me >= 0 && !hidden();
  $('#status').innerHTML = `<span class="av" style="--c:${seatCss(V.turn)}"></span><span class="${mine ? '' : 'dots'}">${esc(text)}</span>${showCount ? `<small style="opacity:.6;margin-left:4px">· ${V.my.length}</small>` : ''}`;
  updateButtons(V, ids);
  if (mine && shown.prevTurn !== me) { sfx.turn(); sfx.buzz(25); if (!hidden()) sfx.voice('turn', { queue: true }); }
  shown.prevTurn = V.turn;
}

function updateButtons(V, ids = []) {
  const mine = V && isMyTurn(V);
  const d = $('#btnDraw');
  const l = $('#btnLast');
  d.classList.toggle('hidden', !mine || !!V.awaitColor);
  l.classList.toggle('hidden', !(mine && V.cfg.callRule && V.my.length === 2 && !V.called[V.viewer] && ids.length));
  if (!mine) return;
  if (V.drawn >= 0) { d.textContent = 'Pass'; d.classList.remove('hint'); }
  else { d.textContent = V.pending > 0 ? `Draw ${V.pending}` : 'Draw'; d.classList.toggle('hint', !ids.length); }
}

function winnerTitle(w) {
  if (S.mode === 'local') return humans() === 1 && S.seats[w].kind === 'human' ? 'You win!' : `${S.seats[w].name} wins`;
  return w === S.mySeat ? 'You win!' : `${S.seats[w].name} wins`;
}

async function showOutcome(V) {
  const w = V.over.winner;
  arena.setInteractive(false);
  $('#status').innerHTML = '';
  updateButtons(null);
  const css = seatCss(w);
  const iWon = S.mode === 'local' ? S.seats[w].kind === 'human' : w === S.mySeat;
  const lost = !iWon && (S.mode !== 'local' || humans() === 1);
  const champ = V.champ != null;
  showBanner(champ ? (iWon && (S.mode !== 'local' || humans() === 1) ? 'Champion!' : `${S.seats[w].name} takes it`) : winnerTitle(w), `+${V.over.pts} points`, css, 2600);
  arena.celebrate(w);
  sfx.boom();
  sfx.voice(iWon && (S.mode !== 'local' || humans() === 1) ? 'youwin' : 'winner', { queue: true });
  if (lost) { setTimeout(() => sfx.lose(), 350); bg.launch(css, 4, 0.85, true); } else {
    setTimeout(() => sfx.win(), 250);
    setTimeout(() => sfx.cheer(), 500);
    bg.party(css, champ ? 4 : 3);
  }
  firecrackers(champ ? 7 : 4);
  await sleep(2600);
  if (!S) return;
  showRoundScreen(V);
  if (S.mode === 'local' && humans() === 0) setTimeout(() => { if (S?.G.over && !paused) { hideScreens(); doNextRound(); } }, 3500);
}

// a volley of crackers in all four colours with booms
function firecrackers(waves = 4) {
  for (let i = 0; i < waves; i++) {
    setTimeout(() => {
      if (!S && i) return;
      bg.launch(R.COLORS[i % 4].css, 3, 0.9 + Math.random() * 0.3);
      bg.launch(R.COLORS[(i + 2) % 4].css, 2, 0.8, true);
      if (i % 2 === 0) { sfx.boom(); arena.shake(0.15); }
    }, i * 650);
  }
}

function miniCard(V, id) {
  const c = R.face(V, id);
  const k = c.c === R.WILD ? '#2b2b2e' : R.palette(V)[c.c].css;
  const t = typeof c.v === 'number' ? c.v : { skip: '⊘', rev: '⇄', d2: '+2', wild: '★', w4: '+4', d1: '+1', w2: '+2', d5: '+5', flip: '⟲', skipall: '⊘⊘', wdc: '+?' }[c.v];
  return `<i style="--k:${k}">${t}</i>`;
}

function showRoundScreen(V) {
  const w = V.over.winner;
  const champ = V.champ != null;
  $('#roundTitle').textContent = champ ? `${S.seats[w].name} wins the match` : `Round ${V.round} · ${winnerTitle(w)}`;
  $('#roundSub').textContent = V.cfg.target ? `First to ${V.cfg.target} points` : 'Free play · points add up';
  const order = S.seats.map((_, i) => i).sort((a, b) => V.scores[b] - V.scores[a]);
  $('#roundRows').innerHTML = order.map((s) => {
    const hand = V.over.hands[s] || [];
    const got = s === w ? `+${V.over.pts}` : `${hand.length} left`;
    return `<div class="seat ${s === w ? 'win' : ''}" style="--c:${seatCss(s)}">${avatar(s, S.seats[s].name)}
      <div class="info"><b>${esc(S.seats[s].name)}</b><span class="sub">${got}</span>${hand.length ? `<div class="minis">${hand.slice(0, 14).map((id) => miniCard(V, id)).join('')}${hand.length > 14 ? '<i>…</i>' : ''}</div>` : ''}</div>
      <span class="pts">${V.scores[s]}</span></div>`;
  }).join('');
  const nb = $('#btnNext');
  nb.disabled = false;
  nb.textContent = champ ? 'New match' : 'Next round';
  $('#btnRoundMenu').textContent = S.mode === 'local' ? 'Quit to menu' : 'Leave game';
  show('scrRound');
}

let bannerTimer = null;
function showBanner(title, sub, css, ms = 2600) {
  const b = $('#banner');
  clearTimeout(bannerTimer);
  b.classList.remove('hidden', 'out');
  const bb = b.querySelector('b');
  bb.textContent = title;
  bb.classList.toggle('long', title.length > 8);
  bb.style.setProperty('--c', css || '#8a5cff');
  b.querySelector('small').textContent = sub || '';
  bb.style.animation = 'none'; void bb.offsetWidth; bb.style.animation = '';
  bannerTimer = setTimeout(() => { b.classList.add('out'); bannerTimer = setTimeout(() => b.classList.add('hidden'), 500); }, ms);
}
function hideBanner() { clearTimeout(bannerTimer); $('#banner').classList.add('hidden'); }

// ---------------------------------------------------------------- pass & play
function maybePass(V) {
  if (!multiLocal() || V.over || paused) return;
  const t = V.turn;
  if (S.seats[t].kind !== 'human' || S.revealed === t) return;
  $('#passTitle').textContent = `Pass to ${S.seats[t].name}`;
  $('#passIcon').style.setProperty('--c', seatCss(t));
  $('#passIcon').textContent = S.seats[t].name.charAt(0).toUpperCase();
  show('scrPass');
}
$('#btnReveal').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  if (!S) return;
  hideScreens();
  const t = S.G.turn;
  S.viewer = t;
  S.revealed = t;
  persist();
  present(curView(), false);
});

// ---------------------------------------------------------------- CPU
function maybeCpu() {
  clearTimeout(cpuTimer);
  if (!S || S.mode === 'guest' || paused) return;
  const G = S.G;
  if (!G || G.over) return;
  const auto = (st) => st?.kind === 'cpu' || (st?.kind === 'remote' && st.away);
  const who = S.seats[G.turn];
  if (!auto(who)) return;
  // a disconnected player gets time to come back before a bot plays this one turn for them
  const delay = who.kind === 'cpu' ? cpuDelay() * (0.75 + Math.random() * 0.5) : AWAY_TURN_MS;
  cpuTimer = setTimeout(() => {
    if (!S || paused || busy || S.G.over || !auto(S.seats[S.G.turn])) return;
    const seat = S.G.turn;
    const st = S.seats[seat];
    if (st.kind === 'remote' && Date.now() - (st.awaySince || 0) > AWAY_DROP_MS) {
      S.seats[seat] = { name: st.name, kind: 'cpu', left: true, cid: st.cid };
      toast(`${st.name} didn't come back. A bot takes over.`, 3000);
    }
    const a = chooseAction(S.G, seat, S.level);
    if (!commit(seat, a)) commit(seat, S.G.drawn >= 0 ? { type: 'pass' } : { type: 'draw' });
  }, delay);
}

// ---------------------------------------------------------------- input
function submit(a) {
  const V = curView();
  if (!isMyTurn(V)) { sfx.error(); return; }
  if (a.type === 'play' && R.isWild(V, a.card) && !(a.color >= 0 && a.color < 4)) { openPicker(a.card); return; }
  arena.setInteractive(false);
  updateButtons(null);
  if (S.mode === 'guest') {
    S.net.send({ t: 'act', a });
    clearTimeout(guestTimer);
    guestTimer = setTimeout(() => { if (S && isMyTurn(S.V)) setTurnUI(S.V); }, 4000);
  } else if (!commit(V.viewer, a)) { sfx.error(); setTurnUI(V); }
}

function rejectCard() {
  const V = curView();
  sfx.error();
  if (!V || !isMyTurn(V)) { toast('Wait for your turn', 1200); return; }
  if (V.pending > 0) toast(`Stack a ${V.pendType === 'd2' ? '+2 or +4' : '+4'}, or draw ${V.pending}`);
  else if (V.drawn >= 0) toast('You can only play the card you drew');
  else if (V.awaitColor) toast('Choose a colour first', 1400);
  else toast(`Match ${R.palette(V)[V.color].name} or the symbol`, 1500);
}
arena.onReject = () => rejectCard();
arena.onPeek = (id) => $('#tags').classList.toggle('peeking', id >= 0);
// a card raised for a closer look: keep the "your turn" label out of its way
arena.onHover = (id) => $('#myTurn').classList.toggle('dim', id >= 0);
arena.onPile = () => { sfx.unlock(); if (arena.peekPile()) sfx.flip(); };
arena.onCard = (id) => {
  sfx.unlock();
  const V = curView();
  if (!isMyTurn(V)) return;
  if (!R.playable(V, id, V.viewer)) { rejectCard(); return; }
  if (pendingWild !== -1 && id !== pendingWild) { toast('Choose a colour first', 1400); return; }
  if (R.isWild(V, id)) { openPicker(id); return; }
  submit({ type: 'play', card: id });
};
arena.onDeck = () => {
  sfx.unlock();
  const V = curView();
  if (!isMyTurn(V)) return;
  if (V.drawn >= 0) { submit({ type: 'pass' }); return; }
  submit({ type: 'draw' });
};
$('#btnDraw').addEventListener('click', () => { sfx.unlock(); sfx.click(); arena.onDeck(); });
let saidLast = -1e9;
$('#btnLast').addEventListener('click', () => {
  sfx.unlock();
  sfx.voice('uno'); // straight away, inside the tap, so phones allow the sound
  saidLast = performance.now();
  submit({ type: 'call' });
});

// pendingWild: the colour card waiting for a colour, or AFTER_FLIP when a Flip turned up a colour card
const AFTER_FLIP = -2;
function openPicker(id) {
  pendingWild = id;
  const V = curView();
  const P = R.palette(V);
  $('#swatches').innerHTML = P.map((c, i) => `<button data-c="${i}" style="--c:${c.css}">${c.name}<small></small></button>`).join('');
  const v = id >= 0 ? R.face(V, id).v : null;
  $('#picker p').innerHTML = id === AFTER_FLIP ? '<b>Flip</b> turned up a colour card · choose a colour'
    : v === 'w4' ? '<b>Pick 4</b> · choose a colour' : v === 'w2' ? '<b>Pick 2</b> · choose a colour'
      : v === 'wdc' ? '<b>Wild Draw Colour</b> · the next player draws until they get…' : '<b>Colour card</b> · choose a colour';
  $('#btnPickCancel').classList.toggle('hidden', id === AFTER_FLIP);
  const counts = [0, 0, 0, 0];
  V.my.forEach((x) => { const c = R.face(V, x); if (c.c < 4 && x !== id) counts[c.c]++; });
  $$('#swatches button').forEach((b, i) => { b.querySelector('small').textContent = counts[i] ? `${counts[i]} in hand` : ''; });
  $('#picker').classList.remove('hidden');
  sfx.pop();
}
function closePicker() { pendingWild = -1; $('#picker').classList.add('hidden'); }
// keep the colour picker open across screen updates while that card can still be played
function checkPicker(V) {
  if (pendingWild < 0) return;
  const ok = V && !V.over && isMyTurn(V) && (pendingWild === AFTER_FLIP ? V.awaitColor : V.my.includes(pendingWild) && R.playable(V, pendingWild, V.viewer));
  if (!ok) closePicker();
}
$('#swatches').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || pendingWild === -1) return;
  const id = pendingWild;
  closePicker();
  if (id === AFTER_FLIP) submit({ type: 'color', color: +b.dataset.c });
  else submit({ type: 'play', card: id, color: +b.dataset.c });
});
$('#btnPickCancel').addEventListener('click', () => { sfx.click(); closePicker(); });

$('#btnNext').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  if (!S) return;
  if (S.mode === 'guest') {
    S.net.send({ t: 'next' });
    $('#btnNext').disabled = true;
    $('#btnNext').textContent = 'Waiting for host…';
  } else { hideScreens(); doNextRound(); }
});
$('#btnRoundMenu').addEventListener('click', () => { sfx.click(); goMenu(); });

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  if (e.key === 'Escape') {
    if (pendingWild >= 0) closePicker();
    else if (current === 'scrPause') resume();
    else if (S && !current) openPause();
    return;
  }
  if (!S || current) {
    if ((e.key === 'Enter' || e.key === ' ') && current === 'scrRound') { e.preventDefault(); $('#btnNext').click(); }
    if ((e.key === 'Enter' || e.key === ' ') && current === 'scrPass') { e.preventDefault(); $('#btnReveal').click(); }
    return;
  }
  const V = curView();
  if (pendingWild !== -1 && e.key >= '1' && e.key <= '4') { $$('#swatches button')[+e.key - 1].click(); return; }
  if (e.key === ' ' || e.key === 'd' || e.key === 'D') { e.preventDefault(); arena.onDeck(); }
  else if (/^[lLcC]$/.test(e.key) && !$('#btnLast').classList.contains('hidden')) $('#btnLast').click();
  else if (/^[0-9]$/.test(e.key) && isMyTurn(V)) {
    // number keys play the n-th playable card
    const ids = arena.order.filter((id) => arena.playable.has(id));
    const id = ids[(+e.key || 10) - 1];
    if (id != null) arena.onCard(id);
  }
});

// ---------------------------------------------------------------- HUD buttons
function syncSoundBtn() { $('#btnSound').classList.toggle('muted', settings.muted || !(settings.sound || settings.voice || settings.music)); }
syncSoundBtn();
$('#btnSound').addEventListener('click', () => {
  const allOff = settings.muted || !(settings.sound || settings.voice || settings.music);
  settings.muted = !allOff;
  if (allOff) { if (!settings.sound && !settings.voice && !settings.music) Object.assign(settings, { sound: true, voice: true, music: true }); }
  sfx.unlock();
  applyAudio();
  store.set(SET_KEY, settings);
  syncSoundBtn();
  sfx.click();
});

$('#btnPause').addEventListener('click', () => { sfx.click(); openPause(); });
function openPause() {
  if (!S) return;
  if (S.mode === 'local') { paused = true; clearTimeout(cpuTimer); }
  closePicker();
  const V = curView();
  $('#pauseRule').textContent = `${S.code ? `Room ${S.code} · ` : ''}${R.describe(S.cfg)} · Round ${V?.round || 1}`;
  $('#pauseScores').innerHTML = V ? S.seats.map((seat, s) => `<div class="seat" style="--c:${seatCss(s)}">${avatar(s, seat.name)}
    <div class="info"><b>${esc(seat.name)}</b><span class="sub">${V.counts[s]} cards${seat.kind === 'cpu' ? ' · Bot' : ''}</span></div><span class="pts">${V.scores[s]}</span></div>`).join('') : '';
  $('#btnRestart').classList.toggle('hidden', S.mode === 'guest');
  $('#btnQuit').textContent = S.mode === 'local' ? 'Quit to menu' : 'Leave game';
  $('#btnPauseLan').classList.toggle('hidden', !(S.lan && S.mode === 'host'));
  show('scrPause');
}
function resume() {
  hideScreens();
  paused = false;
  const V = curView();
  if (V?.over) { showRoundScreen(V); return; }
  if (V) { setTurnUI(V); maybePass(V); }
  maybeCpu();
}
$('#btnResume').addEventListener('click', () => { sfx.click(); resume(); });
$('#btnRestart').addEventListener('click', () => { sfx.click(); hideScreens(); paused = false; restartMatch(); });
$('#btnQuit').addEventListener('click', () => { sfx.click(); goMenu(); });
$('#btnPauseSettings').addEventListener('click', () => { sfx.click(); openSettings(); });
$('#btnPauseHelp').addEventListener('click', () => { sfx.click(); openHelp(); });
$('#roomTag').addEventListener('click', () => shareRoom());

// emoji reactions (online)
$('#emojiPanel').innerHTML = EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
$('#btnEmoji').addEventListener('click', () => { sfx.click(); $('#emojiPanel').classList.toggle('hidden'); });
$('#emojiPanel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !S) return;
  $('#emojiPanel').classList.add('hidden');
  const em = b.dataset.e;
  if (S.mode === 'guest') S.net.send({ t: 'emoji', e: em });
  else if (S.mode === 'host') S.net.broadcast({ t: 'emoji', seat: S.mySeat, e: em });
  flyEmoji(S.mySeat, em);
});
function flyEmoji(seat, e) {
  if (!EMOJIS.includes(e)) return;
  sfx.pop();
  const p = seatPoint(seat);
  const el = document.createElement('span');
  el.className = 'fly-emoji';
  el.textContent = e;
  el.style.left = p.x + 'px';
  el.style.top = (p.y - 40) + 'px';
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// ---------------------------------------------------------------- menu
function goMenu() {
  clearTimeout(cpuTimer);
  clearTimeout(guestTimer);
  stopSearch();
  endMatchmaking();
  reconnTok++;
  setNetStatus(null);
  clearRoom();
  lanScan?.stop(); lanScan = null;
  if (S?.net) {
    // tell the others this is on purpose, so nobody waits for us to come back
    const net = S.net;
    try { if (S.mode === 'guest') net.send({ t: 'bye' }); else if (S.mode === 'host') net.broadcast({ t: 'end' }); } catch { /* ignore */ }
    setTimeout(() => { try { net.close(); } catch { /* ignore */ } }, 300);
  }
  S = null;
  paused = false;
  busy = false;
  chain = Promise.resolve();
  $('#hud').classList.add('hidden');
  $('#tags').innerHTML = '';
  closePicker();
  hideBanner();
  document.documentElement.style.setProperty('--turn', '#7e57c2');
  if (location.search) history.replaceState(null, '', location.pathname);
  measureBottom();
  refreshMenu();
  show('scrMenu');
  menuRockets();
  startDemo();
}

function refreshMenu() {
  const sv = store.get(SAVE_KEY);
  // only single-player saves (offline multiplayer is not offered)
  const ok = sv?.G && !sv.G.over && (sv.seats || []).filter((x) => x.kind === 'human').length <= 1;
  $('#btnContinue').classList.toggle('hidden', !ok);
  if (ok) $('#btnContinue').textContent = `Continue · ${sv.seats.length}P · Round ${sv.G.round}`;
}

$('#btnVsCpu').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSetup('cpu'); });
$('#btnGroup').addEventListener('click', () => { sfx.unlock(); sfx.click(); openOnline('', 'group'); });
$('#btnOnline').addEventListener('click', () => { sfx.unlock(); sfx.click(); openOnline('', 'online'); });
$('#btnNearby').addEventListener('click', () => { sfx.unlock(); sfx.click(); openOnline('', 'nearby'); });
$('#btnContinue').addEventListener('click', () => {
  sfx.unlock(); sfx.click();
  const sv = store.get(SAVE_KEY);
  if (!sv?.G) return refreshMenu();
  startSession({ mode: 'local', cfg: R.normalizeCfg(sv.cfg), seats: sv.seats, level: sv.level || 'normal', G: sv.G, viewer: sv.viewer, loaded: true });
});
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { sfx.click(); show('scrMenu'); }));

// settings
function openSettings() {
  $('#setSound').checked = settings.sound;
  $('#setVoice').checked = settings.voice;
  $('#setMusic').checked = settings.music;
  $('#setVibrate').checked = settings.vibrate;
  $$('#segQuality button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.quality));
  syncViewChips();
  $$('#segSpeed button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.speed));
  syncSpecial();
  overlay('scrSettings');
}
$('#btnSettings').addEventListener('click', () => { sfx.unlock(); sfx.click(); openSettings(); });
function setAudio(key, on) {
  settings[key] = on;
  if (on) settings.muted = false;
  sfx.unlock();
  applyAudio();
  store.set(SET_KEY, settings);
  syncSoundBtn();
}
$('#setSound').addEventListener('change', (e) => { setAudio('sound', e.target.checked); sfx.click(); });
$('#setVoice').addEventListener('change', (e) => { setAudio('voice', e.target.checked); if (e.target.checked) sfx.voice('uno'); });
$('#setMusic').addEventListener('change', (e) => setAudio('music', e.target.checked));
$('#setVibrate').addEventListener('change', (e) => { settings.vibrate = e.target.checked; sfx.vibrate = settings.vibrate; store.set(SET_KEY, settings); sfx.buzz(30); });
// how often special cards (Skip, Reverse, Pick 2/4, colour cards, Flip...) come up after a shuffle
const SPECIAL_NOTE = {
  low: 'Normal shuffle · about 30% of your cards are special',
  medium: 'Special cards 2.5× as likely · about 50% of your cards',
  high: 'Special cards 5× as likely · about 65% of your cards',
};
function syncSpecial() {
  $$('#segSpecial button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.special));
  $('#specialNote').textContent = SPECIAL_NOTE[settings.special] + (S && S.mode !== 'guest' ? ' (from the next game)' : '');
}
$('#segSpecial').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click();
  settings.special = b.dataset.v;
  store.set(SET_KEY, settings);
  syncSpecial();
});
$('#segView').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { sfx.click(); setView(b.dataset.v); } });
$('#segOrient').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { sfx.click(); setOrient(b.dataset.v); } });
$('#segQuality').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click();
  settings.quality = b.dataset.v;
  store.set(SET_KEY, settings);
  arena.setQuality(settings.quality);
  $$('#segQuality button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#segSpeed').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click();
  settings.speed = b.dataset.v;
  store.set(SET_KEY, settings);
  $$('#segSpeed button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#btnSettingsClose').addEventListener('click', () => { sfx.click(); closeOverlay(); });

// help
function openHelp() {
  const c = S?.cfg ? R.normalizeCfg(S.cfg) : setupCfg();
  $('#helpBody').innerHTML = `
    <p>Be the first to <b>empty your hand</b>. Play a card that matches the top of the pile by <b>colour</b> or by <b>number / symbol</b>. If you can't, tap the draw pile.</p>
    ${c.mode === 'flip' ? `
    <p><b>UNO Flip:</b> every card has a <b>light side</b> (red, yellow, green, blue) and a <b>dark side</b> (pink, teal, orange, purple). You can see the other side of your opponents' cards and of the top of the draw pile.</p>
    <div class="legend">
      <i style="--violet:#1e6fd9">⟲</i><span><b>Flip</b>: everything turns over: every hand, the draw pile and the discard pile. The card that ends up on top sets the colour (if it's a colour card, the player who flipped picks).</span>
      <i style="--violet:#e53935">+1</i><span><b>Pick 1</b> (light): the next player draws 1 and misses a turn${c.stack ? ' (or stacks a +1 or Wild +2)' : ''}.</span>
      <i>+2</i><span><b>Wild Pick 2</b> (light): pick the colour, the next player draws 2 and misses a turn.</span>
      <i style="--violet:#e8458b">+5</i><span><b>Pick 5</b> (dark): the next player draws 5 and misses a turn${c.stack ? ' (or stacks a +5)' : ''}.</span>
      <i style="--violet:#00a6a6">⊘⊘</i><span><b>Skip Everyone</b> (dark): everyone else is skipped, you go again.</span>
      <i>+?</i><span><b>Wild Draw Colour</b> (dark): pick a colour; the next player draws until they get that colour and misses a turn.</span>
      <i style="--violet:#2e9e44">⇄</i><span><b>Reverse</b> and <b>Skip</b> work as usual; <b>★</b> colour cards on both sides.</span>
    </div>` : `
    <div class="legend">
      <i style="--violet:#1e6fd9">⊘</i><span><b>Skip</b>: the next player misses a turn.</span>
      <i style="--violet:#2e9e44">⇄</i><span><b>Reverse</b>: play changes direction (with 2 players it acts as Skip).</span>
      <i style="--violet:#e53935">+2</i><span><b>Pick 2</b>: the next player draws 2 and misses a turn${c.stack ? ', unless they stack another +2 or a +4 on it' : ''}.</span>
      <i>★</i><span><b>Colour card</b>: play it on anything and pick the next colour.</span>
      <i>+4</i><span><b>Pick 4</b>: pick the colour, the next player draws 4 and misses a turn${c.stack ? ' (or stacks a +4)' : ''}.</span>
    </div>`}
    <p><b>Drawing:</b> ${c.drawMode === 'until' ? 'keep drawing until you get a card you can play' : 'draw one card'}. If it fits you can play it straight away, or pass.</p>
    ${c.callRule ? '<p><b>UNO!</b> When you have two cards and are about to play one, tap the big yellow <b>UNO!</b> button first (everyone hears you shout it). Forget, and you draw 2 as a penalty.</p>' : ''}
    <p><b>Scoring:</b> the round winner scores the cards left in everyone else's hands. ${c.mode === 'flip' ? 'Numbers count face value; Pick 1 is 10, Reverse / Skip / Flip / Pick 5 are 20, Skip Everyone 30, colour cards 40, Wild Pick 2 50 and Wild Draw Colour 60.' : 'Numbers count face value, action cards 20 and colour cards 50.'} ${c.target ? `First to <b>${c.target}</b> points wins the match.` : 'Free play: points keep adding up.'}</p>
    <p><b>Controls:</b> tap a raised card, or <b>swipe it up</b>, to throw it. <b>Press and hold</b> a card to look at it closely, and tap the discard pile to see its top card. Tap the deck or <b>Draw</b> if nothing fits. Keyboard: Space draws or passes, 1–9 plays your playable cards in order, C or L calls UNO!, Esc opens the menu.</p>`;
  overlay('scrHelp');
}
$('#btnHelp').addEventListener('click', () => { sfx.unlock(); sfx.click(); openHelp(); });
$('#btnHow').addEventListener('click', () => { sfx.click(); openHelp(); });
$('#btnHelpClose').addEventListener('click', () => { sfx.click(); closeOverlay(); });

// ---------------------------------------------------------------- online
function myName() {
  const v = $('#inpName').value.trim().slice(0, 12) || 'Player';
  store.set(NAME_KEY, v);
  return v;
}
let onlineView = 'online';
function openOnline(code = '', view = code ? 'group' : onlineView) {
  onlineView = view;
  $('#scrOnline').dataset.view = view;
  $('#onlineTitle').textContent = view === 'group' ? 'Group play' : view === 'nearby' ? '📶 Wi-Fi / Hotspot' : 'Online match';
  $('#inpName').value = store.get(NAME_KEY) || '';
  $('#inpCode').value = code;
  $('#onlineMsg').textContent = '';
  show('scrOnline');
}
$('#btnCreate').addEventListener('click', () => { sfx.click(); myName(); openSetup('host'); });
$('#btnJoin').addEventListener('click', () => { sfx.unlock(); sfx.click(); guestJoin(); });
$('#inpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') guestJoin(); });

const pubSeats = () => S.seats.map((s) => ({ name: s.name, kind: s.kind === 'remote' ? 'human' : s.kind, host: !!s.host, left: !!s.left, away: !!s.away }));

function roomLink() { return location.origin + location.pathname + '?room=' + S.code; }
async function shareRoom() {
  if (!S?.code) return;
  const url = roomLink();
  if (navigator.share) {
    try { await navigator.share({ title: R.GAME_NAME, text: `Join my card game, room ${S.code}`, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url, 4000); }
}
$('#btnShare').addEventListener('click', () => { sfx.click(); shareRoom(); });
$('#btnCopy').addEventListener('click', async () => {
  sfx.click();
  try { await navigator.clipboard.writeText(S.code); $('#btnCopy').textContent = 'Copied!'; } catch { $('#btnCopy').textContent = S.code; }
  setTimeout(() => { $('#btnCopy').textContent = 'Copy code'; }, 1400);
});
$('#btnLobbyLeave').addEventListener('click', () => { sfx.click(); goMenu(); });

function renderLobby() {
  if (!S) return;
  const mm = !!S.mm;
  const lan = !!S.lan;
  $('#lobbyTitle').textContent = mm ? '⚡ Quick match' : lan ? '📶 Nearby game' : 'Room';
  $('#lobbyCodeBox').classList.toggle('hidden', mm || lan);
  $('#lobbyShareRow').classList.toggle('hidden', mm || lan);
  $('#btnLanAdd').classList.toggle('hidden', !(lan && S.mode === 'host' && S.seats.some((x) => x.kind === 'open')));
  $('#lobbyCode').textContent = S.code;
  $('#lobbyRule').textContent = `${R.describe(S.cfg)} · ${S.cfg.np} players`;
  $('#lobbySeats').innerHTML = S.seats.map((s, i) => {
    const open = s.kind === 'open';
    const tag = i === S.mySeat ? 'You' : s.host ? 'Host' : open ? 'Waiting…' : s.kind === 'cpu' ? 'Bot' : 'Joined';
    return `<div class="seat ${open ? 'open' : ''}" style="--c:${seatCss(i)}">${avatar(i, open ? '?' : s.name)}<span class="name">${esc(open ? 'Empty seat' : s.name)}</span><span class="tag">${tag}</span></div>`;
  }).join('');
  const isHost = S.mode === 'host';
  const empty = S.seats.filter((s) => s.kind === 'open').length;
  $('#btnLobbyStart').classList.toggle('hidden', !isHost);
  $('#btnLobbyStart').textContent = mm ? 'Play now · bots fill empty seats' : 'Start game';
  if (mm) { $('#lobbyNote').textContent = S.mmNote || (isHost ? 'Waiting for players…' : 'Waiting for the game to start…'); return; }
  if (lan) {
    $('#lobbyNote').textContent = isHost
      ? (empty ? 'Tap “Add a player” for each friend. Their phone must be on the same Wi-Fi or your hotspot. Empty seats get bots.' : 'Everyone is here!')
      : 'Waiting for the host to start…';
    return;
  }
  $('#lobbyNote').textContent = isHost
    ? (empty ? `Share the code. ${empty === 1 ? 'An empty seat' : 'Empty seats'} will be played by the computer.` : 'Everyone is here!')
    : 'Waiting for the host to start…';
}

// ----- host
async function hostCreate() {
  const btn = $('#btnStart');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  $('#setupErr').textContent = '';
  const net = new HostNet();
  try {
    const code = await net.start();
    const cfg = setupCfg();
    const seats = Array.from({ length: cfg.np }, (_, i) => (i === 0 ? { name: store.get(NAME_KEY) || 'Host', kind: 'human', host: true } : { name: '', kind: 'open' }));
    S = { mode: 'host', net, code, cfg, seats, level: setup.level, mySeat: 0, started: false, G: null };
    wireHost(net);
    saveRoom();
    renderLobby();
    show('scrLobby');
  } catch (e) {
    net.close();
    $('#setupErr').textContent = e.message || 'Could not create room';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create room';
  }
}

function wireHost(net) {
  const seatOf = (peer) => S?.seats.findIndex((s) => s.peer === peer) ?? -1;
  net.on('message', (peer, msg) => {
    if (!S || S.net !== net || !msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 40) : '';
      // a player coming back (reload, or a dropped connection) gets their own seat again
      const back = cid ? S.seats.findIndex((x) => x.cid === cid && (x.kind === 'remote' || (x.kind === 'cpu' && x.left))) : -1;
      if (back >= 0) {
        const old = S.seats[back];
        if (old.peer && old.peer !== peer) net.kick(old.peer);
        S.seats[back] = { name: old.name, kind: 'remote', peer, cid };
        net.send(peer, { t: 'welcome', seat: back, cfg: S.cfg, seats: pubSeats(), code: S.code, started: !!S.started });
        if (S.started) {
          net.send(peer, { t: 'start', cfg: S.cfg, seats: pubSeats(), code: S.code });
          broadcastState();
          toast(`${old.name} is back`, 1800);
          const V = curView();
          renderTags(V);
          if (!V.over && !busy) setTurnUI(V);
          maybeCpu();
        } else {
          net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
          renderLobby();
        }
        saveRoom();
        return;
      }
      if (S.started) { net.send(peer, { t: 'reject', msg: 'That game has already started.' }); setTimeout(() => net.kick(peer), 300); return; }
      const k = S.seats.findIndex((x) => x.kind === 'open');
      if (k < 0) { net.send(peer, { t: 'reject', msg: 'That room is full.' }); setTimeout(() => net.kick(peer), 300); return; }
      const name = String(msg.name || '').trim().slice(0, 12) || `Player ${k + 1}`;
      S.seats[k] = { name, kind: 'remote', peer, cid };
      net.send(peer, { t: 'welcome', seat: k, cfg: S.cfg, seats: pubSeats(), code: S.code });
      net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
      sfx.pop();
      renderLobby();
      saveRoom();
      return;
    }
    const seat = seatOf(peer);
    if (seat < 0) return;
    if (msg.t === 'act' && S.started && msg.a && typeof msg.a === 'object') {
      const a = { type: String(msg.a.type), card: +msg.a.card, color: +msg.a.color };
      if (!commit(seat, a)) net.send(peer, { t: 'state', V: R.view(S.G, seat), seats: pubSeats() });
    } else if (msg.t === 'next' && S.started) {
      if (S.G.over) { hideScreens(); doNextRound(); }
    } else if (msg.t === 'emoji') {
      net.broadcast({ t: 'emoji', seat, e: msg.e });
      flyEmoji(seat, msg.e);
    } else if (msg.t === 'bye') { // left on purpose
      const name = S.seats[seat].name;
      if (S.started) {
        S.seats[seat] = { name, kind: 'cpu', left: true };
        toast(`${name} left. A bot takes over.`, 3000);
        afterSeatChange();
      } else {
        S.seats[seat] = { name: '', kind: 'open' };
        net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
        renderLobby();
      }
      saveRoom();
      net.kick(peer);
    }
  });
  const afterSeatChange = () => {
    broadcastState();
    const V = curView();
    renderTags(V);
    if (!V.over && !busy) setTurnUI(V);
    maybeCpu();
  };
  net.on('leave', (peer) => {
    if (!S || S.net !== net) return;
    const k = seatOf(peer);
    if (k < 0) return;
    const name = S.seats[k].name;
    if (S.started) {
      // connection lost (bad signal, reload...): keep the seat and wait for them to come back
      S.seats[k] = { ...S.seats[k], peer: null, away: true, awaySince: Date.now() };
      toast(`${name} lost connection · waiting for them`, 2600);
      saveRoom();
      afterSeatChange();
    } else {
      S.seats[k] = { name: '', kind: 'open' };
      net.broadcast({ t: 'lobby', cfg: S.cfg, seats: pubSeats() });
      renderLobby();
    }
  });
  net.on('error', (m) => toast(m, 3000));
}

$('#btnLobbyStart').addEventListener('click', () => { sfx.unlock(); sfx.click(); startOnlineGame(); });
function startOnlineGame() {
  if (S?.mode !== 'host' || S.started) return;
  endMatchmaking();
  S.seats = S.seats.map((s, i) => (s.kind === 'open' ? { name: `Bot ${i + 1}`, kind: 'cpu' } : s));
  S.started = true;
  S.G = R.newGame(S.cfg, { starter: Math.floor(Math.random() * S.cfg.np) });
  S.net.broadcast({ t: 'start', cfg: S.cfg, seats: pubSeats(), code: S.code });
  broadcastState();
  saveRoom();
  enterGame();
}

// the host reloaded: reopen the same room code and carry on (guests reconnect by themselves)
async function hostRestore(rec) {
  message('Reopening your room…', `Room ${rec.code} · getting everyone back`, () => goMenu());
  $('#btnMsgOk').textContent = 'Cancel';
  const net = new HostNet();
  try {
    await net.start(rec.code);
  } catch (e) {
    net.close();
    if (current !== 'scrMsg') return; // cancelled
    clearRoom();
    message('Could not reopen the room', e.message || 'Try again in a minute.');
    return;
  }
  if (current !== 'scrMsg') { net.close(); return; } // cancelled meanwhile
  $('#btnMsgOk').textContent = 'OK';
  const seats = rec.seats.map((x) => (x.kind === 'remote' ? { ...x, peer: null, away: true, awaySince: Date.now() } : x));
  S = { mode: 'host', net, code: rec.code, cfg: R.normalizeCfg(rec.cfg), seats, level: rec.level || 'normal', mySeat: 0, started: !!rec.started, G: rec.G };
  wireHost(net);
  saveRoom();
  if (S.started && S.G) enterGame();
  else { renderLobby(); show('scrLobby'); }
}

// every guest gets their own view (other hands stay secret)
function broadcastState() {
  if (S?.mode !== 'host' || !S.started) return;
  const seats = pubSeats();
  S.seats.forEach((s, i) => { if (s.kind === 'remote' && s.peer) S.net.send(s.peer, { t: 'state', V: R.view(S.G, i), seats }); });
}

// ----- guest
async function guestJoin(codeArg, opts = {}) {
  const code = String(typeof codeArg === 'string' ? codeArg : $('#inpCode').value).trim().toUpperCase();
  if (opts.mm) return mmJoin(code, opts.mm);
  if (code.length !== 5) { $('#onlineMsg').textContent = 'Enter the 5-letter room code.'; return; }
  const name = myName();
  const btn = $('#btnJoin');
  btn.disabled = true;
  btn.textContent = '…';
  $('#onlineMsg').textContent = '';
  const net = new ClientNet();
  try {
    await net.join(code);
    S = { mode: 'guest', net, code, cfg: null, seats: [], mySeat: -1, V: null };
    wireGuest(net);
    net.send({ t: 'hello', name, cid: CID });
  } catch (e) {
    net.close();
    $('#onlineMsg').textContent = e.message || 'Could not join';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join';
  }
}

// try to get back into a room for a while (the host may be reloading, or our signal is weak)
let reconnTok = 0;
async function guestReconnect(code, timeout = 120000) {
  const tok = ++reconnTok;
  const t0 = Date.now();
  setNetStatus('Reconnecting…');
  while (Date.now() - t0 < timeout) {
    if (tok !== reconnTok) return false;
    const net = new ClientNet();
    try {
      await net.join(code);
      if (tok !== reconnTok) { net.close(); return false; }
      if (!S || S.code !== code) S = { mode: 'guest', net, code, cfg: null, seats: [], mySeat: -1, V: null };
      S.net = net;
      S.resync = true;
      wireGuest(net);
      net.send({ t: 'hello', name: savedName() || 'Player', cid: CID });
      setNetStatus('Rejoining…');
      return true;
    } catch {
      net.close();
    }
    setNetStatus(`Reconnecting… ${Math.max(0, Math.round((timeout - (Date.now() - t0)) / 1000))}s`);
    await sleep(2500);
  }
  if (tok === reconnTok) setNetStatus(null);
  return false;
}

function setNetStatus(text) {
  const el = $('#netStatus');
  el.classList.toggle('hidden', !text);
  if (text) el.querySelector('span').textContent = text;
}

function roomClosed(text) {
  reconnTok++;
  setNetStatus(null);
  clearRoom();
  try { S?.net?.close(); } catch { /* ignore */ }
  S = null;
  $('#hud').classList.add('hidden');
  $('#tags').innerHTML = '';
  message('Room closed', text);
}

// after a reload: back into the room we were in
async function guestRestore(rec) {
  message('Rejoining the room…', `Room ${rec.code}`, () => goMenu());
  $('#btnMsgOk').textContent = 'Cancel';
  const ok = await guestReconnect(rec.code, 60000);
  if (!ok && current === 'scrMsg') { clearRoom(); $('#btnMsgOk').textContent = 'OK'; message('Room closed', `Could not get back into room ${rec.code}.`); }
}

function wireGuest(net) {
  net.on('message', (msg) => {
    if (!S || S.net !== net || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        S.mySeat = msg.seat; S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats;
        S.reconnecting = false;
        setNetStatus(null);
        saveRoom();
        if (msg.started) { S.started = true; break; } // back into a running game: the state follows
        sfx.pop();
        renderLobby(); show('scrLobby');
        break;
      case 'end':
        roomClosed('The host ended the game.');
        break;
      case 'lobby':
        S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats;
        if (current === 'scrLobby') renderLobby();
        break;
      case 'start':
        S.cfg = R.normalizeCfg(msg.cfg); S.seats = msg.seats;
        S.started = true;
        S.V = null;
        break;
      case 'state': {
        clearTimeout(guestTimer);
        S.seats = msg.seats || S.seats;
        const first = !S.V;
        S.V = msg.V;
        S.reconnecting = false;
        setNetStatus(null);
        if (S.resync && !first && !$('#hud').classList.contains('hidden')) { S.resync = false; present(S.V, true); break; }
        S.resync = false;
        if (first || $('#hud').classList.contains('hidden')) enterGame();
        else {
          if (current === 'scrRound' && !S.V.over) hideScreens();
          present(S.V);
        }
        break;
      }
      case 'emoji':
        if (msg.seat !== S.mySeat) flyEmoji(msg.seat, msg.e);
        break;
      case 'mm':
        S.mmNote = String(msg.note || '').slice(0, 120);
        if (current === 'scrLobby') renderLobby();
        break;
      case 'reject': {
        const mm = S.mm;
        S.net.close();
        S = null;
        clearRoom();
        if (mm) { toast('That table just filled up. Searching again…', 2200); quickMatch(mm.np); break; }
        message('Can’t join', msg.msg || 'Room unavailable', () => openOnline());
        break;
      }
      default:
    }
  });
  net.on('close', async () => {
    if (!S || S.net !== net) return;
    const mm = S.mm && !S.started ? S.mm : null;
    if (mm) { S = null; clearRoom(); toast('The host left. Searching again…', 2200); quickMatch(mm.np); return; }
    if (S.lan) { roomClosed('Lost the connection to the host. To get back in, tap Wi-Fi / Hotspot → Join a game and ask the host to re-add you (you keep your seat).'); return; }
    // dropped (bad signal, or the host is reloading): keep trying to get back in
    S.reconnecting = true;
    arena.setInteractive(false);
    updateButtons(null);
    const code = S.code;
    const ok = await guestReconnect(code);
    if (!ok && S && S.code === code && S.reconnecting) roomClosed('Lost the connection to the room.');
  });
  net.on('error', (m) => toast(m, 3000));
}

// ---------------------------------------------------------------- nearby (Wi-Fi / hotspot, no internet)
// One screen (#scrLan) walks through the QR exchange. lanStep() shows one step and resolves with
// the next action: 'main' / 'alt' (the buttons), 'cancel', or a scanned / typed code.
let lanScan = null;
let lanStepResolve = null;
let lanBack = 'scrOnline';
function lanStep({ title, text, qr = null, scan = false, typing = false, main = null, alt = null }) {
  lanScan?.stop(); lanScan = null;
  $('#lanTitle').textContent = title;
  $('#lanText').textContent = text;
  $('#lanErr').textContent = '';
  $('#lanQr').classList.toggle('hidden', !qr);
  if (qr) drawQR($('#lanQr'), qr);
  $('#lanCode').classList.toggle('hidden', !typing && !qr);
  $('#lanCode').readOnly = !!qr;
  $('#lanCode').value = qr || '';
  $('#lanCam').classList.toggle('hidden', !scan || typing);
  $('#lanMain').classList.toggle('hidden', !main);
  $('#lanMain').textContent = main || '';
  $('#lanAlt').classList.toggle('hidden', !alt);
  $('#lanAlt').textContent = alt || '';
  show('scrLan');
  return new Promise((resolve) => {
    lanStepResolve = resolve;
    if (scan && !typing) {
      lanScan = startScanner($('#lanVideo'));
      lanScan.result.then((code) => { if (code && lanStepResolve === resolve) { sfx.pop(); resolve(code); } })
        .catch((e) => { if (lanStepResolve === resolve) $('#lanErr').textContent = (e && e.name === 'NotAllowedError' ? 'Camera blocked. ' : '') + 'Can’t use the camera here. Tap “Type the code”.'; });
    }
  });
}
$('#lanMain').addEventListener('click', () => {
  sfx.click();
  if (!$('#lanCode').readOnly && !$('#lanCode').classList.contains('hidden')) { lanStepResolve?.($('#lanCode').value.trim()); return; }
  lanStepResolve?.('main');
});
$('#lanAlt').addEventListener('click', () => { sfx.click(); lanStepResolve?.('alt'); });
$('#lanCancel').addEventListener('click', () => { sfx.click(); lanScan?.stop(); lanScan = null; lanStepResolve?.('cancel'); });
$('#lanCode').addEventListener('focus', () => { if ($('#lanCode').readOnly) $('#lanCode').select(); });

// scan a code with the camera, or type / paste it. Resolves with the code or null (cancelled).
async function lanGetCode(title, text) {
  let typing = false;
  for (;;) {
    const r = await lanStep({ title, text, scan: true, typing, main: typing ? 'Use this code' : null, alt: typing ? 'Use the camera' : 'Type the code' });
    if (r === 'cancel') return null;
    if (r === 'alt') { typing = !typing; continue; }
    if (r && r !== 'main') return r;
  }
}

$('#btnLanHost').addEventListener('click', () => { sfx.unlock(); sfx.click(); myName(); openSetup('lan'); });
$('#btnLanJoin').addEventListener('click', () => { sfx.unlock(); sfx.click(); myName(); lanJoin(); });
$('#btnLanAdd').addEventListener('click', () => { sfx.click(); lanAddPlayer('scrLobby'); });
$('#btnPauseLan').addEventListener('click', () => { sfx.click(); lanAddPlayer('scrPause'); });

function lanCreate() {
  const net = new LanHost();
  net.start();
  const cfg = setupCfg();
  const seats = Array.from({ length: cfg.np }, (_, i) => (i === 0 ? { name: savedName() || 'Host', kind: 'human', host: true } : { name: '', kind: 'open' }));
  S = { mode: 'host', net, code: net.code, lan: true, cfg, seats, level: setup.level, mySeat: 0, started: false, G: null };
  wireHost(net);
  renderLobby();
  show('scrLobby');
}

// host: one QR exchange per friend
async function lanAddPlayer(back) {
  if (!S?.lan || S.mode !== 'host') return;
  const net = S.net;
  let inv;
  lanStep({ title: 'Add a player', text: 'Making a code…' });
  try { inv = await net.invite(); } catch (e) { lanStep({ title: 'Add a player', text: e.message || 'Could not make a code.', main: 'OK' }).then(() => show(back)); return; }
  for (;;) {
    const r = await lanStep({
      title: 'Add a player · step 1 of 2',
      text: 'On your friend’s phone: Wi-Fi / Hotspot → “Join a game”, then let them scan this code.',
      qr: inv.code, main: 'Next: scan their code',
    });
    if (r === 'cancel') { inv.cancel(); show(back); return; }
    const reply = await lanGetCode('Add a player · step 2 of 2', 'Now scan the code on your friend’s screen.');
    if (!reply) continue; // back to the first code
    lanStep({ title: 'Connecting…', text: 'Linking the two phones over Wi-Fi.' });
    try {
      await inv.accept(reply);
      toast('Connected!', 1400);
      if (S?.started && back === 'scrPause') resume(); else show(back);
      return;
    } catch (e) {
      const again = await lanStep({ title: 'Couldn’t connect', text: e.message || 'Try again.', main: 'Try again' });
      if (again === 'cancel') { inv.cancel(); show(back); return; }
    }
  }
}

// guest: scan the host's code, show ours, wait for the link
async function lanJoin() {
  const offer = await lanGetCode('Join a game · step 1 of 2', 'On the host’s phone: “Add a player”. Scan the code it shows.');
  if (!offer) { openOnline('', 'nearby'); return; }
  const net = new LanClient();
  let reply;
  try { reply = await net.answer(offer); } catch (e) {
    await lanStep({ title: 'That didn’t work', text: e.message || 'Try again.', main: 'OK' });
    net.close(); openOnline('', 'nearby'); return;
  }
  const waiting = lanStep({ title: 'Join a game · step 2 of 2', text: 'Show this code to the host to scan. Keep this screen open…', qr: reply });
  const r = await Promise.race([net.connected.then(() => 'ok', (e) => e), waiting]);
  if (r !== 'ok') {
    net.close();
    if (r instanceof Error) await lanStep({ title: 'Couldn’t connect', text: r.message, main: 'OK' });
    openOnline('', 'nearby');
    return;
  }
  S = { mode: 'guest', net, code: net.code, lan: true, cfg: null, seats: [], mySeat: -1, V: null };
  wireGuest(net);
  net.send({ t: 'hello', name: savedName() || 'Player', cid: CID });
  lanStep({ title: 'Connected!', text: 'Waiting for the host…' });
}

// ---------------------------------------------------------------- quick match
const MM_KEY = 'last3d-mm-np';
const MM_WAIT = 30; // seconds a table waits for more players before bots fill in
const mmCfg = (np) => R.normalizeCfg({ mode: mmMode, np, hand: 7, target: 100, stack: true, drawMode: 'one', callRule: true, special: settings.special });
let mmNp = [2, 3, 4].includes(store.get(MM_KEY)) ? store.get(MM_KEY) : 4;
let mmMode = setup.variant === 'flip' ? 'flip' : 'classic'; // follows the menu tabs
// classic and flip players never meet: they use different tables
const mmTable = (np) => (mmMode === 'flip' ? `flip${np}` : np);
let mmToken = 0;
let mmTicker = null;
let searchClock = null;

function renderMmPick() {
  $$('#mmPlayers button').forEach((b) => b.classList.toggle('on', +b.dataset.v === mmNp));
}

// ---------------------------------------------------------------- game tabs (main menu): UNO / UNO Flip
const GAME_INFO = {
  classic: { name: 'UNO', tag: 'Match the colour or number · first to empty their hand wins' },
  flip: { name: 'UNO Flip', tag: 'Two-sided cards · a Flip turns everything to the dark side' },
};
function renderVariant() {
  const v = setup.variant === 'flip' ? 'flip' : 'classic';
  $$('#gameTabs button').forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#scrMenu').classList.toggle('flip', v === 'flip');
  $('#tagline').textContent = GAME_INFO[v].tag;
  const chip = `<span class="${v}">${v === 'flip' ? '🌗' : '🃏'} ${GAME_INFO[v].name}</span><small>change it on the main menu</small>`;
  $('#setupGame').innerHTML = chip;
  $('#mmGame').innerHTML = chip;
}
function setVariant(v) {
  setup.variant = v;
  mmMode = v;
  saveSetup();
  renderVariant();
}
$('#gameTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.v === setup.variant) return;
  sfx.unlock(); sfx.click();
  setVariant(b.dataset.v);
  if (b.dataset.v === 'flip') { sfx.voice('flip'); bg.flash('#8e44e8'); } else bg.flash('#1e6fd9');
});
renderVariant();
renderMmPick();
$('#mmPlayers').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sfx.click(); mmNp = +b.dataset.v; store.set(MM_KEY, mmNp); renderMmPick();
});
$('#btnQuick').addEventListener('click', () => { sfx.unlock(); sfx.click(); myName(); quickMatch(mmNp); });
$('#btnSearchCancel').addEventListener('click', () => { sfx.click(); stopSearch(); openOnline(); });

function stopSearch() { mmToken++; clearInterval(searchClock); }

async function quickMatch(np) {
  stopSearch();
  const tok = ++mmToken;
  const alive = () => tok === mmToken;
  const t0 = Date.now();
  $('#searchMsg').textContent = `Looking for a ${np}-player ${mmMode === 'flip' ? 'Flip ' : ''}table`;
  $('#searchTime').textContent = '0:00';
  searchClock = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    $('#searchTime').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }, 1000);
  show('scrSearch');
  try {
    const r = await findMatch(mmTable(np), {
      cancelled: () => !alive(),
      onStatus: (i) => { if (alive()) $('#searchMsg').textContent = `Looking for a ${np}-player table · checking table ${i + 1}`; },
    });
    if (!r || !alive()) { r?.host?.destroy(); return; }
    clearInterval(searchClock);
    if (r.host) await hostMatch(r.host, np, r.slot);
    else await mmJoin(r.join, np);
  } catch (e) {
    if (!alive()) return;
    clearInterval(searchClock);
    message('No match right now', e.message || 'Could not reach the matchmaking server.', () => openOnline());
  }
}

// we claimed an empty table: open a room and keep the beacon up until it starts
async function hostMatch(beacon, np, slot = 0) {
  const net = new HostNet();
  let code;
  try { code = await net.start(); } catch (e) { beacon.destroy(); net.close(); throw e; }
  const seats = Array.from({ length: np }, (_, i) => (i === 0 ? { name: store.get(NAME_KEY) || 'Host', kind: 'human', host: true } : { name: '', kind: 'open' }));
  S = { mode: 'host', net, code, cfg: mmCfg(np), seats, level: 'normal', mySeat: 0, started: false, G: null, mm: { np, beacon, slot, since: Date.now(), fullAt: 0 } };
  wireHost(net);
  const answer = (conn) => {
    const reply = () => {
      const ok = S?.mm?.beacon === beacon && !S.started && S.seats.some((x) => x.kind === 'open');
      try { conn.send(ok ? { t: 'room', code } : { t: 'full' }); } catch { /* ignore */ }
      setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 2500);
    };
    if (conn.open) reply(); else conn.on('open', reply);
  };
  // answer anyone who knocked while the room was being created, then everyone else directly
  const queued = beacon.mmQueue || [];
  beacon.mmQueue = null;
  queued.forEach(answer);
  beacon.on('connection', answer);
  beacon.on('disconnected', () => { if (!beacon.destroyed) beacon.reconnect(); });
  beacon.on('error', () => {});
  renderLobby();
  show('scrLobby');
  sfx.pop();
  clearInterval(mmTicker);
  mmTicker = setInterval(mmTick, 1000);
  mmTick();
}

function mmTick() {
  if (!S?.mm || S.mode !== 'host' || S.started) { clearInterval(mmTicker); return; }
  const now = Date.now();
  const humans = S.seats.filter((x) => x.kind !== 'open').length;
  const empty = S.seats.length - humans;
  const waited = Math.floor((now - S.mm.since) / 1000);
  let note;
  if (!empty) {
    if (!S.mm.fullAt) S.mm.fullAt = now;
    const left = 3 - Math.floor((now - S.mm.fullAt) / 1000);
    if (left <= 0) { startOnlineGame(); return; }
    note = `Everyone's here! Starting in ${left}…`;
  } else {
    S.mm.fullAt = 0;
    if (humans >= 2) {
      const left = MM_WAIT - waited;
      if (left <= 0) { startOnlineGame(); return; }
      note = `${humans} players found · starting in ${left}s (bots fill ${empty === 1 ? 'the empty seat' : 'empty seats'})`;
    } else {
      note = `Waiting for players… ${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, '0')}`;
      maybeMergeDown();
    }
  }
  S.mmNote = note;
  S.net.broadcast({ t: 'mm', note });
  if (current === 'scrLobby') renderLobby();
}

// alone at a higher table? if someone is waiting at a lower one, close ours and join theirs
function maybeMergeDown() {
  const mm = S?.mm;
  if (!mm || !mm.slot || mm.merging || Date.now() - (mm.lastMerge || 0) < 6000) return;
  mm.merging = true;
  mm.lastMerge = Date.now();
  findLowerTable(mmTable(mm.np), mm.slot).then((code) => {
    mm.merging = false;
    const alone = S?.mm === mm && !S.started && S.seats.filter((x) => x.kind !== 'open').length === 1;
    if (!code || !alone) return;
    endMatchmaking();
    try { S.net.close(); } catch { /* ignore */ }
    S = null;
    show('scrSearch');
    mmJoin(code, mm.np);
  });
}

function endMatchmaking() {
  clearInterval(mmTicker);
  if (S?.mm?.beacon) { try { S.mm.beacon.destroy(); } catch { /* ignore */ } S.mm.beacon = null; }
}

// a beacon pointed us at a room: join it, and go back to searching if that fails
async function mmJoin(code, np) {
  const net = new ClientNet();
  $('#searchMsg').textContent = 'Table found! Joining…';
  try {
    await net.join(code);
    S = { mode: 'guest', net, code, cfg: null, seats: [], mySeat: -1, V: null, mm: { np } };
    wireGuest(net);
    net.send({ t: 'hello', name: store.get(NAME_KEY) || 'Player', cid: CID });
    saveRoom();
  } catch {
    net.close();
    quickMatch(np);
  }
}

// ---------------------------------------------------------------- menu demo
// Behind the menu, four computer players keep a game going.
let demoToken = 0;
async function startDemo() {
  const tok = ++demoToken;
  const alive = () => tok === demoToken;
  const pause = async (ms) => { do { await sleep(ms); } while (document.hidden && alive()); return alive(); };
  await arena.ready;
  arena.setDemo(true);
  arena.frame();
  arena.setInteractive(false);
  while (alive()) {
    const G = R.newGame({ np: 4, hand: 5, stack: true }, { starter: 0 });
    Object.assign(arena, { handMode: false, hideHand: false });
    await arena.deal(R.view(G, -1));
    while (alive() && !G.over) {
      if (!(await pause(650))) return;
      const seat = G.turn;
      if (!R.act(G, seat, chooseAction(G, seat, 'normal'))) R.act(G, seat, G.drawn >= 0 ? { type: 'pass' } : { type: 'draw' });
      const V = R.view(G, -1);
      for (const ev of V.evs) {
        if (!alive()) return;
        if (ev.t === 'play') {
          const p = await arena.playCard(ev.seat, ev.card);
          arena.setTable({ ...V, color: ev.color });
          arena.cardFx(p, ev.card, ev.color);
        } else if (ev.t === 'draw') await arena.drawCards(ev.seat, ev.n, null);
        else if (ev.t === 'shuffle') await arena.reshuffle(V.deckCount);
      }
      if (!alive()) return;
      await arena.reconcile(V);
    }
    if (!alive()) return;
    arena.celebrate(G.over.winner);
    if (!(await pause(2600))) return;
  }
}
function stopDemo() {
  demoToken++;
  arena.setDemo(false);
  arena.frame();
}

// ---------------------------------------------------------------- PWA + boot
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall').classList.remove('hidden'); });
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  $('#btnInstall').classList.add('hidden');
});
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushTweens(); });
// close the room link explicitly so the others notice at once (the computer takes the seat)
window.addEventListener('pagehide', () => { try { S?.net?.close(); } catch { /* ignore */ } });
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
// some browsers load speech voices lazily
try { window.speechSynthesis?.getVoices(); window.speechSynthesis?.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices()); } catch { /* no speech */ }

const menuRockets = () => bg.ambient(() => R.COLORS[Math.floor(Math.random() * 4)].css);
menuRockets();
refreshMenu();
show('scrMenu');
measureBottom();
startDemo();

const roomParam = new URLSearchParams(location.search).get('room');
const roomRec = store.get(ROOM_KEY);
if (roomRec && Date.now() - (roomRec.at || 0) > 6 * 3600e3) clearRoom();
const fresh = roomRec && Date.now() - (roomRec.at || 0) <= 6 * 3600e3 && roomRec.code && (!roomParam || roomParam.toUpperCase() === roomRec.code);
if (fresh && roomRec.role === 'host') hostRestore(roomRec);
else if (fresh && roomRec.role === 'guest') guestRestore(roomRec);
else if (roomParam) openOnline(roomParam.toUpperCase().slice(0, 5));

// handy for debugging from the console
window.__last = { arena, R, sfx, animateEvent, commit, get S() { return S; }, get busy() { return busy; }, get idle() { return !busy && presenting === 0; }, get screen() { return current; } };
