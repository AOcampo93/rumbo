import type { UiText } from '@rumbo/event-system';
import { type Locale, type LocalizedText, resolveText } from '@rumbo/route-spec';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.ts';
import { formatDistance, formatNumber, type Units } from './format.ts';

type Translate = (key: string, params?: Record<string, unknown>) => string;

type KeyText = Extract<UiText, { key: string }>;

/** True for `{ key, params }`; a LocalizedText object only has language keys. */
export function isKeyText(text: UiText): text is KeyText {
  return typeof text === 'object' && text !== null && 'key' in text;
}

/** A route text in `locale`, following ADR 0001's fallback chain. */
export function localizedIn(
  text: LocalizedText | null | undefined,
  locale: Locale,
  sourceLocale: Locale,
): string {
  if (text === null || text === undefined) return '';
  return resolveText(text, locale, sourceLocale).text;
}

/**
 * Turns the event system's `UiText` into a string. Parameter conventions
 * (event-system `UI_TEXT_KEYS`): `name` and any route text are LocalizedText,
 * `distance` is metres and the other numbers are plain numbers.
 */
export function uiTextIn(
  text: UiText,
  t: Translate,
  locale: Locale,
  sourceLocale: Locale,
  units: Units,
): string {
  if (!isKeyText(text)) return localizedIn(text, locale, sourceLocale);
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(text.params ?? {})) {
    if (typeof value === 'number') {
      params[name] =
        name === 'distance' ? formatDistance(value, locale, units) : formatNumber(value, locale);
    } else {
      params[name] = localizedIn(value, locale, sourceLocale);
    }
  }
  return t(text.key, params);
}

/** Route and event texts in the active language; re-evaluates when it changes. */
export function useTexts() {
  const { t, locale } = useI18n();
  const { units } = storeToRefs(useSettingsStore());
  const translate = t as unknown as Translate;
  return {
    /** A route's own text (LocalizedText) in the active language. */
    text(value: LocalizedText | null | undefined, sourceLocale: Locale): string {
      return localizedIn(value, locale.value as Locale, sourceLocale);
    },
    /** An event-system text (i18n key with params, or a route text). */
    ui(value: UiText, sourceLocale: Locale): string {
      return uiTextIn(value, translate, locale.value as Locale, sourceLocale, units.value);
    },
  };
}
