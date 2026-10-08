import { VERSION } from './version.js';

/**
 * Runtime configuration, read once from environment variables.
 * Secrets never live in the repo: production values are managed in Coolify.
 */
export interface AppConfig {
  host: string;
  port: number;
  /** Null runs the API without a database (local experiments). */
  databaseUrl: string | null;
  logLevel: string;
  /** Git commit being served; Coolify injects SOURCE_COMMIT on deploy. */
  commit: string | null;
  /** Off: analytics batches are accepted (202) but not stored. */
  analyticsEnabled: boolean;
  /** Requests per minute per device (or IP) across the API. */
  rateLimitPerMinute: number;
  /** Route writes (and owner reads of a user route) per minute per client address. */
  writeRateLimitPerMinute: number;
  /** Route writes per day per client address. */
  writeRateLimitPerDay: number;
  /** Place searches and resolves per minute per client address. */
  geoRateLimitPerMinute: number;
  /** User routes the server keeps at most: past it, new ones answer 503. */
  userRoutesMax: number;
  /** Place search provider; 'none' turns /geo off (503 geocoding_unavailable). */
  geocodingProvider: 'wikidata' | 'none';
  /** Wikimedia asks every client for a descriptive User-Agent with contact details. */
  wikimediaUserAgent: string;
  /** Server-side ArcGIS key for address search (not used yet); never logged. */
  arcgisApiKeyServer: string | null;
}

/** A positive integer from the environment, or the default when unset or invalid. */
function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const GEOCODING_PROVIDERS = ['wikidata', 'none'] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const geocodingProvider = env.GEOCODING_PROVIDER || 'wikidata';
  if (!(GEOCODING_PROVIDERS as readonly string[]).includes(geocodingProvider)) {
    throw new Error(`Invalid GEOCODING_PROVIDER: ${geocodingProvider} (use wikidata or none)`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl: env.DATABASE_URL || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    commit: env.SOURCE_COMMIT || null,
    analyticsEnabled: env.ANALYTICS_ENABLED !== 'false',
    rateLimitPerMinute: positiveInteger(env.RATE_LIMIT_PER_MINUTE, 300),
    writeRateLimitPerMinute: positiveInteger(env.WRITE_RATE_LIMIT_PER_MINUTE, 20),
    writeRateLimitPerDay: positiveInteger(env.WRITE_RATE_LIMIT_PER_DAY, 200),
    geoRateLimitPerMinute: positiveInteger(env.GEO_RATE_LIMIT_PER_MINUTE, 120),
    userRoutesMax: positiveInteger(env.USER_ROUTES_MAX, 5000),
    geocodingProvider: geocodingProvider as AppConfig['geocodingProvider'],
    wikimediaUserAgent:
      env.WIKIMEDIA_USER_AGENT || `Rumbo/${VERSION} (https://github.com/AOcampo93/rumbo)`,
    arcgisApiKeyServer: env.ARCGIS_API_KEY_SERVER || null,
  };
}
