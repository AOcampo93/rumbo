import { describe, expect, it } from 'vitest';
import { defaultSettings, readSettings } from '../src/stores/settings.ts';
import { resolveTheme } from '../src/services/theme.ts';

describe('stored settings', () => {
  it('start with no language, so S00 shows once', () => {
    expect(defaultSettings()).toMatchObject({
      locale: null,
      onboarded: false,
      analyticsConsent: null,
      theme: 'system',
    });
  });

  it('survive broken or outdated storage field by field', () => {
    expect(readSettings('{nope')).toEqual(defaultSettings());
    expect(readSettings(null)).toEqual(defaultSettings());
    const settings = readSettings(
      JSON.stringify({ locale: 'pt', theme: 'neon', sound: 'loud', extra: 1 }),
    );
    expect(settings).toMatchObject({ locale: 'pt', theme: 'system', sound: true });
    expect(settings).not.toHaveProperty('extra');
    expect(readSettings(JSON.stringify({ locale: 'fr' })).locale).toBe(null);
  });
});

describe('themes', () => {
  it('follow the system unless chosen, and "Sol" is always light', () => {
    expect(resolveTheme('system', true, false)).toBe('dark');
    expect(resolveTheme('light', true, false)).toBe('light');
    expect(resolveTheme('dark', false, true)).toBe('light');
  });
});
