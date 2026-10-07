import { describe, expect, it } from 'vitest';
import { i18n } from '../src/i18n/index.ts';
import { isKeyText, localizedIn, uiTextIn } from '../src/i18n/text.ts';

const t = i18n.global.t as unknown as (key: string, params?: Record<string, unknown>) => string;

describe('route texts', () => {
  it('follow the fallback chain of ADR 0001', () => {
    const name = { es: 'Leiria histórica', en: 'Historic Leiria' };
    expect(localizedIn(name, 'en', 'pt')).toBe('Historic Leiria');
    expect(localizedIn(name, 'pt', 'es')).toBe('Leiria histórica');
    expect(localizedIn('Castelo de Leiria', 'en', 'pt')).toBe('Castelo de Leiria');
    expect(localizedIn(null, 'es', 'es')).toBe('');
  });
});

describe('event-system texts', () => {
  it('translate keys with the point name in the active language', () => {
    i18n.global.locale.value = 'pt';
    const text = {
      key: 'run.approaching',
      params: { name: { es: 'El castillo', pt: 'O castelo' } },
    };
    expect(isKeyText(text)).toBe(true);
    expect(uiTextIn(text, t, 'pt', 'es', 'metric')).toBe('Estás perto de O castelo');
  });

  it('format distances in metres and keep other numbers as numbers', () => {
    i18n.global.locale.value = 'en';
    const deviation = {
      key: 'decision.deviation.body',
      params: { distance: 212, name: 'Castelo' },
    };
    expect(uiTextIn(deviation, t, 'en', 'pt', 'metric')).toBe(
      "You're 210 m from the way to Castelo.",
    );
    const idle = { key: 'decision.idle.body', params: { minutes: 10 } };
    expect(uiTextIn(idle, t, 'en', 'pt', 'metric')).toBe(
      "You've been in the same spot for 10 min.",
    );
  });

  it("pass the route's own text through", () => {
    expect(isKeyText({ es: 'Hola' })).toBe(false);
    expect(uiTextIn({ es: 'Hola', en: 'Hello' }, t, 'en', 'es', 'metric')).toBe('Hello');
  });
});
