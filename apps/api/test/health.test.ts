import { describe, expect, it } from 'vitest';
import { buildApp, stripPublicPrefix } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db/index.js';

const config = loadConfig({ SOURCE_COMMIT: 'abc1234def' });
const fakeDb = (healthy: boolean) =>
  ({ ping: async () => healthy, close: async () => {} }) as unknown as Database;

async function request(database: Database | null, url = '/api/v1/health') {
  const app = await buildApp(config, { database, data: () => null }, { logger: false });
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

describe('public prefix', () => {
  it('strips /api only when it is a whole path segment', () => {
    expect(stripPublicPrefix('/api/v1/health')).toBe('/v1/health');
    expect(stripPublicPrefix('/api')).toBe('/');
    expect(stripPublicPrefix('/v1/health')).toBe('/v1/health');
    expect(stripPublicPrefix('/apiary')).toBe('/apiary');
  });

  it('serves the same route whether or not the proxy already stripped /api', async () => {
    expect((await request(null, '/api/v1/health')).statusCode).toBe(200);
    expect((await request(null, '/v1/health')).statusCode).toBe(200);
  });
});

describe('GET /api/v1/health', () => {
  it('reports ok, the version and the served commit when the database answers', async () => {
    const res = await request(fakeDb(true));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', commit: 'abc1234def' });
    expect(res.json().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('stays 200 when the database is down or absent', async () => {
    expect((await request(fakeDb(false))).json()).toMatchObject({ status: 'ok', db: 'error' });
    expect((await request(null)).json()).toMatchObject({ status: 'ok', db: 'disabled' });
  });

  it('reads the commit from SOURCE_COMMIT and treats an empty one as unknown', () => {
    expect(loadConfig({ SOURCE_COMMIT: '' }).commit).toBe(null);
    expect(loadConfig({}).analyticsEnabled).toBe(true);
    expect(loadConfig({ ANALYTICS_ENABLED: 'false' }).analyticsEnabled).toBe(false);
  });
});

describe('without a ready database', () => {
  it('answers 503 { code: "unavailable" } on data endpoints', async () => {
    const res = await request(null, '/api/v1/routes');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'unavailable' });
  });

  it('answers unknown paths with { code: "not_found" }', async () => {
    const res = await request(null, '/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'not_found' });
  });
});
