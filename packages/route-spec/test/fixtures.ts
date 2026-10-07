import type { Locale, PointContent, RouteSpecInput } from '../src/index.ts';

/**
 * A small valid free route in central Leiria. The castle and the cathedral are
 * about 445 m apart, so their 40 m zones don't overlap. Each call returns a
 * fresh object that tests can mutate.
 */
export function freeRoute(overrides: Partial<RouteSpecInput> = {}): RouteSpecInput {
  return {
    specVersion: 1,
    id: 'leiria-test',
    name: { es: 'Leiria de prueba', en: 'Test Leiria', pt: 'Leiria de teste' },
    locale: 'es',
    mode: 'free',
    source: 'curated',
    points: [
      {
        id: 'castelo',
        name: 'Castelo de Leiria',
        position: { lat: 39.7476, lng: -8.807 },
        order: 1,
        triggers: { onEnter: 'castelo_info' },
        contentRef: 'c-castelo',
      },
      { id: 'se', name: 'Sé de Leiria', position: { lat: 39.7436, lng: -8.8075 }, order: 2 },
    ],
    actions: {
      castelo_info: {
        type: 'info_sheet',
        params: { title: { es: 'El castillo', en: 'The castle', pt: 'O castelo' } },
      },
    },
    ...overrides,
  };
}

/** A minimal approved card for `id` in `locale`. */
export function card(id: string, locale: Locale, title = 'Castelo de Leiria'): PointContent {
  return {
    id,
    locale,
    title,
    summary: 'Medieval castle above the city.',
    facts: [],
    images: [],
    sources: [{ title: 'Wikipedia', url: 'https://pt.wikipedia.org/wiki/Castelo_de_Leiria' }],
    status: 'approved',
  };
}
