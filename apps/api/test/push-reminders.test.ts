import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLog, pushSubscriptions, runs } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import {
  isQuietTime,
  REMINDER_BATCH,
  REMINDER_WINDOW_HOURS,
  runReminders,
  startReminderJob,
} from '../src/push/reminders.js';
import { createPushSender, type PushSender } from '../src/push/send.js';
import {
  CURATED,
  DEVICE,
  OTHER_DEVICE,
  resetDatabase,
  setupApi,
  TOKEN,
  userRoute,
} from './helpers.js';
import { browser, messageOf, pushService } from './push-fakes.js';

// The reminder a run gets when it has gone on for hours without ending: which
// runs are chosen, the quiet hours of Portugal, once per run, and what happens
// when the push service is down. The clock is injected; no push service is
// reached.

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());
beforeEach(async () => {
  await resetDatabase(api.database);
  await seedCuratedRoutes(api.db, CURATED);
});

const HOUR = 3_600_000;
/** 13:00 in Lisbon: Portugal is on summer time until 25 October. */
const NOON = Date.parse('2026-10-08T12:00:00.000Z');

function logger() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { log, asFastify: log as unknown as FastifyBaseLogger };
}

/** The reminders over the test database, with a push service that answers `answer`. */
function setup(answer?: Parameters<typeof pushService>[0]) {
  const service = pushService(answer);
  const { log, asFastify } = logger();
  const sender = createPushSender({
    database: () => api.database,
    transport: service.transport,
    log: asFastify,
  });
  const pass = (now = NOON, options: { afterHours?: number; sender?: PushSender } = {}) =>
    runReminders({
      database: () => api.database,
      sender: options.sender ?? sender,
      afterHours: options.afterHours ?? 3,
      log: asFastify,
      now: () => now,
    });
  return { service, sender, pass, log, asFastify };
}

/** A run of the curated route that started `hoursAgo` before NOON, by default still running. */
async function addRun(hoursAgo: number, overrides: Partial<typeof runs.$inferInsert> = {}) {
  const [run] = await api.db
    .insert(runs)
    .values({
      routeId: 'leiria-historica',
      specHash: 'f'.repeat(64),
      deviceId: DEVICE,
      mode: 'free',
      simulated: false,
      locale: 'es',
      startedAt: new Date(NOON - hoursAgo * HOUR),
      ...overrides,
    })
    .returning({ id: runs.id });
  return (run as { id: string }).id;
}

async function subscribe(deviceId = DEVICE, locale: 'es' | 'en' | 'pt' = 'es') {
  const b = browser();
  await api.db
    .insert(pushSubscriptions)
    .values({ deviceId, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, locale });
  return b;
}

const logged = () => api.db.select().from(pushLog);

describe('the quiet hours', () => {
  it.each([
    // Summer time in Portugal (UTC+1).
    ['2026-07-15T06:59:59Z', true],
    ['2026-07-15T07:00:00Z', false],
    ['2026-07-15T20:59:59Z', false],
    ['2026-07-15T21:00:00Z', true],
    ['2026-07-15T23:30:00Z', true],
    // Winter time (UTC+0).
    ['2026-01-15T07:59:59Z', true],
    ['2026-01-15T08:00:00Z', false],
    ['2026-01-15T21:59:59Z', false],
    ['2026-01-15T22:00:00Z', true],
    ['2026-01-15T00:00:00Z', true],
    ['2026-01-15T12:00:00Z', false],
    // The days the clocks change: 29 March (forward at 01:00 UTC) and 25 October (back).
    ['2026-03-29T06:59:59Z', true],
    ['2026-03-29T07:00:00Z', false],
    ['2026-10-25T07:59:59Z', true],
    ['2026-10-25T08:00:00Z', false],
    ['2026-10-25T21:59:59Z', false],
    ['2026-10-25T22:00:00Z', true],
  ])('%s is quiet: %s', (time, quiet) => {
    expect(isQuietTime(Date.parse(time))).toBe(quiet);
  });
});

describe('the runs that are reminded', () => {
  it('is a run still going after 3 hours: one push to the device, saying where to go', async () => {
    const { service, pass } = setup();
    await subscribe();
    const runId = await addRun(4);

    expect(await pass()).toEqual({ quiet: false, reminded: 1, postponed: 0 });

    expect(service.sent).toHaveLength(1);
    expect(messageOf(service.sent[0]!)).toEqual({
      title: '¿Seguimos?',
      body: 'Tu recorrido «Leiria histórica» te espera',
      url: '/run',
      tag: `run_reminder:${runId}`,
    });
    expect(await logged()).toMatchObject([{ deviceId: DEVICE, kind: 'run_reminder', ref: runId }]);
  });

  it('is reminded once: a later pass, and two at the same time, send nothing more', async () => {
    const { service, pass } = setup();
    await subscribe();
    await addRun(4);

    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(await pass(NOON + HOUR)).toEqual({ quiet: false, reminded: 0, postponed: 0 });
    expect(service.sent).toHaveLength(1);

    // Another run is another reminder; two passes racing for it send one.
    const second = await addRun(5);
    // Idle connections for both passes, so that both look at the database before either claims.
    await Promise.all(Array.from({ length: 3 }, () => api.db.execute(sql`select pg_sleep(0.05)`)));
    const both = await Promise.all([pass(NOON + 2 * HOUR), pass(NOON + 2 * HOUR)]);
    expect(both.map((tally) => tally.reminded).sort()).toEqual([0, 1]);
    expect(service.sent).toHaveLength(2);
    expect(messageOf(service.sent[1]!).tag).toBe(`run_reminder:${second}`);
    expect(await logged()).toHaveLength(2);
  });

  it('is a run that started more than 3 hours ago, and only while it is still running', async () => {
    const { service, pass } = setup();
    await subscribe();
    const wanted = await addRun(3.01);
    await addRun(2.99);
    await addRun(1);
    for (const status of ['finished', 'cancelled', 'abandoned']) await addRun(4, { status });

    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(service.sent.map((request) => messageOf(request).tag)).toEqual([
      `run_reminder:${wanted}`,
    ]);
  });

  it('can be set to another number of hours', async () => {
    const { service, pass } = setup();
    await subscribe();
    await addRun(1.5);
    expect(await pass(NOON, { afterHours: 2 })).toMatchObject({ reminded: 0 });
    expect(await pass(NOON, { afterHours: 1 })).toMatchObject({ reminded: 1 });
    expect(service.sent).toHaveLength(1);
  });

  it(`is not a run that came due more than ${REMINDER_WINDOW_HOURS} hours ago: that one was forgotten`, async () => {
    const { service, pass } = setup();
    await subscribe();
    // Due 23 hours ago (a night of quiet hours, say): still worth it. Due 25 hours ago: stale.
    const late = await addRun(3 + REMINDER_WINDOW_HOURS - 1);
    await addRun(3 + REMINDER_WINDOW_HOURS + 1);
    await addRun(24 * 21);

    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(service.sent.map((request) => messageOf(request).tag)).toEqual([`run_reminder:${late}`]);
  });

  it('goes to the device of the run, and only if that device has a subscription', async () => {
    const { service, pass } = setup();
    const mine = await subscribe(DEVICE);
    await subscribe(OTHER_DEVICE);
    await addRun(4, { deviceId: DEVICE });
    await addRun(4, { deviceId: '8d0f6c5e-2b1a-4c7d-9e3f-5a4b3c2d1e0f' });

    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(service.sent.map((request) => request.endpoint)).toEqual([mine.endpoint]);
    // The device without a subscription claimed nothing: it is reminded when it subscribes.
    expect(await logged()).toHaveLength(1);
  });

  it('reaches every subscription of the device, each in its language, with the route’s name in it', async () => {
    const { service, pass } = setup();
    const [es, en, pt] = [
      await subscribe(DEVICE, 'es'),
      await subscribe(DEVICE, 'en'),
      await subscribe(DEVICE, 'pt'),
    ];
    await addRun(4);

    expect(await pass()).toMatchObject({ reminded: 1 });
    const bodyOf = (b: { endpoint: string }) =>
      messageOf(service.sent.find((request) => request.endpoint === b.endpoint)!);
    expect(bodyOf(es)).toMatchObject({
      title: '¿Seguimos?',
      body: 'Tu recorrido «Leiria histórica» te espera',
    });
    expect(bodyOf(en)).toMatchObject({
      title: 'Shall we go on?',
      body: 'Your route “Historic Leiria” is waiting for you',
    });
    expect(bodyOf(pt)).toMatchObject({
      title: 'Continuamos?',
      body: 'O teu percurso «Leiria histórica» está à tua espera',
    });
    // One run, one reminder, whatever the subscriptions.
    expect(await logged()).toHaveLength(1);
  });

  it('names a route the user made with its own name, in any language', async () => {
    const { service, pass } = setup();
    const res = await api.app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      headers: { 'x-edit-token': TOKEN, 'x-device-id': DEVICE },
      payload: { spec: userRoute('leiria-a-pe-abc123defg', 'Leiria a pé'), contents: {} },
    });
    expect(res.statusCode).toBe(201);
    await subscribe(DEVICE, 'es');
    await subscribe(DEVICE, 'en');
    await addRun(4, { routeId: 'leiria-a-pe-abc123defg' });

    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(service.sent.map((request) => messageOf(request).body).sort()).toEqual([
      'Tu recorrido «Leiria a pé» te espera',
      'Your route “Leiria a pé” is waiting for you',
    ]);
  });

  it('is at most a batch at a time, and the rest follow', async () => {
    const { service, pass } = setup();
    await subscribe();
    await api.db.insert(runs).values(
      Array.from({ length: REMINDER_BATCH + 1 }, (_, i) => ({
        routeId: 'leiria-historica',
        specHash: 'f'.repeat(64),
        deviceId: DEVICE,
        mode: 'free',
        simulated: false,
        locale: 'es',
        // Oldest first: the last one waits.
        startedAt: new Date(NOON - 10 * HOUR + i * 1000),
      })),
    );
    expect(await pass()).toMatchObject({ reminded: REMINDER_BATCH });
    expect(await pass()).toMatchObject({ reminded: 1 });
    expect(await pass()).toMatchObject({ reminded: 0 });
    expect(service.sent).toHaveLength(REMINDER_BATCH + 1);
  });

  it('does nothing while the database is not ready', async () => {
    const { asFastify } = setup();
    const sender = { deliver: vi.fn() } as unknown as PushSender;
    const tally = await runReminders({
      database: () => null,
      sender,
      afterHours: 3,
      log: asFastify,
      now: () => NOON,
    });
    expect(tally).toEqual({ quiet: false, reminded: 0, postponed: 0 });
    expect(sender.deliver).not.toHaveBeenCalled();
  });
});

describe('the quiet hours of Portugal', () => {
  it('hold the reminder back until 08:00, which a run that came due at night gets then', async () => {
    const { service, pass } = setup();
    await subscribe();
    // Started at 21:00 in Lisbon, due at midnight.
    const startedAt = new Date('2026-10-08T20:00:00Z');
    const runId = await addRun(0, { startedAt });

    for (const night of ['2026-10-08T23:00:00Z', '2026-10-08T23:45:00Z', '2026-10-09T06:45:00Z']) {
      expect(await pass(Date.parse(night)), night).toEqual({
        quiet: true,
        reminded: 0,
        postponed: 0,
      });
    }
    expect(service.sent).toEqual([]);
    expect(await logged()).toEqual([]);

    expect(await pass(Date.parse('2026-10-09T07:00:00Z'))).toMatchObject({
      quiet: false,
      reminded: 1,
    });
    expect(service.sent.map((request) => messageOf(request).tag)).toEqual([
      `run_reminder:${runId}`,
    ]);
  });

  it('are the same in winter, when Lisbon is on UTC', async () => {
    const { service, pass } = setup();
    await subscribe();
    await addRun(0, { startedAt: new Date('2026-01-15T18:00:00Z') });
    // 22:00 UTC is 22:00 in Lisbon in January, 23:00 in July.
    expect(await pass(Date.parse('2026-01-15T22:00:00Z'))).toMatchObject({ quiet: true });
    expect(await pass(Date.parse('2026-01-15T21:59:00Z'))).toMatchObject({
      quiet: false,
      reminded: 1,
    });
    expect(service.sent).toHaveLength(1);
  });
});

describe('when the push service does not take the message', () => {
  it('is tried again on the next pass if it reached no one for a reason that may pass', async () => {
    let status = 503;
    const { service, pass } = setup(() => status);
    const b = await subscribe();
    await addRun(4);

    expect(await pass()).toEqual({ quiet: false, reminded: 0, postponed: 1 });
    expect(await logged()).toEqual([]);
    const [refused] = await api.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, b.endpoint));
    expect(refused?.failures).toBe(1);

    status = 201;
    expect(await pass(NOON + 15 * 60_000)).toEqual({ quiet: false, reminded: 1, postponed: 0 });
    expect(await logged()).toHaveLength(1);
    expect(service.sent).toHaveLength(2);
    // And now it is done.
    expect(await pass(NOON + 30 * 60_000)).toMatchObject({ reminded: 0, postponed: 0 });
    expect(service.sent).toHaveLength(2);
  });

  it('counts as sent if one of the device’s subscriptions took it', async () => {
    const [bad, good] = [browser(), browser()];
    for (const b of [bad, good]) {
      await api.db.insert(pushSubscriptions).values({
        deviceId: DEVICE,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        locale: 'es',
      });
    }
    const { service, pass } = setup((request) => (request.endpoint === bad.endpoint ? 500 : 201));
    await addRun(4);

    expect(await pass()).toEqual({ quiet: false, reminded: 1, postponed: 0 });
    expect(service.sent.map((request) => request.endpoint).sort()).toEqual(
      [bad.endpoint, good.endpoint].sort(),
    );
    expect(await logged()).toHaveLength(1);
    // Done: the one that refused is not asked again.
    expect(await pass(NOON + 15 * 60_000)).toMatchObject({ reminded: 0, postponed: 0 });
    expect(service.sent).toHaveLength(2);
  });

  it('is dropped, without trying again, when the push service forgot the subscription', async () => {
    const { service, pass } = setup(() => 410);
    await subscribe();
    await addRun(4);

    expect(await pass()).toEqual({ quiet: false, reminded: 0, postponed: 0 });
    expect(await api.db.select().from(pushSubscriptions)).toEqual([]);
    expect(await logged()).toHaveLength(1);
    expect(await pass(NOON + 15 * 60_000)).toMatchObject({ reminded: 0, postponed: 0 });
    expect(service.sent).toHaveLength(1);
  });

  it('is tried again too when the sender itself fails, and the others are not held up', async () => {
    const { asFastify, log } = setup();
    await subscribe();
    await subscribe(OTHER_DEVICE);
    const first = await addRun(5, { deviceId: DEVICE });
    const second = await addRun(4, { deviceId: OTHER_DEVICE });
    const delivered: string[] = [];
    const sender: PushSender = {
      deliver: vi.fn(async (_recipients, messageFor) => {
        const { tag } = messageFor('es');
        if (tag.endsWith(first)) throw new Error('the database went away');
        delivered.push(tag);
        return { sent: 1, gone: 0, failed: 0 };
      }),
    };
    const run = () =>
      runReminders({
        database: () => api.database,
        sender,
        afterHours: 3,
        log: asFastify,
        now: () => NOON,
      });

    expect(await run()).toEqual({ quiet: false, reminded: 1, postponed: 1 });
    expect(delivered).toEqual([`run_reminder:${second}`]);
    expect((await logged()).map((row) => row.ref)).toEqual([second]);
    expect(log.error).toHaveBeenCalledWith({ err: 'Error' }, 'could not send a run reminder');
  });
});

describe('the reminder job', () => {
  it('looks for runs every interval until it is stopped', async () => {
    const { service, sender, asFastify } = setup();
    await subscribe();
    await addRun(4);
    const job = startReminderJob({
      database: () => api.database,
      sender,
      afterHours: 3,
      log: asFastify,
      now: () => NOON,
      intervalMs: 20,
    });
    try {
      await vi.waitFor(() => expect(service.sent).toHaveLength(1), { timeout: 3000 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Once: later passes find the run reminded.
      expect(service.sent).toHaveLength(1);
    } finally {
      await job.stop();
    }
    // A new run after the job stopped waits for nobody.
    await addRun(5);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(service.sent).toHaveLength(1);
  });

  it('does not start a pass while the last one is still going, and stop waits for it', async () => {
    const { asFastify } = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sender: PushSender = {
      deliver: vi.fn(async () => {
        await gate;
        return { sent: 1, gone: 0, failed: 0 };
      }),
    };
    await subscribe();
    await addRun(4);
    const job = startReminderJob({
      database: () => api.database,
      sender,
      afterHours: 3,
      log: asFastify,
      now: () => NOON,
      intervalMs: 10,
    });
    await vi.waitFor(() => expect(sender.deliver).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Many intervals later, the pass has not finished and no other has begun.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sender.deliver).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('survives a pass that fails, and says so without any detail', async () => {
    const { log, asFastify, sender } = setup();
    let calls = 0;
    const job = startReminderJob({
      database: () => {
        calls++;
        if (calls === 1) throw new TypeError('connection string with secrets');
        return api.database;
      },
      sender,
      afterHours: 3,
      log: asFastify,
      now: () => NOON,
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 3000 });
    } finally {
      await job.stop();
    }
    expect(log.error).toHaveBeenCalledWith({ err: 'TypeError' }, 'the run reminders failed');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secrets');
  });
});
