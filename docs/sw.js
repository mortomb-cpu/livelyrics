// LiveLyrics Service Worker - Cache-first for offline performance
const CACHE_NAME = 'livelyrics-perform-v1';
const URLS_TO_CACHE = [
  './',
  './perform.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: pre-cache all files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(URLS_TO_CACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first strategy for local files, network for everything else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Serve from cache, but also update in background
        fetch(event.request).then((fresh) => {
          if (fresh && fresh.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, fresh));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback - return cached perform.html for any navigation
      if (event.request.mode === 'navigate') {
        return caches.match('./perform.html');
      }
    })
  );
});
