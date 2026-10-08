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
// without opening the JSON. AI tables (content_cache, ai_generations) arrive
// with phase 7.

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
