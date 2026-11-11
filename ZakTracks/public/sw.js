/**
 * ZakTracks service worker.
 *
 * The app shell is network-first, so opening the home-screen app always tries
 * to load the newest build and a deployed update arrives without reinstalling
 * it. Static assets keep their hashed filenames, so they are cached
 * aggressively; API calls are never cached.
 */
const CACHE = 'zaktracks-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(SHELL).catch(() => undefined)
      // Take over immediately instead of waiting for every tab to close.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('zaktracks-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never serve an account or sync response out of a cache.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request, { cache: 'no-store' })
          const cache = await caches.open(CACHE)
          void cache.put('/index.html', fresh.clone())
          return fresh
        } catch {
          // Offline: fall back to the last shell we saw.
          const cached = await caches.match('/index.html')
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  // Only the built, content-hashed files are cached. Everything else (dev
  // modules, source files) goes straight to the network so it is never stale.
  const isStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest'
  if (!isStatic) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const res = await fetch(request)
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE)
        void cache.put(request, res.clone())
      }
      return res
    })(),
  )
})
