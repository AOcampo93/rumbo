import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { media } from '../src/db/schema.js';
import {
  MEDIA_CLEANUP_INTERVAL_MS,
  runMediaCleanup,
  startMediaCleanup,
  UNUSED_PHOTO_HOURS,
} from '../src/media/cleanup.js';
import { resetDatabase, setupApi } from './helpers.js';
import { download, insertPhoto, photoRow, storePhoto, type Api } from './media-helpers.js';
import { create } from './community-helpers.js';
import { userRoute } from './helpers.js';

// The cleanup of the photos no route uses (phase 7.3, ADR 0005): a photo is
// deleted a week after it stopped being used, or after it was uploaded if no
// route ever used it. The clock is injected; the database is real.

const HOUR = 3_600_000;
/** The user route the photos below may belong to. */
const ROUTE_ID = 'leiria-a-pe-abc123defg';
/** How long an unused photo is kept (a week). */
const KEPT = UNUSED_PHOTO_HOURS * HOUR;
/** A fixed "now" for the passes; the rows are placed relative to it. */
const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms);

let api: Api;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());
beforeEach(() => resetDatabase(api.database));

function logger() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { log, asFastify: log as unknown as FastifyBaseLogger };
}

const pass = (now = NOW) =>
  runMediaCleanup({ database: () => api.database, log: logger().asFastify, now: () => now });
const remaining = async () =>
  (await api.db.select({ id: media.id }).from(media)).map((row) => row.id);

describe('which photos a pass deletes', () => {
  it('keeps an unused photo for exactly 24 hours after it stopped being used', async () => {
    const justOver = await insertPhoto(api, { unusedSince: ago(KEPT + 1) });
    const exactly = await insertPhoto(api, { unusedSince: ago(KEPT) });
    const nearly = await insertPhoto(api, { unusedSince: ago(KEPT - 60_000) });
    const fresh = await insertPhoto(api, { unusedSince: ago(0) });

    expect(await pass()).toBe(1);
    expect((await remaining()).sort()).toEqual([exactly, nearly, fresh].sort());
    expect(await photoRow(api, justOver)).toBeUndefined();
    // A little later the one that was exactly a day old is over it too.
    expect(await pass(NOW + 1)).toBe(1);
    expect(await photoRow(api, exactly)).toBeUndefined();
  });

  it('counts a photo no route ever used from its upload', async () => {
    const abandoned = await insertPhoto(api, { createdAt: ago(KEPT + HOUR) });
    const exactly = await insertPhoto(api, { createdAt: ago(KEPT) });
    const recent = await insertPhoto(api, { createdAt: ago(2 * HOUR) });

    expect(await pass()).toBe(1);
    expect(await photoRow(api, abandoned)).toBeUndefined();
    expect((await remaining()).sort()).toEqual([exactly, recent].sort());
  });

  it('counts from when the photo stopped being used, not from when it was uploaded', async () => {
    // Uploaded a month ago, a route used it until an hour ago.
    const released = await insertPhoto(api, { createdAt: ago(30 * KEPT), unusedSince: ago(HOUR) });
    expect(await pass()).toBe(0);
    expect(await photoRow(api, released)).toBeDefined();
    expect(await pass(NOW + KEPT)).toBe(1);
  });

  it('never touches a photo a route uses, however old', async () => {
    const owned = await create(api, ROUTE_ID, { spec: userRoute() });
    expect(owned.statusCode).toBe(201);
    const attached = await insertPhoto(api, {
      routeId: ROUTE_ID,
      createdAt: ago(365 * KEPT),
    });
    // Attached with a stale mark that nobody cleared: attached wins.
    const marked = await insertPhoto(api, {
      routeId: ROUTE_ID,
      createdAt: ago(365 * KEPT),
      unusedSince: ago(364 * KEPT),
    });
    expect(await pass()).toBe(0);
    expect((await remaining()).sort()).toEqual([attached, marked].sort());
  });

  it('answers how many it deleted, and 0 for an empty table', async () => {
    expect(await pass()).toBe(0);
    for (let i = 0; i < 5; i++) await insertPhoto(api, { createdAt: ago(2 * KEPT) });
    const kept = await insertPhoto(api);
    expect(await pass()).toBe(5);
    expect(await remaining()).toEqual([kept]);
    expect(await pass()).toBe(0);
  });

  it('does nothing before the database is ready', async () => {
    await insertPhoto(api, { createdAt: ago(2 * KEPT) });
    const { asFastify } = logger();
    expect(await runMediaCleanup({ database: () => null, log: asFastify, now: () => NOW })).toBe(0);
    expect(await remaining()).toHaveLength(1);
  });

  it('removes the photo from what the server serves', async () => {
    const photo = await storePhoto(api);
    expect((await download(api, `${photo.id}.jpg`)).statusCode).toBe(200);
    await api.db
      .update(media)
      .set({ createdAt: new Date(Date.now() - KEPT - HOUR) })
      .where(eq(media.id, photo.id));
    expect(await runMediaCleanup({ database: () => api.database, log: logger().asFastify })).toBe(
      1,
    );
    const gone = await download(api, `${photo.id}.jpg`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ code: 'not_found' });
  });

  it('leaves a photo that a route claims at the very same moment', async () => {
    const id = await insertPhoto(api, { createdAt: ago(2 * KEPT) });
    const routeId = ROUTE_ID;
    expect((await create(api, routeId, { spec: userRoute(routeId) })).statusCode).toBe(201);

    let claimed: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    let commit: () => void = () => {};
    const release = new Promise<void>((resolve) => {
      commit = resolve;
    });
    // The route claims the photo and holds the row until we say so.
    const claiming = api.db.transaction(async (tx) => {
      await tx.update(media).set({ routeId, unusedSince: null }).where(eq(media.id, id));
      claimed();
      await release;
    });
    await locked;
    // The pass starts while the row is claimed but not yet committed: it waits for it…
    const cleaning = pass();
    await new Promise((resolve) => setTimeout(resolve, 150));
    commit();
    await claiming;
    // …and then sees a photo that is used.
    expect(await cleaning).toBe(0);
    expect(await photoRow(api, id)).toMatchObject({ routeId });
  });

  it('can use its index: unattached photos by the time they stopped being used', async () => {
    await insertPhoto(api);
    const plan = await api.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const { rows } = await tx.execute(
        sql`explain select id from media where route_id is null and coalesce(unused_since, created_at) < now()`,
      );
      return rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    });
    expect(plan).toContain('media_unused_idx');
  });

  it('has an index for the photos a device uploaded in the last day', async () => {
    await insertPhoto(api);
    const plan = await api.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const { rows } = await tx.execute(
        sql`explain select count(*) from media where device_id = '6f1d1c1e-3a7b-4c1e-9d0f-2b6a7c8d9e01' and created_at > now() - interval '1 day'`,
      );
      return rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    });
    expect(plan).toContain('media_device_created_idx');
  });
});

describe('the job', () => {
  it('runs every hour unless told otherwise', () => {
    expect(MEDIA_CLEANUP_INTERVAL_MS).toBe(HOUR);
    expect(UNUSED_PHOTO_HOURS).toBe(7 * 24);
  });

  it('deletes what is due, says how many, and says nothing when there is nothing', async () => {
    const { log, asFastify } = logger();
    await insertPhoto(api, { createdAt: ago(2 * KEPT) });
    await insertPhoto(api, { unusedSince: ago(3 * KEPT) });
    const kept = await insertPhoto(api, { createdAt: ago(HOUR) });
    const job = startMediaCleanup({
      database: () => api.database,
      log: asFastify,
      now: () => NOW,
      intervalMs: 20,
    });
    try {
      await vi.waitFor(() => expect(log.info).toHaveBeenCalledTimes(1), { timeout: 3000 });
      // Later passes find nothing and stay quiet.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(log.info).toHaveBeenCalledTimes(1);
    } finally {
      await job.stop();
    }
    expect(log.info).toHaveBeenCalledWith({ deleted: 2 }, 'unused photos deleted');
    expect(log.error).not.toHaveBeenCalled();
    expect(await remaining()).toEqual([kept]);

    // Stopped: a photo that becomes due now waits for nobody.
    await insertPhoto(api, { createdAt: ago(5 * KEPT) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await remaining()).toHaveLength(2);
  });

  it('does not start a pass while the last one is still going, and stop waits for it', async () => {
    const { asFastify } = logger();
    const id = await insertPhoto(api, { createdAt: ago(2 * KEPT) });
    let passes = 0;
    let commit: () => void = () => {};
    const release = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let held: () => void = () => {};
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // Another transaction holds the photo's row, so the pass's DELETE waits for it.
    const lock = api.db.transaction(async (tx) => {
      await tx.select().from(media).where(eq(media.id, id)).for('update');
      held();
      await release;
    });
    await holding;

    const job = startMediaCleanup({
      database: () => {
        passes++;
        return api.database;
      },
      log: asFastify,
      now: () => NOW,
      intervalMs: 10,
    });
    await vi.waitFor(() => expect(passes).toBe(1), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(passes).toBe(1);

    let stopped = false;
    const stopping = job.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    commit();
    await lock;
    await stopping;
    expect(stopped).toBe(true);
    expect(await photoRow(api, id)).toBeUndefined();
  });

  it('survives a pass that fails, and says so without any detail', async () => {
    const { log, asFastify } = logger();
    let calls = 0;
    const job = startMediaCleanup({
      database: () => {
        calls++;
        if (calls === 1) throw new TypeError('connection string with secrets');
        return api.database;
      },
      log: asFastify,
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 3000 });
    } finally {
      await job.stop();
    }
    expect(log.error).toHaveBeenCalledWith({ err: 'TypeError' }, 'the photo cleanup failed');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secrets');
  });
});
