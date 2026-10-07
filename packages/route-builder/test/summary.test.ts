import { destination, distance } from '@rumbo/geo-utils';
import type { RouteSpec } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import { summarizeRoute } from '../src/index.ts';

const start = { lat: 39.7476, lng: -8.807 };

/** `count` points 300 m apart, heading east. */
function route(count: number, overrides: Partial<RouteSpec> = {}): RouteSpec {
  return {
    specVersion: 1,
    id: 'summary-test',
    name: 'Test',
    locale: 'es',
    mode: 'free',
    activity: 'walk',
    source: 'user',
    points: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      position: destination(start, 90, i * 300),
      order: i + 1,
    })),
    actions: {},
    ...overrides,
  };
}

describe('summarizeRoute', () => {
  it('measures point to point in order and estimates walking time plus visits', () => {
    const summary = summarizeRoute(route(12));
    expect(summary.pointCount).toBe(12);
    expect(summary.distanceMeters).toBe(3300);
    // 3 300 m at 1.3 m/s ≈ 42 min, plus 12 visits × 6 min ≈ 114 → 115 min.
    expect(summary.estimatedMinutes).toBe(115);
  });

  it('measures along the path when the route has one, at running speed', () => {
    const path = [start, destination(start, 0, 1000), destination(start, 0, 2000)];
    const summary = summarizeRoute(route(2, { mode: 'challenge', activity: 'run', path }));
    expect(summary.distanceMeters).toBe(2000);
    // 2 000 m at 2.8 m/s ≈ 12 min, plus 2 check-ins × 0.5 min → 15 min.
    expect(summary.estimatedMinutes).toBe(15);
  });

  it('returns a centroid and bbox covering points and path', () => {
    const summary = summarizeRoute(route(3));
    const [west, south, east, north] = summary.bbox;
    expect(west).toBeCloseTo(start.lng, 9);
    expect(south).toBeCloseTo(start.lat, 3);
    expect(east).toBeGreaterThan(west);
    expect(north).toBeCloseTo(start.lat, 3);
    expect(distance(summary.centroid, destination(start, 90, 300))).toBeLessThan(1);
  });

  it('never estimates less than 5 minutes', () => {
    expect(summarizeRoute(route(1)).estimatedMinutes).toBe(5);
  });
});
