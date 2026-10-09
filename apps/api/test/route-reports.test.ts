import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import { REPORT_REASONS, REPORTS_TO_HIDE } from '@rumbo/api-contract';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devices, routeReports, routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { installErrorHandling } from '../src/errors.js';
import { reportRoutes } from '../src/routes/reports.js';
import {
  type Api,
  create,
  publish,
  read,
  replace,
  report,
  reportFromNew,
  reportsOf,
  routeRow,
  status,
} from './community-helpers.js';
import { CURATED, DEVICE, resetDatabase, setupApi, TOKEN } from './helpers.js';

// POST /routes/:id/reports (phase 7.2, ADR 0004): anyone may report a route
// that others made public. Open reports from REPORTS_TO_HIDE different devices
// hide it until the operator reviews it.

const ID = 'leiria-a-pe-abc123defg';

let api: Api;
beforeAll(async () => {
  api = await setupApi({ rateLimitPerMinute: 100_000 });
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

const post = (id: string, payload: unknown, headers: Record<string, string>) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/routes/${id}/reports`,
    payload: payload as object,
    headers,
  });
const moderation = async (id = ID) => (await routeRow(api, id))?.moderation;
const openReports = async (id = ID) =>
  (await reportsOf(api, id)).filter((row) => row.resolvedAt === null);

describe('what a report needs', () => {
  it('wants the device id, before it looks at the body or the route', async () => {
    await publish(api, ID);
    const unidentified: Array<Record<string, string>> = [{}, { 'x-device-id': 'me' }];
    for (const headers of unidentified) {
      for (const id of [ID, 'no-such-route']) {
        for (const body of [{ reason: 'spam' }, { rubbish: true }]) {
          const res = await post(id, body, headers);
          expect(res.statusCode).toBe(400);
          expect(res.json()).toEqual({ code: 'missing_device_id' });
        }
      }
    }
    expect(await reportsOf(api, ID)).toEqual([]);
  });

  it('wants one of the reasons and nothing else', async () => {
    await publish(api, ID);
    const device = { 'x-device-id': randomUUID() };
    for (const body of [
      {},
      { reason: 'rude' },
      { reason: 'SPAM' },
      { reason: 7 },
      { reason: null },
      { reason: 'spam', comment: 'it is bad' },
      ['spam'],
      'spam',
    ]) {
      const res = await post(ID, body, device);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
    const notJson = await api.app.inject({
      method: 'POST',
      url: `/api/v1/routes/${ID}/reports`,
      headers: { ...device, 'content-type': 'application/json' },
      payload: '{"reason":',
    });
    expect(notJson.statusCode).toBe(400);
    expect((await post('BAD_ID', { reason: 'spam' }, device)).json().code).toBe(
      'validation_failed',
    );
    expect(await reportsOf(api, ID)).toEqual([]);
  });

  it('takes a few bytes at most', async () => {
    await publish(api, ID);
    const res = await post(
      ID,
      { reason: 'spam', padding: 'x'.repeat(2000) },
      { 'x-device-id': randomUUID() },
    );
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ code: 'payload_too_large' });
  });
});

describe('a new report', () => {
  it.each(REPORT_REASONS)(
    'is stored with its reason (%s): 201 { received: true }',
    async (reason) => {
      await publish(api, ID);
      const device = randomUUID();
      const res = await report(api, ID, device, reason, {
        'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ received: true });
      expect(await reportsOf(api, ID)).toMatchObject([
        { routeId: ID, deviceId: device, reason, resolvedAt: null },
      ]);
      const [known] = await api.db.select().from(devices).where(eq(devices.id, device));
      expect(known?.platform).toBe('android');
      expect(await moderation()).toBe('visible');
    },
  );

  it('is one per device and route: a repeat is 200 { received: true } and changes nothing', async () => {
    await publish(api, ID);
    const device = randomUUID();
    expect((await report(api, ID, device, 'spam')).statusCode).toBe(201);
    for (const reason of ['spam', 'offensive'] as const) {
      const again = await report(api, ID, device, reason);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ received: true });
    }
    expect(await reportsOf(api, ID)).toMatchObject([{ deviceId: device, reason: 'spam' }]);
    // Another route is another report.
    await publish(api, 'otra-ruta-abcdefghij');
    expect((await report(api, 'otra-ruta-abcdefghij', device)).statusCode).toBe(201);
  });

  it('from the route’s owner is answered the same, 200, and kept nowhere', async () => {
    await publish(api, ID);
    for (const reason of ['spam', 'privacy'] as const) {
      const res = await report(api, ID, DEVICE, reason);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    }
    expect(await reportsOf(api, ID)).toEqual([]);
    // The owner's reports never add up to the threshold.
    await reportFromNew(api, ID, REPORTS_TO_HIDE - 1);
    await report(api, ID, DEVICE);
    expect(await moderation()).toBe('visible');
  });

  it('is never kept for a route that is not public and visible: 404 route_not_found', async () => {
    const moderate = (id: string, value: 'hidden' | 'blocked') =>
      api.db.update(routes).set({ moderation: value }).where(eq(routes.id, id));
    await create(api, 'ruta-privada-abcdefghij');
    await publish(api, 'ruta-oculta-abcdefghij');
    await publish(api, 'ruta-bloqueada-abcdefghij');
    await publish(api, 'ruta-retirada-abcdefghij');
    await moderate('ruta-oculta-abcdefghij', 'hidden');
    await moderate('ruta-bloqueada-abcdefghij', 'blocked');
    await replace(api, 'ruta-retirada-abcdefghij', { visibility: 'private' });

    const missing = await report(api, 'no-such-route');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'route_not_found' });
    const device = randomUUID();
    for (const id of [
      'leiria-historica',
      'ruta-privada-abcdefghij',
      'ruta-oculta-abcdefghij',
      'ruta-bloqueada-abcdefghij',
      'ruta-retirada-abcdefghij',
    ]) {
      const res = await report(api, id, device);
      expect(res.statusCode, id).toBe(404);
      expect(res.json(), id).toEqual(missing.json());
      expect(res.headers['cache-control'], id).toBe('no-store');
    }
    expect(await api.db.select().from(routeReports)).toEqual([]);
    // A route that answers 404 doesn't make the device known either.
    expect(await api.db.select().from(devices).where(eq(devices.id, device))).toEqual([]);
  });
});

describe('the reports that hide a route', () => {
  it(`hide it when ${REPORTS_TO_HIDE} different devices have reported it, and tell nobody`, async () => {
    await publish(api, ID);
    const answers = [];
    for (let n = 1; n <= REPORTS_TO_HIDE; n++) {
      answers.push(await report(api, ID, randomUUID()));
      // Not before the last one.
      expect(await moderation()).toBe(n < REPORTS_TO_HIDE ? 'visible' : 'hidden');
    }
    // The third one's answer is the same as the first one's.
    for (const res of answers) {
      expect(res.statusCode).toBe(201);
      expect(res.body).toBe(answers[0]?.body);
      expect(res.json()).toEqual({ received: true });
    }
    expect(await routeRow(api, ID)).toMatchObject({ moderation: 'hidden', visibility: 'public' });
    expect((await routeRow(api, ID))?.moderatedAt).toBeInstanceOf(Date);
    expect(await openReports()).toHaveLength(REPORTS_TO_HIDE);
  });

  it('count devices, not reports: one device repeating itself is still one', async () => {
    await publish(api, ID);
    const [first, second] = [randomUUID(), randomUUID()];
    for (let i = 0; i < 4; i++) {
      await report(api, ID, first, 'spam');
      await report(api, ID, second, 'offensive');
    }
    expect(await moderation()).toBe('visible');
    expect(await openReports()).toHaveLength(2);
    expect((await report(api, ID, randomUUID(), 'wrong')).statusCode).toBe(201);
    expect(await moderation()).toBe('hidden');
  });

  it('take the route away from everyone but its owner', async () => {
    await publish(api, ID);
    const sameRoute = await read(api, ID);
    expect(sameRoute.statusCode).toBe(200);
    await reportFromNew(api, ID, REPORTS_TO_HIDE);

    const list = await api.app.inject({ method: 'GET', url: '/api/v1/routes?near=39.745,-8.807' });
    expect(list.json().map((route: { id: string }) => route.id)).not.toContain(ID);
    expect((await read(api, ID)).statusCode).toBe(404);
    expect(
      (await read(api, ID, { 'if-none-match': sameRoute.headers.etag as string })).statusCode,
    ).toBe(404);
    const mine = await read(api, ID, { 'x-edit-token': TOKEN });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect((await status(api, ID)).json()).toMatchObject({
      visibility: 'public',
      moderation: 'hidden',
    });
  });

  it('stop a fourth device: the route no longer takes reports', async () => {
    await publish(api, ID);
    await reportFromNew(api, ID, REPORTS_TO_HIDE);
    const late = await report(api, ID);
    expect(late.statusCode).toBe(404);
    expect(late.json()).toEqual({ code: 'route_not_found' });
    expect(await openReports()).toHaveLength(REPORTS_TO_HIDE);
  });

  it('stay with the route when its owner publishes it again', async () => {
    await publish(api, ID);
    await reportFromNew(api, ID, REPORTS_TO_HIDE);
    const again = await replace(api, ID, { visibility: 'public' });
    expect(again.json()).toMatchObject({ visibility: 'public', moderation: 'hidden' });
    expect((await read(api, ID)).statusCode).toBe(404);
    expect(await openReports()).toHaveLength(REPORTS_TO_HIDE);
  });

  it('log that the route was hidden, with its id and nothing else', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
          },
        }),
      },
    });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    installErrorHandling(app);
    await app.register(rateLimit, { global: false });
    await app.register(reportRoutes, { database: () => api.database, rateLimitPerMinute: 100 });
    try {
      await publish(api, ID);
      const devicesThatReported = Array.from({ length: REPORTS_TO_HIDE }, () => randomUUID());
      for (const device of devicesThatReported) {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/routes/${ID}/reports`,
          headers: { 'x-device-id': device },
          payload: { reason: 'privacy' },
        });
        expect(res.statusCode).toBe(201);
      }
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const hidden = entries.filter((entry) => entry.msg === 'route hidden by reports');
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toMatchObject({ level: 30, routeId: ID });
      expect(Object.keys(hidden[0] ?? {}).sort()).toEqual(
        ['hostname', 'level', 'msg', 'pid', 'reqId', 'routeId', 'time'].sort(),
      );
      const log = lines.join('');
      for (const device of devicesThatReported) expect(log).not.toContain(device);
      expect(log).not.toContain('privacy');
    } finally {
      await app.close();
    }
  });
});

describe('reports that arrive together', () => {
  it('from the same device store one and answer the others 200', async () => {
    await publish(api, ID);
    const device = randomUUID();
    const answers = await Promise.all(Array.from({ length: 6 }, () => report(api, ID, device)));
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    for (const res of answers) expect(res.json()).toEqual({ received: true });
    expect(await reportsOf(api, ID)).toHaveLength(1);
  });

  it('still reach the threshold exactly: the one that makes it hide the route is never lost', async () => {
    for (let round = 0; round < 8; round++) {
      const id = `carrera-${round}-abcdefghij`;
      await publish(api, id);
      await report(api, id);
      const answers = await Promise.all([report(api, id), report(api, id)]);
      expect(
        answers.map((res) => res.statusCode),
        `round ${round}`,
      ).toEqual([201, 201]);
      expect(await moderation(id), `round ${round}`).toBe('hidden');
      expect(await openReports(id)).toHaveLength(REPORTS_TO_HIDE);
    }
  });

  it('from three new devices hide the route once, and from more keep exactly the first three', async () => {
    await publish(api, ID);
    const answers = await Promise.all(Array.from({ length: 5 }, () => report(api, ID)));
    const codes = answers.map((res) => res.statusCode).sort();
    expect(codes).toEqual([201, 201, 201, 404, 404]);
    expect(await moderation()).toBe('hidden');
    expect(await openReports()).toHaveLength(REPORTS_TO_HIDE);
  });

  it('race a DELETE of the route without leaving a report behind', async () => {
    await publish(api, ID);
    const [answers, deleted] = await Promise.all([
      Promise.all([report(api, ID), report(api, ID)]),
      api.app.inject({
        method: 'DELETE',
        url: `/api/v1/routes/${ID}`,
        headers: { 'x-edit-token': TOKEN },
      }),
    ]);
    expect(deleted.statusCode).toBe(204);
    for (const res of answers) expect([201, 404]).toContain(res.statusCode);
    expect(await api.db.select().from(routeReports)).toEqual([]);
  });
});

describe('deleting a route', () => {
  it('deletes its reports, and only its own', async () => {
    await publish(api, ID);
    await publish(api, 'otra-ruta-abcdefghij');
    await reportFromNew(api, ID, 2);
    await reportFromNew(api, 'otra-ruta-abcdefghij', 1);
    const res = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/routes/${ID}`,
      headers: { 'x-edit-token': TOKEN },
    });
    expect(res.statusCode).toBe(204);
    expect(await reportsOf(api, ID)).toEqual([]);
    expect(await reportsOf(api, 'otra-ruta-abcdefghij')).toHaveLength(1);
  });
});

describe('the limit', () => {
  let small: Api | undefined;
  afterEach(async () => {
    await small?.close();
    small = undefined;
  });

  it('counts every request per address, whatever device it says: the next one is 429', async () => {
    small = await setupApi({ reportRateLimitPerMinute: 3 });
    const app = small.app;
    await create(small, ID, { visibility: 'public' });
    const send = (id: string, payload: unknown, remoteAddress?: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/routes/${id}/reports`,
        payload: payload as object,
        headers: { 'x-device-id': randomUUID() },
        ...(remoteAddress ? { remoteAddress } : {}),
      });
    // A bad body, a missing route and a good report all use the budget.
    expect((await send(ID, { reason: 'nope' })).statusCode).toBe(400);
    expect((await send('no-such-route', { reason: 'spam' })).statusCode).toBe(404);
    expect((await send(ID, { reason: 'spam' })).statusCode).toBe(201);
    const limited = await send(ID, { reason: 'spam' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['cache-control']).toBe('no-store');
    expect(await reportsOf(small, ID)).toHaveLength(1);
    // Someone else is not affected.
    expect((await send(ID, { reason: 'spam' }, '203.0.113.9')).statusCode).toBe(201);
  });
});
