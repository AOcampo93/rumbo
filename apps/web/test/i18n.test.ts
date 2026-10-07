import { UI_TEXT_KEYS } from '@rumbo/event-system';
import { LOCALES } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';
import { detectLocale, i18n } from '../src/i18n/index.ts';
import pt from '../src/i18n/pt.json';

// ADR 0001: the three catalogs have the same keys and the same parameters.

type Tree = { [key: string]: string | Tree };
const CATALOGS = { es, en, pt } as Record<(typeof LOCALES)[number], Tree>;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const flat = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(CATALOGS[locale])]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;
const params = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const plurals = (message: string) => message.split('|').length;

describe('the UI catalogs', () => {
  it('have exactly the same keys in es, en and pt', () => {
    const keys = Object.keys(flat.es).sort();
    expect(Object.keys(flat.en).sort()).toEqual(keys);
    expect(Object.keys(flat.pt).sort()).toEqual(keys);
  });

  it('use the same parameters and plural forms in every language', () => {
    for (const [key, message] of Object.entries(flat.es)) {
      for (const locale of ['en', 'pt'] as const) {
        const other = flat[locale][key] ?? '';
        expect([locale, key, params(other)]).toEqual([locale, key, params(message)]);
        expect([locale, key, plurals(other)]).toEqual([locale, key, plurals(message)]);
      }
    }
  });

  it('define every key the event system hands to the UI', () => {
    for (const locale of LOCALES) {
      for (const key of UI_TEXT_KEYS)
        expect([locale, key, typeof flat[locale][key]]).toEqual([locale, key, 'string']);
    }
  });

  it('never leave a message empty, and every one compiles', () => {
    for (const locale of LOCALES) {
      for (const [key, message] of Object.entries(flat[locale])) {
        expect(message.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
        const named = Object.fromEntries(params(message).map((name) => [name, 'X']));
        const text = i18n.global.t(key, named, { locale });
        expect(text, `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('pluralise point counts', () => {
    expect(i18n.global.t('stats.points', { n: 1 }, { locale: 'es', plural: 1 })).toBe('1 punto');
    expect(i18n.global.t('stats.points', { n: 12 }, { locale: 'pt', plural: 12 })).toBe(
      '12 pontos',
    );
  });
});

describe('detectLocale', () => {
  it("picks the browser's first language Rumbo speaks, else Spanish", () => {
    expect(detectLocale(['pt-BR', 'en'])).toBe('pt');
    expect(detectLocale(['fr-FR', 'en-US'])).toBe('en');
    expect(detectLocale(['de', 'fr'])).toBe('es');
    expect(detectLocale([])).toBe('es');
  });
});
