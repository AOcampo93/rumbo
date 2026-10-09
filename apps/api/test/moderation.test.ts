import { randomUUID } from 'node:crypto';
import {
  MODERATION_ACTIONS,
  ModerationQueueResponseSchema,
  REPORTS_TO_HIDE,
} from '@rumbo/api-contract';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { routeReports, routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
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
import { ADMIN_TOKEN, vapidSettings } from './push-fakes.js';

// The operator's side of the community routes (phase 7.2, ADR 0004): the
// queue of routes to review and the decision on each, behind ADMIN_TOKEN like
// the push announcements.

const ID = 'leiria-a-pe-abc123defg';
const BEARER = `Bearer ${ADMIN_TOKEN}`;

let api: Api;
beforeAll(async () => {
  api = await setupApi({ adminToken: ADMIN_TOKEN, rateLimitPerMinute: 100_000 });
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

const queueOn = (app: Api['app'], authorization?: string, remoteAddress?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/admin/moderation',
    headers: authorization === undefined ? {} : { authorization },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
const actOn = (app: Api['app'], id: string, payload: unknown, authorization?: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/admin/routes/${id}/moderation`,
    payload: payload as object,
    headers: authorization === undefined ? {} : { authorization },
  });
/** The queue and the actions, as the operator asks for them. */
const queue = () => queueOn(api.app, BEARER);
const act = (id: string, action: string) => actOn(api.app, id, { action }, BEARER);
const setModeration = (id: string, moderation: 'visible' | 'hidden' | 'blocked') =>
  api.db.update(routes).set({ moderation, moderatedAt: new Date() }).where(eq(routes.id, id));

describe('the operator’s token', () => {
  let other: Api | undefined;
  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it('is what makes the endpoints exist: without a usable ADMIN_TOKEN they answer 404', async () => {
    for (const adminToken of [null, 'x'.repeat(31)]) {
      other = await setupApi({ adminToken });
      for (const authorization of [undefined, BEARER, `Bearer ${adminToken}`]) {
        for (const res of [
          await queueOn(other.app, authorization),
          await actOn(other.app, ID, { action: 'block' }, authorization),
        ]) {
          expect(res.statusCode, String(adminToken)).toBe(404);
          expect(res.json()).toEqual({ code: 'not_found' });
        }
      }
      await other.close();
      other = undefined;
    }
  });

  it('wants it as a Bearer, and answers 403 to anything else, without touching a route', async () => {
    await publish(api, ID);
    for (const authorization of [
      undefined,
      '',
      'Bearer',
      'Bearer ',
      'Bearer nope',
      `Bearer ${ADMIN_TOKEN}x`,
      `Bearer ${ADMIN_TOKEN.slice(0, -1)}`,
      `Bearer ${ADMIN_TOKEN.toUpperCase()}`,
      `Token ${ADMIN_TOKEN}`,
      `Basic ${ADMIN_TOKEN}`,
      ADMIN_TOKEN,
    ]) {
      for (const res of [
        await queueOn(api.app, authorization),
        await actOn(api.app, ID, { action: 'block' }, authorization),
      ]) {
        expect(res.statusCode, String(authorization)).toBe(403);
        expect(res.json()).toEqual({ code: 'forbidden' });
      }
    }
    expect((await routeRow(api, ID))?.moderation).toBe('visible');
    // The scheme's name is not case-sensitive.
    expect((await queueOn(api.app, `bearer ${ADMIN_TOKEN}`)).statusCode).toBe(200);
  });

  it('is checked before the body is, and the body has one of two actions', async () => {
    await publish(api, ID);
    expect((await actOn(api.app, ID, { rubbish: true }, 'Bearer nope')).statusCode).toBe(403);
    for (const payload of [
      {},
      { action: 'delete' },
      { action: 'BLOCK' },
      { action: 'block', why: 'x' },
      'block',
      ['block'],
    ]) {
      const res = await actOn(api.app, ID, payload, BEARER);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
    expect((await actOn(api.app, 'BAD_ID', { action: 'block' }, BEARER)).json().code).toBe(
      'validation_failed',
    );
    expect((await routeRow(api, ID))?.moderation).toBe('visible');
  });

  it('is limited per address, wrong tokens included, one budget for every admin endpoint', async () => {
    other = await setupApi({ adminToken: ADMIN_TOKEN, adminRateLimitPerMinute: 3 });
    const app = other.app;
    expect((await queueOn(app, 'Bearer nope')).statusCode).toBe(403);
    expect((await queueOn(app, BEARER)).statusCode).toBe(200);
    expect((await actOn(app, 'no-such-route', { action: 'block' }, BEARER)).statusCode).toBe(404);
    for (const res of [
      await queueOn(app, BEARER),
      await actOn(app, 'no-such-route', { action: 'block' }, BEARER),
      // The announcements share the budget; they'd be 503 with push off.
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/push',
        headers: { authorization: BEARER },
        payload: {},
      }),
    ]) {
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ code: 'rate_limited' });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    }
    // The limit comes before the token: a wrong one is 429 too.
    expect((await queueOn(app, 'Bearer nope')).statusCode).toBe(429);
    // Someone else is not affected.
    expect((await queueOn(app, BEARER, '203.0.113.9')).statusCode).toBe(200);
  });

  it('works whether push is on or off', async () => {
    expect((await api.app.inject({ method: 'GET', url: '/api/v1/push/key' })).statusCode).toBe(503);
    expect((await queue()).statusCode).toBe(200);
    expect((await act('no-such-route', 'restore')).statusCode).toBe(404);

    other = await setupApi({ adminToken: ADMIN_TOKEN, ...vapidSettings() });
    expect((await other.app.inject({ method: 'GET', url: '/api/v1/push/key' })).statusCode).toBe(
      200,
    );
    expect((await queueOn(other.app, BEARER)).statusCode).toBe(200);
    expect(
      (await actOn(other.app, 'no-such-route', { action: 'restore' }, BEARER)).statusCode,
    ).toBe(404);
  });

  it('answers 503 unavailable while the database is not ready', async () => {
    const config = { ...loadConfig({}), adminToken: ADMIN_TOKEN };
    const app = await buildApp(config, { database: null, data: () => null }, { logger: false });
    try {
      for (const res of [
        await queueOn(app, BEARER),
        await actOn(app, ID, { action: 'block' }, BEARER),
      ]) {
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ code: 'unavailable' });
      }
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/v1/admin/moderation', () => {
  it('is empty when nothing needs review', async () => {
    await publish(api, ID);
    await create(api, 'ruta-privada-abcdefghij');
    const res = await queue();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ routes: [] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('lists the hidden, the blocked and the reported routes: hidden first, then blocked, then by reports', async () => {
    const closed = new Date('2026-10-01T10:00:00.000Z');
    // Reported twice, still visible.
    await publish(api, 'visible-dos-abcdefghij');
    await report(api, 'visible-dos-abcdefghij', randomUUID(), 'spam');
    await report(api, 'visible-dos-abcdefghij', randomUUID(), 'offensive');
    // Hidden by three devices, two of them for the same reason.
    await publish(api, 'oculta-tres-abcdefghij');
    await report(api, 'oculta-tres-abcdefghij', randomUUID(), 'spam');
    await report(api, 'oculta-tres-abcdefghij', randomUUID(), 'spam');
    await report(api, 'oculta-tres-abcdefghij', randomUUID(), 'privacy');
    // Hidden with nothing open: the reports were closed.
    await publish(api, 'oculta-cero-abcdefghij');
    await setModeration('oculta-cero-abcdefghij', 'hidden');
    await api.db.insert(routeReports).values({
      routeId: 'oculta-cero-abcdefghij',
      deviceId: randomUUID(),
      reason: 'wrong',
      resolvedAt: closed,
    });
    // Blocked.
    await publish(api, 'bloqueada-abcdefghij');
    await setModeration('bloqueada-abcdefghij', 'blocked');
    // Reported once, then withdrawn by its owner: still to be reviewed.
    await publish(api, 'retirada-uno-abcdefghij');
    await report(api, 'retirada-uno-abcdefghij', randomUUID(), 'dangerous');
    await replace(api, 'retirada-uno-abcdefghij', { visibility: 'private' });
    // Not in the queue: no reports, only closed ones, and private.
    await publish(api, 'tranquila-abcdefghij');
    await publish(api, 'cerradas-abcdefghij');
    await api.db.insert(routeReports).values({
      routeId: 'cerradas-abcdefghij',
      deviceId: randomUUID(),
      reason: 'other',
      resolvedAt: closed,
    });
    await create(api, 'privada-abcdefghij');

    const res = await queue();
    expect(res.statusCode).toBe(200);
    expect(ModerationQueueResponseSchema.safeParse(res.json()).success).toBe(true);
    const { routes: items } = res.json();
    expect(items.map((item: { id: string }) => item.id)).toEqual([
      'oculta-tres-abcdefghij',
      'oculta-cero-abcdefghij',
      'bloqueada-abcdefghij',
      'visible-dos-abcdefghij',
      'retirada-uno-abcdefghij',
    ]);
    const publishedAt = (await routeRow(api, 'oculta-tres-abcdefghij'))?.publishedAt?.toISOString();
    const updatedAt = (await routeRow(api, 'oculta-tres-abcdefghij'))?.updatedAt.toISOString();
    expect(items[0]).toEqual({
      id: 'oculta-tres-abcdefghij',
      name: 'Leiria a pé',
      locale: 'pt',
      visibility: 'public',
      moderation: 'hidden',
      reports: { spam: 2, privacy: 1 },
      openReports: 3,
      publishedAt,
      updatedAt,
    });
    expect(items[1]).toMatchObject({ moderation: 'hidden', reports: {}, openReports: 0 });
    expect(items[2]).toMatchObject({ moderation: 'blocked', reports: {}, openReports: 0 });
    expect(items[3]).toMatchObject({
      moderation: 'visible',
      reports: { spam: 1, offensive: 1 },
      openReports: 2,
    });
    expect(items[4]).toMatchObject({
      visibility: 'private',
      moderation: 'visible',
      reports: { dangerous: 1 },
      openReports: 1,
    });
  });

  it('never carries the owner, the reporters or the token', async () => {
    await publish(api, ID);
    const reporters = await reportFromNew(api, ID, 2);
    const res = await queue();
    expect(res.json().routes).toHaveLength(1);
    const stored = await routeRow(api, ID);
    expect(res.body).not.toContain(DEVICE);
    expect(res.body).not.toContain(stored?.editTokenHash as string);
    for (const device of reporters) expect(res.body).not.toContain(device);
    expect(Object.keys(res.json().routes[0]).sort()).toEqual(
      [
        'id',
        'locale',
        'moderation',
        'name',
        'openReports',
        'publishedAt',
        'reports',
        'updatedAt',
        'visibility',
      ].sort(),
    );
  });

  it('keeps curated routes out, whatever the database says about them', async () => {
    await api.db
      .insert(routeReports)
      .values({ routeId: 'leiria-historica', deviceId: randomUUID(), reason: 'spam' });
    await api.db
      .update(routes)
      .set({ moderation: 'hidden' })
      .where(eq(routes.id, 'leiria-historica'));
    expect((await queue()).json()).toEqual({ routes: [] });
  });
});

describe('POST /api/v1/admin/routes/:id/moderation', () => {
  it('block takes the route down for everyone but its owner, and closes its reports', async () => {
    await publish(api, ID);
    await publish(api, 'otra-ruta-abcdefghij');
    await reportFromNew(api, ID, 2);
    await reportFromNew(api, 'otra-ruta-abcdefghij', 1);
    const before = Date.now();

    const res = await act(ID, 'block');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ID, moderation: 'blocked' });
    expect(res.headers['cache-control']).toBe('no-store');

    const stored = await routeRow(api, ID);
    expect(stored?.moderation).toBe('blocked');
    expect(stored?.moderatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    // Closed, not deleted; and only this route's.
    const reports = await reportsOf(api, ID);
    expect(reports).toHaveLength(2);
    for (const row of reports) expect(row.resolvedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect((await reportsOf(api, 'otra-ruta-abcdefghij')).map((row) => row.resolvedAt)).toEqual([
      null,
    ]);
    expect((await routeRow(api, 'otra-ruta-abcdefghij'))?.moderation).toBe('visible');

    expect((await read(api, ID)).statusCode).toBe(404);
    expect((await read(api, ID, { 'x-edit-token': TOKEN })).statusCode).toBe(200);
    expect((await status(api, ID)).json()).toMatchObject({
      visibility: 'public',
      moderation: 'blocked',
    });
    const listed = await api.app.inject({
      method: 'GET',
      url: '/api/v1/routes?near=39.745,-8.807',
    });
    const listedIds = listed.json().map((route: { id: string }) => route.id);
    expect(listedIds).not.toContain(ID);
    expect(listedIds).toContain('otra-ruta-abcdefghij');
    // And it takes no more reports; its owner can't bring it back by publishing.
    expect((await report(api, ID)).statusCode).toBe(404);
    await replace(api, ID, { visibility: 'public' });
    expect((await routeRow(api, ID))?.moderation).toBe('blocked');
  });

  it('restore brings the route back, and its reports start from zero', async () => {
    await publish(api, ID);
    const reporters = await reportFromNew(api, ID, REPORTS_TO_HIDE);
    expect((await routeRow(api, ID))?.moderation).toBe('hidden');
    expect((await read(api, ID)).statusCode).toBe(404);
    const before = Date.now();

    const res = await act(ID, 'restore');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ID, moderation: 'visible' });
    const stored = await routeRow(api, ID);
    expect(stored?.moderation).toBe('visible');
    expect(stored?.moderatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect((await reportsOf(api, ID)).every((row) => row.resolvedAt !== null)).toBe(true);
    expect((await queue()).json()).toEqual({ routes: [] });
    expect((await read(api, ID)).statusCode).toBe(200);
    const listed = await api.app.inject({
      method: 'GET',
      url: '/api/v1/routes?near=39.745,-8.807',
    });
    expect(listed.json().map((route: { id: string }) => route.id)).toContain(ID);

    // The same devices may report it again, and it takes the whole threshold again.
    for (const [n, device] of reporters.entries()) {
      const again = await report(api, ID, device);
      expect(again.statusCode).toBe(201);
      expect((await routeRow(api, ID))?.moderation).toBe(
        n + 1 < REPORTS_TO_HIDE ? 'visible' : 'hidden',
      );
    }
    expect(await reportsOf(api, ID)).toHaveLength(2 * REPORTS_TO_HIDE);
    const queued = (await queue()).json().routes;
    expect(queued).toMatchObject([{ id: ID, moderation: 'hidden', openReports: REPORTS_TO_HIDE }]);
  });

  it('moves a route between any two states, and a repeated action changes nothing else', async () => {
    await publish(api, ID);
    await setModeration(ID, 'blocked');
    expect((await act(ID, 'restore')).json()).toEqual({ id: ID, moderation: 'visible' });
    await setModeration(ID, 'hidden');
    expect((await act(ID, 'block')).json()).toEqual({ id: ID, moderation: 'blocked' });
    expect((await act(ID, 'block')).json()).toEqual({ id: ID, moderation: 'blocked' });
    expect((await act(ID, 'restore')).json()).toEqual({ id: ID, moderation: 'visible' });
    expect((await act(ID, 'restore')).json()).toEqual({ id: ID, moderation: 'visible' });
    expect(await routeRow(api, ID)).toMatchObject({ moderation: 'visible', visibility: 'public' });
  });

  it('closes the open reports of a route that was never hidden', async () => {
    await publish(api, ID);
    await reportFromNew(api, ID, 2);
    expect((await act(ID, 'restore')).statusCode).toBe(200);
    expect((await reportsOf(api, ID)).every((row) => row.resolvedAt !== null)).toBe(true);
    expect((await queue()).json()).toEqual({ routes: [] });
  });

  it('acts on a private route too', async () => {
    await create(api, ID);
    expect((await act(ID, 'block')).json()).toEqual({ id: ID, moderation: 'blocked' });
    expect(await routeRow(api, ID)).toMatchObject({ visibility: 'private', moderation: 'blocked' });
    expect((await queue()).json().routes).toMatchObject([{ id: ID, moderation: 'blocked' }]);
  });

  it('answers 404 route_not_found for a curated route and for one that does not exist', async () => {
    for (const id of ['leiria-historica', 'no-such-route']) {
      for (const action of MODERATION_ACTIONS) {
        const res = await act(id, action);
        expect(res.statusCode, `${id} ${action}`).toBe(404);
        expect(res.json()).toEqual({ code: 'route_not_found' });
      }
    }
    expect(await routeRow(api, 'leiria-historica')).toMatchObject({
      moderation: 'visible',
      moderatedAt: null,
    });
  });
});

describe('GET /api/v1/admin/routes/:id', () => {
  const readAs = (id: string, authorization?: string) =>
    api.app.inject({
      method: 'GET',
      url: `/api/v1/admin/routes/${id}`,
      headers: authorization === undefined ? {} : { authorization },
    });

  it('shows the operator a public route as the app reads it, never from a cache', async () => {
    await publish(api, ID);
    const res = await readAs(ID, BEARER);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual((await read(api, ID)).json());
  });

  it('still shows it once it is hidden, blocked or made private after being reported', async () => {
    await publish(api, ID);
    await reportFromNew(api, ID, REPORTS_TO_HIDE);
    expect((await read(api, ID)).statusCode).toBe(404);
    expect((await readAs(ID, BEARER)).statusCode).toBe(200);
    expect((await replace(api, ID, { visibility: 'private' })).statusCode).toBe(200);
    expect((await readAs(ID, BEARER)).statusCode).toBe(200);
    expect((await act(ID, 'restore')).statusCode).toBe(200);
    // Private, visible again and with its reports closed: it was reported, so still reviewable.
    expect((await readAs(ID, BEARER)).statusCode).toBe(200);
    await setModeration(ID, 'blocked');
    expect((await readAs(ID, BEARER)).statusCode).toBe(200);
  });

  it('keeps a private route nobody could see to its owner, and has no curated or missing ones', async () => {
    expect((await create(api, ID)).statusCode).toBe(201);
    const curated = (await api.db.select({ id: routes.id }).from(routes))
      .map((row) => row.id)
      .find((id) => id !== ID);
    expect(curated).toBeDefined();
    for (const id of [ID, curated ?? '', 'no-such-route']) {
      const res = await readAs(id, BEARER);
      expect(res.statusCode, id).toBe(404);
      expect(res.json()).toEqual({ code: 'route_not_found' });
    }
  });

  it('wants the operator’s token, like the other admin endpoints', async () => {
    await publish(api, ID);
    for (const authorization of [undefined, 'Bearer nope', ADMIN_TOKEN]) {
      const res = await readAs(ID, authorization);
      expect(res.statusCode, String(authorization)).toBe(403);
      expect(res.json()).toEqual({ code: 'forbidden' });
    }
    const off = await setupApi({ adminToken: null });
    try {
      const res = await off.app.inject({
        method: 'GET',
        url: `/api/v1/admin/routes/${ID}`,
        headers: { authorization: BEARER },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'not_found' });
    } finally {
      await off.close();
    }
  });
});
