const CACHE_NAME = 'livelyrics-v2'

// App shell files to cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
]

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL)
    })
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    })
  )
  self.clients.claim()
})

// Fetch strategy:
// - API calls (/api/*): network-only
// - Dev server assets (contain localhost with port): network-only (don't cache Vite HMR/dev files)
// - Everything else: network-first with cache fallback (for offline support)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip API calls — these need the server and are only used during setup
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // Skip Vite dev server requests (HMR, module scripts, etc.)
  if (url.pathname.includes('/@') || url.pathname.includes('node_modules') || url.pathname.includes('.hot-update')) {
    return
  }

  // Network-first strategy: try network, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone)
          })
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request)
      })
  )
})
