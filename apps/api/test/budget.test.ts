import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AiBudgetCall,
  type BudgetConfig,
  createAiBudget,
  estimateCostUsd,
  utcDayStart,
} from '../src/ai/budget.js';
import { aiGenerations } from '../src/db/schema.js';
import { DEVICE, OTHER_DEVICE, resetDatabase, setupApi } from './helpers.js';

// What the AI may spend: the estimate of a call, the UTC day, the daily budget
// and the limit per device, over the real table.

const PRICES: BudgetConfig = {
  aiDailyBudgetUsd: 1,
  aiMaxGenerationsPerDevicePerDay: 3,
  aiPriceInputPerMtok: 2,
  aiPriceOutputPerMtok: 10,
  aiPricePerWebSearch: 0.01,
};

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi();
});
afterAll(() => api.close());
beforeEach(() => resetDatabase(api.database));

const NOON = Date.parse('2026-10-08T12:00:00.000Z');

const call = (overrides: Partial<AiBudgetCall> = {}): AiBudgetCall => ({
  deviceId: DEVICE,
  kind: 'card',
  cacheKey: 'Q1:es:card-1:',
  locale: 'es',
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1000, outputTokens: 200, webSearches: 0 },
  status: 'ok',
  latencyMs: 1500,
  ...overrides,
});

/** A budget whose clock says `time`. */
function budgetAt(time: number, config: Partial<BudgetConfig> = {}) {
  return createAiBudget(api.db, { ...PRICES, ...config }, () => time);
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('estimateCostUsd', () => {
  it('adds the tokens, at the price per million, and the searches', () => {
    expect(
      estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 100_000, webSearches: 2 }, PRICES),
    ).toBeCloseTo(2 + 1 + 0.02, 10);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0, webSearches: 0 }, PRICES)).toBe(0);
    // A card from an article, then one with a web search (the measured ~14k tokens).
    expect(
      estimateCostUsd({ inputTokens: 3000, outputTokens: 600, webSearches: 0 }, PRICES),
    ).toBeCloseTo(0.012, 10);
    expect(
      estimateCostUsd({ inputTokens: 14_000, outputTokens: 800, webSearches: 1 }, PRICES),
    ).toBeCloseTo(0.046, 10);
  });
});

describe('utcDayStart', () => {
  it('is midnight UTC of the day, whatever the time zone of the server', () => {
    expect(utcDayStart(Date.parse('2026-10-08T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-08T00:00:00.000Z',
    );
    expect(utcDayStart(Date.parse('2026-10-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-10-09T00:00:00.000Z',
    );
  });
});

describe('record', () => {
  it('keeps one row per call, with its cost, its day and what it says of the prompt', async () => {
    await budgetAt(NOON).record(
      call({
        usage: { inputTokens: 14_000, outputTokens: 800, webSearches: 1 },
        promptVersion: 'card-1',
      }),
    );
    await budgetAt(NOON).record(
      call({ deviceId: null, cacheKey: null, status: 'failed', latencyMs: 12.6 }),
    );
    const rows = await api.db.select().from(aiGenerations).orderBy(aiGenerations.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      deviceId: DEVICE,
      kind: 'card',
      cacheKey: 'Q1:es:card-1:',
      locale: 'es',
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-1',
      inputTokens: 14_000,
      outputTokens: 800,
      webSearches: 1,
      status: 'ok',
      latencyMs: 1500,
    });
    expect(rows[0]?.costUsd).toBeCloseTo(0.046, 10);
    expect(rows[0]?.createdAt.getTime()).toBe(NOON);
    expect(rows[1]).toMatchObject({
      deviceId: null,
      cacheKey: null,
      promptVersion: null,
      status: 'failed',
      latencyMs: 13,
    });
  });
});

describe('check', () => {
  it('lets a device generate while the day has room', async () => {
    const budget = budgetAt(NOON);
    await expect(budget.check(DEVICE)).resolves.toBeUndefined();
    await budget.record(call());
    await expect(budget.check(DEVICE)).resolves.toBeUndefined();
  });

  it('stops everyone with 429 ai_budget_exceeded once the day has spent its budget', async () => {
    const budget = budgetAt(NOON, { aiDailyBudgetUsd: 0.05 });
    await budget.record(
      call({ usage: { inputTokens: 14_000, outputTokens: 800, webSearches: 1 } }),
    );
    await expect(budget.check(OTHER_DEVICE)).resolves.toBeUndefined();
    // 0.046 spent: another one of the same takes it to 0.092.
    await budget.record(
      call({
        deviceId: OTHER_DEVICE,
        usage: { inputTokens: 14_000, outputTokens: 800, webSearches: 1 },
      }),
    );
    for (const device of [DEVICE, OTHER_DEVICE, '0b7e9c2a-5d4f-4a8b-8c1d-3e2f1a0b9c88']) {
      expect(await rejection(budget.check(device))).toMatchObject({
        status: 429,
        code: 'ai_budget_exceeded',
      });
    }
  });

  it('counts a day that has spent exactly its budget as spent', async () => {
    const budget = budgetAt(NOON, { aiDailyBudgetUsd: 0.004 });
    await budget.record(call({ usage: { inputTokens: 1000, outputTokens: 200, webSearches: 0 } }));
    expect(await rejection(budget.check(DEVICE))).toMatchObject({ code: 'ai_budget_exceeded' });
  });

  it('stops a device with 429 ai_device_limit after its generations of the day', async () => {
    const budget = budgetAt(NOON);
    await budget.record(call());
    await budget.record(call());
    await expect(budget.check(DEVICE)).resolves.toBeUndefined();
    await budget.record(call());
    expect(await rejection(budget.check(DEVICE))).toMatchObject({
      status: 429,
      code: 'ai_device_limit',
    });
    // Nobody else is held back.
    await expect(budget.check(OTHER_DEVICE)).resolves.toBeUndefined();
  });

  it('does not count the failures that cost nothing against a device, and does count those that cost', async () => {
    const budget = budgetAt(NOON);
    const nothing = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
    for (let i = 0; i < 5; i++) await budget.record(call({ status: 'failed', usage: nothing }));
    await expect(budget.check(DEVICE)).resolves.toBeUndefined();
    // A failed call that was billed (the model answered unusably) is one of the day's.
    await budget.record(call({ status: 'failed' }));
    await budget.record(call({ status: 'failed' }));
    await budget.record(call({ status: 'failed' }));
    expect(await rejection(budget.check(DEVICE))).toMatchObject({ code: 'ai_device_limit' });
  });

  it('starts every UTC day afresh', async () => {
    const late = Date.parse('2026-10-08T23:59:00.000Z');
    const early = Date.parse('2026-10-09T00:01:00.000Z');
    const yesterday = budgetAt(late, { aiDailyBudgetUsd: 0.01 });
    for (let i = 0; i < 3; i++) await yesterday.record(call());
    expect(await rejection(yesterday.check(DEVICE))).toMatchObject({ code: 'ai_budget_exceeded' });
    // Two minutes later it is another day: neither the budget nor the device limit remember.
    await expect(
      budgetAt(early, { aiDailyBudgetUsd: 0.01 }).check(DEVICE),
    ).resolves.toBeUndefined();
  });

  it('answers 503 unavailable while the database is not ready', async () => {
    const budget = createAiBudget(() => null, PRICES);
    for (const work of [budget.check(DEVICE), budget.record(call())]) {
      expect(await rejection(work)).toMatchObject({ status: 503, code: 'unavailable' });
    }
    // A function that gets a database later works from then on.
    let ready: typeof api.db | null = null;
    const lazy = createAiBudget(
      () => ready,
      PRICES,
      () => NOON,
    );
    await expect(lazy.check(DEVICE)).rejects.toMatchObject({ code: 'unavailable' });
    ready = api.db;
    await expect(lazy.check(DEVICE)).resolves.toBeUndefined();
  });
});
