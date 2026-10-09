import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALES,
  normalizeRouteSpec,
  type RouteSpec,
  validateRouteBundle,
} from '@rumbo/route-spec';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/index.js';
import { pointContents, routeReports, routes } from '../src/db/schema.js';
import { seedCuratedRoutes } from '../src/db/seed.js';
import { hashEditToken } from '../src/edit-token.js';
import { contentRows, routeRow } from '../src/summary.js';
import { CURATED, DEVICE, TOKEN, userRoute } from './helpers.js';

// Migration 0003 on a database like production's: with the curated route
// already in it, as the earlier release left it. The routes it holds keep
// working: the curated one becomes public, the users' stay private.

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const SCRATCH = `rumbo_migration_${process.pid}`;
const JSONB_COLUMNS = new Set(['spec', 'name', 'summary', 'locales', 'coverImage', 'bbox']);

let admin: Database;
let scratch: Database;
let earlier: string;

/** Inserts a route the way the code before 0003 did, when the table lacked the new columns. */
async function insertBeforeCommunity(row: ReturnType<typeof routeRow>) {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) =>
    sql.identifier(key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
  );
  const values = entries.map(
    ([key, value]) =>
      sql`${JSONB_COLUMNS.has(key) && value !== null ? JSON.stringify(value) : value}`,
  );
  await scratch.db.execute(
    sql`insert into routes (${sql.join(columns, sql`, `)}) values (${sql.join(values, sql`, `)})`,
  );
}

const rowsOf = async (query: ReturnType<typeof sql>) => (await scratch.db.execute(query)).rows;

beforeAll(async () => {
  admin = createDatabase(inject('databaseUrl'), () => {});
  await admin.db.execute(sql`create database ${sql.identifier(SCRATCH)}`);
  const url = new URL(inject('databaseUrl'));
  url.pathname = `/${SCRATCH}`;
  scratch = createDatabase(url.toString(), () => {});

  // The migrations of the release before this one: the same folder up to 0002.
  earlier = await mkdtemp(join(tmpdir(), 'rumbo-migrations-'));
  await cp(MIGRATIONS, earlier, { recursive: true });
  const journalFile = join(earlier, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const entry of journal.entries.filter(({ idx }) => idx >= 3)) {
    await rm(join(earlier, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter(({ idx }) => idx < 3);
  await writeFile(journalFile, JSON.stringify(journal));
});

afterAll(async () => {
  await scratch?.close();
  await admin?.db.execute(sql`drop database if exists ${sql.identifier(SCRATCH)} with (force)`);
  await admin?.close();
  if (earlier) await rm(earlier, { recursive: true, force: true });
});

describe('migration 0003 on a database that already has routes', () => {
  const curated = JSON.parse(readFileSync(new URL('leiria-historica.json', CURATED), 'utf8')) as {
    spec: RouteSpec;
  };
  const mine = userRoute('mi-ruta-abcdefghij', 'Mi ruta');

  it('applies on top of the earlier release’s tables', async () => {
    await scratch.migrate(earlier);
    expect(
      await rowsOf(
        sql`select 1 from information_schema.columns where table_name = 'routes' and column_name = 'visibility'`,
      ),
    ).toEqual([]);

    const validation = validateRouteBundle(curated, { requireLocales: LOCALES });
    expect(validation.errors).toEqual([]);
    await insertBeforeCommunity(routeRow(curated.spec, validation.bundle!.spec));
    await insertBeforeCommunity({
      ...routeRow(mine, normalizeRouteSpec(mine)),
      ownerDeviceId: DEVICE,
      editTokenHash: hashEditToken(TOKEN),
    });
    // The curated route's cards, as the seed stored them.
    const cards = contentRows(curated.spec.id, validation.bundle!.contents);
    if (cards.length > 0) await scratch.db.insert(pointContents).values(cards);

    await scratch.migrate(MIGRATIONS);
    // Idempotent, as the API applies it on every start.
    await scratch.migrate(MIGRATIONS);
  });

  it('makes the curated route public and leaves the users’ routes private and visible', async () => {
    const found = await scratch.db
      .select({
        id: routes.id,
        visibility: routes.visibility,
        moderation: routes.moderation,
        publishedAt: routes.publishedAt,
        moderatedAt: routes.moderatedAt,
        ownerDeviceId: routes.ownerDeviceId,
      })
      .from(routes)
      .orderBy(routes.id);
    expect(found).toEqual([
      {
        id: 'leiria-historica',
        visibility: 'public',
        moderation: 'visible',
        publishedAt: null,
        moderatedAt: null,
        ownerDeviceId: null,
      },
      {
        id: 'mi-ruta-abcdefghij',
        visibility: 'private',
        moderation: 'visible',
        publishedAt: null,
        moderatedAt: null,
        ownerDeviceId: DEVICE,
      },
    ]);
  });

  it('has the columns and defaults the schema describes', async () => {
    const columns = await rowsOf(sql`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where (table_name = 'routes' and column_name in ('visibility', 'moderation', 'published_at', 'moderated_at'))
         or table_name = 'route_reports'
      order by table_name, ordinal_position`);
    const summary = columns.map((c) => [
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
    ]);
    expect(summary).toEqual([
      ['route_reports', 'id', 'bigint', 'NO', "nextval('route_reports_id_seq'::regclass)"],
      ['route_reports', 'route_id', 'text', 'NO', null],
      ['route_reports', 'device_id', 'uuid', 'NO', null],
      ['route_reports', 'reason', 'text', 'NO', null],
      ['route_reports', 'created_at', 'timestamp with time zone', 'NO', 'now()'],
      ['route_reports', 'resolved_at', 'timestamp with time zone', 'YES', null],
      ['routes', 'visibility', 'text', 'NO', "'private'::text"],
      ['routes', 'moderation', 'text', 'NO', "'visible'::text"],
      ['routes', 'published_at', 'timestamp with time zone', 'YES', null],
      ['routes', 'moderated_at', 'timestamp with time zone', 'YES', null],
    ]);
  });

  it('keeps the curated route as the seed finds it: unchanged, and still public', async () => {
    const result = await seedCuratedRoutes(scratch.db, CURATED);
    expect(result).toMatchObject({ unchanged: ['leiria-historica'], inserted: [], updated: [] });
    const [route] = await scratch.db.select().from(routes).where(eq(routes.id, 'leiria-historica'));
    expect(route).toMatchObject({ visibility: 'public', moderation: 'visible' });
  });

  it('has a table of reports with one open report per device and route, and an index on the route', async () => {
    const indexes = await rowsOf(
      sql`select indexname, indexdef from pg_indexes where tablename = 'route_reports' order by indexname`,
    );
    expect(indexes.map((index) => index.indexname)).toEqual([
      'route_reports_open_idx',
      'route_reports_pkey',
      'route_reports_route_idx',
    ]);
    const open = indexes.find((index) => index.indexname === 'route_reports_open_idx');
    expect(String(open?.indexdef)).toMatch(
      /UNIQUE INDEX .* \(route_id, device_id\) WHERE \(resolved_at IS NULL\)/,
    );

    const device = randomUUID();
    const first = await scratch.db
      .insert(routeReports)
      .values({ routeId: 'mi-ruta-abcdefghij', deviceId: device, reason: 'spam' })
      .returning({ id: routeReports.id });
    await expect(
      scratch.db
        .insert(routeReports)
        .values({ routeId: 'mi-ruta-abcdefghij', deviceId: device, reason: 'wrong' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    // Another device, or the same one once its report is closed, may report again.
    await scratch.db
      .insert(routeReports)
      .values({ routeId: 'mi-ruta-abcdefghij', deviceId: randomUUID(), reason: 'spam' });
    await scratch.db
      .update(routeReports)
      .set({ resolvedAt: new Date() })
      .where(eq(routeReports.id, first[0]!.id));
    await scratch.db
      .insert(routeReports)
      .values({ routeId: 'mi-ruta-abcdefghij', deviceId: device, reason: 'wrong' });
    expect(await scratch.db.select().from(routeReports)).toHaveLength(3);
  });

  it('refuses a report of a route that does not exist, and deletes the reports with their route', async () => {
    await expect(
      scratch.db
        .insert(routeReports)
        .values({ routeId: 'no-such-route', deviceId: randomUUID(), reason: 'spam' }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await scratch.db.delete(routes).where(eq(routes.id, 'mi-ruta-abcdefghij'));
    expect(await scratch.db.select().from(routeReports)).toEqual([]);
  });

  it('gives a route stored from now on the defaults: private and visible', async () => {
    const spec = userRoute('otra-ruta-abcdefghij', 'Otra');
    await scratch.db.insert(routes).values(routeRow(spec, normalizeRouteSpec(spec)));
    const [route] = await scratch.db.select().from(routes).where(eq(routes.id, spec.id));
    expect(route).toMatchObject({
      visibility: 'private',
      moderation: 'visible',
      publishedAt: null,
      moderatedAt: null,
    });
  });
});
