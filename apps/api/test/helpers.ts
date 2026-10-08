import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import { type AppConfig, loadConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/index.js';

export const CURATED = new URL('../../../data/routes/', import.meta.url);
export const DEVICE = '6f1d1c1e-3a7b-4c1e-9d0f-2b6a7c8d9e01';
export const OTHER_DEVICE = '0b7e9c2a-5d4f-4a8b-8c1d-3e2f1a0b9c87';

/** The API on the test database, with everything empty. */
export async function setupApi(overrides: Partial<AppConfig> = {}) {
  const database = createDatabase(inject('databaseUrl'), () => {});
  await resetDatabase(database);
  const config = { ...loadConfig({ SOURCE_COMMIT: 'abc1234def' }), ...overrides };
  const app = await buildApp(config, { database, data: () => database }, { logger: false });
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
    sql`truncate analytics_events, runs, point_contents, routes, devices restart identity cascade`,
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
