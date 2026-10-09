import { destination } from '@rumbo/geo-utils';
import {
  type ArrivalChoice,
  buildRouteSpec,
  DRAFT_LIMITS,
  type DraftPlace,
  type RouteDraft,
  truncateText,
  validateDraft,
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

  it('a path, a cover from anywhere, a description, or a summary that is not plain text', () => {
    const bundle = userRoute();
    bundle.spec.path = [start, destination(start, 0, 100)];
    bundle.spec.coverImage = { url: 'https://example.com/pixel.png', alt: 'x' };
    bundle.spec.description = 'Una descripción';
    bundle.spec.summary = { es: 'Un resumen' };
    expect(paths(bundle)).toEqual([
      'spec.summary',
      'spec.path',
      'spec.description',
      'spec.coverImage',
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
    actions['content_se-de-leiria'] = { type: 'three_scene', params: { model: 'sé' } };
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

  it('names every type a user route may use when it meets another one', () => {
    const bundle = userRoute();
    bundle.spec.actions['content_se-de-leiria'] = { type: 'three_scene' };
    expect(checkUserRoute(bundle)).toEqual([
      {
        path: 'spec.actions.content_se-de-leiria.type',
        message:
          'User routes only use info_sheet, ai_template, quiz, video, redirect, toast and decision',
      },
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

describe('checkUserRoute: what a place shows on arrival', () => {
  const QUIZ: ArrivalChoice = {
    type: 'quiz',
    question: '¿Quién conquistó el castillo?',
    options: ['Afonso Henriques', 'Dinis I', 'Joana I'],
    correctIndex: 0,
    explanation: 'Lo tomó a los musulmanes en 1135.',
  };
  const VIDEO: ArrivalChoice = { type: 'video', youtubeId: 'dQw4w9WgXcQ', title: 'El castillo' };
  const LINK: ArrivalChoice = {
    type: 'link',
    url: 'https://www.visitleiria.pt/agenda?x=1#hoy',
    label: 'Agenda de Leiria',
  };
  const CHECK: ArrivalChoice = { type: 'check' };

  /** The three places of `draft()`, each showing the arrival given (none: the basic sheet). */
  function arrivalDraft(...arrivals: Array<ArrivalChoice | undefined>): Partial<RouteDraft> {
    const places = draft().places.map((place, i) => ({
      ...place,
      ...(arrivals[i] ? { arrival: arrivals[i] } : {}),
    }));
    return { places };
  }
  const withArrivals = (...arrivals: Array<ArrivalChoice | undefined>) =>
    userRoute(arrivalDraft(...arrivals));
  const FIRST = 'content_castelo-de-leiria';
  const paramsOf = (bundle: { spec: RouteSpec }, id = FIRST) =>
    bundle.spec.actions[id]?.params as Record<string, unknown>;

  it('accepts a quiz, a video, a link and a check, alone or mixed', () => {
    for (const arrivals of [
      [QUIZ],
      [VIDEO],
      [LINK],
      [CHECK],
      [{ type: 'basic' as const }, { type: 'card' as const }],
      [QUIZ, VIDEO, LINK],
      [CHECK, QUIZ, CHECK],
    ]) {
      const bundle = withArrivals(...arrivals);
      expect(validateRouteBundle(bundle).errors).toEqual([]);
      expect(checkUserRoute(bundle)).toEqual([]);
    }
    const types = Object.values(withArrivals(QUIZ, VIDEO, LINK).spec.actions).map(
      (action) => action.type,
    );
    expect(types).toEqual(expect.arrayContaining(['quiz', 'video', 'redirect']));
  });

  it('keeps one action per place plus the decisions, whatever each shows', () => {
    const bundle = withArrivals(QUIZ, VIDEO, LINK);
    expect(Object.keys(bundle.spec.actions)).toHaveLength(3 + 4);
    bundle.spec.actions['extra'] = { type: 'toast', params: { messageKey: 'run.arrivedAt' } };
    expect(paths(bundle)).toEqual([]);
    for (let i = 0; i < 8; i++)
      bundle.spec.actions[`extra_${i}`] = { type: 'toast', params: { message: 'x' } };
    expect(checkUserRoute(bundle).map((issue) => issue.path)).toEqual(['spec.actions']);
  });

  it('accepts the longest texts the creator takes, counted in code points', () => {
    const { question, option, explanation, videoTitle, linkLabel, linkUrl } = DRAFT_LIMITS.arrival;
    const arrivals: ArrivalChoice[] = [
      {
        type: 'quiz',
        question: '😀'.repeat(question),
        options: ['a'.repeat(option), '😀'.repeat(option), 'c', 'd'],
        correctIndex: 3,
        explanation: 'é'.repeat(explanation),
      },
      { type: 'video', youtubeId: 'a_b-c123456', title: 't'.repeat(videoTitle) },
      {
        type: 'link',
        url: `https://example.org/${'x'.repeat(linkUrl - 'https://example.org/'.length)}`,
        label: '😀'.repeat(linkLabel),
      },
    ];
    const change = arrivalDraft(...arrivals);
    expect(validateDraft({ ...draft(), ...change })).toEqual([]);
    expect(checkUserRoute(userRoute(change))).toEqual([]);
  });

  describe('quiz', () => {
    const quizBundle = () => withArrivals(QUIZ);

    it('takes plain texts in one language, never a LocalizedText', () => {
      const bundle = quizBundle();
      Object.assign(paramsOf(bundle), {
        question: { es: '¿Quién?', pt: 'Quem?' },
        options: ['Afonso', { es: 'Dinis' }, 'Joana'],
        explanation: { en: 'In 1135.' },
      });
      expect(paths(bundle)).toEqual([
        'spec.actions.content_castelo-de-leiria.params.question',
        'spec.actions.content_castelo-de-leiria.params.options[1]',
        'spec.actions.content_castelo-de-leiria.params.explanation',
      ]);
    });

    it('needs 2 to 4 options and a right one among them', () => {
      for (const [options, correctIndex] of [
        [['solo'], 0],
        [['a', 'b', 'c', 'd', 'e'], 0],
        [['a', 'b'], 2],
        [['a', 'b'], -1],
      ] as const) {
        const bundle = quizBundle();
        Object.assign(paramsOf(bundle), { options, correctIndex });
        expect(checkUserRoute(bundle), JSON.stringify([options, correctIndex])).not.toEqual([]);
      }
      const four = quizBundle();
      Object.assign(paramsOf(four), { options: ['a', 'b', 'c', 'd'], correctIndex: 3 });
      expect(checkUserRoute(four)).toEqual([]);
    });

    it('keeps the texts within the limits and takes nothing unknown', () => {
      const { question, option, explanation } = DRAFT_LIMITS.arrival;
      for (const change of [
        { question: 'q'.repeat(question + 1) },
        { options: ['a'.repeat(option + 1), 'b'] },
        { explanation: 'e'.repeat(explanation + 1) },
        { question: '   ' },
        { points: 1001 },
        { hint: 'typo' },
      ]) {
        const bundle = quizBundle();
        Object.assign(paramsOf(bundle), change);
        expect(checkUserRoute(bundle), JSON.stringify(change)).toHaveLength(1);
      }
    });
  });

  describe('video', () => {
    const videoBundle = () => withArrivals(VIDEO);

    it('takes YouTube ids only', () => {
      for (const change of [
        { provider: 'file', id: undefined, url: 'https://example.org/v.mp4' },
        { url: 'https://example.org/v.mp4' },
        { id: 'short' },
        { id: 'https://youtu.be/dQw4w9WgXcQ' },
        { id: undefined },
        { provider: 'vimeo' },
      ]) {
        const bundle = videoBundle();
        Object.assign(paramsOf(bundle), change);
        expect(checkUserRoute(bundle), JSON.stringify(change)).not.toEqual([]);
      }
    });

    it('says what is wrong with a video from a file', () => {
      const bundle = videoBundle();
      paramsOf(bundle)['provider'] = 'file';
      delete paramsOf(bundle)['id'];
      paramsOf(bundle)['url'] = 'https://example.org/v.mp4';
      expect(paths(bundle)).toEqual([
        'spec.actions.content_castelo-de-leiria.params.provider',
        'spec.actions.content_castelo-de-leiria.params.url',
      ]);
    });

    it('takes a title in one language, within the limit', () => {
      const bundle = videoBundle();
      Object.assign(paramsOf(bundle), { title: { es: 'El castillo' } });
      expect(paths(bundle)).toEqual(['spec.actions.content_castelo-de-leiria.params.title']);
      Object.assign(paramsOf(bundle), { title: 't'.repeat(DRAFT_LIMITS.arrival.videoTitle + 1) });
      expect(checkUserRoute(bundle)).toHaveLength(1);
    });
  });

  describe('redirect', () => {
    const linkBundle = () => withArrivals(LINK);

    it('opens full https links only', () => {
      for (const url of [
        'http://www.visitleiria.pt',
        'javascript:alert(1)',
        'data:text/html,hi',
        '//www.visitleiria.pt',
        'www.visitleiria.pt',
        'https://www.visitleiria.pt/a b',
        'https://visitleiria.pt:pass@evil.example/',
        'https://visitleiria.pt@evil.example/',
        `https://example.org/${'x'.repeat(DRAFT_LIMITS.arrival.linkUrl)}`,
      ]) {
        const bundle = linkBundle();
        paramsOf(bundle)['url'] = url;
        expect(
          checkUserRoute(bundle).map((issue) => issue.path),
          url,
        ).toEqual(['spec.actions.content_castelo-de-leiria.params.url']);
      }
    });

    it('takes a plain label within the limit', () => {
      const bundle = linkBundle();
      paramsOf(bundle)['label'] = { es: 'Agenda' };
      expect(paths(bundle)).toEqual(['spec.actions.content_castelo-de-leiria.params.label']);
      paramsOf(bundle)['label'] = 'l'.repeat(DRAFT_LIMITS.arrival.linkLabel + 1);
      expect(checkUserRoute(bundle)).toHaveLength(1);
      delete paramsOf(bundle)['label'];
      expect(checkUserRoute(bundle)).toHaveLength(1);
    });
  });

  describe('toast', () => {
    const checkBundle = () => withArrivals(CHECK);

    it('shows an i18n key or a plain text, either one', () => {
      expect(paramsOf(checkBundle())).toEqual({ messageKey: 'run.arrivedAt' });
      const text = checkBundle();
      text.spec.actions[FIRST] = { type: 'toast', params: { message: 'Mira hacia arriba' } };
      expect(checkUserRoute(text)).toEqual([]);
      const timed = checkBundle();
      Object.assign(paramsOf(timed), { durationMs: 5000, icon: 'map-pin' });
      expect(checkUserRoute(timed)).toEqual([]);
    });

    it('refuses a text in several languages and a key that is not one', () => {
      const several = checkBundle();
      several.spec.actions[FIRST] = {
        type: 'toast',
        params: { message: { es: 'Mira', pt: 'Olha' } },
      };
      expect(paths(several)).toEqual(['spec.actions.content_castelo-de-leiria.params.message']);
      for (const messageKey of [
        'arrived',
        'Run.arrivedAt',
        'run.arrived at',
        'run..x',
        '../x',
        'run.',
      ]) {
        const bundle = checkBundle();
        paramsOf(bundle)['messageKey'] = messageKey;
        expect(paths(bundle), messageKey).toEqual([
          'spec.actions.content_castelo-de-leiria.params.messageKey',
        ]);
      }
    });

    it('needs exactly one of the two, and nothing unknown', () => {
      const both = checkBundle();
      paramsOf(both)['message'] = 'Hola';
      expect(checkUserRoute(both)).toHaveLength(1);
      const none = checkBundle();
      none.spec.actions[FIRST] = { type: 'toast', params: {} };
      expect(checkUserRoute(none)).toHaveLength(1);
      const unknown = checkBundle();
      paramsOf(unknown)['sound'] = 'x'.repeat(10_000);
      expect(checkUserRoute(unknown)).toHaveLength(1);
      const slow = checkBundle();
      paramsOf(slow)['durationMs'] = 60_000;
      expect(checkUserRoute(slow)).toHaveLength(1);
    });
  });

  it('still refuses the extras of an action: presentation and feedback', () => {
    const bundle = withArrivals(CHECK);
    bundle.spec.actions[FIRST] = {
      ...bundle.spec.actions[FIRST]!,
      presentation: 'blocking',
      feedback: { vibrate: true },
    };
    expect(paths(bundle)).toEqual([
      'spec.actions.content_castelo-de-leiria.presentation',
      'spec.actions.content_castelo-de-leiria.feedback',
    ]);
  });

  it('accepts whatever the creator lets through its own validation', () => {
    const arrivals: Array<ArrivalChoice | undefined> = [
      undefined,
      { type: 'card' },
      { type: 'basic' },
      QUIZ,
      { ...QUIZ, options: ['a', 'b'], correctIndex: 1, explanation: undefined },
      VIDEO,
      { type: 'video', youtubeId: 'dQw4w9WgXcQ' },
      LINK,
      { type: 'link', url: 'https://example.org', label: 'Ejemplo' },
      CHECK,
    ];
    for (const arrival of arrivals) {
      const change = arrivalDraft(arrival, CHECK, QUIZ);
      expect(validateDraft({ ...draft(), ...change }), JSON.stringify(arrival)).toEqual([]);
      expect(checkUserRoute(userRoute(change)), JSON.stringify(arrival)).toEqual([]);
    }
  });
});

describe('checkUserRoute: the cover (phase 7.3)', () => {
  const OWN = 'https://rumbo.arturoocampo.com/api/v1/media/AbCdEfGhIjKlMnOpQrStUv.jpg';
  const REF = 'card-k3x9q2m7p1';
  const photo = {
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Castelo.jpg',
    alt: 'Castelo',
    credit: 'Autor',
    license: 'CC BY-SA 4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Castelo.jpg',
  };
  const card = {
    id: REF,
    locale: 'es',
    title: 'Castillo de Leiria',
    summary: 'Una fortaleza medieval sobre la ciudad.',
    facts: [],
    images: [photo],
    sources: [{ title: 'Castillo de Leiria', url: 'https://es.wikipedia.org/wiki/Castillo' }],
    generated: { by: 'ai', model: 'claude-sonnet-5-5', at: '2026-10-08T10:00:00.000Z' },
    status: 'approved',
  };
  /** The first place has an AI card with `photo`; the route's cover is `cover`. */
  function covered(cover: unknown): { spec: RouteSpec; contents: object } {
    const [first, ...rest] = draft().places;
    const bundle = {
      ...userRoute({ places: [{ ...first!, contentRef: REF }, ...rest] }),
      contents: { [REF]: { es: card } },
    };
    (bundle.spec as Record<string, unknown>)['coverImage'] = cover;
    return bundle;
  }

  it("takes the user's own photo stored by the server, with its alt text only", () => {
    const bundle = covered({ url: OWN, alt: 'Leiria en una mañana' });
    expect(validateRouteBundle(bundle).errors).toEqual([]);
    expect(checkUserRoute(bundle)).toEqual([]);
    expect(paths(covered({ url: OWN, alt: 'x', credit: 'Yo', license: 'CC0' }))).toEqual([
      'spec.coverImage.credit',
      'spec.coverImage.license',
    ]);
  });

  it('takes one of its cards’ photos exactly as the card has it, credit included', () => {
    expect(checkUserRoute(covered(photo))).toEqual([]);
    for (const changed of [
      { ...photo, credit: 'Otro autor' },
      { ...photo, license: undefined },
      { ...photo, alt: 'Otra cosa' },
      { ...photo, url: 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Otra.jpg' },
    ]) {
      expect(paths(covered(JSON.parse(JSON.stringify(changed)))), JSON.stringify(changed)).toEqual([
        'spec.coverImage',
      ]);
    }
  });

  it('refuses any other address, even one that looks like a stored photo', () => {
    for (const url of [
      'https://example.com/pixel.png',
      'https://rumbo.arturoocampo.com/api/v1/media/short.jpg',
      'https://rumbo.arturoocampo.com/api/v1/media/AbCdEfGhIjKlMnOpQrStUv.png',
      `${OWN}?x=1`,
      `${OWN}#top`,
      'https://user:pass@rumbo.arturoocampo.com/api/v1/media/AbCdEfGhIjKlMnOpQrStUv.jpg',
      'ftp://rumbo.arturoocampo.com/api/v1/media/AbCdEfGhIjKlMnOpQrStUv.jpg',
    ]) {
      expect(paths(covered({ url, alt: 'x' })), url).toEqual(['spec.coverImage']);
    }
    expect(paths(covered('cover.jpg'))).toEqual(['spec.coverImage']);
  });
});
