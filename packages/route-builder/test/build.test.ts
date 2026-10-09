import { destination } from '@rumbo/geo-utils';
import { hashRouteSpec, validateRouteSpec } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  buildRouteSpec,
  type DraftPlace,
  RouteBuildError,
  type RouteDraft,
  slugify,
  uniqueIds,
} from '../src/index.ts';

function draft(overrides: Partial<RouteDraft> = {}): RouteDraft {
  return {
    name: 'Mi paseo por Leiria',
    locale: 'pt',
    mode: 'free',
    activity: 'walk',
    places: [
      {
        tempId: 't1',
        name: 'Castelo de Leiria',
        position: { lat: 39.7476, lng: -8.807 },
        category: 'monument',
        externalId: 'Q123',
        contentRef: 'c-castelo',
      },
      {
        tempId: 't2',
        name: 'Sé de Leiria',
        position: { lat: 39.7436, lng: -8.8075 },
        address: 'Largo da Sé, Leiria',
      },
    ],
    ...overrides,
  };
}

const build = (d: RouteDraft) => buildRouteSpec(d, { source: 'user', idFactory: () => 'abc123' });

/** `count` places 300 m apart, heading east, without cards. */
function places(count: number, name = (i: number) => `Place ${i + 1}`): DraftPlace[] {
  const start = { lat: 39.7476, lng: -8.807 };
  return Array.from({ length: count }, (_, i) => ({
    tempId: `t${i + 1}`,
    name: name(i),
    position: destination(start, 90, i * 300),
  }));
}

describe('buildRouteSpec', () => {
  it('produces a route that passes validation, and its normalized form', () => {
    const { spec, normalized, warnings } = build(draft());
    expect(validateRouteSpec(spec).ok).toBe(true);
    expect(warnings).toEqual([]);
    expect(spec).toMatchObject({
      id: 'mi-paseo-por-leiria-abc123',
      name: 'Mi paseo por Leiria',
      locale: 'pt',
      source: 'user',
    });
    expect(normalized).toEqual(validateRouteSpec(spec).spec);
    expect(normalized.settings.defaultRadius).toBe(40);
  });

  it('derives point ids from names and keeps the draft order', () => {
    const { spec } = build(draft());
    expect(spec.points.map((p) => [p.id, p.order])).toEqual([
      ['castelo-de-leiria', 1],
      ['se-de-leiria', 2],
    ]);
  });

  it('opens the generated card when there is one, and a basic sheet otherwise', () => {
    const { spec } = build(draft());
    expect(spec.points[0]?.triggers?.onEnter).toBe('content_castelo-de-leiria');
    expect(spec.actions['content_castelo-de-leiria']).toEqual({
      type: 'ai_template',
      params: { contentRef: 'c-castelo' },
    });
    expect(spec.actions['content_se-de-leiria']).toEqual({
      type: 'info_sheet',
      params: { title: 'Sé de Leiria', body: 'Largo da Sé, Leiria' },
    });
  });

  it('keeps address and external id as metadata for the UI and the AI', () => {
    const { spec } = build(draft());
    expect(spec.points[0]?.meta).toEqual({ externalId: 'Q123' });
    expect(spec.points[1]?.meta).toEqual({ address: 'Largo da Sé, Leiria' });
  });

  it('wires every interruption to the decision sheet', () => {
    const { spec } = build(draft());
    expect(spec.triggers).toEqual({
      onDeviation: 'decision_deviation',
      onIdle: 'decision_idle',
      onOutOfOrder: 'decision_out_of_order',
      onTimeout: 'decision_timeout',
    });
    expect(spec.actions['decision_idle']).toEqual({ type: 'decision', params: { preset: 'idle' } });
  });

  it('applies the time limit to challenges only', () => {
    expect(build(draft({ mode: 'challenge', timeLimit: 3600 })).spec.settings).toEqual({
      timeLimit: 3600,
    });
    expect(build(draft({ timeLimit: 3600 })).spec.settings).toBeUndefined();
  });

  it('keeps settings overrides, the draft time limit winning for challenges', () => {
    const settingsOverrides = { dwellTime: 8, deviation: { maxDistance: 80 }, timeLimit: 600 };
    const { spec, normalized } = build(
      draft({ mode: 'challenge', timeLimit: 1800, settingsOverrides }),
    );
    expect(spec.settings).toEqual({
      dwellTime: 8,
      deviation: { maxDistance: 80 },
      timeLimit: 1800,
    });
    expect(normalized.settings.deviation).toEqual({
      enabled: true,
      maxDistance: 80,
      graceTime: 30,
    });
    expect(build(draft({ settingsOverrides: { idle: { enabled: false } } })).spec.settings).toEqual(
      { idle: { enabled: false } },
    );
  });

  it('gives repeated names unique ids', () => {
    const repeated = draft().places.map((p) => ({ ...p, name: 'Miradouro' }));
    expect(build(draft({ places: repeated })).spec.points.map((p) => p.id)).toEqual([
      'miradouro',
      'miradouro-2',
    ]);
  });

  it('falls back to "route" and "point" when a name has no letters or digits', () => {
    const { spec } = build(draft({ name: '¡¿!?', places: places(2, () => '★') }));
    expect(spec.id).toBe('route-abc123');
    expect(spec.points.map((p) => p.id)).toEqual(['point', 'point-2']);
  });

  it('passes validation warnings through', () => {
    const near = draft().places;
    near[1] = { ...near[1]!, position: { lat: 39.7479, lng: -8.807 } }; // overlaps the castle
    expect(build(draft({ places: near })).warnings.map((w) => w.code)).toContain(
      'overlapping_zones',
    );
  });

  it('copies radius, required and interests when the draft sets them', () => {
    const withOptions = places(2);
    withOptions[0] = { ...withOptions[0]!, radius: 60, required: false };
    const { spec } = build(draft({ places: withOptions, interests: ['history', 'food'] }));
    expect(spec.points[0]).toMatchObject({ radius: 60, required: false });
    expect(spec.points[1]).not.toHaveProperty('radius');
    expect(spec.points[1]).not.toHaveProperty('meta');
    expect(spec.meta).toEqual({ interests: ['history', 'food'] });
    expect(build(draft({ interests: [] })).spec).not.toHaveProperty('meta');
  });

  it('throws RouteBuildError with the issues when the draft is invalid', () => {
    expect(() => build(draft({ places: [] }))).toThrow(RouteBuildError);
    const badPlace = { ...draft().places[0]!, position: { lat: 120, lng: 0 } };
    let caught: unknown;
    try {
      build(draft({ places: [badPlace] }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RouteBuildError);
    expect((caught as RouteBuildError).issues[0]?.code).toBe('invalid_coordinates');
    expect((caught as RouteBuildError).message).toContain('points[0].position.lat');
  });

  it('uses a crypto suffix of 10 characters by default', () => {
    const a = buildRouteSpec(draft(), { source: 'user' }).spec.id;
    const b = buildRouteSpec(draft(), { source: 'user' }).spec.id;
    expect(a).toMatch(/^mi-paseo-por-leiria-[a-z0-9]{10}$/);
    expect(b).not.toBe(a);
  });

  it('keeps the id it is given when editing, and makes none', () => {
    let calls = 0;
    const { spec } = buildRouteSpec(draft({ name: 'Otro nombre' }), {
      source: 'user',
      id: 'mi-paseo-por-leiria-abc123',
      idFactory: () => `x${++calls}`,
    });
    expect(spec.id).toBe('mi-paseo-por-leiria-abc123');
    expect(calls).toBe(0);
  });

  it('keeps long route ids within 64 characters', () => {
    const { spec } = buildRouteSpec(draft({ name: 'Leiria '.repeat(11) }), {
      source: 'user',
      idFactory: () => '0123456789',
    });
    expect(spec.id).toBe(`${'leiria-'.repeat(7)}leir-0123456789`);
    expect(spec.id).toHaveLength(64);
  });
});

describe('buildRouteSpec: texts', () => {
  it('cleans and trims names, titles and addresses', () => {
    const messy = places(2, (i) => (i === 0 ? '  Castelo\u0000 de\tLeiria ‮ ' : 'Sé'));
    messy[0] = { ...messy[0]!, address: ' Rua\u0007 Barão\r\nde Viamonte ' };
    const { spec } = build(draft({ name: '⁦ Mi paseo ⁩', places: messy }));
    expect(spec.name).toBe('Mi paseo');
    expect(spec.points[0]).toMatchObject({
      name: 'Castelo de Leiria',
      meta: { address: 'Rua Barão de Viamonte' },
    });
    expect(spec.actions['content_castelo-de-leiria']?.params).toEqual({
      title: 'Castelo de Leiria',
      body: 'Rua Barão de Viamonte',
    });
  });

  it('leaves out a blank address instead of an empty body', () => {
    const blank = places(2);
    blank[0] = { ...blank[0]!, address: '   ', externalId: 'Q45' };
    const { spec } = build(draft({ places: blank }));
    expect(spec.actions['content_place-1']?.params).toEqual({ title: 'Place 1' });
    expect(spec.points[0]?.meta).toEqual({ externalId: 'Q45' });
  });

  it('never puts an image in a basic sheet', () => {
    const { spec } = build(draft({ places: places(3) }));
    for (const action of Object.values(spec.actions)) {
      expect(action.params).not.toHaveProperty('image');
    }
  });
});

describe('buildRouteSpec: stable ids when editing', () => {
  /** A draft as draftFromSpec leaves it: every place knows its point id. */
  const saved = () => {
    const { spec } = build(draft({ places: places(3) }));
    const edited = places(3).map((place, i) => ({ ...place, pointId: spec.points[i]!.id }));
    return { spec, edited };
  };
  const engineIds = (spec: Parameters<typeof validateRouteSpec>[0]) =>
    validateRouteSpec(spec).spec!.points.map((p) => [p.id, p.triggers.onEnter] as const);

  it('keeps point and action ids when a place is renamed', () => {
    const { spec, edited } = saved();
    edited[1] = { ...edited[1]!, name: 'Igreja da Misericórdia' };
    const renamed = buildRouteSpec(draft({ places: edited }), { source: 'user', id: spec.id });
    expect(renamed.spec.points.map((p) => p.id)).toEqual(['place-1', 'place-2', 'place-3']);
    expect(renamed.spec.points[1]?.name).toBe('Igreja da Misericórdia');
    expect(hashRouteSpec(renamed.normalized)).toBe(hashRouteSpec(validateRouteSpec(spec).spec!));
  });

  it('keeps point ids and their triggers when two places swap', () => {
    const { spec, edited } = saved();
    const swapped = [edited[1]!, edited[0]!, edited[2]!];
    const result = build(draft({ places: swapped }));
    expect(result.spec.points.map((p) => p.id)).toEqual(['place-2', 'place-1', 'place-3']);
    const before = new Map(engineIds(spec));
    for (const [id, onEnter] of engineIds(result.spec)) expect(onEnter).toBe(before.get(id));
  });

  it('keeps ids of places with the same name when they swap', () => {
    const twins = places(2, () => 'Miradouro');
    const first = build(draft({ places: twins })).spec;
    const kept = twins.map((place, i) => ({ ...place, pointId: first.points[i]!.id }));
    const swapped = build(draft({ places: [kept[1]!, kept[0]!] })).spec;
    expect(swapped.points.map((p) => p.id)).toEqual(['miradouro-2', 'miradouro']);
    expect(swapped.points.map((p) => p.triggers?.onEnter)).toEqual([
      'content_miradouro-2',
      'content_miradouro',
    ]);
  });

  it('gives a new place an id that no kept place uses, wherever it goes', () => {
    const { edited } = saved();
    const added = { ...places(1, () => 'Place 2')[0]!, tempId: 'new' };
    const ids = build(draft({ places: [added, ...edited] })).spec.points.map((p) => p.id);
    expect(ids).toEqual(['place-2-2', 'place-1', 'place-2', 'place-3']);
  });

  it('treats a repeated or malformed point id as a new place', () => {
    const { edited } = saved();
    edited[1] = { ...edited[1]!, pointId: edited[0]!.pointId };
    edited[2] = { ...edited[2]!, pointId: 'Not An Id!' };
    const ids = build(draft({ places: edited })).spec.points.map((p) => p.id);
    expect(ids).toEqual(['place-1', 'place-2', 'place-3']);
  });

  it('keeps action ids unique when long point ids share their first 56 characters', () => {
    const long = 'Igreja Paroquial de Nossa Senhora da Assuncao e Santo Agostinho de Leiria';
    const { spec } = build(draft({ places: places(2, (i) => `${long} ${i ? 'Velha' : 'Nova'}`) }));
    const onEnter = spec.points.map((p) => p.triggers?.onEnter as string);
    expect(new Set(onEnter).size).toBe(2);
    for (const id of onEnter) expect(id.length).toBeLessThanOrEqual(64);
    expect(spec.actions[onEnter[1]!]?.params).toMatchObject({ title: `${long} Velha` });
  });
});

describe('buildRouteSpec: the cover (phase 7.3)', () => {
  const cover = {
    url: 'https://rumbo.arturoocampo.com/api/v1/media/AbCdEfGhIjKlMnOpQrStUv.jpg',
    alt: { pt: 'Mi paseo por Leiria' },
  };

  it('puts the cover in the route, and leaves it out when there is none', () => {
    const { spec } = build(draft({ coverImage: cover }));
    expect(spec.coverImage).toEqual(cover);
    expect(validateRouteSpec(spec).errors).toEqual([]);
    expect(build(draft()).spec).not.toHaveProperty('coverImage');
  });

  it('copies it, so editing the draft never edits the route', () => {
    const source = draft({ coverImage: { ...cover, alt: { ...cover.alt } } });
    const { spec } = build(source);
    source.coverImage!.url = 'https://example.com/other.jpg';
    (source.coverImage!.alt as Record<string, string>)['pt'] = 'Outra';
    expect(spec.coverImage).toEqual(cover);
  });
});

describe('buildRouteSpec: no shared references', () => {
  it('copies positions, interests and settings, so editing the draft never edits the route', () => {
    const source = draft({
      interests: ['history'],
      settingsOverrides: { deviation: { maxDistance: 80 }, idle: { time: 300 } },
    });
    const { spec } = build(source);
    source.places[0]!.position.lat = 0;
    source.interests!.push('food');
    source.settingsOverrides!.deviation!.maxDistance = 1;
    source.settingsOverrides!.idle!.time = 1;
    expect(spec.points[0]?.position.lat).toBe(39.7476);
    expect(spec.meta).toEqual({ interests: ['history'] });
    expect(spec.settings).toEqual({ deviation: { maxDistance: 80 }, idle: { time: 300 } });
  });

  it('keeps only lat and lng of a position', () => {
    const extra = places(2);
    const { lat, lng } = extra[0]!.position;
    extra[0] = { ...extra[0]!, position: { lat, lng, x: 1, y: 2 } as never };
    expect(build(draft({ places: extra })).spec.points[0]?.position).toStrictEqual({ lat, lng });
  });
});

describe('slugs', () => {
  it('strips accents and punctuation', () => {
    expect(slugify('Sé de Leiria')).toBe('se-de-leiria');
    expect(slugify('m|i|mo – Museu da Imagem em Movimento')).toBe(
      'm-i-mo-museu-da-imagem-em-movimento',
    );
    expect(slugify("Mercado de Sant'Ana")).toBe('mercado-de-sant-ana');
    expect(slugify('¡!')).toBe('');
  });

  it('respects the maximum length without a trailing dash', () => {
    expect(slugify('Igreja da Misericórdia', 10)).toBe('igreja-da');
  });

  it('deduplicates within the length limit', () => {
    expect(uniqueIds(['a', 'a', 'a'])).toEqual(['a', 'a-2', 'a-3']);
    expect(uniqueIds(['abcd', 'abcd'], 4)).toEqual(['abcd', 'ab-2']);
  });

  it('avoids the ids already taken', () => {
    expect(uniqueIds(['a', 'b'], 64, ['a', 'a-2'])).toEqual(['a-3', 'b']);
  });
});
