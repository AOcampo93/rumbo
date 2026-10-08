import {
  type SuggestPlacesBody,
  type SuggestPlacesResponse,
  SuggestPlacesResponseSchema,
} from '@rumbo/api-contract';
import { postAi } from './ai.ts';

// POST /suggest/places (PROJECT_PLAN §12.3): what to see around a position in
// the time the user has. The AI only chooses among real places the API found
// on Wikipedia, so every answer has a Wikidata id and a position that isn't
// the model's.

const SUGGEST_TIMEOUT_MS = 60_000;

/** About 110 m: the API never sees an exact position (it rounds too). */
const round3 = (value: number): number => Math.round(value * 1000) / 1000 || 0;

/**
 * Suggestions in the order to walk them. Rejects with an AiError, or with the
 * caller's AbortError when `signal` aborts (the sheet closed).
 */
export async function suggestPlaces(
  body: SuggestPlacesBody,
  signal?: AbortSignal,
): Promise<SuggestPlacesResponse> {
  return postAi(
    '/suggest/places',
    { ...body, near: { lat: round3(body.near.lat), lng: round3(body.near.lng) } },
    SuggestPlacesResponseSchema,
    { timeoutMs: SUGGEST_TIMEOUT_MS, signal },
  );
}
