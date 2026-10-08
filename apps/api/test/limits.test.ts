import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCuratedRoutes } from '../src/db/seed.js';
import type { GeocodingProvider } from '../src/geo/provider.js';
import { trustProxyHop } from '../src/limits.js';
import { CURATED, setupApi, TOKEN, userRoute } from './helpers.js';

// The strict limits count per client address (security review): route
// writes per minute and per day, and place search per minute. Each test
// builds its own app, so each starts with empty counters.

let api: Awaited<ReturnType<typeof setupApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const app = () => {
  if (!api) throw new Error('setupApi first');
  return api.app;
};

/** A route write that is cheap to repeat: deleting a route that doesn't exist (404). */
const write = (headers: Record<string, string> = {}, remoteAddress?: string) =>
  app().inject({
    method: 'DELETE',
    url: '/api/v1/routes/no-such-route-here',
    headers: { 'x-edit-token': TOKEN, ...headers },
    ...(remoteAddress ? { remoteAddress } : {}),
  });

const geocoder: GeocodingProvider = {
  suggest: async () => [],
  resolve: async () => null,
};

describe('route writes', () => {
  it('count per address whatever device id they carry: the 21st POST in a minute is 429', async () => {
    api = await setupApi({ writeRateLimitPerMinute: 20 });
    const create = (i: number, remoteAddress?: string) =>
      app().inject({
        method: 'POST',
        url: '/api/v1/routes',
        headers: { 'x-edit-token': TOKEN, 'x-device-id': randomUUID() },
        payload: { spec: userRoute(`ruta-${i}-abcdefghij`), contents: {} },
        ...(remoteAddress ? { remoteAddress } : {}),
      });
    for (let i = 0; i < 20; i++) expect((await create(i)).statusCode).toBe(201);
    const limited = await create(20);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
    // Someone else is not affected.
    expect((await create(21, '203.0.113.9')).statusCode).toBe(201);
  });

  it('key on the address Traefik adds, never on X-Forwarded-For entries a client writes', async () => {
    api = await setupApi({ writeRateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await write({ 'x-forwarded-for': `10.9.${i}.1, 198.51.100.7` })).statusCode).toBe(
        404,
      );
    }
    expect((await write({ 'x-forwarded-for': '192.0.2.200, 198.51.100.7' })).statusCode).toBe(429);
    expect((await write({ 'x-forwarded-for': '198.51.100.8' })).statusCode).toBe(404);

    // A client reaching the API directly can't pick its key either.
    for (let i = 0; i < 3; i++) {
      const res = await write({ 'x-forwarded-for': `192.0.2.${i}` }, '203.0.113.5');
      expect(res.statusCode).toBe(404);
    }
    expect((await write({ 'x-forwarded-for': '192.0.2.99' }, '203.0.113.5')).statusCode).toBe(429);
  });

  it('also have a daily budget', async () => {
    api = await setupApi({ writeRateLimitPerMinute: 100, writeRateLimitPerDay: 3 });
    for (let i = 0; i < 3; i++) expect((await write()).statusCode).toBe(404);
    const limited = await write();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(3600);
  });

  it('include owner reads of a user route, not public reads', async () => {
    api = await setupApi({ writeRateLimitPerMinute: 2 });
    await seedCuratedRoutes(api.db, CURATED);
    for (let i = 0; i < 4; i++) {
      const res = await app().inject({ method: 'GET', url: '/api/v1/routes/leiria-historica' });
      expect(res.statusCode).toBe(200);
    }
    const ownerRead = () =>
      app().inject({
        method: 'GET',
        url: '/api/v1/routes/my-route-abcdefghij',
        headers: { 'x-edit-token': TOKEN },
      });
    expect((await ownerRead()).statusCode).toBe(404);
    expect((await ownerRead()).statusCode).toBe(404);
    expect((await ownerRead()).statusCode).toBe(429);
  });
});

describe('place search', () => {
  it('counts suggest and resolve together, per address', async () => {
    api = await setupApi({ geoRateLimitPerMinute: 2 }, { geocoder });
    const suggest = (remoteAddress?: string) =>
      app().inject({
        method: 'GET',
        url: '/api/v1/geo/suggest?q=castelo',
        headers: { 'x-device-id': randomUUID() },
        ...(remoteAddress ? { remoteAddress } : {}),
      });
    expect((await suggest()).statusCode).toBe(200);
    expect(
      (await app().inject({ method: 'GET', url: '/api/v1/geo/resolve?key=wikidata:Q1' }))
        .statusCode,
    ).toBe(404);
    const limited = await suggest();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect((await suggest('203.0.113.9')).statusCode).toBe(200);
  });
});

describe('trustProxyHop', () => {
  it('trusts one hop, and only from loopback or a private network', () => {
    for (const address of ['127.0.0.1', '::1', '10.0.1.5', '172.18.0.3', '192.168.1.2']) {
      expect(trustProxyHop(address, 0)).toBe(true);
    }
    expect(trustProxyHop('::ffff:10.0.0.2', 0)).toBe(true);
    expect(trustProxyHop('fd12:3456::1', 0)).toBe(true);
    expect(trustProxyHop('203.0.113.5', 0)).toBe(false);
    expect(trustProxyHop('2001:db8::1', 0)).toBe(false);
    expect(trustProxyHop('10.0.0.1', 1)).toBe(false);
    expect(trustProxyHop(undefined, 0)).toBe(false);
  });
});
