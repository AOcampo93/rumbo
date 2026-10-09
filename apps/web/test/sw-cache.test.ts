import { describe, expect, it } from 'vitest';
import { isCacheableRouteRequest } from '../src/services/swCache.ts';

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
