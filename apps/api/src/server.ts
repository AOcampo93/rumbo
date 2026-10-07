import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';

const config = loadConfig();

// The pool only reports errors from idle connections, so `app` is always
// initialized by the time this callback can run.
const db = config.databaseUrl
  ? createDatabase(config.databaseUrl, (err) => app.log.warn({ err }, 'database pool error'))
  : null;
const app = buildApp(config, db);
if (!db) app.log.warn('DATABASE_URL is not set: running without a database');

// Graceful shutdown: Coolify sends SIGTERM when it swaps containers on deploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db?.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
