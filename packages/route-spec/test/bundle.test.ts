import { describe, expect, it } from 'vitest';
import { resolveContent, validateRouteBundle } from '../src/index.ts';
import { card, freeRoute } from './fixtures.ts';

const ALL = ['es', 'en', 'pt'] as const;

function bundle() {
  return {
    spec: freeRoute(),
    contents: {
      'c-castelo': {
        es: card('c-castelo', 'es', 'Castillo de Leiria'),
        en: card('c-castelo', 'en', 'Leiria Castle'),
        pt: card('c-castelo', 'pt'),
      },
    },
  };
}

describe('validateRouteBundle', () => {
  it('accepts a bundle whose cards exist in every required language', () => {
    const result = validateRouteBundle(bundle(), { requireLocales: ALL });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.bundle?.spec.points[0]?.radius).toBe(40);
  });

  it('prefixes spec issues with "spec."', () => {
    const input = bundle();
    input.spec.points[1]!.order = 5;
    expect(validateRouteBundle(input).errors[0]).toMatchObject({
      path: 'spec.points',
      code: 'invalid_order',
    });
  });

  it('requires a card for every contentRef', () => {
    const input = bundle();
    input.spec.points[1]!.contentRef = 'c-se';
    expect(validateRouteBundle(input).errors).toEqual([
      {
        path: 'spec.points[1].contentRef',
        code: 'missing_content',
        message: 'No card "c-se" in contents',
      },
    ]);
  });

  it('never takes an inherited name like "toString" for a card', () => {
    const input = bundle();
    input.spec.points[1]!.contentRef = 'toString';
    expect(validateRouteBundle(input).errors).toEqual([
      {
        path: 'spec.points[1].contentRef',
        code: 'missing_content',
        message: 'No card "toString" in contents',
      },
    ]);
  });

  it('requires every language of a referenced card when asked', () => {
    const input = bundle();
    delete (input.contents['c-castelo'] as Record<string, unknown>)['pt'];
    expect(validateRouteBundle(input).ok).toBe(true);
    const strict = validateRouteBundle(input, { requireLocales: ALL });
    expect(strict.errors[0]).toMatchObject({
      path: 'contents.c-castelo',
      code: 'missing_translation',
    });
  });

  it('rejects a card stored under the wrong id or language', () => {
    const input = bundle();
    input.contents['c-castelo'].en = card('c-castelo', 'es');
    expect(validateRouteBundle(input).errors[0]).toMatchObject({
      path: 'contents.c-castelo.en',
      code: 'content_locale_mismatch',
    });
  });

  it('rejects HTML inside a card body', () => {
    const input = bundle();
    input.contents['c-castelo'].es = {
      ...card('c-castelo', 'es'),
      body: 'Hola <script>alert(1)</script>',
    };
    expect(validateRouteBundle(input).errors[0]?.path).toBe('contents.c-castelo.es.body');
  });

  it('warns about cards nobody references', () => {
    const input = bundle();
    (input.contents as Record<string, unknown>)['c-extra'] = { es: card('c-extra', 'es') };
    expect(validateRouteBundle(input).warnings.map((w) => w.code)).toContain('unused_content');
  });

  it('also follows contentRef inside action params', () => {
    const input = bundle();
    input.spec.points[0]!.contentRef = undefined;
    input.spec.actions['castelo_info'] = {
      type: 'ai_template',
      params: { contentRef: 'c-castelo' },
    };
    const result = validateRouteBundle(input);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).not.toContain('unused_content');
  });
});

describe('resolveContent', () => {
  it('returns the card in the requested language or falls back', () => {
    const entry = bundle().contents['c-castelo'];
    expect(resolveContent(entry, 'en', 'es')).toMatchObject({ locale: 'en', isFallback: false });
    expect(resolveContent({ pt: card('c', 'pt') }, 'en', 'es')).toMatchObject({
      locale: 'pt',
      isFallback: true,
    });
    expect(resolveContent(undefined, 'en', 'es')).toBeNull();
  });
});
