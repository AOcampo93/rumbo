import { readdir, readFile } from 'node:fs/promises';
import { canonicalJson, LOCALES, type RouteSpec, validateRouteBundle } from '@rumbo/route-spec';
import { eq } from 'drizzle-orm';
import { routeRow } from '../summary.js';
import type { Db } from './index.js';
import { pointContents, routes } from './schema.js';

export interface SeedResult {
  inserted: string[];
  updated: string[];
  unchanged: string[];
  invalid: string[];
}

interface Logger {
  warn(obj: unknown, msg?: string): void;
}

/**
 * Loads the curated routes of data/routes into the database on every start:
 * new ones are inserted, changed ones replaced (with their cards), equal ones
 * left alone so `updatedAt` stays meaningful. CI already validates the files;
 * an invalid one is skipped, never half-written.
 */
export async function seedCuratedRoutes(db: Db, dir: URL, log?: Logger): Promise<SeedResult> {
  const result: SeedResult = { inserted: [], updated: [], unchanged: [], invalid: [] };
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();

  for (const file of files) {
    const input = JSON.parse(await readFile(new URL(file, dir), 'utf8')) as {
      spec: RouteSpec;
      contents?: unknown;
    };
    const validation = validateRouteBundle(input, { requireLocales: LOCALES });
    if (!validation.bundle) {
      log?.warn(
        { file, errors: validation.errors.slice(0, 5) },
        'seed: invalid curated route skipped',
      );
      result.invalid.push(file);
      continue;
    }
    const { spec, contents } = validation.bundle;
    const row = routeRow(input.spec, spec);

    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(routes).where(eq(routes.id, spec.id));
      const sameSpec = existing && canonicalJson(existing.spec) === canonicalJson(row.spec);
      const contentRows = Object.entries(contents).flatMap(([contentRef, byLocale]) =>
        Object.entries(byLocale).map(([locale, content]) => ({
          routeId: spec.id,
          contentRef,
          locale,
          content,
          status: content?.status ?? 'approved',
        })),
      );
      const existingContents = existing
        ? await tx.select().from(pointContents).where(eq(pointContents.routeId, spec.id))
        : [];
      const sameContents =
        existingContents.length === contentRows.length &&
        contentRows.every((wanted) =>
          existingContents.some(
            (have) =>
              have.contentRef === wanted.contentRef &&
              have.locale === wanted.locale &&
              canonicalJson(have.content) === canonicalJson(wanted.content),
          ),
        );
      if (existing && sameSpec && sameContents) {
        result.unchanged.push(spec.id);
        return;
      }
      if (existing) {
        await tx
          .update(routes)
          .set({ ...row, updatedAt: new Date() })
          .where(eq(routes.id, spec.id));
        await tx.delete(pointContents).where(eq(pointContents.routeId, spec.id));
        result.updated.push(spec.id);
      } else {
        await tx.insert(routes).values(row);
        result.inserted.push(spec.id);
      }
      if (contentRows.length > 0) await tx.insert(pointContents).values(contentRows);
    });
  }
  return result;
}
