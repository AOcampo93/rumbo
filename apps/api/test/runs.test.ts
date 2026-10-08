import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices, runs } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { CURATED, DEVICE, OTHER_DEVICE, setupApi } from './helpers.js';

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
  await seedCuratedRoutes(api.db, CURATED);
});
afterAll(() => api.close());

const start = {
  routeId: 'leiria-historica',
  specHash: 'f'.repeat(64),
  mode: 'free',
  simulated: true,
  locale: 'pt',
  startedAt: '2026-10-08T09:00:00.000Z',
};
const end = {
  status: 'finished',
  endedAt: '2026-10-08T10:45:00.000Z',
  elapsedMs: 6_300_000,
  completedPoints: 12,
  totalPoints: 12,
  score: 0,
};
const ANDROID = 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile';

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  api.app.inject({ method: 'POST', url: '/api/v1/runs', payload: payload as object, headers });
const patch = (runId: string, payload: unknown, headers: Record<string, string> = {}) =>
  api.app.inject({
    method: 'PATCH',
    url: `/api/v1/runs/${runId}`,
    payload: payload as object,
    headers,
  });

describe('POST /api/v1/runs', () => {
  it('needs the device id', async () => {
    const res = await post(start);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'missing_device_id' });
  });

  it('refuses unknown routes and bad bodies', async () => {
    const unknown = await post({ ...start, routeId: 'nowhere' }, { 'x-device-id': DEVICE });
    expect(unknown.json()).toEqual({ code: 'route_not_found' });
    const bad = await post({ ...start, mode: 'race' }, { 'x-device-id': DEVICE });
    expect(bad.json().code).toBe('validation_failed');
  });

  it('starts a run and remembers the device, roughly', async () => {
    const res = await post(start, { 'x-device-id': DEVICE, 'user-agent': ANDROID });
    expect(res.statusCode).toBe(201);
    const { runId } = res.json();
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const [run] = await api.db.select().from(runs).where(eq(runs.id, runId));
    expect(run).toMatchObject({
      routeId: 'leiria-historica',
      status: 'running',
      simulated: true,
      locale: 'pt',
    });
    const [device] = await api.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(device?.platform).toBe('android');
  });
});

describe('PATCH /api/v1/runs/:runId', () => {
  it('lets only its device end it, once', async () => {
    const { runId } = (await post(start, { 'x-device-id': DEVICE })).json();

    const stranger = await patch(runId, end, { 'x-device-id': OTHER_DEVICE });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json()).toEqual({ code: 'forbidden' });

    expect((await patch(runId, end, { 'x-device-id': DEVICE })).statusCode).toBe(204);
    const [run] = await api.db.select().from(runs).where(eq(runs.id, runId));
    expect(run).toMatchObject({ status: 'finished', completedPoints: 12, elapsedMs: 6_300_000 });

    // A retry from the offline queue changes nothing.
    const retry = await patch(runId, { ...end, status: 'cancelled' }, { 'x-device-id': DEVICE });
    expect(retry.statusCode).toBe(204);
    const [after] = await api.db.select().from(runs).where(eq(runs.id, runId));
    expect(after?.status).toBe('finished');
  });

  it('answers run_not_found for unknown runs', async () => {
    const res = await patch('9b2f7c1e-1111-4a2b-8c3d-4e5f6a7b8c9d', end, { 'x-device-id': DEVICE });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'run_not_found' });
  });
});
