// Offline support.
//
// Network-first, cache as fallback -- deliberately NOT cache-first.
//
// Cache-first serves a stale app for one full load after every deploy, which in
// practice meant a returning player got the previous version of the game and had
// to reload to see the current one. The whole app is well under a megabyte, so
// preferring the network costs a few tens of milliseconds and removes that class
// of bug entirely. The cache is still a complete copy, so offline play is
// unaffected.

const CACHE_VERSION = 'plouffe-word-games-v11';

// Relative paths so the worker also works from a GitHub Pages subdirectory.
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'src/main.js',
  'src/cipher.js',
  'src/quotes.js',
  'src/store.js',
  'src/render.js',
  'src/words.js',
  'src/games/registry.js',
  'src/games/boxed.js',
  'src/games/cryptogram.js',
  'src/games/fiver.js',
  'src/games/hidden.js',
  'src/games/ladder.js',
  'src/games/search.js',
  'src/games/wheel.js',
  'src/games/vowels.js',
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
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))
      );
      await self.clients.claim();

      // Deliberately NOT calling client.navigate() to force open pages to
      // reload here. It would fix the one transitional load where a page is
      // still running the previous version's scripts, but it can also reload a
      // player mid-puzzle, and it is unsupported on Safari. Network-first
      // fetching below means that transitional load is the only stale one; the
      // page-side controllerchange handler in main.js covers it from the next
      // release onward.
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // `cache: 'no-cache'` revalidates instead of trusting the HTTP cache.
    // Without it "network-first" is only worker-cache-first: GitHub Pages serves
    // assets with a ten-minute max-age, so a plain fetch() could still be
    // answered from the browser's HTTP cache. That produced a genuinely broken
    // mixed state after a deploy -- new scripts running against the previous
    // stylesheet. This still costs almost nothing, since an unchanged file comes
    // back as a 304 with no body.
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        // Offline: fall back to the cached copy.
        const cached = await caches.match(request);
        if (cached) return cached;
        // A navigation with no exact match still gets the app shell.
        if (request.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
