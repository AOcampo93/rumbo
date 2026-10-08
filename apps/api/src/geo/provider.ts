import type { GeoKind, GeoSuggestion, ResolvedPlace } from '@rumbo/api-contract';
import type { LatLng, Locale } from '@rumbo/route-spec';

// Place search behind /geo (PROJECT_PLAN §12.3): one interface, so the
// provider changes by configuration (GEOCODING_PROVIDER). Wikidata today.

export interface SuggestInput {
  /** As the user typed it (at most 80 characters): each provider sanitizes it. */
  q: string;
  kind: GeoKind;
  /** Results near it first; rounded to 3 decimals before it is used. */
  near?: LatLng;
  locale: Locale;
  limit: number;
}

export interface GeocodingProvider {
  /** Places (kind 'place') or cities and areas (kind 'area') for a search box. */
  suggest(input: SuggestInput, signal: AbortSignal): Promise<GeoSuggestion[]>;
  /** A suggestion's details (its address) by its key; null when there is no such place. */
  resolve(key: string, locale: Locale, signal: AbortSignal): Promise<ResolvedPlace | null>;
}

/** Why a search failed, for the logs. */
export type GeocodingReason =
  /** The provider asked us to slow down and the pause isn't over: no request was made. */
  | 'paused'
  /** HTTP 429, or an API error asking to slow down (maxlag, ratelimited). */
  | 'rate_limited'
  /** HTTP 5xx. */
  | 'upstream_down'
  /** Any other HTTP error status. */
  | 'upstream_status'
  /** HTTP 200 with an API error in the body. */
  | 'upstream_error'
  | 'bad_response'
  | 'too_large'
  | 'network'
  | 'timeout'
  /** Nobody waits for the answer any more (the client went away). */
  | 'aborted';

/**
 * A failed search: only the status the API answers (502 geocoding_failed,
 * 503 geocoding_unavailable) and the reason. Never the URL, the query, the
 * position or the upstream body (an API error can echo the query), so it is
 * safe to log.
 */
export class GeocodingError extends Error {
  constructor(
    readonly status: 502 | 503,
    readonly reason: GeocodingReason,
  ) {
    super(`Place search failed: ${reason}`);
    this.name = 'GeocodingError';
  }
}
