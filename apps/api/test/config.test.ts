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

describe('the community routes settings', () => {
  it('allow 10 reports a minute per address unless the environment says otherwise', () => {
    expect(loadConfig({}).reportRateLimitPerMinute).toBe(10);
    // The empty value of a copied .env.example is the default too.
    expect(loadConfig({ REPORT_RATE_LIMIT_PER_MINUTE: '' }).reportRateLimitPerMinute).toBe(10);
    expect(loadConfig({ REPORT_RATE_LIMIT_PER_MINUTE: '3' }).reportRateLimitPerMinute).toBe(3);
  });

  it('fall back on the default for a number that is not a positive whole one', () => {
    for (const bad of ['many', '0', '-3', '2.5', 'Infinity', 'NaN']) {
      expect(loadConfig({ REPORT_RATE_LIMIT_PER_MINUTE: bad }).reportRateLimitPerMinute, bad).toBe(
        10,
      );
    }
  });
});

describe('the route covers settings', () => {
  // Made up for the tests: a credential in a URL, to see that no message repeats it.
  const PASSWORD = ['made', 'up', 'password'].join('-');

  it('are the production origin, 10 uploads a minute per address, 30 a day per device and 300 MB', () => {
    const empty = loadConfig({});
    expect(empty).toMatchObject({
      publicOrigin: 'https://rumbo.arturoocampo.com',
      mediaRateLimitPerMinute: 10,
      mediaUploadsPerDevicePerDay: 30,
      mediaMaxTotalMb: 300,
    });
    // The empty values of a copied .env.example are the defaults too.
    expect(
      loadConfig({
        PUBLIC_ORIGIN: '',
        MEDIA_RATE_LIMIT_PER_MINUTE: '',
        MEDIA_UPLOADS_PER_DEVICE_PER_DAY: '',
        MEDIA_MAX_TOTAL_MB: '',
      }),
    ).toEqual(empty);
    expect(loadConfig({ PUBLIC_ORIGIN: '   ' }).publicOrigin).toBe(
      'https://rumbo.arturoocampo.com',
    );
  });

  it('read the environment', () => {
    expect(
      loadConfig({
        PUBLIC_ORIGIN: 'http://localhost:5173',
        MEDIA_RATE_LIMIT_PER_MINUTE: '3',
        MEDIA_UPLOADS_PER_DEVICE_PER_DAY: '5',
        MEDIA_MAX_TOTAL_MB: '0.5',
      }),
    ).toMatchObject({
      publicOrigin: 'http://localhost:5173',
      mediaRateLimitPerMinute: 3,
      mediaUploadsPerDevicePerDay: 5,
      mediaMaxTotalMb: 0.5,
    });
  });

  it('fall back on the defaults for a number that is not a positive one', () => {
    for (const bad of ['many', '0', '-3', 'Infinity', 'NaN']) {
      expect(
        loadConfig({
          MEDIA_RATE_LIMIT_PER_MINUTE: bad,
          MEDIA_UPLOADS_PER_DEVICE_PER_DAY: bad,
          MEDIA_MAX_TOTAL_MB: bad,
        }),
        bad,
      ).toMatchObject({
        mediaRateLimitPerMinute: 10,
        mediaUploadsPerDevicePerDay: 30,
        mediaMaxTotalMb: 300,
      });
    }
    // The counts are whole numbers; the space may be a fraction of a MB.
    const fractions = loadConfig({
      MEDIA_RATE_LIMIT_PER_MINUTE: '2.5',
      MEDIA_UPLOADS_PER_DEVICE_PER_DAY: '1.5',
      MEDIA_MAX_TOTAL_MB: '2.5',
    });
    expect(fractions).toMatchObject({
      mediaRateLimitPerMinute: 10,
      mediaUploadsPerDevicePerDay: 30,
      mediaMaxTotalMb: 2.5,
    });
  });

  it('keep only the origin of PUBLIC_ORIGIN: scheme, host and port', () => {
    const origins: Array<[string, string]> = [
      ['https://rumbo.example.com', 'https://rumbo.example.com'],
      ['https://rumbo.example.com/', 'https://rumbo.example.com'],
      ['  https://rumbo.example.com/  ', 'https://rumbo.example.com'],
      ['HTTPS://Rumbo.Example.com', 'https://rumbo.example.com'],
      ['https://rumbo.example.com:443', 'https://rumbo.example.com'],
      ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
      ['http://localhost:5173', 'http://localhost:5173'],
    ];
    for (const [given, origin] of origins) {
      expect(loadConfig({ PUBLIC_ORIGIN: given }).publicOrigin, given).toBe(origin);
    }
  });

  it('refuse a PUBLIC_ORIGIN that is not an origin, without echoing its credentials', () => {
    for (const bad of [
      'rumbo.example.com',
      'ftp://rumbo.example.com',
      'https://rumbo.example.com/app',
      'https://rumbo.example.com/api/v1',
      'https://rumbo.example.com?x=1',
      'https://rumbo.example.com/#top',
      `https://user:${PASSWORD}@rumbo.example.com`,
      'javascript:alert(1)',
      'https://',
    ]) {
      expect(() => loadConfig({ PUBLIC_ORIGIN: bad }), bad).toThrow(/PUBLIC_ORIGIN/);
      try {
        loadConfig({ PUBLIC_ORIGIN: bad });
      } catch (error) {
        expect((error as Error).message).not.toContain(PASSWORD);
      }
    }
  });
});
