// Claude Map — Service Worker
// Enables PWA installability and caches the app shell for fast launches.
// API calls always go to the network; static assets use network-first with cache fallback.

const CACHE = 'claude-map-v1';

const SHELL = [
  '/',
  '/manifest.json',
  '/logo.png',
];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .catch(() => {}) // Don't block install on cache errors
  );
  self.skipWaiting();
});

// ── Activate: drop old caches ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for static, bypass for API/WS ───────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass: non-GET, cross-origin, API calls, WebSocket upgrades, SSE
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    request.headers.get('accept')?.includes('text/event-stream')
  ) {
    return;
  }

  // Network-first: serve fresh, cache for offline fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
