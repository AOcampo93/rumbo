import { isValidLatLng, type LatLng, polylineLength } from '@rumbo/geo-utils';
import {
  ActivitySchema,
  AiTemplateParamsSchema,
  DecisionParamsSchema,
  formatPath,
  InfoSheetParamsSchema,
  LatLngSchema,
  LocaleSchema,
  localizedText,
  MediaRefSchema,
  PointCategorySchema,
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
  /** Writing a user route needs its X-Edit-Token. */
  'missing_edit_token',
  /** Also a user route read without its edit token: user routes are private. */
  'route_not_found',
  /** The id of a new route is taken (by a curated route or by another owner). */
  'route_exists',
  /** The body's spec.id differs from the URL's id. */
  'route_id_mismatch',
  /** The route fails validation or the user-route rules; `details` says where. */
  'invalid_route',
  /** The device has as many routes on the server as it may. */
  'quota_exceeded',
  'run_not_found',
  /** Also a wrong edit token, or a write to a curated route. */
  'forbidden',
  'place_not_found',
  /** The place search provider answered with an error. */
  'geocoding_failed',
  /** Place search is off, or paused because the provider asked us to slow down. */
  'geocoding_unavailable',
  'rate_limited',
  'payload_too_large',
  'not_found',
  /** The API runs without a database (local experiments). */
  'unavailable',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** One problem with a request: path → message (for developers, never shown). */
export interface ErrorDetail {
  path: string;
  message: string;
}

/** `details` never lists more problems than this. */
export const MAX_ERROR_DETAILS = 20;

export const ApiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  /** For `validation_failed` and `invalid_route`. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ------------------------------------------------------------------ device

/** Anonymous device id (§10.8): not authentication, just a stable random id. */
export const DeviceIdSchema = z.uuid();
export const DEVICE_ID_HEADER = 'x-device-id';

// ------------------------------------------------------------------ edit token

/**
 * Proof of ownership of a user route: 32 random bytes in base64url (43
 * characters) that the client makes when it creates the route and sends on
 * every write. The server keeps only its SHA-256.
 */
export const EditTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const EDIT_TOKEN_HEADER = 'x-edit-token';

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

/** Rounds to 3 decimals (about 110 m): the server never sees an exact position. */
const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000 || 0;

/** "lat,lng" → { lat, lng }, rounded to 3 decimals. */
export const NearSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Use "lat,lng"')
  .transform((value) => {
    const [lat, lng] = value.split(',').map(Number) as [number, number];
    return { lat, lng };
  })
  .pipe(LatLngSchema)
  .transform(({ lat, lng }) => ({ lat: roundCoordinate(lat), lng: roundCoordinate(lng) }));

/** Curated routes only: user routes are private to the device that made them. */
export const RouteListQuerySchema = z.object({
  mode: RouteModeSchema.optional(),
  activity: ActivitySchema.optional(),
  /** Text search in the route's name and summary, any language. */
  q: z.string().trim().min(1).max(80).optional(),
  /** Sorts by distance from this position. */
  near: NearSchema.optional(),
});
export type RouteListQuery = z.infer<typeof RouteListQuerySchema>;

export const RouteIdParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{3,64}$/) });

/**
 * Body of POST /routes and PUT /routes/:id: only the envelope here, so every
 * problem with the route itself is a 422 `invalid_route` from the handler
 * (validateRouteBundle, then checkUserRoute).
 */
export const RouteBundleBodySchema = z.strictObject({
  spec: z.unknown(),
  contents: z.unknown().optional(),
});
export type RouteBundleBody = z.infer<typeof RouteBundleBodySchema>;

/** Answer to a route write. */
export const RouteWriteResponseSchema = z.object({ id: z.string(), updatedAt: z.iso.datetime() });
export type RouteWriteResponse = z.infer<typeof RouteWriteResponseSchema>;

// ------------------------------------------------------------------ user routes

/** Limits of user routes, stricter than the route schema's (phase 6 security review). */
export const USER_ROUTE_LIMITS = {
  /** Straight legs between the points, in order; the creator's DRAFT_LIMITS agree. */
  maxRouteMeters: 500_000,
  /** Actions beyond one per point (the creator adds 4 decisions). */
  extraActions: 8,
  maxInterests: 10,
  /** Code points, as every text limit. */
  interestMax: 40,
  addressMax: 200,
  /** Objects and arrays nested inside one another, the bundle itself included. */
  maxDepth: 8,
} as const;

/** Action types a user route may use, with the params each accepts: no images. */
const USER_ACTION_PARAMS = new Map<string, z.ZodType>([
  ['info_sheet', InfoSheetParamsSchema.omit({ image: true })],
  ['ai_template', AiTemplateParamsSchema],
  ['decision', DecisionParamsSchema],
]);
const USER_ROUTE_TRIGGERS = new Set(['onDeviation', 'onIdle', 'onOutOfOrder', 'onTimeout']);
const USER_POINT_TRIGGERS = new Set(['onEnter']);
/** Fields the creator never writes; `contents` stays empty too (no cards yet). */
const NOT_IN_USER_ROUTES = ['path', 'coverImage', 'description', 'summary'] as const;

const RouteMetaSchema = z.strictObject({
  interests: z
    .array(z.string().max(USER_ROUTE_LIMITS.interestMax))
    .max(USER_ROUTE_LIMITS.maxInterests)
    .optional(),
});
const PointMetaSchema = z.strictObject({
  address: z.string().max(USER_ROUTE_LIMITS.addressMax).optional(),
  externalId: z
    .string()
    .regex(/^Q\d{1,12}$/, 'Use a Wikidata QID')
    .optional(),
});

/** Controls (U+0000 included) and lone surrogates: Postgres can't store some in jsonb. */
const UNSTORABLE = /[\p{Cc}\p{Cs}]/u;

type Path = readonly PropertyKey[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Everything a user route may contain, on top of validateRouteBundle (which
 * must pass first): only what the creator produces, so nobody can store
 * images, links, cards or bulky data through the API. Returns at most
 * MAX_ERROR_DETAILS problems; none means the route may be stored.
 * - spec.source 'user'; no `path`, `coverImage`, `description` or `summary`; no contents;
 * - route meta: only `interests`; point meta: only `address` and `externalId` (a QID);
 * - at most points + 8 actions, all of them info_sheet (no image), ai_template or decision;
 *   no `presentation` or `feedback`;
 * - route triggers only onDeviation/onIdle/onOutOfOrder/onTimeout; point triggers only onEnter;
 * - storable: nested at most 8 deep, no controls or lone surrogates in any text or key;
 * - at most 500 km of straight legs between the points, in order.
 */
export function checkUserRoute(bundle: unknown): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const add = (path: Path, message: string) => {
    if (issues.length < MAX_ERROR_DETAILS) issues.push({ path: formatPath(path), message });
  };
  const addZodIssues = (path: Path, result: z.ZodSafeParseResult<unknown>) => {
    for (const issue of result.error?.issues ?? []) add([...path, ...issue.path], issue.message);
  };

  if (!isRecord(bundle) || !isRecord(bundle['spec'])) {
    add(['spec'], 'A route bundle has a spec object');
    return issues;
  }
  const spec = bundle['spec'];
  const contents = bundle['contents'];
  if (contents !== undefined && !(isRecord(contents) && Object.keys(contents).length === 0)) {
    add(['contents'], 'User routes have no cards yet');
  }
  if (spec['source'] !== 'user') add(['spec', 'source'], 'Must be "user"');
  for (const key of NOT_IN_USER_ROUTES) {
    if (spec[key] !== undefined) add(['spec', key], 'Not allowed in a user route');
  }
  if (spec['meta'] !== undefined) {
    addZodIssues(['spec', 'meta'], RouteMetaSchema.safeParse(spec['meta']));
  }
  checkTriggers(spec['triggers'], USER_ROUTE_TRIGGERS, ['spec', 'triggers'], add);

  const points = Array.isArray(spec['points']) ? spec['points'] : [];
  points.forEach((point: unknown, i) => {
    if (!isRecord(point)) return;
    if (point['meta'] !== undefined) {
      addZodIssues(['spec', 'points', i, 'meta'], PointMetaSchema.safeParse(point['meta']));
    }
    checkTriggers(point['triggers'], USER_POINT_TRIGGERS, ['spec', 'points', i, 'triggers'], add);
  });

  const actions = isRecord(spec['actions']) ? spec['actions'] : {};
  const maxActions = points.length + USER_ROUTE_LIMITS.extraActions;
  if (Object.keys(actions).length > maxActions) {
    add(['spec', 'actions'], `At most ${maxActions} actions: one per point plus 8`);
  }
  for (const [id, action] of Object.entries(actions)) {
    const path = ['spec', 'actions', id];
    if (!isRecord(action)) continue;
    const schema = USER_ACTION_PARAMS.get(String(action['type']));
    if (schema) addZodIssues([...path, 'params'], schema.safeParse(action['params'] ?? {}));
    else add([...path, 'type'], 'User routes only use info_sheet, ai_template and decision');
    for (const key of ['presentation', 'feedback']) {
      if (action[key] !== undefined) add([...path, key], 'Not allowed in a user route');
    }
  }

  const meters = routeLength(points);
  if (meters > USER_ROUTE_LIMITS.maxRouteMeters) {
    add(
      ['spec', 'points'],
      `The route is ${(meters / 1000).toFixed(1)} km long; the limit is 500 km`,
    );
  }
  checkStorable(bundle, [], 1, add);
  return issues;
}

/** Only the allowed triggers may point to an action; null means none. */
function checkTriggers(
  triggers: unknown,
  allowed: ReadonlySet<string>,
  path: Path,
  add: (path: Path, message: string) => void,
): void {
  if (!isRecord(triggers)) return;
  for (const [key, ref] of Object.entries(triggers)) {
    if (!allowed.has(key) && ref !== null && ref !== undefined) {
      add([...path, key], 'Not allowed in a user route');
    }
  }
}

/** Straight legs between the points sorted by order; 0 if any position is unusable. */
function routeLength(points: readonly unknown[]): number {
  const stops: Array<{ order: number; position: LatLng }> = [];
  for (const point of points) {
    if (!isRecord(point) || typeof point['order'] !== 'number') return 0;
    const position = point['position'] as LatLng | undefined;
    if (!isRecord(position) || !isValidLatLng(position)) return 0;
    stops.push({ order: point['order'], position });
  }
  return polylineLength(stops.sort((a, b) => a.order - b.order).map((stop) => stop.position));
}

/** Walks every value: depth, then the texts (keys included) Postgres can store. */
function checkStorable(
  value: unknown,
  path: Path,
  depth: number,
  add: (path: Path, message: string) => void,
): void {
  if (typeof value === 'string') {
    if (UNSTORABLE.test(value)) add(path, 'Control characters and lone surrogates are not allowed');
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (depth > USER_ROUTE_LIMITS.maxDepth) {
    add(path, `Nested more than ${USER_ROUTE_LIMITS.maxDepth} levels deep`);
    return;
  }
  const isArray = Array.isArray(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, isArray ? Number(key) : key];
    if (UNSTORABLE.test(key)) add(childPath, 'Control characters are not allowed in a key');
    checkStorable(child, childPath, depth + 1, add);
  }
}

// ------------------------------------------------------------------ places (geocoding)

export const GEO_KINDS = ['place', 'area'] as const;
export type GeoKind = (typeof GEO_KINDS)[number];

/** GET /geo/suggest. The language comes from Accept-Language. */
export const GeoSuggestQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  /** Map centre (or the area, or the places' centroid): results near it first. */
  near: NearSchema.optional(),
  /** `place` for the route's places, `area` for the city or area of step 1. */
  kind: z.enum(GEO_KINDS).default('place'),
  limit: z.coerce.number().int().min(1).max(10).default(8),
});
export type GeoSuggestQuery = z.infer<typeof GeoSuggestQuerySchema>;

export const GeoSuggestionSchema = z.object({
  /** Opaque, for GET /geo/resolve: e.g. 'wikidata:Q2969701'. */
  key: z.string().max(300),
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  position: LatLngSchema,
  /** Places only. */
  category: PointCategorySchema.optional(),
  externalId: z.string().optional(),
  /** From `near`, when the query has one. */
  distanceMeters: z.number().int().nonnegative().optional(),
  /** False: the position may only move the map, never be saved in a route. */
  storable: z.boolean(),
});
export type GeoSuggestion = z.infer<typeof GeoSuggestionSchema>;

export const GeoSuggestResponseSchema = z.array(GeoSuggestionSchema);

/** GET /geo/resolve: a suggestion's details (its address) before it is added. */
export const GeoResolveQuerySchema = z.object({ key: z.string().min(3).max(300) });
export type GeoResolveQuery = z.infer<typeof GeoResolveQuerySchema>;

export const ResolvedPlaceSchema = z.object({
  key: z.string(),
  name: z.string().min(1).max(80),
  address: z.string().max(200).optional(),
  position: LatLngSchema,
  category: PointCategorySchema.optional(),
  externalId: z.string().optional(),
  storable: z.boolean(),
});
export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

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
