// three.js card game in a sunny meadow: grass, trees, flowers and sky.
// White classic cards with soft shadows, the viewer's hand held as a real fan,
// opponents' cards around the play area, flights, swipe / tap / long-press, celebrations.

import { view } from './view.js';
import * as THREE from '../vendor/three.module.min.js';
import { tween, ease, updateTweens, wait } from './anim.js';
import { Fx3D, softSprite } from './fx3d.js';
import { COLORS, SEATS, WILD, faceAt, faceKeyAt, parseFaceKey, paletteAt } from './rules.js';

const SKY_TOP = new THREE.Color(0x7cc8f2);
const SKY_LOW = new THREE.Color(0xeaf8c8);
const CW = 1, CH = 1.5;
const DECK_X = -0.9, PILE_X = 0.9;
const PILE_KEEP = 14, PILE_Y0 = 0.02, PILE_DY = 0.006; // cards kept on the discard pile, base height, step
const HAND_D = 6;
const FAN_S = 0.62;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const QI = new THREE.Quaternion();
const FONT = '"Fredoka", "Arial Rounded MT Bold", "Arial Black", system-ui, sans-serif';
const INK = '#1d1d1f';

// ---------------------------------------------------------------- card art
const TW = 256, TH = 384;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// white glyph with a dark outline and a soft drop shadow
function inkText(g, txt, x, y, size, fill = '#ffffff', weight = 700) {
  g.save();
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowOffsetX = size * 0.03; g.shadowOffsetY = size * 0.05; g.shadowBlur = size * 0.04;
  g.lineWidth = Math.max(4, size * 0.13); g.strokeStyle = INK;
  g.strokeText(txt, x, y);
  g.shadowColor = 'transparent';
  g.fillStyle = fill;
  g.fillText(txt, x, y);
  g.restore();
}
function inkPath(g, fn, w, fill = '#ffffff') {
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowOffsetY = w * 0.4;
  g.strokeStyle = INK; g.lineWidth = w * 1.9; fn(); g.stroke();
  g.shadowColor = 'transparent';
  g.strokeStyle = fill; g.lineWidth = w; fn(); g.stroke();
  g.restore();
}

function miniCard(g, x, y, w, h, rot, color) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  rr(g, -w / 2, -h / 2, w, h, w * 0.16);
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  rr(g, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, w * 0.1);
  g.fillStyle = color; g.fill();
  g.restore();
}

function pie(g, cx, cy, r, pal = COLORS) {
  const cols = [pal[0].css, pal[3].css, pal[1].css, pal[2].css];
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.moveTo(cx, cy);
    g.arc(cx, cy, r, -Math.PI / 2 + i * Math.PI / 2, i * Math.PI / 2);
    g.closePath();
    g.fillStyle = cols[i]; g.fill();
  }
  g.lineWidth = 6; g.strokeStyle = '#ffffff';
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
}

function symbol(g, v, cx, cy, s, color, pal = COLORS) {
  if (typeof v === 'number') {
    inkText(g, String(v), cx, cy + s * 0.04, s * 1.05);
    if (v === 6 || v === 9) inkPath(g, () => { g.beginPath(); g.moveTo(cx - s * 0.18, cy + s * 0.5); g.lineTo(cx + s * 0.18, cy + s * 0.5); }, s * 0.06);
  } else if (v === 'skip') {
    const r = s * 0.34;
    inkPath(g, () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); }, s * 0.1);
    inkPath(g, () => { g.beginPath(); g.moveTo(cx - r * 0.7, cy + r * 0.7); g.lineTo(cx + r * 0.7, cy - r * 0.7); }, s * 0.1);
  } else if (v === 'rev') {
    const r = s * 0.3;
    for (const k of [0, 1]) {
      const a0 = k ? Math.PI * 1.08 : 0.08, a1 = a0 + Math.PI * 0.74;
      const ex = cx + Math.cos(a1) * r, ey = cy + Math.sin(a1) * r;
      const tx = -Math.sin(a1), ty = Math.cos(a1);
      inkPath(g, () => {
        g.beginPath(); g.arc(cx, cy, r, a0, a1);
        g.moveTo(ex - tx * s * 0.14 + ty * s * 0.14, ey - ty * s * 0.14 - tx * s * 0.14);
        g.lineTo(ex + tx * s * 0.03, ey + ty * s * 0.03);
        g.lineTo(ex - tx * s * 0.14 - ty * s * 0.14, ey - ty * s * 0.14 + tx * s * 0.14);
      }, s * 0.085);
    }
  } else if (v === 'd2') {
    miniCard(g, cx - s * 0.12, cy + s * 0.02, s * 0.36, s * 0.52, -0.22, color);
    miniCard(g, cx + s * 0.12, cy - s * 0.04, s * 0.36, s * 0.52, 0.16, color);
    inkText(g, '+2', cx, cy + s * 0.36, s * 0.42);
  } else if (v === 'd1' || v === 'd5') {
    const n = v === 'd1' ? 1 : 5;
    const k = Math.min(n, 3);
    for (let i = 0; i < k; i++) miniCard(g, cx + (i - (k - 1) / 2) * s * 0.2, cy - s * 0.02 + Math.abs(i - (k - 1) / 2) * s * 0.04, s * 0.34, s * 0.5, (i - (k - 1) / 2) * 0.2, color);
    inkText(g, `+${n}`, cx, cy + s * 0.36, s * 0.42);
  } else if (v === 'skipall') {
    const r = s * 0.26;
    for (const dx of [-0.17, 0.17]) {
      const x = cx + dx * s;
      inkPath(g, () => { g.beginPath(); g.arc(x, cy, r, 0, Math.PI * 2); }, s * 0.08);
      inkPath(g, () => { g.beginPath(); g.moveTo(x - r * 0.7, cy + r * 0.7); g.lineTo(x + r * 0.7, cy - r * 0.7); }, s * 0.08);
    }
  } else if (v === 'flip') {
    // two half cards turning over
    const r = s * 0.3;
    inkPath(g, () => { g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.95, Math.PI * 1.9); }, s * 0.085);
    inkPath(g, () => { g.beginPath(); g.arc(cx, cy, r, -0.05, Math.PI * 0.9); }, s * 0.085);
    const tip = (a, dir) => {
      const ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
      const tx = -Math.sin(a) * dir, ty = Math.cos(a) * dir;
      inkPath(g, () => {
        g.beginPath();
        g.moveTo(ex - tx * s * 0.13 + ty * s * 0.13, ey - ty * s * 0.13 - tx * s * 0.13);
        g.lineTo(ex + tx * s * 0.03, ey + ty * s * 0.03);
        g.lineTo(ex - tx * s * 0.13 - ty * s * 0.13, ey - ty * s * 0.13 + tx * s * 0.13);
      }, s * 0.085);
    };
    tip(Math.PI * 1.9, 1); tip(Math.PI * 0.9, 1);
    inkText(g, 'FLIP', cx, cy + s * 0.02, s * 0.24);
  } else if (v === 'wild') {
    pie(g, cx, cy, s * 0.42, pal);
  } else if (v === 'w4' || v === 'w2') {
    pal.forEach((c, i) => miniCard(g, cx + (i - 1.5) * s * 0.17, cy - s * 0.06 + Math.abs(i - 1.5) * s * 0.04, s * 0.3, s * 0.44, (i - 1.5) * 0.18, c.css));
    inkText(g, v === 'w4' ? '+4' : '+2', cx, cy + s * 0.36, s * 0.42);
  } else if (v === 'wdc') {
    pie(g, cx, cy - s * 0.06, s * 0.3, pal);
    inkText(g, '+?', cx, cy + s * 0.36, s * 0.42);
  }
}

const cornerText = (v) => (typeof v === 'number' ? String(v) : { skip: '⊘', rev: '⇄', d2: '+2', wild: 'W', w4: '+4', d1: '+1', w2: '+2', d5: '+5', flip: '⟲', skipall: '⊘⊘', wdc: '+?' }[v]);

function cardShell(g, panel, dark = false) {
  g.clearRect(0, 0, TW, TH);
  rr(g, 3, 3, TW - 6, TH - 6, 26);
  g.fillStyle = dark ? '#1c1730' : '#ffffff'; g.fill();
  g.lineWidth = 3; g.strokeStyle = dark ? '#3a3158' : '#cfd3d6'; g.stroke();
  rr(g, 16, 16, TW - 32, TH - 32, 18);
  g.fillStyle = panel; g.fill();
  g.save();
  rr(g, 16, 16, TW - 32, TH - 32, 18);
  g.clip();
  const sh = g.createLinearGradient(0, 0, TW, TH);
  sh.addColorStop(0, 'rgba(255,255,255,.35)');
  sh.addColorStop(0.45, 'rgba(255,255,255,.06)');
  sh.addColorStop(0.46, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(0,0,0,.12)');
  g.fillStyle = sh; g.fillRect(0, 0, TW, TH);
  g.restore();
}

const texCache = new Map();
let maxAniso = 4;
function makeTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// key: 'C:c:v' classic, 'L:c:v' flip light side, 'D:c:v' flip dark side
function faceTexture(key) {
  if (texCache.has(key)) return texCache.get(key);
  const { c, v, dark } = parseFaceKey(key);
  const pal = paletteAt(dark ? 1 : 0);
  const color = c === WILD ? (dark ? '#0d0b17' : '#2b2b2e') : pal[c].css;
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d');
  cardShell(g, color, dark);
  if (c !== WILD) {
    // centre medallion: a white rounded diamond
    g.save();
    g.translate(TW / 2, TH / 2);
    g.rotate(Math.PI / 4);
    rr(g, -78, -78, 156, 156, 34);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke();
    g.restore();
  }
  symbol(g, v, TW / 2, TH / 2, 150, color, pal);
  const ct = cornerText(v);
  inkText(g, ct, 46, 52, 44);
  g.save(); g.translate(TW - 46, TH - 52); g.rotate(Math.PI); inkText(g, ct, 0, 0, 44); g.restore();
  if (c === WILD) {
    pal.forEach((col, i) => { g.fillStyle = col.css; g.beginPath(); g.arc(TW - 58 + (i % 2) * 18, 42 + (i >> 1) * 18, 7, 0, Math.PI * 2); g.fill(); });
    pal.forEach((col, i) => { g.fillStyle = col.css; g.beginPath(); g.arc(40 + (i % 2) * 18, TH - 60 + (i >> 1) * 18, 7, 0, Math.PI * 2); g.fill(); });
  }
  if (dark) { // a thin glowing rim marks the dark side
    rr(g, 9, 9, TW - 18, TH - 18, 22);
    g.lineWidth = 3; g.strokeStyle = 'rgba(190,150,255,.7)'; g.stroke();
  }
  const t = makeTex(cv);
  texCache.set(key, t);
  return t;
}

function backTexture() {
  if (texCache.has('back')) return texCache.get('back');
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d');
  cardShell(g, '#1f3c88');
  g.save();
  rr(g, 16, 16, TW - 32, TH - 32, 18);
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 3;
  for (let i = -TH; i < TW + TH; i += 22) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i - TH, TH); g.stroke();
    g.beginPath(); g.moveTo(i - TH, 0); g.lineTo(i, TH); g.stroke();
  }
  g.restore();
  g.save();
  g.translate(TW / 2, TH / 2);
  g.rotate(-0.38);
  rr(g, -96, -56, 192, 112, 30);
  g.fillStyle = '#e53935'; g.fill();
  g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke();
  inkText(g, 'COLOR', 0, -18, 44, '#ffd54a');
  inkText(g, 'CARD', 0, 26, 46, '#ffd54a');
  g.restore();
  const t = makeTex(cv);
  texCache.set('back', t);
  return t;
}

function edgeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 64;
  const g = cv.getContext('2d');
  for (let i = 0; i < 64; i += 4) { g.fillStyle = '#ffffff'; g.fillRect(0, i, 8, 3); g.fillStyle = '#c9ccd2'; g.fillRect(0, i + 3, 8, 1); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grassTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#9ad457';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 70;
    const light = Math.random() < 0.5;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, light ? 'rgba(214,245,140,.4)' : 'rgba(110,170,60,.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const l = 3 + Math.random() * 6;
    g.strokeStyle = `hsla(${78 + Math.random() * 30},55%,${38 + Math.random() * 28}%,.5)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - l); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 26);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cardGeo = new THREE.PlaneGeometry(CW, CH);
let backMat = null;

function flatQuat(yaw, faceUp = true) {
  const qy = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
  const qx = new THREE.Quaternion().setFromAxisAngle(X, faceUp ? -Math.PI / 2 : Math.PI / 2);
  return qy.multiply(qx);
}
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- arena
export class Arena {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(SKY_LOW, 1);
    renderer.shadowMap.enabled = quality === 'high';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = SKY_LOW.clone();
    scene.fog = new THREE.Fog(SKY_LOW.clone(), 26, 70);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    scene.add(this.camera);
    this.hand = new THREE.Group();
    this.camera.add(this.hand);
    this.camBase = new THREE.Vector3();
    this.shakeAmt = 0;

    this.fx = new Fx3D(scene, { floorY: 0.02, confettiColors: COLORS.map((p) => p.hex).concat([0xffffff, 0xff8fd1]) });
    this.ready = (document.fonts?.load ? Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`600 40px ${FONT}`)]) : Promise.resolve())
      .catch(() => {}).then(() => {
        backMat = new THREE.MeshBasicMaterial({ map: backTexture(), alphaTest: 0.5 });
        this._buildWorld();
      });

    this.np = 0;
    this.viewer = -1;
    this.handMode = false;
    this.hideHand = false;
    this.myCards = new Map();
    this.order = [];
    this.fans = [];
    this.pile = [];
    this.deckCount = 0;
    this.playable = new Set();
    this.hover = -1;
    this.peekId = -1;
    this.drag = null;
    this.color = -1;
    this.dir = 1;
    this.mode = 'classic';  // or 'flip'
    this.side = 0;          // flip mode: 0 light, 1 dark
    this.turnSeat = null;
    this.interactive = false;
    this.handBottomPx = 0;
    this.onCard = null;
    this.onDeck = null;
    this.onPile = null;
    this.onPeek = null;
    this.onLayout = null;
    this.onReject = null;
    this.demo = false;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._initPointer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this._clock = performance.now();
    this._loop = this._loop.bind(this);
    renderer.setAnimationLoop(this._loop);
  }

  // ---------------------------------------------------------------- world
  _buildWorld() {
    const { scene } = this;

    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: SKY_TOP.clone() }, uLow: { value: SKY_LOW.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uLow; varying vec3 vP;
        void main(){ float h = clamp(normalize(vP).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(uLow, uTop, h), 1.0);
        #include <colorspace_fragment>
        }`,
    }));
    scene.add(sky);
    this.skyU = sky.material.uniforms;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7aa64a, 1.35);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.55);
    sun.position.set(5, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    scene.add(sun);
    this.sun = sun;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0 }));
    ground.receiveShadow = true;
    scene.add(ground);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: softSprite(), color: 0xf6ffd6, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    patch.scale.set(13, 1, 10);
    patch.position.y = 0.004;
    scene.add(patch);

    this._trees();
    this._grass();
    this._clouds();

    // direction circle: white energy ring with lightning streaks racing the way play goes
    this._buildRing();

    this.glowMat = new THREE.MeshBasicMaterial({ map: softSprite(), color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.glowMat);
    glow.scale.set(2.6, 1, 3.2);
    glow.position.set(PILE_X, 0.008, 0);
    scene.add(glow);

    const sideMat = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.7 });
    const topMat = new THREE.MeshBasicMaterial({ map: backTexture() });
    this.deckTopMat = topMat;
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(CW * 0.98, 1, CH * 0.98), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    this.deck.castShadow = true;
    this.deck.position.set(DECK_X, 0.05, 0);
    scene.add(this.deck);
    this.deckGlowMat = new THREE.MeshBasicMaterial({ map: softSprite(), color: 0xfff59d, transparent: true, opacity: 0, depthWrite: false });
    const dg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.deckGlowMat);
    dg.scale.set(2.4, 1, 3);
    dg.position.set(DECK_X, 0.01, 0);
    scene.add(dg);

    this.pads = SEATS.map((s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: softSprite(), color: s.hex, transparent: true, opacity: 0, depthWrite: false,
      }));
      m.scale.set(3.4, 1, 2.2);
      m.position.y = 0.006;
      m.visible = false;
      scene.add(m);
      return m;
    });
    this.built = true;
    this.setDeckCount(this.deckCount);
  }

  _buildRing() {
    const RX = 2.45, RZ = 2.0;
    // flat elliptical band; uv.x runs round the ring (0..1), uv.y across it
    const band = (w) => {
      const seg = 220, pos = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(c * (RX - w / 2), 0, s * (RZ - w / 2), c * (RX + w / 2), 0, s * (RZ + w / 2));
        uv.push(i / seg, 0, i / seg, 1);
        if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    };
    this.ring = new THREE.Group();
    this.ring.position.y = 0.012;

    // soft halo in the current colour
    this.ringGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(band(1.0), this.ringGlowMat);
    halo.renderOrder = 1;
    this.ring.add(halo);

    // the energy ring: always-white band + lightning streaks racing round in the current colour
    this.ringU = {
      uTime: { value: 0 }, uPhase: { value: 0 }, uDir: { value: 1 },
      uColor: { value: new THREE.Color(0xffffff) }, uFlash: { value: 0 },
    };
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: this.ringU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime, uPhase, uDir, uFlash; uniform vec3 uColor; varying vec2 vUv;
        float hash(float n){ return fract(sin(n) * 43758.5453); }
        float noise(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
        void main(){
          float u = vUv.x, v = vUv.y;
          float d = abs(v - 0.5) * 2.0;                       // 0 centre .. 1 edge
          float base = smoothstep(0.62, 0.42, d);             // solid white band
          float edge = smoothstep(0.62, 0.5, d) - smoothstep(0.5, 0.36, d);
          // four comets chasing round in the play direction
          float p = fract(u * 4.0 - uPhase);
          float tail = uDir > 0.0 ? p : 1.0 - p;
          float comet = pow(tail, 5.0);
          // flickering lightning bolt along the ring
          float st = floor(uTime * 16.0);
          float j = (noise(u * 110.0 + st * 7.3) - 0.5) * 0.9 + (noise(u * 31.0 - st * 3.1) - 0.5) * 0.6;
          float line = smoothstep(0.13, 0.0, abs(v - 0.5 - j * 0.42));
          float spark = 0.65 + 0.35 * hash(st + floor(u * 60.0));
          float bolt = line * spark * (0.3 + 0.9 * comet);
          float glow = comet * smoothstep(1.0, 0.1, d);
          vec3 white = vec3(1.0);
          vec3 col = mix(white, uColor, clamp(glow * 1.3 + bolt * 0.9 + edge * 0.6, 0.0, 1.0));
          col = mix(col, white, line * comet * 0.35);         // hot white core at the comet heads
          col = mix(col, white, uFlash * 0.7);
          float a = clamp(base * 0.88 + glow * 0.95 + bolt + uFlash * 0.5 * smoothstep(1.0, 0.0, d), 0.0, 1.0);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    const core = new THREE.Mesh(band(0.62), this.ringMat);
    core.renderOrder = 3;
    this.ring.add(core);

    this.ringRX = RX; this.ringRZ = RZ;
    this.scene.add(this.ring);
    this.chevAngle = 0;
    this.dirScale = 1;
    this.ringPulse = 0;
    this.ringFlash = 0;
  }

  _ringColor(hex, animate) {
    const col = new THREE.Color(hex);
    const from = this.ringU.uColor.value.clone();
    const fromG = this.ringGlowMat.color.clone();
    const apply = (k) => {
      this.ringU.uColor.value.copy(from).lerp(col, k);
      this.ringGlowMat.color.copy(fromG).lerp(col, k);
    };
    if (animate) tween(0.45, apply); else apply(1);
  }

  // Reverse: white flash, the ring punches out, the lightning whips round the other way and sparks fly off it
  _flipFx() {
    this.ringPulse = 1;
    this.ringFlash = 1;
    this.dirScale = 10;
    const hex = this.ringU.uColor.value.getHex();
    this.fx.shockwave(new THREE.Vector3(0, 0.05, 0), 0xffffff, 3.2);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const pos = new THREE.Vector3(Math.cos(a) * this.ringRX, 0.08, Math.sin(a) * this.ringRZ);
      setTimeout(() => this.fx.burst(pos, i % 2 ? hex : 0xffffff, 8, false, { speed: 0.5, up: 0.5, size: 0.1 }), i * 25);
    }
  }

  _trees() {
    const spots = [];
    const tryAdd = (x, z) => {
      if (z > 5 && Math.abs(x) < 16) return;        // keep the view to the cards clear
      if (Math.hypot(x * 0.8, z * 1.2) < 9.6) return; // and the play area
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 2.4)) return;
      spots.push({ x, z, s: z < -7 ? rand(1.2, 1.9) : rand(0.8, 1.5) });
    };
    for (let row = 0; row < 3; row++) {
      for (let x = -22 + row * 1.3; x < 22; x += rand(2.3, 3.2)) tryAdd(x, -8.6 - row * 3.2 + rand(-0.8, 0.8));
    }
    for (let i = 0; i < 400 && spots.length < 110; i++) {
      const a = rand(0, Math.PI * 2), r = rand(10, 34);
      tryAdd(Math.cos(a) * r, Math.sin(a) * r - 6);
    }
    const n = spots.length;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1.8, 7).translate(0, 0.9, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.9 }), n);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leafMat, n * 3);
    const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.2, 8), leafMat, n * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const greens = [0x4caf50, 0x66bb3a, 0x7cc242, 0x3e9b47, 0x8bc34a, 0x5aa83c];
    let li = 0, pi = 0;
    spots.forEach((t, i) => {
      const s = t.s;
      m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(Y, rand(0, 6)), sc.set(s, s * rand(0.9, 1.3), s));
      trunks.setMatrixAt(i, m);
      const col = new THREE.Color(greens[i % greens.length]).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.05, 0.05));
      if (i % 4 === 3) {
        for (let k = 0; k < 2; k++) {
          m.compose(p.set(t.x, s * (2.1 + k * 1.1), t.z), q.identity(), sc.set(s * (1.25 - k * 0.35), s * (1.1 - k * 0.2), s * (1.25 - k * 0.35)));
          pines.setMatrixAt(pi, m); pines.setColorAt(pi++, col.clone().offsetHSL(0, 0, -0.06));
        }
      } else {
        const blobs = [[0, 2.5, 0, 1.35], [rand(-0.7, -0.4), 2.1, rand(-0.3, 0.3), 0.95], [rand(0.4, 0.7), 2.2, rand(-0.3, 0.3), 1.0]];
        blobs.forEach(([bx, by, bz, bs]) => {
          m.compose(p.set(t.x + bx * s, by * s, t.z + bz * s), q.setFromAxisAngle(Y, rand(0, 6)), sc.setScalar(bs * s));
          leaves.setMatrixAt(li, m); leaves.setColorAt(li++, col.clone().offsetHSL(0, 0, rand(-0.04, 0.05)));
        });
      }
    });
    leaves.count = li;
    pines.count = pi;
    [trunks, leaves, pines].forEach((im) => { im.castShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.scene.add(im); });

    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), 40);
    let b = 0;
    for (let i = 0; i < 300 && b < 40; i++) {
      const a = rand(0, Math.PI * 2), r = rand(8, 18);
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 3;
      if (z > 4 && Math.abs(x) < 12) continue;
      if (Math.hypot(x, z * 1.2) < 8) continue;
      m.compose(p.set(x, 0.25, z), q.identity(), sc.set(rand(0.8, 1.6), rand(0.6, 1), rand(0.8, 1.6)));
      bushes.setMatrixAt(b, m);
      bushes.setColorAt(b, new THREE.Color(greens[b % greens.length]).offsetHSL(0, 0.05, 0.03));
      b++;
    }
    bushes.count = b;
    bushes.castShadow = true;
    this.scene.add(bushes);
  }

  _grass() {
    const blade = new THREE.BufferGeometry();
    const v = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + 0.3, c = Math.cos(a) * 0.05, s = Math.sin(a) * 0.05;
      const tx = Math.cos(a + 1.2) * 0.08, tz = Math.sin(a + 1.2) * 0.08;
      v.push(-c, 0, -s, c, 0, s, tx, 0.38, tz);
    }
    blade.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    blade.computeVertexNormals();
    const N = 1600;
    const tufts = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 1 }), N);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 220);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const fc = [0xffffff, 0xfff176, 0xf48fb1, 0xffb74d, 0xce93d8];
    let t = 0, f = 0;
    for (let i = 0; i < N * 3 && t < N; i++) {
      const x = rand(-22, 22), z = rand(-26, 14);
      if (Math.abs(x) < 6.2 && Math.abs(z) < 4.6) continue;
      m.compose(p.set(x, 0, z), q.setFromAxisAngle(Y, rand(0, 6)), sc.setScalar(rand(0.7, 1.5)));
      tufts.setMatrixAt(t, m);
      tufts.setColorAt(t++, new THREE.Color().setHSL(rand(0.23, 0.29), rand(0.5, 0.7), rand(0.3, 0.45)));
      if (f < 220 && Math.random() < 0.14) {
        m.compose(p.set(x + rand(-0.2, 0.2), 0.08, z + rand(-0.2, 0.2)), q, sc.setScalar(rand(0.8, 1.4)));
        flowers.setMatrixAt(f, m);
        flowers.setColorAt(f, new THREE.Color(fc[f % fc.length]));
        f++;
      }
    }
    tufts.count = t; flowers.count = f;
    this.scene.add(tufts, flowers);
  }

  _clouds() {
    const mat = new THREE.SpriteMaterial({ map: softSprite(), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.clouds = new THREE.Group();
    for (let c = 0; c < 9; c++) {
      const g = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Sprite(mat);
        s.scale.set(rand(10, 18), rand(6, 9), 1);
        s.position.set(k * 5 + rand(-2, 2), rand(-1, 1.5), 0);
        g.add(s);
      }
      g.position.set(rand(-90, 90), rand(28, 45), rand(-140, -90));
      this.clouds.add(g);
    }
    this.scene.add(this.clouds);
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    this.resize();
  }

  // ---------------------------------------------------------------- cards
  _faceKey(id, side = this.side) { return faceKeyAt(this.mode, side, id); }
  _face(id, side = this.side) { return faceAt(this.mode, side, id); }

  _makeCard(id, backKey = null) {
    const g = new THREE.Group();
    if (id != null && id >= 0) {
      const mat = new THREE.MeshBasicMaterial({ map: faceTexture(this._faceKey(id)), alphaTest: 0.5 });
      const front = new THREE.Mesh(cardGeo, mat);
      front.castShadow = true;
      g.add(front);
      g.userData.mat = mat;
    }
    let bm = backMat;
    if (this.mode === 'flip') {
      const key = backKey || (id != null && id >= 0 ? this._faceKey(id, 1 - this.side) : null);
      bm = new THREE.MeshBasicMaterial({ map: key ? faceTexture(key) : backTexture(), alphaTest: 0.5 });
      g.userData.backMat = bm;
    }
    const back = new THREE.Mesh(cardGeo, bm);
    back.rotation.y = Math.PI;
    back.castShadow = true;
    g.add(back);
    g.userData.id = id;
    this.scene.add(g);
    return g;
  }

  _shadow(m, on) { m.traverse((o) => { if (o.isMesh) o.castShadow = on; }); }

  _drop(mesh) {
    mesh.parent?.remove(mesh);
    mesh.userData.mat?.dispose();
    mesh.userData.backMat?.dispose();
  }

  // flip mode: opponents' cards and the top of the draw pile show the other side
  _applyBacks(V) {
    if (this.mode !== 'flip') { this.deckTopMat.map = backTexture(); return; }
    for (let s = 0; s < this.np; s++) {
      const keys = V.backs?.[s];
      const fan = this.fans[s];
      if (!keys || !fan) continue;
      fan.forEach((m, i) => { if (m.userData.backMat && keys[i]) m.userData.backMat.map = faceTexture(keys[i]); });
    }
    this.deckTopMat.map = V.deckBack ? faceTexture(V.deckBack) : backTexture();
  }

  // the dark side is played at dusk
  setDusk(on, animate = true) {
    if (!this.built || this._dusk === on) return;
    this._dusk = on;
    const to = on
      ? { top: new THREE.Color(0x2b2560), low: new THREE.Color(0x8a6fb8), hemi: 0.75, sun: 0.85, fog: new THREE.Color(0x6e5a9c) }
      : { top: SKY_TOP.clone(), low: SKY_LOW.clone(), hemi: 1.35, sun: 1.55, fog: SKY_LOW.clone() };
    const from = { top: this.skyU.uTop.value.clone(), low: this.skyU.uLow.value.clone(), hemi: this.hemi.intensity, sun: this.sun.intensity, fog: this.scene.fog.color.clone() };
    const apply = (k) => {
      this.skyU.uTop.value.copy(from.top).lerp(to.top, k);
      this.skyU.uLow.value.copy(from.low).lerp(to.low, k);
      this.hemi.intensity = from.hemi + (to.hemi - from.hemi) * k;
      this.sun.intensity = from.sun + (to.sun - from.sun) * k;
      this.scene.fog.color.copy(from.fog).lerp(to.fog, k);
      this.scene.background.copy(this.scene.fog.color);
      this.renderer.setClearColor(this.scene.fog.color, 1);
    };
    if (animate) tween(1.2, apply); else apply(1);
  }

  // Flip: every card spins over to show its other side, then the table is rebuilt on the new side
  async flipAll(V) {
    const groups = [...this.myCards.values(), ...this.pile, ...this.fans.flat().filter(Boolean)];
    const spins = groups.map((m) => ({ m, q0: m.quaternion.clone(), y0: m.position.y }));
    const qs = new THREE.Quaternion();
    this._sfx?.('shuffle');
    this.setDusk(!!V.side);
    this.ringPulse = 1; this.ringFlash = 1;
    await tween(0.7, (e, raw) => {
      for (const { m, q0, y0 } of spins) {
        m.quaternion.copy(q0).multiply(qs.setFromAxisAngle(Y, Math.PI * e));
        if (m.parent === this.scene) m.position.y = y0 + Math.sin(Math.PI * raw) * 0.6;
      }
      this.deck.position.y = (this.deck.userData.baseY ?? 0.05) + Math.sin(Math.PI * raw) * 0.4;
      if (raw > 0.5 && !this._flipSwapped) { this._flipSwapped = true; this._applyBacks(V); }
    }, ease.inOut);
    this._flipSwapped = false;
    this.deck.position.y = this.deck.userData.baseY ?? this.deck.position.y;
    this.fx.shockwave(new THREE.Vector3(0, 0.05, 0), V.side ? 0xb48cff : 0xffffff, 4);
    await this.reset(V, { handMode: this.handMode, hideHand: this.hideHand });
  }

  _deckH() { return Math.max(0.02, Math.min(this.deckCount, 112) * 0.007); }
  _deckPose() { return { p: new THREE.Vector3(DECK_X, this._deckH() + 0.02, 0), q: flatQuat(0, false), s: 1 }; }

  setDeckCount(n) {
    this.deckCount = n;
    if (!this.deck) return;
    const h = this._deckH();
    this.deck.visible = n > 0;
    this.deck.scale.y = h;
    this.deck.position.y = h / 2;
    this.deck.userData.baseY = h / 2;
  }

  // ---------------------------------------------------------------- seats & layout
  _relIndex(seat) {
    const base = this.viewer >= 0 ? this.viewer : 0;
    return (seat - base + this.np) % this.np;
  }

  // 5-8 players: opponents sit on an arc from the left, over the top, to the right
  // (in turn order, so play still runs clockwise round the screen)
  _arcAngle(seat) {
    const r = this._relIndex(seat), m = this.np - 1;
    const t = m > 1 ? (r - 1) / (m - 1) : 0.5;
    return Math.PI * 1.12 - t * Math.PI * 1.24;
  }

  _relSlot(seat) {
    const r = this._relIndex(seat);
    if (this.np > 4) {
      if (r === 0) return 'bottom';
      const c = Math.cos(this._arcAngle(seat));
      return c < -0.55 ? 'left' : c > 0.55 ? 'right' : 'top';
    }
    const names = { 2: ['bottom', 'top'], 3: ['bottom', 'left', 'right'], 4: ['bottom', 'left', 'top', 'right'] }[this.np] || ['bottom'];
    return names[r];
  }

  _anchor(seat) {
    const portrait = this.camera.aspect < 1;
    let ndc;
    if (this.np > 4 && this._relIndex(seat) > 0) {
      const a = this._arcAngle(seat);
      ndc = [Math.cos(a) * (portrait ? 0.7 : 0.74), (portrait ? 0.06 : 0.05) + Math.sin(a) * (portrait ? 0.38 : 0.45)];
    } else ndc = {
      bottom: [0, -0.5],
      top: [0, portrait ? 0.42 : 0.5],
      left: this.np === 3 ? [-0.5, portrait ? 0.32 : 0.36] : [-0.66, portrait ? 0.04 : 0.02],
      right: this.np === 3 ? [0.5, portrait ? 0.32 : 0.36] : [0.66, portrait ? 0.04 : 0.02],
    }[this._relSlot(seat)];
    this._raycaster.setFromCamera(new THREE.Vector2(ndc[0], ndc[1]), this.camera);
    const p = new THREE.Vector3();
    this._raycaster.ray.intersectPlane(new THREE.Plane(Y, 0), p);
    return p;
  }

  _fanSlots(seat, n) {
    const a = this._anchor(seat);
    const u = new THREE.Vector3(-a.x, 0, -a.z).normalize();
    const t = new THREE.Vector3(u.z, 0, -u.x);
    const crowd = this.np > 4;
    const show = Math.min(n, crowd ? 9 : 14);
    const side = this._relSlot(seat) === 'left' || this._relSlot(seat) === 'right';
    const span = (side ? 0.2 : 0.26) * (crowd ? 0.8 : 1);
    const s = FAN_S * Math.min(1.35, Math.max(1, a.length() / 4.5)) * (crowd ? 0.72 : 1);
    const yaw = Math.atan2(u.x, u.z);
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = Math.min(i, show - 1) - (show - 1) / 2;
      const p = a.clone().addScaledVector(t, -k * span * s * 1.6);
      p.addScaledVector(u, k * k * 0.012);
      p.y = 0.03 + i * 0.006;
      out.push({ p, q: flatQuat(yaw + k * 0.07, false), s });
    }
    return out;
  }

  _handMetrics() {
    const visH = 2 * HAND_D * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const W = view.w, H = view.h;
    const k = visH / H;
    const cw = Math.max(72, Math.min(132, Math.min(W * 0.25, H * 0.17)));
    return { k, cw, ch: cw * 1.5, W, H, visH, visW: visH * this.camera.aspect };
  }

  // top of the hand in px from the bottom of the screen (for the action buttons)
  handTopPx() {
    if (!this.handMode) return 16;
    const { ch } = this._handMetrics();
    return this.handBottomPx + ch * 1.06;
  }

  _sortHand(ids) {
    const rank = (id) => {
      const c = this._face(id);
      const v = typeof c.v === 'number' ? c.v : { skip: 10, skipall: 10.5, rev: 11, flip: 11.5, d1: 12, d2: 12.2, d5: 12.5, wild: 13, w2: 14, w4: 14.2, wdc: 14.5 }[c.v] ?? 15;
      return c.c * 20 + v;
    };
    return ids.slice().sort((a, b) => rank(a) - rank(b) || a - b);
  }

  // cards held as a fan around a pivot below the screen, like a real hand
  _handSlots(ids) {
    const { k, cw, ch, W, visH } = this._handMetrics();
    const n = ids.length;
    const R = ch * 2.5;
    const room = (W / 2 - 12 - cw * 0.72) / R;
    const maxHalf = Math.asin(Math.max(0.05, Math.min(0.9, room)));
    const step = n > 1 ? Math.min(0.15, (maxHalf * 2) / (n - 1)) : 0;
    const pivotY = this.handBottomPx - ch * 0.08 + ch / 2 - R;
    const out = new Map();
    ids.forEach((id, i) => {
      const th = (i - (n - 1) / 2) * step;
      const x = R * Math.sin(th), y = pivotY + R * Math.cos(th);
      const q = new THREE.Quaternion().setFromAxisAngle(Z, -th).multiply(new THREE.Quaternion().setFromAxisAngle(X, -0.1));
      if (this.hideHand) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI));
      const lift = this.playable.has(id) && !this.hideHand ? ch * 0.13 : 0;
      out.set(id, {
        p: new THREE.Vector3(x * k, -visH / 2 + y * k, -HAND_D + i * 0.004),
        q, s: cw * k, lift: lift * k,
        up: new THREE.Vector3(Math.sin(th), Math.cos(th), 0),
      });
    });
    return out;
  }

  _peekPose(big = 1) {
    const { visH, visW } = this._handMetrics();
    const s = Math.min(visH * 0.5 / CH, visW * 0.62 / CW) * big;
    return { p: new THREE.Vector3(0, visH * 0.07, -HAND_D + 1), q: new THREE.Quaternion(), s };
  }

  layout(dur = 0.28) {
    const jobs = [];
    if (this.handMode) {
      this.order = this._sortHand([...this.myCards.keys()]);
      const slots = this._handSlots(this.order);
      for (const [id, m] of this.myCards) {
        const s = slots.get(id);
        if (!s || (!m.userData.inHand && m.userData.flying)) continue;
        m.userData.lift = s.lift;
        m.userData.up = s.up;
        jobs.push(this._moveHome(m, s, dur));
      }
    }
    for (let s = 0; s < this.np; s++) {
      if (this.handMode && s === this.viewer) continue;
      const fan = this.fans[s] || [];
      const slots = this._fanSlots(s, fan.length);
      fan.forEach((m, i) => { if (!m.userData.flying) jobs.push(this._moveTo(m, this.scene, slots[i], dur, 0)); });
      const pad = this.pads?.[s];
      if (pad) {
        const a = this._anchor(s);
        pad.position.set(a.x, 0.006, a.z);
        pad.rotation.y = Math.atan2(-a.x, -a.z);
        pad.visible = true;
      }
    }
    this.pads?.forEach((p, s) => { if (s >= this.np || (this.handMode && s === this.viewer)) p.visible = false; });
    this.onLayout?.();
    return Promise.all(jobs);
  }

  _moveHome(m, s, dur) {
    if (m.parent !== this.hand) { this.hand.attach(m); this._shadow(m, false); }
    m.userData.inHand = true;
    const p0 = (m.userData.home?.p || m.position).clone();
    const q0 = (m.userData.home?.q || m.quaternion).clone();
    const s0 = m.userData.home?.s ?? m.scale.x;
    const home = { p: p0.clone(), q: q0.clone(), s: s0 };
    m.userData.home = home;
    if (m.userData.liftNow == null) m.userData.liftNow = 0;
    if (m.userData.peek == null) m.userData.peek = 0;
    if (!m.userData.drag) m.userData.drag = new THREE.Vector3();
    return tween(dur, (e) => {
      home.p.lerpVectors(p0, s.p, e);
      home.q.slerpQuaternions(q0, s.q, e);
      home.s = s0 + (s.s - s0) * e;
    }, ease.out);
  }

  _setHome(m, s) {
    m.userData.home = { p: s.p.clone(), q: s.q.clone(), s: s.s };
    m.userData.inHand = true;
    m.userData.liftNow = 0;
    m.userData.peek = 0;
    m.userData.lift = s.lift;
    m.userData.up = s.up;
    m.userData.drag = new THREE.Vector3();
  }

  // fly a mesh into `parent` at pose s, with an arc and optional spin
  _moveTo(m, parent, s, dur, arc = 0, delay = 0, spin = 0) {
    const go = () => {
      if (m.parent !== parent) parent.attach(m);
      this._shadow(m, parent === this.scene);
      m.userData.inHand = false;
      m.userData.flying = true;
      const p0 = m.position.clone(), q0 = m.quaternion.clone(), s0 = m.scale.x;
      const qs = new THREE.Quaternion();
      return tween(dur, (e, raw) => {
        m.position.lerpVectors(p0, s.p, e);
        if (arc) m.position.y += Math.sin(Math.PI * raw) * arc;
        m.quaternion.slerpQuaternions(q0, s.q, e);
        if (spin) m.quaternion.premultiply(qs.setFromAxisAngle(Y, spin * (1 - e)));
        m.scale.setScalar(s0 + (s.s - s0) * e);
      }, ease.inOut).then(() => { m.userData.flying = false; });
    };
    return delay ? wait(delay).then(go) : go();
  }

  _place(m, s) {
    m.position.copy(s.p);
    m.quaternion.copy(s.q);
    m.scale.setScalar(s.s);
  }

  // i varies the scatter; slot is the card's height in the visible stack. The newest card
  // must always get the highest slot, or it would be hidden under older cards.
  _pilePose(i, slot = i) {
    const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const r2 = (Math.sin(i * 78.233) * 12543.123) % 1;
    return { p: new THREE.Vector3(PILE_X + r * 0.14, PILE_Y0 + slot * PILE_DY, r2 * 0.14), q: flatQuat(r2 * 0.55, true), s: 1 };
  }

  // ---------------------------------------------------------------- sync
  reset(V, { handMode = true, hideHand = false } = {}) {
    this.gen = (this.gen || 0) + 1;
    this.mode = V.cfg?.mode === 'flip' ? 'flip' : 'classic';
    this.side = V.side || 0;
    this.setDusk(!!this.side);
    this.peekId = -1; this.drag = null;
    this._clearPilePeek();
    for (const m of this.myCards.values()) this._drop(m);
    this.myCards.clear();
    this.fans.forEach((f) => f?.forEach((m) => this._drop(m)));
    this.fans = [];
    this.pile.forEach((m) => this._drop(m));
    this.pile = [];
    this.np = V.np;
    this.viewer = V.viewer;
    this.handMode = handMode && V.viewer >= 0;
    this.hideHand = hideHand;
    this.playable = new Set();
    for (let s = 0; s < V.np; s++) {
      if (this.handMode && s === this.viewer) continue;
      this.fans[s] = Array.from({ length: V.counts[s] }, (_, i) => this._makeCard(null, V.backs?.[s]?.[i]));
    }
    if (this.handMode) for (const id of V.my) this.myCards.set(id, this._makeCard(id));
    V.pile.forEach((id, i) => { const m = this._makeCard(id); this._place(m, this._pilePose(i)); this.pile.push(m); });
    this.pileN = V.pile.length;
    this.setDeckCount(V.deckCount);
    this._applyBacks(V);
    this.setTable(V, false);
    if (this.handMode) {
      const slots = this._handSlots(this._sortHand(V.my));
      for (const [id, m] of this.myCards) { this.hand.attach(m); this._shadow(m, false); const s = slots.get(id); this._place(m, s); this._setHome(m, s); }
    }
    for (let s = 0; s < this.np; s++) {
      const fan = this.fans[s];
      if (!fan) continue;
      const slots = this._fanSlots(s, fan.length);
      fan.forEach((m, i) => this._place(m, slots[i]));
    }
    return this.layout(0);
  }

  reconcile(V) {
    if ((V.cfg?.mode === 'flip' ? 'flip' : 'classic') !== this.mode || (V.side || 0) !== this.side) return this.reset(V, { handMode: this.handMode || V.viewer >= 0, hideHand: this.hideHand });
    if (V.np !== this.np || V.viewer !== this.viewer) return this.reset(V, { handMode: this.handMode || V.viewer >= 0, hideHand: this.hideHand });
    if (this.handMode) {
      const want = new Set(V.my);
      for (const [id, m] of this.myCards) if (!want.has(id)) { this._drop(m); this.myCards.delete(id); }
      for (const id of V.my) if (!this.myCards.has(id)) { const m = this._makeCard(id); this._place(m, this._deckPose()); this.myCards.set(id, m); }
    }
    for (let s = 0; s < this.np; s++) {
      if (this.handMode && s === this.viewer) continue;
      const fan = this.fans[s] || (this.fans[s] = []);
      while (fan.length > V.counts[s]) this._drop(fan.pop());
      while (fan.length < V.counts[s]) { const m = this._makeCard(null); this._place(m, this._deckPose()); fan.push(m); }
    }
    const topId = this.pile[this.pile.length - 1]?.userData.id;
    if (topId !== V.top) {
      this.pile.forEach((m) => this._drop(m));
      this.pile = [];
      V.pile.forEach((id, i) => { const m = this._makeCard(id); this._place(m, this._pilePose(i)); this.pile.push(m); });
      this.pileN = V.pile.length;
    }
    this.setDeckCount(V.deckCount);
    this._applyBacks(V);
    this.setTable(V);
    return this.layout(0.25);
  }

  setTable(V, animate = true) {
    const prevDir = this.dir, prevColor = this.color;
    this.dir = V.dir;
    this.color = V.color;
    this.turnSeat = V.over ? V.over.winner : V.turn;
    if (!this.built) return;
    const P = paletteAt(V.side ?? this.side);
    const col = new THREE.Color(V.color >= 0 ? P[V.color].hex : 0xffffff);
    const from = this.glowMat.color.clone();
    const apply = (k) => { this.glowMat.color.copy(from).lerp(col, k); };
    if (animate) tween(0.5, apply); else apply(1);
    this._ringColor(V.color >= 0 ? P[V.color].hex : 0xffffff, animate);
    if (animate && prevDir !== V.dir) this._flipFx();
    else if (animate && prevColor !== V.color) this.ringPulse = Math.max(this.ringPulse, 0.6);
  }

  setPlayable(ids) {
    this.playable = new Set(ids);
    for (const [id, m] of this.myCards) {
      const on = this.playable.has(id) || this.hideHand || !this.interactive;
      m.userData.dim = on ? 1 : 0.5;
      m.userData.mat?.color.setScalar(m.userData.dim);
    }
    if (this.handMode) this.layout(0.2);
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) { this.hover = -1; this.drag = null; }
    this.canvas.style.cursor = '';
  }

  setHidden(on) {
    if (this.hideHand === on) return Promise.resolve();
    this.hideHand = on;
    this.peekId = -1;
    this.setPlayable(this.playable);
    return this.layout(0.35);
  }

  // ---------------------------------------------------------------- animations
  async deal(V) {
    const gen = this.gen = (this.gen || 0) + 1;
    this.mode = V.cfg?.mode === 'flip' ? 'flip' : 'classic';
    this.side = V.side || 0;
    this.setDusk(!!this.side);
    this.peekId = -1; this.drag = null;
    this._clearPilePeek();
    const counts = V.counts;
    const total = counts.reduce((a, b) => a + b, 0);
    const myIds = this._sortHand(V.my);
    for (const m of this.myCards.values()) this._drop(m);
    this.myCards.clear();
    this.fans.forEach((f) => f?.forEach((m) => this._drop(m)));
    this.fans = [];
    this.pile.forEach((m) => this._drop(m));
    this.pile = [];
    this.np = V.np;
    this.viewer = V.viewer;
    this.setDeckCount(V.deckCount + total + 1);
    this.setTable({ ...V, color: -1 });
    for (let s = 0; s < this.np; s++) if (!(this.handMode && s === this.viewer)) this.fans[s] = [];
    const per = Math.max(...counts);
    const order = [];
    for (let k = 0; k < per; k++) for (let s = 0; s < this.np; s++) if (k < counts[s]) order.push([s, k]);
    const jobs = [];
    const gap = Math.max(0.035, Math.min(0.075, 1.8 / order.length));
    let left = this.deckCount;
    const handSlots = this.handMode ? this._handSlots(myIds) : null;
    order.forEach(([s, k], i) => {
      jobs.push(wait(i * gap * 1000).then(() => {
        if (gen !== this.gen) return;
        this.setDeckCount(--left);
        const mine = this.handMode && s === this.viewer;
        const m = this._makeCard(mine ? myIds[k] : null);
        this._place(m, this._deckPose());
        if (i % 2 === 0) this._sfx?.('flick', i);
        if (mine) {
          this.myCards.set(myIds[k], m);
          const sl = handSlots.get(myIds[k]);
          return this._moveTo(m, this.hand, sl, 0.45).then(() => this._setHome(m, sl));
        }
        this.fans[s].push(m);
        return this._moveTo(m, this.scene, this._fanSlots(s, counts[s])[k], 0.4, 0.7, 0, rand(-3, 3));
      }));
    });
    await Promise.all(jobs);
    if (gen !== this.gen) return;
    this.setDeckCount(V.deckCount);
    const m = this._makeCard(V.top);
    this._place(m, this._deckPose());
    this._sfx?.('flip');
    await this._moveTo(m, this.scene, this._pilePose(0), 0.5, 1.2, 0, Math.PI * 2);
    if (gen !== this.gen) { this._drop(m); return; }
    this.pile.push(m);
    this.pileN = 1;
    this._sfx?.('thwack', 0.8);
    this.fx.shockwave(new THREE.Vector3(PILE_X, 0, 0), 0xffffff, 1.8);
    this.setTable(V);
    await this.layout(0.2);
  }

  async playCard(seat, id) {
    let m;
    this._clearPilePeek();
    if (this.handMode && seat === this.viewer && this.myCards.has(id)) {
      m = this.myCards.get(id);
      this.myCards.delete(id);
      m.userData.inHand = false;
      if (this.peekId === id) this.peekId = -1;
      if (this.hideHand) m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI));
    } else {
      const fan = this.fans[seat] || [];
      const back = fan.pop();
      m = this._makeCard(id);
      if (back) { m.position.copy(back.position); m.quaternion.copy(back.quaternion); m.scale.copy(back.scale); this._drop(back); m.position.y += 0.3; } else this._place(m, this._deckPose());
    }
    const gen = this.gen;
    const lay = this.layout(0.3);
    // keep at most PILE_KEEP cards: drop the oldest and settle the rest one step down
    while (this.pile.length >= PILE_KEEP) {
      this._drop(this.pile.shift());
      this.pile.forEach((c) => { c.position.y -= PILE_DY; });
    }
    this.pile.push(m); // reserve the top slot now so nothing can land above it
    const pose = this._pilePose(this.pileN++, this.pile.length - 1);
    this._sfx?.('whoosh', 1);
    await this._moveTo(m, this.scene, pose, 0.46, 1.6, 0, rand(0.7, 1.3) * Math.PI * (Math.random() < 0.5 ? -1 : 1));
    if (gen !== this.gen) { await lay; return pose.p; }
    await lay;
    return pose.p;
  }

  async drawCards(seat, n, ids) {
    const gen = this.gen;
    const mine = this.handMode && seat === this.viewer;
    const jobs = [];
    const newOnes = [];
    for (let i = 0; i < n; i++) {
      const id = mine ? ids?.[i] : null;
      if (mine && id == null) continue;
      const m = this._makeCard(id);
      this._place(m, this._deckPose());
      m.visible = false;
      m.userData.flying = true;
      newOnes.push(m);
      if (mine) this.myCards.set(id, m); else (this.fans[seat] || (this.fans[seat] = [])).push(m);
    }
    let slots;
    if (mine) { this.order = this._sortHand([...this.myCards.keys()]); slots = this._handSlots(this.order); }
    else slots = this._fanSlots(seat, this.fans[seat].length);
    if (mine) {
      for (const [id, m] of this.myCards) if (!newOnes.includes(m)) { const s = slots.get(id); m.userData.lift = s.lift; m.userData.up = s.up; jobs.push(this._moveHome(m, s, 0.3)); }
    } else this.fans[seat].forEach((m, i) => { if (!newOnes.includes(m)) jobs.push(this._moveTo(m, this.scene, slots[i], 0.3)); });
    // my draws pop up in front of me so I can see them, then slide into the hand
    const reveal = mine && !this.hideHand;
    const hold = newOnes.length <= 2 ? 380 : 120;
    let seq = Promise.resolve();
    newOnes.forEach((m, i) => {
      const go = async () => {
        if (gen !== this.gen) return;
        m.visible = true;
        this.setDeckCount(Math.max(0, this.deckCount - 1));
        this._sfx?.('flick', i);
        if (mine) {
          const s = slots.get(m.userData.id);
          if (reveal) {
            const pk = this._peekPose(0.8);
            await this._moveTo(m, this.hand, pk, 0.36);
            this._sfx?.('flip');
            await wait(hold);
            if (gen !== this.gen) return;
          }
          await this._moveTo(m, this.hand, s, 0.32);
          this._setHome(m, s);
        } else {
          await this._moveTo(m, this.scene, slots[this.fans[seat].indexOf(m)], 0.45, 0.9, 0, rand(-2, 2));
        }
      };
      if (reveal) seq = seq.then(go); // one at a time so each card can be seen
      else jobs.push(wait(i * 130).then(go));
    });
    jobs.push(seq);
    await Promise.all(jobs);
    this.onLayout?.();
  }

  async reshuffle(deckCount) {
    const keep = this.pile.pop();
    const jobs = this.pile.map((m, i) => this._moveTo(m, this.scene, this._deckPose(), 0.35, 0.6, i * 25, 3).then(() => this._drop(m)));
    this.pile = keep ? [keep] : [];
    if (keep) keep.position.y = PILE_Y0; // the card left behind becomes the bottom of the new pile
    await Promise.all(jobs);
    this.setDeckCount(deckCount);
  }

  // big look at the top of the pile (tap the pile)
  peekPile() {
    if (this._pilePeek) { this._clearPilePeek(); return false; }
    const top = this.pile[this.pile.length - 1];
    if (!top) return false;
    const m = this._makeCard(top.userData.id);
    this._place(m, { p: top.position.clone(), q: top.quaternion.clone(), s: 1 });
    this._pilePeek = m;
    this._moveTo(m, this.hand, this._peekPose(0.9), 0.3);
    clearTimeout(this._pileTimer);
    this._pileTimer = setTimeout(() => this._clearPilePeek(), 1800);
    return true;
  }
  _clearPilePeek() {
    clearTimeout(this._pileTimer);
    const m = this._pilePeek;
    if (!m) return;
    this._pilePeek = null;
    const s0 = m.scale.x;
    tween(0.18, (e) => { m.scale.setScalar(s0 * (1 - e * 0.6)); }).then(() => this._drop(m));
  }

  // ---------------------------------------------------------------- effects
  cardFx(pos, id, color) {
    const c = this._face(id);
    const P = paletteAt(this.side);
    const hex = P[color]?.hex ?? 0xffffff;
    this.fx.shockwave(pos, 0xffffff, c.v === 'w4' || c.v === 'wdc' || c.v === 'd5' ? 4 : 2.2);
    this.fx.burst(pos, hex, c.c === WILD ? 50 : 22, false, { speed: 0.6, up: 0.6, size: 0.12 });
    if (c.c === WILD) P.forEach((cc, i) => setTimeout(() => this.fx.burst(pos, cc.hex, 18, true, { speed: 0.8, size: 0.12 }), i * 70));
    if (typeof c.v !== 'number') this.shake(c.v === 'w4' ? 0.35 : 0.2);
  }

  seatFx(seat, hex, big = false) {
    const p = this.seatWorld(seat);
    this.fx.shockwave(p, hex, big ? 4 : 2.4);
    this.fx.burst(p, hex, big ? 50 : 26, true, { speed: big ? 1.1 : 0.7, size: 0.12 });
  }

  shake(amount = 0.2) { this.shakeAmt = Math.max(this.shakeAmt, amount); }

  celebrate(seat) {
    const p = this.seatWorld(seat);
    const cols = COLORS.map((c) => c.hex);
    this.fx.fireworks(p, cols, 6, 3);
    this.fx.confetti(260, 12);
    this.shake(0.3);
    for (let i = 1; i <= 5; i++) {
      setTimeout(() => this.fx.fireworks(new THREE.Vector3(rand(-4, 4), 0, rand(-3, 1)), cols, 3, rand(2.5, 4)), i * 550);
    }
  }

  seatWorld(seat) {
    if (this.handMode && seat === this.viewer) {
      const v = new THREE.Vector3();
      this._raycaster.setFromCamera(new THREE.Vector2(0, -0.4), this.camera);
      this._raycaster.ray.intersectPlane(new THREE.Plane(Y, 0), v);
      return v;
    }
    return this._anchor(seat);
  }

  seatScreen(seat) {
    if (this.handMode && seat === this.viewer) return null;
    const p = this._anchor(seat);
    const rel = this._relSlot(seat);
    p.addScaledVector(new THREE.Vector3(-p.x, 0, -p.z).normalize(), rel === 'top' || rel === 'bottom' ? -1.1 : -0.3);
    p.project(this.camera);
    return { x: (p.x + 1) / 2 * view.w, y: (1 - p.y) / 2 * view.h, rel };
  }
  pileScreen() {
    const p = new THREE.Vector3(PILE_X, 0, -CH / 2 - 0.2).project(this.camera);
    return { x: (p.x + 1) / 2 * view.w, y: (1 - p.y) / 2 * view.h };
  }

  setDemo(on) { this.demo = on; }

  // ---------------------------------------------------------------- camera
  frame() {
    const aspect = this.camera.aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const portrait = aspect < 1;
    const dist = Math.max(3.4 / (t * aspect), 4.4 / t);
    // 3D: tilted view across the table; 2D: straight down from above
    const phi = this.flat ? 0.02 : portrait ? 0.7 : 0.84;
    const target = new THREE.Vector3(0, 0, this.flat ? (portrait ? 1.0 : 0.6) : portrait ? 1.5 : 1.0);
    this.camera.position.set(0, Math.cos(phi) * dist, Math.sin(phi) * dist).add(target);
    this.camera.lookAt(target);
    this.camBase.copy(this.camera.position);
    this.camera.updateMatrixWorld();
  }

  setFlat(on) {
    if (this.flat === on) return;
    this.flat = on;
    this.frame();
    this.layout(0.3);
  }

  resize() {
    const w = view.w, h = view.h;
    const dprCap = this.quality === 'high' ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.layout(0), 60);
  }

  // ---------------------------------------------------------------- input
  // tap = play, swipe up = throw, long press = look at the card
  _initPointer() {
    const cv = this.canvas;
    let down = null;
    let pressTimer = null;
    const canTouchHand = () => this.handMode && !this.hideHand;
    cv.addEventListener('pointerdown', (e) => {
      if (this._pilePeek) { this._clearPilePeek(); down = null; return; }
      const q = view.pt(e);
      down = { x: q.x, y: q.y, t: performance.now(), id: e.pointerId, card: -1, moved: false };
      if (!canTouchHand()) return;
      const id = this._pickCard(e);
      if (id < 0) return;
      down.card = id;
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.drag = { id, dx: 0, dy: 0 };
      this.hover = id;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (down && down.card === id && !down.moved) { this.peekId = id; this._sfx?.('peek'); this.onPeek?.(id); }
      }, 380);
    });
    cv.addEventListener('pointermove', (e) => {
      if (down && down.id === e.pointerId && down.card >= 0) {
        let q = view.pt(e);
        let dx = q.x - down.x, dy = q.y - down.y;
        // holding a card up big and sliding: browse the hand at full size
        if (this.peekId >= 0) {
          const under = this._pickCard(e);
          if (under >= 0 && under !== this.peekId) {
            down.card = under; this.peekId = under; this.hover = under; this.drag = { id: under, dx: 0, dy: 0 };
            this._sfx?.('flick');
            this.onPeek?.(under);
          }
          return;
        }
        // sliding sideways (not throwing upwards): the card under the finger pops up instead
        if (dy > -40 && Math.abs(dx) > 12) {
          const under = this._pickCard(e);
          if (under >= 0 && under !== down.card) {
            clearTimeout(pressTimer);
            down.card = under; down.x = q.x; down.y = q.y; down.moved = true; down.scrub = true;
            this.drag = { id: under, dx: 0, dy: 0 };
            this.hover = under;
            this._sfx?.('flick');
            dx = 0; dy = 0;
          }
        }
        if (Math.hypot(dx, dy) > 10) { down.moved = true; clearTimeout(pressTimer); } // moving: not a press-and-hold
        if (this.peekId < 0 && this.drag) {
          const free = this.interactive && this.playable.has(down.card);
          this.drag.dx = free ? dx : dx * 0.15;
          this.drag.dy = free ? Math.min(dy, 40) : Math.max(-30, Math.min(dy, 20)) * 0.3;
        }
        return;
      }
      if (e.pointerType !== 'mouse' || down) return;
      const id = canTouchHand() ? this._pickCard(e) : -1;
      this.hover = id;
      cv.style.cursor = (id >= 0) || (this.interactive && this._pickDeck(e)) || this._pickPile(e) ? 'pointer' : '';
    });
    const end = (e) => {
      clearTimeout(pressTimer);
      if (!down || down.id !== e.pointerId) return;
      const d = down;
      down = null;
      const q = view.pt(e);
      const dx = q.x - d.x, dy = q.y - d.y;
      const quick = performance.now() - d.t < 380;
      if (d.card >= 0) {
        const wasPeek = this.peekId === d.card;
        this.peekId = -1;
        if (e.pointerType !== 'mouse') this.hover = -1;
        if (wasPeek) { this._sfx?.('unpeek'); this.drag = null; this.onPeek?.(-1); return; }
        const swipe = dy < -55 && Math.abs(dy) > Math.abs(dx) * 0.8;
        this.drag = null;
        if (e.type === 'pointerup' && this.interactive && (swipe || (!d.moved && quick))) {
          if (!this.playable.has(d.card)) { this.onReject?.(d.card); return; }
          this.onCard?.(d.card, swipe);
        }
        return;
      }
      if (e.type !== 'pointerup' || Math.hypot(dx, dy) > 14 || !quick) return;
      if (this.interactive && this._pickDeck(e)) { this.onDeck?.(); return; }
      if (this._pickPile(e)) this.onPile?.();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !down) this.hover = -1; });
  }

  _ray(e) {
    const q = view.pt(e);
    this._pointer.set((q.x / view.w) * 2 - 1, -(q.y / view.h) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);
  }

  _pickCard(e) {
    if (!this.handMode || this.hideHand || !this.myCards.size) return -1;
    this._ray(e);
    // mouse still over the raised (hovered) card where it is now? keep it, so it doesn't flicker
    const cur = e.pointerType === 'mouse' ? this.myCards.get(this.hover) : null;
    if (cur?.userData.inHand && this._raycaster.intersectObject(cur.children[0], false).length) return this.hover;
    // otherwise pick by where the cards sit in the fan (not where they float while raised)
    const fronts = [];
    const saved = [];
    for (const m of this.myCards.values()) {
      const h = m.userData.home;
      if (!m.userData.inHand || !h) continue;
      saved.push([m, m.position.clone(), m.quaternion.clone(), m.scale.x]);
      m.position.copy(h.p); m.quaternion.copy(h.q); m.scale.setScalar(h.s);
      m.updateMatrixWorld(true);
      fronts.push(m.children[0]);
    }
    const hit = this._raycaster.intersectObjects(fronts, false)[0];
    for (const [m, p, q, sc] of saved) { m.position.copy(p); m.quaternion.copy(q); m.scale.setScalar(sc); m.updateMatrixWorld(true); }
    return hit ? hit.object.parent.userData.id : -1;
  }

  _hitBox(e, x) {
    this._ray(e);
    const p = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(new THREE.Plane(Y, 0), p)) return false;
    return Math.abs(p.x - x) < CW * 0.75 && Math.abs(p.z) < CH * 0.72;
  }
  _pickDeck(e) { return !!this.deck && this._hitBox(e, DECK_X); }
  _pickPile(e) { return this.pile.length > 0 && this._hitBox(e, PILE_X); }

  // ---------------------------------------------------------------- loop
  _loop(now) {
    const dt = Math.min(0.05, (now - this._clock) / 1000);
    this._clock = now;
    const t = now / 1000;
    updateTweens(now);
    // screen shake ("punch")
    if (this.shakeAmt > 0.002) {
      this.camera.position.copy(this.camBase).add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.shakeAmt));
      this.shakeAmt *= Math.pow(0.002, dt);
    } else if (this.shakeAmt) { this.shakeAmt = 0; this.camera.position.copy(this.camBase); }
    if (this.built) {
      this.dirScale += (1 - this.dirScale) * Math.min(1, dt * 1.2);
      // dir 1 = clockwise on screen (bottom -> left -> top -> right) = increasing ring angle
      this.ringU.uPhase.value += this.dir * dt * 0.45 * this.dirScale;
      this.ringU.uDir.value = this.dir;
      this.ringU.uTime.value = t;
      this.ringFlash = Math.max(0, this.ringFlash - dt * 1.6);
      this.ringU.uFlash.value = this.ringFlash;
      this.ringPulse = Math.max(0, this.ringPulse - dt * 1.4);
      const pk = Math.sin(this.ringPulse * Math.PI);
      this.ring.scale.set(1 + pk * 0.12, 1, 1 + pk * 0.12);
      this.ringGlowMat.opacity = 0.28 + Math.sin(t * 2.5) * 0.06 + pk * 0.4;
      this.pads.forEach((p, s) => {
        const target = s === this.turnSeat ? 0.5 + Math.sin(t * 4) * 0.15 : 0;
        p.material.opacity += (target - p.material.opacity) * Math.min(1, dt * 6);
      });
      const myTurn = this.interactive && this.handMode && !this.hideHand;
      const dgT = myTurn && this.playable.size === 0 ? 0.7 + Math.sin(t * 5) * 0.25 : 0;
      this.deckGlowMat.opacity += (dgT - this.deckGlowMat.opacity) * Math.min(1, dt * 6);
      this.clouds.position.x = Math.sin(t * 0.02) * 20;
    }
    // hand: home pose + lift + drag + peek
    const looking = this.peekId >= 0 ? this.peekId : this.hover;
    if (looking !== this._lastLook) { this._lastLook = looking; this.onHover?.(looking); }
    if (this.myCards.size) {
      const pk = this._peekPose(1);
      const { k } = this._handMetrics();
      for (const [id, m] of this.myCards) {
        const h = m.userData.home;
        if (!m.userData.inHand || !h) continue;
        const hov = id === this.hover && !this.hideHand && this.peekId < 0;
        // hovered card (mouse, or a finger sliding along the hand) rises clear of its neighbours
        const target = (m.userData.lift || 0) + (hov ? h.s * CH * 0.42 : 0);
        m.userData.liftNow += (target - m.userData.liftNow) * Math.min(1, dt * 14);
        m.userData.hov = (m.userData.hov || 0) + ((hov ? 1 : 0) - (m.userData.hov || 0)) * Math.min(1, dt * 14);
        const pkT = id === this.peekId ? 1 : 0;
        m.userData.peek += (pkT - m.userData.peek) * Math.min(1, dt * 12);
        const dr = m.userData.drag;
        const dragging = this.drag && this.drag.id === id;
        const tx = dragging ? this.drag.dx * k : 0, ty = dragging ? -this.drag.dy * k : 0;
        const kk = Math.min(1, dt * (dragging ? 30 : 12));
        dr.x += (tx - dr.x) * kk;
        dr.y += (ty - dr.y) * kk;
        const up = m.userData.up || Y;
        m.position.copy(h.p).addScaledVector(up, m.userData.liftNow).add(dr);
        const hv = m.userData.hov;
        if (hov || dragging) m.position.z += 0.08;
        m.position.z += 0.25 * hv; // in front of every other card
        m.quaternion.copy(h.q).slerp(QI, 0.75 * hv); // stand it up straight
        let s = h.s * (1 + 0.22 * hv);
        const pv = m.userData.peek;
        if (m.userData.mat && m.userData.dim != null && m.userData.dim < 1) m.userData.mat.color.setScalar(m.userData.dim + (1 - m.userData.dim) * pv);
        if (pv > 0.001) {
          m.position.lerp(pk.p, pv);
          m.position.z += 0.2 * pv;
          m.quaternion.slerp(pk.q, pv);
          s += (pk.s - s) * pv;
        }
        m.scale.setScalar(s);
      }
    }
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
