import {
  type GeoKind,
  type GeoSuggestion,
  GeoSuggestResponseSchema,
  type ResolvedPlace,
  ResolvedPlaceSchema,
} from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import type { z } from 'zod';
import { api, apiErrorCode } from './api.ts';

// Place search for the creator (GET /geo/suggest and /geo/resolve): Wikidata
// behind our API, in the app's language (Accept-Language). Answers are checked
// against the contract; failures become a GeoError the screens can explain.

export type GeoErrorCode = 'offline' | 'rate_limited' | 'unavailable' | 'failed';

export class GeoError extends Error {
  readonly code: GeoErrorCode;

  constructor(code: GeoErrorCode) {
    super(`Place search failed: ${code}`);
    this.name = 'GeoError';
    this.code = code;
  }
}

export interface SuggestQuery {
  q: string;
  /** Results near it first: the map centre, the area or the places' centroid. */
  near?: LatLng | null;
  kind?: GeoKind;
  limit?: number;
}

/** 3 decimals (about 110 m), never in exponent notation: the API never sees an exact position. */
export function formatNear({ lat, lng }: LatLng): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Suggestions for what the user typed. Rejects with a GeoError, or with the
 * caller's AbortError when `signal` aborts (a newer query replaced this one).
 */
export async function suggestPlaces(
  query: SuggestQuery,
  signal?: AbortSignal,
): Promise<GeoSuggestion[]> {
  const params = new URLSearchParams({ q: query.q.trim(), kind: query.kind ?? 'place' });
  if (query.near) params.set('near', formatNear(query.near));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const response = await request(`/geo/suggest?${params}`, signal);
  return parse(response, GeoSuggestResponseSchema);
}

/** A suggestion's details (its address); null when the place no longer exists. */
export async function resolvePlace(
  key: string,
  signal?: AbortSignal,
): Promise<ResolvedPlace | null> {
  const response = await request(`/geo/resolve?${new URLSearchParams({ key })}`, signal);
  if (response.status === 404 && (await apiErrorCode(response)) === 'place_not_found') return null;
  return parse(response, ResolvedPlaceSchema);
}

async function request(path: string, signal: AbortSignal | undefined): Promise<Response> {
  try {
    return await api(path, signal ? { signal } : {});
  } catch (error) {
    // A newer query replaced this one: not an error to show.
    if (signal?.aborted) throw error;
    throw new GeoError(globalThis.navigator?.onLine === false ? 'offline' : 'failed');
  }
}

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw new GeoError(await errorFor(response));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GeoError('failed');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new GeoError('failed');
  return parsed.data;
}

async function errorFor(response: Response): Promise<GeoErrorCode> {
  const code = await apiErrorCode(response);
  if (code === 'rate_limited' || response.status === 429) return 'rate_limited';
  if (code === 'geocoding_unavailable' || code === 'unavailable') return 'unavailable';
  // No answer from the API itself (a proxy's error page while it restarts).
  if (code === null && response.status >= 500) return 'unavailable';
  return 'failed';
}
