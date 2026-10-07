import { describe, expect, it } from 'vitest';
import { buildApp, stripPublicPrefix } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db.js';

const config = loadConfig({ SOURCE_COMMIT: 'abc1234def' });
const fakeDb = (healthy: boolean): Database => ({
  ping: async () => healthy,
  close: async () => {},
});

async function getHealth(db: Database | null, url = '/api/v1/health') {
  const app = buildApp(config, db, { logger: false });
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
    expect((await getHealth(null, '/api/v1/health')).statusCode).toBe(200);
    expect((await getHealth(null, '/v1/health')).statusCode).toBe(200);
  });
});

describe('GET /api/v1/health', () => {
  it('reports ok, the version and the served commit when the database answers', async () => {
    const res = await getHealth(fakeDb(true));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', commit: 'abc1234def', version: '0.1.0' });
  });

  it('stays 200 but flags the database when it does not answer', async () => {
    const res = await getHealth(fakeDb(false));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'error' });
  });

  it('marks the database as disabled when there is no DATABASE_URL', async () => {
    const res = await getHealth(null);
    expect(res.json()).toMatchObject({ db: 'disabled' });
  });
});

describe('loadConfig', () => {
  it('rejects an invalid PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
  });

  it('treats an empty DATABASE_URL as no database', () => {
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeNull();
  });
});
