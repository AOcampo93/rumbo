import { validateRouteSpec } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  buildRouteSpec,
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

describe('buildRouteSpec', () => {
  it('produces a route that passes validation', () => {
    const { spec, warnings } = build(draft());
    expect(validateRouteSpec(spec).ok).toBe(true);
    expect(warnings).toEqual([]);
    expect(spec).toMatchObject({
      id: 'mi-paseo-por-leiria-abc123',
      name: 'Mi paseo por Leiria',
      locale: 'pt',
      source: 'user',
    });
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

  it('gives repeated names unique ids', () => {
    const places = draft().places.map((p) => ({ ...p, name: 'Miradouro' }));
    expect(build(draft({ places })).spec.points.map((p) => p.id)).toEqual([
      'miradouro',
      'miradouro-2',
    ]);
  });

  it('passes validation warnings through', () => {
    const places = draft().places;
    places[1] = { ...places[1]!, position: { lat: 39.7479, lng: -8.807 } }; // overlaps the castle
    expect(build(draft({ places })).warnings.map((w) => w.code)).toContain('overlapping_zones');
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
  });

  it('uses a random suffix by default', () => {
    const a = buildRouteSpec(draft(), { source: 'user' }).spec.id;
    expect(a).toMatch(/^mi-paseo-por-leiria-[a-z0-9]{6}$/);
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
});
