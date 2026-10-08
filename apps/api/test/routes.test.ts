import { readFileSync } from 'node:fs';
import { validateRouteBundle } from '@rumbo/route-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { CURATED, routesFolder, setupApi } from './helpers.js';

// GET /routes and /routes/:id on a real database seeded with the curated
// route plus a challenge test route.

const challenge = JSON.parse(
  readFileSync(new URL('../../web/e2e/fixtures/e2e-fuera-de-orden.json', import.meta.url), 'utf8'),
) as { spec: { id: string } };

let api: Awaited<ReturnType<typeof setupApi>>;

beforeAll(async () => {
  api = await setupApi();
  await seedCuratedRoutes(api.db, CURATED);
  await seedCuratedRoutes(api.db, await routesFolder({ 'e2e-fuera-de-orden.json': challenge }));
});
afterAll(() => api.close());

const get = (url: string, headers: Record<string, string> = {}) =>
  api.app.inject({ method: 'GET', url, headers });

describe('GET /api/v1/routes', () => {
  it('lists the published routes as RouteSummary', async () => {
    const res = await get('/api/v1/routes');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age');
    const leiria = res.json().find((r: { id: string }) => r.id === 'leiria-historica');
    expect(leiria).toMatchObject({
      name: { es: 'Leiria histórica', en: 'Historic Leiria' },
      mode: 'free',
      activity: 'walk',
      source: 'curated',
      locale: 'pt',
      locales: ['es', 'en', 'pt'],
      pointCount: 12,
    });
    expect(leiria.distanceMeters).toBeGreaterThan(2000);
    expect(leiria.bbox).toHaveLength(4);
    expect(Date.parse(leiria.updatedAt)).not.toBeNaN();
  });

  it('filters by mode and activity', async () => {
    const challenges = await get('/api/v1/routes?mode=challenge');
    expect(challenges.json().map((r: { id: string }) => r.id)).toEqual([challenge.spec.id]);
    expect((await get('/api/v1/routes?activity=bike')).json()).toEqual([]);
  });

  it('searches names and summaries in every language, ignoring accents', async () => {
    const ids = async (q: string) =>
      (await get(`/api/v1/routes?q=${encodeURIComponent(q)}`))
        .json()
        .map((r: { id: string }) => r.id);
    expect(await ids('historic')).toEqual(['leiria-historica']);
    expect(await ids('HISTÓRICA')).toEqual(['leiria-historica']);
    expect(await ids('fora de ordem')).toEqual([challenge.spec.id]);
    expect(await ids('lisboa')).toEqual([]);
  });

  it('sorts by distance with near=lat,lng', async () => {
    const res = await get('/api/v1/routes?near=39.745,-8.807');
    expect(res.json()[0].id).toBe(challenge.spec.id);
  });

  it('refuses bad filters with validation_failed and details', async () => {
    const res = await get('/api/v1/routes?mode=race&near=paris');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.json().details.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/routes/:id', () => {
  it('returns a bundle the app accepts', async () => {
    const res = await get('/api/v1/routes/leiria-historica');
    expect(res.statusCode).toBe(200);
    const validation = validateRouteBundle(res.json());
    expect(validation.errors).toEqual([]);
    expect(validation.bundle?.spec.points).toHaveLength(12);
  });

  it('answers 304 when the client already has this version', async () => {
    const first = await get('/api/v1/routes/leiria-historica');
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{16}-\d+"$/);
    const again = await get('/api/v1/routes/leiria-historica', { 'if-none-match': etag });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('answers route_not_found and validation_failed with codes', async () => {
    const missing = await get('/api/v1/routes/does-not-exist');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'route_not_found' });
    expect((await get('/api/v1/routes/BAD_ID')).json().code).toBe('validation_failed');
  });
});
