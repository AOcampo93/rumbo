import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { analyticsEvents, devices } from '../src/db/schema.js';
import { DEVICE, setupApi } from './helpers.js';

let api: Awaited<ReturnType<typeof setupApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});
afterAll(async () => api?.close());

const RUN = '3c8f0a52-7d1e-4b6a-9f2c-5e4d3c2b1a09';
const events = [
  {
    name: 'run_started',
    props: { routeId: 'leiria-historica', mode: 'free', runId: RUN },
    at: 1_791_400_000_000,
  },
  {
    name: 'point_reached',
    props: { pointId: 'castelo-de-leiria', manual: false },
    at: 1_791_400_060_000,
  },
];
const send = (payload: unknown, headers: Record<string, string> = {}) =>
  api?.app.inject({
    method: 'POST',
    url: '/api/v1/analytics/batch',
    payload: payload as object,
    headers,
  });

describe('POST /api/v1/analytics/batch', () => {
  it('stores the events with the device (header) and the run', async () => {
    api = await setupApi();
    const res = await send({ events }, { 'x-device-id': DEVICE });
    expect(res?.statusCode).toBe(202);
    expect(res?.json()).toEqual({ accepted: 2 });
    const rows = await api.db.select().from(analyticsEvents);
    expect(rows.map((r) => r.name)).toEqual(['run_started', 'point_reached']);
    expect(rows[0]).toMatchObject({ deviceId: DEVICE, runId: RUN });
    expect(rows[1]?.runId).toBe(null);
    expect(await api.db.select().from(devices)).toHaveLength(1);
  });

  it('takes the device from the body (sendBeacon has no headers)', async () => {
    api = await setupApi();
    await send({ deviceId: DEVICE, events });
    const rows = await api.db.select().from(analyticsEvents);
    expect(rows.every((r) => r.deviceId === DEVICE)).toBe(true);
  });

  it('refuses positions and malformed batches', async () => {
    api = await setupApi();
    const located = await send({ events: [{ name: 'gps_weak', props: { lat: 39.7 }, at: 1 }] });
    expect(located?.statusCode).toBe(400);
    expect((await send({ events: [] }))?.json().code).toBe('validation_failed');
    expect(await api.db.select().from(analyticsEvents)).toEqual([]);
  });

  it('accepts but stores nothing when analytics are off', async () => {
    api = await setupApi({ analyticsEnabled: false });
    const res = await send({ events }, { 'x-device-id': DEVICE });
    expect(res?.json()).toEqual({ accepted: 0 });
    expect(await api.db.select().from(analyticsEvents)).toEqual([]);
  });
});
