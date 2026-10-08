import { AnalyticsBatchBodySchema } from '@rumbo/api-contract';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { analyticsEvents } from '../db/schema.js';
import { deviceIdFrom, touchDevice } from '../device.js';
import type { DataOptions } from './routes.js';

// Anonymous product events (PROJECT_PLAN §13). The app only sends them with
// the user's consent; the contract refuses anything that looks like a position.

export interface AnalyticsOptions extends DataOptions {
  enabled: boolean;
}

const RunIdSchema = z.uuid();

export const analyticsRoutes: FastifyPluginAsyncZod<AnalyticsOptions> = async (app, options) => {
  app.post(
    '/v1/analytics/batch',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      bodyLimit: 256 * 1024,
      schema: {
        tags: ['analytics'],
        summary: 'A batch of anonymous events (202, stored when analytics are on)',
        body: AnalyticsBatchBodySchema,
        response: { 202: z.object({ accepted: z.number().int() }) },
      },
    },
    async (request, reply) => {
      const database = options.database();
      const { events } = request.body;
      if (!options.enabled || !database) return reply.status(202).send({ accepted: 0 });
      // sendBeacon can't set headers: the id may come in the body instead.
      const deviceId = deviceIdFrom(request) ?? request.body.deviceId ?? null;
      if (deviceId) await touchDevice(database.db, deviceId, request.headers['user-agent']);
      await database.db.insert(analyticsEvents).values(
        events.map((event) => {
          const runId = RunIdSchema.safeParse(event.props.runId);
          return {
            deviceId,
            runId: runId.success ? runId.data : null,
            name: event.name,
            props: event.props,
            clientTs: new Date(event.at),
          };
        }),
      );
      return reply.status(202).send({ accepted: events.length });
    },
  );
};
