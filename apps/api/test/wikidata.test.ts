import { readFileSync } from 'node:fs';
import { GeoSuggestResponseSchema, ResolvedPlaceSchema } from '@rumbo/api-contract';
import { describe, expect, it, vi } from 'vitest';
import { GeocodingError } from '../src/geo/provider.js';
import { normalizeQuery, placeTokens } from '../src/geo/query.js';
import { createWikidataGeocoder, type Fetch } from '../src/geo/wikidata.js';

// The Wikidata provider against answers recorded from the real API near
// Leiria (test/fixtures/wikidata, captured on 2026-10-08 and trimmed to the
// labels, descriptions and statements it reads). No test touches the network.

const UA = 'Rumbo/0.1.0 (https://github.com/AOcampo93/rumbo)';
const LEIRIA = { lat: 39.744, lng: -8.807 };
const EARTH = 'http://www.wikidata.org/entity/Q2';
const signal = () => AbortSignal.timeout(5000);

interface Exchange {
  url: string;
  body: unknown;
}

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/wikidata/${name}.json`, import.meta.url), 'utf8'),
  ) as Exchange[];

/** Same request whatever the order of its parameters. */
const canonical = (url: string) => {
  const parsed = new URL(url);
  parsed.searchParams.sort();
  return parsed.toString();
};

/** Wikidata as recorded in these fixtures; anything else answers 404. */
function recorded(names: string[], options: { gate?: Promise<void> } = {}) {
  const answers = new Map(names.flatMap(fixture).map(({ url, body }) => [canonical(url), body]));
  const fetch = vi.fn<Fetch>(async (url) => {
    await options.gate;
    const body = answers.get(canonical(url));
    return body === undefined ? new Response('Not found', { status: 404 }) : Response.json(body);
  });
  return fetch;
}

/** What each upstream request asked for: the full-text search or the API action and ids. */
const asked = (fetch: ReturnType<typeof recorded>) =>
  fetch.mock.calls.map(([url]) => {
    const params = new URL(url).searchParams;
    const search = params.get('srsearch');
    if (search) return search;
    return [params.get('action'), params.get('ids') ?? params.get('titles') ?? params.get('search')]
      .filter(Boolean)
      .join(' ');
  });

const geocoder = (fetch: Fetch, options: { now?: () => number; maxBodyBytes?: number } = {}) =>
  createWikidataGeocoder({ userAgent: UA, fetch, ...options });

/** A place search in Spanish, near Leiria unless `near` is null. */
const place = (q: string, near: typeof LEIRIA | null = LEIRIA) => ({
  q,
  kind: 'place' as const,
  ...(near ? { near } : {}),
  locale: 'es' as const,
  limit: 8,
});

// ------------------------------------------------------------ synthetic items

interface ItemSpec {
  id: string;
  labels?: Record<string, string>;
  descriptions?: Record<string, string>;
  types?: Array<string | { id: string; rank: string }>;
  coordinates?: Array<{ lat: number; lng: number; rank?: string; globe?: string }>;
}

const terms = (texts: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(texts).map(([language, value]) => [language, { language, value }]),
  );
const claim = (value: unknown, rank = 'normal') => ({
  rank,
  mainsnak: { snaktype: 'value', datavalue: { value } },
});

function item({
  id,
  labels = { pt: 'Lugar' },
  descriptions = {},
  types = [],
  coordinates = [{ lat: 39.745, lng: -8.808 }],
}: ItemSpec) {
  return {
    id,
    labels: terms(labels),
    descriptions: terms(descriptions),
    claims: {
      P31: types.map((type) =>
        typeof type === 'string' ? claim({ id: type }) : claim({ id: type.id }, type.rank),
      ),
      P625: coordinates.map(({ lat, lng, rank, globe }) =>
        claim({ latitude: lat, longitude: lng, globe: globe ?? EARTH }, rank),
      ),
    },
  };
}

/** A Wikidata whose search finds these items, in this order. */
function synthetic(items: ReturnType<typeof item>[]) {
  return vi.fn<Fetch>(async (url) => {
    const params = new URL(url).searchParams;
    if (params.get('list') === 'search') {
      return Response.json({ query: { search: items.map(({ id }) => ({ ns: 0, title: id })) } });
    }
    const ids = params.get('ids')?.split('|') ?? [];
    return Response.json({
      entities: Object.fromEntries(
        ids.map((id) => [
          id,
          items.find((candidate) => candidate.id === id) ?? { id, missing: '' },
        ]),
      ),
    });
  });
}

// ------------------------------------------------------------------ tests

describe('the query sent to Wikidata', () => {
  it('drops search syntax and anything not worth a search, without asking upstream', async () => {
    const fetch = recorded([]);
    const wikidata = geocoder(fetch);
    for (const q of [
      '--',
      '::',
      'insource:/x/',
      '!!',
      '-castelo',
      'a b',
      '…',
      'haswbstatement:P31',
    ]) {
      expect(await wikidata.suggest(place(q), signal())).toEqual([]);
    }
    // The label search has no syntax: only queries without a 2-character word stay home.
    for (const q of ['--', '::', '!!', 'a b', '…', '\u202e\u0000']) {
      expect(await wikidata.suggest({ ...place(q), kind: 'area' }, signal())).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps letters, digits, apostrophes, hyphens and dots, folded, at most 6 words', () => {
    expect(placeTokens(normalizeQuery('Sé de  Leiria'))).toEqual(['se', 'de', 'leiria']);
    expect(placeTokens(normalizeQuery('Mercado de Sant’Ana'))).toEqual([
      'mercado',
      'de',
      "sant'ana",
    ]);
    expect(placeTokens('nearcoord:1km,0,0 castelo intitle:x -igreja !museu')).toEqual(['castelo']);
    expect(placeTokens('x/-y "castelo" (s.) São*')).toEqual(['x', 'castelo', 's.', 'sao']);
    expect(placeTokens('um dois três quatro cinco seis sete')).toHaveLength(6);
  });

  it('applies NFKC and strips controls and bidi overrides before cutting at 80 characters', () => {
    expect(normalizeQuery('cas‮telo\u0000 de\tLeiria')).toBe('castelo de Leiria');
    // U+FDFA becomes 18 characters under NFKC: the cut comes after it.
    const expanded = normalizeQuery('ﷺ'.repeat(10));
    expect(Array.from(expanded).length).toBeLessThanOrEqual(80);
    expect(normalizeQuery('ｃａｓｔｅｌｏ')).toBe('castelo');
  });

  it('sends the cleaned words, the last one as a prefix, near the rounded position', async () => {
    const fetch = recorded(['castelo']);
    await geocoder(fetch).suggest(place('CAS‮TELO', { lat: 39.74449, lng: -8.80711 }), signal());
    expect(asked(fetch)[0]).toBe('castelo* haswbstatement:P625 nearcoord:20km,39.744,-8.807');
  });
});

describe('suggest kind=place (recorded near Leiria)', () => {
  it('asks once for the search and once for the items, politely', async () => {
    const fetch = recorded(['castelo']);
    await geocoder(fetch).suggest(place('castelo'), signal());
    expect(asked(fetch)).toEqual([
      'castelo* haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'wbgetentities Q2969701|Q5049818|Q109661393|Q114918174',
    ]);
    const [searchUrl, init] = fetch.mock.calls[0] ?? [];
    expect(Object.fromEntries(new URL(searchUrl ?? '').searchParams)).toMatchObject({
      action: 'query',
      list: 'search',
      srnamespace: '0',
      srlimit: '20',
      srprop: '',
      format: 'json',
      formatversion: '2',
    });
    expect(init).toMatchObject({
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'error',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const entitiesUrl = new URL(fetch.mock.calls[1]?.[0] ?? '');
    expect(Object.fromEntries(entitiesUrl.searchParams)).toMatchObject({
      props: 'labels|descriptions|claims',
      languages: 'es|pt|en|mul',
      languagefallback: '1',
    });
  });

  it('names, describes, places and classifies each item', async () => {
    const results = await geocoder(recorded(['castelo'])).suggest(place('castelo'), signal());
    expect(GeoSuggestResponseSchema.parse(results)).toEqual(results);
    expect(results[0]).toEqual({
      key: 'wikidata:Q2969701',
      name: 'Castillo de Leiria',
      description: 'castillo medieval localizado en la ciudad de Leiría, Portugal',
      position: { lat: 39.747, lng: -8.81 },
      category: 'monument',
      externalId: 'Q2969701',
      distanceMeters: 421,
      storable: true,
    });
    // No Spanish label of its own (only English standing in): the Portuguese one wins.
    expect(results[1]).toMatchObject({
      name: 'Castelo de Porto de Mós',
      description: 'castelo em Porto de Mós',
    });
    expect(results.map((r) => r.category)).toEqual(['monument', 'monument', 'monument', 'nature']);
  });

  it('ranks names that start with the query first, by any of their names, then by distance', async () => {
    const results = await geocoder(recorded(['caste'])).suggest(place('caste'), signal());
    // "Castillo de Leiria" is "Castelo de Leiria" in Portuguese: it starts with "caste".
    expect(results.map((r) => [r.externalId, r.distanceMeters])).toEqual([
      ['Q2969701', 421],
      ['Q5049818', 15673],
      ['Q109661393', 306],
      ['Q109451806', 535],
      ['Q114918174', 16009],
    ]);
    // Only an English description: it comes after Spanish and Portuguese ones would.
    expect(results[3]).toMatchObject({
      name: 'Casa Emília Ferreira da Cruz',
      description: 'House built in 1926, designed by Ernesto Korrodi',
      category: 'other',
    });
  });

  it('tries the last word whole, then without it, when the prefix finds too little', async () => {
    const fetch = recorded(['espirito-sant']);
    const results = await geocoder(fetch).suggest(place('espírito sant'), signal());
    expect(asked(fetch)).toEqual([
      'espirito sant* haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'espirito sant haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'espirito haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'wbgetentities Q76956778',
    ]);
    expect(results).toEqual([
      expect.objectContaining({
        name: 'Igreja do Espírito Santo',
        category: 'church',
        distanceMeters: 116,
      }),
    ]);
  });

  it('stops at the prefix search when it finds 3 places', async () => {
    const fetch = recorded(['mosteiro-bat']);
    const results = await geocoder(fetch).suggest(place('mosteiro bat'), signal());
    expect(asked(fetch)).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual([
      'Monasterio de Batalha',
      'Mosteiro View',
      'Batalha',
    ]);
  });

  it('looks 100 km around when nothing is near', async () => {
    const fetch = recorded(['obidos']);
    const results = await geocoder(fetch).suggest(place('Óbidos'), signal());
    expect(asked(fetch).slice(0, 3)).toEqual([
      'obidos* haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'obidos haswbstatement:P625 nearcoord:20km,39.744,-8.807',
      'obidos* haswbstatement:P625 nearcoord:100km,39.744,-8.807',
    ]);
    // At most limit + 6 items are fetched, and limit come back.
    expect(asked(fetch)[3]?.split(' ')[1]?.split('|')).toHaveLength(14);
    expect(results).toHaveLength(8);
    expect(results.find((r) => r.externalId === 'Q275862')).toMatchObject({
      name: 'Óbidos',
      distanceMeters: 52017,
    });
    expect(results.every((r) => (r.distanceMeters ?? 0) > 50_000)).toBe(true);
  });

  it('searches everywhere, with no distances, without a position', async () => {
    const fetch = synthetic([item({ id: 'Q1', labels: { es: 'Lugar' } })]);
    const results = await geocoder(fetch).suggest(place('lugar', null), signal());
    expect(asked(fetch)[0]).toBe('lugar* haswbstatement:P625');
    expect(results[0]).not.toHaveProperty('distanceMeters');
  });
});

describe('items as Wikidata sends them', () => {
  it('cleans names and descriptions and cuts them by code points (80 and 200)', async () => {
    const name = `${'A'.repeat(70)}‮${'B'.repeat(30)}`;
    const description = `${'x'.repeat(199)}😀${'y'.repeat(10)}`;
    const [result] = await geocoder(
      synthetic([item({ id: 'Q1', labels: { es: name }, descriptions: { es: description } })]),
    ).suggest(place('lugar'), signal());
    expect(result?.name).toBe(`${'A'.repeat(70)}${'B'.repeat(10)}`);
    expect(result?.description).toBe(`${'x'.repeat(199)}😀`);
  });

  it('classifies by the first known type, preferred statements first', async () => {
    const results = await geocoder(
      synthetic([
        item({ id: 'Q1', types: ['Q210272', 'Q16970'] }),
        item({ id: 'Q2', types: ['Q23413', { id: 'Q33506', rank: 'preferred' }] }),
        item({ id: 'Q3', types: [{ id: 'Q33506', rank: 'deprecated' }, 'Q41176'] }),
        item({ id: 'Q4' }),
        item({ id: 'Q5', types: ['Q6017969'] }),
      ]),
    ).suggest(place('lugar'), signal());
    expect(Object.fromEntries(results.map((r) => [r.externalId, r.category]))).toEqual({
      Q1: 'church',
      Q2: 'museum',
      Q3: 'other',
      Q4: 'other',
      Q5: 'viewpoint',
    });
  });

  it('takes Earth coordinates, preferred first, and drops items without a name or a position', async () => {
    const results = await geocoder(
      synthetic([
        item({
          id: 'Q1',
          coordinates: [
            { lat: 1, lng: 1, globe: 'http://www.wikidata.org/entity/Q405' },
            { lat: 39.1, lng: -8.1 },
            { lat: 39.7501234567, lng: -8.8, rank: 'preferred' },
          ],
        }),
        item({ id: 'Q2', coordinates: [] }),
        item({ id: 'Q3', labels: { fr: 'Lieu' } }),
        item({ id: 'Q4', coordinates: [{ lat: 95, lng: 0 }] }),
      ]),
    ).suggest(place('lugar'), signal());
    expect(results.map((r) => [r.externalId, r.position])).toEqual([
      ['Q1', { lat: 39.750123, lng: -8.8 }],
    ]);
  });
});

describe('suggest kind=area', () => {
  it('searches labels, then keeps the hits with coordinates, in search order', async () => {
    const fetch = recorded(['area-leir']);
    const results = await geocoder(fetch).suggest(
      { q: 'Leir', kind: 'area', near: LEIRIA, locale: 'es', limit: 8 },
      signal(),
    );
    const [search, coordinates] = fetch.mock.calls.map(([url]) =>
      Object.fromEntries(new URL(url).searchParams),
    );
    expect(search).toMatchObject({
      action: 'wbsearchentities',
      search: 'leir',
      language: 'es',
      uselang: 'es',
      type: 'item',
      limit: '11',
    });
    expect(coordinates).toMatchObject({ action: 'query', prop: 'coordinates', colimit: 'max' });
    expect(coordinates?.['titles']?.split('|')).toHaveLength(11);
    expect(GeoSuggestResponseSchema.parse(results)).toEqual(results);
    expect(results.map((r) => [r.externalId, r.name])).toEqual([
      ['Q206933', 'Leiría'],
      ['Q48870', 'Leirfjord'],
      ['Q18468276', 'Leiría, Pousos, Barreira e Cortes'],
      ['Q244512', 'Leiría'],
      ['Q796', 'Irak'],
    ]);
    expect(results[0]).toEqual({
      key: 'wikidata:Q206933',
      name: 'Leiría',
      description: 'municipio de Portugal',
      position: { lat: 39.743056, lng: -8.806944 },
      externalId: 'Q206933',
      storable: true,
    });
  });
});

describe('resolve', () => {
  it('gives the street address when the item has one', async () => {
    const fetch = recorded(['resolve-banco-das-artes']);
    const resolved = await geocoder(fetch).resolve('wikidata:Q112568674', 'es', signal());
    expect(ResolvedPlaceSchema.parse(resolved)).toEqual({
      key: 'wikidata:Q112568674',
      name: 'Banco das Artes Galeria',
      address: 'Largo 5 de Outubro nº 43 2400-120 Leiria',
      position: { lat: 39.745006, lng: -8.807147 },
      category: 'museum',
      externalId: 'Q112568674',
      storable: true,
    });
    expect(asked(fetch)).toEqual(['wbgetentities Q112568674']);
  });

  it('otherwise names the administrative areas the place is in', async () => {
    const fetch = recorded(['resolve-castelo']);
    const resolved = await geocoder(fetch).resolve('wikidata:Q2969701', 'es', signal());
    expect(resolved).toEqual({
      key: 'wikidata:Q2969701',
      name: 'Castillo de Leiria',
      address: 'Leiría, Pousos, Barreira e Cortes',
      position: { lat: 39.747, lng: -8.81 },
      category: 'monument',
      externalId: 'Q2969701',
      storable: true,
    });
    expect(asked(fetch)).toEqual(['wbgetentities Q2969701', 'wbgetentities Q18468276']);
    expect(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams.get('props')).toBe('labels|claims');
    expect(new URL(fetch.mock.calls[1]?.[0] ?? '').searchParams.get('props')).toBe('labels');
  });

  it('is null for other keys, missing items and items without coordinates', async () => {
    const fetch = synthetic([item({ id: 'Q2', coordinates: [] })]);
    const wikidata = geocoder(fetch);
    for (const key of ['arcgis:abc', 'wikidata:Q', 'wikidata:Q1234567890123', 'Q2969701']) {
      expect(await wikidata.resolve(key, 'es', signal())).toBe(null);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await wikidata.resolve('wikidata:Q1', 'es', signal())).toBe(null);
    expect(await wikidata.resolve('wikidata:Q2', 'es', signal())).toBe(null);
    // "No such place" is not cached: asked again.
    await wikidata.resolve('wikidata:Q1', 'es', signal());
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('cost bounds', () => {
  it('caches answers for a day, never failures', async () => {
    let clock = 1_000_000;
    let failing = true;
    const answers = recorded(['castelo']);
    const fetch = vi.fn<Fetch>(async (url, init) =>
      failing ? new Response('busy', { status: 404 }) : answers(url, init),
    );
    const wikidata = geocoder(fetch, { now: () => clock });
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 502,
      reason: 'upstream_status',
    });
    failing = false;
    const first = await wikidata.suggest(place('castelo'), signal());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await wikidata.suggest(place('CASTELO '), signal())).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(3);
    clock += 24 * 3_600_000 + 1;
    await wikidata.suggest(place('castelo'), signal());
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('shares one upstream job between identical requests in flight', async () => {
    let open!: () => void;
    const fetch = recorded(['castelo'], { gate: new Promise<void>((resolve) => (open = resolve)) });
    const wikidata = geocoder(fetch);
    const first = wikidata.suggest(place('castelo'), signal());
    const second = wikidata.suggest(place('castelo'), signal());
    open();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the job for whoever still waits', async () => {
    let open!: () => void;
    const fetch = recorded(['castelo'], { gate: new Promise<void>((resolve) => (open = resolve)) });
    const wikidata = geocoder(fetch);
    const leaving = new AbortController();
    const left = wikidata.suggest(place('castelo'), leaving.signal);
    const staying = wikidata.suggest(place('castelo'), signal());
    leaving.abort();
    await expect(left).rejects.toMatchObject({ status: 502, reason: 'aborted' });
    open();
    expect(await staying).toHaveLength(4);
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(false);
  });

  it('stops the upstream request when nobody waits any more', async () => {
    let open!: () => void;
    const fetch = recorded(['caste'], { gate: new Promise<void>((resolve) => (open = resolve)) });
    const wikidata = geocoder(fetch);
    const a = new AbortController();
    const b = new AbortController();
    const first = wikidata.suggest(place('caste'), a.signal).catch((error: unknown) => error);
    const second = wikidata.suggest(place('caste'), b.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const upstream = fetch.mock.calls[0]?.[1].signal;
    a.abort();
    expect(await first).toMatchObject({ status: 502, reason: 'aborted' });
    expect(upstream?.aborted).toBe(false);
    b.abort();
    expect(await second).toMatchObject({ status: 502, reason: 'aborted' });
    expect(upstream?.aborted).toBe(true);
    open();
    // A new request starts afresh instead of joining the stopped job.
    expect(await wikidata.suggest(place('caste'), signal())).toHaveLength(5);
  });

  it('answers 502 timeout at the caller deadline and aborts the upstream request', async () => {
    const fetch = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const error = await geocoder(fetch)
      .suggest(place('castelo'), AbortSignal.timeout(30))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeocodingError);
    expect(error).toMatchObject({ status: 502, reason: 'timeout' });
    expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });

  it('runs at most maxConcurrency upstream requests at once', async () => {
    let active = 0;
    let most = 0;
    const answers = recorded(['castelo', 'caste', 'mosteiro-bat']);
    const fetch = vi.fn<Fetch>(async (url, init) => {
      most = Math.max(most, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return answers(url, init);
    });
    const wikidata = createWikidataGeocoder({ userAgent: UA, fetch, maxConcurrency: 1 });
    const results = await Promise.all(
      ['castelo', 'caste', 'mosteiro bat'].map((q) => wikidata.suggest(place(q), signal())),
    );
    expect(results.map((r) => r.length)).toEqual([4, 5, 3]);
    expect(most).toBe(1);
  });

  it('refuses bodies over the limit, and splits a batch of items until they fit', async () => {
    const big = vi.fn<Fetch>(async () => new Response('x'.repeat(2000)));
    await expect(
      geocoder(big, { maxBodyBytes: 1000 }).suggest(place('castelo'), signal()),
    ).rejects.toMatchObject({ status: 502, reason: 'too_large' });
    const declared = vi.fn<Fetch>(
      async () => new Response('{}', { headers: { 'content-length': '5000' } }),
    );
    await expect(
      geocoder(declared, { maxBodyBytes: 1000 }).suggest(place('castelo'), signal()),
    ).rejects.toMatchObject({ reason: 'too_large' });

    // A few small items fit together; a huge one doesn't even alone and is left out.
    const items = ['Q1', 'Q2', 'Q3'].map((id) => item({ id, labels: { es: `Lugar ${id}` } }));
    const huge = item({
      id: 'Q4',
      labels: { es: 'Lugar enorme' },
      descriptions: { es: 'z'.repeat(2000) },
    });
    const fetch = synthetic([...items, huge]);
    const results = await geocoder(fetch, { maxBodyBytes: 1000 }).suggest(place('lugar'), signal());
    expect(results.map((r) => r.externalId)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(asked(fetch).filter((request) => request.startsWith('wbgetentities'))).toEqual([
      'wbgetentities Q1|Q2|Q3|Q4',
      'wbgetentities Q1|Q2',
      'wbgetentities Q3|Q4',
      'wbgetentities Q3',
      'wbgetentities Q4',
    ]);

    // Splitting has a budget: 7 requests, whatever is still too big is left out.
    const giants = Array.from({ length: 14 }, (_, i) =>
      item({ id: `Q${i + 10}`, descriptions: { es: 'z'.repeat(2000) } }),
    );
    const costly = synthetic(giants);
    expect(
      await geocoder(costly, { maxBodyBytes: 1000 }).suggest(place('lugar'), signal()),
    ).toEqual([]);
    expect(asked(costly).filter((request) => request.startsWith('wbgetentities'))).toHaveLength(7);
  });
});

describe('when Wikimedia says to slow down', () => {
  it('pauses for its Retry-After (503 geocoding_unavailable) without asking again', async () => {
    let clock = 1_000_000;
    const answers = recorded(['castelo', 'caste']);
    let status = 429;
    const fetch = vi.fn<Fetch>(async (url, init) =>
      status === 200
        ? answers(url, init)
        : new Response('Too many requests', { status, headers: { 'retry-after': '120' } }),
    );
    const wikidata = geocoder(fetch, { now: () => clock });
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 503,
      reason: 'rate_limited',
    });
    await expect(wikidata.suggest(place('caste'), signal())).rejects.toMatchObject({
      status: 503,
      reason: 'paused',
    });
    await expect(wikidata.resolve('wikidata:Q1', 'es', signal())).rejects.toMatchObject({
      reason: 'paused',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += 119_000;
    await expect(wikidata.suggest(place('caste'), signal())).rejects.toMatchObject({
      reason: 'paused',
    });
    clock += 2000;
    status = 200;
    expect(await wikidata.suggest(place('castelo'), signal())).toHaveLength(4);
  });

  it('pauses a minute after a 5xx without Retry-After, and honours dates and maxlag', async () => {
    let clock = Date.parse('2026-10-08T10:00:00Z');
    let answer: () => Response = () => new Response('down', { status: 503 });
    const fetch = vi.fn<Fetch>(async () => answer());
    const wikidata = geocoder(fetch, { now: () => clock });
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 503,
      reason: 'upstream_down',
    });
    clock += 59_000;
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      reason: 'paused',
    });
    clock += 2000;
    answer = () =>
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': new Date(clock + 30_000).toUTCString() },
      });
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      reason: 'rate_limited',
    });
    clock += 31_000;
    answer = () =>
      Response.json(
        { error: { code: 'maxlag', info: 'Waiting for a database server' } },
        { headers: { 'retry-after': '5' } },
      );
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 503,
      reason: 'rate_limited',
    });
    clock += 4000;
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      reason: 'paused',
    });
    clock += 2000;
    answer = () => Response.json({ query: { search: [] } });
    expect(await wikidata.suggest(place('castelo'), signal())).toEqual([]);
    // 503, 429, maxlag, then the three searches of a query that finds nothing.
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});

describe('failures', () => {
  it('say only their status and reason: never the URL, the query or the body', async () => {
    const fetch = vi.fn<Fetch>(async () =>
      Response.json({ error: { code: 'badvalue', info: 'Bad srsearch: castelo secreto' } }),
    );
    const error = await geocoder(fetch)
      .suggest(place('castelo secreto'), signal())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GeocodingError);
    expect(error).toMatchObject({ status: 502, reason: 'upstream_error' });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      status: 502,
      reason: 'upstream_error',
      name: 'GeocodingError',
    });
    expect(String((error as Error).message)).not.toMatch(/castelo|wikidata|srsearch/);
    expect(String((error as Error).stack)).not.toMatch(/castelo|srsearch/);
  });

  it('tell network errors and bad bodies apart, and ask again next time', async () => {
    let answer: () => Promise<Response> = async () => {
      throw new TypeError('fetch failed');
    };
    const fetch = vi.fn<Fetch>(() => answer());
    const wikidata = geocoder(fetch);
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 502,
      reason: 'network',
    });
    answer = async () => new Response('<html>oops</html>');
    await expect(wikidata.suggest(place('castelo'), signal())).rejects.toMatchObject({
      status: 502,
      reason: 'bad_response',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
