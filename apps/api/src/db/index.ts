import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

/** What a `db.transaction` callback works on. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The data layer: Drizzle on a small pg pool, plus a ping for /health. */
export interface Database {
  db: Db;
  ping(): Promise<boolean>;
  /** Applies pending SQL migrations from `folder` (idempotent). */
  migrate(folder: string): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, onError: (err: Error) => void): Database {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
  // An idle client can fail (e.g. Postgres restarts); without a listener
  // the pool would emit an unhandled 'error' and crash the process.
  pool.on('error', onError);
  const db = drizzle(pool, { schema });

  return {
    db,
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    migrate: (folder) => migrate(db, { migrationsFolder: folder }),
    close: () => pool.end(),
  };
}
