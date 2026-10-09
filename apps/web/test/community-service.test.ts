import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOwnerStatus,
  fetchRouteBundle,
  nearbyRouteIds,
  nearParam,
  rememberReported,
  reportedRoutes,
  sendReport,
} from '../src/services/community.ts';
import { db, KEYS } from '../src/services/storage.ts';

// What the app asks of the API about the community's routes (phase 7.2,
// ADR 0004): the routes around a position, a bundle by id, the owner's view
// of a published route and the reports. Each call answers with a plain value
// and never throws.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (code: string, status: number) => json({ code }, status);
const html = (status: number) =>
  new Response('<!doctype html><title>Rumbo</title>', {
    status,
    headers: { 'content-type': 'text/html' },
  });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Replaces fetch: every request is recorded and answered by `answer`. */
function stubApi(answer: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        body: init.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

const bundle = (id: string) => {
  const built = buildRouteSpec(
    {
      name: 'Paseo de la comunidad',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', id },
  );
  return { spec: built.spec, contents: {} };
};

beforeEach(async () => {
  await db.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nearParam', () => {
  it('rounds to 3 decimals, so an exact position never leaves the device', () => {
    expect(nearParam({ lat: 39.74362, lng: -8.80711 })).toBe('39.744,-8.807');
    expect(nearParam({ lat: 41, lng: -8 })).toBe('41.000,-8.000');
    expect(nearParam({ lat: -0.0004, lng: 0.0004 })).toBe('0.000,0.000');
    expect(nearParam({ lat: -33.8688, lng: 151.2093 })).toBe('-33.869,151.209');
  });
});

describe('the routes around a position', () => {
  it('asks GET /routes?near= with the rounded position and returns the ids in order', async () => {
    const calls = stubApi(() =>
      json([{ id: 'leiria-historica' }, { id: 'paseo-aaaa' }, { id: 'paseo-bbbb', name: 'x' }]),
    );
    expect(await nearbyRouteIds({ lat: 39.74362, lng: -8.80711 })).toEqual([
      'leiria-historica',
      'paseo-aaaa',
      'paseo-bbbb',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/routes?near=39.744,-8.807' });
  });

  it('skips what is not a route id, and gives up (null) on anything that is not the list', async () => {
    stubApi(() => json([{ id: 'ok-route-1' }, { id: 7 }, null, 'text', { id: '../etc' }, {}]));
    expect(await nearbyRouteIds({ lat: 1, lng: 2 })).toEqual(['ok-route-1']);
    stubApi(() => json({ routes: [] }));
    expect(await nearbyRouteIds({ lat: 1, lng: 2 })).toBeNull();
    stubApi(() => apiError('rate_limited', 429));
    expect(await nearbyRouteIds({ lat: 1, lng: 2 })).toBeNull();
    stubApi(() => html(200));
    expect(await nearbyRouteIds({ lat: 1, lng: 2 })).toBeNull();
    stubApi(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await nearbyRouteIds({ lat: 1, lng: 2 })).toBeNull();
  });

  it('stops when its signal aborts', async () => {
    stubApi(() => json([{ id: 'ok-route-1' }]));
    const controller = new AbortController();
    controller.abort();
    expect(await nearbyRouteIds({ lat: 1, lng: 2 }, controller.signal)).toBeNull();
  });
});

describe('a route by id', () => {
  it('returns the validated bundle', async () => {
    const calls = stubApi(() => json(bundle('paseo-aaaa')));
    const found = await fetchRouteBundle('paseo-aaaa');
    expect(found).not.toBeNull();
    expect(found).not.toBe('gone');
    expect((found as { spec: { id: string; source: string } }).spec).toMatchObject({
      id: 'paseo-aaaa',
      source: 'user',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/routes/paseo-aaaa' });
  });

  it('says "gone" only when the API itself says there is no such route', async () => {
    stubApi(() => apiError('route_not_found', 404));
    expect(await fetchRouteBundle('paseo-aaaa')).toBe('gone');
    stubApi(() => html(404));
    expect(await fetchRouteBundle('paseo-aaaa')).toBeNull();
    stubApi(() => apiError('internal', 500));
    expect(await fetchRouteBundle('paseo-aaaa')).toBeNull();
    stubApi(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await fetchRouteBundle('paseo-aaaa')).toBeNull();
  });

  it('refuses a bundle that does not validate', async () => {
    stubApi(() => json({ spec: { id: 'paseo-aaaa' }, contents: {} }));
    expect(await fetchRouteBundle('paseo-aaaa')).toBeNull();
    stubApi(() => json('not a bundle'));
    expect(await fetchRouteBundle('paseo-aaaa')).toBeNull();
  });
});

describe("the owner's view of a published route", () => {
  const TOKEN = 'a'.repeat(43);

  it('sends the edit token and returns what the API says', async () => {
    const status = {
      visibility: 'public',
      moderation: 'hidden',
      publishedAt: '2026-10-09T10:00:00.000Z',
    };
    const calls = stubApi(() => json(status));
    expect(await fetchOwnerStatus('paseo-aaaa', TOKEN)).toEqual(status);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/routes/paseo-aaaa/status' });
    expect(calls[0]?.headers['x-edit-token']).toBe(TOKEN);
  });

  it('is null when the API cannot tell (not the owner, an error, not its answer)', async () => {
    stubApi(() => apiError('route_not_found', 404));
    expect(await fetchOwnerStatus('paseo-aaaa', TOKEN)).toBeNull();
    stubApi(() => json({ visibility: 'public', moderation: 'sideways', publishedAt: null }));
    expect(await fetchOwnerStatus('paseo-aaaa', TOKEN)).toBeNull();
    stubApi(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await fetchOwnerStatus('paseo-aaaa', TOKEN)).toBeNull();
  });
});

describe('reporting a route', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('POSTs the reason with the device id, and a new report or a repeated one is "sent"', async () => {
    const calls = stubApi(() => json({ received: true }, 201));
    expect(await sendReport('paseo-aaaa', 'spam')).toBe('sent');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/routes/paseo-aaaa/reports',
      body: { reason: 'spam' },
    });
    expect(calls[0]?.headers['x-device-id']).toMatch(UUID);
    stubApi(() => json({ received: true }, 200));
    expect(await sendReport('paseo-aaaa', 'privacy')).toBe('sent');
  });

  it('is "gone" when the API takes no reports for the route any more', async () => {
    stubApi(() => apiError('route_not_found', 404));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('gone');
  });

  it('fails on anything else: an error, a limit, a page that is not the API, no network', async () => {
    stubApi(() => apiError('rate_limited', 429));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('failed');
    stubApi(() => apiError('validation_failed', 422));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('failed');
    stubApi(() => html(200));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('failed');
    stubApi(() => json({ received: false }));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('failed');
    stubApi(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sendReport('paseo-aaaa', 'other')).toBe('failed');
  });
});

describe('the routes this device reported', () => {
  it('remembers each one once, and forgets the oldest past a limit', async () => {
    expect([...(await reportedRoutes())]).toEqual([]);
    await rememberReported('paseo-aaaa');
    await rememberReported('paseo-bbbb');
    await rememberReported('paseo-aaaa');
    expect([...(await reportedRoutes())]).toEqual(['paseo-aaaa', 'paseo-bbbb']);

    await db.set(
      KEYS.reportedRoutes,
      Array.from({ length: 500 }, (_, i) => `ruta-${i}`),
    );
    await rememberReported('ruta-nueva');
    const ids = [...(await reportedRoutes())];
    expect(ids).toHaveLength(500);
    expect(ids).not.toContain('ruta-0');
    expect(ids.at(-1)).toBe('ruta-nueva');
  });

  it('never rejects when storage fails', async () => {
    vi.spyOn(db, 'update').mockRejectedValueOnce(new Error('storage is full'));
    await expect(rememberReported('paseo-aaaa')).resolves.toBeUndefined();
  });
});
