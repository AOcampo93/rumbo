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
  /**
   * Generative AI (phase 7). 'none' when AI_PROVIDER is empty or 'anthropic'
   * has no key: the AI endpoints then answer 503 ai_unavailable.
   */
  aiProvider: 'anthropic' | 'none';
  /** The provider's secret key; never logged, never in an error message. */
  aiApiKey: string | null;
  aiModel: string;
  /** How hard the model thinks: 'none' sends no setting (for models without one). */
  aiEffort: 'low' | 'medium' | 'high' | 'none';
  /** Estimated spend per UTC day (USD) after which no new generation starts. */
  aiDailyBudgetUsd: number;
  /** Generations one device may start per UTC day (cache hits are free). */
  aiMaxGenerationsPerDevicePerDay: number;
  /** Prices behind the cost estimate: USD per million tokens, and per web search. */
  aiPriceInputPerMtok: number;
  aiPriceOutputPerMtok: number;
  aiPricePerWebSearch: number;
  /** Card generations per minute per client address. */
  contentRateLimitPerMinute: number;
  /** Place suggestions per minute per client address. */
  suggestRateLimitPerMinute: number;
  /**
   * Web Push (VAPID, RFC 8292): the public key the browsers subscribe with,
   * its private half and a contact (an https: URL or a mailto: address) for
   * the push services. Push is off unless all three are set and valid.
   */
  vapidPublicKey: string | null;
  /** The private half of the VAPID pair; never logged, never in an error message. */
  vapidPrivateKey: string | null;
  vapidSubject: string | null;
  /** Hours after a run starts at which its device gets one "shall we go on?" push. */
  pushReminderHours: number;
  /** Subscribing and unsubscribing per minute per client address. */
  pushRateLimitPerMinute: number;
  /** Bearer token of the admin endpoints (secret); null: they answer 404. */
  adminToken: string | null;
  /** Admin requests (announcements, moderation) per minute per client address. */
  adminRateLimitPerMinute: number;
  /** Reports of community routes per minute per client address. */
  reportRateLimitPerMinute: number;
  /**
   * The origin the web and the API are reached at (scheme and host, no path):
   * the address of every photo the server stores, and the only one a route's
   * own cover may carry (phase 7.3).
   */
  publicOrigin: string;
  /** Photo uploads per minute per client address. */
  mediaRateLimitPerMinute: number;
  /** Photos one device may upload in 24 hours. */
  mediaUploadsPerDevicePerDay: number;
  /** The most the stored photos may weigh in total, in MiB: past it, uploads answer 503. */
  mediaMaxTotalMb: number;
}

/** A positive integer from the environment, or the default when unset or invalid. */
function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** A positive number from the environment, or the default when unset or invalid. */
function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Where Rumbo runs, unless PUBLIC_ORIGIN says otherwise (local development, a preview). */
export const DEFAULT_PUBLIC_ORIGIN = 'https://rumbo.arturoocampo.com';

/**
 * PUBLIC_ORIGIN as an origin: `https://host[:port]`. A trailing slash is
 * tolerated; a path, a query or credentials are a mistake that would put wrong
 * addresses on every stored photo, so they stop the server at start. The value
 * is not echoed: it might carry credentials.
 */
function originOf(value: string | undefined): string {
  const invalid = () =>
    new Error(`Invalid PUBLIC_ORIGIN (use an origin like ${DEFAULT_PUBLIC_ORIGIN})`);
  let url: URL;
  try {
    url = new URL(value?.trim() || DEFAULT_PUBLIC_ORIGIN);
  } catch {
    throw invalid();
  }
  const plain = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !plain) throw invalid();
  return url.origin;
}

const GEOCODING_PROVIDERS = ['wikidata', 'none'] as const;
const AI_PROVIDERS = ['anthropic', 'none'] as const;
const AI_EFFORTS = ['low', 'medium', 'high', 'none'] as const;

/** The model behind the cards and the suggestions unless AI_MODEL says otherwise. */
export const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const geocodingProvider = env.GEOCODING_PROVIDER || 'wikidata';
  if (!(GEOCODING_PROVIDERS as readonly string[]).includes(geocodingProvider)) {
    throw new Error(`Invalid GEOCODING_PROVIDER: ${geocodingProvider} (use wikidata or none)`);
  }
  const aiProvider = env.AI_PROVIDER?.trim().toLowerCase() || 'none';
  if (!(AI_PROVIDERS as readonly string[]).includes(aiProvider)) {
    throw new Error(`Invalid AI_PROVIDER: ${aiProvider} (use anthropic or none)`);
  }
  const aiEffort = env.AI_EFFORT?.trim().toLowerCase() || 'low';
  if (!(AI_EFFORTS as readonly string[]).includes(aiEffort)) {
    throw new Error(`Invalid AI_EFFORT: ${aiEffort} (use low, medium, high or none)`);
  }
  const aiApiKey = env.AI_API_KEY?.trim() || null;
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
    // 'anthropic' without a key is the same as no provider; the server says so on start.
    aiProvider: aiProvider === 'anthropic' && aiApiKey ? 'anthropic' : 'none',
    aiApiKey,
    aiModel: env.AI_MODEL?.trim() || DEFAULT_AI_MODEL,
    aiEffort: aiEffort as AppConfig['aiEffort'],
    aiDailyBudgetUsd: positiveNumber(env.AI_DAILY_BUDGET_USD, 5),
    aiMaxGenerationsPerDevicePerDay: positiveInteger(env.AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY, 40),
    // Claude Sonnet 5.5's prices: change them together with AI_MODEL.
    aiPriceInputPerMtok: positiveNumber(env.AI_PRICE_INPUT_PER_MTOK, 2),
    aiPriceOutputPerMtok: positiveNumber(env.AI_PRICE_OUTPUT_PER_MTOK, 10),
    aiPricePerWebSearch: positiveNumber(env.AI_PRICE_PER_WEB_SEARCH, 0.01),
    contentRateLimitPerMinute: positiveInteger(env.CONTENT_RATE_LIMIT_PER_MINUTE, 30),
    suggestRateLimitPerMinute: positiveInteger(env.SUGGEST_RATE_LIMIT_PER_MINUTE, 20),
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || null,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY?.trim() || null,
    vapidSubject: env.VAPID_SUBJECT?.trim() || null,
    pushReminderHours: positiveNumber(env.PUSH_REMINDER_HOURS, 6),
    pushRateLimitPerMinute: positiveInteger(env.PUSH_RATE_LIMIT_PER_MINUTE, 20),
    adminToken: env.ADMIN_TOKEN?.trim() || null,
    adminRateLimitPerMinute: positiveInteger(env.ADMIN_RATE_LIMIT_PER_MINUTE, 5),
    reportRateLimitPerMinute: positiveInteger(env.REPORT_RATE_LIMIT_PER_MINUTE, 10),
    publicOrigin: originOf(env.PUBLIC_ORIGIN),
    mediaRateLimitPerMinute: positiveInteger(env.MEDIA_RATE_LIMIT_PER_MINUTE, 10),
    mediaUploadsPerDevicePerDay: positiveInteger(env.MEDIA_UPLOADS_PER_DEVICE_PER_DAY, 30),
    mediaMaxTotalMb: positiveNumber(env.MEDIA_MAX_TOTAL_MB, 300),
  };
}
