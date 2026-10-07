import type { Locale } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../stores/settings.ts';
import {
  distanceParts,
  formatClock,
  formatDistance,
  formatElapsed,
  formatEta,
  formatLimit,
  formatNumber,
  formatShortDate,
  isSameDay,
  speedValue,
  splitMinutes,
} from './format.ts';

/** Formats in the active language and units; re-evaluates on change. */
export function useFormat() {
  const { t, locale } = useI18n();
  const settings = useSettingsStore();
  const lang = () => locale.value as Locale;
  return {
    distance: (meters: number) => formatDistance(meters, lang(), settings.units),
    distanceParts: (meters: number) => distanceParts(meters, lang(), settings.units),
    /** "~2 h", "~1 h 45", "~45 min". */
    approx(minutes: number): string {
      const { h, m } = splitMinutes(minutes);
      if (h === 0) return t('stats.approxMinutes', { m });
      if (m === 0) return t('stats.approxHours', { h });
      return t('stats.approxHoursMinutes', { h, m: String(m).padStart(2, '0') });
    },
    elapsed: formatElapsed,
    eta: formatEta,
    limit: formatLimit,
    clock: (epochMs: number) => formatClock(epochMs, lang()),
    /** "hoy, 20:21" or "7 oct, 20:21". */
    when(epochMs: number): string {
      const time = formatClock(epochMs, lang());
      if (isSameDay(epochMs, Date.now())) return t('time.today', { time });
      return t('time.date', { date: formatShortDate(epochMs, lang()), time });
    },
    number: (value: number, decimals = 0) => formatNumber(value, lang(), decimals),
    speed(metersPerSecond: number): string {
      const value = speedValue(metersPerSecond, lang(), settings.units);
      return settings.units === 'imperial' ? t('units.mph', { value }) : t('units.kmh', { value });
    },
    points: (n: number) => t('stats.points', { n }, n),
  };
}
