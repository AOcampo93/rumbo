import {
  GeoResolveQuerySchema,
  GeoSuggestQuerySchema,
  GeoSuggestResponseSchema,
  ResolvedPlaceSchema,
} from '@rumbo/api-contract';
import { isLocale, type Locale } from '@rumbo/route-spec';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fail } from '../errors.js';
import { GeocodingError, type GeocodingProvider } from '../geo/provider.js';
import { addressLimit } from '../limits.js';

// Place search for the route creator (PROJECT_PLAN §12.3): suggestions while
// typing, then the chosen place with its address. Neither the query nor the
// position is ever logged (the request log keeps only the path).

export interface GeoOptions {
  /** Null: place search is off (GEOCODING_PROVIDER=none). */
  geocoder: GeocodingProvider | null;
  /** Searches and resolves per minute per client address. */
  rateLimitPerMinute: number;
  /** One deadline for all the upstream requests of an API request. */
  timeoutMs?: number;
}

/** The first of es, en and pt in Accept-Language (the web sends es-ES, en-GB or pt-PT); es otherwise. */
export function localeFrom(header: string | undefined): Locale {
  for (const part of (header ?? '').split(',')) {
    const language = part.split(';')[0]?.trim().toLowerCase().split('-')[0];
    if (isLocale(language)) return language;
  }
  return 'es';
}

/** Aborts when the client goes away (a newer keystroke) or after `ms`. */
function deadline(reply: FastifyReply, ms: number): AbortSignal {
  const closed = new AbortController();
  reply.raw.once('close', () => closed.abort());
  return AbortSignal.any([closed.signal, AbortSignal.timeout(ms)]);
}

/**
 * Runs the provider; its failures become 502 geocoding_failed or 503
 * geocoding_unavailable (logged by reason only).
 */
async function searching<T>(request: FastifyRequest, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof GeocodingError)) throw error;
    // A client that went away (it typed on) is no failure.
    if (error.reason !== 'aborted') {
      request.log.warn({ reason: error.reason, status: error.status }, 'place search failed');
    }
    throw fail(error.status, error.status === 503 ? 'geocoding_unavailable' : 'geocoding_failed');
  }
}

/**
 * Successful answers only (an error is never cached): private, since they
 * depend on the user's position, and per language, which travels in a header.
 */
const cacheAnswer = (reply: FastifyReply) =>
  reply.header('cache-control', 'private, max-age=300').header('vary', 'accept-language');

export const geoRoutes: FastifyPluginAsyncZod<GeoOptions> = async (app, options) => {
  // One budget per client address for both endpoints.
  const geoLimit = addressLimit(app, [{ max: options.rateLimitPerMinute, timeWindow: '1 minute' }]);
  const timeoutMs = options.timeoutMs ?? 6000;
  const geocoder = (): GeocodingProvider => {
    if (!options.geocoder) throw fail(503, 'geocoding_unavailable');
    return options.geocoder;
  };

  app.get(
    '/v1/geo/suggest',
    {
      onRequest: [geoLimit],
      schema: {
        tags: ['geo'],
        summary:
          'Places (kind=place) or cities and areas (kind=area) for a search box, nearest first; in the Accept-Language',
        querystring: GeoSuggestQuerySchema,
        response: { 200: GeoSuggestResponseSchema },
      },
    },
    async (request, reply) => {
      const provider = geocoder();
      const { q, kind, near, limit } = request.query;
      const locale = localeFrom(request.headers['accept-language']);
      const signal = deadline(reply, timeoutMs);
      const suggestions = await searching(request, () =>
        provider.suggest({ q, kind, ...(near ? { near } : {}), locale, limit }, signal),
      );
      cacheAnswer(reply);
      return suggestions;
    },
  );

  app.get(
    '/v1/geo/resolve',
    {
      onRequest: [geoLimit],
      schema: {
        tags: ['geo'],
        summary: "A suggestion's place, with its address, by its key",
        querystring: GeoResolveQuerySchema,
        response: { 200: ResolvedPlaceSchema },
      },
    },
    async (request, reply) => {
      const provider = geocoder();
      const locale = localeFrom(request.headers['accept-language']);
      const signal = deadline(reply, timeoutMs);
      const place = await searching(request, () =>
        provider.resolve(request.query.key, locale, signal),
      );
      if (!place) throw fail(404, 'place_not_found');
      cacheAnswer(reply);
      return place;
    },
  );
};
