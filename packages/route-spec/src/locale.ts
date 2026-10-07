/** Languages Rumbo ships in. `pt` is European Portuguese (pt-PT). See ADR 0001. */
export const LOCALES = ['es', 'en', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Text that may come in several languages. A plain string is written in the
 * route's source language (`spec.locale`); an object carries one string per
 * language, e.g. `{ es: 'Leiria histórica', en: 'Historic Leiria' }`.
 */
export type LocalizedText = string | Partial<Record<Locale, string>>;

/** Languages tried, in this order, after the requested one and the source one. */
export const FALLBACK_LOCALES: readonly Locale[] = ['en', 'es', 'pt'];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export interface ResolvedText {
  text: string;
  /** Language of `text`. */
  locale: Locale;
  /** True when `text` is not in the requested language. */
  isFallback: boolean;
}

/** Requested language → source language → en → es → pt, without repeats. */
export function fallbackChain(locale: Locale, sourceLocale: Locale): Locale[] {
  return [...new Set<Locale>([locale, sourceLocale, ...FALLBACK_LOCALES])];
}

/**
 * Picks the best available text for `locale`, following {@link fallbackChain}.
 * The UI decides what to do with `isFallback`: content cards show a notice,
 * proper nouns (plain strings) usually don't need one.
 */
export function resolveText(
  text: LocalizedText,
  locale: Locale,
  sourceLocale: Locale,
): ResolvedText {
  if (typeof text === 'string') {
    return { text, locale: sourceLocale, isFallback: sourceLocale !== locale };
  }
  for (const candidate of fallbackChain(locale, sourceLocale)) {
    const value = text[candidate];
    if (value) return { text: value, locale: candidate, isFallback: candidate !== locale };
  }
  // Schemas reject empty LocalizedText, so a validated spec never gets here.
  throw new RangeError('resolveText: the LocalizedText has no text in any language');
}

/**
 * Languages a text is available in. A plain string counts as language-neutral
 * (proper nouns, user-typed names), so it satisfies every language.
 */
export function localesOf(text: LocalizedText): readonly Locale[] {
  if (typeof text === 'string') return LOCALES;
  return LOCALES.filter((locale) => Boolean(text[locale]));
}
