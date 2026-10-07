/**
 * Runtime configuration, read once from environment variables.
 * Secrets never live in the repo: production values are managed in Coolify.
 */
export interface AppConfig {
  host: string;
  port: number;
  /** Null runs the API without a database (local experiments, tests). */
  databaseUrl: string | null;
  logLevel: string;
  /** Git commit being served; Coolify injects SOURCE_COMMIT on deploy. */
  commit: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl: env.DATABASE_URL || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    commit: env.SOURCE_COMMIT || null,
  };
}
