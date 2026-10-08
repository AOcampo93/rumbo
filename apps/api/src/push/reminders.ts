import { truncateText } from '@rumbo/route-builder';
import { isLocale, type Locale, type LocalizedText, resolveText } from '@rumbo/route-spec';
import { and, asc, eq, exists, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import { pushLog, pushSubscriptions, routes, runs } from '../db/schema.js';
import { REMINDER_KIND, reminderMessage } from './messages.js';
import { type PushRecipient, type PushSender, type PushTally, recipientOf } from './send.js';

// The one reminder a run gets (PROJECT_PLAN §10.5): hours after a run starts
// without ending, its device is asked "shall we go on?". The server never
// knows where anyone is, so this is all push can say about a run: it can't
// report an arrival. Every pass looks at the runs that are due and whose
// device has a subscription; the run's (kind, ref) row in push_log is claimed
// before sending, so a run is reminded once even if two passes overlap.

const HOUR_MS = 3_600_000;

/** How often the job looks for runs that are due. */
export const REMINDER_INTERVAL_MS = 15 * 60_000;
/**
 * A reminder is worth sending for this long after it came due (it waits out
 * a night of quiet hours); later it is stale. It also keeps a run that was
 * never closed (the app was deleted) from being reminded weeks afterwards, as
 * soon as its device subscribes.
 */
export const REMINDER_WINDOW_HOURS = 24;
/** Runs reminded per pass at most; the rest wait for the next one. */
export const REMINDER_BATCH = 200;

/** Nobody is notified from 22:00 to 08:00 in Portugal, whatever country they are in. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 8;
const LISBON_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Whether `time` (epoch ms) falls in the quiet hours of Europe/Lisbon, summer time included. */
export function isQuietTime(time: number): boolean {
  const hour = Number(LISBON_HOUR.formatToParts(time).find((part) => part.type === 'hour')?.value);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

export interface ReminderOptions {
  /** Null until migrations ran (or without DATABASE_URL): a pass then does nothing. */
  database: () => Database | null;
  sender: PushSender;
  /** Hours after a run starts at which the reminder is due. */
  afterHours: number;
  log: FastifyBaseLogger;
  /** The clock; tests move it. */
  now?: () => number;
}

export interface ReminderTally {
  /** Inside the quiet hours: nothing was looked at. */
  quiet: boolean;
  /** Runs reminded: at least one subscription of the device took the message. */
  reminded: number;
  /** Runs whose reminder could not go out now (the push service was down…): the next pass tries again. */
  postponed: number;
}

interface DueRun {
  runId: string;
  deviceId: string;
  routeName: unknown;
  routeLocale: string;
}

/** The route's name in the subscription's language: a curated route's LocalizedText, or a user route's plain string. */
function routeNameIn(run: DueRun, locale: Locale): string {
  const source = isLocale(run.routeLocale) ? run.routeLocale : 'es';
  return truncateText(resolveText(run.routeName as LocalizedText, locale, source).text, 80);
}

/**
 * Running runs that started between `afterHours` and `afterHours` + a day
 * ago, whose device has a subscription and which have not been reminded yet,
 * oldest first.
 */
async function dueRuns(database: Database, now: number, afterHours: number): Promise<DueRun[]> {
  const { db } = database;
  const dueBefore = new Date(now - afterHours * HOUR_MS);
  const staleBefore = new Date(now - (afterHours + REMINDER_WINDOW_HOURS) * HOUR_MS);
  const reminded = db
    .select({ one: sql`1` })
    .from(pushLog)
    .where(and(eq(pushLog.kind, REMINDER_KIND), eq(pushLog.ref, sql`${runs.id}::text`)));
  const subscribed = db
    .select({ one: sql`1` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.deviceId, runs.deviceId));
  return db
    .select({
      runId: runs.id,
      deviceId: runs.deviceId,
      routeName: routes.name,
      routeLocale: routes.locale,
    })
    .from(runs)
    .innerJoin(routes, eq(routes.id, runs.routeId))
    .where(
      and(
        eq(runs.status, 'running'),
        lt(runs.startedAt, dueBefore),
        gt(runs.startedAt, staleBefore),
        notExists(reminded),
        exists(subscribed),
      ),
    )
    .orderBy(asc(runs.startedAt))
    .limit(REMINDER_BATCH);
}

/**
 * One pass: reminds the runs that are due, unless it is night in Portugal
 * (the pass at 08:00 then sends what waited). A run whose reminder reached
 * no one for a reason that may pass is released and tried again next time.
 */
export async function runReminders(options: ReminderOptions): Promise<ReminderTally> {
  const tally: ReminderTally = { quiet: false, reminded: 0, postponed: 0 };
  const now = (options.now ?? Date.now)();
  if (isQuietTime(now)) return { ...tally, quiet: true };
  const database = options.database();
  if (!database) return tally;
  const { db } = database;

  const due = await dueRuns(database, now, options.afterHours);
  if (due.length === 0) return tally;
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.deviceId, [...new Set(due.map((run) => run.deviceId))]));
  const byDevice = new Map<string, PushRecipient[]>();
  for (const row of subscriptions) {
    byDevice.set(row.deviceId, [...(byDevice.get(row.deviceId) ?? []), recipientOf(row)]);
  }

  for (const run of due) {
    const recipients = byDevice.get(run.deviceId);
    if (!recipients?.length) continue;
    try {
      // Claimed before sending: whoever inserts the row sends the reminder.
      const [claim] = await db
        .insert(pushLog)
        .values({ deviceId: run.deviceId, kind: REMINDER_KIND, ref: run.runId })
        .onConflictDoNothing()
        .returning({ id: pushLog.id });
      if (!claim) continue;
      let outcome: PushTally | null = null;
      try {
        outcome = await options.sender.deliver(recipients, (locale) =>
          reminderMessage(locale, routeNameIn(run, locale), run.runId),
        );
      } finally {
        // Reached no one for a reason that may pass (the push service was
        // down…): released, so the next pass tries again. If every
        // subscription was gone there is nothing left to retry.
        if (!outcome || (outcome.sent === 0 && outcome.failed > 0)) {
          await db.delete(pushLog).where(eq(pushLog.id, claim.id));
        }
      }
      if (outcome.sent > 0) tally.reminded++;
      else if (outcome.failed > 0) tally.postponed++;
    } catch (error) {
      tally.postponed++;
      options.log.error(
        { err: error instanceof Error ? error.name : 'unknown' },
        'could not send a run reminder',
      );
    }
  }
  return tally;
}

export interface ReminderJob {
  /** Stops the schedule and waits for the pass in progress. */
  stop(): Promise<void>;
}

/** Runs `runReminders` every `intervalMs`; a pass that is still going when the next is due makes it wait. */
export function startReminderJob(options: ReminderOptions & { intervalMs?: number }): ReminderJob {
  let current: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (current) return;
    current = runReminders(options)
      .then((tally) => {
        if (tally.reminded > 0 || tally.postponed > 0) options.log.info(tally, 'run reminders');
      })
      .catch((error: unknown) => {
        options.log.error(
          { err: error instanceof Error ? error.name : 'unknown' },
          'the run reminders failed',
        );
      })
      .finally(() => {
        current = null;
      });
  }, options.intervalMs ?? REMINDER_INTERVAL_MS);
  // The schedule alone doesn't keep the process alive.
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await current;
    },
  };
}
