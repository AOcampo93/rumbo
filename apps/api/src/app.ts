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
import { createAiBudget } from './ai/budget.js';
import { createGrounding, type Grounding } from './ai/grounding.js';
import type { AiProvider } from './ai/provider.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/index.js';
import { deviceIdFrom } from './device.js';
import { installErrorHandling } from './errors.js';
import type { GeocodingProvider } from './geo/provider.js';
import { trustProxyHop } from './limits.js';
import { adminGuard } from './push/admin.js';
import { createPush } from './push/index.js';
import type { PushTransport } from './push/send.js';
import { analyticsRoutes } from './routes/analytics.js';
import { contentRoutes } from './routes/content.js';
import { suggestRoutes } from './routes/suggest.js';
import { geoRoutes } from './routes/geo.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { moderationRoutes } from './routes/moderation.js';
import { pushRoutes } from './routes/push.js';
import { reportRoutes } from './routes/reports.js';
import { routeRoutes } from './routes/routes.js';
import { runRoutes } from './routes/runs.js';
import { VERSION } from './version.js';

export interface AppDeps {
  /** The database, for /health even before migrations ran. */
  database: Database | null;
  /** The database once it's ready for queries (migrated); null until then. */
  data: () => Database | null;
  /** Place search; null or absent: /geo answers 503 geocoding_unavailable. */
  geocoder?: GeocodingProvider | null;
  /** Generative AI; null or absent: the AI endpoints answer 503 ai_unavailable. */
  ai?: AiProvider | null;
  /** Wikidata, Wikipedia and Commons for the AI cards; the real ones unless a test brings its own. */
  grounding?: Grounding;
  /** How Web Push messages reach the push services; the real ones unless a test brings its own. */
  pushTransport?: PushTransport;
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
    // Behind Traefik: the client's address is the X-Forwarded-For entry it adds.
    trustProxy: trustProxyHop,
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
        version: VERSION,
        description: 'Errors answer { code }; texts are LocalizedText.',
      },
      servers: [{ url: PUBLIC_PREFIX }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/v1/docs', staticCSP: true });

  await app.register(healthRoutes, {
    version: VERSION,
    commit: config.commit,
    database: deps.database,
  });
  await app.register(routeRoutes, {
    database: deps.data,
    writeRateLimitPerMinute: config.writeRateLimitPerMinute,
    writeRateLimitPerDay: config.writeRateLimitPerDay,
    userRoutesMax: config.userRoutesMax,
    publicOrigin: config.publicOrigin,
  });
  await app.register(reportRoutes, {
    database: deps.data,
    rateLimitPerMinute: config.reportRateLimitPerMinute,
  });
  await app.register(runRoutes, { database: deps.data });
  await app.register(analyticsRoutes, { database: deps.data, enabled: config.analyticsEnabled });
  await app.register(geoRoutes, {
    geocoder: deps.geocoder ?? null,
    rateLimitPerMinute: config.geoRateLimitPerMinute,
  });

  // Phase 7: one budget for every AI endpoint, over the database once it is ready.
  const aiBudget = createAiBudget(() => deps.data()?.db ?? null, config);
  await app.register(contentRoutes, {
    database: deps.data,
    ai: deps.ai ?? null,
    grounding: deps.grounding ?? createGrounding({ userAgent: config.wikimediaUserAgent }),
    budget: aiBudget,
    model: config.aiModel,
    rateLimitPerMinute: config.contentRateLimitPerMinute,
  });
  await app.register(suggestRoutes, {
    ai: deps.ai ?? null,
    budget: aiBudget,
    userAgent: config.wikimediaUserAgent,
    rateLimitPerMinute: config.suggestRateLimitPerMinute,
    model: config.aiModel,
  });

  // The operator's token guards the announcements, the moderation of
  // community routes and the deletion of photos alike, under one budget per
  // address.
  const admin = adminGuard(app, {
    adminToken: config.adminToken,
    rateLimitPerMinute: config.adminRateLimitPerMinute,
  });
  await app.register(moderationRoutes, { database: deps.data, admin });

  // Phase 7.3: the photos users upload as the cover of their routes.
  await app.register(mediaRoutes, {
    database: deps.data,
    admin,
    publicOrigin: config.publicOrigin,
    rateLimitPerMinute: config.mediaRateLimitPerMinute,
    uploadsPerDevicePerDay: config.mediaUploadsPerDevicePerDay,
    maxTotalBytes: Math.floor(config.mediaMaxTotalMb * 1024 * 1024),
  });

  // Web Push: off (503 push_unavailable) unless the VAPID settings are all there and valid.
  const push = createPush(config, {
    database: deps.data,
    log: app.log,
    ...(deps.pushTransport ? { transport: deps.pushTransport } : {}),
  });
  await app.register(pushRoutes, {
    database: deps.data,
    push,
    admin,
    rateLimitPerMinute: config.pushRateLimitPerMinute,
  });
  return app;
}
