import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, type Database } from './db/index.js';
import { seedCuratedRoutes } from './db/seed.js';
import { createWikidataGeocoder } from './geo/wikidata.js';

const config = loadConfig();
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const CURATED_ROUTES = new URL('../../../data/routes/', import.meta.url);
const RETRY_MS = 10_000;

// The pool only reports errors from idle connections, so `app` is always
// initialized by the time this callback can run.
const database = config.databaseUrl
  ? createDatabase(config.databaseUrl, (err) => app.log.warn({ err }, 'database pool error'))
  : null;
let ready: Database | null = null;
const geocoder =
  config.geocodingProvider === 'wikidata'
    ? createWikidataGeocoder({ userAgent: config.wikimediaUserAgent })
    : null;

const app = await buildApp(config, { database, data: () => ready, geocoder });
if (!database) app.log.warn('DATABASE_URL is not set: running without a database');
if (!geocoder) app.log.warn('GEOCODING_PROVIDER=none: place search is off');

/**
 * Migrations, then the curated routes. If the database is down at boot the API
 * still starts (health reports it, data endpoints answer 503) and retries.
 */
async function prepareDatabase(db: Database): Promise<void> {
  try {
    await db.migrate(MIGRATIONS);
    const seeded = await seedCuratedRoutes(db.db, CURATED_ROUTES, app.log);
    app.log.info(seeded, 'database ready: migrations applied, curated routes seeded');
    ready = db;
  } catch (err) {
    app.log.error({ err }, `database not ready, retrying in ${RETRY_MS / 1000} s`);
    setTimeout(() => void prepareDatabase(db), RETRY_MS).unref();
  }
}
if (database) await prepareDatabase(database);

// Graceful shutdown: Coolify sends SIGTERM when it swaps containers on deploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await database?.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
