import {
  SuggestPlacesBodySchema,
  type SuggestPlacesResponse,
  SuggestPlacesResponseSchema,
} from '@rumbo/api-contract';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AiBudgetStore } from '../ai/budget.js';
import { AiError, type AiProvider } from '../ai/provider.js';
import {
  type Candidates,
  CandidatesError,
  choosePlaces,
  createPlaceCandidates,
  PROMPT_VERSION,
  type SuggestQuery,
  type Tally,
} from '../ai/suggest.js';
import { requireDeviceId } from '../device.js';
import { fail } from '../errors.js';
import { TtlCache } from '../geo/cache.js';
import type { Fetch } from '../geo/wikidata.js';
import { addressLimit } from '../limits.js';

// POST /suggest/places (PROJECT_PLAN §12): what to see around a position in
// the time the visitor has, chosen by the AI from the places Wikipedia knows
// nearby (src/ai/suggest.ts). Neither the position nor the device is ever
// logged: the request log keeps only the path, and the budget's record gets
// no cache key, which would carry the position.

export interface SuggestOptions {
  /** Null: the AI is off and the endpoint answers 503 ai_unavailable. */
  ai: AiProvider | null;
  /** Spending control (every call is checked before and recorded after); null is the same as no AI. */
  budget: AiBudgetStore | null;
  /** Wikimedia requires a descriptive User-Agent with contact details. */
  userAgent: string;
  /** Suggestions per minute per client address. */
  rateLimitPerMinute: number;
  fetch?: Fetch;
  /** The model's name in the record of a call that fails before the model answers. */
  model?: string;
  /** One deadline for everything a suggestion does: the nearby places, then the model. */
  timeoutMs?: number;
  /** The clock of the cache and of the pause after Wikimedia asks us to slow down; tests move it. */
  now?: () => number;
  /** The pause before Wikipedia's search is asked again when it says it is busy. */
  retryDelayMs?: number;
}

/** The AI call is the slow part (a few seconds); Wikimedia's answers come in about one. */
const DEFAULT_TIMEOUT_MS = 45_000;
/** Answers kept in memory, for an hour: the same outing asked again costs nothing. */
const CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 3_600_000;

/** Nothing worth suggesting nearby: no place, so no model call. */
const NOTHING: SuggestPlacesResponse = { title: '', summary: '', places: [] };

/** What a suggestion is cached by: the position (3 decimals), language, interests, time, activity and the places already in the route. */
function cacheKey(query: SuggestQuery): string {
  const sorted = (values: readonly string[]) => [...new Set(values)].sort().join(',');
  return [
    `${query.near.lat.toFixed(3)},${query.near.lng.toFixed(3)}`,
    query.locale,
    sorted(query.interests),
    query.minutes,
    query.activity,
    sorted(query.exclude),
  ].join('|');
}

/** The device id is checked before the body is read, like the other endpoints that need it. */
const needsDevice = async (request: FastifyRequest) => {
  requireDeviceId(request);
};

/** Why the model's part failed; undefined for an error that is not the model's (a bug), which is not hidden. */
function failureReason(error: unknown): AiError['reason'] | undefined {
  if (error instanceof AiError) return error.reason;
  // The deadline passed while the provider was waiting.
  const name = (error as { name?: unknown } | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'failed' : undefined;
}

export const suggestRoutes: FastifyPluginAsyncZod<SuggestOptions> = async (app, options) => {
  // One budget per client address (the device id is the client's choice).
  const suggestLimit = addressLimit(app, [
    { max: options.rateLimitPerMinute, timeWindow: '1 minute' },
  ]);
  const places = createPlaceCandidates({
    userAgent: options.userAgent,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.retryDelayMs !== undefined ? { retryDelayMs: options.retryDelayMs } : {}),
  });
  const cache = new TtlCache<SuggestPlacesResponse>(CACHE_ENTRIES, CACHE_TTL_MS, options.now);
  /** Identical suggestions in progress share one job (and one model call). */
  const flights = new Map<string, Promise<SuggestPlacesResponse>>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** The nearby places, and the 502 or 503 answer a failure to find them becomes. */
  async function findPlaces(
    query: SuggestQuery,
    signal: AbortSignal,
    log: FastifyBaseLogger,
  ): Promise<Candidates> {
    try {
      return await places.nearby(query, signal);
    } catch (error) {
      if (!(error instanceof CandidatesError)) throw error;
      log.warn({ reason: error.reason }, 'nearby places failed');
      throw fail(error.status, error.status === 503 ? 'geocoding_unavailable' : 'geocoding_failed');
    }
  }

  /** The model's choice, or the answer a failure becomes; the call is recorded either way. */
  async function askModel(
    query: SuggestQuery,
    found: Candidates,
    deviceId: string,
    ai: AiProvider,
    budget: AiBudgetStore,
    signal: AbortSignal,
    log: FastifyBaseLogger,
  ): Promise<SuggestPlacesResponse> {
    const tally: Tally = { usage: { inputTokens: 0, outputTokens: 0, webSearches: 0 } };
    const started = Date.now();
    let response: SuggestPlacesResponse | undefined;
    let failure: unknown;
    try {
      response = await choosePlaces(query, found.places, ai, tally, signal);
    } catch (error) {
      failure = error;
    }
    try {
      await budget.record({
        deviceId,
        kind: 'suggest',
        promptVersion: PROMPT_VERSION,
        cacheKey: null,
        locale: query.locale,
        model: tally.model ?? options.model ?? 'unknown',
        usage: tally.usage,
        status: response ? 'ok' : 'failed',
        latencyMs: Date.now() - started,
      });
    } catch {
      // The suggestion was made and paid for: the user gets it, the log has a gap.
      log.error('an AI call could not be recorded');
    }
    if (response) return response;
    const reason = failureReason(failure);
    if (reason === undefined) throw failure;
    log.warn({ reason }, 'place suggestion failed');
    throw reason === 'unavailable' ? fail(503, 'ai_unavailable') : fail(502, 'generation_failed');
  }

  async function suggest(
    key: string,
    query: SuggestQuery,
    deviceId: string,
    ai: AiProvider,
    budget: AiBudgetStore,
    log: FastifyBaseLogger,
  ): Promise<SuggestPlacesResponse> {
    // Not tied to the client: if it goes away the answer is still made, and
    // kept for the retry.
    const signal = AbortSignal.timeout(timeoutMs);
    const found = await findPlaces(query, signal, log);
    if (found.places.length === 0) return NOTHING;
    const response = await askModel(query, found, deviceId, ai, budget, signal, log);
    log.info(
      { candidates: found.places.length, places: response.places.length },
      'places suggested',
    );
    if (found.complete) cache.set(key, response);
    return response;
  }

  app.post(
    '/v1/suggest/places',
    {
      onRequest: [suggestLimit, needsDevice],
      // The biggest valid body (30 excluded places) is about 700 bytes.
      bodyLimit: 4 * 1024,
      schema: {
        tags: ['suggest'],
        summary:
          'Places to see around a position in the time available, chosen by the AI from the nearby places of Wikipedia (needs X-Device-Id)',
        body: SuggestPlacesBodySchema,
        response: { 200: SuggestPlacesResponseSchema },
      },
    },
    async (request, reply) => {
      const deviceId = requireDeviceId(request);
      const { ai, budget } = options;
      if (!ai || !budget) throw fail(503, 'ai_unavailable');
      const query: SuggestQuery = request.body;
      const key = cacheKey(query);
      reply.header('cache-control', 'no-store');

      const cached = cache.get(key);
      if (cached) {
        request.log.info({ places: cached.places.length }, 'places suggested from the cache');
        return cached;
      }
      let flight = flights.get(key);
      if (!flight) {
        // Only whoever starts the job is checked: the others get its answer, free like a cache hit.
        await budget.check(deviceId);
        flight = flights.get(key);
        if (!flight) {
          const started = suggest(key, query, deviceId, ai, budget, request.log).finally(() =>
            flights.delete(key),
          );
          flights.set(key, started);
          flight = started;
        }
      }
      return await flight;
    },
  );
};
