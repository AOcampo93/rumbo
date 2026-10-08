import {
  RouteIdParamsSchema,
  RouteListQuerySchema,
  type RouteSummary,
  RouteSummarySchema,
} from '@rumbo/api-contract';
import { distance } from '@rumbo/geo-utils';
import type { LocalizedText } from '@rumbo/route-spec';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { pointContents, routes } from '../db/schema.js';
import { fail } from '../errors.js';
import { toSummary } from '../summary.js';

export interface DataOptions {
  /** Null until migrations ran (or without DATABASE_URL). */
  database: () => Database | null;
}

export function requireDatabase(options: DataOptions): Database {
  const database = options.database();
  if (!database) throw fail(503, 'unavailable');
  return database;
}

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

export const routeRoutes: FastifyPluginAsyncZod<DataOptions> = async (app, options) => {
  app.get(
    '/v1/routes',
    {
      schema: {
        tags: ['routes'],
        summary: 'Published routes, filtered and optionally sorted by distance',
        querystring: RouteListQuerySchema,
        response: { 200: z.array(RouteSummarySchema) },
      },
    },
    async (request, reply) => {
      const { db } = requireDatabase(options);
      const { source, mode, activity, q, near } = request.query;
      const conditions: SQL[] = [eq(routes.status, 'published')];
      if (source) conditions.push(eq(routes.source, source));
      if (mode) conditions.push(eq(routes.mode, mode));
      if (activity) conditions.push(eq(routes.activity, activity));
      const rows = await db
        .select()
        .from(routes)
        .where(and(...conditions))
        .orderBy(asc(routes.id));
      let list = rows.map(toSummary);
      if (q) list = list.filter((route) => matches(route, q));
      if (near) list.sort((a, b) => distance(near, a.centroid) - distance(near, b.centroid));
      reply.header('cache-control', 'public, max-age=60');
      return list;
    },
  );

  app.get(
    '/v1/routes/:id',
    {
      schema: {
        tags: ['routes'],
        summary: 'A route bundle: the spec and its cards in every language',
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

      // Unchanged since the client's copy: no body (the bundle can be large).
      const etag = `"${row.specHash.slice(0, 16)}-${row.updatedAt.getTime()}"`;
      reply.header('etag', etag).header('cache-control', 'public, max-age=60');
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();

      const cards = await db.select().from(pointContents).where(eq(pointContents.routeId, row.id));
      const contents: Record<string, Record<string, unknown>> = {};
      for (const card of cards) (contents[card.contentRef] ??= {})[card.locale] = card.content;
      return { spec: row.spec, contents };
    },
  );
};
