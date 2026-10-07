import type { Locale } from '@rumbo/route-spec';
import { LOCALE_TAGS } from './index.ts';

// Number, distance and time formats per language (DESIGN §4.3): "3,4 km" in
// Spanish and Portuguese, "3.4 km" in English; under 1 km, metres rounded to 10.

export type Units = 'metric' | 'imperial';

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: Locale, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${maximumFractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE_TAGS[locale], { maximumFractionDigits });
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(value: number, locale: Locale, decimals = 0): string {
  return numberFormat(locale, decimals).format(value);
}

/** A distance split in value and unit, for the HUD's big number with a small unit. */
export function distanceParts(
  meters: number,
  locale: Locale,
  units: Units = 'metric',
): { value: string; unit: string } {
  const m = Math.max(0, meters);
  if (units === 'imperial') {
    const miles = m / METERS_PER_MILE;
    if (miles < 0.1)
      return {
        value: formatNumber(Math.round((m * FEET_PER_METER) / 10) * 10, locale),
        unit: 'ft',
      };
    return { value: formatNumber(miles, locale, miles < 100 ? 1 : 0), unit: 'mi' };
  }
  if (m < 1000) return { value: formatNumber(Math.round(m / 10) * 10, locale), unit: 'm' };
  const km = m / 1000;
  return { value: formatNumber(km, locale, km < 100 ? 1 : 0), unit: 'km' };
}

/** "340 m", "3,4 km", "0.2 mi". */
export function formatDistance(meters: number, locale: Locale, units: Units = 'metric'): string {
  const { value, unit } = distanceParts(meters, locale, units);
  return `${value} ${unit}`;
}

/** Elapsed run time as a stopwatch: "1:05:23", "0:04:10". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Hours and minutes of an estimate, already rounded: 105 → { h: 1, m: 45 }. */
export function splitMinutes(minutes: number): { h: number; m: number } {
  const rounded = Math.max(1, Math.round(minutes));
  return { h: Math.floor(rounded / 60), m: rounded % 60 };
}

/** "4 min", "1 h 5 min": time left to the target. */
export function formatEta(seconds: number): string {
  const { h, m } = splitMinutes(Math.ceil(seconds / 60));
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A limit or a duration on a stat chip: "1 h 30", "45 min", "2 h". */
export function formatLimit(minutes: number): string {
  const { h, m } = splitMinutes(minutes);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Time of day in the user's language: "20:21" (en-GB too). */
export function formatClock(epochMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs);
}

/** A short date: "7 oct", "7 Oct", "7/10". */
export function formatShortDate(epochMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { day: 'numeric', month: 'short' }).format(
    epochMs,
  );
}

export function isSameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** Speed in km/h or mph, one decimal. */
export function speedValue(
  metersPerSecond: number,
  locale: Locale,
  units: Units = 'metric',
): string {
  const perHour =
    units === 'imperial' ? (metersPerSecond * 3600) / METERS_PER_MILE : metersPerSecond * 3.6;
  return formatNumber(perHour, locale, 1);
}
