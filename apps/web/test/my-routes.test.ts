import 'fake-indexeddb/auto';
import { EditTokenSchema } from '@rumbo/api-contract';
import { buildRouteSpec, type RouteDraft } from '@rumbo/route-builder';
import type { RouteSpec } from '@rumbo/route-spec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAllMyRoutesRemote,
  deleteMyRoute,
  getMyRoute,
  listMyRoutes,
  type MyRouteRecord,
  onMyRoutesChange,
  retryMyRoute,
  routeSyncIdle,
  saveMyRoute,
  syncMyRoutes,
} from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';

// The user's routes on this device and their upload (phase 6, design §4.1):
// atomic, revision-checked registry updates and a sync loop that only trusts
// the API's own answers.

const NOW = '2026-10-08T10:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { spec: RouteSpec; contents: unknown } | undefined;
  keepalive: boolean | undefined;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status: number) =>
  new Response('<!doctype html><title>Rumbo</title>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
const written = (id: string, status = 201) => json({ id, updatedAt: NOW }, status);
const deleted = () => new Response(null, { status: 204 });
const apiError = (code: string, status: number) => json({ code }, status);

/** Requests still waiting for their answer; afterEach answers them so no sync pass hangs. */
const unanswered = new Set<(response: Response) => void>();

/** A response the test sends when it wants to (a request still on its way). */
function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  const release = (response: Response) => {
    unanswered.delete(release);
    resolve(response);
  };
  unanswered.add(release);
  return { promise, release };
}

/** A request that never gets an answer during the test. */
const never = () => deferred().promise;

/** Replaces fetch: every request is recorded and answered by `answer`; aborts reject, as in browsers. */
function stubApi(answer: (call: Call, index: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        body: init.body ? (JSON.parse(String(init.body)) as Call['body']) : undefined,
        keepalive: init.keepalive,
      };
      calls.push(call);
      const { signal } = init;
      return Promise.race([
        answer(call, calls.length - 1),
        new Promise<never>((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason)),
        ),
      ]);
    }),
  );
  return calls;
}

function draft(name: string): RouteDraft {
  return {
    name,
    locale: 'pt',
    mode: 'free',
    activity: 'walk',
    timeLimit: null,
    places: [
      { tempId: 'a', name: 'Castelo de Leiria', position: { lat: 39.7473, lng: -8.8077 } },
      { tempId: 'b', name: 'Sé de Leiria', position: { lat: 39.7436, lng: -8.8072 } },
    ],
  };
}

let suffix = 0;
/** A new route, or a new version of `id`. */
function spec(name = 'Leiria numa manhã', id?: string): RouteSpec {
  suffix += 1;
  return buildRouteSpec(draft(name), {
    source: 'user',
    ...(id ? { id } : {}),
    idFactory: () => `t${String(suffix).padStart(9, '0')}`,
  }).spec;
}

async function stored(id: string): Promise<MyRouteRecord | undefined> {
  const registry = await db.get<{ records: Record<string, MyRouteRecord> }>(KEYS.myRoutes);
  return registry?.records[id];
}

/** A route the API already has (POST 201 done). */
async function uploaded(name?: string): Promise<MyRouteRecord> {
  const route = spec(name);
  stubApi(() => written(route.id));
  await saveMyRoute(route);
  await routeSyncIdle();
  vi.unstubAllGlobals();
  return (await getMyRoute(route.id)) as MyRouteRecord;
}

beforeEach(async () => {
  await db.del(KEYS.myRoutes);
});

afterEach(async () => {
  // Whatever is still syncing ends quickly: every request gets a 503 from now on.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => html(503)),
  );
  for (const release of [...unanswered]) release(html(503));
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saving a route on the device', () => {
  it('stores it with a new edit token, pending, before any upload', async () => {
    stubApi(never);
    const route = spec();
    const record = await saveMyRoute(route);
    expect(record).toMatchObject({
      id: route.id,
      rev: 1,
      sync: 'pending',
      remote: 'no',
      failures: 0,
      bundle: { spec: route, contents: {} },
    });
    expect(EditTokenSchema.safeParse(record.editToken).success).toBe(true);
    expect((await listMyRoutes()).records.map((r) => r.id)).toEqual([route.id]);
  });

  it('never lets a new route replace another one with the same id', async () => {
    stubApi(never);
    const route = spec();
    await saveMyRoute(route);
    await expect(saveMyRoute(route)).rejects.toMatchObject({ code: 'id_taken' });
    const edited = await saveMyRoute(
      spec('Leiria ao fim da tarde', route.id),
      {},
      {
        editing: true,
      },
    );
    expect(edited).toMatchObject({ rev: 2, sync: 'pending' });
  });

  it('keeps both of two saves running at the same time', async () => {
    stubApi(never);
    const [a, b] = [spec('Rota A'), spec('Rota B')];
    await Promise.all([saveMyRoute(a), saveMyRoute(b)]);
    const ids = (await listMyRoutes()).records.map((record) => record.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it('never overwrites a registry it cannot read', async () => {
    stubApi(never);
    const before = await uploaded('Rota guardada');
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('Disk I/O error', 'UnknownError');
    });
    await expect(saveMyRoute(spec('Outra rota'))).rejects.toThrow();
    await expect(deleteMyRoute(before.id)).rejects.toThrow();
    expect(await listMyRoutes()).toEqual({ records: [], unreadable: true });
    read.mockRestore();
    const after = await listMyRoutes();
    expect(after.unreadable).toBe(false);
    expect(after.records).toEqual([before]);
  });

  it('leaves a registry from a newer app alone', async () => {
    const future = { v: 2, routes: [{ id: 'x' }] };
    await db.set(KEYS.myRoutes, future);
    await expect(saveMyRoute(spec())).rejects.toMatchObject({ code: 'unknown_format' });
    expect(await listMyRoutes()).toEqual({ records: [], unreadable: true });
    expect(await db.get(KEYS.myRoutes)).toEqual(future);
  });

  it('tells listeners about every change', async () => {
    stubApi((call) => written(call.body?.spec.id ?? ''));
    const heard: string[][] = [];
    const stop = onMyRoutesChange((records) => heard.push(records.map((r) => `${r.id}:${r.sync}`)));
    const route = spec();
    await saveMyRoute(route);
    await routeSyncIdle();
    stop();
    expect(heard[0]).toEqual([`${route.id}:pending`]);
    expect(heard.at(-1)).toEqual([`${route.id}:synced`]);
  });
});

describe('uploading', () => {
  it('POSTs the authored bundle with the edit token and the device id (201)', async () => {
    const route = spec();
    const calls = stubApi(() => written(route.id));
    const record = await saveMyRoute(route);
    await routeSyncIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/api/v1/routes',
      method: 'POST',
      body: { spec: route, contents: {} },
      keepalive: undefined,
    });
    expect(calls[0]?.headers['x-edit-token']).toBe(record.editToken);
    expect(calls[0]?.headers['x-device-id']).toMatch(UUID);
    expect(await getMyRoute(route.id)).toMatchObject({
      rev: 1,
      sync: 'synced',
      remote: 'yes',
      failures: 0,
    });
  });

  it('marks the route "maybe on the server" before the POST leaves', async () => {
    const answer = deferred();
    const calls = stubApi(() => answer.promise);
    const route = spec();
    await saveMyRoute(route);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(await stored(route.id)).toMatchObject({ remote: 'maybe', sync: 'pending' });
    answer.release(written(route.id));
  });

  it('posts again after a lost 201, and the API answers 200', async () => {
    const route = spec();
    const calls = stubApi((_call, index) =>
      index === 0 ? Promise.reject(new TypeError('Failed to fetch')) : written(route.id, 200),
    );
    const record = await saveMyRoute(route);
    await routeSyncIdle();
    expect(await getMyRoute(route.id)).toMatchObject({
      sync: 'pending',
      remote: 'maybe',
      failures: 1,
    });
    await syncMyRoutes();
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST']);
    expect(calls[1]?.headers['x-edit-token']).toBe(record.editToken);
    expect(await getMyRoute(route.id)).toMatchObject({
      sync: 'synced',
      remote: 'yes',
      failures: 0,
    });
  });

  it('keeps a route pending when the network fails', async () => {
    stubApi(() => Promise.reject(new TypeError('Failed to fetch')));
    const route = spec();
    await saveMyRoute(route);
    await routeSyncIdle();
    expect(await getMyRoute(route.id)).toMatchObject({ sync: 'pending', failures: 1 });
  });

  it('keeps it pending when something else than the API answers (HTML 404, 405, 502, 429)', async () => {
    for (const response of [
      () => html(404),
      () => html(405),
      () => html(502),
      () => apiError('rate_limited', 429),
      () => html(200),
    ]) {
      await db.del(KEYS.myRoutes);
      stubApi(response);
      const route = spec();
      await saveMyRoute(route);
      await routeSyncIdle();
      expect(await getMyRoute(route.id)).toMatchObject({ sync: 'pending', failures: 1 });
    }
  });

  it('gives up after 5 failures in a row: "error" until the user retries', async () => {
    const route = spec();
    const calls = stubApi(() => apiError('internal', 500));
    await saveMyRoute(route);
    for (let i = 0; i < 5; i++) await syncMyRoutes();
    expect(await getMyRoute(route.id)).toMatchObject({
      sync: 'error',
      error: 'internal',
      failures: 5,
    });
    const sent = calls.length;
    await syncMyRoutes();
    expect(calls).toHaveLength(sent);
  });

  it('stops on a 422: "error" with its code, until "Retry"', async () => {
    const route = spec();
    const calls = stubApi((_call, index) =>
      index === 0 ? apiError('invalid_route', 422) : written(route.id),
    );
    await saveMyRoute(route);
    await routeSyncIdle();
    expect(await getMyRoute(route.id)).toMatchObject({ sync: 'error', error: 'invalid_route' });
    await syncMyRoutes();
    expect(calls).toHaveLength(1);
    await retryMyRoute(route.id);
    await routeSyncIdle();
    expect(calls).toHaveLength(2);
    expect(await getMyRoute(route.id)).toMatchObject({ rev: 2, sync: 'synced' });
  });

  it('PUTs an edit; a PUT answered route_not_found becomes a POST', async () => {
    const before = await uploaded();
    const calls = stubApi((call) =>
      call.method === 'PUT' ? apiError('route_not_found', 404) : written(before.id),
    );
    const edited = spec('Leiria renovada', before.id);
    await saveMyRoute(edited, {}, { editing: true });
    await routeSyncIdle();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PUT /api/v1/routes/${before.id}`,
      'POST /api/v1/routes',
    ]);
    expect(calls[1]?.body?.spec).toEqual(edited);
    expect(calls[1]?.headers['x-edit-token']).toBe(before.editToken);
    expect(await getMyRoute(before.id)).toMatchObject({ rev: 2, sync: 'synced', remote: 'yes' });
  });

  it('sends an edit made during the POST as a PUT, then is synced', async () => {
    const first = deferred();
    const route = spec();
    const calls = stubApi((_call, index) => (index === 0 ? first.promise : written(route.id, 200)));
    await saveMyRoute(route);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const edited = spec('Leiria em versão 2', route.id);
    await saveMyRoute(edited, {}, { editing: true });
    first.release(written(route.id));
    await routeSyncIdle();
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT']);
    expect(calls[1]?.body?.spec.name).toBe('Leiria em versão 2');
    expect(await getMyRoute(route.id)).toMatchObject({ rev: 2, sync: 'synced', remote: 'yes' });
  });
});

describe('deleting', () => {
  it('removes a route that never left the device at once, with its local copies', async () => {
    const calls = stubApi(never);
    const route = spec();
    await db.set(KEYS.myRoutes, {
      v: 1,
      records: {
        [route.id]: {
          id: route.id,
          editToken: 'A'.repeat(43),
          bundle: { spec: route, contents: {} },
          rev: 1,
          sync: 'pending',
          remote: 'no',
          failures: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    });
    await db.set(KEYS.bundle(route.id), { spec: route });
    await db.set(KEYS.activeRun, { routeId: route.id });
    await db.set(KEYS.lastSummary, { routeId: 'leiria-historica' });
    await deleteMyRoute(route.id);
    await routeSyncIdle();
    expect(await stored(route.id)).toBeUndefined();
    expect(await db.get(KEYS.bundle(route.id))).toBeUndefined();
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
    expect(await db.get(KEYS.lastSummary)).toEqual({ routeId: 'leiria-historica' });
    expect(calls).toEqual([]);
  });

  it('sends DELETE with the token for an uploaded route, then forgets it', async () => {
    const before = await uploaded();
    const calls = stubApi(() => deleted());
    await deleteMyRoute(before.id);
    expect(await getMyRoute(before.id)).toBeUndefined();
    await routeSyncIdle();
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: `/api/v1/routes/${before.id}`,
      body: undefined,
    });
    expect(calls[0]?.headers['x-edit-token']).toBe(before.editToken);
    expect(await stored(before.id)).toBeUndefined();
  });

  it('sends DELETE for a route deleted while its POST was on its way', async () => {
    const first = deferred();
    const route = spec();
    const calls = stubApi((_call, index) => (index === 0 ? first.promise : deleted()));
    await saveMyRoute(route);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await deleteMyRoute(route.id);
    expect((await listMyRoutes()).records).toEqual([]);
    first.release(written(route.id));
    await routeSyncIdle();
    expect(calls.map((call) => call.method)).toEqual(['POST', 'DELETE']);
    expect(await stored(route.id)).toBeUndefined();
  });

  it('sends DELETE after a POST that timed out (the API may have it)', async () => {
    const route = spec();
    const calls = stubApi((_call, index) =>
      index === 0
        ? Promise.reject(new DOMException('The request took too long', 'TimeoutError'))
        : apiError('route_not_found', 404),
    );
    await saveMyRoute(route);
    await routeSyncIdle();
    expect(await stored(route.id)).toMatchObject({ remote: 'maybe' });
    await deleteMyRoute(route.id);
    await routeSyncIdle();
    expect(calls.map((call) => call.method)).toEqual(['POST', 'DELETE']);
    expect(await stored(route.id)).toBeUndefined();
  });

  it('keeps the tombstone while the API is away, and drops it on a 403', async () => {
    const before = await uploaded();
    stubApi(() => html(502));
    await deleteMyRoute(before.id);
    await routeSyncIdle();
    expect(await stored(before.id)).toMatchObject({ deleted: true, failures: 1 });
    stubApi(() => apiError('forbidden', 403));
    await syncMyRoutes();
    expect(await stored(before.id)).toBeUndefined();
  });

  it('deletes every uploaded route for "Delete my local data", and counts the failures', async () => {
    const a = await uploaded('Rota A');
    const b = await uploaded('Rota B');
    const local = spec('Rota local');
    stubApi(never);
    await db.update<{ v: 1; records: Record<string, MyRouteRecord> }>(KEYS.myRoutes, (old) =>
      old
        ? {
            ...old,
            records: {
              ...old.records,
              [local.id]: {
                ...(old.records[a.id] as MyRouteRecord),
                id: local.id,
                remote: 'no',
                bundle: { spec: local, contents: {} },
              },
            },
          }
        : old,
    );
    const calls = stubApi((call) =>
      call.url.endsWith(a.id) ? deleted() : Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(await deleteAllMyRoutesRemote(1000)).toEqual({ failed: 1 });
    expect(calls.map((call) => call.url).sort()).toEqual(
      [`/api/v1/routes/${a.id}`, `/api/v1/routes/${b.id}`].sort(),
    );
  });
});
