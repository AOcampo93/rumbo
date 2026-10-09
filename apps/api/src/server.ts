import { fileURLToPath } from 'node:url';
import { createAnthropicProvider } from './ai/anthropic.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, type Database } from './db/index.js';
import { seedCuratedRoutes } from './db/seed.js';
import { createWikidataGeocoder } from './geo/wikidata.js';
import { MIN_ADMIN_TOKEN_LENGTH, usableAdminToken } from './push/admin.js';
import { createPush } from './push/index.js';
import { startReminderJob } from './push/reminders.js';
import { checkVapid } from './push/vapid.js';

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

const ai =
  config.aiProvider === 'anthropic' && config.aiApiKey
    ? createAnthropicProvider({
        apiKey: config.aiApiKey,
        model: config.aiModel,
        ...(config.aiEffort !== 'none' ? { effort: config.aiEffort } : {}),
      })
    : null;

const app = await buildApp(config, { database, data: () => ready, geocoder, ai });
if (!database) app.log.warn('DATABASE_URL is not set: running without a database');
if (!geocoder) app.log.warn('GEOCODING_PROVIDER=none: place search is off');
if (!ai)
  app.log.warn('Generative AI is off: set AI_PROVIDER=anthropic and AI_API_KEY to turn it on');

// Web Push: the routes decide with the same check whether it is on. The
// reminder job shares the routes' way of sending, and waits for the database.
const vapid = checkVapid(config);
if (!vapid.ok) {
  app.log.warn(
    vapid.reason === 'unset'
      ? 'Web Push is off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to turn it on'
      : `Web Push is off: the VAPID settings are ${vapid.reason}`,
  );
}
if (!usableAdminToken(config.adminToken)) {
  app.log.warn(
    config.adminToken
      ? `ADMIN_TOKEN has fewer than ${MIN_ADMIN_TOKEN_LENGTH} characters: announcements and moderation are off`
      : 'ADMIN_TOKEN is not set: announcements and the moderation of community routes are off',
  );
}
const push = createPush(config, { database: () => ready, log: app.log });
if (push) {
  app.log.info(
    {
      reminderHours: config.pushReminderHours,
      announcements: usableAdminToken(config.adminToken) !== null,
    },
    'Web Push is on',
  );
}
const reminders = push
  ? startReminderJob({
      database: () => ready,
      sender: push.sender,
      afterHours: config.pushReminderHours,
      log: app.log,
    })
  : null;

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
    await reminders?.stop();
    await app.close();
    await database?.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
