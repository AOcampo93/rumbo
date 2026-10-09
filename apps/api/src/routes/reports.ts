import {
  REPORTS_TO_HIDE,
  RouteIdParamsSchema,
  RouteReportBodySchema,
  RouteReportResponseSchema,
} from '@rumbo/api-contract';
import { and, countDistinct, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { isCommunityRoute } from '../community.js';
import { routeReports, routes } from '../db/schema.js';
import { requireDeviceId, touchDevice } from '../device.js';
import { fail } from '../errors.js';
import { addressLimit } from '../limits.js';
import { type DataOptions, requireDatabase } from './routes.js';

// Reports of community routes (phase 7.2, ADR 0004): anyone may report a
// route that others made public, for one of a closed list of reasons. Enough
// devices hide it until the operator reviews it. The answer never says how
// many reports a route has, or whether it was hidden.

export interface ReportRoutesOptions extends DataOptions {
  /** Reports per minute per client address (the device id is the client's choice). */
  rateLimitPerMinute: number;
}

/** A report is a reason: a few dozen bytes. */
const REPORT_BODY_LIMIT = 1024;

export const reportRoutes: FastifyPluginAsyncZod<ReportRoutesOptions> = async (app, options) => {
  const reportLimit = addressLimit(app, [
    { max: options.rateLimitPerMinute, timeWindow: '1 minute' },
  ]);
  const needsDevice = async (request: FastifyRequest) => {
    requireDeviceId(request);
  };

  app.post(
    '/v1/routes/:id/reports',
    {
      onRequest: [reportLimit],
      preValidation: [needsDevice],
      bodyLimit: REPORT_BODY_LIMIT,
      schema: {
        tags: ['routes'],
        summary:
          'Reports a community route (needs X-Device-Id): 201 for a new report, 200 for a repeated one or the owner’s own, 404 for a route that is not public and visible',
        params: RouteIdParamsSchema,
        body: RouteReportBodySchema,
        response: { 200: RouteReportResponseSchema, 201: RouteReportResponseSchema },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const deviceId = requireDeviceId(request);
      const { id } = request.params;
      const { reason } = request.body;

      const { stored, hidden } = await db.transaction(async (tx) => {
        // The route's row stays locked until the end: the reports of one route
        // go one after another, so each counts every report before it and the
        // third device is always the one that hides the route.
        const [route] = await tx
          .select({
            source: routes.source,
            visibility: routes.visibility,
            moderation: routes.moderation,
            ownerDeviceId: routes.ownerDeviceId,
          })
          .from(routes)
          .where(and(eq(routes.id, id), eq(routes.status, 'published')))
          .for('update');
        // Curated, private, hidden, blocked or missing: all the same answer.
        if (!route || !isCommunityRoute(route)) throw fail(404, 'route_not_found');
        // Nobody reports their own route; nothing is kept of the attempt.
        if (route.ownerDeviceId === deviceId) return { stored: false, hidden: false };

        // The unique index lets a device have one open report per route.
        const [report] = await tx
          .insert(routeReports)
          .values({ routeId: id, deviceId, reason })
          .onConflictDoNothing()
          .returning({ id: routeReports.id });
        if (!report) return { stored: false, hidden: false };

        const [open] = await tx
          .select({ devices: countDistinct(routeReports.deviceId) })
          .from(routeReports)
          .where(and(eq(routeReports.routeId, id), isNull(routeReports.resolvedAt)));
        if ((open?.devices ?? 0) < REPORTS_TO_HIDE) return { stored: true, hidden: false };
        await tx
          .update(routes)
          .set({ moderation: 'hidden', moderatedAt: new Date() })
          .where(eq(routes.id, id));
        return { stored: true, hidden: true };
      });

      if (hidden) request.log.info({ routeId: id }, 'route hidden by reports');
      await touchDevice(db, deviceId, request.headers['user-agent']);
      return reply.status(stored ? 201 : 200).send({ received: true });
    },
  );
};
