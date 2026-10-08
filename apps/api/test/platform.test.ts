import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformOf } from '../src/device.js';
import { DEVICE, setupApi } from './helpers.js';

// Cross-cutting behaviour: OpenAPI docs, security headers, rate limits.

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  api = await setupApi({ rateLimitPerMinute: 3 });
});
afterAll(() => api.close());

describe('the API', () => {
  it('publishes its OpenAPI description under /api/v1/docs', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/routes',
        '/v1/routes/{id}',
        '/v1/runs',
        '/v1/runs/{runId}',
        '/v1/analytics/batch',
      ]),
    );
    expect(doc.servers).toEqual([{ url: '/api' }]);
  });

  it('sends security headers', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('limits requests per device with { code: "rate_limited" }', async () => {
    const hit = () =>
      api.app.inject({ method: 'GET', url: '/api/v1/routes', headers: { 'x-device-id': DEVICE } });
    for (let i = 0; i < 3; i++) expect((await hit()).statusCode).toBe(200);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'rate_limited' });
  });

  it('keeps only a rough platform from the User-Agent', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('desktop');
    expect(platformOf(undefined)).toBe('other');
  });
});
