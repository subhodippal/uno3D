// Nearby play: phones on the same Wi-Fi or phone hotspot, NO internet needed.
//
// WebRTC connects the phones directly over the local network. Normally a signalling server
// passes the two connection "invitations" (SDP offer and answer) between the phones; here they
// travel by QR code instead (or copy & paste): the host shows a code, the friend scans it and
// shows a reply code, the host scans that. One exchange per friend.
//
// LanHost / LanClient have the same shape as HostNet / ClientNet in net.js, so the game code
// (lobby, turns, state) is shared.

const RTC = { iceServers: [] }; // local network only: no STUN / TURN servers needed (or reachable)
const TAG = 'CC1';
const PING_MS = 4000;
const HOST_SILENCE_MS = 25000;
const GUEST_SILENCE_MS = 20000;

// ---------------------------------------------------------------- invitation codes
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// keep only what a data-channel connection needs, to make the QR code small
function slimSdp(sdp) {
  return sdp.split(/\r?\n/).filter((l) => l && !/^a=(extmap|rtcp|ssrc|msid|group:LS|ice-options)/.test(l)).join('\r\n') + '\r\n';
}

async function pack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return `${TAG}z${b64u(z)}`;
  }
  return `${TAG}j${b64u(raw)}`;
}
export async function unpack(code) {
  const s = String(code || '').trim().replace(/\s+/g, '');
  if (!s.startsWith(TAG)) throw new Error('That is not a game code.');
  const kind = s[TAG.length];
  let bytes = unb64u(s.slice(TAG.length + 1));
  if (kind === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}

function gathered(pc, ms = 4000) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') { res(); return; }
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}

const newId = () => 'lan-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- host
export class LanHost {
  constructor() { this.conns = new Map(); this.seen = new Map(); this.pcs = new Map(); this.handlers = {}; this.code = 'NEARBY'; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  start() {
    this._beat = setInterval(() => this._heartbeat(), PING_MS);
    return this.code;
  }

  // a new invitation for one friend: returns its code, and accept(replyCode) to finish
  async invite() {
    const id = newId();
    const pc = new RTCPeerConnection(RTC);
    const dc = pc.createDataChannel('game', { ordered: true });
    this.pcs.set(id, pc);
    const opened = new Promise((res, rej) => {
      dc.onopen = () => {
        this.conns.set(id, dc);
        this.seen.set(id, Date.now());
        res();
      };
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') rej(new Error('Could not connect. Are both phones on the same Wi-Fi or hotspot?')); });
    });
    dc.onmessage = (e) => {
      this.seen.set(id, Date.now());
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && msg.t === 'pong') return;
      this._emit('message', id, msg);
    };
    dc.onclose = () => this._drop(id);
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) this._drop(id); });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const code = await pack({ t: 'o', s: slimSdp(pc.localDescription.sdp) });
    return {
      id,
      code,
      accept: async (reply) => {
        const m = await unpack(reply);
        if (m.t !== 'a' || !m.s) throw new Error('That is not a reply code. Scan the code on your friend\'s screen.');
        await pc.setRemoteDescription({ type: 'answer', sdp: m.s });
        await Promise.race([opened, new Promise((_, rej) => setTimeout(() => rej(new Error('Could not connect. Are both phones on the same Wi-Fi or hotspot?')), 20000))]);
      },
      cancel: () => { if (!this.conns.has(id)) { try { pc.close(); } catch { /* ignore */ } this.pcs.delete(id); } },
    };
  }

  _heartbeat() {
    const now = Date.now();
    for (const [id, dc] of this.conns) {
      if (now - (this.seen.get(id) || now) > HOST_SILENCE_MS) { this._drop(id); continue; }
      if (dc.readyState === 'open') try { dc.send('{"t":"ping"}'); } catch { /* ignore */ }
    }
  }

  _drop(id) {
    const had = this.conns.has(id);
    this.conns.delete(id);
    this.seen.delete(id);
    const pc = this.pcs.get(id);
    this.pcs.delete(id);
    try { pc?.close(); } catch { /* ignore */ }
    if (had) this._emit('leave', id);
  }

  send(id, msg) { const dc = this.conns.get(id); if (dc?.readyState === 'open') try { dc.send(JSON.stringify(msg)); } catch { /* ignore */ } }
  broadcast(msg) { const s = JSON.stringify(msg); for (const dc of this.conns.values()) if (dc.readyState === 'open') try { dc.send(s); } catch { /* ignore */ } }
  kick(id) { this.conns.delete(id); this.seen.delete(id); const pc = this.pcs.get(id); this.pcs.delete(id); try { pc?.close(); } catch { /* ignore */ } }
  close() { clearInterval(this._beat); for (const pc of this.pcs.values()) try { pc.close(); } catch { /* ignore */ } this.pcs.clear(); this.conns.clear(); }
}

// ---------------------------------------------------------------- guest
export class LanClient {
  constructor() { this.handlers = {}; this.closed = false; this.code = 'NEARBY'; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  // takes the host's code, returns the reply code to show the host; then await this.connected
  async answer(hostCode) {
    const m = await unpack(hostCode);
    if (m.t !== 'o' || !m.s) throw new Error('That is a reply code. Scan the code on the host\'s screen.');
    const pc = new RTCPeerConnection(RTC);
    this.pc = pc;
    this.connected = new Promise((res, rej) => {
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        this.dc = dc;
        dc.onopen = () => { this.seen = Date.now(); this._beat = setInterval(() => { if (Date.now() - this.seen > GUEST_SILENCE_MS) this._lost(); }, 2000); res(); };
        dc.onmessage = (ev) => {
          this.seen = Date.now();
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg && msg.t === 'ping') { this.send({ t: 'pong' }); return; }
          this._emit('message', msg);
        };
        dc.onclose = () => this._lost();
      };
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') { rej(new Error('Could not connect. Are both phones on the same Wi-Fi or hotspot?')); this._lost(); }
      });
    });
    this.connected.catch(() => {});
    await pc.setRemoteDescription({ type: 'offer', sdp: m.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return pack({ t: 'a', s: slimSdp(pc.localDescription.sdp) });
  }

  _lost() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._beat);
    try { this.pc?.close(); } catch { /* ignore */ }
    this._emit('close');
  }

  send(msg) { if (this.dc?.readyState === 'open') try { this.dc.send(JSON.stringify(msg)); } catch { /* ignore */ } }
  close() { this.closed = true; clearInterval(this._beat); try { this.pc?.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------- QR code: draw and scan
export function drawQR(canvas, text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const size = Math.min(canvas.width, canvas.height);
  const cell = Math.floor(size / (n + quiet * 2));
  const off = Math.floor((size - cell * n) / 2);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#111';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
}

let jsqrLoading = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

// Scans QR codes from the camera until one starting with our tag shows up.
// Returns { stop() , result: Promise<string> }
export function startScanner(video) {
  let stopped = false;
  let stream = null;
  const stop = () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  const result = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera access here. Use “Type the code” instead.');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (stopped) { stop(); return null; }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    let detector = null;
    try { if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
    if (!detector && !window.jsQR) { jsqrLoading ||= loadScript('./vendor/jsQR.min.js'); await jsqrLoading; }
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d', { willReadFrequently: true });
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 180));
      if (video.readyState < 2) continue;
      let text = null;
      if (detector) {
        try { const found = await detector.detect(video); text = found.find((f) => String(f.rawValue).startsWith(TAG))?.rawValue || null; } catch { /* keep trying */ }
      } else {
        const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
        cv.width = w; cv.height = h;
        g.drawImage(video, 0, 0, w, h);
        const qr = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (qr && qr.data.startsWith(TAG)) text = qr.data;
      }
      if (text) { stop(); return text; }
    }
    return null;
  })();
  result.catch(() => stop());
  return { stop, result };
}
