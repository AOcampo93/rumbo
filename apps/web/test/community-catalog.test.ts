import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { RouteSpec } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import leiria from '../../../data/routes/leiria-historica.json';
import { isCommunityRoute } from '../src/services/catalog.ts';
import { type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';

// The community's routes in the catalog (phase 7.2, ADR 0004): the ones around
// the user for Explore (a list, then each bundle a few at a time), and any
// route asked for by id (a community route opened by its address, or the one
// a run in progress was walking). They stay apart from the curated routes and
// the user's own, and live in memory unless the user downloads one.

const POSITION = { lat: 39.74362, lng: -8.80711 };
const NEAR = '/api/v1/routes?near=39.744,-8.807';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (code: string, status: number) => json({ code }, status);

function spec(id: string, name = 'Paseo de la comunidad'): RouteSpec {
  return buildRouteSpec(
    {
      name,
      locale: 'pt',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', id },
  ).spec;
}
const bundle = (id: string, name?: string) => ({ spec: spec(id, name), contents: {} });

function record(id: string, patch: Partial<MyRouteRecord> = {}): MyRouteRecord {
  return {
    id,
    editToken: 'A'.repeat(43),
    bundle: { spec: spec(id, 'Mi ruta'), contents: {} },
    rev: 1,
    sync: 'synced',
    remote: 'yes',
    failures: 0,
    createdAt: '2026-10-08T09:00:00.000Z',
    updatedAt: '2026-10-08T09:00:00.000Z',
    ...patch,
  };
}

type Answer = Response | Promise<Response>;

/**
 * The API: `routes` answers by URL (path and query); the curated list and
 * Leiria's bundle are there unless a test says otherwise, and anything else is
 * a 404. Aborted requests reject, as in browsers. Returns the URLs asked for.
 */
function stubApi(routes: Record<string, () => Answer> = {}): string[] {
  const table: Record<string, () => Answer> = {
    '/api/v1/routes': () => json([{ id: 'leiria-historica' }]),
    '/api/v1/routes/leiria-historica': () => json(leiria),
    ...routes,
  };
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      asked.push(url);
      const answer = table[url]?.() ?? apiError('not_found', 404);
      const { signal } = init;
      return Promise.race([
        answer,
        new Promise<never>((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason)),
        ),
      ]);
    }),
  );
  return asked;
}

function deferred<T = Response>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ids = (list: ReadonlyArray<{ id: string }>) => list.map((item) => item.id);

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await db.clear();
});

afterEach(async () => {
  await routeSyncIdle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the community routes around the user', () => {
  it('asks for the list, then for the bundle of each one, nearest first', async () => {
    const asked = stubApi({
      [NEAR]: () => json([{ id: 'paseo-bbbb' }, { id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa', 'Paseo A')),
      '/api/v1/routes/paseo-bbbb': () => json(bundle('paseo-bbbb', 'Paseo B')),
    });
    const catalog = useCatalogStore();
    expect(catalog.communityStatus).toBe('idle');
    await catalog.loadCommunity(POSITION);

    expect(catalog.communityStatus).toBe('ready');
    expect(ids(catalog.community)).toEqual(['paseo-bbbb', 'paseo-aaaa']);
    expect(asked).toContain(NEAR);
    expect(asked).toContain('/api/v1/routes/paseo-aaaa');
    // Each one is a user route that isn't the user's: "De la comunidad", in its own colour.
    const first = catalog.community[0];
    expect(first && isCommunityRoute(first)).toBe(true);
    expect(first).toMatchObject({ bundled: false, locales: ['pt'], summary: { pointCount: 2 } });
    expect(catalog.community[0]?.color).toMatch(/^#/);
  });

  it('keeps them out of the curated and own routes, but finds them by id', async () => {
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(ids(catalog.routes)).toEqual(['leiria-historica']);
    expect(catalog.byId('paseo-aaaa')?.bundle.spec.id).toBe('paseo-aaaa');
    expect(catalog.byId('paseo-aaaa')?.mine).toBeUndefined();
    expect(catalog.byId('no-such-route')).toBeUndefined();
  });

  it('leaves out the curated routes and the ones the user made, and never asks for their bundles', async () => {
    await db.set(KEYS.myRoutes, { v: 1, records: { 'minha-rota-1': record('minha-rota-1') } });
    const asked = stubApi({
      [NEAR]: () =>
        json([{ id: 'leiria-historica' }, { id: 'minha-rota-1' }, { id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(ids(catalog.community)).toEqual(['paseo-aaaa']);
    // The curated one was read when the catalog loaded; the user's own never leaves the device.
    expect(asked.filter((url) => url === '/api/v1/routes/leiria-historica')).toHaveLength(1);
    expect(asked).not.toContain('/api/v1/routes/minha-rota-1');
    expect(ids(catalog.routes)).toEqual(['leiria-historica', 'minha-rota-1']);
  });

  it('asks for twenty bundles at most, four at a time', async () => {
    const wanted = Array.from({ length: 30 }, (_, i) => `paseo-${String(i).padStart(2, '0')}`);
    let inFlight = 0;
    let mostAtOnce = 0;
    const routes: Record<string, () => Answer> = {
      [NEAR]: () => json(wanted.map((id) => ({ id }))),
    };
    for (const id of wanted) {
      routes[`/api/v1/routes/${id}`] = async () => {
        inFlight += 1;
        mostAtOnce = Math.max(mostAtOnce, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return json(bundle(id));
      };
    }
    const asked = stubApi(routes);
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(asked.filter((url) => /\/routes\/paseo-/.test(url))).toHaveLength(20);
    expect(mostAtOnce).toBe(4);
    expect(ids(catalog.community)).toEqual(wanted.slice(0, 20));
  });

  it('skips a bundle that cannot be read, or that is not a user route', async () => {
    stubApi({
      [NEAR]: () =>
        json([
          { id: 'paseo-aaaa' },
          { id: 'paseo-bad' },
          { id: 'paseo-id' },
          { id: 'paseo-curada' },
        ]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
      '/api/v1/routes/paseo-bad': () => json({ spec: { id: 'paseo-bad' } }),
      // Another route than the one asked for.
      '/api/v1/routes/paseo-id': () => json(bundle('paseo-other')),
      // A curated route that the catalog doesn't list is not a community one.
      '/api/v1/routes/paseo-curada': () =>
        json({ ...leiria, spec: { ...leiria.spec, id: 'paseo-curada' } }),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('ready');
    expect(ids(catalog.community)).toEqual(['paseo-aaaa']);
  });

  it('drops quietly a route the API says is gone (hidden, taken back or taken down)', async () => {
    // A shared cache can still list it for a minute after the API stopped serving it.
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-gone' }, { id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-gone': () => apiError('route_not_found', 404),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('ready');
    expect(ids(catalog.community)).toEqual(['paseo-aaaa']);
    expect(catalog.byId('paseo-gone')).toBeUndefined();
  });

  it('is an empty area, not a failure, when every listed route is gone', async () => {
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-aaaa' }, { id: 'paseo-bbbb' }]),
      '/api/v1/routes/paseo-aaaa': () => apiError('route_not_found', 404),
      '/api/v1/routes/paseo-bbbb': () => apiError('route_not_found', 404),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('ready');
    expect(catalog.community).toEqual([]);
  });

  it('says it failed, not that the area is empty, when none of the listed routes can be read', async () => {
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-aaaa' }, { id: 'paseo-bbbb' }]),
      '/api/v1/routes/paseo-aaaa': () => apiError('internal', 500),
      '/api/v1/routes/paseo-bbbb': () => apiError('internal', 500),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('error');
    expect(catalog.community).toEqual([]);
  });

  it('is ready and empty when the area has no community routes', async () => {
    stubApi({ [NEAR]: () => json([{ id: 'leiria-historica' }]) });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('ready');
    expect(catalog.community).toEqual([]);
  });

  it('fails quietly when the list does, and a new try puts it right', async () => {
    let healthy = false;
    stubApi({
      [NEAR]: () => (healthy ? json([{ id: 'paseo-aaaa' }]) : apiError('internal', 500)),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
    });
    const catalog = useCatalogStore();
    await expect(catalog.loadCommunity(POSITION)).resolves.toBeUndefined();
    expect(catalog.communityStatus).toBe('error');
    // The curated routes are not touched.
    expect(ids(catalog.routes)).toEqual(['leiria-historica']);

    healthy = true;
    await catalog.loadCommunity(POSITION);
    expect(catalog.communityStatus).toBe('ready');
    expect(ids(catalog.community)).toEqual(['paseo-aaaa']);
  });

  it('never rejects, even when the network drops in the middle', async () => {
    stubApi({
      [NEAR]: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const catalog = useCatalogStore();
    await expect(catalog.loadCommunity(POSITION)).resolves.toBeUndefined();
    expect(catalog.communityStatus).toBe('error');
  });

  it('asks for nothing when offline', async () => {
    setOnline(false);
    const asked = stubApi();
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(asked).toEqual([]);
    expect(catalog.communityStatus).toBe('idle');
  });

  it('asks again only for another place, or once the list is old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    const asked = stubApi({
      [NEAR]: () => json([]),
      '/api/v1/routes?near=41.150,-8.611': () => json([]),
    });
    const catalog = useCatalogStore();
    const lists = () => asked.filter((url) => url.includes('near='));

    await catalog.loadCommunity(POSITION);
    await catalog.loadCommunity({ lat: 39.74401, lng: -8.80699 });
    expect(lists()).toEqual([NEAR]);

    await catalog.loadCommunity({ lat: 41.1496, lng: -8.6109 });
    expect(lists()).toEqual([NEAR, '/api/v1/routes?near=41.150,-8.611']);

    vi.setSystemTime(new Date('2026-10-09T10:05:00Z'));
    await catalog.loadCommunity({ lat: 41.1496, lng: -8.6109 });
    expect(lists()).toHaveLength(3);
  });

  it('forgets an older request when the position changes', async () => {
    const slow = deferred();
    stubApi({
      [NEAR]: () => slow.promise,
      '/api/v1/routes?near=41.150,-8.611': () => json([{ id: 'paseo-porto' }]),
      '/api/v1/routes/paseo-porto': () => json(bundle('paseo-porto')),
    });
    const catalog = useCatalogStore();
    const first = catalog.loadCommunity(POSITION);
    await vi.waitFor(() => expect(catalog.communityStatus).toBe('loading'));
    await catalog.loadCommunity({ lat: 41.1496, lng: -8.6109 });
    expect(ids(catalog.community)).toEqual(['paseo-porto']);
    // The first answer arrives late and changes nothing.
    slow.resolve(json([{ id: 'paseo-aaaa' }]));
    await first;
    expect(ids(catalog.community)).toEqual(['paseo-porto']);
    expect(catalog.communityStatus).toBe('ready');
  });

  it('marks as downloaded the ones whose bundle the device kept', async () => {
    await db.set(KEYS.bundle('paseo-aaaa'), bundle('paseo-aaaa'));
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-aaaa' }, { id: 'paseo-bbbb' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
      '/api/v1/routes/paseo-bbbb': () => json(bundle('paseo-bbbb')),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    await vi.waitFor(() => expect(catalog.downloaded.has('paseo-aaaa')).toBe(true));
    expect(catalog.downloaded.has('paseo-bbbb')).toBe(false);
  });

  it('keeps them in memory: nothing is stored until the user downloads one', async () => {
    stubApi({
      [NEAR]: () => json([{ id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')),
    });
    const catalog = useCatalogStore();
    await catalog.loadCommunity(POSITION);
    expect(await db.get(KEYS.bundle('paseo-aaaa'))).toBeUndefined();
    // Downloading it works as for the curated routes.
    expect(await catalog.download('paseo-aaaa')).toBe(true);
    expect(await db.get(KEYS.bundle('paseo-aaaa'))).toMatchObject({ spec: { id: 'paseo-aaaa' } });
    expect(catalog.downloaded.has('paseo-aaaa')).toBe(true);
  });
});

describe('a route by id', () => {
  it('asks the API for a community route the lists do not have, once however many ask', async () => {
    const asked = stubApi({ '/api/v1/routes/paseo-aaaa': () => json(bundle('paseo-aaaa')) });
    const catalog = useCatalogStore();
    await catalog.load();
    expect(catalog.byId('paseo-aaaa')).toBeUndefined();
    const [one, two] = await Promise.all([
      catalog.resolve('paseo-aaaa'),
      catalog.resolve('paseo-aaaa'),
    ]);
    expect(one.route?.id).toBe('paseo-aaaa');
    expect(two.route).toBe(one.route);
    expect(asked.filter((url) => url.endsWith('/paseo-aaaa'))).toHaveLength(1);
    expect(catalog.byId('paseo-aaaa')).toBe(one.route);
    // It is a route to open, not one for Explore's list.
    expect(catalog.community).toEqual([]);
    expect(ids(catalog.routes)).toEqual(['leiria-historica']);
  });

  it('answers at once with what the catalog already has', async () => {
    await db.set(KEYS.myRoutes, { v: 1, records: { 'minha-rota-1': record('minha-rota-1') } });
    const asked = stubApi();
    const catalog = useCatalogStore();
    await catalog.load();
    const before = asked.length;
    expect((await catalog.resolve('leiria-historica')).route?.id).toBe('leiria-historica');
    expect((await catalog.resolve('minha-rota-1')).route?.mine).toBeDefined();
    expect(asked).toHaveLength(before);
  });

  it('says the route is gone only when the API says so', async () => {
    const catalog = useCatalogStore();
    stubApi({ '/api/v1/routes/paseo-aaaa': () => apiError('route_not_found', 404) });
    expect(await catalog.resolve('paseo-aaaa')).toEqual({ route: null, gone: true });

    stubApi({ '/api/v1/routes/paseo-bbbb': () => apiError('internal', 500) });
    expect(await catalog.resolve('paseo-bbbb')).toEqual({ route: null, gone: false });

    stubApi({
      '/api/v1/routes/paseo-cccc': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await catalog.resolve('paseo-cccc')).toEqual({ route: null, gone: false });
  });

  it('falls back to the copy the user downloaded when the API cannot give the route', async () => {
    await db.set(KEYS.bundle('paseo-aaaa'), bundle('paseo-aaaa', 'Descargada'));
    const catalog = useCatalogStore();
    // Offline, or taken down meanwhile: the copy still runs.
    stubApi({
      '/api/v1/routes/paseo-aaaa': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const offline = await catalog.resolve('paseo-aaaa');
    expect(offline.route?.bundle.spec.name).toBe('Descargada');
    expect(catalog.downloaded.has('paseo-aaaa')).toBe(true);

    await db.set(KEYS.bundle('paseo-bbbb'), bundle('paseo-bbbb'));
    stubApi({ '/api/v1/routes/paseo-bbbb': () => apiError('route_not_found', 404) });
    expect((await catalog.resolve('paseo-bbbb')).route?.id).toBe('paseo-bbbb');
  });

  it('refuses a copy that is not the route asked for, or that does not validate', async () => {
    const catalog = useCatalogStore();
    await db.set(KEYS.bundle('paseo-aaaa'), bundle('paseo-other'));
    await db.set(KEYS.bundle('paseo-bbbb'), { spec: { id: 'paseo-bbbb' } });
    stubApi();
    expect(await catalog.resolve('paseo-aaaa')).toEqual({ route: null, gone: true });
    expect(await catalog.resolve('paseo-bbbb')).toEqual({ route: null, gone: true });
  });
});

describe("the user's own routes, published or not", () => {
  it('say so in the catalog, and follow the registry', async () => {
    await db.set(KEYS.myRoutes, {
      v: 1,
      records: {
        'rota-publica-1': record('rota-publica-1', { visibility: 'public' }),
        'rota-privada-1': record('rota-privada-1', { visibility: 'private' }),
        'rota-antiga-01': record('rota-antiga-01'),
      },
    });
    stubApi();
    const catalog = useCatalogStore();
    await catalog.load();
    expect(catalog.byId('rota-publica-1')?.mine).toEqual({ sync: 'synced', published: true });
    expect(catalog.byId('rota-privada-1')?.mine).toEqual({ sync: 'synced' });
    expect(catalog.byId('rota-antiga-01')?.mine).toEqual({ sync: 'synced' });
  });
});
