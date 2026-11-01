/*
 * Hindsight offline service worker (generated into dist/sw.js at build time).
 * Precaches the app shell, the openings table, the rating model and the Stockfish WASM, so a
 * review works with no network at all after the first visit. Responses are re-served with the
 * COOP/COEP headers so the multi-threaded engine keeps working offline.
 */
const VERSION = '__VERSION__';
const CACHE = 'hindsight-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hindsight-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isolate(res) {
  if (!res || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return isolate(hit);
      try {
        const res = await fetch(req);
        if (res.ok && req.mode !== 'navigate') cache.put(req, res.clone());
        return isolate(res);
      } catch (e) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('./');
          if (shell) return isolate(shell);
        }
        throw e;
      }
    })(),
  );
});
