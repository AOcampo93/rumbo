import { createHash } from 'node:crypto';
import {
  ContentGenerateResponseSchema,
  contentHashInput,
  type GeneratedCard,
} from '@rumbo/api-contract';
import rateLimit from '@fastify/rate-limit';
import { buildRouteSpec } from '@rumbo/route-builder';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiBudget } from '../src/ai/budget.js';
import { PROMPT_VERSION } from '../src/ai/card.js';
import { GroundingError } from '../src/ai/grounding.js';
import { AiBilledError } from '../src/ai/errors.js';
import { AiError, type AiProvider } from '../src/ai/provider.js';
import { loadConfig } from '../src/config.js';
import { aiContents, aiGenerations } from '../src/db/schema.js';
import { installErrorHandling } from '../src/errors.js';
import { cacheKeyOf, contentRoutes } from '../src/routes/content.js';
import { CARD, scripted, USED, wikimedia } from './ai-fakes.js';
import { DEVICE, OTHER_DEVICE, setupApi, TOKEN } from './helpers.js';

// POST /content/generate on a real database, with a scripted model and a
// stand-in for Wikimedia: what is answered, kept, recorded and limited.

let api: Awaited<ReturnType<typeof setupApi>> | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** The API with this model and this Wikimedia (a model that answers every time with a valid card, unless scripted). */
async function start(
  options: {
    model?: ReturnType<typeof scripted>;
    wiki?: ReturnType<typeof wikimedia>;
    ai?: AiProvider | null;
    config?: Parameters<typeof setupApi>[0];
  } = {},
) {
  const model = options.model ?? scripted();
  const wiki = options.wiki ?? wikimedia();
  api = await setupApi(options.config, {
    ai: options.ai === undefined ? model.ai : options.ai,
    grounding: wiki,
  });
  return { model, wiki, app: api.app };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Castelo de Leiria',
  position: { lat: 39.747, lng: -8.81 },
  locale: 'es',
  externalId: 'Q2969701',
  interests: ['history'],
  ...overrides,
});

const generate = (
  payload: unknown,
  headers: Record<string, string> = { 'x-device-id': DEVICE },
) => {
  if (!api) throw new Error('start first');
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/content/generate',
    payload: payload as object,
    headers,
  });
};

const sha256 = (card: GeneratedCard) =>
  createHash('sha256').update(contentHashInput(card)).digest('hex');

const stored = async () => (api ? api.db.select().from(aiContents) : []);
const generations = async () => (api ? api.db.select().from(aiGenerations) : []);

describe('a generation', () => {
  it('answers the card and keeps it, with its hash, and the call with its cost', async () => {
    const { model } = await start();
    const res = await generate(body());
    expect(res.statusCode).toBe(200);
    const answer = ContentGenerateResponseSchema.parse(res.json());
    expect(answer).toMatchObject({
      grounding: 'wikipedia',
      cached: false,
      content: { locale: 'es', title: 'Castelo de Leiria', status: 'approved' },
    });
    expect(answer.content.generated).toMatchObject({
      by: 'ai',
      model: 'test-model',
      promptVersion: PROMPT_VERSION,
    });
    expect(res.json().content).not.toHaveProperty('id');
    expect(model.requests).toHaveLength(1);

    const [keptCard] = await stored();
    expect(keptCard).toMatchObject({
      cacheKey: `Q2969701:es:${PROMPT_VERSION}:history`,
      grounding: 'wikipedia',
      hits: 0,
      contentHash: sha256(answer.content),
    });
    expect(keptCard?.content).toEqual(answer.content);

    const [call, ...others] = await generations();
    expect(others).toEqual([]);
    expect(call).toMatchObject({
      deviceId: DEVICE,
      kind: 'card',
      cacheKey: keptCard?.cacheKey,
      locale: 'es',
      model: 'test-model',
      promptVersion: PROMPT_VERSION,
      inputTokens: USED.inputTokens,
      outputTokens: USED.outputTokens,
      webSearches: 0,
      status: 'ok',
    });
    // 1000 tokens in at $2 and 200 out at $10 per million.
    expect(call?.costUsd).toBeCloseTo(0.004, 10);
    expect(call?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('is free the next time, for any device, and counts the visit', async () => {
    const { model } = await start();
    const first = await generate(body());
    const second = await generate(body(), { 'x-device-id': OTHER_DEVICE });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ...first.json(), cached: true });
    await generate(body());
    expect(model.requests).toHaveLength(1);
    expect(await generations()).toHaveLength(1);
    expect((await stored())[0]?.hits).toBe(2);
  });

  it('"Regenerar" (fresh) writes a new card and keeps the earlier one valid', async () => {
    const { model } = await start();
    await generate(body());
    const again = await generate(body({ fresh: true }));
    expect(again.statusCode).toBe(200);
    expect(again.json().cached).toBe(false);
    expect(model.requests).toHaveLength(2);
    // Two cards under two keys: routes that already ship the first one still verify.
    const keys = (await stored()).map((card) => card.cacheKey).sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(`Q2969701:es:${PROMPT_VERSION}:history`);
    expect(keys[1]).toMatch(new RegExp(`^Q2969701:es:${PROMPT_VERSION}:history#[0-9a-f]{8}$`));
    // A plain request still gets the first card from the cache.
    expect((await generate(body())).json().cached).toBe(true);
    expect(model.requests).toHaveLength(2);
  });

  it('keeps one card per place, language and set of interests, whatever the order they come in', async () => {
    const { model } = await start();
    await generate(body({ interests: ['history', 'art'] }));
    expect((await generate(body({ interests: ['art', 'history', 'art'] }))).json().cached).toBe(
      true,
    );
    expect(model.requests).toHaveLength(1);
    for (const other of [
      { interests: ['art'] },
      { interests: [] },
      { locale: 'en' },
      { externalId: 'Q8342841' },
    ]) {
      expect((await generate(body(other))).json().cached, JSON.stringify(other)).toBe(false);
    }
    expect((await stored()).map((row) => row.cacheKey).sort()).toEqual(
      [
        `Q2969701:en:${PROMPT_VERSION}:history`,
        `Q2969701:es:${PROMPT_VERSION}:`,
        `Q2969701:es:${PROMPT_VERSION}:art`,
        `Q2969701:es:${PROMPT_VERSION}:art,history`,
        `Q8342841:es:${PROMPT_VERSION}:history`,
      ].sort(),
    );
  });

  it("shares the card of a place of the user's own typed twice, and not that of another one", async () => {
    const { model } = await start({ wiki: wikimedia({ wikipediaText: vi.fn(async () => null) }) });
    model.requests.length = 0;
    const river = { name: 'Rio Lis', externalId: undefined, category: 'nature', custom: true };
    const first = await generate(body({ ...river, position: { lat: 39.74361, lng: -8.80714 } }));
    expect(first.statusCode).toBe(200);
    expect(first.json().grounding).toBe('none');
    // About 1 m away, the same card; the name, the category or a street away, another one.
    expect(
      (await generate(body({ ...river, position: { lat: 39.743612, lng: -8.807141 } }))).json()
        .cached,
    ).toBe(true);
    for (const other of [
      { name: 'Rio Lena' },
      { category: 'other' },
      { position: { lat: 39.7437, lng: -8.8071 } },
    ]) {
      expect(
        (await generate(body({ ...river, ...other }))).json().cached,
        JSON.stringify(other),
      ).toBe(false);
    }
    const keys = (await stored()).map((row) => row.cacheKey);
    expect(keys).toHaveLength(4);
    for (const key of keys) expect(key).toMatch(/^custom:[0-9a-f]{40}:es:card-1:history$/);
  });

  it('pays once for the same card asked for twice at the same time', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered = 0;
    const model = scripted();
    const slow: AiProvider = {
      structured: async (request, signal) => {
        entered++;
        await gate;
        return model.ai.structured(request, signal);
      },
    };
    await start({ model, ai: slow });
    const first = generate(body());
    await vi.waitFor(() => expect(entered).toBe(1));
    const second = generate(body(), { 'x-device-id': OTHER_DEVICE });
    // Time for the second request to find the first one's generation under way.
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    const [one, two] = await Promise.all([first, second]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(one.json().content).toEqual(two.json().content);
    expect([one.json().cached, two.json().cached]).toEqual([false, true]);
    expect(entered).toBe(1);
    expect(await generations()).toHaveLength(1);
    expect(await stored()).toHaveLength(1);
  });

  it('sums every call of the generation, retries included', async () => {
    const model = scripted(
      {
        input: { ...CARD, title: '' },
        usage: { inputTokens: 1000, outputTokens: 200, webSearches: 0 },
      },
      { usage: { inputTokens: 1600, outputTokens: 300, webSearches: 0 } },
    );
    await start({ model });
    const res = await generate(body());
    expect(res.statusCode).toBe(200);
    const [call] = await generations();
    expect(call).toMatchObject({ inputTokens: 2600, outputTokens: 500, status: 'ok' });
  });
});

describe('the requests it refuses', () => {
  it('needs a device id', async () => {
    const { model } = await start();
    const res = await generate(body(), {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: 'missing_device_id' });
    expect((await generate(body(), { 'x-device-id': 'not-a-uuid' })).json().code).toBe(
      'missing_device_id',
    );
    expect(model.requests).toHaveLength(0);
  });

  it('answers 503 ai_unavailable when the AI is off', async () => {
    await start({ ai: null });
    const res = await generate(body());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'ai_unavailable' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('validates the body', async () => {
    const { model } = await start();
    const bad = [
      {},
      body({ name: '   ' }),
      body({ name: 'x'.repeat(81) }),
      body({ locale: 'fr' }),
      body({ externalId: 'Leiria' }),
      body({ externalId: 'Q1|Q2' }),
      body({ interests: ['shopping'] }),
      body({ interests: Array(8).fill('art') }),
      body({ position: { lat: 91, lng: 0 } }),
      body({ category: 'castle' }),
      body({ extra: true }),
      body({ custom: 'yes' }),
      '[]',
    ];
    for (const payload of bad) {
      const res = await generate(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
    // A body past 4 KB is refused before it is read.
    const big = await generate(body({ name: 'x'.repeat(5000) }));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ code: 'payload_too_large' });
    // A name that is nothing once the unsafe characters are gone.
    const res = await generate(body({ name: '\u0000\u0007' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(model.requests).toHaveLength(0);
  });

  it('counts per address, whatever the device id: the third in a minute is 429', async () => {
    await start({ config: { contentRateLimitPerMinute: 2 } });
    for (const device of [DEVICE, OTHER_DEVICE]) {
      expect((await generate(body(), { 'x-device-id': device })).statusCode).toBe(200);
    }
    const limited = await generate(body(), {
      'x-device-id': '0b7e9c2a-5d4f-4a8b-8c1d-3e2f1a0b9c88',
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('the budgets', () => {
  const spend = (deviceId: string, costUsd: number, createdAt = new Date()) =>
    api!.db.insert(aiGenerations).values({
      deviceId,
      kind: 'card',
      cacheKey: null,
      locale: 'es',
      model: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
      webSearches: 0,
      costUsd,
      status: 'ok',
      latencyMs: 1,
      createdAt,
    });

  it('stops new generations with 429 ai_budget_exceeded when the day has spent its budget', async () => {
    const { model } = await start({ config: { aiDailyBudgetUsd: 0.5 } });
    await spend(OTHER_DEVICE, 0.5);
    const res = await generate(body());
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ code: 'ai_budget_exceeded' });
    expect(model.requests).toHaveLength(0);
    expect(await stored()).toEqual([]);
  });

  it('keeps serving cards it already has when the budget is spent', async () => {
    await start({ config: { aiDailyBudgetUsd: 0.5 } });
    expect((await generate(body())).statusCode).toBe(200);
    await spend(OTHER_DEVICE, 0.5);
    const again = await generate(body(), { 'x-device-id': OTHER_DEVICE });
    expect(again.statusCode).toBe(200);
    expect(again.json().cached).toBe(true);
    expect((await generate(body({ locale: 'en' }))).json().code).toBe('ai_budget_exceeded');
  });

  it('stops a device with 429 ai_device_limit after its generations of the day', async () => {
    const { model } = await start({ config: { aiMaxGenerationsPerDevicePerDay: 2 } });
    await spend(DEVICE, 0);
    await spend(DEVICE, 0);
    const res = await generate(body());
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ code: 'ai_device_limit' });
    expect(model.requests).toHaveLength(0);
    // Someone else is not held back, and yesterday's generations do not count.
    expect((await generate(body(), { 'x-device-id': OTHER_DEVICE })).statusCode).toBe(200);
  });

  it('does not count yesterday', async () => {
    await start({ config: { aiMaxGenerationsPerDevicePerDay: 1, aiDailyBudgetUsd: 0.5 } });
    await spend(DEVICE, 10, new Date(Date.now() - 36 * 3_600_000));
    expect((await generate(body())).statusCode).toBe(200);
    expect((await generate(body({ locale: 'en' }))).json().code).toBe('ai_device_limit');
  });
});

describe('when things go wrong', () => {
  it.each([
    ['failed', 502, 'generation_failed', true],
    ['rate_limited', 502, 'generation_failed', false],
    ['unavailable', 503, 'ai_unavailable', false],
  ] as const)('a provider that answers %s is %i %s', async (reason, status, code, recorded) => {
    await start({ model: scripted(new AiError(reason)) });
    const res = await generate(body());
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ code });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(await stored()).toEqual([]);
    // What the model was asked and did not answer is on the record, without a cost; what never reached it is not.
    const rows = await generations();
    expect(rows).toHaveLength(recorded ? 1 : 0);
    if (recorded) expect(rows[0]).toMatchObject({ status: 'failed', costUsd: 0, deviceId: DEVICE });
  });

  it("charges the calls that were answered unusably, then gives the article's own opening", async () => {
    const wasted = new AiBilledError('invalid_output', 'refusal', USED);
    await start({
      model: scripted(wasted, wasted),
      wiki: wikimedia({
        wikipediaText: vi.fn(async () => ({
          title: 'Castelo de Leiria',
          url: 'https://es.wikipedia.org/wiki/Castelo',
          lang: 'es' as const,
          text: 'Una primera frase. Otra.',
        })),
      }),
    });
    const res = await generate(body());
    expect(res.statusCode).toBe(200);
    expect(res.json().content.summary).toBe('Una primera frase. Otra.');
    const [call] = await generations();
    expect(call).toMatchObject({ status: 'ok', inputTokens: 2000, outputTokens: 400 });
    expect(await stored()).toHaveLength(1);
  });

  it("keeps the failed call's cost when a later call fails", async () => {
    const wasted = new AiBilledError('invalid_output', 'refusal', USED);
    await start({ model: scripted(wasted, new AiError('failed')) });
    const res = await generate(body());
    expect(res.statusCode).toBe(502);
    const [call] = await generations();
    expect(call).toMatchObject({ status: 'failed', inputTokens: 1000, outputTokens: 200 });
    expect(call?.costUsd).toBeCloseTo(0.004, 10);
  });

  it('answers 502 generation_failed when Wikimedia fails, without charging a call that never was', async () => {
    const down = wikimedia({
      entityFacts: vi.fn(async () => {
        throw new GroundingError('upstream_down');
      }),
    });
    const { model } = await start({ wiki: down });
    const res = await generate(body());
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ code: 'generation_failed' });
    expect(model.requests).toHaveLength(0);
    expect(await generations()).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('answers 404 place_not_found for an item that does not exist', async () => {
    await start({ wiki: wikimedia({ entityFacts: vi.fn(async () => null) }) });
    const res = await generate(body({ externalId: 'Q999999999' }));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'place_not_found' });
    expect(await generations()).toEqual([]);
  });

  it('answers 500 internal for what it did not expect, with nothing of the request in the answer', async () => {
    await start({
      wiki: wikimedia({
        entityFacts: vi.fn(async () => {
          throw new Error('secret place name');
        }),
      }),
    });
    const res = await generate(body());
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'internal' });
  });

  it('can try again after a failure: nothing was kept', async () => {
    const { model } = await start({ model: scripted(new AiError('failed')) });
    expect((await generate(body())).statusCode).toBe(502);
    const again = await generate(body());
    expect(again.statusCode).toBe(200);
    expect(again.json().cached).toBe(false);
    expect(model.requests).toHaveLength(2);
  });
});

describe('the deadline of a generation', () => {
  it('reaches the model, which gives up: 502 generation_failed, and the call is on the record', async () => {
    api = await setupApi();
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    installErrorHandling(app);
    await app.register(rateLimit, { global: false });
    const seen: AbortSignal[] = [];
    const stuck: AiProvider = {
      structured: (_request, signal) => {
        seen.push(signal);
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new AiError('failed', 'timeout'))),
        );
      },
    };
    await app.register(contentRoutes, {
      database: () => api!.database,
      ai: stuck,
      grounding: wikimedia(),
      budget: createAiBudget(api.db, loadConfig({})),
      model: 'test-model',
      rateLimitPerMinute: 100,
      timeoutMs: 50,
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/content/generate',
        payload: body(),
        headers: { 'x-device-id': DEVICE },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ code: 'generation_failed' });
      expect(seen[0]?.aborted).toBe(true);
      expect((seen[0]?.reason as Error | undefined)?.name).toBe('TimeoutError');
      expect(await generations()).toMatchObject([{ status: 'failed', model: 'test-model' }]);
      expect(await stored()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('cacheKeyOf', () => {
  it('is the item, or a hash of the name, category and position to 4 decimals', () => {
    const near = { lat: 39.74361, lng: -8.80714 };
    expect(cacheKeyOf({ externalId: 'Q1', locale: 'pt' }, 'Any', near, ['art', 'food'])).toBe(
      'Q1:pt:card-1:art,food',
    );
    const key = cacheKeyOf({ locale: 'es', category: 'nature' }, 'Rio Lis', near, []);
    const hash = createHash('sha1').update('Rio Lis|nature|39.7436|-8.8071').digest('hex');
    expect(key).toBe(`custom:${hash}:es:card-1:`);
    expect(cacheKeyOf({ locale: 'es' }, 'Rio Lis', near, [])).not.toBe(key);
  });
});

describe('the card it keeps', () => {
  it('is the card as sent, found again by its hash', async () => {
    await start();
    const res = await generate(body());
    const card = res.json().content as GeneratedCard;
    const [row] = await api!.db
      .select()
      .from(aiContents)
      .where(eq(aiContents.contentHash, sha256(card)));
    expect(row?.cacheKey).toBe(`Q2969701:es:${PROMPT_VERSION}:history`);
  });

  it('can go in a route as it came: the bundle checks hash it the same way', async () => {
    await start();
    const { content } = (await generate(body())).json();
    const ref = 'card-castelo';
    const { spec } = buildRouteSpec(
      {
        name: 'Leiria',
        locale: 'es',
        mode: 'free',
        activity: 'walk',
        places: [
          {
            tempId: 'a',
            name: 'Castelo de Leiria',
            position: { lat: 39.747, lng: -8.81 },
            contentRef: ref,
          },
        ],
      },
      { source: 'user', id: 'leiria-abc123defg' },
    );
    const saved = await api!.app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      payload: { spec, contents: { [ref]: { es: { ...content, id: ref } } } },
      headers: { 'x-edit-token': TOKEN, 'x-device-id': DEVICE },
    });
    expect(saved.statusCode).toBe(201);
  });
});
