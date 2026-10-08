import rateLimit from '@fastify/rate-limit';
import type { GeoSuggestion, ResolvedPlace } from '@rumbo/api-contract';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { installErrorHandling } from '../src/errors.js';
import { GeocodingError, type GeocodingProvider } from '../src/geo/provider.js';
import { geoRoutes, localeFrom } from '../src/routes/geo.js';

// GET /geo/suggest and /geo/resolve with a stand-in provider: the HTTP side
// (validation, language, headers, errors). The Wikidata provider has its
// own tests.

const CASTELO: GeoSuggestion = {
  key: 'wikidata:Q2969701',
  name: 'Castelo de Leiria',
  description: 'castelo medieval em Leiria',
  position: { lat: 39.747, lng: -8.81 },
  category: 'monument',
  externalId: 'Q2969701',
  distanceMeters: 421,
  storable: true,
};
const RESOLVED: ResolvedPlace = {
  key: 'wikidata:Q2969701',
  name: 'Castelo de Leiria',
  address: 'Leiria, Pousos, Barreira e Cortes',
  position: { lat: 39.747, lng: -8.81 },
  category: 'monument',
  externalId: 'Q2969701',
  storable: true,
};

/** A stand-in provider: Castelo de Leiria for every search, unless told otherwise. */
function provider(impl: Partial<GeocodingProvider> = {}) {
  return {
    suggest: vi.fn<GeocodingProvider['suggest']>(impl.suggest ?? (async () => [CASTELO])),
    resolve: vi.fn<GeocodingProvider['resolve']>(
      impl.resolve ?? (async (key) => (key === RESOLVED.key ? RESOLVED : null)),
    ),
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(geocoder: GeocodingProvider | null) {
  app = await buildApp(
    loadConfig({}),
    { database: null, data: () => null, geocoder },
    {
      logger: false,
    },
  );
  return app;
}

const get = (url: string, headers: Record<string, string> = {}) => {
  if (!app) throw new Error('start first');
  return app.inject({ method: 'GET', url, headers });
};

describe('GET /api/v1/geo/suggest', () => {
  it('asks the provider in the user language, near the rounded position', async () => {
    let abortedDuringCall: boolean | undefined;
    const geo = provider({
      suggest: async (_input, signal) => {
        abortedDuringCall = signal.aborted;
        return [CASTELO];
      },
    });
    await start(geo);
    const res = await get('/api/v1/geo/suggest?q=%20castelo%20&near=39.74449,-8.80711', {
      'accept-language': 'pt-PT,pt;q=0.9,en;q=0.5',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([CASTELO]);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers.vary).toBe('accept-language');
    const [input, signal] = geo.suggest.mock.calls[0] ?? [];
    expect(input).toEqual({
      q: 'castelo',
      kind: 'place',
      near: { lat: 39.744, lng: -8.807 },
      locale: 'pt',
      limit: 8,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(abortedDuringCall).toBe(false);
  });

  it('passes the kind and the limit, and no position when there is none', async () => {
    const geo = provider();
    await start(geo);
    await get('/api/v1/geo/suggest?q=Leir&kind=area&limit=3');
    const [input] = geo.suggest.mock.calls[0] ?? [];
    expect(input).toEqual({ q: 'Leir', kind: 'area', locale: 'es', limit: 3 });
    expect(input).not.toHaveProperty('near');
  });

  it('refuses bad queries with validation_failed, before the provider', async () => {
    const geo = provider();
    await start(geo);
    for (const query of [
      'q=a',
      'q=%20%20a%20',
      `q=${'x'.repeat(81)}`,
      'q=castelo&limit=11',
      'q=castelo&limit=0',
      'q=castelo&kind=city',
      'q=castelo&near=paris',
      'q=castelo&near=91,0',
      '',
    ]) {
      const res = await get(`/api/v1/geo/suggest?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('validation_failed');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(geo.suggest).not.toHaveBeenCalled();
  });

  it('answers 502 geocoding_failed or 503 geocoding_unavailable, never cached', async () => {
    let failure = new GeocodingError(502, 'timeout');
    await start(
      provider({
        suggest: async () => {
          throw failure;
        },
      }),
    );
    const failed = await get('/api/v1/geo/suggest?q=castelo');
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ code: 'geocoding_failed' });
    expect(failed.headers['cache-control']).toBe('no-store');
    expect(failed.headers.vary).toBeUndefined();

    failure = new GeocodingError(503, 'paused');
    const paused = await get('/api/v1/geo/suggest?q=castelo');
    expect(paused.statusCode).toBe(503);
    expect(paused.json()).toEqual({ code: 'geocoding_unavailable' });
    expect(paused.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 geocoding_unavailable when place search is off', async () => {
    await start(null);
    const res = await get('/api/v1/geo/suggest?q=castelo');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'geocoding_unavailable' });
    expect((await get('/api/v1/geo/resolve?key=wikidata:Q1')).statusCode).toBe(503);
  });
});

describe('GET /api/v1/geo/resolve', () => {
  it('answers the place with its address, in the user language', async () => {
    const geo = provider();
    await start(geo);
    const res = await get('/api/v1/geo/resolve?key=wikidata:Q2969701', {
      'accept-language': 'en-GB',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(RESOLVED);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers.vary).toBe('accept-language');
    expect(geo.resolve).toHaveBeenCalledWith('wikidata:Q2969701', 'en', expect.any(AbortSignal));
  });

  it('answers 404 place_not_found for an unknown key and 400 for a malformed one', async () => {
    await start(provider());
    const missing = await get('/api/v1/geo/resolve?key=wikidata:Q1');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'place_not_found' });
    expect(missing.headers['cache-control']).toBe('no-store');
    expect((await get('/api/v1/geo/resolve?key=Q1')).statusCode).toBe(400);
    expect((await get('/api/v1/geo/resolve')).statusCode).toBe(400);
  });
});

describe('the deadline of a search', () => {
  it('aborts the provider and answers 502 when it passes', async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    installErrorHandling(app);
    await app.register(rateLimit, { global: false });
    const seen: AbortSignal[] = [];
    await app.register(geoRoutes, {
      rateLimitPerMinute: 100,
      timeoutMs: 50,
      geocoder: provider({
        suggest: (_input, signal) => {
          seen.push(signal);
          return new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new GeocodingError(502, 'timeout'))),
          );
        },
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/v1/geo/suggest?q=castelo' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ code: 'geocoding_failed' });
    expect(seen[0]?.aborted).toBe(true);
    expect((seen[0]?.reason as Error | undefined)?.name).toBe('TimeoutError');
  });
});

describe('localeFrom', () => {
  it('takes the first of es, en and pt in Accept-Language, es otherwise', () => {
    expect(localeFrom('pt-PT')).toBe('pt');
    expect(localeFrom('en-GB,en;q=0.9')).toBe('en');
    expect(localeFrom('fr-FR, pt;q=0.5, en;q=0.4')).toBe('pt');
    expect(localeFrom('ES')).toBe('es');
    expect(localeFrom('de, fr')).toBe('es');
    expect(localeFrom('*')).toBe('es');
    expect(localeFrom(undefined)).toBe('es');
  });
});
