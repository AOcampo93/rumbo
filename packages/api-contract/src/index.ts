import { isValidLatLng, type LatLng, polylineLength } from '@rumbo/geo-utils';
import {
  ACTION_LIMITS,
  ActivitySchema,
  AiTemplateParamsSchema,
  canonicalJson,
  DecisionParamsSchema,
  formatPath,
  InfoSheetParamsSchema,
  LatLngSchema,
  LocaleSchema,
  localizedText,
  MediaRefSchema,
  PointCategorySchema,
  type PointContent,
  PointContentSchema,
  plainText,
  QuizParamsSchema,
  RedirectParamsSchema,
  RouteModeSchema,
  RouteSourceSchema,
  ToastParamsSchema,
  UserLinkSchema,
  VideoParamsSchema,
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
  /** Generative AI is off (no provider or key configured). */
  'ai_unavailable',
  /** Today's AI budget is spent: the creator offers the basic cards. */
  'ai_budget_exceeded',
  /** This device generated as much as it may today. */
  'ai_device_limit',
  /** The AI provider failed or answered something unusable. */
  'generation_failed',
  /** A card of a user route that the server didn't generate. */
  'unverified_content',
  /** Web Push is off on this server (no or malformed VAPID settings): the app hides notifications. */
  'push_unavailable',
  /** POST /media got something that isn't a JPEG, PNG or WebP photo the server can read. */
  'unsupported_media',
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

/**
 * The curated routes and, with `near`, the community routes around it (phase
 * 7.2): user routes their owners made public, never private ones.
 */
export const RouteListQuerySchema = z.object({
  mode: RouteModeSchema.optional(),
  activity: ActivitySchema.optional(),
  /** Text search in the route's name and summary, any language. */
  q: z.string().trim().min(1).max(80).optional(),
  /** Sorts by distance from this position, and adds the community routes around it. */
  near: NearSchema.optional(),
});
export type RouteListQuery = z.infer<typeof RouteListQuerySchema>;

export const RouteIdParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{3,64}$/) });

// ------------------------------------------------------------------ community routes (phase 7.2)

/**
 * Who sees a user route: only the device that made it ('private', the
 * default) or anyone who uses Rumbo near it ('public'), without knowing who
 * made it. Curated routes are always public.
 */
export const ROUTE_VISIBILITIES = ['private', 'public'] as const;
export const RouteVisibilitySchema = z.enum(ROUTE_VISIBILITIES);
export type RouteVisibility = z.infer<typeof RouteVisibilitySchema>;

/**
 * Moderation of a user route. 'hidden': enough devices reported it, and it
 * waits for the operator's review. 'blocked': the operator took it down.
 * Neither is listed nor served to anyone but its owner, whatever its
 * visibility says.
 */
export const MODERATION_STATES = ['visible', 'hidden', 'blocked'] as const;
export const ModerationStateSchema = z.enum(MODERATION_STATES);
export type ModerationState = z.infer<typeof ModerationStateSchema>;

/**
 * GET /routes?near=… adds the public, visible user routes whose centroid is
 * within `radiusMeters` of `near`: the nearest first, `maxListed` at most.
 */
export const COMMUNITY_ROUTES = { radiusMeters: 30_000, maxListed: 20 } as const;

/** GET /routes/:id/status, for the owner (X-Edit-Token): what others can see of the route. */
export const RouteOwnerStatusSchema = z.object({
  visibility: RouteVisibilitySchema,
  moderation: ModerationStateSchema,
  /** When it was last made public; null if it never was. */
  publishedAt: z.iso.datetime().nullable(),
});
export type RouteOwnerStatus = z.infer<typeof RouteOwnerStatusSchema>;

/** Why someone reports a community route. No free text: nothing personal to keep or to moderate. */
export const REPORT_REASONS = [
  'spam',
  'offensive',
  'dangerous',
  'privacy',
  'wrong',
  'other',
] as const;
export const ReportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

/** Open reports from this many different devices hide a public route until it's reviewed. */
export const REPORTS_TO_HIDE = 3;

/** POST /routes/:id/reports, with X-Device-Id. */
export const RouteReportBodySchema = z.strictObject({ reason: ReportReasonSchema });
export type RouteReportBody = z.infer<typeof RouteReportBodySchema>;

/**
 * The same answer for a new report, a repeated one and one about the
 * reporter's own route (which counts for nothing): it never tells how many
 * reports a route has or whether it was hidden.
 */
export const RouteReportResponseSchema = z.object({ received: z.literal(true) });
export type RouteReportResponse = z.infer<typeof RouteReportResponseSchema>;

/** The operator's actions (ADMIN_TOKEN): take a route down, or put it back and close its reports. */
export const MODERATION_ACTIONS = ['block', 'restore'] as const;
export const ModerationActionBodySchema = z.strictObject({ action: z.enum(MODERATION_ACTIONS) });
export type ModerationActionBody = z.infer<typeof ModerationActionBodySchema>;

export const ModerationActionResponseSchema = z.object({
  id: z.string(),
  moderation: ModerationStateSchema,
});
export type ModerationActionResponse = z.infer<typeof ModerationActionResponseSchema>;

/** One route in GET /admin/moderation: hidden, blocked or with open reports. */
export const ModerationItemSchema = z.object({
  id: z.string(),
  name: localizedText({ max: 80 }),
  locale: LocaleSchema,
  visibility: RouteVisibilitySchema,
  moderation: ModerationStateSchema,
  /** Open reports, by reason (reasons without reports are left out). */
  reports: z.partialRecord(ReportReasonSchema, z.number().int().positive()),
  openReports: z.number().int().nonnegative(),
  publishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ModerationItem = z.infer<typeof ModerationItemSchema>;

/** Hidden routes first, then blocked ones, then the rest by open reports, most first. */
export const ModerationQueueResponseSchema = z.object({ routes: z.array(ModerationItemSchema) });
export type ModerationQueueResponse = z.infer<typeof ModerationQueueResponseSchema>;

/**
 * Body of POST /routes and PUT /routes/:id: only the envelope here, so every
 * problem with the route itself is a 422 `invalid_route` from the handler
 * (validateRouteBundle, then checkUserRoute).
 */
export const RouteBundleBodySchema = z.strictObject({
  spec: z.unknown(),
  contents: z.unknown().optional(),
  /** Phase 7.2. Left out: 'private' on a POST, unchanged on a PUT. */
  visibility: RouteVisibilitySchema.optional(),
});
export type RouteBundleBody = z.infer<typeof RouteBundleBodySchema>;

/** Answer to a route write. `visibility` and `moderation` since phase 7.2 (older servers leave them out). */
export const RouteWriteResponseSchema = z.object({
  id: z.string(),
  updatedAt: z.iso.datetime(),
  visibility: RouteVisibilitySchema.optional(),
  moderation: ModerationStateSchema.optional(),
});
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
  /** Generated cards (one per place at most). */
  maxCards: 30,
  /** The only host a user route's card images may come from. */
  imageHost: 'https://upload.wikimedia.org/',
} as const;

// What a place can show on arrival (a quiz, a video, a link, a notice): the
// event system's own params with the fields the creator narrows. Plain texts
// in one language (never a LocalizedText), YouTube ids, full https:// links.
const { quiz: QUIZ_LIMITS } = ACTION_LIMITS;
const USER_QUIZ_PARAMS = QuizParamsSchema.safeExtend({
  question: plainText({ max: QUIZ_LIMITS.question }),
  options: z
    .array(plainText({ max: QUIZ_LIMITS.option }))
    .min(QUIZ_LIMITS.options.min)
    .max(QUIZ_LIMITS.options.max),
  explanation: plainText({ max: QUIZ_LIMITS.explanation }).optional(),
});
const USER_VIDEO_PARAMS = VideoParamsSchema.safeExtend({
  provider: z.literal('youtube'),
  url: z.never().optional(),
  title: plainText({ max: ACTION_LIMITS.videoTitle }).optional(),
});
const USER_REDIRECT_PARAMS = RedirectParamsSchema.extend({
  url: UserLinkSchema,
  label: plainText({ max: ACTION_LIMITS.redirectLabel }),
});
/** An i18n key: dotted words, like `run.arrivedAt`. */
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const USER_TOAST_PARAMS = ToastParamsSchema.safeExtend({
  messageKey: z.string().max(80).regex(MESSAGE_KEY, 'Use a dotted i18n key').optional(),
  message: plainText({ max: ACTION_LIMITS.toastMessage }).optional(),
});

/** Action types a user route may use, with the params each accepts: no images. */
const USER_ACTION_PARAMS = new Map<string, z.ZodType>([
  ['info_sheet', InfoSheetParamsSchema.omit({ image: true })],
  ['ai_template', AiTemplateParamsSchema],
  ['quiz', USER_QUIZ_PARAMS],
  ['video', USER_VIDEO_PARAMS],
  ['redirect', USER_REDIRECT_PARAMS],
  ['toast', USER_TOAST_PARAMS],
  ['decision', DecisionParamsSchema],
]);
const USER_ROUTE_TRIGGERS = new Set(['onDeviation', 'onIdle', 'onOutOfOrder', 'onTimeout']);
const USER_POINT_TRIGGERS = new Set(['onEnter']);
/** Fields the creator never writes. */
const NOT_IN_USER_ROUTES = ['path', 'description'] as const;

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
 * - spec.source 'user'; no `path`, `coverImage` or `description`; `summary` only as plain text;
 * - contents: only the AI cards of its ai_template actions, one per contentRef, in the route's
 *   language, generated by the AI, images from Wikimedia only, at most 30 (the API also checks
 *   that it generated each one: unverified_content);
 * - route meta: only `interests`; point meta: only `address` and `externalId` (a QID);
 * - at most points + 8 actions (one per point plus the decisions), all of them info_sheet (no
 *   image), ai_template, decision or what a place shows on arrival: quiz, video, redirect and
 *   toast, each with the params the creator writes (plain texts in one language, YouTube ids, full
 *   https:// links, an i18n key or plain text); no `presentation` or `feedback`;
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
  if (spec['source'] !== 'user') add(['spec', 'source'], 'Must be "user"');
  if (spec['summary'] !== undefined && typeof spec['summary'] !== 'string') {
    add(['spec', 'summary'], 'A user route summary is plain text');
  }
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
    else {
      add(
        [...path, 'type'],
        'User routes only use info_sheet, ai_template, quiz, video, redirect, toast and decision',
      );
    }
    for (const key of ['presentation', 'feedback']) {
      if (action[key] !== undefined) add([...path, key], 'Not allowed in a user route');
    }
  }

  checkCards(bundle['contents'], spec, actions, add);
  checkCover(spec['coverImage'], bundle['contents'], add);

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

/**
 * The cards of a user route: exactly the AI cards its ai_template actions use,
 * in the route's language, with images from Wikimedia only.
 */
/**
 * A user route's cover (phase 7.3): the user's own photo, stored by this
 * server (only its url and alt), or one of the photos of the route's own cards
 * exactly as the card has it (credit and licence included). Whether the
 * server really has that photo is the server's to check.
 */
function checkCover(cover: unknown, contents: unknown, add: (path: Path, message: string) => void) {
  if (cover === undefined) return;
  const path = ['spec', 'coverImage'];
  if (!isRecord(cover) || typeof cover['url'] !== 'string') {
    add(path, 'A cover is a photo reference');
    return;
  }
  if (isOwnMediaUrl(cover['url'])) {
    for (const key of ['credit', 'license', 'sourceUrl']) {
      if (cover[key] !== undefined) add([...path, key], 'Not allowed on your own photo');
    }
    return;
  }
  const wanted = canonicalJson(cover);
  const cards = isRecord(contents) ? Object.values(contents) : [];
  const found = cards.some(
    (entry) =>
      isRecord(entry) &&
      Object.values(entry).some(
        (card) =>
          isRecord(card) &&
          Array.isArray(card['images']) &&
          card['images'].some((image: unknown) => canonicalJson(image) === wanted),
      ),
  );
  if (!found) {
    add(path, "A cover is your own photo (POST /media) or one of the route's card photos");
  }
}

function checkCards(
  contents: unknown,
  spec: Record<string, unknown>,
  actions: Record<string, unknown>,
  add: (path: Path, message: string) => void,
): void {
  const refs = new Set<string>();
  for (const action of Object.values(actions)) {
    if (!isRecord(action) || action['type'] !== 'ai_template' || !isRecord(action['params']))
      continue;
    const ref = action['params']['contentRef'];
    if (typeof ref === 'string') refs.add(ref);
  }
  const cards = contents === undefined ? {} : contents;
  if (!isRecord(cards)) {
    add(['contents'], 'Cards are an object keyed by contentRef');
    return;
  }
  const keys = Object.keys(cards);
  if (keys.length > USER_ROUTE_LIMITS.maxCards) {
    add(['contents'], `At most ${USER_ROUTE_LIMITS.maxCards} cards`);
  }
  for (const ref of refs) {
    if (!Object.hasOwn(cards, ref)) add(['contents', ref], 'An ai_template action needs its card');
  }
  for (const key of keys) {
    const path = ['contents', key];
    if (!refs.has(key)) add(path, 'No ai_template action uses this card');
    const entry = cards[key];
    const languages = isRecord(entry) ? Object.keys(entry) : [];
    if (languages.length !== 1 || languages[0] !== spec['locale']) {
      add(path, "One card, in the route's language");
      continue;
    }
    const card = (entry as Record<string, unknown>)[languages[0] as string];
    if (!isRecord(card)) continue;
    if (!isRecord(card['generated']) || card['generated']['by'] !== 'ai') {
      add([...path, languages[0] as string, 'generated'], 'Only AI cards made by the server');
    }
    const images = Array.isArray(card['images']) ? card['images'] : [];
    images.forEach((image: unknown, i) => {
      const url = isRecord(image) ? image['url'] : undefined;
      if (typeof url !== 'string' || !url.startsWith(USER_ROUTE_LIMITS.imageHost)) {
        add([...path, languages[0] as string, 'images', i, 'url'], 'Images from Wikimedia only');
      }
    });
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

// ------------------------------------------------------------------ media (phase 7.3)

/**
 * A photo a user uploads as a route's cover (POST /media, with X-Device-Id
 * and the photo as the body). The phone scales it down first; the server
 * decodes it, turns it upright, drops all its metadata (the GPS position above
 * all), stores it as a JPEG and serves it at `/api/v1/media/<id>.jpg`.
 */
export const MEDIA_LIMITS = {
  /** Largest body POST /media takes, in bytes: a scaled-down phone photo fits with room to spare. */
  maxUploadBytes: 4 * 1024 * 1024,
  /** Longest side of the stored photo, in pixels: larger ones are scaled down. */
  maxEdge: 1600,
  /** What POST /media takes (`Content-Type`). */
  types: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

/** Where a stored photo is served: 22 random base64url characters (128 bits) and `.jpg`. */
export const MEDIA_PATH = /^\/api\/v1\/media\/[A-Za-z0-9_-]{22}\.jpg$/;

/** A stored photo's whole address: http(s), a host (no credentials), the media path, nothing after. */
const OWN_MEDIA_URL = /^https?:\/\/[^/?#@\s]+\/api\/v1\/media\/[A-Za-z0-9_-]{22}\.jpg$/;

/**
 * Whether `url` has the shape of a photo this server stores: http(s), the
 * media path and nothing else (no query, fragment or credentials). That the
 * origin is this server's and the photo exists is the server's to check.
 */
export function isOwnMediaUrl(url: string): boolean {
  return OWN_MEDIA_URL.test(url);
}

/** GET /media/:file. */
export const MediaParamsSchema = z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{22}\.jpg$/) });

/** Answer to POST /media: where the stored photo is, for the route's `coverImage.url`. */
export const MediaUploadResponseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  /** Absolute, on this server. */
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;

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

// ------------------------------------------------------------------ AI guide (phase 7)

/** What the AI adapts cards and suggestions to (DESIGN C1 chips). */
export const INTERESTS = [
  'history',
  'art',
  'architecture',
  'food',
  'nature',
  'religion',
  'curiosities',
] as const;
export const InterestSchema = z.enum(INTERESTS);
export type Interest = z.infer<typeof InterestSchema>;

const QidSchema = z.string().regex(/^Q\d{1,12}$/, 'Use a Wikidata QID');

/** POST /v1/content/generate: the card of one place, written in `locale`. */
export const ContentGenerateBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  position: LatLngSchema,
  locale: LocaleSchema,
  category: PointCategorySchema.optional(),
  /** The place's Wikidata item, when it came from the search or a suggestion. */
  externalId: QidSchema.optional(),
  interests: z.array(InterestSchema).max(INTERESTS.length).default([]),
  /** A point of the user's own: researched on the web when Wikipedia has nothing. */
  custom: z.boolean().default(false),
  /** "Regenerar": a new card even when one is kept for this place (it costs a generation). */
  fresh: z.boolean().default(false),
});
export type ContentGenerateBody = z.input<typeof ContentGenerateBodySchema>;

/** A generated card without its id: the client sets it to the place's contentRef. */
export const GeneratedCardSchema = PointContentSchema.omit({ id: true });
export type GeneratedCard = z.infer<typeof GeneratedCardSchema>;

/** Where a card's text came from: the place's article, a web search, or nothing reliable. */
export const CONTENT_GROUNDINGS = ['wikipedia', 'web', 'none'] as const;
export type ContentGrounding = (typeof CONTENT_GROUNDINGS)[number];

export const ContentGenerateResponseSchema = z.object({
  content: GeneratedCardSchema,
  grounding: z.enum(CONTENT_GROUNDINGS),
  /** Served from the server's cache: it cost nothing. */
  cached: z.boolean(),
});
export type ContentGenerateResponse = z.infer<typeof ContentGenerateResponseSchema>;

/** POST /v1/suggest/places: what to see around `near` in `minutes`. */
export const SuggestPlacesBodySchema = z.strictObject({
  near: LatLngSchema.transform(({ lat, lng }) => ({
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng),
  })),
  locale: LocaleSchema,
  interests: z.array(InterestSchema).max(INTERESTS.length).default([]),
  minutes: z.number().int().min(30).max(480),
  activity: ActivitySchema,
  /** Places already in the route. */
  exclude: z.array(QidSchema).max(30).default([]),
});
export type SuggestPlacesBody = z.input<typeof SuggestPlacesBodySchema>;

export const SuggestedPlaceSchema = GeoSuggestionSchema.extend({
  externalId: QidSchema,
  /** Why to go, never what you'll learn there: the card waits for the arrival. */
  teaser: z.string().max(160),
});
export type SuggestedPlace = z.infer<typeof SuggestedPlaceSchema>;

export const SuggestPlacesResponseSchema = z.object({
  title: z.string().max(80),
  summary: z.string().max(280),
  /** In the suggested walking order. */
  places: z.array(SuggestedPlaceSchema).max(12),
});
export type SuggestPlacesResponse = z.infer<typeof SuggestPlacesResponseSchema>;

/**
 * The text the API hashes (SHA-256) to recognise a card it generated: the
 * card without its id, which the client chooses.
 */
export function contentHashInput(card: PointContent | GeneratedCard): string {
  const rest: Record<string, unknown> = { ...card };
  delete rest['id'];
  return canonicalJson(rest);
}

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
