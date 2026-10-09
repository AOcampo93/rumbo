import { RouteSummarySchema } from '@rumbo/api-contract';
import { distance, type LatLng } from '@rumbo/geo-utils';
import { type RouteSpec, validateRouteBundle } from '@rumbo/route-spec';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import {
  type Api,
  awayFrom,
  create,
  type Headers,
  moveTo,
  owner,
  publish,
  read,
  replace,
  routeAround,
  routeRow,
  status,
} from './community-helpers.js';
import {
  CURATED,
  DEVICE,
  OTHER_DEVICE,
  OTHER_TOKEN,
  resetDatabase,
  setupApi,
  TOKEN,
  userRoute,
} from './helpers.js';

// Phase 7.2, ADR 0004: a user route is private unless its owner publishes it.
// What is public is listed around `near`, read by anyone, and reported (see
// route-reports.test.ts); what is hidden or blocked is served to its owner only.

const ID = 'leiria-a-pe-abc123defg';
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');
/** Far from Leiria, so the curated route is never among the nearby ones. */
const PORTO: LatLng = { lat: 41.15, lng: -8.61 };

let api: Api;
beforeAll(async () => {
  api = await setupApi({ rateLimitPerMinute: 100_000 });
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

const near = (position: LatLng) => `near=${position.lat},${position.lng}`;
const list = (query = '') => api.app.inject({ method: 'GET', url: `/api/v1/routes${query}` });
const idsOf = (res: { json: () => Array<{ id: string }> }) => res.json().map((route) => route.id);
const moderate = (id: string, moderation: 'visible' | 'hidden' | 'blocked') =>
  api.db.update(routes).set({ moderation, moderatedAt: new Date() }).where(eq(routes.id, id));

describe('publishing a route', () => {
  it('keeps a route private unless its POST says public', async () => {
    const res = await create(api, ID);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: ID,
      updatedAt: expect.any(String),
      visibility: 'private',
      moderation: 'visible',
    });
    expect(await routeRow(api, ID)).toMatchObject({
      visibility: 'private',
      moderation: 'visible',
      publishedAt: null,
      moderatedAt: null,
    });
  });

  it('publishes it when the POST says public, and stamps the date', async () => {
    const before = Date.now();
    const res = await create(api, ID, { visibility: 'public' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: ID, visibility: 'public', moderation: 'visible' });
    const stored = await routeRow(api, ID);
    expect(stored).toMatchObject({
      visibility: 'public',
      moderation: 'visible',
      moderatedAt: null,
    });
    expect(stored?.publishedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored?.publishedAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('leaves the visibility alone when a PUT does not say', async () => {
    await create(api, 'ruta-publica-abcdefghij', { visibility: 'public' });
    await create(api, 'ruta-privada-abcdefghij');
    await api.db
      .update(routes)
      .set({ publishedAt: LONG_AGO })
      .where(eq(routes.visibility, 'public'));

    const publicOne = await replace(api, 'ruta-publica-abcdefghij');
    expect(publicOne.statusCode).toBe(200);
    expect(publicOne.json()).toMatchObject({ visibility: 'public', moderation: 'visible' });
    expect(await routeRow(api, 'ruta-publica-abcdefghij')).toMatchObject({
      visibility: 'public',
      publishedAt: LONG_AGO,
    });

    const privateOne = await replace(api, 'ruta-privada-abcdefghij');
    expect(privateOne.json()).toMatchObject({ visibility: 'private', moderation: 'visible' });
    expect(await routeRow(api, 'ruta-privada-abcdefghij')).toMatchObject({
      visibility: 'private',
      publishedAt: null,
    });
  });

  it('stamps the date when a PUT takes a route from private to public, and only then', async () => {
    await create(api, ID);
    const before = Date.now();
    const published = await replace(api, ID, { visibility: 'public' });
    expect(published.json()).toMatchObject({ visibility: 'public' });
    const first = (await routeRow(api, ID))?.publishedAt;
    expect(first?.getTime()).toBeGreaterThanOrEqual(before);

    // Public again, or still: the date is that of the last time it went public.
    await api.db.update(routes).set({ publishedAt: LONG_AGO }).where(eq(routes.id, ID));
    await replace(api, ID, { visibility: 'public' });
    expect((await routeRow(api, ID))?.publishedAt).toEqual(LONG_AGO);

    // Withdrawing keeps the date; publishing again stamps a new one.
    const withdrawn = await replace(api, ID, { visibility: 'private' });
    expect(withdrawn.json()).toMatchObject({ visibility: 'private' });
    expect(await routeRow(api, ID)).toMatchObject({ visibility: 'private', publishedAt: LONG_AGO });
    await replace(api, ID, { visibility: 'public' });
    const again = (await routeRow(api, ID))?.publishedAt;
    expect(again?.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it('takes a repeated POST as the whole route again: it is private unless it says public', async () => {
    await create(api, ID, { visibility: 'public' });
    await api.db.update(routes).set({ publishedAt: LONG_AGO }).where(eq(routes.id, ID));

    const same = await create(api, ID, { visibility: 'public' });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ visibility: 'public' });
    expect((await routeRow(api, ID))?.publishedAt).toEqual(LONG_AGO);

    const silent = await create(api, ID);
    expect(silent.statusCode).toBe(200);
    expect(silent.json()).toMatchObject({ visibility: 'private' });
    expect(await routeRow(api, ID)).toMatchObject({ visibility: 'private', publishedAt: LONG_AGO });
  });

  it.each(['hidden', 'blocked'] as const)(
    'never unhides a %s route, however its owner publishes it',
    async (moderation) => {
      await publish(api, ID);
      const moderatedAt = new Date('2026-10-01T10:00:00.000Z');
      await api.db.update(routes).set({ moderation, moderatedAt }).where(eq(routes.id, ID));

      for (const visibility of ['private', 'public', undefined] as const) {
        const res = await replace(api, ID, { visibility });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ moderation });
        expect(await routeRow(api, ID)).toMatchObject({ moderation, moderatedAt });
      }
      const repeated = await create(api, ID, { visibility: 'public' });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json()).toMatchObject({ visibility: 'public', moderation });
      expect(await routeRow(api, ID)).toMatchObject({ moderation, moderatedAt });
    },
  );

  it('refuses a visibility that is not private or public, and stores nothing', async () => {
    for (const visibility of ['friends', 'PUBLIC', '', null, 1, true]) {
      const body = { spec: userRoute(ID), contents: {}, visibility };
      const post = await api.app.inject({
        method: 'POST',
        url: '/api/v1/routes',
        headers: owner,
        payload: body,
      });
      expect(post.statusCode, String(visibility)).toBe(400);
      expect(post.json().code).toBe('validation_failed');
    }
    expect(await routeRow(api, ID)).toBeUndefined();

    await create(api, ID);
    const put = await api.app.inject({
      method: 'PUT',
      url: `/api/v1/routes/${ID}`,
      headers: { 'x-edit-token': TOKEN },
      payload: { spec: userRoute(ID), contents: {}, visibility: 'friends' },
    });
    expect(put.statusCode).toBe(400);
    expect((await routeRow(api, ID))?.visibility).toBe('private');
  });

  it('checks the route as it always did when the body also says public', async () => {
    const broken = { ...userRoute(ID), points: [] } as unknown as RouteSpec;
    const res = await create(api, ID, { visibility: 'public', spec: broken });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'invalid_route',
      details: [{ path: 'spec.points', message: expect.any(String) }],
    });
    expect(await routeRow(api, ID)).toBeUndefined();

    await create(api, ID);
    const put = await replace(api, ID, { visibility: 'public', spec: broken });
    expect(put.statusCode).toBe(422);
    expect(await routeRow(api, ID)).toMatchObject({ visibility: 'private', publishedAt: null });
  });

  it('answers a stranger’s PUT with 403 and leaves the visibility', async () => {
    await publish(api, ID);
    const res = await replace(api, ID, {
      headers: { 'x-edit-token': OTHER_TOKEN },
      visibility: 'private',
    });
    expect(res.statusCode).toBe(403);
    expect((await routeRow(api, ID))?.visibility).toBe('public');
  });
});

describe('GET /api/v1/routes', () => {
  it('lists only the curated routes without `near`, public routes or not', async () => {
    await publish(api, 'ruta-publica-abcdefghij');
    await moveTo(api, 'ruta-publica-abcdefghij', PORTO);
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual(['leiria-historica']);
    expect(idsOf(await list('?mode=free'))).toEqual(['leiria-historica']);
  });

  it('adds the public routes within 30 km of `near`, nearest first, after the curated one by distance', async () => {
    await publish(api, 'ruta-lejos-abcdefghij');
    await publish(api, 'ruta-cerca-abcdefghij');
    await publish(api, 'ruta-fuera-abcdefghij');
    await moveTo(api, 'ruta-lejos-abcdefghij', awayFrom(PORTO, 200, 25_000));
    await moveTo(api, 'ruta-cerca-abcdefghij', awayFrom(PORTO, 10, 5_000));
    await moveTo(api, 'ruta-fuera-abcdefghij', awayFrom(PORTO, 90, 40_000));

    const res = await list(`?${near(PORTO)}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(idsOf(res)).toEqual([
      'ruta-cerca-abcdefghij',
      'ruta-lejos-abcdefghij',
      'leiria-historica',
    ]);
  });

  it('sorts the curated routes among the community ones by distance', async () => {
    const [leiria] = await api.db.select().from(routes).where(eq(routes.id, 'leiria-historica'));
    const centre = { lat: leiria!.centroidLat, lng: leiria!.centroidLng };
    // About 500 m from the curated route, as the app rounds it.
    const there = awayFrom(centre, 0, 500);
    const position = {
      lat: Math.round(there.lat * 1000) / 1000,
      lng: Math.round(there.lng * 1000) / 1000,
    };
    const curated = distance(position, centre);
    expect(curated).toBeGreaterThan(300);
    expect(curated).toBeLessThan(700);

    await publish(api, 'ruta-primera-abcdefghij');
    await publish(api, 'ruta-segunda-abcdefghij');
    await publish(api, 'ruta-tercera-abcdefghij');
    await moveTo(api, 'ruta-primera-abcdefghij', awayFrom(position, 90, 100));
    await moveTo(api, 'ruta-segunda-abcdefghij', awayFrom(position, 90, 2_000));
    await moveTo(api, 'ruta-tercera-abcdefghij', awayFrom(position, 90, 20_000));

    expect(idsOf(await list(`?${near(position)}`))).toEqual([
      'ruta-primera-abcdefghij',
      'leiria-historica',
      'ruta-segunda-abcdefghij',
      'ruta-tercera-abcdefghij',
    ]);
  });

  it('never lists a private, hidden or blocked route', async () => {
    await publish(api, 'ruta-publica-abcdefghij');
    await create(api, 'ruta-privada-abcdefghij');
    await publish(api, 'ruta-oculta-abcdefghij');
    await publish(api, 'ruta-bloqueada-abcdefghij');
    await moderate('ruta-oculta-abcdefghij', 'hidden');
    await moderate('ruta-bloqueada-abcdefghij', 'blocked');
    for (const id of [
      'ruta-publica-abcdefghij',
      'ruta-privada-abcdefghij',
      'ruta-oculta-abcdefghij',
      'ruta-bloqueada-abcdefghij',
    ]) {
      await moveTo(api, id, awayFrom(PORTO, 0, 1_000));
    }
    expect(idsOf(await list(`?${near(PORTO)}`))).toEqual([
      'ruta-publica-abcdefghij',
      'leiria-historica',
    ]);
  });

  it('stops listing a route when its owner withdraws it or deletes it', async () => {
    await publish(api, 'ruta-publica-abcdefghij');
    await publish(api, ID);
    await moveTo(api, 'ruta-publica-abcdefghij', awayFrom(PORTO, 0, 1_000));
    await moveTo(api, ID, awayFrom(PORTO, 90, 1_000));
    expect(idsOf(await list(`?${near(PORTO)}`))).toHaveLength(3);

    await replace(api, ID, { visibility: 'private' });
    expect(idsOf(await list(`?${near(PORTO)}`))).toEqual([
      'ruta-publica-abcdefghij',
      'leiria-historica',
    ]);
    await api.app.inject({
      method: 'DELETE',
      url: '/api/v1/routes/ruta-publica-abcdefghij',
      headers: { 'x-edit-token': TOKEN },
    });
    expect(idsOf(await list(`?${near(PORTO)}`))).toEqual(['leiria-historica']);
  });

  it('lists a route made in the app by where its places are', async () => {
    const spec = routeAround('ruta-en-oporto-abcdefghij', PORTO, { name: 'Oporto a pie' });
    const res = await create(api, spec.id, { spec, visibility: 'public' });
    expect(res.statusCode).toBe(201);
    const found = (await list(`?${near(PORTO)}`)).json();
    expect(found[0]).toMatchObject({
      id: spec.id,
      name: 'Oporto a pie',
      source: 'user',
      pointCount: 3,
    });
    expect(distance(PORTO, found[0].centroid)).toBeLessThan(100);
    // Another city doesn't see it.
    expect(idsOf(await list(`?${near({ lat: 38.72, lng: -9.14 })}`))).toEqual(['leiria-historica']);
  });

  const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
  const PLACES: Array<[string, LatLng]> = [
    ['Porto', PORTO],
    ['Tromsø', { lat: 69.65, lng: 18.96 }],
    ['the antimeridian', { lat: 0, lng: 179.995 }],
    ['the north pole', { lat: 89.9, lng: 0 }],
  ];
  it.each(PLACES)(
    'lists the routes within 30 km in every direction, and no others (%s)',
    async (_place, centre) => {
      const inside: string[] = [];
      for (const [i, bearing] of BEARINGS.entries()) {
        const near30 = `dentro-${i}-abcdefghij`;
        const far30 = `fuera-${i}-abcdefghij`;
        await publish(api, near30);
        await publish(api, far30);
        await moveTo(api, near30, awayFrom(centre, bearing, 29_900));
        await moveTo(api, far30, awayFrom(centre, bearing, 30_100));
        inside.push(near30);
      }
      const res = await list(`?${near(centre)}`);
      expect(new Set(idsOf(res))).toEqual(new Set([...inside, 'leiria-historica']));
    },
  );

  it('lists the 20 nearest community routes and no more', async () => {
    for (let n = 1; n <= 25; n++) {
      const id = `ruta-${String(n).padStart(2, '0')}-abcdefghij`;
      await publish(api, id);
      await moveTo(api, id, awayFrom(PORTO, (n * 37) % 360, n * 1_000));
    }
    const res = await list(`?${near(PORTO)}`);
    const expected = Array.from(
      { length: 20 },
      (_, i) => `ruta-${String(i + 1).padStart(2, '0')}-abcdefghij`,
    );
    expect(idsOf(res)).toEqual([...expected, 'leiria-historica']);
  });

  it('applies the filters to the community routes, before it keeps the 20 nearest', async () => {
    for (let n = 1; n <= 22; n++) {
      const id = `paseo-${String(n).padStart(2, '0')}-abcdefghij`;
      await publish(api, id, { spec: routeAround(id, PORTO, { name: `Paseo ${n}` }) });
      await moveTo(api, id, awayFrom(PORTO, 0, n * 500));
    }
    const bike = routeAround('ruta-bici-abcdefghij', PORTO, {
      name: 'Praia de bicicleta',
      activity: 'bike',
    });
    await publish(api, bike.id, { spec: bike });
    await moveTo(api, bike.id, awayFrom(PORTO, 180, 25_000));
    const challenge = routeAround('reto-abcdefghij', PORTO, {
      name: 'Reto del puerto',
      mode: 'challenge',
    });
    await publish(api, challenge.id, { spec: challenge });
    await moveTo(api, challenge.id, awayFrom(PORTO, 90, 26_000));

    expect(idsOf(await list(`?${near(PORTO)}&activity=bike`))).toEqual([bike.id]);
    expect(idsOf(await list(`?${near(PORTO)}&mode=challenge`))).toEqual([challenge.id]);
    // The text search ignores accents and case, in the community routes too.
    expect(idsOf(await list(`?${near(PORTO)}&q=${encodeURIComponent('PRAÍA')}`))).toEqual([
      bike.id,
    ]);
    expect(idsOf(await list(`?${near(PORTO)}&q=reto`))).toEqual([challenge.id]);
    expect(idsOf(await list(`?${near(PORTO)}&q=nada`))).toEqual([]);
    // Without the filters, the 20 nearest.
    expect(idsOf(await list(`?${near(PORTO)}&activity=walk&mode=free`)).slice(0, 20)).toEqual(
      Array.from({ length: 20 }, (_, i) => `paseo-${String(i + 1).padStart(2, '0')}-abcdefghij`),
    );
  });

  it('says nothing of the owner in a summary', async () => {
    await publish(api, ID);
    await moveTo(api, ID, awayFrom(PORTO, 0, 1_000));
    const res = await list(`?${near(PORTO)}`);
    const [mine, curated] = res.json();
    expect(mine.id).toBe(ID);
    for (const summary of [mine, curated]) {
      expect(RouteSummarySchema.safeParse(summary).success).toBe(true);
      expect(Object.keys(summary).every((key) => key in RouteSummarySchema.shape)).toBe(true);
    }
    const stored = await routeRow(api, ID);
    expect(res.body).not.toContain(DEVICE);
    expect(res.body).not.toContain(stored?.editTokenHash as string);
    expect(res.body).not.toContain('owner');
    expect(res.body).not.toContain('visibility');
    expect(res.body).not.toContain('moderation');
  });

  it('validates `near` as before', async () => {
    const res = await list('?near=paris');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
  });
});

describe('GET /api/v1/routes/:id of a community route', () => {
  it('is served to anyone without a token, cacheable, with its ETag', async () => {
    const spec = userRoute(ID);
    await publish(api, ID);
    const readers: Headers[] = [
      {},
      { 'x-edit-token': OTHER_TOKEN },
      { 'x-device-id': OTHER_DEVICE },
    ];
    for (const headers of readers) {
      const res = await read(api, ID, headers);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.json()).toEqual({ spec, contents: {} });
      expect(validateRouteBundle(res.json()).errors).toEqual([]);
    }
    const first = await read(api, ID);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{16}-\d+"$/);
    const unchanged = await read(api, ID, { 'if-none-match': etag });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');

    // Edited, it has another ETag: the old one no longer says "unchanged".
    await replace(api, ID, { spec: userRoute(ID, 'Leiria ao fim da tarde') });
    const edited = await read(api, ID, { 'if-none-match': etag });
    expect(edited.statusCode).toBe(200);
    expect(edited.headers.etag).not.toBe(etag);
  });

  it('is private to its owner when it is not public, hidden or blocked', async () => {
    const spec = userRoute(ID);
    const missing = await read(api, 'no-such-route');
    const strangers: Headers[] = [{}, { 'x-edit-token': OTHER_TOKEN }, { 'x-edit-token': 'short' }];
    const states = [
      ['private', () => create(api, ID)],
      [
        'hidden',
        async () => {
          await publish(api, ID);
          await moderate(ID, 'hidden');
        },
      ],
      [
        'blocked',
        async () => {
          await publish(api, ID);
          await moderate(ID, 'blocked');
        },
      ],
      [
        'withdrawn',
        async () => {
          await publish(api, ID);
          await replace(api, ID, { visibility: 'private' });
        },
      ],
    ] as const;
    for (const [state, prepare] of states) {
      await resetDatabase(api.database);
      await prepare();
      const mine = await read(api, ID, { 'x-edit-token': TOKEN });
      expect(mine.statusCode, state).toBe(200);
      expect(mine.headers['cache-control'], state).toBe('private, no-store');
      expect(mine.json(), state).toEqual({ spec, contents: {} });
      const etag = mine.headers.etag as string;

      for (const headers of strangers) {
        const conditionals: Headers[] = [{}, { 'if-none-match': etag }];
        for (const conditional of conditionals) {
          const res = await read(api, ID, { ...headers, ...conditional });
          expect(res.statusCode, state).toBe(404);
          expect(res.json(), state).toEqual(missing.json());
          expect(res.headers['cache-control'], state).toBe('no-store');
          expect(res.headers.etag, state).toBeUndefined();
        }
      }
      expect(
        (await read(api, ID, { 'x-edit-token': TOKEN, 'if-none-match': etag })).statusCode,
      ).toBe(304);
    }
  });

  it('is not cached by shared caches when its owner reads it with the token', async () => {
    await publish(api, ID);
    const res = await read(api, ID, { 'x-edit-token': TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('is served again when the route is restored', async () => {
    await publish(api, ID);
    await moderate(ID, 'hidden');
    expect((await read(api, ID)).statusCode).toBe(404);
    await moderate(ID, 'visible');
    expect((await read(api, ID)).statusCode).toBe(200);
  });
});

describe('GET /api/v1/routes/:id/status', () => {
  const OWNER_READ = { 'x-edit-token': TOKEN };

  it('tells its owner how visible the route is', async () => {
    await create(api, ID);
    const privateRoute = await status(api, ID);
    expect(privateRoute.statusCode).toBe(200);
    expect(privateRoute.headers['cache-control']).toBe('private, no-store');
    expect(privateRoute.json()).toEqual({
      visibility: 'private',
      moderation: 'visible',
      publishedAt: null,
    });

    await replace(api, ID, { visibility: 'public' });
    const published = (await routeRow(api, ID))?.publishedAt as Date;
    expect((await status(api, ID)).json()).toEqual({
      visibility: 'public',
      moderation: 'visible',
      publishedAt: published.toISOString(),
    });

    await moderate(ID, 'hidden');
    expect((await status(api, ID)).json()).toEqual({
      visibility: 'public',
      moderation: 'hidden',
      publishedAt: published.toISOString(),
    });
    await moderate(ID, 'blocked');
    expect((await status(api, ID)).json()).toMatchObject({
      visibility: 'public',
      moderation: 'blocked',
    });

    // Withdrawn: private, with the date of the last time it was public.
    await replace(api, ID, { visibility: 'private' });
    expect((await status(api, ID)).json()).toEqual({
      visibility: 'private',
      moderation: 'blocked',
      publishedAt: published.toISOString(),
    });
  });

  it('answers 404 route_not_found, as the read does, to anyone else', async () => {
    await publish(api, ID);
    const missing = await read(api, 'no-such-route');
    const cases: Array<[string, string, Record<string, string>]> = [
      ['no token', ID, {}],
      ['another token', ID, { 'x-edit-token': OTHER_TOKEN }],
      ['a malformed token', ID, { 'x-edit-token': 'short' }],
      ['a device id only', ID, { 'x-device-id': DEVICE }],
      ['a curated route', 'leiria-historica', OWNER_READ],
      ['a route that does not exist', 'no-such-route', OWNER_READ],
    ];
    for (const [what, id, headers] of cases) {
      const res = await status(api, id, headers);
      expect(res.statusCode, what).toBe(404);
      expect(res.json(), what).toEqual(missing.json());
      expect(res.headers['cache-control'], what).toBe('no-store');
    }
    expect((await status(api, 'BAD_ID')).json().code).toBe('validation_failed');
  });

  it('answers 404 once the route is deleted', async () => {
    await publish(api, ID);
    await api.app.inject({ method: 'DELETE', url: `/api/v1/routes/${ID}`, headers: OWNER_READ });
    expect((await status(api, ID)).statusCode).toBe(404);
  });

  it('shares the budget of route writes, like the owner’s reads', async () => {
    const small = await setupApi({ writeRateLimitPerMinute: 2 });
    try {
      const ask = () => status(small, ID);
      expect((await ask()).statusCode).toBe(404);
      expect((await ask()).statusCode).toBe(404);
      const limited = await ask();
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ code: 'rate_limited' });
      // Without a token it doesn't count: nobody can use it.
      expect((await status(small, ID, {})).statusCode).toBe(404);
    } finally {
      await small.close();
    }
  });
});
