// Validates the curated data (run by CI as `pnpm validate:routes`):
// - every route in data/routes: es, en and pt, only action types the app
//   knows, and action params its handler accepts;
// - every point-of-interest file in data/pois, which must not put a marker
//   on top of a route point.
import { readdir, readFile } from 'node:fs/promises';
import { BUILTIN_ACTION_TYPES, validateActionParams } from '@rumbo/event-system';
import { summarizeRoute } from '@rumbo/route-builder';
import { distance, type LatLng } from '@rumbo/geo-utils';
import {
  formatPath,
  type Issue,
  LOCALES,
  PoiCollectionSchema,
  validateRouteBundle,
} from '@rumbo/route-spec';

const ROUTES_DIR = new URL('../data/routes/', import.meta.url);
const POIS_DIR = new URL('../data/pois/', import.meta.url);
/** Closer than this, a POI marker covers a route point's marker on the map. */
const MIN_POI_GAP_M = 30;
const routePoints: Array<{ id: string; position: LatLng }> = [];

const show = (mark: string, issue: Issue) =>
  console.log(`  ${mark} ${issue.path || '(root)'}: ${issue.message} [${issue.code}]`);

const files = (await readdir(ROUTES_DIR)).filter((name) => name.endsWith('.json')).sort();
let failed = files.length === 0;
if (failed) console.error('✗ No routes found in data/routes');

for (const file of files) {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(new URL(file, ROUTES_DIR), 'utf8'));
  } catch (error) {
    console.log(`✗ ${file}: invalid JSON (${(error as Error).message})`);
    failed = true;
    continue;
  }

  const result = validateRouteBundle(input, {
    requireLocales: LOCALES,
    knownActionTypes: BUILTIN_ACTION_TYPES,
  });
  const spec = result.bundle?.spec;
  if (spec && `${spec.id}.json` !== file) {
    result.errors.push({
      path: 'spec.id',
      code: 'schema',
      message: `must match the file name (${file})`,
    });
  }
  if (spec) {
    const params = validateActionParams(spec).map((issue) => ({
      ...issue,
      path: `spec.${issue.path}`,
    }));
    result.errors.push(...params);
  }

  for (const point of spec?.points ?? [])
    routePoints.push({ id: point.id, position: point.position });

  if (result.errors.length > 0 || !spec) {
    failed = true;
    console.log(`✗ ${file}`);
  } else {
    const summary = summarizeRoute(spec);
    const km = (summary.distanceMeters / 1000).toFixed(1);
    console.log(
      `✓ ${file}: ${summary.pointCount} points · ${km} km · ~${summary.estimatedMinutes} min`,
    );
  }
  result.errors.forEach((issue) => show('✗', issue));
  result.warnings.forEach((issue) => show('⚠', issue));
}

const poiFiles = (await readdir(POIS_DIR).catch(() => []))
  .filter((name) => name.endsWith('.json'))
  .sort();
for (const file of poiFiles) {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  let input: unknown;
  try {
    input = JSON.parse(await readFile(new URL(file, POIS_DIR), 'utf8'));
  } catch (error) {
    console.log(`✗ pois/${file}: invalid JSON (${(error as Error).message})`);
    failed = true;
    continue;
  }
  const parsed = PoiCollectionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: formatPath(issue.path), code: 'schema', message: issue.message });
    }
  } else {
    const collection = parsed.data;
    if (`${collection.id}.json` !== file) {
      errors.push({ path: 'id', code: 'schema', message: `must match the file name (${file})` });
    }
    const seen = new Set<string>();
    collection.pois.forEach((poi, index) => {
      if (seen.has(poi.id)) {
        errors.push({ path: `pois.${index}.id`, code: 'schema', message: `duplicate ${poi.id}` });
      }
      seen.add(poi.id);
      for (const point of routePoints) {
        const gap = distance(poi.position, point.position);
        if (gap < MIN_POI_GAP_M) {
          warnings.push({
            path: `pois.${index}`,
            code: 'schema',
            message: `${poi.id} is ${Math.round(gap)} m from route point "${point.id}"`,
          });
        }
      }
    });
  }
  if (errors.length > 0) {
    failed = true;
    console.log(`✗ pois/${file}`);
  } else {
    console.log(`✓ pois/${file}: ${parsed.data?.pois.length ?? 0} points of interest`);
  }
  errors.forEach((issue) => show('✗', issue));
  warnings.forEach((issue) => show('⚠', issue));
}

process.exit(failed ? 1 : 0);
