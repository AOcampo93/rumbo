import { isLocale, type Locale } from '@rumbo/route-spec';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import webpush from 'web-push';
import type { Database, Db } from '../db/index.js';
import { pushSubscriptions } from '../db/schema.js';
import { fail } from '../errors.js';
import type { Vapid } from './vapid.js';

// Sending Web Push messages (RFC 8030). The transport, which talks to the push
// services, is injected: the real one wraps the `web-push` library (MPL-2.0,
// used as it is, so it asks nothing of this code) for the encryption of
// RFC 8291 and the VAPID signature of RFC 8292, and tests bring their own. The
// sender around it keeps the subscriptions honest: the ones a push service no
// longer knows are deleted, and the ones it keeps refusing are counted and, in
// the end, dropped. Neither the endpoints nor the keys are ever logged.

/** What the service worker shows: the JSON of every push. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification goes: a path on this site. */
  url: string;
  /** A notification with the same tag replaces the previous one. */
  tag: string;
}

/** A stored subscription, as far as sending is concerned. */
export interface PushRecipient {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
}

export function recipientOf(row: typeof pushSubscriptions.$inferSelect): PushRecipient {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    locale: isLocale(row.locale) ? row.locale : 'es',
  };
}

/** One message for one subscription. */
export interface PushRequest {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The JSON of a PushMessage; the transport encrypts it. */
  payload: string;
  ttlSeconds: number;
  urgency: 'normal';
}

/**
 * What the push service answered: its HTTP status, or 0 when it never did
 * (`reason` then says why, without the address it was sent to).
 */
export interface PushResponse {
  status: number;
  reason?: string;
}

export type PushTransport = (request: PushRequest) => Promise<PushResponse>;

/** How long a push service keeps a message it can't deliver yet: a day, after which a reminder is stale. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Consecutive refusals (other than "gone") after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 10;
/** Deliveries in flight at once. */
const CONCURRENCY = 10;
/** The push service's idle limit. */
const SOCKET_TIMEOUT_MS = 10_000;

/** A network error's code (ECONNRESET…) or its kind: nothing that could hold an address or a key. */
function failureReason(error: unknown): string {
  if (error instanceof Error && error.message === 'Socket timeout') return 'timeout';
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  return error instanceof Error ? error.name : 'unknown';
}

/** The `web-push` library over HTTPS, signing with the server's VAPID identity. */
export function createWebPushTransport(vapid: Vapid): PushTransport {
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };
  return async (request) => {
    try {
      const result = await webpush.sendNotification(
        { endpoint: request.endpoint, keys: { p256dh: request.p256dh, auth: request.auth } },
        request.payload,
        {
          vapidDetails,
          TTL: request.ttlSeconds,
          urgency: request.urgency,
          timeout: SOCKET_TIMEOUT_MS,
        },
      );
      return { status: result.statusCode };
    } catch (error) {
      // A refusal carries the push service's status. The error itself also
      // holds the endpoint and the answer's body, and none of it is kept.
      if (error instanceof webpush.WebPushError) return { status: error.statusCode };
      return { status: 0, reason: failureReason(error) };
    }
  };
}

/** What became of one message. */
export interface PushTally {
  /** The push service accepted it. */
  sent: number;
  /** The push service no longer knows the subscription (404, 410): it was deleted. */
  gone: number;
  /** Refused or unreachable: counted against the subscription. */
  failed: number;
}

export interface PushSender {
  /**
   * Sends each recipient the message written for its language. Never rejects
   * because of a push service; it rejects only when the database is not ready.
   */
  deliver(
    recipients: readonly PushRecipient[],
    messageFor: (locale: Locale) => PushMessage,
  ): Promise<PushTally>;
}

export interface SenderOptions {
  /** Null until migrations ran (or without DATABASE_URL). */
  database: () => Database | null;
  transport: PushTransport;
  log: FastifyBaseLogger;
  now?: () => number;
}

type Outcome = keyof PushTally;

const outcomeOf = (status: number): Outcome =>
  status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'gone' : 'failed';

/** Runs `work` on every item, `limit` at a time. */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function createPushSender(options: SenderOptions): PushSender {
  const now = options.now ?? Date.now;

  /** What the answer means for the subscription's row. */
  async function settle(db: Db, recipient: PushRecipient, outcome: Outcome): Promise<void> {
    const row = eq(pushSubscriptions.id, recipient.id);
    if (outcome === 'sent') {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(now()), failures: 0 })
        .where(row);
    } else if (outcome === 'gone') {
      await db.delete(pushSubscriptions).where(row);
    } else {
      const [updated] = await db
        .update(pushSubscriptions)
        .set({ failures: sql`${pushSubscriptions.failures} + 1` })
        .where(row)
        .returning({ failures: pushSubscriptions.failures });
      if (updated && updated.failures >= MAX_PUSH_FAILURES) {
        await db.delete(pushSubscriptions).where(row);
      }
    }
  }

  return {
    async deliver(recipients, messageFor) {
      const database = options.database();
      if (!database) throw fail(503, 'unavailable');
      const tally: PushTally = { sent: 0, gone: 0, failed: 0 };
      // Why messages were refused: status (or reason) → how many. No addresses.
      const refusals = new Map<string, number>();
      // Each language's message is written once, before anything is sent: a
      // message that can't be written is a bug, not a subscription's failure.
      const payloads = new Map<Locale, string>();
      for (const { locale } of recipients) {
        if (!payloads.has(locale)) payloads.set(locale, JSON.stringify(messageFor(locale)));
      }

      await inParallel(recipients, CONCURRENCY, async (recipient) => {
        let response: PushResponse;
        try {
          response = await options.transport({
            endpoint: recipient.endpoint,
            p256dh: recipient.p256dh,
            auth: recipient.auth,
            payload: payloads.get(recipient.locale) as string,
            ttlSeconds: PUSH_TTL_SECONDS,
            urgency: 'normal',
          });
        } catch (error) {
          response = { status: 0, reason: failureReason(error) };
        }
        const outcome = outcomeOf(response.status);
        tally[outcome]++;
        if (outcome === 'failed') {
          const why = String(response.status || response.reason || 'unknown');
          refusals.set(why, (refusals.get(why) ?? 0) + 1);
        }
        try {
          await settle(database.db, recipient, outcome);
        } catch (error) {
          // The message went (or didn't) either way; the row is only bookkeeping.
          options.log.error(
            { err: error instanceof Error ? error.name : 'unknown' },
            'could not record the outcome of a push',
          );
        }
      });

      if (refusals.size > 0) {
        options.log.warn({ refused: Object.fromEntries(refusals) }, 'push messages not delivered');
      }
      return tally;
    },
  };
}
