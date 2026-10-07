import { describe, expect, it } from 'vitest';
import {
  distanceParts,
  formatDistance,
  formatElapsed,
  formatEta,
  formatLimit,
  speedValue,
  splitMinutes,
} from '../src/i18n/format.ts';

// DESIGN §4.3: "3,4 km" in es/pt, "3.4 km" in en; under 1 km, metres rounded to 10.

describe('distances', () => {
  it('round metres to 10 below 1 km and use one decimal above', () => {
    expect(formatDistance(343, 'es')).toBe('340 m');
    expect(formatDistance(3420, 'es')).toBe('3,4 km');
    expect(formatDistance(3420, 'en')).toBe('3.4 km');
    expect(formatDistance(3420, 'pt')).toBe('3,4 km');
    expect(formatDistance(-5, 'es')).toBe('0 m');
  });

  it('split value and unit for the HUD', () => {
    expect(distanceParts(340, 'es')).toEqual({ value: '340', unit: 'm' });
  });

  it('speak miles and feet in imperial units', () => {
    expect(formatDistance(100, 'en', 'imperial')).toBe('330 ft');
    expect(formatDistance(3218.7, 'en', 'imperial')).toBe('2 mi');
  });
});

describe('times', () => {
  it('show the run clock as h:mm:ss', () => {
    expect(formatElapsed(3_923_000)).toBe('1:05:23');
    expect(formatElapsed(250_000)).toBe('0:04:10');
  });

  it('round estimates to whole minutes', () => {
    expect(splitMinutes(105)).toEqual({ h: 1, m: 45 });
    expect(formatEta(262)).toBe('5 min');
    expect(formatEta(3900)).toBe('1 h 5 min');
    expect(formatLimit(90)).toBe('1 h 30');
    expect(formatLimit(120)).toBe('2 h');
    expect(formatLimit(45)).toBe('45 min');
  });

  it('turn m/s into km/h or mph', () => {
    expect(speedValue(1.25, 'es')).toBe('4,5');
    expect(speedValue(1.25, 'en', 'imperial')).toBe('2.8');
  });
});
