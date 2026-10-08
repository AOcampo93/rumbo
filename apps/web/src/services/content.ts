import {
  type ContentGenerateBody,
  type ContentGenerateResponse,
  ContentGenerateResponseSchema,
} from '@rumbo/api-contract';
import { AiError, postAi } from './ai.ts';

// POST /content/generate (PROJECT_PLAN §12): the card of one place, written
// in `body.locale` from its Wikipedia article or, failing that, the web. A
// card can take a while (a web search, a retry); the API gives up on the
// model after 60 s.

const CARD_TIMEOUT_MS = 120_000;

/**
 * The card for a place, as the API produced it (the creator ships it
 * unchanged: the API recognises the cards it made by their hash). Rejects
 * with an AiError, or with the caller's AbortError when `signal` aborts.
 */
export async function generateCard(
  body: ContentGenerateBody,
  signal?: AbortSignal,
): Promise<ContentGenerateResponse> {
  const result = await postAi('/content/generate', body, ContentGenerateResponseSchema, {
    timeoutMs: CARD_TIMEOUT_MS,
    signal,
  });
  // A card in another language would not fit the route's bundle.
  if (result.content.locale !== body.locale) throw new AiError('failed');
  return result;
}
