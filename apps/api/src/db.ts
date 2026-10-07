import pg from 'pg';

/**
 * Minimal database handle. The real data layer (Drizzle + migrations)
 * arrives in phase 5; for now we only need to know the database answers.
 */
export interface Database {
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, onError: (err: Error) => void): Database {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000 });
  // An idle client can fail (e.g. Postgres restarts); without a listener
  // the pool would emit an unhandled 'error' and crash the process.
  pool.on('error', onError);

  return {
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
