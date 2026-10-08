import { asc, eq, gt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pushSubscriptions } from '../db/schema.js';
import { requireDeviceId, touchDevice } from '../device.js';
import { fail } from '../errors.js';
import { addressLimit } from '../limits.js';
import { bearerMatches, usableAdminToken } from '../push/admin.js';
import type { Push } from '../push/index.js';
import { announcementMessage } from '../push/messages.js';
import {
  AnnouncementBodySchema,
  AnnouncementResponseSchema,
  PushKeyResponseSchema,
  PushSubscribeBodySchema,
  PushUnsubscribeBodySchema,
} from '../push/schemas.js';
import { type PushTally, recipientOf } from '../push/send.js';
import { type DataOptions, requireDatabase } from './routes.js';

// Web Push (PROJECT_PLAN §10.5): the browser asks for the server's key,
// subscribes with it and tells us where the push service delivers; from then
// on the server can remind a device of an unfinished run, and the operator
// can announce something to everyone. Push never reports an arrival: the
// server doesn't know where anyone is. Neither endpoints nor keys are ever
// logged: the request log keeps only the path, and these travel in the body.

export interface PushRoutesOptions extends DataOptions {
  /** Null: push is off (no or malformed VAPID settings) and every endpoint answers 503 push_unavailable. */
  push: Push | null;
  /** ADMIN_TOKEN; null, or too short to trust: the announcement endpoint answers 404. */
  adminToken: string | null;
  /** Subscribing and unsubscribing per minute per client address. */
  rateLimitPerMinute: number;
  /** Announcements, and wrong tokens, per minute per client address. */
  adminRateLimitPerMinute: number;
}

/** A subscription is an address and two keys: well under 4 KB. */
const SUBSCRIPTION_BODY_LIMIT = 4 * 1024;
/** An announcement is three titles and three bodies. */
const ANNOUNCEMENT_BODY_LIMIT = 16 * 1024;
/** Subscriptions read at a time when announcing. */
const PAGE = 500;

export const pushRoutes: FastifyPluginAsyncZod<PushRoutesOptions> = async (app, options) => {
  const adminToken = usableAdminToken(options.adminToken);
  const subscriptionLimit = addressLimit(app, [
    { max: options.rateLimitPerMinute, timeWindow: '1 minute' },
  ]);
  const adminLimit = addressLimit(app, [
    { max: options.adminRateLimitPerMinute, timeWindow: '1 minute' },
  ]);

  const pushOrFail = (): Push => {
    if (!options.push) throw fail(503, 'push_unavailable');
    return options.push;
  };
  /** Checked before the body is read, so what push is doing doesn't depend on what was sent. */
  const pushOn = async () => {
    pushOrFail();
  };
  const needsDevice = async (request: FastifyRequest) => {
    requireDeviceId(request);
  };

  app.get(
    '/v1/push/key',
    {
      onRequest: [pushOn],
      schema: {
        tags: ['push'],
        summary:
          "The server's VAPID public key, to subscribe with (503 push_unavailable if push is off)",
        response: { 200: PushKeyResponseSchema },
      },
    },
    async (_request, reply) => {
      // The same until the key pair is replaced, which invalidates every subscription anyway.
      reply.header('cache-control', 'public, max-age=3600');
      return { publicKey: pushOrFail().vapid.publicKey };
    },
  );

  app.post(
    '/v1/push/subscriptions',
    {
      onRequest: [pushOn, subscriptionLimit],
      preValidation: [needsDevice],
      bodyLimit: SUBSCRIPTION_BODY_LIMIT,
      schema: {
        tags: ['push'],
        summary:
          'Registers (or refreshes) the browser’s push subscription for this device and language (needs X-Device-Id; 201)',
        body: PushSubscribeBodySchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const deviceId = requireDeviceId(request);
      const { endpoint, keys, locale } = request.body;
      await touchDevice(db, deviceId, request.headers['user-agent']);
      // The endpoint identifies the browser: registering it again, from this
      // device or another one (the device id was reset), takes it over.
      await db
        .insert(pushSubscriptions)
        .values({ deviceId, endpoint, p256dh: keys.p256dh, auth: keys.auth, locale })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { deviceId, p256dh: keys.p256dh, auth: keys.auth, locale, failures: 0 },
        });
      return reply.status(201).send();
    },
  );

  app.delete(
    '/v1/push/subscriptions',
    {
      onRequest: [pushOn, subscriptionLimit],
      bodyLimit: SUBSCRIPTION_BODY_LIMIT,
      schema: {
        tags: ['push'],
        summary: 'Forgets a push subscription by its endpoint (204, also when it is unknown)',
        body: PushUnsubscribeBodySchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, request.body.endpoint));
      return reply.status(204).send();
    },
  );

  app.post(
    '/v1/admin/push',
    {
      onRequest: [
        // Without a token the endpoint doesn't exist.
        async () => {
          if (!adminToken) throw fail(404, 'not_found');
        },
        adminLimit,
        async (request) => {
          if (!adminToken || !bearerMatches(request.headers.authorization, adminToken)) {
            throw fail(403, 'forbidden');
          }
        },
        pushOn,
      ],
      bodyLimit: ANNOUNCEMENT_BODY_LIMIT,
      schema: {
        tags: ['admin'],
        summary:
          'Announces something to every subscription, each in its language (Authorization: Bearer ADMIN_TOKEN)',
        body: AnnouncementBodySchema,
        response: { 200: AnnouncementResponseSchema },
      },
    },
    async (request) => {
      const { db } = requireDatabase(options);
      const { sender } = pushOrFail();
      const announcement = request.body;
      // A notification with the same tag replaces the previous one: each announcement has its own.
      const tag = `announcement:${Math.floor(Date.now() / 1000)}`;
      const total: PushTally = { sent: 0, gone: 0, failed: 0 };
      // In pages by id: subscriptions the push service forgot are deleted along the way.
      let after = 0;
      for (;;) {
        const page = await db
          .select()
          .from(pushSubscriptions)
          .where(gt(pushSubscriptions.id, after))
          .orderBy(asc(pushSubscriptions.id))
          .limit(PAGE);
        const last = page.at(-1);
        if (!last) break;
        const tally = await sender.deliver(page.map(recipientOf), (locale) =>
          announcementMessage(announcement, locale, tag),
        );
        total.sent += tally.sent;
        total.gone += tally.gone;
        total.failed += tally.failed;
        after = last.id;
      }
      const failed = total.failed + total.gone;
      request.log.info({ sent: total.sent, failed }, 'announcement sent');
      return { sent: total.sent, failed };
    },
  );
};
