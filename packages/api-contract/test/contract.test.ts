import { describe, expect, it } from 'vitest';
import {
  AnalyticsBatchBodySchema,
  RouteListQuerySchema,
  RunEndBodySchema,
  RunStartBodySchema,
} from '../src/index.ts';

describe('route list query', () => {
  it('parses filters and "lat,lng"', () => {
    expect(RouteListQuerySchema.parse({ mode: 'free', near: '39.74,-8.81' })).toEqual({
      mode: 'free',
      near: { lat: 39.74, lng: -8.81 },
    });
    expect(RouteListQuerySchema.safeParse({ near: '91,0' }).success).toBe(false);
    expect(RouteListQuerySchema.safeParse({ near: 'leiria' }).success).toBe(false);
    expect(RouteListQuerySchema.safeParse({ mode: 'race' }).success).toBe(false);
  });
});

describe('runs', () => {
  const start = {
    routeId: 'leiria-historica',
    specHash: 'a'.repeat(64),
    mode: 'free',
    simulated: true,
    locale: 'pt',
    startedAt: '2026-10-08T09:00:00.000Z',
  };

  it('accept a start and an end with sane numbers', () => {
    expect(RunStartBodySchema.safeParse(start).success).toBe(true);
    expect(RunStartBodySchema.safeParse({ ...start, extra: 1 }).success).toBe(false);
    const end = {
      status: 'finished',
      endedAt: '2026-10-08T10:00:00.000Z',
      elapsedMs: 3_600_000,
      completedPoints: 12,
      totalPoints: 12,
      score: 0,
    };
    expect(RunEndBodySchema.safeParse(end).success).toBe(true);
    expect(RunEndBodySchema.safeParse({ ...end, status: 'running' }).success).toBe(false);
  });
});

describe('analytics batches', () => {
  const event = { name: 'point_reached', props: { pointId: 'castelo', manual: false }, at: 1 };

  it('take snake_case events with small props', () => {
    expect(AnalyticsBatchBodySchema.safeParse({ events: [event] }).success).toBe(true);
    expect(AnalyticsBatchBodySchema.safeParse({ events: [] }).success).toBe(false);
    expect(
      AnalyticsBatchBodySchema.safeParse({ events: [{ ...event, name: 'PointReached' }] }).success,
    ).toBe(false);
    expect(
      AnalyticsBatchBodySchema.safeParse({
        events: [{ ...event, props: { blob: 'x'.repeat(3000) } }],
      }).success,
    ).toBe(false);
  });

  it('refuse anything that looks like a position', () => {
    for (const key of ['lat', 'Lng', 'latitude', 'coords']) {
      const result = AnalyticsBatchBodySchema.safeParse({
        events: [{ ...event, props: { [key]: 1 } }],
      });
      expect(result.success, key).toBe(false);
    }
  });
});
