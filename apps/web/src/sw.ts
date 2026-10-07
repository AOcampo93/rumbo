/// <reference lib="webworker" />
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

// Service worker (PROJECT_PLAN §10.6): the app shell and the three language
// catalogs are precached; the map SDK, photos and route data are cached as
// they are used. Basemap tiles are never cached (terms of use and size).

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const DAY = 24 * 60 * 60;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// A new version takes over at once (the app reloads on its own terms).
void self.skipWaiting();
clientsClaim();

// Every in-app URL opens the SPA shell, offline too.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/version\.json$/],
  }),
);

const sameOrigin = (url: URL) => url.origin === self.location.origin;

// The map SDK's chunks: hashed and immutable, fetched when a map first opens.
registerRoute(
  ({ url }) => sameOrigin(url) && url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: 'rumbo-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 1500, maxAgeSeconds: 90 * DAY })],
  }),
);

// The SDK's own assets on Esri's CDN (strings, styles, fonts): versioned URLs.
registerRoute(
  ({ url }) => url.hostname === 'js.arcgis.com' || url.hostname === 'static.arcgis.com',
  new CacheFirst({
    cacheName: 'arcgis-cdn',
    plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 30 * DAY })],
  }),
);

// Photos of places (Wikimedia Commons) and video thumbnails.
registerRoute(
  ({ request, url }) =>
    request.destination === 'image' &&
    (url.hostname.endsWith('.wikimedia.org') || url.hostname === 'i.ytimg.com'),
  new CacheFirst({
    cacheName: 'rumbo-images',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * DAY })],
  }),
);

// Route data from the API: fresh when online, the last copy when not.
registerRoute(
  ({ request, url }) =>
    sameOrigin(url) && request.method === 'GET' && url.pathname.startsWith('/api/v1/routes'),
  new NetworkFirst({ cacheName: 'rumbo-api', networkTimeoutSeconds: 4 }),
);

// Files the page loaded before this worker controlled it (first visit) never
// went through the cache above: the page sends their URLs once we take over.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; urls?: unknown } | null;
  if (data?.type !== 'cache-assets' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (url): url is string =>
      typeof url === 'string' && new URL(url).pathname.startsWith('/assets/sdk/'),
  );
  event.waitUntil(
    (async () => {
      const cache = await caches.open('rumbo-assets');
      for (const url of urls) {
        if (!(await cache.match(url))) await cache.add(url).catch(() => undefined);
      }
    })(),
  );
});

// Tapping an arrival notification brings the app forward on that point's
// card (§10.2): the page routes itself, so the run in memory is kept.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = String((event.notification.data as { url?: string } | null)?.url ?? '/run');
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        client.postMessage({ type: 'navigate', url: target });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
