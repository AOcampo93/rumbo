import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  hashRouteSpec,
  localesOf,
  migrateRouteSpec,
  type NormalizedRouteSpec,
  resolveText,
  type RouteSpecInput,
  validateRouteSpec,
} from '../src/index.ts';
import { freeRoute } from './fixtures.ts';

const hashOf = (route: RouteSpecInput): string =>
  hashRouteSpec(validateRouteSpec(route).spec as NormalizedRouteSpec);

describe('hashRouteSpec', () => {
  it('is a stable 64-character hex digest', () => {
    const hash = hashOf(freeRoute());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf(freeRoute())).toBe(hash);
  });

  it('ignores texts, so translating or fixing them keeps saved runs valid', () => {
    const base = hashOf(freeRoute());
    const retexted = freeRoute({
      name: { es: 'Otro nombre', en: 'Another name', pt: 'Outro nome' },
      summary: 'Nuevo resumen',
    });
    retexted.points[0]!.name = { es: 'Castillo', en: 'Castle', pt: 'Castelo' };
    retexted.actions['castelo_info']!.params = { title: 'Texto corregido' };
    expect(hashOf(retexted)).toBe(base);
  });

  it('changes when anything the engine depends on changes', () => {
    const base = hashOf(freeRoute());
    const moved = freeRoute();
    moved.points[0]!.position.lat += 0.0001;
    const wider = freeRoute();
    wider.points[0]!.radius = 60;
    const slower = freeRoute({ settings: { dwellTime: 10 } });
    const extraTrigger = freeRoute({ triggers: { onFinish: 'castelo_info' } });
    for (const changed of [moved, wider, slower, extraTrigger])
      expect(hashOf(changed)).not.toBe(base);
  });

  it('serializes objects with sorted keys', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });
});

describe('resolveText', () => {
  const text = { es: 'Leiria histórica', en: 'Historic Leiria' };

  it('returns the requested language when it exists', () => {
    expect(resolveText(text, 'en', 'es')).toEqual({
      text: 'Historic Leiria',
      locale: 'en',
      isFallback: false,
    });
  });

  it('falls back to the source language, then en, es and pt', () => {
    expect(resolveText(text, 'pt', 'es')).toEqual({
      text: 'Leiria histórica',
      locale: 'es',
      isFallback: true,
    });
    expect(resolveText({ en: 'Only English' }, 'pt', 'es')).toMatchObject({
      locale: 'en',
      isFallback: true,
    });
    expect(resolveText({ pt: 'Só português' }, 'es', 'es')).toMatchObject({ locale: 'pt' });
  });

  it('treats a plain string as written in the source language', () => {
    expect(resolveText('Castelo de Leiria', 'en', 'pt')).toEqual({
      text: 'Castelo de Leiria',
      locale: 'pt',
      isFallback: true,
    });
    expect(resolveText('Castelo de Leiria', 'pt', 'pt').isFallback).toBe(false);
  });

  it('lists the languages a text covers; plain strings cover all of them', () => {
    expect(localesOf(text)).toEqual(['es', 'en']);
    expect(localesOf('Castelo de Leiria')).toEqual(['es', 'en', 'pt']);
  });
});

describe('migrateRouteSpec', () => {
  it('passes version 1 through and rejects anything else', () => {
    expect(migrateRouteSpec(freeRoute()).ok).toBe(true);
    const future = migrateRouteSpec({ specVersion: 2 });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.issue.code).toBe('unsupported_version');
    const missing = migrateRouteSpec({});
    expect(missing.ok).toBe(false);
  });
});
