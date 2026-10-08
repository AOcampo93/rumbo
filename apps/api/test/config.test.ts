import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

// The phase 7 settings: the AI provider and its key, the model, the budgets
// and the prices behind the cost estimate.

// Made up for the tests (a literal that looks like a real key would trip the
// secret scan of the repository's history).
const KEY = ['made', 'up', 'key'].join('-');

describe('the AI settings', () => {
  it('are off by default, with the budgets and prices of Claude Sonnet 5.5', () => {
    expect(loadConfig({})).toMatchObject({
      aiProvider: 'none',
      aiApiKey: null,
      aiModel: 'claude-sonnet-5-5',
      aiEffort: 'low',
      aiDailyBudgetUsd: 5,
      aiMaxGenerationsPerDevicePerDay: 40,
      aiPriceInputPerMtok: 2,
      aiPriceOutputPerMtok: 10,
      aiPricePerWebSearch: 0.01,
      contentRateLimitPerMinute: 30,
      suggestRateLimitPerMinute: 20,
    });
    // The empty values of a copied .env.example are the defaults too.
    expect(
      loadConfig({
        AI_PROVIDER: '',
        AI_API_KEY: '',
        AI_MODEL: '',
        AI_EFFORT: '',
        AI_DAILY_BUDGET_USD: '',
      }),
    ).toMatchObject({
      aiProvider: 'none',
      aiApiKey: null,
      aiModel: 'claude-sonnet-5-5',
      aiEffort: 'low',
      aiDailyBudgetUsd: 5,
    });
  });

  it('turn the provider on with a key, and read the rest from the environment', () => {
    const config = loadConfig({
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: `  ${KEY}\n`,
      AI_MODEL: 'claude-sonnet-5',
      AI_EFFORT: 'none',
      AI_DAILY_BUDGET_USD: '2.5',
      AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY: '12',
      AI_PRICE_INPUT_PER_MTOK: '3',
      AI_PRICE_OUTPUT_PER_MTOK: '15',
      AI_PRICE_PER_WEB_SEARCH: '0.02',
      CONTENT_RATE_LIMIT_PER_MINUTE: '5',
      SUGGEST_RATE_LIMIT_PER_MINUTE: '4',
    });
    expect(config).toMatchObject({
      aiProvider: 'anthropic',
      aiApiKey: KEY,
      aiModel: 'claude-sonnet-5',
      aiEffort: 'none',
      aiDailyBudgetUsd: 2.5,
      aiMaxGenerationsPerDevicePerDay: 12,
      aiPriceInputPerMtok: 3,
      aiPriceOutputPerMtok: 15,
      aiPricePerWebSearch: 0.02,
      contentRateLimitPerMinute: 5,
      suggestRateLimitPerMinute: 4,
    });
  });

  it('are off when the provider has no key', () => {
    for (const AI_API_KEY of [undefined, '', '   ']) {
      const config = loadConfig({
        AI_PROVIDER: 'anthropic',
        ...(AI_API_KEY === undefined ? {} : { AI_API_KEY }),
      });
      expect(config).toMatchObject({ aiProvider: 'none', aiApiKey: null });
    }
    // A key alone does not choose a provider.
    expect(loadConfig({ AI_API_KEY: KEY })).toMatchObject({ aiProvider: 'none', aiApiKey: KEY });
    expect(loadConfig({ AI_PROVIDER: 'none', AI_API_KEY: KEY }).aiProvider).toBe('none');
  });

  it('fall back on the defaults for a number that is not a positive one', () => {
    for (const bad of ['many', '0', '-3', 'Infinity', 'NaN']) {
      expect(
        loadConfig({
          AI_DAILY_BUDGET_USD: bad,
          AI_PRICE_INPUT_PER_MTOK: bad,
          AI_PRICE_OUTPUT_PER_MTOK: bad,
          AI_PRICE_PER_WEB_SEARCH: bad,
        }),
        bad,
      ).toMatchObject({
        aiDailyBudgetUsd: 5,
        aiPriceInputPerMtok: 2,
        aiPriceOutputPerMtok: 10,
        aiPricePerWebSearch: 0.01,
      });
    }
    // The counts are whole numbers.
    expect(
      loadConfig({ AI_MAX_GENERATIONS_PER_DEVICE_PER_DAY: '2.5' }).aiMaxGenerationsPerDevicePerDay,
    ).toBe(40);
  });

  it('refuse a provider or an effort they do not know, without echoing the key', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY })).toThrow(/AI_PROVIDER/);
    expect(() => loadConfig({ AI_EFFORT: 'max' })).toThrow(/AI_EFFORT/);
    try {
      loadConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY });
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});

describe('the AI settings read leniently', () => {
  it('ignore case and spaces in the names they accept', () => {
    expect(
      loadConfig({
        AI_PROVIDER: ' Anthropic ',
        AI_API_KEY: KEY,
        AI_EFFORT: 'Medium',
        AI_MODEL: ' claude-sonnet-5-5 ',
      }),
    ).toMatchObject({
      aiProvider: 'anthropic',
      aiEffort: 'medium',
      aiModel: 'claude-sonnet-5-5',
    });
  });
});
