import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { RouteSpec } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import leiria from '../../../data/routes/leiria-historica.json';
import {
  deleteMyRoute,
  type MyRouteRecord,
  routeSyncIdle,
  saveMyRoute,
} from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';

// The catalog: curated routes plus the user's own, which come from the device
// first and follow every change of the registry (design §4.2).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let n = 0;
function spec(name: string): RouteSpec {
  n += 1;
  return buildRouteSpec(
    {
      name,
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castillo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Catedral', position: { lat: 39.7436, lng: -8.8072 } },
      ],
    },
    { source: 'user', idFactory: () => `c${String(n).padStart(9, '0')}` },
  ).spec;
}

function record(route: RouteSpec, patch: Partial<MyRouteRecord> = {}): MyRouteRecord {
  return {
    id: route.id,
    editToken: 'A'.repeat(43),
    bundle: { spec: route, contents: {} },
    rev: 1,
    sync: 'synced',
    remote: 'yes',
    failures: 0,
    createdAt: '2026-10-08T09:00:00.000Z',
    updatedAt: '2026-10-08T09:00:00.000Z',
    ...patch,
  };
}

/** GET /routes answers when the test says so; writes get a 201. */
function stubApi(routes: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { spec: RouteSpec };
        return json({ id: body.spec.id, updatedAt: '2026-10-08T10:00:00.000Z' }, 201);
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url === '/api/v1/routes') return routes();
      if (url === '/api/v1/routes/leiria-historica') return json(leiria);
      return json({ code: 'not_found' }, 404);
    }),
  );
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await db.del(KEYS.myRoutes);
});

afterEach(async () => {
  await routeSyncIdle();
  vi.unstubAllGlobals();
});

describe('the catalog', () => {
  it("reads the user's routes first, newest first, and skips the unreadable ones", async () => {
    const older = spec('Ruta antigua');
    const newer = spec('Ruta nueva');
    const broken = { ...spec('Ruta rota'), points: [] };
    const gone = spec('Ruta borrada');
    await db.set(KEYS.myRoutes, {
      v: 1,
      records: {
        [older.id]: record(older),
        [newer.id]: record(newer, {
          createdAt: '2026-10-08T09:30:00.000Z',
          sync: 'error',
          error: 'quota_exceeded',
        }),
        [broken.id]: record(broken, { createdAt: '2026-10-08T08:00:00.000Z' }),
        [gone.id]: record(gone, { deleted: true }),
      },
    });
    let answer: (response: Response) => void = () => {};
    stubApi(() => new Promise((resolve) => (answer = resolve)));
    const catalog = useCatalogStore();
    const loading = catalog.load();
    await vi.waitFor(() => expect(catalog.mineStatus).toBe('ready'));
    // The API hasn't answered yet: the user's routes are already there.
    expect(catalog.status).toBe('loading');
    expect(catalog.mine.map((route) => route.id)).toEqual([newer.id, older.id]);
    expect(catalog.myRecords.map((item) => item.id)).toEqual([newer.id, older.id, broken.id]);
    expect(catalog.byId(newer.id)?.mine).toEqual({ sync: 'error', error: 'quota_exceeded' });
    expect(catalog.byId(older.id)).toMatchObject({ mine: { sync: 'synced' }, locales: ['es'] });
    expect(catalog.byId(broken.id)).toBeUndefined();

    answer(json({ code: 'internal' }, 500));
    await loading;
    expect(catalog.routes.map((route) => route.id)).toEqual([
      'leiria-historica',
      newer.id,
      older.id,
    ]);
    expect(catalog.byId('leiria-historica')?.mine).toBeUndefined();
    // Offline fallback: a missing id may be an API-only route.
    expect(catalog.authoritative).toBe(false);
  });

  it('follows saves, sync results and deletes as they happen', async () => {
    stubApi(async () => json({ code: 'internal' }, 500));
    const catalog = useCatalogStore();
    await catalog.loadMine();
    const route = spec('Ruta del día');
    await saveMyRoute(route);
    expect(catalog.byId(route.id)?.mine?.sync).toBe('pending');
    await routeSyncIdle();
    expect(catalog.byId(route.id)?.mine?.sync).toBe('synced');
    catalog.downloaded = new Set([route.id]);
    await deleteMyRoute(route.id);
    expect(catalog.byId(route.id)).toBeUndefined();
    expect(catalog.downloaded.has(route.id)).toBe(false);
  });

  it('is authoritative only when the registry was read and the API listed the routes', async () => {
    stubApi(async () => json([{ id: 'leiria-historica' }]));
    const catalog = useCatalogStore();
    await catalog.load();
    expect(catalog.curatedFrom).toBe('api');
    expect(catalog.authoritative).toBe(true);

    setActivePinia(createPinia());
    await db.set(KEYS.myRoutes, { v: 99 });
    const other = useCatalogStore();
    await other.load();
    expect(other.mineUnreadable).toBe(true);
    expect(other.authoritative).toBe(false);
  });
});
