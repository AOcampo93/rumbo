import { describe, expect, it } from 'vitest';
import {
  closestPointOnPolyline,
  destination,
  distance,
  distanceToPolyline,
  distanceToSegment,
  fromLocalXY,
  type LatLng,
  polylineLength,
  simplify,
  toLocalXY,
} from '../src/index.ts';

const a = { lat: 0, lng: 0 };
const b = { lat: 0, lng: 0.01 }; // ≈ 1 112 m east of a

describe('local projection', () => {
  it('round-trips a point near the origin', () => {
    const origin = { lat: 39.7476, lng: -8.807 };
    const p = destination(origin, 60, 800);
    const back = fromLocalXY(origin, toLocalXY(origin, p));
    expect(distance(p, back)).toBeLessThan(0.01);
  });

  it('measures like haversine at route scale (error < 0.5 %)', () => {
    const origin = { lat: 39.7476, lng: -8.807 };
    const p = destination(origin, 135, 3_000);
    const xy = toLocalXY(origin, p);
    expect(Math.abs(Math.hypot(xy.x, xy.y) - 3_000) / 3_000).toBeLessThan(0.005);
  });
});

describe('distanceToSegment', () => {
  it('measures the perpendicular distance to the middle of a segment', () => {
    const p = destination({ lat: 0, lng: 0.005 }, 0, 50);
    expect(distanceToSegment(p, a, b)).toBeCloseTo(50, 1);
  });

  it('measures to the nearest end when the projection falls outside', () => {
    const beyond = { lat: 0, lng: 0.02 };
    expect(distanceToSegment(beyond, a, b)).toBeCloseTo(distance(beyond, b), 0);
  });

  it('treats a zero-length segment as a point', () => {
    const p = { lat: 0.001, lng: 0 };
    expect(distanceToSegment(p, a, a)).toBeCloseTo(distance(p, a), 1);
  });
});

describe('closestPointOnPolyline', () => {
  const line: LatLng[] = [a, b, { lat: 0.01, lng: 0.01 }]; // east, then north

  it('reports the closest segment, its position and the closest point', () => {
    const p = destination({ lat: 0.005, lng: 0.01 }, 90, 30); // 30 m east of the 2nd leg
    const hit = closestPointOnPolyline(p, line);
    expect(hit.index).toBe(1);
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.distance).toBeCloseTo(30, 1);
    expect(distance(hit.point, { lat: 0.005, lng: 0.01 })).toBeLessThan(1);
  });

  it('accepts a single-vertex polyline and rejects an empty one', () => {
    expect(distanceToPolyline({ lat: 0, lng: 0.001 }, [a])).toBeCloseTo(
      distance(a, { lat: 0, lng: 0.001 }),
      6,
    );
    expect(() => distanceToPolyline(a, [])).toThrow(RangeError);
  });
});

describe('polylineLength', () => {
  it('adds up the legs', () => {
    expect(polylineLength([a, b, { lat: 0, lng: 0.02 }])).toBeCloseTo(2 * distance(a, b), 6);
  });

  it('is zero for fewer than two vertices', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([a])).toBe(0);
  });
});

describe('simplify (Douglas–Peucker)', () => {
  const origin = { lat: 39.7476, lng: -8.807 };

  it('collapses a straight line to its endpoints', () => {
    const line = Array.from({ length: 50 }, (_, i) => destination(origin, 90, i * 20));
    const result = simplify(line, 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(line[0]);
    expect(result[1]).toEqual(line[49]);
  });

  it('keeps corners larger than the tolerance and drops smaller wiggles', () => {
    // An L-shaped walk: 500 m east, then 500 m north, with ±2 m GPS jitter.
    const east = Array.from({ length: 26 }, (_, i) => destination(origin, 90, i * 20));
    const corner = east.at(-1) as LatLng;
    const north = Array.from({ length: 25 }, (_, i) => destination(corner, 0, (i + 1) * 20));
    const jittered = [...east, ...north].map((p, i) => destination(p, 0, i % 2 === 0 ? 2 : -2));
    const result = simplify(jittered, 10);
    expect(result).toHaveLength(3);
    expect(distance(result[1] as LatLng, corner)).toBeLessThan(5);
  });

  it('handles a 5 000-point GPS-like track without blowing up', () => {
    // Deterministic random walk (LCG), like a real track: mostly forward, some turns.
    let seed = 42;
    const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32) / 2 ** 32;
    let heading = 0;
    const track: LatLng[] = [origin];
    for (let i = 1; i < 5_000; i++) {
      heading += (random() - 0.5) * 40;
      track.push(destination(track[i - 1] as LatLng, heading, 3 + random() * 4));
    }
    const started = Date.now();
    const result = simplify(track, 5);
    expect(result.length).toBeLessThan(track.length);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns short lines unchanged', () => {
    expect(simplify([], 5)).toEqual([]);
    expect(simplify([a, b], 5)).toEqual([a, b]);
  });
});
