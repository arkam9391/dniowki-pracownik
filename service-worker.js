// Przy każdej publikacji zmieniającej zasoby podnieś wersję tutaj oraz APP_VERSION/APP_BUILD w app.js.
const CACHE_PREFIX = 'dniowki-app-';
const CACHE_NAME = `${CACHE_PREFIX}v1.1.0-2026-10-27`;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon-1024.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // cache: 'reload' omija pamięć HTTP, więc nowa wersja nie dostanie plików ze starego zestawu.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// HTML, CSS i JS zawsze pochodzą z jednego, wersjonowanego cache — nowa wersja pojawia się dopiero po aktywacji nowego workera.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const lookup = request.mode === 'navigate' ? './index.html' : request;
  event.respondWith(
    caches.match(lookup, { cacheName: CACHE_NAME }).then((cached) => cached || fetch(request))
  );
});
