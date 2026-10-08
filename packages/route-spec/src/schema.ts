import { z } from 'zod';
import { LOCALES } from './locale.ts';

// Contract v1 of docs/PROJECT_PLAN.md §6. Distances are metres, durations are
// seconds and timestamps are epoch milliseconds.

export const LocaleSchema = z.enum(LOCALES);

/** A text in a single language, trimmed and within the limits (counted in code points). */
export function plainText(limits: { min?: number; max: number }) {
  return z
    .string()
    .trim()
    .min(limits.min ?? 1)
    .max(limits.max);
}

/** A LocalizedText whose every language obeys the same length limits. */
export function localizedText(limits: { min?: number; max: number }) {
  const text = plainText(limits);
  return z.union([
    text,
    z
      .partialRecord(LocaleSchema, text)
      .refine((value) => Object.keys(value).length > 0, 'Give the text in at least one language'),
  ]);
}

/** Only http(s): content links must never become `javascript:` URLs. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/ });

export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const MediaRefSchema = z.strictObject({
  url: HttpUrlSchema,
  alt: localizedText({ max: 300 }),
  credit: z.string().trim().max(200).optional(),
  license: z.string().trim().max(100).optional(),
  sourceUrl: HttpUrlSchema.optional(),
});

export const RouteModeSchema = z.enum(['free', 'challenge']);
export const ActivitySchema = z.enum(['walk', 'run', 'bike']);
export const RouteSourceSchema = z.enum(['curated', 'user']);
export const PointCategorySchema = z.enum([
  'monument',
  'museum',
  'church',
  'viewpoint',
  'nature',
  'food',
  'culture',
  'checkpoint',
  'start',
  'finish',
  'other',
]);

/**
 * Settings as written in a route: every field is optional, nested groups too.
 * `normalizeRouteSpec` fills in the defaults for the mode and activity.
 */
export const RouteSettingsInputSchema = z
  .strictObject({
    defaultRadius: z.number().min(10).max(500),
    exitHysteresis: z.number().nonnegative(),
    dwellTime: z.number().nonnegative(),
    minAccuracy: z.number().positive(),
    approachDistance: z.number().nonnegative(),
    deviation: z
      .strictObject({
        enabled: z.boolean(),
        maxDistance: z.number().positive(),
        graceTime: z.number().nonnegative(),
      })
      .partial(),
    idle: z
      .strictObject({
        enabled: z.boolean(),
        time: z.number().positive(),
        radius: z.number().positive(),
      })
      .partial(),
    timeLimit: z.number().int().positive().nullable(),
    maxSpeed: z.number().positive(),
    expectedSpeed: z.number().positive(),
    autoCompleteWithoutAction: z.boolean(),
    allowManualCheckIn: z.boolean(),
  })
  .partial();

/** Ids of actions in `RouteSpec.actions`; null or absent means "no action". */
const TriggerRefSchema = z.string().min(1).nullable().optional();

export const PointTriggersSchema = z.strictObject({
  onApproach: TriggerRefSchema,
  onEnter: TriggerRefSchema,
  onExit: TriggerRefSchema,
});

export const RouteTriggersSchema = z.strictObject({
  onStart: TriggerRefSchema,
  onDeviation: TriggerRefSchema,
  onBackOnTrack: TriggerRefSchema,
  onIdle: TriggerRefSchema,
  onOutOfOrder: TriggerRefSchema,
  onTimeout: TriggerRefSchema,
  onFinish: TriggerRefSchema,
  onCancel: TriggerRefSchema,
});

export const RoutePointSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/, 'Use 1-64 lowercase letters, digits, _ or -'),
  name: localizedText({ max: 80 }),
  position: LatLngSchema,
  /** 1..n, unique and consecutive (checked by validateRouteSpec). */
  order: z.number().int().min(1),
  /** Overrides settings.defaultRadius. */
  radius: z.number().min(10).max(500).optional(),
  required: z.boolean().optional(),
  category: PointCategorySchema.optional(),
  triggers: PointTriggersSchema.optional(),
  /** Key of this place's card in RouteBundle.contents. */
  contentRef: z.string().min(1).max(64).optional(),
  /** Opaque to the engine; free for the UI. */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const ActionDefSchema = z.strictObject({
  /** Handler registry key: 'info_sheet', 'quiz', 'video'… */
  type: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'Use a snake_case action type'),
  /** Validated by each handler's own schema. Texts inside are LocalizedText. */
  params: z.record(z.string(), z.unknown()).optional(),
  presentation: z.enum(['blocking', 'toast']).optional(),
  feedback: z
    .strictObject({
      vibrate: z.boolean().optional(),
      sound: z.string().nullable().optional(),
      notify: z.boolean().optional(),
    })
    .optional(),
});

export const RouteSpecSchema = z.strictObject({
  specVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]{3,64}$/, 'Use 3-64 lowercase letters, digits or -'),
  name: localizedText({ max: 80 }),
  summary: localizedText({ max: 280 }).optional(),
  description: localizedText({ max: 4000 }).optional(),
  /** Source language: the language of every plain-string text. */
  locale: LocaleSchema,
  mode: RouteModeSchema,
  activity: ActivitySchema.default('walk'),
  source: RouteSourceSchema,
  coverImage: MediaRefSchema.optional(),
  settings: RouteSettingsInputSchema.optional(),
  points: z.array(RoutePointSchema).min(1).max(100),
  /** Optional drawn path: rendered on the map and used to detect deviations. */
  path: z.array(LatLngSchema).min(2).optional(),
  actions: z.record(z.string().regex(/^[a-z0-9_-]{1,64}$/), ActionDefSchema),
  triggers: RouteTriggersSchema.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type RouteMode = z.infer<typeof RouteModeSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type RouteSource = z.infer<typeof RouteSourceSchema>;
export type PointCategory = z.infer<typeof PointCategorySchema>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export type PointTriggers = z.infer<typeof PointTriggersSchema>;
export type RouteTriggers = z.infer<typeof RouteTriggersSchema>;
export type RoutePoint = z.infer<typeof RoutePointSchema>;
export type ActionDef = z.infer<typeof ActionDefSchema>;
export type RouteSettingsInput = z.infer<typeof RouteSettingsInputSchema>;
/** A route as authored (before defaults). Parse input with validateRouteSpec. */
export type RouteSpec = z.output<typeof RouteSpecSchema>;
/** What callers may pass in: `activity` can be omitted. */
export type RouteSpecInput = z.input<typeof RouteSpecSchema>;
