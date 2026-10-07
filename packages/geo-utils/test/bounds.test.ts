import { describe, expect, it } from 'vitest';
import { bbox, centroid } from '../src/index.ts';

describe('bbox', () => {
  it('returns [west, south, east, north]', () => {
    expect(
      bbox([
        { lat: 39.74, lng: -8.81 },
        { lat: 39.75, lng: -8.8 },
        { lat: 39.745, lng: -8.82 },
      ]),
    ).toEqual([-8.82, 39.74, -8.8, 39.75]);
  });

  it('rejects an empty list', () => {
    expect(() => bbox([])).toThrow(RangeError);
  });
});

describe('centroid', () => {
  it('is the middle of symmetric points', () => {
    const c = centroid([
      { lat: 10, lng: 19 },
      { lat: 10, lng: 21 },
      { lat: 9, lng: 20 },
      { lat: 11, lng: 20 },
    ]);
    expect(c.lat).toBeCloseTo(10, 2);
    expect(c.lng).toBeCloseTo(20, 9);
  });

  it('works across the antimeridian', () => {
    const c = centroid([
      { lat: 0, lng: 179 },
      { lat: 0, lng: -179 },
    ]);
    expect(Math.abs(c.lng)).toBeCloseTo(180, 9);
  });

  it('rejects an empty list', () => {
    expect(() => centroid([])).toThrow(RangeError);
  });
});
