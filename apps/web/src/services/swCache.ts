// What the service worker keeps of the API (PROJECT_PLAN §10.6). Like
// pushEvents.ts it has no imports and no browser globals beyond `URL`: sw.ts
// has no DOM, and the tests call it directly.

/** GET /routes/:id/status. */
const OWNER_STATUS = /^\/api\/v1\/routes\/[^/]+\/status$/;

/**
 * The GETs of route data worth keeping for when the app is offline: the list
 * of routes and each route's bundle. Not the routes around a position (the
 * `?near=` of phase 7.2 carries where the user was, and the list only makes
 * sense online) nor the owner's view of a published route (`/status` is for
 * the device that made it).
 */
export function isCacheableRouteRequest(url: URL, method: string): boolean {
  return (
    method === 'GET' &&
    url.pathname.startsWith('/api/v1/routes') &&
    !url.searchParams.has('near') &&
    !OWNER_STATUS.test(url.pathname)
  );
}

/** GET /media/<id>.jpg: a user's own photo, a route's cover (phase 7.3). api-contract's MEDIA_PATH, copied: this file has no imports. */
const OWN_PHOTO = /^\/api\/v1\/media\/[A-Za-z0-9_-]{22}\.jpg$/;

/**
 * The photos users upload as covers. The worker asks the network first (the
 * operator may delete one: the API then answers 404) and keeps the last copy
 * for offline use, a downloaded route's cover included.
 */
export function isOwnPhotoRequest(url: URL, method: string): boolean {
  return method === 'GET' && OWN_PHOTO.test(url.pathname);
}
