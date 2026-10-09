import {
  type ModerationActionBody,
  ModerationActionBodySchema,
  ModerationActionResponseSchema,
  type ModerationItem,
  type ModerationQueueResponse,
  ModerationQueueResponseSchema,
  type ModerationState,
  type ReportReason,
  RouteIdParamsSchema,
  type RouteVisibility,
} from '@rumbo/api-contract';
import type { Locale, LocalizedText } from '@rumbo/route-spec';
import { and, count, eq, exists, inArray, isNull, ne, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { routeReports, routes } from '../db/schema.js';
import { fail } from '../errors.js';
import type { AdminGuard } from '../push/admin.js';
import { bundleOf, type DataOptions, requireDatabase } from './routes.js';

// The operator's side of the community routes (phase 7.2, ADR 0004): what
// readers reported, and the decision on each route. Guarded with ADMIN_TOKEN
// like the push announcements, and available whether push is on or not.

export interface ModerationRoutesOptions extends DataOptions {
  /** The hooks the endpoints are guarded with (the operator's token, shared with the announcements). */
  admin: AdminGuard;
}

/** An action is a single word. */
const ACTION_BODY_LIMIT = 1024;

/** What each action leaves the route as. */
const RESULT: Record<ModerationActionBody['action'], ModerationState> = {
  block: 'blocked',
  restore: 'visible',
};

/** Hidden routes wait for the operator's review, so they come before blocked ones. */
const RANK: Record<ModerationState, number> = { hidden: 0, blocked: 1, visible: 2 };

export const moderationRoutes: FastifyPluginAsyncZod<ModerationRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    '/v1/admin/moderation',
    {
      onRequest: [...options.admin],
      schema: {
        tags: ['admin'],
        summary:
          'The user routes that are hidden, blocked or have open reports, with their reports by reason (Authorization: Bearer ADMIN_TOKEN)',
        response: { 200: ModerationQueueResponseSchema },
      },
    },
    async (_request, reply): Promise<ModerationQueueResponse> => {
      const { db } = requireDatabase(options);
      const open = isNull(routeReports.resolvedAt);
      const rows = await db
        .select({
          id: routes.id,
          name: routes.name,
          locale: routes.locale,
          visibility: routes.visibility,
          moderation: routes.moderation,
          publishedAt: routes.publishedAt,
          updatedAt: routes.updatedAt,
        })
        .from(routes)
        .where(
          and(
            eq(routes.source, 'user'),
            or(
              ne(routes.moderation, 'visible'),
              exists(
                db
                  .select({ id: routeReports.id })
                  .from(routeReports)
                  .where(and(eq(routeReports.routeId, routes.id), open)),
              ),
            ),
          ),
        );

      const byReason = new Map<string, Partial<Record<ReportReason, number>>>();
      if (rows.length > 0) {
        const counts = await db
          .select({ routeId: routeReports.routeId, reason: routeReports.reason, n: count() })
          .from(routeReports)
          .where(
            and(
              open,
              inArray(
                routeReports.routeId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .groupBy(routeReports.routeId, routeReports.reason);
        for (const { routeId, reason, n } of counts) {
          const reports = byReason.get(routeId) ?? {};
          reports[reason as ReportReason] = n;
          byReason.set(routeId, reports);
        }
      }

      const routesInQueue = rows.map((row): ModerationItem => {
        const reports = byReason.get(row.id) ?? {};
        return {
          id: row.id,
          name: row.name as LocalizedText,
          locale: row.locale as Locale,
          visibility: row.visibility as RouteVisibility,
          moderation: row.moderation as ModerationState,
          reports,
          openReports: Object.values(reports).reduce((total, n) => total + n, 0),
          publishedAt: row.publishedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        };
      });
      routesInQueue.sort(
        (a, b) =>
          RANK[a.moderation] - RANK[b.moderation] ||
          b.openReports - a.openReports ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      reply.header('cache-control', 'no-store');
      return { routes: routesInQueue };
    },
  );

  app.get(
    '/v1/admin/routes/:id',
    {
      onRequest: [...options.admin],
      schema: {
        tags: ['admin'],
        summary:
          'A user route as the app reads it, for the operator to review before deciding: only one that is public, reported or moderated (Authorization: Bearer ADMIN_TOKEN)',
        params: RouteIdParamsSchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const { id } = request.params;
      const [row] = await db
        .select({
          id: routes.id,
          spec: routes.spec,
          source: routes.source,
          visibility: routes.visibility,
          moderation: routes.moderation,
        })
        .from(routes)
        .where(eq(routes.id, id));
      // Curated routes are never moderated, and a private route nobody could
      // see (never reported, never moderated) is its owner's alone.
      if (row?.source !== 'user') throw fail(404, 'route_not_found');
      if (row.visibility === 'private' && row.moderation === 'visible') {
        const [reported] = await db
          .select({ id: routeReports.id })
          .from(routeReports)
          .where(eq(routeReports.routeId, id))
          .limit(1);
        if (!reported) throw fail(404, 'route_not_found');
      }
      reply.header('cache-control', 'no-store');
      return bundleOf(db, row);
    },
  );

  app.post(
    '/v1/admin/routes/:id/moderation',
    {
      onRequest: [...options.admin],
      bodyLimit: ACTION_BODY_LIMIT,
      schema: {
        tags: ['admin'],
        summary:
          'Takes a user route down (block) or puts it back (restore); either closes its open reports (Authorization: Bearer ADMIN_TOKEN)',
        params: RouteIdParamsSchema,
        body: ModerationActionBodySchema,
        response: { 200: ModerationActionResponseSchema },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const { id } = request.params;
      const { action } = request.body;
      const moderation = RESULT[action];
      await db.transaction(async (tx) => {
        const [route] = await tx
          .select({ source: routes.source })
          .from(routes)
          .where(eq(routes.id, id))
          .for('update');
        // Curated routes are never moderated.
        if (route?.source !== 'user') throw fail(404, 'route_not_found');
        const now = new Date();
        await tx.update(routes).set({ moderation, moderatedAt: now }).where(eq(routes.id, id));
        await tx
          .update(routeReports)
          .set({ resolvedAt: now })
          .where(and(eq(routeReports.routeId, id), isNull(routeReports.resolvedAt)));
      });
      request.log.info({ routeId: id, action }, 'route moderated');
      reply.header('cache-control', 'no-store');
      return { id, moderation };
    },
  );
};
