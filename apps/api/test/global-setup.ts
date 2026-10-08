import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/db/index.js';

// PostgreSQL for the integration tests: TEST_DATABASE_URL when given (an
// existing server), otherwise a throwaway container. Production runs
// PostgreSQL 17 with PostGIS, whose image has no ARM build; v1 makes no
// spatial queries, so plain PostgreSQL 17 (multi-arch) stands in for it.
// Migrations run once; each file empties the tables it uses.

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    url = container.getConnectionUri();
  }
  const database = createDatabase(url, () => {});
  await database.migrate(MIGRATIONS);
  await database.close();
  project.provide('databaseUrl', url);
  return async () => {
    await container?.stop();
  };
}
