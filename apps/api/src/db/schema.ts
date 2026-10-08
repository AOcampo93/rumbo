import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Database schema (docs/PROJECT_PLAN.md §11.2). The route's `spec` (jsonb) is
// the source of truth; the other columns are copies to list and filter
// without opening the JSON. The AI tables (ai_contents, ai_generations) are
// phase 7's: the cards the server wrote, and what each AI call used. The push
// tables belong to Web Push: the browsers that asked for reminders, and what
// was already sent to them.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const routes = pgTable(
  'routes',
  {
    /** The spec's id (a slug). */
    id: text('id').primaryKey(),
    /** The route as authored (RouteSpec): the source of truth. */
    spec: jsonb('spec').notNull(),
    specVersion: integer('spec_version').notNull(),
    /** hashRouteSpec: changes only when the engine would behave differently. */
    specHash: text('spec_hash').notNull(),
    name: jsonb('name').notNull(),
    summary: jsonb('summary'),
    mode: text('mode').notNull(),
    activity: text('activity').notNull(),
    source: text('source').notNull(),
    locale: text('locale').notNull(),
    /** Languages with every text available. */
    locales: jsonb('locales').notNull(),
    coverImage: jsonb('cover_image'),
    pointCount: integer('point_count').notNull(),
    distanceM: integer('distance_m').notNull(),
    estMinutes: integer('est_minutes').notNull(),
    centroidLat: doublePrecision('centroid_lat').notNull(),
    centroidLng: doublePrecision('centroid_lng').notNull(),
    /** [west, south, east, north]. */
    bbox: jsonb('bbox').notNull(),
    /** published | draft | archived */
    status: text('status').notNull().default('published'),
    /** Phase 6: routes made with the creator belong to a device until there are accounts. */
    ownerDeviceId: uuid('owner_device_id'),
    ownerUserId: text('owner_user_id'),
    editTokenHash: text('edit_token_hash'),
    ...timestamps,
  },
  (t) => [index('routes_listing_idx').on(t.status, t.source, t.mode)],
);

/** One card per place and language: contents[contentRef][locale] of a RouteBundle. */
export const pointContents = pgTable(
  'point_contents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    contentRef: text('content_ref').notNull(),
    locale: text('locale').notNull(),
    content: jsonb('content').notNull(),
    /** draft | approved */
    status: text('status').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('point_contents_ref_locale_idx').on(t.routeId, t.contentRef, t.locale)],
);

/** Anonymous devices (§10.8): a random id, never personal data. */
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  /** ios | android | desktop | other, from the User-Agent. */
  platform: text('platform'),
  pwaInstalled: boolean('pwa_installed'),
});

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: text('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    specHash: text('spec_hash').notNull(),
    deviceId: uuid('device_id').notNull(),
    mode: text('mode').notNull(),
    simulated: boolean('simulated').notNull().default(false),
    locale: text('locale').notNull(),
    /** running | finished | cancelled | abandoned */
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    elapsedMs: integer('elapsed_ms'),
    completedPoints: integer('completed_points'),
    totalPoints: integer('total_points'),
    score: integer('score'),
    clientInfo: jsonb('client_info'),
    ...timestamps,
  },
  (t) => [index('runs_route_started_idx').on(t.routeId, t.startedAt)],
);

/** Anonymous product events (§13): never coordinates. */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id'),
    runId: uuid('run_id'),
    name: text('name').notNull(),
    props: jsonb('props').notNull(),
    clientTs: timestamp('client_ts', { withTimezone: true }),
    serverTs: timestamp('server_ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('analytics_events_name_ts_idx').on(t.name, t.serverTs)],
);

/**
 * Every card the AI pipeline wrote, by what it was asked for: asking again is
 * free, and a user route may only carry cards that are in here (by hash).
 */
export const aiContents = pgTable('ai_contents', {
  /** `<QID or custom:<hash>>:<locale>:<prompt version>:<interests>`. */
  cacheKey: text('cache_key').primaryKey(),
  /** The card without its `id` (the client sets that to the place's contentRef). */
  content: jsonb('content').notNull(),
  /** SHA-256 (hex) of contentHashInput(content): what POST and PUT /routes look up. */
  contentHash: text('content_hash').notNull().unique(),
  /** wikipedia | web | none */
  grounding: text('grounding').notNull(),
  /** Times it was served from the cache. */
  hits: integer('hits').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per AI generation: the spend of the day is the sum of `cost_usd`. */
export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id'),
    /** card | suggest */
    kind: text('kind').notNull(),
    cacheKey: text('cache_key'),
    locale: text('locale').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    webSearches: integer('web_searches').notNull(),
    /** Estimated from the token counts and the configured prices. */
    costUsd: doublePrecision('cost_usd').notNull(),
    /** ok | failed */
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_generations_created_idx').on(t.createdAt),
    index('ai_generations_device_created_idx').on(t.deviceId, t.createdAt),
  ],
);

/**
 * A browser's Web Push subscription (RFC 8030): where the push service
 * delivers, and the keys that encrypt what we send. The endpoint is a
 * capability, so it is never logged. One device may have several, and the
 * same endpoint always belongs to the device that registered it last.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    /** The browser's public key and auth secret (base64url), for the payload's encryption. */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** es | en | pt: the language of the notifications this browser gets. */
    locale: text('locale').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** Consecutive pushes the push service refused (other than "gone"); a success resets it. */
    failures: integer('failures').notNull().default(0),
  },
  (t) => [index('push_subscriptions_device_idx').on(t.deviceId)],
);

/**
 * What was pushed to a device, for what must happen once: a reminder is
 * claimed by inserting its (kind, ref) row, so two instances (or two ticks)
 * never send the same one twice.
 */
export const pushLog = pgTable(
  'push_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id').notNull(),
    /** run_reminder */
    kind: text('kind').notNull(),
    /** What it was about (a run's id), when it must happen once per thing. */
    ref: text('ref'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_log_kind_ref_idx')
      .on(t.kind, t.ref)
      .where(sql`${t.ref} is not null`),
  ],
);
