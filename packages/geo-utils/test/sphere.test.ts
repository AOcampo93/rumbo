import { describe, expect, it } from 'vitest';
import {
  bearing,
  destination,
  distance,
  EARTH_RADIUS_M,
  isValidLatLng,
  normalizeBearing,
  wrapLongitude,
} from '../src/index.ts';

const ONE_DEGREE_AT_EQUATOR = (EARTH_RADIUS_M * Math.PI) / 180; // ≈ 111 194.93 m
const castle = { lat: 39.7476, lng: -8.807 };

describe('distance', () => {
  it('measures one degree along the equator and along a meridian', () => {
    expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(ONE_DEGREE_AT_EQUATOR, 3);
    expect(distance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(ONE_DEGREE_AT_EQUATOR, 3);
  });

  it('is zero for the same point and symmetric', () => {
    const other = { lat: 39.7436, lng: -8.8075 };
    expect(distance(castle, castle)).toBe(0);
    expect(distance(castle, other)).toBeCloseTo(distance(other, castle), 9);
  });

  it('handles antipodal points without NaN', () => {
    expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_M,
      0,
    );
  });
});

describe('bearing', () => {
  it('returns the cardinal directions', () => {
    const o = { lat: 0, lng: 0 };
    expect(bearing(o, { lat: 1, lng: 0 })).toBeCloseTo(0, 9);
    expect(bearing(o, { lat: 0, lng: 1 })).toBeCloseTo(90, 9);
    expect(bearing(o, { lat: -1, lng: 0 })).toBeCloseTo(180, 9);
    expect(bearing(o, { lat: 0, lng: -1 })).toBeCloseTo(270, 9);
  });

  it('stays in [0, 360)', () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(720)).toBe(0);
  });
});

describe('destination', () => {
  it('lands one degree east when travelling that far along the equator', () => {
    const p = destination({ lat: 0, lng: 0 }, 90, ONE_DEGREE_AT_EQUATOR);
    expect(p.lat).toBeCloseTo(0, 9);
    expect(p.lng).toBeCloseTo(1, 9);
  });

  it('round-trips with distance and bearing at city scale', () => {
    // Angles wrap: 359.9999… and 0 are the same heading.
    const angleGap = (x: number, y: number) => Math.abs(((((x - y) % 360) + 540) % 360) - 180);
    for (const heading of [0, 37, 90, 181, 300]) {
      const p = destination(castle, heading, 340);
      expect(distance(castle, p)).toBeCloseTo(340, 6);
      expect(angleGap(bearing(castle, p), heading)).toBeLessThan(1e-3);
    }
  });

  it('wraps across the antimeridian', () => {
    expect(destination({ lat: 0, lng: 179.9 }, 90, 50_000).lng).toBeLessThan(-179);
  });
});

describe('coordinates', () => {
  it('validates ranges and finiteness', () => {
    expect(isValidLatLng(castle)).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
  });

  it('wraps longitudes into [-180, 180)', () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(-8.807)).toBeCloseTo(-8.807, 12);
  });
});
