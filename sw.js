// Service worker: cache-first app shell so the game works offline.
// Bump VERSION whenever you deploy changes.
const VERSION = 'colorcard3d-v14';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './fonts/fredoka.ttf',
  './js/main.js',
  './js/scene.js',
  './js/rules.js',
  './js/ai.js',
  './js/audio.js',
  './js/anim.js',
  './js/fx3d.js',
  './js/bgfx.js',
  './js/net.js',
  './js/view.js',
  './audio/voice/blue.mp3',
  './audio/voice/colorcard.mp3',
  './audio/voice/draw.mp3',
  './audio/voice/forgot.mp3',
  './audio/voice/green.mp3',
  './audio/voice/last.mp3',
  './audio/voice/uno.mp3',
  './audio/voice/pass.mp3',
  './audio/voice/pick2.mp3',
  './audio/voice/pick4.mp3',
  './audio/voice/red.mp3',
  './audio/voice/reverse.mp3',
  './audio/voice/skip.mp3',
  './audio/voice/turn.mp3',
  './audio/voice/winner.mp3',
  './audio/voice/yellow.mp3',
  './audio/voice/youwin.mp3',
  './audio/voice/flip.mp3',
  './audio/voice/pick1.mp3',
  './audio/voice/pick5.mp3',
  './audio/voice/skipall.mp3',
  './audio/voice/until.mp3',
  './audio/voice/pink.mp3',
  './audio/voice/teal.mp3',
  './audio/voice/orange.mp3',
  './audio/voice/purple.mp3',
  './vendor/three.module.min.js',
  './vendor/peerjs.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // PeerJS signalling etc. goes straight to network

  // Navigations: network first (fresh deploys), fall back to cached shell offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // Static assets: stale-while-revalidate
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});
