import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRouteSpec } from '@rumbo/route-spec';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/index.js';
import { media, routes } from '../src/db/schema.js';
import { routeRow } from '../src/summary.js';
import { DEVICE, userRoute } from './helpers.js';

// Migration 0004 (the photos of the route covers, phase 7.3) on a database like
// production's: with the routes of the earlier release already in it. It only
// adds a table, so the routes keep working, and the table is what the schema
// describes.

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const SCRATCH = `rumbo_media_migration_${process.pid}`;
const ROUTE = 'mi-ruta-abcdefghij';

let admin: Database;
let scratch: Database;
let earlier: string;

const rowsOf = async (query: ReturnType<typeof sql>) => (await scratch.db.execute(query)).rows;

beforeAll(async () => {
  admin = createDatabase(inject('databaseUrl'), () => {});
  await admin.db.execute(sql`create database ${sql.identifier(SCRATCH)}`);
  const url = new URL(inject('databaseUrl'));
  url.pathname = `/${SCRATCH}`;
  scratch = createDatabase(url.toString(), () => {});

  // The migrations of the release before this one: the same folder up to 0003.
  earlier = await mkdtemp(join(tmpdir(), 'rumbo-migrations-'));
  await cp(MIGRATIONS, earlier, { recursive: true });
  const journalFile = join(earlier, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const entry of journal.entries.filter(({ idx }) => idx >= 4)) {
    await rm(join(earlier, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter(({ idx }) => idx < 4);
  await writeFile(journalFile, JSON.stringify(journal));
});

afterAll(async () => {
  await scratch?.close();
  await admin?.db.execute(sql`drop database if exists ${sql.identifier(SCRATCH)} with (force)`);
  await admin?.close();
  if (earlier) await rm(earlier, { recursive: true, force: true });
});

describe('migration 0004 on a database that already has routes', () => {
  it('applies on top of the earlier release’s tables, and again', async () => {
    await scratch.migrate(earlier);
    expect(await rowsOf(sql`select 1 from pg_tables where tablename = 'media'`)).toEqual([]);
    const spec = userRoute(ROUTE, 'Mi ruta');
    await scratch.db.insert(routes).values({
      ...routeRow(spec, normalizeRouteSpec(spec)),
      ownerDeviceId: DEVICE,
    });

    await scratch.migrate(MIGRATIONS);
    // Idempotent, as the API applies it on every start.
    await scratch.migrate(MIGRATIONS);
    expect((await scratch.db.select({ id: routes.id }).from(routes)).map((row) => row.id)).toEqual([
      ROUTE,
    ]);
  });

  it('has the columns, types and defaults the schema describes', async () => {
    const columns = await rowsOf(sql`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_name = 'media'
      order by ordinal_position`);
    expect(
      columns.map((c) => [c.column_name, c.data_type, c.is_nullable, c.column_default]),
    ).toEqual([
      ['id', 'text', 'NO', null],
      ['device_id', 'uuid', 'NO', null],
      ['data', 'bytea', 'NO', null],
      ['bytes', 'integer', 'NO', null],
      ['width', 'integer', 'NO', null],
      ['height', 'integer', 'NO', null],
      ['route_id', 'text', 'YES', null],
      ['created_at', 'timestamp with time zone', 'NO', 'now()'],
      ['unused_since', 'timestamp with time zone', 'YES', null],
    ]);
    const [key] = await rowsOf(
      sql`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'media'::regclass and i.indisprimary`,
    );
    expect(key?.attname).toBe('id');
  });

  it('has the two indexes the cleanup and the daily count use', async () => {
    const indexes = await rowsOf(
      sql`select indexname, indexdef from pg_indexes where tablename = 'media' order by indexname`,
    );
    expect(indexes.map((index) => index.indexname)).toEqual([
      'media_device_created_idx',
      'media_pkey',
      'media_unused_idx',
    ]);
    const definition = (name: string) =>
      String(indexes.find((index) => index.indexname === name)?.indexdef);
    expect(definition('media_device_created_idx')).toMatch(/\(device_id, created_at\)/);
    expect(definition('media_unused_idx')).toMatch(
      /\(COALESCE\(unused_since, created_at\)\) WHERE \(route_id IS NULL\)/,
    );
  });

  it('keeps a photo’s bytes, and lets a photo without a route be', async () => {
    const data = randomBytes(2048);
    const id = randomBytes(16).toString('base64url');
    await scratch.db
      .insert(media)
      .values({ id, deviceId: DEVICE, data, bytes: data.length, width: 640, height: 480 });
    const [photo] = await scratch.db.select().from(media).where(eq(media.id, id));
    expect(photo?.data.equals(data)).toBe(true);
    expect(photo).toMatchObject({ routeId: null, unusedSince: null, bytes: 2048 });
    expect(photo?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('refuses a photo of a route that does not exist, and releases it when its route is deleted', async () => {
    const data = Buffer.from('x');
    const insert = (id: string, routeId: string) =>
      scratch.db
        .insert(media)
        .values({ id, deviceId: DEVICE, data, bytes: 1, width: 1, height: 1, routeId });
    const id = randomBytes(16).toString('base64url');
    await expect(insert(id, 'no-such-route')).rejects.toMatchObject({ cause: { code: '23503' } });

    await insert(id, ROUTE);
    await scratch.db.delete(routes).where(eq(routes.id, ROUTE));
    const [photo] = await scratch.db.select().from(media).where(eq(media.id, id));
    expect(photo).toMatchObject({ id, routeId: null });
  });
});
