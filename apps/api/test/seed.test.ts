import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointContents, routes, runs } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { DEVICE, resetDatabase, routesFolder, setupApi, TOKEN, userRoute } from './helpers.js';

const leiria = JSON.parse(
  readFileSync(new URL('../../../data/routes/leiria-historica.json', import.meta.url), 'utf8'),
) as { spec: Record<string, unknown>; contents: Record<string, unknown> };

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());

const updatedAt = async () =>
  (await api.db.select().from(routes).where(eq(routes.id, 'leiria-historica')))[0]?.updatedAt;

describe('seeding the curated routes', () => {
  it('inserts once and then leaves equal routes alone', async () => {
    const dir = await routesFolder({ 'leiria-historica.json': leiria });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ inserted: ['leiria-historica'] });
    const before = await updatedAt();
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ unchanged: ['leiria-historica'] });
    expect(await updatedAt()).toEqual(before);
  });

  it('replaces a route whose texts changed, with its cards', async () => {
    const before = await updatedAt();
    const card = {
      id: 'castelo',
      locale: 'pt',
      title: 'Castelo de Leiria',
      summary: 'Um castelo sobre a cidade.',
      facts: [],
      images: [],
      sources: [],
      status: 'approved',
    };
    // The card must be referenced by a point to be valid: the castle's.
    const points = (leiria.spec.points as Array<Record<string, unknown>>).map((p) =>
      p.id === 'castelo-de-leiria' ? { ...p, contentRef: 'castelo' } : p,
    );
    const edited = {
      spec: {
        ...leiria.spec,
        points,
        summary: { es: 'Nuevo resumen', en: 'New summary', pt: 'Novo resumo' },
      },
      contents: {
        castelo: { es: { ...card, locale: 'es' }, en: { ...card, locale: 'en' }, pt: card },
      },
    };
    const dir = await routesFolder({ 'leiria-historica.json': edited });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ updated: ['leiria-historica'] });
    expect((await updatedAt())?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
    const cards = await api.db
      .select()
      .from(pointContents)
      .where(eq(pointContents.routeId, 'leiria-historica'));
    expect(cards.map((c) => c.locale).sort()).toEqual(['en', 'es', 'pt']);
  });

  it('skips an invalid file without writing anything', async () => {
    const dir = await routesFolder({ 'broken.json': { spec: { id: 'broken' }, contents: {} } });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ invalid: ['broken.json'] });
    expect(await api.db.select().from(routes).where(eq(routes.id, 'broken'))).toEqual([]);
  });

  it('skips a file whose route is not curated', async () => {
    const spec = userRoute('ruta-de-fichero-abcdefghij');
    const dir = await routesFolder({ 'user.json': { spec, contents: {} } });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ invalid: ['user.json'] });
    expect(await api.db.select().from(routes).where(eq(routes.id, spec.id))).toEqual([]);
  });

  it('replaces a user route holding a curated id, and leaves every other route alone', async () => {
    await resetDatabase(api.database);
    const create = (spec: unknown) =>
      api.app.inject({
        method: 'POST',
        url: '/api/v1/routes',
        headers: { 'x-edit-token': TOKEN, 'x-device-id': DEVICE },
        payload: { spec, contents: {} },
      });
    expect((await create(userRoute('leiria-historica', 'Primeiro'))).statusCode).toBe(201);
    expect((await create(userRoute('mi-ruta-abcdefghij'))).statusCode).toBe(201);
    const run = await api.app.inject({
      method: 'POST',
      url: '/api/v1/runs',
      headers: { 'x-device-id': DEVICE },
      payload: {
        routeId: 'leiria-historica',
        specHash: 'f'.repeat(64),
        mode: 'free',
        simulated: true,
        locale: 'pt',
        startedAt: '2026-10-08T09:00:00.000Z',
      },
    });
    expect(run.statusCode).toBe(201);
    const [mine] = await api.db.select().from(routes).where(eq(routes.id, 'mi-ruta-abcdefghij'));

    const warnings: unknown[] = [];
    const dir = await routesFolder({ 'leiria-historica.json': leiria });
    const result = await seedCuratedRoutes(api.db, dir, { warn: (obj) => warnings.push(obj) });
    expect(result).toMatchObject({ inserted: ['leiria-historica'] });
    expect(warnings).toEqual([{ id: 'leiria-historica' }]);

    const [curated] = await api.db.select().from(routes).where(eq(routes.id, 'leiria-historica'));
    expect(curated).toMatchObject({
      source: 'curated',
      spec: leiria.spec,
      ownerDeviceId: null,
      editTokenHash: null,
    });
    expect(await api.db.select().from(runs).where(eq(runs.routeId, 'leiria-historica'))).toEqual(
      [],
    );
    const [after] = await api.db.select().from(routes).where(eq(routes.id, 'mi-ruta-abcdefghij'));
    expect(after).toEqual(mine);
  });
});

describe('seeding the curated routes as public ones', () => {
  const stored = async () =>
    (await api.db.select().from(routes).where(eq(routes.id, 'leiria-historica')))[0];

  it('writes a new curated route as public and visible', async () => {
    await resetDatabase(api.database);
    const dir = await routesFolder({ 'leiria-historica.json': leiria });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ inserted: ['leiria-historica'] });
    expect(await stored()).toMatchObject({
      visibility: 'public',
      moderation: 'visible',
      publishedAt: null,
      moderatedAt: null,
    });
  });

  it('keeps it public when a change in the file replaces the route', async () => {
    // Say an older release stored it without the visibility, as private.
    await api.db
      .update(routes)
      .set({ visibility: 'private' })
      .where(eq(routes.id, 'leiria-historica'));
    const edited = {
      ...leiria,
      spec: { ...leiria.spec, summary: { es: 'Otro', en: 'Other', pt: 'Outro' } },
    };
    const dir = await routesFolder({ 'leiria-historica.json': edited });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ updated: ['leiria-historica'] });
    expect(await stored()).toMatchObject({ visibility: 'public', moderation: 'visible' });
  });

  it('replaces a user route that was public and moderated with a clean curated one', async () => {
    await resetDatabase(api.database);
    const create = await api.app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      headers: { 'x-edit-token': TOKEN, 'x-device-id': DEVICE },
      payload: {
        spec: userRoute('leiria-historica', 'Mi Leiria'),
        contents: {},
        visibility: 'public',
      },
    });
    expect(create.statusCode).toBe(201);
    await api.db
      .update(routes)
      .set({ moderation: 'blocked', moderatedAt: new Date() })
      .where(eq(routes.id, 'leiria-historica'));
    const dir = await routesFolder({ 'leiria-historica.json': leiria });
    expect(await seedCuratedRoutes(api.db, dir)).toMatchObject({ inserted: ['leiria-historica'] });
    expect(await stored()).toMatchObject({
      source: 'curated',
      visibility: 'public',
      moderation: 'visible',
      publishedAt: null,
      moderatedAt: null,
    });
  });
});
