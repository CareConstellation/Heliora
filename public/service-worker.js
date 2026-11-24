/* eslint-disable */
/// <reference lib="webworker" />

const FONTS_CACHE = 'heliora-fonts-v1';
const STATIC_CACHE = 'heliora-static-v1';
const SHELL_CACHE = 'heliora-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(['/']);
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== FONTS_CACHE && k !== STATIC_CACHE && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // 1. Web fonts: Cache-first
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    request.destination === 'font' ||
    url.pathname.match(/\.(?:woff2?|eot|ttf|otf)$/)
  ) {
    event.respondWith(
      caches.open(FONTS_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
        }),
      ),
    );
    return;
  }

  // 2. Static assets & Next.js chunks: Cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image'
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
        }),
      ),
    );
    return;
  }

  // 3. App Shell / Navigation: Stale-While-Revalidate with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached || cache.match('/'));

          return cached || fetchPromise;
        }),
      ),
    );
  }
});

/* The worker never reads clinical records or authentication tokens. It only
 * wakes an open app tab, where the authenticated page decrypts and syncs its
 * own IndexedDB outbox. */
self.addEventListener('sync', (event) => {
  if (event.tag !== 'heliora-clinical-outbox') return;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'heliora-sync-outbox' });
      }
    })(),
  );
});
