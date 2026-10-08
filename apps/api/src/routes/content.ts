import { createHash, randomUUID } from 'node:crypto';
import {
  ContentGenerateBodySchema,
  type ContentGenerateResponse,
  ContentGenerateResponseSchema,
  contentHashInput,
  type ContentGrounding,
  type GeneratedCard,
} from '@rumbo/api-contract';
import { truncateText } from '@rumbo/route-builder';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AiBudgetStore } from '../ai/budget.js';
import { type CardRequest, generateCard, PlaceNotFoundError, PROMPT_VERSION } from '../ai/card.js';
import { type Grounding, GroundingError } from '../ai/grounding.js';
import { AiError, type AiProvider, type AiUsage } from '../ai/provider.js';
import type { Db } from '../db/index.js';
import { aiContents } from '../db/schema.js';
import { requireDeviceId } from '../device.js';
import { fail } from '../errors.js';
import { addressLimit } from '../limits.js';
import { type DataOptions, requireDatabase } from './routes.js';

// POST /content/generate (PROJECT_PLAN §12.2): the card of one place, written
// in the user's language. Every card is kept (ai_contents) under what it was
// asked for, so asking again is free, and so a user route can be checked to
// carry only cards the server made (routes.ts). Neither the place's name nor
// its position is ever logged.

export interface ContentOptions extends DataOptions {
  /** Null: the AI is off and every request answers 503 ai_unavailable. */
  ai: AiProvider | null;
  grounding: Grounding;
  budget: AiBudgetStore;
  /** The model's name, for the record of a call that failed before it answered. */
  model: string;
  /** Generations per minute per client address. */
  rateLimitPerMinute: number;
  /** One deadline for a whole generation (the model's calls, a retry and the research). */
  timeoutMs?: number;
}

/** A card with where its text came from, as the cache keeps it. */
interface Stored {
  content: GeneratedCard;
  grounding: ContentGrounding;
}

/** What is answered: `cached` when it cost this request nothing. */
type Served = Stored & { cached: boolean };

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * `<QID, or custom:<hash of name, category and position>>:<locale>:<prompt
 * version>:<interests>`. The position of a custom place counts to 4 decimals
 * (about 11 m): the same street typed twice shares a card.
 */
export function cacheKeyOf(
  body: { externalId?: string | undefined; category?: string | undefined; locale: string },
  name: string,
  position: { lat: number; lng: number },
  interests: readonly string[],
): string {
  const place =
    body.externalId ??
    `custom:${createHash('sha1')
      .update(
        [name, body.category ?? '', position.lat.toFixed(4), position.lng.toFixed(4)].join('|'),
      )
      .digest('hex')}`;
  return `${place}:${body.locale}:${PROMPT_VERSION}:${interests.join(',')}`;
}

/** A request is a name, a position and a few words: 4 KB is generous. */
const BODY_LIMIT = 4 * 1024;

const total = (usage: AiUsage) => usage.inputTokens + usage.outputTokens + usage.webSearches;

export const contentRoutes: FastifyPluginAsyncZod<ContentOptions> = async (app, options) => {
  const limit = addressLimit(app, [{ max: options.rateLimitPerMinute, timeWindow: '1 minute' }]);
  /** Generations in progress: the same card asked for twice at once is paid once. */
  const flights = new Map<string, Promise<Served>>();

  /** The card kept under this key, counting the visit; null if there is none. */
  async function recall(db: Db, key: string): Promise<Stored | null> {
    const [hit] = await db
      .update(aiContents)
      .set({ hits: sql`${aiContents.hits} + 1` })
      .where(eq(aiContents.cacheKey, key))
      .returning({ content: aiContents.content, grounding: aiContents.grounding });
    return hit
      ? { content: hit.content as GeneratedCard, grounding: hit.grounding as ContentGrounding }
      : null;
  }

  /** Keeps a card the first time; when another got there first, that one stands. */
  async function keep(db: Db, key: string, stored: Stored): Promise<Stored> {
    const [inserted] = await db
      .insert(aiContents)
      .values({
        cacheKey: key,
        content: stored.content,
        contentHash: sha256(contentHashInput(stored.content)),
        grounding: stored.grounding,
      })
      .onConflictDoNothing()
      .returning({ key: aiContents.cacheKey });
    if (inserted) return stored;
    const [existing] = await db
      .select({ content: aiContents.content, grounding: aiContents.grounding })
      .from(aiContents)
      .where(eq(aiContents.cacheKey, key));
    return existing
      ? {
          content: existing.content as GeneratedCard,
          grounding: existing.grounding as ContentGrounding,
        }
      : stored;
  }

  /**
   * One generation: the pipeline, the card kept, the call recorded. It runs
   * to its end even if the client goes away, since it is already paid for.
   */
  async function generate(
    db: Db,
    key: string,
    card: CardRequest,
    deviceId: string,
    log: FastifyBaseLogger,
  ): Promise<Served> {
    // Another request may have finished this very card while this one waited for its budget.
    const late = await recall(db, key);
    if (late) return { ...late, cached: true };
    const ai = options.ai as AiProvider;
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
    const started = Date.now();
    const signal = AbortSignal.timeout(options.timeoutMs ?? 90_000);
    const record = async (status: 'ok' | 'failed', model: string) => {
      try {
        await options.budget.record({
          deviceId,
          kind: 'card',
          cacheKey: key,
          locale: card.locale,
          model,
          promptVersion: PROMPT_VERSION,
          usage,
          status,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        // The card is made; a failed log must not take it away.
        log.error(
          { err: error instanceof Error ? error.name : 'unknown' },
          'could not record an AI call',
        );
      }
    };
    try {
      const outcome = await generateCard(card, { ai, grounding: options.grounding, usage }, signal);
      const stored = await keep(db, key, outcome);
      await record('ok', stored.content.generated?.model ?? options.model);
      return { ...stored, cached: false };
    } catch (error) {
      // A call the model did not answer, or answered badly, is on the record; one that never reached it is not.
      const asked =
        total(usage) > 0 ||
        (error instanceof AiError &&
          (error.reason === 'failed' || error.reason === 'invalid_output'));
      if (asked) await record('failed', options.model);
      if (error instanceof PlaceNotFoundError) throw fail(404, 'place_not_found');
      if (error instanceof GroundingError) {
        log.warn({ reason: error.reason }, 'card research failed');
        throw fail(502, 'generation_failed');
      }
      if (error instanceof AiError) {
        log.warn({ reason: error.reason, detail: error.message }, 'card generation failed');
        throw error.reason === 'unavailable'
          ? fail(503, 'ai_unavailable')
          : fail(502, 'generation_failed');
      }
      throw error;
    }
  }

  app.post(
    '/v1/content/generate',
    {
      onRequest: [limit],
      bodyLimit: BODY_LIMIT,
      schema: {
        tags: ['content'],
        summary:
          'The card of a place, written by the AI from Wikipedia (or a web search) in the given language (needs X-Device-Id)',
        body: ContentGenerateBodySchema,
        response: { 200: ContentGenerateResponseSchema },
      },
    },
    async (request): Promise<ContentGenerateResponse> => {
      const deviceId = requireDeviceId(request);
      if (!options.ai) throw fail(503, 'ai_unavailable');
      const { db } = requireDatabase(options);
      const body = request.body;
      const name = truncateText(body.name, 80);
      if (!name) throw fail(400, 'validation_failed');
      const interests = [...new Set(body.interests)].sort();
      const base = cacheKeyOf(body, name, body.position, interests);
      // A fresh card ("Regenerar") is kept under a key of its own: the earlier
      // one stays valid for the routes that already use it.
      const key = body.fresh ? `${base}#${randomUUID().slice(0, 8)}` : base;

      // Asked before: free.
      if (!body.fresh) {
        const hit = await recall(db, key);
        if (hit) return { ...hit, cached: true };
      }

      await options.budget.check(deviceId);
      const joined = flights.get(key);
      const flight =
        joined ??
        generate(
          db,
          key,
          {
            name,
            position: body.position,
            locale: body.locale,
            ...(body.category ? { category: body.category } : {}),
            ...(body.externalId ? { externalId: body.externalId } : {}),
            interests,
          },
          deviceId,
          request.log,
        ).finally(() => flights.delete(key));
      if (!joined) flights.set(key, flight);
      const served = await flight;
      // Whoever joined a generation already under way paid nothing for it.
      return joined ? { ...served, cached: true } : served;
    },
  );
};
