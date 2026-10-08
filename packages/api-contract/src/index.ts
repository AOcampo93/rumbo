import {
  ActivitySchema,
  LatLngSchema,
  LocaleSchema,
  localizedText,
  MediaRefSchema,
  RouteModeSchema,
  RouteSourceSchema,
} from '@rumbo/route-spec';
import { z } from 'zod';

// HTTP contract v1 (docs/PROJECT_PLAN.md §11.1), shared by the API (request
// validation and OpenAPI) and the web (typed responses). Errors are codes the
// client translates, never text to show.

// ------------------------------------------------------------------ errors

export const API_ERROR_CODES = [
  'validation_failed',
  'missing_device_id',
  'route_not_found',
  'run_not_found',
  'forbidden',
  'rate_limited',
  'payload_too_large',
  'not_found',
  /** The API runs without a database (local experiments). */
  'unavailable',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  /** Field errors for `validation_failed`: path → message (for developers). */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ------------------------------------------------------------------ device

/** Anonymous device id (§10.8): not authentication, just a stable random id. */
export const DeviceIdSchema = z.uuid();
export const DEVICE_ID_HEADER = 'x-device-id';

// ------------------------------------------------------------------ routes

export const RouteSummarySchema = z.object({
  id: z.string(),
  name: localizedText({ max: 80 }),
  summary: localizedText({ max: 280 }).optional(),
  mode: RouteModeSchema,
  activity: ActivitySchema,
  source: RouteSourceSchema,
  /** Source language of the route's plain texts. */
  locale: LocaleSchema,
  /** Languages with every text available. */
  locales: z.array(LocaleSchema),
  coverImage: MediaRefSchema.optional(),
  pointCount: z.number().int(),
  distanceMeters: z.number().int(),
  estimatedMinutes: z.number().int(),
  centroid: LatLngSchema,
  /** [west, south, east, north]. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  updatedAt: z.iso.datetime(),
});
export type RouteSummary = z.infer<typeof RouteSummarySchema>;

/** "lat,lng" → { lat, lng }. */
const NearSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Use "lat,lng"')
  .transform((value) => {
    const [lat, lng] = value.split(',').map(Number) as [number, number];
    return { lat, lng };
  })
  .pipe(LatLngSchema);

export const RouteListQuerySchema = z.object({
  source: RouteSourceSchema.optional(),
  mode: RouteModeSchema.optional(),
  activity: ActivitySchema.optional(),
  /** Text search in the route's name and summary, any language. */
  q: z.string().trim().min(1).max(80).optional(),
  /** Sorts by distance from this position. */
  near: NearSchema.optional(),
});
export type RouteListQuery = z.infer<typeof RouteListQuerySchema>;

export const RouteIdParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{3,64}$/) });

// ------------------------------------------------------------------ runs

export const RUN_END_STATUSES = ['finished', 'cancelled', 'abandoned'] as const;

export const RunStartBodySchema = z.strictObject({
  routeId: z.string().regex(/^[a-z0-9-]{3,64}$/),
  /** hashRouteSpec of the spec the run started with. */
  specHash: z.string().regex(/^[0-9a-f]{16,128}$/),
  mode: RouteModeSchema,
  simulated: z.boolean(),
  locale: LocaleSchema,
  startedAt: z.iso.datetime(),
});
export type RunStartBody = z.infer<typeof RunStartBodySchema>;

export const RunStartResponseSchema = z.object({ runId: z.uuid() });
export type RunStartResponse = z.infer<typeof RunStartResponseSchema>;

export const RunIdParamsSchema = z.object({ runId: z.uuid() });

export const RunEndBodySchema = z.strictObject({
  status: z.enum(RUN_END_STATUSES),
  endedAt: z.iso.datetime(),
  /** Excluding pauses. */
  elapsedMs: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3_600_000),
  completedPoints: z.number().int().min(0).max(100),
  totalPoints: z.number().int().min(1).max(100),
  score: z.number().int().min(0).max(1_000_000),
});
export type RunEndBody = z.infer<typeof RunEndBodySchema>;

// ------------------------------------------------------------------ analytics

/** Keys that would carry a position: analytics never include coordinates (§13). */
const LOCATION_KEYS = new Set(['lat', 'lng', 'lon', 'latitude', 'longitude', 'position', 'coords']);

export const AnalyticsEventSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'Use a snake_case event name'),
  props: z
    .record(z.string().max(64), z.unknown())
    .refine((props) => JSON.stringify(props).length <= 2048, 'Keep props under 2 KB')
    .refine(
      (props) => Object.keys(props).every((key) => !LOCATION_KEYS.has(key.toLowerCase())),
      'Analytics never carry coordinates',
    ),
  /** Client time, epoch ms. */
  at: z.number().int().positive(),
});
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsBatchBodySchema = z.strictObject({
  /** sendBeacon can't set headers, so the device id may travel here. */
  deviceId: DeviceIdSchema.optional(),
  events: z.array(AnalyticsEventSchema).min(1).max(200),
});
export type AnalyticsBatchBody = z.infer<typeof AnalyticsBatchBodySchema>;

// ------------------------------------------------------------------ health

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  commit: z.string().nullable(),
  db: z.enum(['ok', 'error', 'disabled']),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
