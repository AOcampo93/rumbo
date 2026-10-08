import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointContents, routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { routesFolder, setupApi } from './helpers.js';

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
});
