import { type HealthResponse, HealthResponseSchema } from '@rumbo/api-contract';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Database } from '../db/index.js';

export interface HealthOptions {
  version: string;
  commit: string | null;
  database: Database | null;
}

/**
 * Always 200: a database outage must not make Coolify restart (or roll back)
 * an otherwise healthy API. Readiness details travel in the body.
 */
export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (app, options) => {
  app.get(
    '/v1/health',
    { schema: { tags: ['health'], response: { 200: HealthResponseSchema } } },
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      version: options.version,
      commit: options.commit,
      db: options.database ? ((await options.database.ping()) ? 'ok' : 'error') : 'disabled',
      time: new Date().toISOString(),
    }),
  );
};
