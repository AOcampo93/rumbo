import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRouteSpec, type DraftPlace } from '@rumbo/route-builder';
import type { RouteSpec } from '@rumbo/route-spec';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { type AppDeps, buildApp } from '../src/app.js';
import { type AppConfig, loadConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/index.js';

export const CURATED = new URL('../../../data/routes/', import.meta.url);
export const DEVICE = '6f1d1c1e-3a7b-4c1e-9d0f-2b6a7c8d9e01';
export const OTHER_DEVICE = '0b7e9c2a-5d4f-4a8b-8c1d-3e2f1a0b9c87';

// Edit tokens made at run time from fixed bytes: a literal that looks
// random would trip the secret scan of the repository's history.
export const TOKEN = Buffer.alloc(32, 7).toString('base64url');
export const OTHER_TOKEN = Buffer.alloc(32, 8).toString('base64url');

/** Limits high enough for any test; the limit tests lower them. */
const ROOMY_LIMITS: Partial<AppConfig> = {
  writeRateLimitPerMinute: 10_000,
  writeRateLimitPerDay: 100_000,
  geoRateLimitPerMinute: 10_000,
  contentRateLimitPerMinute: 10_000,
  suggestRateLimitPerMinute: 10_000,
  pushRateLimitPerMinute: 10_000,
  adminRateLimitPerMinute: 10_000,
  reportRateLimitPerMinute: 10_000,
};

/** The API on the test database, with everything empty. */
export async function setupApi(
  overrides: Partial<AppConfig> = {},
  deps: Pick<AppDeps, 'geocoder' | 'ai' | 'grounding' | 'pushTransport'> = {},
) {
  const database = createDatabase(inject('databaseUrl'), () => {});
  await resetDatabase(database);
  const config = { ...loadConfig({ SOURCE_COMMIT: 'abc1234def' }), ...ROOMY_LIMITS, ...overrides };
  const app = await buildApp(
    config,
    { database, data: () => database, ...deps },
    { logger: false },
  );
  return {
    app,
    database,
    db: database.db,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export async function resetDatabase(database: Database): Promise<void> {
  await database.db.execute(
    sql`truncate analytics_events, runs, point_contents, route_reports, routes, devices, ai_contents, ai_generations, push_subscriptions, push_log restart identity cascade`,
  );
}

/** A folder with these route files, for seeding test routes. */
export async function routesFolder(files: Record<string, unknown>): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-routes-'));
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(data));
  }
  return pathToFileURL(`${dir}/`);
}

const LEIRIA_PLACES: DraftPlace[] = [
  {
    tempId: 'a',
    name: 'Castelo de Leiria',
    position: { lat: 39.747, lng: -8.81 },
    address: 'Leiria, Pousos, Barreira e Cortes',
    externalId: 'Q2969701',
    category: 'monument',
  },
  {
    tempId: 'b',
    name: 'Sé de Leiria',
    position: { lat: 39.7441, lng: -8.8077 },
    category: 'church',
  },
  { tempId: 'c', name: 'Mercado de Sant’Ana', position: { lat: 39.7432, lng: -8.8058 } },
];

/** A user route the way the creator builds it: 3 places in Leiria. */
export function userRoute(id = 'leiria-a-pe-abc123defg', name = 'Leiria a pé'): RouteSpec {
  return buildRouteSpec(
    { name, locale: 'pt', mode: 'free', activity: 'walk', places: LEIRIA_PLACES },
    { source: 'user', id },
  ).spec;
}
