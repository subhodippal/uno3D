// Sound: procedural Web Audio effects and music, plus recorded male voice call-outs
// (audio/voice/*.mp3, made with the public-domain Piper "John" voice).

export const VOICE_CLIPS = {
  uno: 'Uno!', skip: 'Skipped!', reverse: 'Reverse!', colorcard: 'UNO!',
  red: 'Red!', green: 'Green!', yellow: 'Yellow!', blue: 'Blue!',
  pick2: 'Pick two!', pick4: 'Pick four!', draw: 'Draw card!', pass: 'Pass.',
  turn: 'Your turn!', youwin: 'You win!', winner: 'Winner!', forgot: 'Forgot! Draw two!',
  // UNO Flip
  flip: 'Flip!', pick1: 'Pick one!', pick5: 'Pick five!', skipall: 'Skip everyone!', until: 'Draw until',
  pink: 'Pink!', teal: 'Teal!', orange: 'Orange!', purple: 'Purple!',
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;   // sound effects
    this.voiceOn = true;   // spoken call-outs
    this.musicOn = true;   // background music
    this.vibrate = true;
    this._clips = {};
    this._voiceSrc = [];
    this._voiceEnd = 0;
    this.master = null;
    this._noise = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      // a short feedback delay gives everything a little synthwave space
      const delay = this.ctx.createDelay(0.5);
      delay.delayTime.value = 0.16;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.22;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.1;
      this.master.connect(comp);
      this.master.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // voice and music skip the echo and the effects switch
      this.voiceGain = this.ctx.createGain();
      this.voiceGain.gain.value = 1.0;
      this.voiceGain.connect(comp);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(comp);
      this._loadClips();
      document.addEventListener('visibilitychange', () => this._syncMusic());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().then(() => this._syncMusic());
    this._syncMusic();
  }

  // ---------------------------------------------------------------- voice
  _loadClips() {
    for (const k of Object.keys(VOICE_CLIPS)) {
      if (this._clips[k]) continue;
      this._clips[k] = fetch(`./audio/voice/${k}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((b) => new Promise((res, rej) => this.ctx.decodeAudioData(b, res, rej)))
        .then((buf) => { this._clips[k] = buf; return buf; })
        .catch(() => { this._clips[k] = null; return null; });
    }
  }

  // Speak one or more clips back to back, e.g. voice('colorcard', 'red').
  // A new call-out cuts off the old one unless { queue: true }.
  async voice(keys, { queue = false } = {}) {
    if (!this.voiceOn) return;
    keys = [].concat(keys);
    if (!this.ctx) { this._speech(keys, queue); return; }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* ignore */ } }
    const bufs = await Promise.all(keys.map((k) => this._clips[k]));
    if (bufs.some((b) => !b || !(b instanceof AudioBuffer))) { this._speech(keys, queue); return; }
    const now = this.ctx.currentTime;
    if (!queue) { this._voiceSrc.forEach((src) => { try { src.stop(); } catch { /* ignore */ } }); this._voiceSrc = []; this._voiceEnd = 0; }
    let t = Math.max(now + 0.02, this._voiceEnd);
    // duck the music under the voice
    if (this.musicGain && this.musicOn) {
      const g = this.musicGain.gain;
      g.cancelScheduledValues(now); g.setTargetAtTime(0.25 * this._musicVol, now, 0.05);
    }
    for (const buf of bufs) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceGain);
      src.start(t);
      src.onended = () => { this._voiceSrc = this._voiceSrc.filter((x) => x !== src); if (!this._voiceSrc.length) this._syncMusic(); };
      this._voiceSrc.push(src);
      t += buf.duration + 0.03;
    }
    this._voiceEnd = t;
  }

  _speech(keys, queue) { this.say(keys.map((k) => VOICE_CLIPS[k] || k).join(' '), { queue }); }


  get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  buzz(pattern) {
    if (this.vibrate && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005, detune = 0 }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseHit({ dur = 0.06, vol = 0.3, freq = 2500, q = 1.2, delay = 0, type = 'bandpass' }) {
    if (!this.ok) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  // each player gets their own chord colour when placing a mark
  place(seat = 0) {
    const base = [523.25, 392, 659.25, 440][seat % 4];
    this._tone({ freq: base * 2, to: base, type: 'square', dur: 0.09, vol: 0.06 });
    this._tone({ freq: base, type: 'sawtooth', dur: 0.22, vol: 0.07, detune: 8, delay: 0.01 });
    this._tone({ freq: base * 1.5, type: 'triangle', dur: 0.28, vol: 0.08, delay: 0.02 });
    this._noiseHit({ dur: 0.05, vol: 0.12, freq: 5000, q: 0.8 });
    this.buzz(12);
  }

  hover() { this._tone({ freq: 1800, type: 'sine', dur: 0.03, vol: 0.025 }); }
  click() { this._tone({ freq: 1200, to: 800, type: 'square', dur: 0.04, vol: 0.05 }); }
  error() { this._tone({ freq: 200, to: 140, type: 'square', dur: 0.16, vol: 0.07 }); this.buzz([20, 40, 20]); }
  turn() { this._tone({ freq: 880, type: 'sine', dur: 0.1, vol: 0.06 }); this._tone({ freq: 1320, type: 'sine', dur: 0.12, vol: 0.05, delay: 0.07 }); }
  pop() { this._tone({ freq: 500, to: 1200, type: 'sine', dur: 0.12, vol: 0.12 }); }

  sweep() { // board clearing whoosh
    this._noiseHit({ dur: 0.45, vol: 0.12, freq: 900, q: 0.6, type: 'lowpass' });
    this._tone({ freq: 220, to: 880, type: 'sawtooth', dur: 0.4, vol: 0.05 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this._tone({ freq: f, type: 'sawtooth', dur: 0.35, vol: 0.08, delay: i * 0.1, detune: -7 });
      this._tone({ freq: f, type: 'square', dur: 0.3, vol: 0.05, delay: i * 0.1, detune: 7 });
    });
    this._tone({ freq: 1046.5, type: 'triangle', dur: 1.1, vol: 0.14, delay: 0.42 });
    this._tone({ freq: 1318.5, type: 'triangle', dur: 1.1, vol: 0.1, delay: 0.42 });
    this.buzz([40, 60, 40, 60, 120]);
  }

  lose() {
    [392, 349.23, 311.13, 261.63].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.32, vol: 0.07, delay: i * 0.16 }));
    this.buzz(80);
  }

  draw() {
    this._tone({ freq: 440, type: 'triangle', dur: 0.3, vol: 0.1 });
    this._tone({ freq: 415.3, type: 'triangle', dur: 0.45, vol: 0.1, delay: 0.22 });
  }

  zap() { // win line striking through
    this._tone({ freq: 200, to: 2400, type: 'sawtooth', dur: 0.35, vol: 0.07 });
    this._noiseHit({ dur: 0.3, vol: 0.12, freq: 3000, q: 0.7 });
  }

  firework(power = 1) {
    this._noiseHit({ dur: 0.25 + power * 0.2, vol: 0.14 * power, freq: 600, q: 0.5, type: 'lowpass' });
    for (let i = 0; i < 5; i++) this._noiseHit({ dur: 0.03, vol: 0.05, freq: 5000 + Math.random() * 3000, q: 2, delay: 0.15 + Math.random() * 0.4 });
  }

  // ---------------------------------------------------------------- cards
  flick(i = 0) { // a single card sliding off the deck
    this._noiseHit({ dur: 0.07, vol: 0.16, freq: 3200 + (i % 5) * 300, q: 0.9, delay: 0 });
    this._tone({ freq: 900 + (i % 4) * 90, to: 500, type: 'triangle', dur: 0.06, vol: 0.03 });
  }
  slap(color = 0) { // card landing on the pile
    const base = [523.25, 392, 659.25, 440][color % 4];
    this._noiseHit({ dur: 0.09, vol: 0.28, freq: 1400, q: 0.7, type: 'lowpass' });
    this._noiseHit({ dur: 0.04, vol: 0.14, freq: 5200, q: 1 });
    this._tone({ freq: base, type: 'triangle', dur: 0.2, vol: 0.07, delay: 0.01 });
    this._tone({ freq: base * 1.5, type: 'sine', dur: 0.25, vol: 0.05, delay: 0.03 });
    this.buzz(14);
  }
  shuffle() {
    for (let i = 0; i < 14; i++) this._noiseHit({ dur: 0.035, vol: 0.1, freq: 2500 + Math.random() * 2500, q: 1, delay: i * 0.035 });
  }
  skip() {
    this._tone({ freq: 700, to: 180, type: 'square', dur: 0.22, vol: 0.06 });
    this._tone({ freq: 350, to: 90, type: 'sawtooth', dur: 0.3, vol: 0.05, delay: 0.05 });
  }
  reverse() {
    this._tone({ freq: 300, to: 1200, type: 'sawtooth', dur: 0.2, vol: 0.05 });
    this._tone({ freq: 1200, to: 300, type: 'sawtooth', dur: 0.22, vol: 0.05, delay: 0.2 });
  }
  plus(n = 2) {
    for (let i = 0; i < n; i++) this._tone({ freq: 220 + i * 70, to: 110, type: 'square', dur: 0.12, vol: 0.07, delay: i * 0.08 });
    this._noiseHit({ dur: 0.35, vol: 0.16, freq: 400, q: 0.6, type: 'lowpass' });
    this.buzz([30, 30, 30]);
  }
  wild() {
    [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.25, vol: 0.06, delay: i * 0.045 }));
  }
  // spoken call-out using the device's built-in voice (no audio files, works offline on most devices)
  // Prefers a male English voice; devices name them differently, so match the common ones.
  // fallback when the recorded clips can't be loaded
  say(text, { rate = 1.0, pitch = 0.85, volume = 1, queue = false } = {}) {
    if (!this.voiceOn || !('speechSynthesis' in window)) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate; u.pitch = pitch; u.volume = volume;
      const voices = window.speechSynthesis.getVoices();
      const en = voices.filter((v) => /^en/i.test(v.lang));
      const male = /\bmale\b|daniel|david|mark|guy|alex|fred|tom|aaron|arthur|george|james|ryan|oliver|rishi|gordon|lee|x-iom|x-iol|x-tpd|x-gbd|x-rjs|x-end/i;
      const female = /female|samantha|zira|susan|karen|moira|tessa|victoria|fiona|serena|hazel|aria|jenny|libby|sonia/i;
      u.voice = en.find((v) => male.test(v.name) && !female.test(v.name))
        || en.find((v) => !female.test(v.name))
        || en[0] || null;
      // no male voice on this device: a deeper pitch still sounds closer to one
      if (u.voice && female.test(u.voice.name)) u.pitch = 0.6;
      // a new call-out replaces the old one; queued ones wait their turn
      if (!queue) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- music
  // A light, looping tune (marimba arpeggios over a soft bass) scheduled ahead in Web Audio.
  get _musicVol() { return 0.5; }
  setMusic(on) { this.musicOn = on; this._syncMusic(); }
  _syncMusic() {
    if (!this.ctx) return;
    const play = this.musicOn && this.ctx.state === 'running' && !document.hidden;
    const g = this.musicGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(play ? (this._voiceSrc.length ? 0.25 : 1) * this._musicVol : 0, now, play ? 0.4 : 0.1);
    if (play && !this._musicTimer) {
      this._beat = 0;
      this._next = now + 0.1;
      this._musicTimer = setInterval(() => this._schedule(), 120);
    } else if (!play && this._musicTimer) {
      clearInterval(this._musicTimer); this._musicTimer = null;
    }
  }
  _note(midi, t, dur, vol, type) {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _schedule() {
    const step = 60 / 112 / 2; // eighth notes at 112 bpm
    // C - Am - F - G, two bars each
    const chords = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
    const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
    const melody = [76, null, 79, 77, 76, null, 74, null, 72, null, 74, 76, 77, null, 76, null,
      77, null, 76, 74, 72, null, 69, null, 74, null, 76, 74, 71, null, null, null];
    while (this._next < this.ctx.currentTime + 0.4) {
      const b = this._beat;
      const bar = Math.floor(b / 8) % 8;
      const ch = chords[Math.floor(bar / 2) % 4];
      const t = this._next;
      this._note(ch[pattern[b % 8]] + 12, t, 0.28, 0.05, 'triangle');            // marimba-ish arpeggio
      if (b % 4 === 0) this._note(ch[0] - 24, t, 0.5, 0.09, 'sine');              // bass
      if (b % 8 === 6) this._note(ch[2] - 24, t, 0.3, 0.06, 'sine');
      const m = melody[b % 32];
      if (bar >= 4 && m) this._note(m, t, 0.35, 0.035, 'square');                  // tune on the second half
      this._next += step;
      this._beat = (b + 1) % 64;
    }
  }

  call() { // "UNO!" (down to one card)
    this._tone({ freq: 880, type: 'square', dur: 0.12, vol: 0.06 });
    this._tone({ freq: 1318.5, type: 'square', dur: 0.2, vol: 0.06, delay: 0.1 });
    this._tone({ freq: 1760, type: 'triangle', dur: 0.4, vol: 0.08, delay: 0.2 });
    this.buzz([20, 40, 60]);
  }

  whoosh(power = 1) { // card thrown through the air
    if (!this.ok) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(600, t0);
    f.frequency.exponentialRampToValueAtTime(3200 * power, t0 + 0.18);
    f.frequency.exponentialRampToValueAtTime(900, t0 + 0.32);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22 * power, t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.1);
    src.stop(t0 + 0.36);
  }
  thwack(power = 1) { // card smacking down on the pile
    this._noiseHit({ dur: 0.07, vol: 0.32 * power, freq: 2200, q: 0.6 });
    this._noiseHit({ dur: 0.16, vol: 0.25 * power, freq: 300, q: 0.7, type: 'lowpass' });
    this._tone({ freq: 160, to: 60, type: 'sine', dur: 0.16, vol: 0.22 * power });
    this.buzz(18);
  }
  flip() { // turning a card over to look at it
    this._noiseHit({ dur: 0.05, vol: 0.18, freq: 4200, q: 1.2 });
    this._noiseHit({ dur: 0.05, vol: 0.12, freq: 2600, q: 1.2, delay: 0.05 });
    this._tone({ freq: 1568, type: 'triangle', dur: 0.18, vol: 0.06, delay: 0.06 });
  }
  peek() { this._tone({ freq: 660, to: 990, type: 'sine', dur: 0.12, vol: 0.08 }); this._noiseHit({ dur: 0.03, vol: 0.08, freq: 5000, q: 1 }); }
  unpeek() { this._tone({ freq: 990, to: 660, type: 'sine', dur: 0.1, vol: 0.05 }); }
  punch() { // heavy hit for action cards
    this._tone({ freq: 140, to: 40, type: 'sine', dur: 0.32, vol: 0.4 });
    this._tone({ freq: 90, to: 35, type: 'triangle', dur: 0.4, vol: 0.25, delay: 0.02 });
    this._noiseHit({ dur: 0.22, vol: 0.3, freq: 700, q: 0.5, type: 'lowpass' });
    this._noiseHit({ dur: 0.04, vol: 0.2, freq: 3000, q: 0.8 });
    this.buzz([40, 20, 30]);
  }
  boom() { // big firecracker
    this._tone({ freq: 110, to: 30, type: 'sine', dur: 0.6, vol: 0.4 });
    this._noiseHit({ dur: 0.7, vol: 0.32, freq: 500, q: 0.4, type: 'lowpass' });
    for (let i = 0; i < 9; i++) this._noiseHit({ dur: 0.025, vol: 0.12, freq: 3500 + Math.random() * 4000, q: 3, delay: 0.25 + Math.random() * 0.7 });
  }
  cheer() { // crowd-ish swell
    if (!this.ok) return;
    for (let k = 0; k < 3; k++) this._noiseHit({ dur: 1.4, vol: 0.06, freq: 900 + k * 500, q: 0.8, delay: k * 0.05 });
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.08, delay: 0.1 + i * 0.08 }));
  }
}

export const sfx = new Sfx();
