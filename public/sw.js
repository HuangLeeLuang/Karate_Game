const CACHE_NAME = 'neon-karate-v12';
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
  '/fio-actions-smooth-v4.png?pose=5',
  '/fio-hit-reactions-smooth-v4.png?pose=5',
  '/fio-guards-smooth-v4.png?pose=5',
  '/fio-gun-actions-smooth-v4.png?pose=5',
  '/kai-gun-actions-smooth-v4.png?pose=5',
  '/fio-walk-smooth-v4.png?pose=5',
  '/kai-walk-smooth-v4.png?pose=5',
  '/enemy-long-kick-walk-smooth-v4.png?pose=5',
  '/enemy-grappler-walk-smooth-v4.png?pose=5',
  '/enemy-quick-fist-smooth-v4.png?pose=5',
  '/enemy-long-kick-smooth-v4.png?pose=5',
  '/enemy-grappler-smooth-v4.png?pose=5',
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
