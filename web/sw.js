// Cache public offline information only. Never cache the application shell,
// residents, credentials, captchas, API responses or commands; never queue/replay.
const CACHE_PREFIX = 'opentyg-public-offline-';
const CACHE_NAME = CACHE_PREFIX + '1.2.0';
const PUBLIC_FILES = ['/offline.html', '/css/pwa.css', '/js/offline.js', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of PUBLIC_FILES) {
      const response = await fetch(new Request(path, { cache: 'reload', credentials: 'omit', redirect: 'error' }));
      if (!response.ok || response.redirected) throw new Error('Offline resources unavailable');
      await cache.put(path, response);
    }
    // Only the public offline screen changes; no application reload or in-flight
    // API interruption is needed to activate an update.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Leaving API and non-GET requests completely unhandled preserves normal
  // network failure semantics and prevents offline successes or command replay.
  if (url.origin !== self.location.origin || request.method !== 'GET' || /^\/api(?:\/|$)/.test(url.pathname)) return;
  if (PUBLIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.pathname)) || fetch(request);
    })());
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/offline.html')) || new Response('当前无法连接服务，请联网后重试。', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    })());
  }
});
