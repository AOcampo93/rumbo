import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';

// Read at runtime so it works from src/ (tsx) and dist/ (node) alike.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export interface HealthResponse {
  status: 'ok';
  version: string;
  commit: string | null;
  db: 'ok' | 'error' | 'disabled';
  time: string;
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
export function buildApp(
  config: AppConfig,
  db: Database | null,
  options: BuildOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    rewriteUrl: (req) => stripPublicPrefix(req.url ?? '/'),
  });

  // Always 200: a database outage must not make Coolify restart (or roll back)
  // an otherwise healthy API. Readiness details travel in the body.
  app.get('/v1/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version,
    commit: config.commit,
    db: db ? ((await db.ping()) ? 'ok' : 'error') : 'disabled',
    time: new Date().toISOString(),
  }));

  return app;
}
