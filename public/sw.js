const CACHE_NAME = 'neon-karate-v8';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/game-data/attacks.json',
  '/game-data/ai.json',
  '/urban-stage-seamless.png',
  '/fio-actions-smooth.png',
  '/fio-hit-reactions-smooth.png',
  '/fio-guards-smooth.png',
  '/fio-gun-actions-smooth.png',
  '/kai-gun-actions-smooth.png',
  '/fio-walk-smooth.png',
  '/kai-walk-smooth.png',
  '/enemy-long-kick-walk-smooth.png',
  '/enemy-grappler-walk-smooth.png',
  '/enemy-quick-fist-smooth.png',
  '/enemy-long-kick-smooth.png',
  '/enemy-grappler-smooth.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null))),
      ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
