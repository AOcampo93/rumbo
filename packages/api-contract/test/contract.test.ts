import { describe, expect, it } from 'vitest';
import {
  AnalyticsBatchBodySchema,
  API_ERROR_CODES,
  ApiErrorSchema,
  EDIT_TOKEN_HEADER,
  EditTokenSchema,
  GeoResolveQuerySchema,
  GeoSuggestionSchema,
  GeoSuggestQuerySchema,
  GeoSuggestResponseSchema,
  NearSchema,
  ResolvedPlaceSchema,
  RouteBundleBodySchema,
  RouteListQuerySchema,
  RouteWriteResponseSchema,
  RunEndBodySchema,
  RunStartBodySchema,
} from '../src/index.ts';

describe('errors', () => {
  it('include the codes of route writes and place search', () => {
    for (const code of [
      'missing_edit_token',
      'route_exists',
      'route_id_mismatch',
      'invalid_route',
      'quota_exceeded',
      'place_not_found',
      'geocoding_failed',
      'geocoding_unavailable',
      'validation_failed',
      'forbidden',
      'route_not_found',
    ]) {
      expect(API_ERROR_CODES).toContain(code);
    }
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
    expect(
      ApiErrorSchema.safeParse({
        code: 'invalid_route',
        details: [{ path: 'spec.points[0].meta.address', message: 'Too long' }],
      }).success,
    ).toBe(true);
  });
});

describe('edit token', () => {
  it('is 43 base64url characters, sent as X-Edit-Token', () => {
    expect(EDIT_TOKEN_HEADER).toBe('x-edit-token');
    expect(EditTokenSchema.safeParse(`${'A'.repeat(41)}-_`).success).toBe(true);
    expect(EditTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(EditTokenSchema.safeParse('A'.repeat(44)).success).toBe(false);
    expect(EditTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
    expect(EditTokenSchema.safeParse(`${'A'.repeat(42)}+`).success).toBe(false);
  });
});

describe('near', () => {
  it('parses "lat,lng" and rounds it to 3 decimals (about 110 m)', () => {
    expect(NearSchema.parse('39.74567,-8.80749')).toEqual({ lat: 39.746, lng: -8.807 });
    expect(NearSchema.parse('39,-8')).toEqual({ lat: 39, lng: -8 });
    const zero = NearSchema.parse('-0.0004,0.0001');
    expect(Object.is(zero.lat, 0) && Object.is(zero.lng, 0)).toBe(true);
    for (const bad of ['91,0', '0,181', 'leiria', '39.7, -8.8', '1e2,0', '']) {
      expect(NearSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

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

  it('has no source filter: the list is curated routes only', () => {
    expect(RouteListQuerySchema.parse({ source: 'user', activity: 'bike' })).toEqual({
      activity: 'bike',
    });
  });
});

describe('route writes', () => {
  it('take only the bundle envelope, so the handler answers every route problem', () => {
    expect(RouteBundleBodySchema.safeParse({ spec: { anything: true } }).success).toBe(true);
    expect(RouteBundleBodySchema.safeParse({ spec: null, contents: 'x' }).success).toBe(true);
    expect(RouteBundleBodySchema.safeParse({}).success).toBe(false);
    expect(RouteBundleBodySchema.safeParse({ spec: {}, extra: 1 }).success).toBe(false);
  });

  it('answer the id and the new updatedAt', () => {
    const ok = { id: 'mi-ruta-k3x9q2m7p1', updatedAt: '2026-10-08T09:00:00.000Z' };
    expect(RouteWriteResponseSchema.parse(ok)).toEqual(ok);
    expect(RouteWriteResponseSchema.safeParse({ ...ok, updatedAt: 'ayer' }).success).toBe(false);
  });
});

describe('place search', () => {
  it('suggest: a trimmed query of 2 to 80 characters, with defaults', () => {
    expect(GeoSuggestQuerySchema.parse({ q: '  castelo ' })).toEqual({
      q: 'castelo',
      kind: 'place',
      limit: 8,
    });
    expect(
      GeoSuggestQuerySchema.parse({ q: 'leiria', kind: 'area', limit: '3', near: '39.7432,-8.8' }),
    ).toEqual({ q: 'leiria', kind: 'area', limit: 3, near: { lat: 39.743, lng: -8.8 } });
    for (const bad of [
      { q: ' a ' },
      { q: 'x'.repeat(81) },
      { q: 'castelo', kind: 'street' },
      { q: 'castelo', limit: '11' },
      { q: 'castelo', limit: 'many' },
    ]) {
      expect(GeoSuggestQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('suggestions and resolved places carry storable positions with short texts', () => {
    const suggestion = {
      key: 'wikidata:Q2969701',
      name: 'Castelo de Leiria',
      description: 'castelo em Leiria, Portugal',
      position: { lat: 39.7476, lng: -8.807 },
      category: 'monument',
      externalId: 'Q2969701',
      distanceMeters: 420,
      storable: true,
    };
    expect(GeoSuggestResponseSchema.safeParse([suggestion]).success).toBe(true);
    expect(GeoSuggestionSchema.safeParse({ ...suggestion, name: '' }).success).toBe(false);
    expect(GeoSuggestionSchema.safeParse({ ...suggestion, distanceMeters: 4.2 }).success).toBe(
      false,
    );
    expect(GeoSuggestionSchema.safeParse({ ...suggestion, storable: undefined }).success).toBe(
      false,
    );
    const resolved = { ...suggestion, address: 'Rua do Castelo, Leiria' };
    delete (resolved as Partial<typeof resolved>).description;
    delete (resolved as Partial<typeof resolved>).distanceMeters;
    expect(ResolvedPlaceSchema.parse(resolved)).toEqual(resolved);
    expect(ResolvedPlaceSchema.safeParse({ ...resolved, address: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(GeoResolveQuerySchema.safeParse({ key: 'wikidata:Q1' }).success).toBe(true);
    expect(GeoResolveQuerySchema.safeParse({ key: 'Q1' }).success).toBe(false);
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
