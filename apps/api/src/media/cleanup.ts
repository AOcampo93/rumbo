import { and, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import { media } from '../db/schema.js';

// A photo that no route uses is deleted a week after it stopped being used
// (ADR 0005): an upload nobody attached (the user gave up on the route), a
// cover that was changed, a route that was deleted. The week gives a user who
// changes their mind, or whose route was saved offline and uploads days
// later, the chance to use it still.

const HOUR_MS = 3_600_000;

/** How long an unused photo is kept. */
export const UNUSED_PHOTO_HOURS = 7 * 24;
/** How often the job looks for unused photos. */
export const MEDIA_CLEANUP_INTERVAL_MS = HOUR_MS;

export interface MediaCleanupOptions {
  /** Null until migrations ran (or without DATABASE_URL): a pass then does nothing. */
  database: () => Database | null;
  log: FastifyBaseLogger;
  /** The clock; tests move it. */
  now?: () => number;
}

/**
 * One pass: deletes the photos no route uses whose last use ended (or, if
 * they never had one, that were uploaded) more than UNUSED_PHOTO_HOURS ago.
 * Returns how many it deleted. A photo that a route claims at this very
 * moment is not lost: the claim locks its row, and the delete re-checks it.
 */
export async function runMediaCleanup(options: MediaCleanupOptions): Promise<number> {
  const database = options.database();
  if (!database) return 0;
  const before = new Date((options.now ?? Date.now)() - UNUSED_PHOTO_HOURS * HOUR_MS);
  const deleted = await database.db
    .delete(media)
    .where(
      and(
        isNull(media.routeId),
        lt(sql`coalesce(${media.unusedSince}, ${media.createdAt})`, before),
      ),
    )
    .returning({ id: media.id });
  return deleted.length;
}

export interface MediaCleanupJob {
  /** Stops the schedule and waits for the pass in progress. */
  stop(): Promise<void>;
}

/** Runs `runMediaCleanup` every `intervalMs`; a pass that is still going when the next is due makes it wait. */
export function startMediaCleanup(
  options: MediaCleanupOptions & { intervalMs?: number },
): MediaCleanupJob {
  let current: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (current) return;
    current = runMediaCleanup(options)
      .then((deleted) => {
        if (deleted > 0) options.log.info({ deleted }, 'unused photos deleted');
      })
      .catch((error: unknown) => {
        options.log.error(
          { err: error instanceof Error ? error.name : 'unknown' },
          'the photo cleanup failed',
        );
      })
      .finally(() => {
        current = null;
      });
  }, options.intervalMs ?? MEDIA_CLEANUP_INTERVAL_MS);
  // The schedule alone doesn't keep the process alive.
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await current;
    },
  };
}
