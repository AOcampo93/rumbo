import { isLocale, type Locale } from '@rumbo/route-spec';
import { createI18n } from 'vue-i18n';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';

// UI catalogs (ADR 0001). They are the source of truth for interface texts;
// a test checks that all three have the same keys and parameters.

export type MessageSchema = typeof es;

/** BCP-47 tags for `<html lang>`, `Intl` and the map SDK. `pt` is European Portuguese. */
export const LOCALE_TAGS: Record<Locale, string> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT' };

/** Each language's name in that language, for the language pickers. */
export const NATIVE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: 'es',
  // The catalogs are complete (tested), so this only guards against a typo.
  fallbackLocale: 'es',
  messages: { es, en, pt },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false,
});

/** The browser's first language Rumbo speaks, or Spanish (DESIGN S00). */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return 'es';
}

type LocaleListener = (locale: Locale) => void;
const listeners = new Set<LocaleListener>();

/**
 * Switches the whole UI live, without reloading: vue-i18n, `<html lang>` for
 * screen readers, and whoever subscribed (the map SDK's own strings).
 */
export function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = LOCALE_TAGS[locale];
  for (const listener of listeners) listener(locale);
}

/** Runs `listener` on every language change; returns the unsubscribe function. */
export function onLocaleChange(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentLocale(): Locale {
  return i18n.global.locale.value;
}
