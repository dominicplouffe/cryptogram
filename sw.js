// Offline support.
//
// Cache-first on the app shell: the game is entirely static and self-contained,
// so once it is cached there is no reason to hit the network at all. Bump
// CACHE_VERSION on release to retire the old shell.

const CACHE_VERSION = 'plouffe-word-games-v2';

// Relative paths so the worker also works from a GitHub Pages subdirectory.
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'src/main.js',
  'src/cipher.js',
  'src/quotes.js',
  'src/state.js',
  'src/render.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is all-or-nothing; a single 404 would leave us with no cache at
      // all, so each entry is added independently.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve immediately, then quietly refresh for the next load.
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response.ok) return caches.open(CACHE_VERSION).then((c) => c.put(request, response));
            })
            .catch(() => {
              /* offline: the cached copy stands */
            })
        );
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.put(request, copy)));
          }
          return response;
        })
        .catch(() =>
          // A navigation that misses the cache while offline still gets the app.
          request.mode === 'navigate' ? caches.match('index.html') : Response.error()
        );
    })
  );
});
