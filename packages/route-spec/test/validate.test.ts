import { describe, expect, it } from 'vitest';
import {
  type Issue,
  type IssueCode,
  type RouteSpecInput,
  validateRouteSpec,
} from '../src/index.ts';
import { freeRoute } from './fixtures.ts';

const codes = (issues: Issue[]) => issues.map((issue) => issue.code);
const find = (issues: Issue[], code: IssueCode) => issues.find((issue) => issue.code === code);

/** Valid challenge route with a drawn path, three checkpoints and a time limit. */
function challengeRoute(): RouteSpecInput {
  return freeRoute({
    mode: 'challenge',
    activity: 'run',
    path: [
      { lat: 39.7476, lng: -8.807 },
      { lat: 39.7456, lng: -8.8072 },
      { lat: 39.7436, lng: -8.8075 },
    ],
    settings: { timeLimit: 5400 },
    points: [
      { id: 'cp1', name: 'CP1', position: { lat: 39.7476, lng: -8.807 }, order: 1 },
      { id: 'cp2', name: 'CP2', position: { lat: 39.7456, lng: -8.8072 }, order: 2 },
      {
        id: 'finish',
        name: 'Meta',
        position: { lat: 39.7436, lng: -8.8075 },
        order: 3,
        category: 'finish',
      },
    ],
    actions: {},
  });
}

describe('validateRouteSpec: valid routes and normalization', () => {
  it('accepts a free route and fills in the defaults for walking', () => {
    const result = validateRouteSpec(freeRoute());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const spec = result.spec!;
    expect(spec.activity).toBe('walk');
    expect(spec.settings).toMatchObject({
      defaultRadius: 40,
      dwellTime: 5,
      maxSpeed: 7,
      expectedSpeed: 1.3,
      allowManualCheckIn: true,
      deviation: { enabled: false, maxDistance: 150, graceTime: 30 },
      idle: { enabled: true, time: 600, radius: 25 },
      timeLimit: null,
    });
    expect(spec.points[1]).toMatchObject({ radius: 40, required: true, triggers: {} });
    expect(spec.triggers).toEqual({});
  });

  it('uses challenge defaults: deviation on, no manual check-in, running speeds', () => {
    const spec = validateRouteSpec(challengeRoute()).spec!;
    expect(spec.settings).toMatchObject({
      allowManualCheckIn: false,
      maxSpeed: 10,
      expectedSpeed: 2.8,
      timeLimit: 5400,
      deviation: { enabled: true },
    });
  });

  it('turns deviation on for a free route that has a path, and uses bike speeds', () => {
    const route = freeRoute({
      activity: 'bike',
      path: [
        { lat: 39.7476, lng: -8.807 },
        { lat: 39.7436, lng: -8.8075 },
      ],
    });
    const spec = validateRouteSpec(route).spec!;
    expect(spec.settings.deviation.enabled).toBe(true);
    expect(spec.settings.maxSpeed).toBe(25);
  });

  it('merges partial nested settings with the defaults', () => {
    const spec = validateRouteSpec(
      freeRoute({ settings: { deviation: { maxDistance: 80 }, dwellTime: 8 } }),
    ).spec!;
    expect(spec.settings.deviation).toEqual({ enabled: false, maxDistance: 80, graceTime: 30 });
    expect(spec.settings.dwellTime).toBe(8);
  });

  it('sorts normalized points by order', () => {
    const route = freeRoute();
    route.points.reverse();
    expect(validateRouteSpec(route).spec!.points.map((p) => p.id)).toEqual(['castelo', 'se']);
  });
});

describe('validateRouteSpec: errors', () => {
  it('rejects duplicate point ids', () => {
    const route = freeRoute();
    route.points[1]!.id = 'castelo';
    const result = validateRouteSpec(route);
    expect(result.ok).toBe(false);
    expect(find(result.errors, 'duplicate_point_id')?.path).toBe('points[1].id');
  });

  it('rejects orders with gaps or repeats', () => {
    const gap = freeRoute();
    gap.points[1]!.order = 3;
    expect(codes(validateRouteSpec(gap).errors)).toContain('invalid_order');
    const repeat = freeRoute();
    repeat.points[1]!.order = 1;
    expect(codes(validateRouteSpec(repeat).errors)).toContain('invalid_order');
  });

  it('rejects out-of-range coordinates', () => {
    const route = freeRoute();
    route.points[0]!.position.lat = 95;
    expect(find(validateRouteSpec(route).errors, 'invalid_coordinates')?.path).toBe(
      'points[0].position.lat',
    );
  });

  it('rejects triggers that point to missing actions', () => {
    const route = freeRoute({ triggers: { onDeviation: 'nope' } });
    route.points[0]!.triggers = { onEnter: 'missing' };
    const paths = validateRouteSpec(route)
      .errors.filter((e) => e.code === 'unknown_action')
      .map((e) => e.path);
    expect(paths).toEqual(['points[0].triggers.onEnter', 'triggers.onDeviation']);
  });

  it('never resolves a trigger to an inherited name like "constructor"', () => {
    const route = freeRoute({ triggers: { onStart: 'constructor', onFinish: '__proto__' } });
    route.points[0]!.triggers = { onEnter: 'toString' };
    const paths = validateRouteSpec(route)
      .errors.filter((e) => e.code === 'unknown_action')
      .map((e) => e.path);
    expect(paths).toEqual(['points[0].triggers.onEnter', 'triggers.onStart', 'triggers.onFinish']);
  });

  it('accepts an action that really is called "constructor"', () => {
    const route = freeRoute();
    route.actions['constructor'] = { type: 'info_sheet', params: { title: 'Ok' } };
    route.points[1]!.triggers = { onEnter: 'constructor' };
    expect(validateRouteSpec(route).ok).toBe(true);
  });

  it('rejects a path with fewer than two points', () => {
    const result = validateRouteSpec(freeRoute({ path: [{ lat: 39.7476, lng: -8.807 }] }));
    expect(codes(result.errors)).toContain('path_too_short');
  });

  it('rejects more than 100 points', () => {
    const points = Array.from({ length: 101 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      position: { lat: 39 + i * 0.01, lng: -8.8 },
      order: i + 1,
    }));
    expect(codes(validateRouteSpec(freeRoute({ points, actions: {} })).errors)).toContain(
      'too_many_points',
    );
  });

  it('rejects unsupported languages and empty texts', () => {
    const french = validateRouteSpec(freeRoute({ name: { es: 'Hola', fr: 'Salut' } as never }));
    expect(french.errors[0]).toMatchObject({ code: 'schema', path: 'name' });
    expect(validateRouteSpec(freeRoute({ name: {} })).ok).toBe(false);
    expect(validateRouteSpec(freeRoute({ name: '   ' })).ok).toBe(false);
  });

  it('rejects unknown fields, so typos never pass silently', () => {
    const route = { ...freeRoute(), radious: 30 };
    expect(validateRouteSpec(route).errors[0]).toMatchObject({ code: 'schema' });
  });

  it('rejects non-http links', () => {
    const route = freeRoute({ coverImage: { url: 'javascript:alert(1)', alt: 'x' } });
    expect(validateRouteSpec(route).errors[0]?.path).toBe('coverImage.url');
  });

  it('rejects unsupported versions and non-objects', () => {
    expect(codes(validateRouteSpec({ ...freeRoute(), specVersion: 2 }).errors)).toEqual([
      'unsupported_version',
    ]);
    expect(codes(validateRouteSpec([]).errors)).toEqual(['schema']);
    expect(codes(validateRouteSpec(null).errors)).toEqual(['schema']);
  });
});

describe('validateRouteSpec: warnings', () => {
  it('warns about overlapping zones', () => {
    const route = freeRoute();
    route.points[1]!.position = { lat: 39.7479, lng: -8.807 }; // ≈ 33 m from the castle
    const result = validateRouteSpec(route);
    expect(result.ok).toBe(true);
    expect(find(result.warnings, 'overlapping_zones')?.path).toBe('points[1]');
  });

  it('warns about unused actions and unknown action types', () => {
    const route = freeRoute();
    route.actions['spare'] = { type: 'hologram' };
    const result = validateRouteSpec(route, { knownActionTypes: ['info_sheet', 'quiz'] });
    expect(find(result.warnings, 'unused_action')?.path).toBe('actions.spare');
    expect(find(result.warnings, 'unknown_action_type')?.path).toBe('actions.spare.type');
  });

  it('warns about a single-point challenge and about small radii', () => {
    const route = challengeRoute();
    route.points = [
      { id: 'cp1', name: 'CP1', position: { lat: 39.7476, lng: -8.807 }, order: 1, radius: 15 },
    ];
    const result = validateRouteSpec(route);
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining(['challenge_single_point', 'small_radius']),
    );
    expect(
      find(
        validateRouteSpec(freeRoute({ settings: { defaultRadius: 15 } })).warnings,
        'small_radius',
      )?.path,
    ).toBe('settings.defaultRadius');
  });
});

describe('validateRouteSpec: translations', () => {
  it('warns about a multi-language text missing languages, but never about plain strings', () => {
    const route = freeRoute({ name: { es: 'Solo español' } });
    const result = validateRouteSpec(route);
    expect(result.ok).toBe(true);
    expect(find(result.warnings, 'missing_translation')).toMatchObject({
      path: 'name',
      message: 'Missing en, pt',
    });
    expect(result.warnings.filter((w) => w.path.startsWith('points'))).toEqual([]);
  });

  it('turns missing languages into errors when they are required', () => {
    const result = validateRouteSpec(freeRoute({ summary: { es: 'Resumen', en: 'Summary' } }), {
      requireLocales: ['es', 'en', 'pt'],
    });
    expect(result.ok).toBe(false);
    expect(find(result.errors, 'missing_translation')).toMatchObject({
      path: 'summary',
      message: 'Missing pt',
    });
  });

  it('checks the texts inside action params, quiz options included', () => {
    const route = freeRoute();
    route.points[1]!.triggers = { onEnter: 'se_quiz' };
    route.actions['se_quiz'] = {
      type: 'quiz',
      params: {
        question: { es: '¿Estilo?', en: 'Style?', pt: 'Estilo?' },
        options: [
          { es: 'Gótico', en: 'Gothic', pt: 'Gótico' },
          { es: 'Barroco', en: 'Baroque' },
        ],
        correctIndex: 0,
      },
    };
    const result = validateRouteSpec(route, { requireLocales: ['es', 'en', 'pt'] });
    expect(result.errors).toEqual([
      {
        path: 'actions.se_quiz.params.options[1]',
        code: 'missing_translation',
        message: 'Missing pt',
      },
    ]);
  });

  it('survives absurdly nested params instead of overflowing the stack', () => {
    let nested: unknown = { es: 'Hondo' };
    for (let i = 0; i < 20_000; i++) nested = { inner: nested };
    const route = freeRoute();
    route.actions['castelo_info']!.params = { nested, title: { es: 'Solo es' } };
    const result = validateRouteSpec(route, { requireLocales: ['es', 'en', 'pt'] });
    // Only the shallow text is checked: real texts never sit that deep.
    expect(result.errors.map((e) => e.path)).toEqual(['actions.castelo_info.params.title']);
  });
});
