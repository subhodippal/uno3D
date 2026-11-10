// Online play over WebRTC using PeerJS (public broker for signalling only;
// game data flows peer-to-peer). The host is authoritative.

const PREFIX = 'last3d-neon-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './vendor/peerjs.min.js';
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error('Could not load networking library')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function makeCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

function friendlyError(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'Room not found. Check the code.';
  if (t === 'unavailable-id') return 'Room code clash, try again.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Network problem: cannot reach the matchmaking server.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return err?.message || 'Connection error';
}

export class HostNet {
  constructor() { this.conns = new Map(); this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  async start() {
    await loadPeer();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeCode();
      try {
        await new Promise((res, rej) => {
          const peer = new window.Peer(PREFIX + code, { debug: 0 });
          this.peer = peer;
          peer.on('open', () => res());
          peer.on('error', (e) => {
            if (!this.code) rej(e);
            else if (e.type !== 'peer-unavailable') this._emit('error', friendlyError(e));
          });
          peer.on('connection', (conn) => this._accept(conn));
          peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        });
        this.code = code;
        return code;
      } catch (e) {
        this.peer?.destroy();
        if (e.type !== 'unavailable-id') throw new Error(friendlyError(e));
      }
    }
    throw new Error('Could not create room');
  }

  _accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', (msg) => this._emit('message', conn.peer, msg));
      conn.on('close', () => { this.conns.delete(conn.peer); this._emit('leave', conn.peer); });
      conn.on('error', () => {});
    });
  }

  send(id, msg) { const c = this.conns.get(id); if (c?.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  kick(id) { this.conns.get(id)?.close(); this.conns.delete(id); }
  close() { for (const c of this.conns.values()) c.close(); this.peer?.destroy(); this.conns.clear(); }
}

export class ClientNet {
  constructor() { this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  async join(code) {
    await loadPeer();
    code = code.trim().toUpperCase();
    await new Promise((res, rej) => {
      const peer = new window.Peer({ debug: 0 });
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => { if (!opened) rej(new Error('Timed out connecting to room.')); }, 15000);
      peer.on('error', (e) => { if (!opened) { clearTimeout(timer); rej(new Error(friendlyError(e))); } else this._emit('error', friendlyError(e)); });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => { opened = true; clearTimeout(timer); res(); });
        conn.on('data', (msg) => this._emit('message', msg));
        conn.on('close', () => this._emit('close'));
        conn.on('error', () => {});
      });
    });
    this.code = code;
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }
  close() { this.conn?.close(); this.peer?.destroy(); }
}

// ---------------------------------------------------------------- matchmaking
// Serverless quick match on top of the public PeerJS broker.
// A waiting room publishes a "beacon" under a well-known id (one per slot and
// table size). Searchers walk the slots: a beacon answers with its room code
// (join it) or "full" (try the next slot); an empty slot is claimed, and the
// searcher becomes the next room's host. Only one peer can hold an id, so two
// people racing for the same empty slot sort themselves out.

const MM_PREFIX = 'colorcard-mm-v1-';
const MM_SLOTS = 12;
export const mmSlotId = (np, i) => `${MM_PREFIX}${np}p-${i}`;

function askBeacon(probe, id, ms = 6000) {
  return new Promise((resolve) => {
    let done = false;
    let conn = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.off?.('error', onErr);
      try { conn?.close(); } catch { /* ignore */ }
      resolve(v);
    };
    const onErr = (e) => finish(e?.type === 'peer-unavailable' ? 'none' : 'error');
    probe.on('error', onErr);
    const timer = setTimeout(() => finish('full'), ms); // a beacon that never answers counts as busy
    try {
      conn = probe.connect(id, { reliable: true });
      conn.on('data', (m) => finish(m && m.t === 'room' && typeof m.code === 'string' ? { code: m.code } : 'full'));
      conn.on('error', () => {});
    } catch { finish('error'); }
  });
}

function claimSlot(id) {
  return new Promise((resolve) => {
    let settled = false;
    const peer = new window.Peer(id, { debug: 0 });
    // searchers can knock before our room is ready: hold them until the host answers
    peer.mmQueue = [];
    peer.on('connection', (conn) => { if (peer.mmQueue) peer.mmQueue.push(conn); });
    const t = setTimeout(() => { if (!settled) { settled = true; peer.destroy(); resolve(null); } }, 8000);
    peer.on('open', () => { if (!settled) { settled = true; clearTimeout(t); resolve(peer); } });
    peer.on('error', () => { if (!settled) { settled = true; clearTimeout(t); peer.destroy(); resolve(null); } });
  });
}

// Resolves { join: code } or { host: beaconPeer }, or null if cancelled.
export async function findMatch(np, { onStatus, cancelled = () => false } = {}) {
  await loadPeer();
  const probe = new window.Peer({ debug: 0 });
  await new Promise((res, rej) => {
    probe.on('open', () => res());
    probe.on('error', (e) => { if (!probe.open) rej(new Error(friendlyError(e))); });
  });
  try {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < MM_SLOTS; i++) {
        if (cancelled()) return null;
        onStatus?.(i, pass);
        const id = mmSlotId(np, i);
        let r = await askBeacon(probe, id);
        if (cancelled()) return null;
        if (r === 'error') { await new Promise((z) => setTimeout(z, 800)); r = await askBeacon(probe, id); }
        if (r?.code) return { join: r.code };
        if (r === 'none') {
          const beacon = await claimSlot(id);
          if (cancelled()) { beacon?.destroy(); return null; }
          if (beacon) return { host: beacon, slot: i };
          r = await askBeacon(probe, id); // someone beat us to it: join them instead
          if (r?.code) return { join: r.code };
        }
      }
    }
    throw new Error('All quick-match tables are busy. Try again in a moment.');
  } finally {
    probe.destroy();
  }
}

// Self-healing: a host waiting alone at slot `slot` looks for an open table at a
// lower slot (merges only ever go downwards, so two hosts never swap places).
export async function findLowerTable(np, slot) {
  if (slot <= 0) return null;
  await loadPeer();
  const probe = new window.Peer({ debug: 0 });
  try {
    await new Promise((res, rej) => {
      probe.on('open', () => res());
      probe.on('error', (e) => { if (!probe.open) rej(e); });
      setTimeout(() => rej(new Error('timeout')), 10000);
    });
    for (let i = 0; i < slot; i++) {
      const r = await askBeacon(probe, mmSlotId(np, i));
      if (r?.code) return r.code;
    }
    return null;
  } catch {
    return null;
  } finally {
    probe.destroy();
  }
}
