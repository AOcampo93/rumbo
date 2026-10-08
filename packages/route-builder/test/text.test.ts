import { describe, expect, it, vi } from 'vitest';
import { buildRouteSpec, newIdSuffix, truncateText } from '../src/index.ts';

describe('truncateText', () => {
  it('cuts to a number of code points and trims what is left', () => {
    expect(truncateText('Castelo de Leiria', 100)).toBe('Castelo de Leiria');
    expect(truncateText('Castelo de Leiria', 8)).toBe('Castelo');
    expect(truncateText('  Castelo  ', 3)).toBe('Cas');
    expect(truncateText('Castelo', 0)).toBe('');
  });

  it('never splits a surrogate pair', () => {
    expect(truncateText('😀😀😀', 2)).toBe('😀😀');
    expect(truncateText('a😀b', 2)).toBe('a😀');
    expect(truncateText('🇵🇹 Leiria', 1)).toBe('🇵');
  });

  it('removes controls, bidi overrides and lone surrogates, and joins lines', () => {
    expect(truncateText('‮ evil‬ \u0000name\uD800 ', 80)).toBe('evil name');
    expect(truncateText('⁦Sé⁩ de\u0085Leiria\u009F', 80)).toBe('Sé de Leiria');
    expect(truncateText('Rua Barão\r\n\tde Viamonte', 80)).toBe('Rua Barão de Viamonte');
  });

  it('makes names a route schema accepts', () => {
    const name = truncateText('😀'.repeat(100), 80);
    expect([...name]).toHaveLength(80);
    const places = [0, 1].map((i) => ({
      tempId: `t${i}`,
      name,
      position: { lat: 39.74 + i / 100, lng: -8.8 },
    }));
    const draft = { name, locale: 'es', mode: 'free', activity: 'walk', places } as const;
    expect(() => buildRouteSpec({ ...draft, places }, { source: 'user' })).not.toThrow();
  });
});

describe('newIdSuffix', () => {
  it('makes 10 random lowercase letters and digits', () => {
    const suffixes = Array.from({ length: 50 }, newIdSuffix);
    for (const suffix of suffixes) expect(suffix).toMatch(/^[a-z0-9]{10}$/);
    expect(new Set(suffixes).size).toBe(50);
  });

  it('skips the bytes that would favour some characters', () => {
    const webCrypto = (
      globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }
    ).crypto;
    const spy = vi
      .spyOn(webCrypto, 'getRandomValues')
      .mockImplementationOnce((array) => array.fill(255))
      .mockImplementationOnce((array) => array.fill(36 * 3 + 1));
    expect(newIdSuffix()).toBe('b'.repeat(10));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
