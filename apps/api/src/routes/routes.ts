import { createHash } from 'node:crypto';
import {
  checkUserRoute,
  COMMUNITY_ROUTES,
  contentHashInput,
  EDIT_TOKEN_HEADER,
  type ModerationState,
  RouteBundleBodySchema,
  RouteIdParamsSchema,
  RouteListQuerySchema,
  RouteOwnerStatusSchema,
  type RouteSummary,
  RouteSummarySchema,
  type RouteVisibility,
  type RouteWriteResponse,
  RouteWriteResponseSchema,
} from '@rumbo/api-contract';
import { distance, type LatLng } from '@rumbo/geo-utils';
import {
  type LocalizedText,
  type RouteBundle,
  type RouteSpec,
  validateRouteBundle,
} from '@rumbo/route-spec';
import { and, asc, count, eq, inArray, ne, or, type SQL } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { centroidNear, communityFilter, isCommunityRoute } from '../community.js';
import type { Database, Db } from '../db/index.js';
import { aiContents, pointContents, routes } from '../db/schema.js';
import { requireDeviceId, touchDevice } from '../device.js';
import { editTokenFrom, editTokenMatches, hashEditToken, requireEditToken } from '../edit-token.js';
import { fail, isDataException } from '../errors.js';
import { addressLimit } from '../limits.js';
import { contentRows, routeRow, summaryColumns, toSummary } from '../summary.js';

export interface DataOptions {
  /** Null until migrations ran (or without DATABASE_URL). */
  database: () => Database | null;
}

export interface RoutesOptions extends DataOptions {
  /** Route writes (and owner reads of user routes) per client address. */
  writeRateLimitPerMinute: number;
  writeRateLimitPerDay: number;
  /** User routes the server keeps at most. */
  userRoutesMax: number;
}

export function requireDatabase(options: DataOptions): Database {
  const database = options.database();
  if (!database) throw fail(503, 'unavailable');
  return database;
}

/** User routes one device may keep on the server. */
export const ROUTES_PER_DEVICE = 50;

/** POST and PUT bodies: 30 places take about 20 KB, the schema's 100 about 60 KB. */
const ROUTE_BODY_LIMIT = 128 * 1024;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type RouteInsert = typeof routes.$inferInsert;

/** Lowercase, without accents: "Sé" and "se" match. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const allLanguages = (text: LocalizedText | undefined) =>
  text === undefined ? [] : typeof text === 'string' ? [text] : Object.values(text);

function matches(route: RouteSummary, query: string): boolean {
  const wanted = fold(query);
  return [...allLanguages(route.name), ...allLanguages(route.summary)].some((text) =>
    fold(text).includes(wanted),
  );
}

interface Measured {
  route: RouteSummary;
  meters: number;
}
const byDistance = (a: Measured, b: Measured) => a.meters - b.meters;

/**
 * The list around `near`: every curated route, and the nearest community
 * routes within the radius (the 20 nearest, however many there are), all by
 * distance. The query only narrowed the community routes to a box.
 */
function around(list: RouteSummary[], near: LatLng): RouteSummary[] {
  const measured = list.map((route) => ({ route, meters: distance(near, route.centroid) }));
  const curated = measured.filter(({ route }) => route.source === 'curated');
  const community = measured
    .filter(
      ({ route, meters }) => route.source !== 'curated' && meters <= COMMUNITY_ROUTES.radiusMeters,
    )
    .sort(byDistance)
    .slice(0, COMMUNITY_ROUTES.maxListed);
  return [...curated, ...community].sort(byDistance).map(({ route }) => route);
}

/**
 * The route in a POST or PUT body, checked the way the app checks a route
 * (validateRouteBundle, without requiring every language) and then against
 * what a user route may contain (checkUserRoute). Any problem: 422.
 */
function userRouteFrom(body: unknown): { authored: RouteSpec; bundle: RouteBundle } {
  const validation = validateRouteBundle(body);
  if (!validation.bundle) {
    const details = validation.errors.map(({ path, message }) => ({ path, message }));
    throw fail(422, 'invalid_route', details);
  }
  const issues = checkUserRoute(body);
  if (issues.length > 0) throw fail(422, 'invalid_route', issues);
  return { authored: (body as { spec: RouteSpec }).spec, bundle: validation.bundle };
}

/**
 * A user route may only carry cards this server generated: each card's
 * SHA-256 (contentHashInput, the card without its id) must be one the AI
 * pipeline stored. Nobody can forge a card that looks AI-written from
 * Wikipedia, or bring images and links of their own through one.
 */
async function verifyCards(db: Db, contents: RouteBundle['contents']): Promise<void> {
  const cards = Object.entries(contents).flatMap(([ref, byLocale]) =>
    Object.entries(byLocale).flatMap(([locale, card]) =>
      card
        ? [
            {
              path: `contents.${ref}.${locale}`,
              hash: createHash('sha256').update(contentHashInput(card)).digest('hex'),
            },
          ]
        : [],
    ),
  );
  if (cards.length === 0) return;
  const known = await db
    .select({ hash: aiContents.contentHash })
    .from(aiContents)
    .where(
      inArray(
        aiContents.contentHash,
        cards.map((card) => card.hash),
      ),
    );
  const generated = new Set(known.map((row) => row.hash));
  const unverified = cards.filter((card) => !generated.has(card.hash));
  if (unverified.length > 0) {
    throw fail(
      422,
      'unverified_content',
      unverified.map(({ path }) => ({ path, message: 'Not a card this server generated' })),
    );
  }
}

/**
 * Runs a write, answering 422 for values that pass every check but that
 * Postgres can't store (e.g. an estimate past the integer range).
 */
async function storing<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isDataException(error)) throw error;
    throw fail(422, 'invalid_route', [
      { path: 'spec', message: 'A value is outside what the server can store' },
    ]);
  }
}

/**
 * Quotas of the user routes (storage abuse): per owner device, and in total.
 * The route's own id doesn't count, so its owner can always repeat a POST.
 */
async function checkQuotas(db: Db, owner: string, id: string, max: number): Promise<void> {
  const others = and(eq(routes.source, 'user'), ne(routes.id, id));
  const [mine] = await db
    .select({ n: count() })
    .from(routes)
    .where(and(others, eq(routes.ownerDeviceId, owner)));
  if ((mine?.n ?? 0) >= ROUTES_PER_DEVICE) throw fail(409, 'quota_exceeded');
  const [all] = await db.select({ n: count() }).from(routes).where(others);
  if ((all?.n ?? 0) >= max) throw fail(503, 'unavailable');
}

const WRITTEN = {
  id: routes.id,
  updatedAt: routes.updatedAt,
  visibility: routes.visibility,
  moderation: routes.moderation,
};

type Written = Pick<typeof routes.$inferSelect, 'id' | 'updatedAt' | 'visibility' | 'moderation'>;

const writeResponse = (written: Written): RouteWriteResponse => ({
  id: written.id,
  updatedAt: written.updatedAt.toISOString(),
  visibility: written.visibility as RouteVisibility,
  moderation: written.moderation as ModerationState,
});

/**
 * The visibility columns a write sets: none when it doesn't say (a PUT
 * without `visibility`), otherwise what it wants. Going public from anything
 * else (private, or a route that doesn't exist yet) stamps `published_at`;
 * going private keeps the stamp of the last time. Moderation is never here:
 * a hidden or blocked route stays so however its owner publishes it.
 */
function visibilityColumns(
  current: string | undefined,
  wanted: RouteVisibility | undefined,
  now: Date,
): Pick<RouteInsert, 'visibility' | 'publishedAt'> {
  if (!wanted) return {};
  return wanted === 'public' && current !== 'public'
    ? { visibility: wanted, publishedAt: now }
    : { visibility: wanted };
}

/** A stored route as the app reads it: the spec and its cards in every language. */
export async function bundleOf(
  db: Db,
  row: { id: string; spec: unknown },
): Promise<{ spec: unknown; contents: Record<string, Record<string, unknown>> }> {
  const cards = await db.select().from(pointContents).where(eq(pointContents.routeId, row.id));
  const contents: Record<string, Record<string, unknown>> = {};
  for (const card of cards) (contents[card.contentRef] ??= {})[card.locale] = card.content;
  return { spec: row.spec, contents };
}

/** Whether the request carries the edit token of this user route. */
function isOwner(
  request: FastifyRequest,
  row: { source: string; editTokenHash: string | null },
): boolean {
  const token = editTokenFrom(request);
  return row.source === 'user' && token !== undefined && editTokenMatches(token, row.editTokenHash);
}

/**
 * Locks a route for a write by its owner until the transaction ends, so no
 * other write slips between this check and ours: 404 when it doesn't exist,
 * 403 when it is curated or the token is another one. Answers how visible it
 * is now.
 */
async function authorizeWrite(tx: Tx, id: string, token: string): Promise<{ visibility: string }> {
  const [row] = await tx
    .select({
      source: routes.source,
      editTokenHash: routes.editTokenHash,
      visibility: routes.visibility,
    })
    .from(routes)
    .where(eq(routes.id, id))
    .for('update');
  if (!row) throw fail(404, 'route_not_found');
  if (row.source !== 'user' || !editTokenMatches(token, row.editTokenHash)) {
    throw fail(403, 'forbidden');
  }
  return row;
}

/** PUT, or a POST repeated by the owner: new spec and listing columns, cards replaced. */
async function replaceRoute(
  tx: Tx,
  id: string,
  row: ReturnType<typeof routeRow>,
  contents: RouteBundle['contents'],
  visibility: Pick<RouteInsert, 'visibility' | 'publishedAt'>,
  now: Date,
): Promise<Written> {
  const [written] = await tx
    .update(routes)
    .set({ ...row, ...visibility, updatedAt: now })
    .where(eq(routes.id, id))
    .returning(WRITTEN);
  if (!written) throw fail(404, 'route_not_found');
  await tx.delete(pointContents).where(eq(pointContents.routeId, id));
  const cards = contentRows(id, contents);
  if (cards.length > 0) await tx.insert(pointContents).values(cards);
  return written;
}

// Authentication runs as onRequest hooks, after the address limit: before
// the body is even read, so a request without its token is a 401 whatever
// it carries (never a 400, 413 or 422).
const authenticate = async (request: FastifyRequest) => {
  requireEditToken(request);
};
const authenticateOwner = async (request: FastifyRequest) => {
  requireEditToken(request);
  requireDeviceId(request);
};

export const routeRoutes: FastifyPluginAsyncZod<RoutesOptions> = async (app, options) => {
  // One budget per client address for every route write: per minute and per day.
  const writeLimit = addressLimit(app, [
    { max: options.writeRateLimitPerMinute, timeWindow: '1 minute' },
    { max: options.writeRateLimitPerDay, timeWindow: '1 day' },
  ]);
  // Owner reads of a user route (they carry the token) share the write budget.
  const ownerReadLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers[EDIT_TOKEN_HEADER] !== undefined) await writeLimit(request, reply);
  };

  app.get(
    '/v1/routes',
    {
      schema: {
        tags: ['routes'],
        summary:
          'Curated routes, filtered; with `near`, also the community routes around it (public ones within 30 km, the 20 nearest) and all sorted by distance',
        querystring: RouteListQuerySchema,
        response: { 200: z.array(RouteSummarySchema) },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const { mode, activity, q, near } = request.query;
      const filters: SQL[] = [eq(routes.status, 'published')];
      if (mode) filters.push(eq(routes.mode, mode));
      if (activity) filters.push(eq(routes.activity, activity));
      const curated = and(eq(routes.source, 'curated'), ...filters);
      // Private, hidden and blocked user routes are never listed. Without
      // `near` neither are the community's: they are found by where they are.
      const wanted = near
        ? or(
            curated,
            and(communityFilter, centroidNear(near, COMMUNITY_ROUTES.radiusMeters), ...filters),
          )
        : curated;
      const rows = await db
        .select(summaryColumns)
        .from(routes)
        .where(wanted)
        .orderBy(asc(routes.id));
      let list = rows.map(toSummary);
      if (q) list = list.filter((route) => matches(route, q));
      if (near) list = around(list, near);
      reply.header('cache-control', 'public, max-age=60');
      return list;
    },
  );

  app.get(
    '/v1/routes/:id',
    {
      onRequest: [ownerReadLimit],
      schema: {
        tags: ['routes'],
        summary:
          'A route bundle: the spec and its cards in every language (a user route that is not public and visible only with its X-Edit-Token)',
        params: RouteIdParamsSchema,
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const [row] = await db
        .select()
        .from(routes)
        .where(and(eq(routes.id, request.params.id), eq(routes.status, 'published')));
      if (!row) throw fail(404, 'route_not_found');

      // A curated route, and a user route that is public and visible, answer
      // anyone. Any other user route answers only its owner; for everyone else
      // it doesn't exist (same answer as a missing id). Checked before the
      // 304, which would otherwise confirm the route exists.
      const owned = isOwner(request, row);
      if (row.source !== 'curated' && !isCommunityRoute(row) && !owned) {
        throw fail(404, 'route_not_found');
      }

      // Unchanged since the client's copy: no body (the bundle can be large).
      const etag = `"${row.specHash.slice(0, 16)}-${row.updatedAt.getTime()}"`;
      reply
        .header('etag', etag)
        .header('cache-control', owned ? 'private, no-store' : 'public, max-age=60');
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();

      return bundleOf(db, row);
    },
  );

  app.get(
    '/v1/routes/:id/status',
    {
      onRequest: [ownerReadLimit],
      schema: {
        tags: ['routes'],
        summary:
          'What others can see of a user route: its visibility, moderation and when it was published (only with its X-Edit-Token)',
        params: RouteIdParamsSchema,
        response: { 200: RouteOwnerStatusSchema },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const [row] = await db
        .select({
          source: routes.source,
          editTokenHash: routes.editTokenHash,
          visibility: routes.visibility,
          moderation: routes.moderation,
          publishedAt: routes.publishedAt,
        })
        .from(routes)
        .where(and(eq(routes.id, request.params.id), eq(routes.status, 'published')));
      // The same answer as the read of a route that isn't the caller's.
      if (!row || !isOwner(request, row)) throw fail(404, 'route_not_found');
      reply.header('cache-control', 'private, no-store');
      return {
        visibility: row.visibility as RouteVisibility,
        moderation: row.moderation as ModerationState,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      };
    },
  );

  app.post(
    '/v1/routes',
    {
      onRequest: [writeLimit, authenticateOwner],
      bodyLimit: ROUTE_BODY_LIMIT,
      schema: {
        tags: ['routes'],
        summary:
          'Stores a new user route, private unless its `visibility` says public (needs X-Device-Id and X-Edit-Token); repeated by its owner, it updates it (200)',
        body: RouteBundleBodySchema,
        response: { 200: RouteWriteResponseSchema, 201: RouteWriteResponseSchema },
      },
    },
    async (request, reply) => {
      const token = requireEditToken(request);
      const owner = requireDeviceId(request);
      const { db } = requireDatabase(options);
      // `visibility` isn't part of the bundle the route is validated as.
      const { visibility = 'private', ...envelope } = request.body;
      const { authored, bundle } = userRouteFrom(envelope);
      await verifyCards(db, bundle.contents);
      const { id } = bundle.spec;
      await checkQuotas(db, owner, id, options.userRoutesMax);
      await touchDevice(db, owner, request.headers['user-agent']);

      const row = routeRow(authored, bundle.spec);
      const now = new Date();
      const { created, written } = await storing(() =>
        db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(routes)
            .values({
              ...row,
              ownerDeviceId: owner,
              editTokenHash: hashEditToken(token),
              ...visibilityColumns(undefined, visibility, now),
            })
            .onConflictDoNothing({ target: routes.id })
            .returning(WRITTEN);
          if (inserted) {
            const cards = contentRows(id, bundle.contents);
            if (cards.length > 0) await tx.insert(pointContents).values(cards);
            return { created: true, written: inserted };
          }
          // The id is taken. Its owner repeating the POST (a lost 201) updates
          // the route; anyone else, or a curated route, gets a conflict.
          const [existing] = await tx
            .select({
              source: routes.source,
              editTokenHash: routes.editTokenHash,
              visibility: routes.visibility,
            })
            .from(routes)
            .where(eq(routes.id, id))
            .for('update');
          if (existing?.source !== 'user' || !editTokenMatches(token, existing.editTokenHash)) {
            throw fail(409, 'route_exists');
          }
          const columns = visibilityColumns(existing.visibility, visibility, now);
          return {
            created: false,
            written: await replaceRoute(tx, id, row, bundle.contents, columns, now),
          };
        }),
      );
      return reply.status(created ? 201 : 200).send(writeResponse(written));
    },
  );

  app.put(
    '/v1/routes/:id',
    {
      onRequest: [writeLimit, authenticate],
      bodyLimit: ROUTE_BODY_LIMIT,
      schema: {
        tags: ['routes'],
        summary:
          'Replaces a user route, and its visibility when the body says (needs its X-Edit-Token)',
        params: RouteIdParamsSchema,
        body: RouteBundleBodySchema,
        response: { 200: RouteWriteResponseSchema },
      },
    },
    async (request) => {
      const token = requireEditToken(request);
      const { db } = requireDatabase(options);
      const { visibility, ...envelope } = request.body;
      const { authored, bundle } = userRouteFrom(envelope);
      await verifyCards(db, bundle.contents);
      const { id } = request.params;
      const now = new Date();
      const written = await storing(() =>
        db.transaction(async (tx) => {
          const current = await authorizeWrite(tx, id, token);
          if (bundle.spec.id !== id) throw fail(400, 'route_id_mismatch');
          const columns = visibilityColumns(current.visibility, visibility, now);
          const row = routeRow(authored, bundle.spec);
          return replaceRoute(tx, id, row, bundle.contents, columns, now);
        }),
      );
      return writeResponse(written);
    },
  );

  app.delete(
    '/v1/routes/:id',
    {
      onRequest: [writeLimit, authenticate],
      schema: {
        tags: ['routes'],
        summary: 'Deletes a user route with its cards, runs and reports (needs its X-Edit-Token)',
        params: RouteIdParamsSchema,
      },
    },
    async (request, reply) => {
      const token = requireEditToken(request);
      const { db } = requireDatabase(options);
      const { id } = request.params;
      await db.transaction(async (tx) => {
        await authorizeWrite(tx, id, token);
        const deleted = await tx
          .delete(routes)
          .where(eq(routes.id, id))
          .returning({ id: routes.id });
        if (deleted.length === 0) throw fail(404, 'route_not_found');
      });
      return reply.status(204).send();
    },
  );
};
