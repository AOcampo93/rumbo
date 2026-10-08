import { createHash } from 'node:crypto';
import type { RouteSpec } from '@rumbo/route-spec';
import { validateRouteBundle } from '@rumbo/route-spec';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devices, routes, runs } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { ROUTES_PER_DEVICE } from '../src/routes/routes.js';
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

// POST, PUT and DELETE /routes and the owner-only reads of user routes, on a
// real database that holds the curated route.

const ID = 'leiria-a-pe-abc123defg';

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

type Headers = Record<string, string>;
const owner: Headers = { 'x-edit-token': TOKEN, 'x-device-id': DEVICE };
const stranger: Headers = { 'x-edit-token': OTHER_TOKEN, 'x-device-id': OTHER_DEVICE };
const bundle = (spec: RouteSpec = userRoute(), contents: unknown = {}) => ({ spec, contents });

const post = (payload: unknown, headers: Headers = owner) =>
  api.app.inject({ method: 'POST', url: '/api/v1/routes', payload: payload as object, headers });
const put = (id: string, payload: unknown, headers: Headers = { 'x-edit-token': TOKEN }) =>
  api.app.inject({
    method: 'PUT',
    url: `/api/v1/routes/${id}`,
    payload: payload as object,
    headers,
  });
const remove = (id: string, headers: Headers = { 'x-edit-token': TOKEN }) =>
  api.app.inject({ method: 'DELETE', url: `/api/v1/routes/${id}`, headers });
const get = (id: string, headers: Headers = {}) =>
  api.app.inject({ method: 'GET', url: `/api/v1/routes/${id}`, headers });
const row = async (id = ID) => (await api.db.select().from(routes).where(eq(routes.id, id)))[0];

/** The route renamed, as the creator saves an edit. */
const renamed = (name: string, id = ID) => userRoute(id, name);

describe('POST /api/v1/routes', () => {
  it('stores a user route for its device, keeping only the hash of its token', async () => {
    const spec = userRoute();
    const res = await post(bundle(spec), { ...owner, 'user-agent': 'Mozilla/5.0 (Android 15)' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ id: ID, updatedAt: expect.any(String) });
    expect(Date.parse(body.updatedAt)).not.toBeNaN();
    const stored = await row();
    expect(stored).toMatchObject({
      spec,
      source: 'user',
      status: 'published',
      ownerDeviceId: DEVICE,
      editTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
      name: 'Leiria a pé',
      pointCount: 3,
      locale: 'pt',
    });
    expect(stored?.updatedAt.toISOString()).toBe(body.updatedAt);
    const [device] = await api.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(device?.platform).toBe('android');
  });

  it('updates the route when its owner repeats the POST (a lost 201): 200', async () => {
    const first = await post(bundle());
    const again = await post(bundle(renamed('Leiria ao fim da tarde')));
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(ID);
    expect(Date.parse(again.json().updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(first.json().updatedAt),
    );
    expect(await row()).toMatchObject({ name: 'Leiria ao fim da tarde', ownerDeviceId: DEVICE });
    expect(await api.db.select().from(routes).where(eq(routes.source, 'user'))).toHaveLength(1);
  });

  it('gives one 201 and one 200 to two identical POSTs racing each other', async () => {
    const answers = await Promise.all([post(bundle()), post(bundle())]);
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 201]);
  });

  it('refuses an id taken by someone else or by a curated route: 409 route_exists', async () => {
    await post(bundle());
    const taken = await post(bundle(renamed('Outra')), stranger);
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ code: 'route_exists' });
    expect(await row()).toMatchObject({ name: 'Leiria a pé', ownerDeviceId: DEVICE });

    const curated = await post(bundle(userRoute('leiria-historica', 'Mi Leiria')));
    expect(curated.statusCode).toBe(409);
    expect(curated.json()).toEqual({ code: 'route_exists' });
    expect(await row('leiria-historica')).toMatchObject({ source: 'curated', ownerDeviceId: null });
  });

  it('authenticates before reading the body: 401 missing_edit_token, then 400 missing_device_id', async () => {
    const noToken = await post({ not: 'a route' }, { 'x-device-id': DEVICE });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toEqual({ code: 'missing_edit_token' });
    const huge = { spec: { meta: { blob: 'x'.repeat(200 * 1024) } } };
    expect((await post(huge, { 'x-device-id': DEVICE })).statusCode).toBe(401);
    const malformed = await post(bundle(), { 'x-edit-token': 'short', 'x-device-id': DEVICE });
    expect(malformed.json()).toEqual({ code: 'missing_edit_token' });
    const noDevice = await post(bundle(), { 'x-edit-token': TOKEN });
    expect(noDevice.statusCode).toBe(400);
    expect(noDevice.json()).toEqual({ code: 'missing_device_id' });
    expect(await row()).toBeUndefined();
  });

  it('refuses bodies over 128 KiB with payload_too_large', async () => {
    const spec = { ...userRoute(), meta: { blob: 'x'.repeat(130 * 1024) } };
    const res = await post(bundle(spec as RouteSpec));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ code: 'payload_too_large' });
  });

  it('answers 400 validation_failed for a body that is not a route envelope', async () => {
    for (const payload of [{ ...bundle(), extra: true }, { contents: {} }, [bundle()]]) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });

  it('answers 422 invalid_route, with where, for a route the app would refuse', async () => {
    const res = await post(bundle({ ...userRoute(), points: [] }));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'invalid_route',
      details: [{ path: 'spec.points', message: expect.any(String) }],
    });
    const empty = await post({ spec: null, contents: {} });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().code).toBe('invalid_route');
  });

  it('answers 422 for anything the creator never writes', async () => {
    const spec = userRoute();
    const [first, second] = spec.points.map((point) => point.position);
    const res = await post(
      bundle(
        {
          ...spec,
          path: [first, second],
          coverImage: { url: 'https://example.com/cover.jpg', alt: 'Leiria' },
        } as RouteSpec,
        { castelo: {} },
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_route');
    expect(res.json().details.map((detail: { path: string }) => detail.path)).toEqual(
      expect.arrayContaining(['contents', 'spec.path', 'spec.coverImage']),
    );
    const curated = await post(bundle({ ...spec, source: 'curated' }));
    expect(curated.statusCode).toBe(422);
    expect(curated.json().details).toEqual([{ path: 'spec.source', message: 'Must be "user"' }]);
  });

  it('lists at most 20 problems', async () => {
    const points = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, order: i + 1 }));
    const res = await post(bundle({ ...userRoute(), points } as unknown as RouteSpec));
    expect(res.statusCode).toBe(422);
    expect(res.json().details).toHaveLength(20);
  });

  it('answers 422 for values the database cannot store (an estimate past the integer range)', async () => {
    const spec = { ...userRoute(), settings: { expectedSpeed: 1e-9 } };
    const res = await post(bundle(spec));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'invalid_route' });
    expect(await row()).toBeUndefined();
  });

  it(`keeps at most ${ROUTES_PER_DEVICE} routes per device (409 quota_exceeded), its own repeats aside`, async () => {
    for (let i = 0; i < ROUTES_PER_DEVICE; i++) {
      const res = await post(bundle(userRoute(`ruta-${i}-abcdefghij`)));
      expect(res.statusCode).toBe(201);
    }
    const one = await post(bundle(userRoute('una-mas-abcdefghij')));
    expect(one.statusCode).toBe(409);
    expect(one.json()).toEqual({ code: 'quota_exceeded' });
    expect((await post(bundle(userRoute('ruta-7-abcdefghij', 'Otra')))).statusCode).toBe(200);
    expect((await post(bundle(userRoute('una-mas-abcdefghij')), stranger)).statusCode).toBe(201);
  });

  it('answers 503 unavailable once the server holds USER_ROUTES_MAX user routes', async () => {
    const small = await setupApi({ userRoutesMax: 2 });
    try {
      const send = (id: string, headers: Headers) =>
        small.app.inject({
          method: 'POST',
          url: '/api/v1/routes',
          payload: bundle(userRoute(id)),
          headers,
        });
      expect((await send('ruta-a-abcdefghij', owner)).statusCode).toBe(201);
      expect((await send('ruta-b-abcdefghij', stranger)).statusCode).toBe(201);
      const full = await send('ruta-c-abcdefghij', owner);
      expect(full.statusCode).toBe(503);
      expect(full.json()).toEqual({ code: 'unavailable' });
      expect((await send('ruta-a-abcdefghij', owner)).statusCode).toBe(200);
    } finally {
      await small.close();
    }
  });
});

describe('PUT /api/v1/routes/:id', () => {
  it("replaces the route's spec and listing columns: 200", async () => {
    const created = (await post(bundle())).json();
    const two = userRoute(ID, 'Leiria em duas paragens');
    two.points = two.points.slice(0, 2);
    const res = await put(ID, bundle(two));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ID, updatedAt: expect.any(String) });
    expect(Date.parse(res.json().updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
    expect(await row()).toMatchObject({
      spec: two,
      name: 'Leiria em duas paragens',
      pointCount: 2,
      ownerDeviceId: DEVICE,
      source: 'user',
    });
  });

  it('answers 404 for a missing route, 403 for another token or a curated route', async () => {
    const missing = await put(ID, bundle());
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'route_not_found' });

    await post(bundle());
    const wrong = await put(ID, bundle(renamed('Minha')), { 'x-edit-token': OTHER_TOKEN });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ code: 'forbidden' });
    expect((await row())?.name).toBe('Leiria a pé');

    const curated = await put('leiria-historica', bundle(userRoute('leiria-historica')));
    expect(curated.statusCode).toBe(403);
    expect(curated.json()).toEqual({ code: 'forbidden' });
    expect((await row('leiria-historica'))?.source).toBe('curated');
  });

  it('answers 400 route_id_mismatch when the body is another route', async () => {
    await post(bundle());
    const res = await put(ID, bundle(userRoute('otra-ruta-abcdefghij')));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'route_id_mismatch' });
  });

  it('answers 401 without its token and 422 for an invalid route', async () => {
    await post(bundle());
    expect((await put(ID, bundle(), {})).json()).toEqual({ code: 'missing_edit_token' });
    const invalid = await put(ID, bundle({ ...userRoute(), mode: 'race' } as unknown as RouteSpec));
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe('invalid_route');
  });
});

describe('DELETE /api/v1/routes/:id', () => {
  it('deletes the route with its runs; then every verb answers 404', async () => {
    await post(bundle());
    const run = await api.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'x-device-id': DEVICE },
      payload: {
        routeId: ID,
        specHash: 'f'.repeat(64),
        mode: 'free',
        simulated: false,
        locale: 'pt',
        startedAt: '2026-10-08T09:00:00.000Z',
      },
    });
    expect(run.statusCode).toBe(201);

    const res = await remove(ID);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await row()).toBeUndefined();
    expect(await api.db.select().from(runs).where(eq(runs.routeId, ID))).toEqual([]);

    expect((await get(ID, { 'x-edit-token': TOKEN })).statusCode).toBe(404);
    const after = await put(ID, bundle());
    expect(after.statusCode).toBe(404);
    expect(after.json()).toEqual({ code: 'route_not_found' });
    expect((await remove(ID)).json()).toEqual({ code: 'route_not_found' });
  });

  it('answers 403 for another token or a curated route, and keeps them', async () => {
    await post(bundle());
    expect((await remove(ID, { 'x-edit-token': OTHER_TOKEN })).json()).toEqual({
      code: 'forbidden',
    });
    expect((await remove('leiria-historica')).statusCode).toBe(403);
    expect((await remove(ID, {})).statusCode).toBe(401);
    expect(await row()).toBeDefined();
    expect(await row('leiria-historica')).toBeDefined();
  });

  it('settles a PUT racing a DELETE: the route ends deleted', async () => {
    await post(bundle());
    const [updated, deleted] = await Promise.all([put(ID, bundle(renamed('Nova'))), remove(ID)]);
    expect(deleted.statusCode).toBe(204);
    expect([200, 404]).toContain(updated.statusCode);
    expect(await row()).toBeUndefined();
  });
});

describe('reading user routes', () => {
  it('never lists them', async () => {
    await post(bundle());
    const list = await api.app.inject({ method: 'GET', url: '/api/v1/routes' });
    expect(list.json().map((route: { id: string }) => route.id)).toEqual(['leiria-historica']);
  });

  it('answers only their owner, before any 304, and never caches them in shared caches', async () => {
    const spec = userRoute();
    await post(bundle(spec));
    const missing = await get('no-such-route');
    const strangers: Headers[] = [{}, { 'x-edit-token': OTHER_TOKEN }, { 'x-edit-token': 'short' }];
    for (const headers of strangers) {
      const res = await get(ID, headers);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(missing.json());
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.etag).toBeUndefined();
    }

    const mine = await get(ID, { 'x-edit-token': TOKEN });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect(mine.json()).toEqual({ spec, contents: {} });
    expect(validateRouteBundle(mine.json()).errors).toEqual([]);

    const etag = mine.headers.etag as string;
    expect((await get(ID, { 'if-none-match': etag })).statusCode).toBe(404);
    expect((await get(ID, { 'if-none-match': etag, 'x-edit-token': TOKEN })).statusCode).toBe(304);
  });

  it('keeps curated routes public', async () => {
    const res = await get('leiria-historica', { 'x-edit-token': TOKEN });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });
});
