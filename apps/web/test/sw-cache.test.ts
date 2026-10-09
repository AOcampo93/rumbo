import { describe, expect, it } from 'vitest';
import { isCacheableRouteRequest, isOwnPhotoRequest } from '../src/services/swCache.ts';

// What the service worker keeps of the API's route data (sw.ts hands every
// request to this): the routes the app reads, for when it is offline.

const keeps = (path: string, method = 'GET') =>
  isCacheableRouteRequest(new URL(`https://rumbo.test${path}`), method);

describe('the route data the service worker keeps', () => {
  it('keeps the list of routes and each route, read with a GET', () => {
    expect(keeps('/api/v1/routes')).toBe(true);
    expect(keeps('/api/v1/routes/leiria-historica')).toBe(true);
    expect(keeps('/api/v1/routes?mode=free&q=castelo')).toBe(true);
  });

  it('keeps nothing that is not a read of routes', () => {
    expect(keeps('/api/v1/routes', 'POST')).toBe(false);
    expect(keeps('/api/v1/routes/leiria-historica', 'DELETE')).toBe(false);
    expect(keeps('/api/v1/content/generate')).toBe(false);
    expect(keeps('/api/v1/runs')).toBe(false);
  });

  // Phase 7.2: where the user was never stays in a cache, and the owner's view of a route is for its device.
  it("does not keep the routes around a position, nor the owner's view of a published route", () => {
    expect(keeps('/api/v1/routes?near=39.744,-8.807')).toBe(false);
    expect(keeps('/api/v1/routes?mode=free&near=39.744,-8.807')).toBe(false);
    expect(keeps('/api/v1/routes/paseo-aaaa/status')).toBe(false);
    // A route that is called "status" is still a route.
    expect(keeps('/api/v1/routes/status')).toBe(true);
    expect(keeps('/api/v1/routes/status-do-castelo')).toBe(true);
  });
});

// Phase 7.3: the photos users upload as route covers are kept for offline use (a
// downloaded route's cover included): each one has an address nobody reuses.
describe('the photos of the users the service worker keeps', () => {
  const own = (path: string, method = 'GET') =>
    isOwnPhotoRequest(new URL(`https://rumbo.test${path}`), method);

  it('keeps a stored photo, read with a GET', () => {
    expect(own('/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg')).toBe(true);
    expect(own('/api/v1/media/a-B_c0123456789XYZ-_ab.jpg')).toBe(true);
  });

  it('keeps nothing else of the media endpoint, nor the uploads themselves', () => {
    expect(own('/api/v1/media', 'POST')).toBe(false);
    expect(own('/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.jpg', 'DELETE')).toBe(false);
    expect(own('/api/v1/media/short.jpg')).toBe(false);
    expect(own('/api/v1/media/AAAAAAAAAAAAAAAAAAAAAA.png')).toBe(false);
    expect(own('/api/v1/media/../routes/AAAAAAAAAAAAAAAAAAAAAA.jpg')).toBe(false);
    expect(own('/api/v1/routes/AAAAAAAAAAAAAAAAAAAAAA.jpg')).toBe(false);
  });
});
