import { destination } from '@rumbo/geo-utils';
import {
  defaultSettings,
  hashRouteSpec,
  type RouteSpec,
  validateRouteSpec,
} from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  buildRouteSpec,
  DRAFT_LIMITS,
  draftFromSpec,
  type DraftPlace,
  findOverlaps,
  type RouteDraft,
  summarizeDraft,
  summarizeRoute,
  TIME_LIMIT_PRESETS,
  validateDraft,
} from '../src/index.ts';

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
  return {
    name: 'Leiria en una mañana',
    locale: 'es',
    mode: 'free',
    activity: 'walk',
    places: places(3),
    ...overrides,
  };
}

/** A route as the creator saves it, with every optional field in use. */
function savedRoute(): RouteSpec {
  const rich = places(4);
  rich[0] = { ...rich[0]!, address: 'Largo da Sé', externalId: 'Q2969701', category: 'church' };
  rich[1] = { ...rich[1]!, radius: 60, required: false, category: 'viewpoint' };
  rich[2] = { ...rich[2]!, contentRef: 'c-place-3' };
  return buildRouteSpec(
    draft({
      mode: 'challenge',
      activity: 'run',
      timeLimit: 5400,
      interests: ['history'],
      settingsOverrides: { dwellTime: 8, deviation: { maxDistance: 120 } },
      places: rich,
    }),
    { source: 'user', idFactory: () => 'k3x9q2m7p1' },
  ).spec;
}

const rebuild = (d: RouteDraft, id: string) => buildRouteSpec(d, { source: 'user', id });

describe('limits', () => {
  it("default to the routes' own default radius, and presets are minutes", () => {
    expect(DRAFT_LIMITS.radius.default).toBe(defaultSettings('free', 'walk', false).defaultRadius);
    for (const minutes of TIME_LIMIT_PRESETS) {
      const issues = validateDraft(draft({ mode: 'challenge', timeLimit: minutes * 60 }));
      expect(issues).toEqual([]);
    }
  });
});

describe('draftFromSpec', () => {
  it('gives back the route it came from when built again', () => {
    const spec = savedRoute();
    expect(rebuild(draftFromSpec(spec), spec.id).spec).toStrictEqual(spec);
  });

  it('keeps the summary (cleaned) through a round trip, and leaves a blank one out', () => {
    const base = draftFromSpec(savedRoute());
    const built = rebuild({ ...base, summary: '  Castillo,\tsé y río  ' }, 'with-summary').spec;
    expect(built.summary).toBe('Castillo, sé y río');
    expect(draftFromSpec(built).summary).toBe('Castillo, sé y río');
    expect(rebuild({ ...base, summary: '   ' }, 'blank-summary').spec).not.toHaveProperty(
      'summary',
    );
  });

  it('turns points back into places, in order, keeping their ids', () => {
    const spec = savedRoute();
    const result = draftFromSpec(spec);
    expect(result).toMatchObject({
      name: 'Leiria en una mañana',
      locale: 'es',
      mode: 'challenge',
      activity: 'run',
      interests: ['history'],
      timeLimit: 5400,
      settingsOverrides: { dwellTime: 8, deviation: { maxDistance: 120 } },
    });
    expect(result.places[0]).toStrictEqual({
      tempId: 'place-1',
      pointId: 'place-1',
      name: 'Place 1',
      position: spec.points[0]!.position,
      address: 'Largo da Sé',
      externalId: 'Q2969701',
      category: 'church',
    });
    expect(result.places[1]).toMatchObject({ radius: 60, required: false });
    expect(result.places[2]).toMatchObject({ contentRef: 'c-place-3' });
    const shuffled = { ...spec, points: [...spec.points].reverse() };
    expect(draftFromSpec(shuffled).places.map((p) => p.pointId)).toEqual(
      spec.points.map((p) => p.id),
    );
  });

  it('keeps every point id and the engine hash when a place is renamed', () => {
    const spec = savedRoute();
    const edited = draftFromSpec(spec);
    edited.places[1]!.name = 'Miradouro do Castelo';
    const renamed = rebuild(edited, spec.id);
    expect(renamed.spec.points.map((p) => p.id)).toEqual(spec.points.map((p) => p.id));
    expect(hashRouteSpec(renamed.normalized)).toBe(hashRouteSpec(validateRouteSpec(spec).spec!));
  });

  it('keeps point ids and their triggers when two places swap', () => {
    const spec = savedRoute();
    const edited = draftFromSpec(spec);
    edited.places = [edited.places[1]!, edited.places[0]!, ...edited.places.slice(2)];
    const swapped = rebuild(edited, spec.id).spec;
    const triggers = (s: RouteSpec) =>
      Object.fromEntries(s.points.map((p) => [p.id, p.triggers?.onEnter]));
    expect(swapped.points.map((p) => p.id)).toEqual(['place-2', 'place-1', 'place-3', 'place-4']);
    expect(triggers(swapped)).toEqual(triggers(spec));
  });

  it('keeps the ids of the other places when one is added', () => {
    const spec = savedRoute();
    const edited = draftFromSpec(spec);
    edited.places.splice(1, 0, { tempId: 'new', name: 'Place 1', position: start });
    const ids = rebuild(edited, spec.id).spec.points.map((p) => p.id);
    expect(ids).toEqual(['place-1', 'place-1-2', 'place-2', 'place-3', 'place-4']);
  });

  it('makes plain strings in the route language and fills in what is missing', () => {
    const spec = savedRoute();
    const input = {
      ...spec,
      name: { pt: 'Leiria numa manhã', en: 'Leiria in a morning' },
      locale: 'pt',
      settings: { timeLimit: 3600 },
      meta: { interests: 'history' },
      points: spec.points.map((p, i) => (i === 0 ? { ...p, meta: { address: 42 } } : p)),
    } as RouteSpec;
    delete (input as Partial<RouteSpec>).activity;
    const result = draftFromSpec(input);
    expect(result.name).toBe('Leiria numa manhã');
    expect(result.activity).toBe('walk');
    expect(result).not.toHaveProperty('interests');
    expect(result).not.toHaveProperty('settingsOverrides');
    expect(result.places[0]).not.toHaveProperty('address');
    expect(draftFromSpec({ ...input, settings: undefined }).timeLimit).toBeNull();
  });

  it('shares nothing with the spec', () => {
    const spec = savedRoute();
    const edited = draftFromSpec(spec);
    edited.places[0]!.position.lat = 0;
    edited.interests!.push('food');
    edited.settingsOverrides!.deviation!.maxDistance = 1;
    expect(spec.points[0]!.position.lat).not.toBe(0);
    expect(spec.meta).toEqual({ interests: ['history'] });
    expect(spec.settings?.deviation).toEqual({ maxDistance: 120 });
  });
});

describe('summarizeDraft', () => {
  it('measures the legs in list order and estimates like summarizeRoute', () => {
    const d = draft({ places: places(12) });
    const summary = summarizeDraft(d);
    expect(summary).toMatchObject({ placeCount: 12, distanceMeters: 3300, estimatedMinutes: 115 });
    expect(summary.legs).toEqual(Array.from({ length: 11 }, () => 300));
    const { spec } = buildRouteSpec(d, { source: 'user', idFactory: () => 'abc123' });
    expect(summarizeRoute(spec)).toMatchObject({
      distanceMeters: summary.distanceMeters,
      estimatedMinutes: summary.estimatedMinutes,
    });
  });

  it('handles empty and single-place drafts', () => {
    expect(summarizeDraft(draft({ places: [] }))).toEqual({
      placeCount: 0,
      distanceMeters: 0,
      estimatedMinutes: 0,
      legs: [],
    });
    expect(summarizeDraft(draft({ places: places(1) }))).toEqual({
      placeCount: 1,
      distanceMeters: 0,
      estimatedMinutes: 5,
      legs: [],
    });
  });

  it('uses the activity speed, or the speed the route overrides', () => {
    const far = places(2, 6000);
    // 6 km at 5 m/s = 20 min, plus 2 check-ins × 0.5 min → 20 min.
    expect(
      summarizeDraft({ mode: 'challenge', activity: 'bike', places: far }).estimatedMinutes,
    ).toBe(20);
    expect(
      summarizeDraft({
        mode: 'challenge',
        activity: 'bike',
        places: far,
        settingsOverrides: { expectedSpeed: 10 },
      }).estimatedMinutes,
    ).toBe(10);
  });
});

describe('findOverlaps', () => {
  it('lists the pairs whose zones overlap, by tempId in list order', () => {
    const close = places(3, 30);
    const overlaps = findOverlaps(close);
    expect(overlaps.map(({ a, b }) => [a, b])).toEqual([
      ['t1', 't2'],
      ['t1', 't3'],
      ['t2', 't3'],
    ]);
    expect(overlaps[0]!.distance).toBeCloseTo(30, 3);
  });

  it("uses each place's radius, else the default", () => {
    const pair = places(2, 30);
    expect(findOverlaps(pair, 10)).toEqual([]);
    pair[1] = { ...pair[1]!, radius: 25 };
    expect(findOverlaps(pair, 10)).toHaveLength(1);
    expect(findOverlaps(places(2, 81))).toEqual([]); // 81 m apart: 40 + 40 m zones don't touch
  });
});

describe('validateDraft', () => {
  const codes = (d: RouteDraft) => validateDraft(d).map((issue) => `${issue.code}@${issue.field}`);

  it('accepts a complete draft', () => {
    expect(validateDraft(draft())).toEqual([]);
  });

  it('needs a name of up to 80 characters, counted as code points', () => {
    expect(codes(draft({ name: '  \u0000\t ' }))).toEqual(['name_required@name']);
    expect(codes(draft({ name: 'x'.repeat(81) }))).toEqual(['name_too_long@name']);
    expect(codes(draft({ name: '😀'.repeat(80) }))).toEqual([]);
  });

  it('needs 2 to 30 places, each with a name', () => {
    expect(codes(draft({ places: places(1) }))).toEqual(['too_few_places@places']);
    expect(codes(draft({ places: places(31, 50) }))).toEqual(['too_many_places@places']);
    const unnamed = places(3);
    unnamed[2] = { ...unnamed[2]!, name: ' ' };
    expect(codes(draft({ places: unnamed }))).toEqual(['place_name_required@places.2']);
  });

  it('keeps radii within the slider', () => {
    const radii = places(5);
    [20, 200, 15, 250, Number.NaN].forEach((radius, i) => (radii[i] = { ...radii[i]!, radius }));
    expect(codes(draft({ places: radii }))).toEqual([
      'radius_out_of_range@places.2',
      'radius_out_of_range@places.3',
      'radius_out_of_range@places.4',
    ]);
  });

  it("checks a challenge's time limit, in whole positive seconds", () => {
    for (const timeLimit of [0, -60, 90.5, Number.NaN]) {
      expect(codes(draft({ mode: 'challenge', timeLimit }))).toEqual([
        'time_limit_invalid@timeLimit',
      ]);
    }
    expect(validateDraft(draft({ mode: 'challenge', timeLimit: null }))).toEqual([]);
    expect(validateDraft(draft({ mode: 'challenge' }))).toEqual([]);
    expect(validateDraft(draft({ timeLimit: 90.5 }))).toEqual([]); // free routes ignore it
  });

  it('refuses routes longer than 500 km', () => {
    expect(codes(draft({ places: places(2, 500_001) }))).toEqual(['route_too_long@places']);
    expect(validateDraft(draft({ places: places(2, 499_999) }))).toEqual([]);
  });

  it('lists the details step first, then the places', () => {
    const bad = places(1);
    bad[0] = { ...bad[0]!, name: '' };
    expect(codes(draft({ name: '', mode: 'challenge', timeLimit: -1, places: bad }))).toEqual([
      'name_required@name',
      'time_limit_invalid@timeLimit',
      'too_few_places@places',
      'place_name_required@places.0',
    ]);
  });

  it('passes every draft buildRouteSpec can build at the limits', () => {
    const limits = draft({ name: 'x'.repeat(80), places: places(DRAFT_LIMITS.maxPlaces, 50) });
    expect(validateDraft(limits)).toEqual([]);
    expect(() =>
      buildRouteSpec(limits, { source: 'user', idFactory: () => 'abc123' }),
    ).not.toThrow();
  });
});
