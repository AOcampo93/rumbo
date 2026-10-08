import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceId } from '../src/services/device.ts';
import { flushRunOutbox, registerRunEnd, registerRunStart } from '../src/services/runs.ts';
import { db, KEYS } from '../src/services/storage.ts';

// The run's start and end on the API (phase 5): best effort, with an outbox
// for ends sent while offline.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const start = {
  routeId: 'leiria-historica',
  specHash: 'a'.repeat(64),
  mode: 'free' as const,
  simulated: true,
  locale: 'pt' as const,
  startedAt: '2026-10-08T09:00:00.000Z',
};
const end = {
  status: 'finished' as const,
  endedAt: '2026-10-08T10:00:00.000Z',
  elapsedMs: 3_600_000,
  completedPoints: 12,
  totalPoints: 12,
  score: 0,
};
const RUN = '3c8f0a52-7d1e-4b6a-9f2c-5e4d3c2b1a09';

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.del(KEYS.runOutbox);
});

describe('the device id', () => {
  it('is a UUID made once and kept', async () => {
    const id = await deviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await deviceId()).toBe(id);
    expect(await db.get(KEYS.deviceId)).toBe(id);
  });
});

describe('registering runs', () => {
  it('sends the start with the device id and the language, and returns the run id', async () => {
    const fetchMock = vi.fn(async () => json({ runId: RUN }, 201));
    vi.stubGlobal('fetch', fetchMock);
    expect(await registerRunStart(start)).toBe(RUN);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/runs');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-device-id']).toBe(await deviceId());
    expect(headers['accept-language']).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual(start);
  });

  it('gives null when the API is missing or offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'not_found' }, 404)),
    );
    expect(await registerRunStart(start)).toBe(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    expect(await registerRunStart(start)).toBe(null);
  });

  it('keeps an end it could not send and sends it later', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await registerRunEnd(RUN, end);
    expect(await db.get(KEYS.runOutbox)).toEqual([{ runId: RUN, body: end }]);

    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await flushRunOutbox();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/runs/${RUN}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(await db.get(KEYS.runOutbox)).toEqual([]);
  });

  it('drops an end the API refuses (4xx): retrying would never help', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'forbidden' }, 403)),
    );
    await registerRunEnd(RUN, end);
    expect((await db.get(KEYS.runOutbox)) ?? []).toEqual([]);
  });
});
