import { destination } from '@rumbo/geo-utils';
import {
  buildRouteSpec,
  DRAFT_LIMITS,
  type DraftPlace,
  type RouteDraft,
  truncateText,
} from '@rumbo/route-builder';
import { type RouteSpec, validateRouteBundle } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import { checkUserRoute, MAX_ERROR_DETAILS, USER_ROUTE_LIMITS } from '../src/index.ts';

const start = { lat: 39.7476, lng: -8.807 };

/** `count` places `gap` metres apart, heading east. */
function places(count: number, gap = 300): DraftPlace[] {
  return Array.from({ length: count }, (_, i) => ({
    tempId: `t${i + 1}`,
    name: `Place ${i + 1}`,
    position: destination(start, 90, i * gap),
  }));
}

function draft(overrides: Partial<RouteDraft> = {}): RouteDraft {
  const [castle, cathedral, custom] = places(3);
  return {
    name: 'Leiria en una mañana',
    locale: 'es',
    mode: 'free',
    activity: 'walk',
    interests: ['history', 'art'],
    places: [
      {
        ...castle!,
        name: 'Castelo de Leiria',
        address: 'Rua do Castelo, Leiria',
        externalId: 'Q2969701',
        category: 'monument',
      },
      { ...cathedral!, name: 'Sé de Leiria', radius: 60, required: false, category: 'church' },
      { ...custom!, name: 'Punto personalizado 1', category: 'other' },
    ],
    ...overrides,
  };
}

/** What the web sends: the authored spec as JSON, and no cards. */
function userRoute(overrides: Partial<RouteDraft> = {}): { spec: RouteSpec; contents: object } {
  const { spec } = buildRouteSpec(draft(overrides), {
    source: 'user',
    idFactory: () => 'k3x9q2m7p1',
  });
  return { spec: JSON.parse(JSON.stringify(spec)) as RouteSpec, contents: {} };
}

const paths = (bundle: unknown) => checkUserRoute(bundle).map((issue) => issue.path);

describe('checkUserRoute: what the creator makes', () => {
  it('accepts every route buildRouteSpec makes', () => {
    const routes = [
      userRoute(),
      userRoute({ mode: 'challenge', activity: 'bike', timeLimit: 3600, interests: [] }),
      userRoute({ places: places(DRAFT_LIMITS.maxPlaces, 100) }),
    ];
    for (const bundle of routes) {
      expect(validateRouteBundle(bundle).errors).toEqual([]);
      expect(checkUserRoute(bundle)).toEqual([]);
    }
    expect(checkUserRoute({ spec: userRoute().spec })).toEqual([]);
  });

  it('accepts the longest names and addresses place search gives', () => {
    const long = draft().places.map((place) => ({
      ...place,
      name: truncateText(`Igreja 😀 ${'muito '.repeat(30)}`, DRAFT_LIMITS.nameMax),
      address: truncateText(`Rua 🇵🇹 ${'longa '.repeat(60)}`, DRAFT_LIMITS.addressMax),
    }));
    const bundle = userRoute({ places: long });
    expect(validateRouteBundle(bundle).errors).toEqual([]);
    expect(checkUserRoute(bundle)).toEqual([]);
  });

  it('agrees with the creator on its limits', () => {
    expect(USER_ROUTE_LIMITS.maxRouteMeters).toBe(DRAFT_LIMITS.maxRouteMeters);
    expect(USER_ROUTE_LIMITS.addressMax).toBe(DRAFT_LIMITS.addressMax);
  });
});

describe('checkUserRoute: refuses what the creator never makes', () => {
  it('a route that is not a user route, or a card no action uses', () => {
    const bundle = userRoute();
    bundle.spec.source = 'curated';
    bundle.contents = { 'c-castelo': {} };
    expect(paths(bundle)).toEqual(['spec.source', 'contents.c-castelo', 'contents.c-castelo']);
    expect(paths({ ...userRoute(), contents: [] })).toEqual(['contents']);
  });

  it('a path, a cover image, a description, or a summary that is not plain text', () => {
    const bundle = userRoute();
    bundle.spec.path = [start, destination(start, 0, 100)];
    bundle.spec.coverImage = { url: 'https://example.com/pixel.png', alt: 'x' };
    bundle.spec.description = 'Una descripción';
    bundle.spec.summary = { es: 'Un resumen' };
    expect(paths(bundle)).toEqual([
      'spec.summary',
      'spec.path',
      'spec.coverImage',
      'spec.description',
    ]);
    expect(paths(userRoute({ summary: 'Castillo, sé y río' }))).toEqual([]);
  });

  it('route meta other than up to 10 short interests', () => {
    const extra = userRoute();
    extra.spec.meta = { interests: ['history'], blob: 'x'.repeat(1000) };
    expect(paths(extra)).toEqual(['spec.meta']);
    const many = userRoute();
    many.spec.meta = { interests: Array.from({ length: 11 }, (_, i) => `i${i}`) };
    expect(paths(many)).toEqual(['spec.meta.interests']);
    const long = userRoute();
    long.spec.meta = { interests: ['history', 'x'.repeat(41)] };
    expect(paths(long)).toEqual(['spec.meta.interests[1]']);
  });

  it('point meta other than an address and a Wikidata id', () => {
    const bundle = userRoute();
    bundle.spec.points[0]!.meta = { address: 'x'.repeat(201), externalId: 'P31' };
    bundle.spec.points[1]!.meta = { website: 'https://example.com' };
    expect(paths(bundle)).toEqual([
      'spec.points[0].meta.address',
      'spec.points[0].meta.externalId',
      'spec.points[1].meta',
    ]);
    bundle.spec.points[0]!.meta = { externalId: `Q${'1'.repeat(13)}` };
    bundle.spec.points[1]!.meta = {};
    expect(paths(bundle)).toEqual(['spec.points[0].meta.externalId']);
  });

  it('actions of other types, images, presentation or feedback', () => {
    const bundle = userRoute();
    const actions = bundle.spec.actions;
    actions['content_castelo-de-leiria'] = {
      type: 'info_sheet',
      params: { title: 'Castelo', image: { url: 'https://example.com/pixel.png', alt: 'x' } },
    };
    actions['content_se-de-leiria'] = { type: 'redirect', params: { url: 'https://example.com' } };
    actions['content_punto-personalizado-1'] = {
      type: 'ai_template',
      params: {},
      presentation: 'toast',
      feedback: { sound: 'x'.repeat(10_000) },
    };
    actions['decision_idle'] = { type: 'decision', params: { preset: 'lunch' } };
    expect(paths(bundle)).toEqual([
      'spec.actions.content_castelo-de-leiria.params',
      'spec.actions.content_se-de-leiria.type',
      'spec.actions.content_punto-personalizado-1.params.contentRef',
      'spec.actions.content_punto-personalizado-1.presentation',
      'spec.actions.content_punto-personalizado-1.feedback',
      'spec.actions.decision_idle.params', // neither a preset nor a question
    ]);
  });

  it('more actions than one per point plus 8', () => {
    const bundle = userRoute();
    for (let i = 0; i < 4; i++) {
      bundle.spec.actions[`spare_${i}`] = { type: 'decision', params: { preset: 'idle' } };
    }
    expect(paths(bundle)).toEqual([]); // 3 cards + 4 decisions + 4 spare = 3 points + 8
    bundle.spec.actions['spare_4'] = { type: 'decision', params: { preset: 'idle' } };
    expect(checkUserRoute(bundle)).toEqual([
      { path: 'spec.actions', message: 'At most 11 actions: one per point plus 8' },
    ]);
  });

  it('triggers other than the interruptions and arriving at a point', () => {
    const bundle = userRoute();
    bundle.spec.triggers = { ...bundle.spec.triggers, onStart: 'decision_idle', onFinish: null };
    bundle.spec.points[0]!.triggers = {
      onEnter: 'content_castelo-de-leiria',
      onApproach: null,
      onExit: 'decision_idle',
    };
    expect(paths(bundle)).toEqual(['spec.triggers.onStart', 'spec.points[0].triggers.onExit']);
  });

  it('texts or keys that Postgres cannot store, or that hide controls', () => {
    const bundle = userRoute();
    bundle.spec.name = 'Leiria\u0000';
    bundle.spec.points[0]!.name = 'Castelo\tde Leiria';
    bundle.spec.points[1]!.meta = { address: 'Largo da Sé \uD800' };
    bundle.spec.points[2]!.meta = { ['\u0085key']: 1 };
    expect(paths(bundle)).toEqual([
      'spec.points[2].meta',
      'spec.name',
      'spec.points[0].name',
      'spec.points[1].meta.address',
      'spec.points[2].meta.\u0085key',
    ]);
    const emoji = userRoute();
    emoji.spec.points[0]!.name = 'Castelo 😀 de Leiria';
    expect(paths(emoji)).toEqual([]);
  });

  it('values nested more than 8 deep, without walking them all', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 20_000; i++) deep = { inner: deep };
    const bundle = userRoute();
    bundle.spec.meta = { interests: ['history'], deep };
    const issues = checkUserRoute(bundle);
    expect(issues.map((issue) => issue.path)).toEqual([
      'spec.meta',
      'spec.meta.deep.inner.inner.inner.inner.inner',
    ]);
    expect(issues[1]?.message).toBe('Nested more than 8 levels deep');
  });

  it('routes longer than 500 km', () => {
    const bundle = userRoute({ places: places(2, 250_000) });
    expect(checkUserRoute(bundle)).toEqual([]);
    const far = userRoute({ places: places(3, 250_001) });
    expect(checkUserRoute(far)).toEqual([
      { path: 'spec.points', message: 'The route is 500.0 km long; the limit is 500 km' },
    ]);
  });

  it('lists at most 20 problems', () => {
    const bundle = userRoute();
    for (let i = 0; i < 30; i++) bundle.spec.actions[`quiz_${i}`] = { type: 'quiz' };
    const issues = checkUserRoute(bundle);
    expect(issues).toHaveLength(MAX_ERROR_DETAILS);
    expect(issues[0]?.path).toBe('spec.actions');
  });

  it('anything that is not a route bundle', () => {
    for (const input of [null, 'route', [], { spec: [] }, { contents: {} }]) {
      expect(paths(input)).toEqual(['spec']);
    }
    expect(checkUserRoute({ spec: { source: 'user' } })).toEqual([]);
    const odd = {
      spec: {
        source: 'user',
        points: [{ order: 1, position: { lat: 'x', lng: 0 } }, null],
        actions: { a: 1, b: { type: 'decision' } },
      },
    };
    expect(paths(odd)).toEqual(['spec.actions.b.params']);
  });
});

describe('checkUserRoute: AI cards', () => {
  const REF = 'card-k3x9q2m7p1';
  const card = (overrides: Record<string, unknown> = {}) => ({
    id: REF,
    locale: 'es',
    title: 'Castillo de Leiria',
    summary: 'Una fortaleza medieval sobre la ciudad.',
    facts: ['Lo mandó construir D. Afonso Henriques.'],
    images: [
      { url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Castelo.jpg', alt: 'Castelo' },
    ],
    sources: [
      { title: 'Castillo de Leiria', url: 'https://es.wikipedia.org/wiki/Castillo_de_Leiria' },
    ],
    generated: { by: 'ai', model: 'claude-sonnet-5-5', at: '2026-10-08T10:00:00.000Z' },
    status: 'approved',
    ...overrides,
  });
  /** The first place gets an AI card; the others keep the basic sheet. */
  function withCard(contents: object): { spec: RouteSpec; contents: object } {
    const [first, ...rest] = draft().places;
    return { ...userRoute({ places: [{ ...first!, contentRef: REF }, ...rest] }), contents };
  }

  it('accepts the AI card of each ai_template action', () => {
    const bundle = withCard({ [REF]: { es: card() } });
    expect(validateRouteBundle(bundle).errors).toEqual([]);
    expect(checkUserRoute(bundle)).toEqual([]);
  });

  it('a missing card, or one in another language', () => {
    expect(paths(withCard({}))).toEqual([`contents.${REF}`]);
    expect(paths(withCard({ [REF]: { en: card({ locale: 'en' }) } }))).toEqual([`contents.${REF}`]);
  });

  it('a card the AI did not write, or with images from elsewhere', () => {
    const human = card({ generated: { by: 'human', at: '2026-10-08T10:00:00.000Z' } });
    expect(paths(withCard({ [REF]: { es: human } }))).toEqual([`contents.${REF}.es.generated`]);
    const pixel = card({ images: [{ url: 'https://example.com/pixel.png', alt: 'x' }] });
    expect(paths(withCard({ [REF]: { es: pixel } }))).toEqual([`contents.${REF}.es.images[0].url`]);
  });

  it('no more than 30 cards', () => {
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`c${i}`, {}]));
    expect(paths(withCard({ ...many, [REF]: { es: card() } }))).toContain('contents');
  });
});
