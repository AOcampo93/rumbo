import {
  RunEndBodySchema,
  RunIdParamsSchema,
  RunStartBodySchema,
  RunStartResponseSchema,
} from '@rumbo/api-contract';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { routes, runs } from '../db/schema.js';
import { requireDeviceId, touchDevice } from '../device.js';
import { fail } from '../errors.js';
import { type DataOptions, requireDatabase } from './routes.js';

// A run's start and end (PROJECT_PLAN §11.1), for the internal metrics:
// started vs finished, time per route, abandonment. Never positions.

const LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

export const runRoutes: FastifyPluginAsyncZod<DataOptions> = async (app, options) => {
  app.post(
    '/v1/runs',
    {
      config: LIMIT,
      schema: {
        tags: ['runs'],
        summary: 'A run starts (needs X-Device-Id)',
        body: RunStartBodySchema,
        response: { 201: RunStartResponseSchema },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const deviceId = requireDeviceId(request);
      const body = request.body;
      const [route] = await db
        .select({ id: routes.id })
        .from(routes)
        .where(eq(routes.id, body.routeId));
      if (!route) throw fail(404, 'route_not_found');
      await touchDevice(db, deviceId, request.headers['user-agent']);
      const [run] = await db
        .insert(runs)
        .values({
          routeId: body.routeId,
          specHash: body.specHash,
          deviceId,
          mode: body.mode,
          simulated: body.simulated,
          locale: body.locale,
          startedAt: new Date(body.startedAt),
        })
        .returning({ id: runs.id });
      return reply.status(201).send({ runId: (run as { id: string }).id });
    },
  );

  app.patch(
    '/v1/runs/:runId',
    {
      config: LIMIT,
      schema: {
        tags: ['runs'],
        summary: 'A run ends (only its device may close it; repeats are no-ops)',
        params: RunIdParamsSchema,
        body: RunEndBodySchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const deviceId = requireDeviceId(request);
      const [run] = await db.select().from(runs).where(eq(runs.id, request.params.runId));
      if (!run) throw fail(404, 'run_not_found');
      if (run.deviceId !== deviceId) throw fail(403, 'forbidden');
      // Clients retry when offline: only the first end counts.
      if (run.status === 'running') {
        const body = request.body;
        await db
          .update(runs)
          .set({
            status: body.status,
            endedAt: new Date(body.endedAt),
            elapsedMs: body.elapsedMs,
            completedPoints: body.completedPoints,
            totalPoints: body.totalPoints,
            score: body.score,
            updatedAt: new Date(),
          })
          .where(eq(runs.id, run.id));
      }
      return reply.status(204).send();
    },
  );
};
