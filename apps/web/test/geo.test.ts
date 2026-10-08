import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatNear, GeoError, resolvePlace, suggestPlaces } from '../src/services/geo.ts';

// Place search for the creator: the request we send and the answers we accept.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const castle = {
  key: 'wikidata:Q1023767',
  name: 'Castelo de Leiria',
  description: 'castelo em Leiria, Portugal',
  position: { lat: 39.7473, lng: -8.8077 },
  category: 'monument',
  externalId: 'Q1023767',
  distanceMeters: 320,
  storable: true,
};

function stubFetch(answer: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => answer());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('suggestPlaces()', () => {
  it('rounds the position to 3 decimals before it leaves the device', async () => {
    const fetchMock = stubFetch(async () => json([castle]));
    const results = await suggestPlaces({
      q: ' castelo ',
      near: { lat: 39.747_312_9, lng: -8.807_749 },
      kind: 'place',
    });
    expect(results).toEqual([castle]);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://x');
    expect(url.pathname).toBe('/api/v1/geo/suggest');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'castelo',
      kind: 'place',
      near: '39.747,-8.808',
    });
  });

  it('never writes a position in exponent notation', () => {
    expect(formatNear({ lat: 0.000_000_1, lng: -0.000_1 })).toMatch(/^-?\d+\.\d{3},-?\d+\.\d{3}$/);
  });

  it("refuses answers that don't follow the contract", async () => {
    stubFetch(async () => json([{ ...castle, position: { lat: 200, lng: 0 } }]));
    await expect(suggestPlaces({ q: 'castelo' })).rejects.toMatchObject({ code: 'failed' });
    stubFetch(async () => new Response('<html></html>', { status: 200 }));
    await expect(suggestPlaces({ q: 'castelo' })).rejects.toMatchObject({ code: 'failed' });
  });

  it('says why it failed: rate limit, provider down, API away, offline', async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [async () => json({ code: 'rate_limited' }, 429), 'rate_limited'],
      [async () => json({ code: 'geocoding_unavailable' }, 503), 'unavailable'],
      [async () => new Response('Bad gateway', { status: 502 }), 'unavailable'],
      [async () => json({ code: 'geocoding_failed' }, 502), 'failed'],
      [async () => Promise.reject(new TypeError('Failed to fetch')), 'failed'],
    ];
    for (const [answer, code] of cases) {
      stubFetch(answer);
      const error = await suggestPlaces({ q: 'sé' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GeoError);
      expect(error).toMatchObject({ code });
    }
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    stubFetch(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(suggestPlaces({ q: 'sé' })).rejects.toMatchObject({ code: 'offline' });
    online.mockRestore();
  });

  it("passes a replaced query's abort through, not as an error to show", async () => {
    stubFetch(async () => json([]));
    const controller = new AbortController();
    controller.abort();
    const error = await suggestPlaces({ q: 'sé' }, controller.signal).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(GeoError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});

describe('resolvePlace()', () => {
  it('returns the details, or null when the place is gone', async () => {
    const fetchMock = stubFetch(async () =>
      json({ ...castle, address: 'Rua do Castelo, Leiria', distanceMeters: undefined }),
    );
    expect(await resolvePlace('wikidata:Q1023767')).toMatchObject({
      name: 'Castelo de Leiria',
      address: 'Rua do Castelo, Leiria',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/geo/resolve?key=wikidata%3AQ1023767',
    );
    stubFetch(async () => json({ code: 'place_not_found' }, 404));
    expect(await resolvePlace('wikidata:Q1')).toBeNull();
  });
});
