import { readFileSync } from 'node:fs';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { deviceIdFrom } from './device.js';
import { installErrorHandling } from './errors.js';
import { analyticsRoutes } from './routes/analytics.js';
import { healthRoutes } from './routes/health.js';
import { routeRoutes } from './routes/routes.js';
import { runRoutes } from './routes/runs.js';

// Read at runtime so it works from src/ (tsx) and dist/ (node) alike.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export interface AppDeps {
  /** The database, for /health even before migrations ran. */
  database: Database | null;
  /** The database once it's ready for queries (migrated); null until then. */
  data: () => Database | null;
}

export interface BuildOptions {
  /** Tests turn logging off; production logs JSON lines (never coordinates). */
  logger?: boolean;
}

/** Public mount point: clients always call /api/v1/…, on the web's own origin. */
export const PUBLIC_PREFIX = '/api';

/**
 * Removes the public prefix when it is still present. Traefik strips it or not
 * depending on Coolify's "Strip Prefixes" setting, and the Vite dev proxy keeps
 * it, so routes are declared without it (/v1/…) and work behind any of them.
 */
export function stripPublicPrefix(url: string): string {
  if (url === PUBLIC_PREFIX) return '/';
  return url.startsWith(`${PUBLIC_PREFIX}/`) ? url.slice(PUBLIC_PREFIX.length) : url;
}

/** Builds the app without listening, so tests can drive it with `app.inject`. */
export async function buildApp(
  config: AppConfig,
  deps: AppDeps,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            // Paths only: query strings may carry a position (?near=lat,lng).
            serializers: {
              req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
            },
          },
    rewriteUrl: (req) => stripPublicPrefix(req.url ?? '/'),
    // Behind Traefik: the client's address is in X-Forwarded-For.
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandling(app);

  // JSON only, same origin as the web: no CORS. The docs page brings its own CSP.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (request) => deviceIdFrom(request) ?? request.ip,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Rumbo API',
        version,
        description: 'Errors answer { code }; texts are LocalizedText.',
      },
      servers: [{ url: PUBLIC_PREFIX }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/v1/docs', staticCSP: true });

  await app.register(healthRoutes, { version, commit: config.commit, database: deps.database });
  await app.register(routeRoutes, { database: deps.data });
  await app.register(runRoutes, { database: deps.data });
  await app.register(analyticsRoutes, { database: deps.data, enabled: config.analyticsEnabled });
  return app;
}
