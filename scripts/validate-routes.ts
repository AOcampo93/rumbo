// Validates every curated route in data/routes (run by CI as `pnpm validate:routes`).
// Curated routes must carry es, en and pt, and only use action types the app knows.
import { readdir, readFile } from 'node:fs/promises';
import { summarizeRoute } from '@rumbo/route-builder';
import { type Issue, LOCALES, validateRouteBundle } from '@rumbo/route-spec';

const ROUTES_DIR = new URL('../data/routes/', import.meta.url);

/** Handler types of docs/PROJECT_PLAN.md §9.5. Move to the handler registry when it exists. */
const KNOWN_ACTION_TYPES = [
  'info_sheet',
  'ai_template',
  'video',
  'quiz',
  'redirect',
  'toast',
  'decision',
  'three_scene',
];

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
    knownActionTypes: KNOWN_ACTION_TYPES,
  });
  const spec = result.bundle?.spec;
  if (spec && `${spec.id}.json` !== file) {
    result.errors.push({
      path: 'spec.id',
      code: 'schema',
      message: `must match the file name (${file})`,
    });
  }

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

process.exit(failed ? 1 : 0);
