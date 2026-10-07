import { distance } from '@rumbo/geo-utils';
import type { z } from 'zod';
import { formatPath, type Issue, type IssueCode } from './issues.ts';
import { LOCALES, type Locale, type LocalizedText, localesOf } from './locale.ts';
import { migrateRouteSpec } from './migrate.ts';
import { type NormalizedRouteSpec, normalizeRouteSpec } from './normalize.ts';
import { type RouteSpec, RouteSpecSchema } from './schema.ts';

export interface ValidateOptions {
  /** Action types the app can run; any other type produces an `unknown_action_type` warning. */
  knownActionTypes?: readonly string[];
  /**
   * Languages every multi-language text must include. Missing ones become
   * errors instead of warnings. Curated routes require es, en and pt.
   */
  requireLocales?: readonly Locale[];
}

export interface RouteSpecValidation {
  ok: boolean;
  /** Present when ok: the normalized spec, ready for the engine. */
  spec?: NormalizedRouteSpec;
  errors: Issue[];
  warnings: Issue[];
}

/** Below this radius, ordinary GPS error (±10-20 m) makes arrivals unreliable. */
export const SMALL_RADIUS_M = 20;

/**
 * Validates any input against RouteSpec v1: migration, schema, then the rules
 * a schema can't express (unique ids, consecutive order, triggers that point at
 * real actions…). See docs/PROJECT_PLAN.md §6.3.
 */
export function validateRouteSpec(
  input: unknown,
  options: ValidateOptions = {},
): RouteSpecValidation {
  const migrated = migrateRouteSpec(input);
  if (!migrated.ok) return { ok: false, errors: [migrated.issue], warnings: [] };

  const parsed = RouteSpecSchema.safeParse(migrated.value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => fromZodIssue(issue)),
      warnings: [],
    };
  }

  const spec = parsed.data;
  const normalized = normalizeRouteSpec(spec);
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  checkPointIds(spec, errors);
  checkOrder(spec, errors);
  checkTriggerTargets(spec, errors);
  checkZones(spec, normalized.settings.defaultRadius, warnings);
  checkActions(spec, options, warnings);
  checkTranslations(spec, options, errors, warnings);
  if (spec.mode === 'challenge' && spec.points.length === 1) {
    warnings.push({
      path: 'points',
      code: 'challenge_single_point',
      message: 'A challenge with a single point has no order to enforce',
    });
  }

  return errors.length > 0
    ? { ok: false, errors, warnings }
    : { ok: true, spec: normalized, errors, warnings };
}

type ZodIssue = z.ZodError['issues'][number];

/** Gives the rules the plan names explicitly their own codes; the rest stay `schema`. */
export function fromZodIssue(issue: ZodIssue, prefix: readonly PropertyKey[] = []): Issue {
  const [first] = issue.path;
  const last = issue.path.at(-1);
  let code: IssueCode = 'schema';
  if (last === 'lat' || last === 'lng') code = 'invalid_coordinates';
  else if (issue.path.length === 1 && first === 'points' && issue.code === 'too_big') {
    code = 'too_many_points';
  } else if (issue.path.length === 1 && first === 'path' && issue.code === 'too_small') {
    code = 'path_too_short';
  }
  return { path: formatPath([...prefix, ...issue.path]), code, message: issue.message };
}

function checkPointIds(spec: RouteSpec, errors: Issue[]): void {
  const firstIndex = new Map<string, number>();
  spec.points.forEach((point, i) => {
    const first = firstIndex.get(point.id);
    if (first === undefined) firstIndex.set(point.id, i);
    else {
      errors.push({
        path: `points[${i}].id`,
        code: 'duplicate_point_id',
        message: `Point id "${point.id}" is already used by points[${first}]`,
      });
    }
  });
}

function checkOrder(spec: RouteSpec, errors: Issue[]): void {
  const orders = spec.points.map((p) => p.order).sort((a, b) => a - b);
  if (!orders.every((order, i) => order === i + 1)) {
    errors.push({
      path: 'points',
      code: 'invalid_order',
      message: `Point orders must be 1..${orders.length} with no gaps or repeats (got ${orders.join(', ')})`,
    });
  }
}

/** Every [path, actionId] pair a trigger refers to. */
function triggerRefs(spec: RouteSpec): Array<[string, string]> {
  const refs: Array<[string, string]> = [];
  spec.points.forEach((point, i) => {
    for (const [key, ref] of Object.entries(point.triggers ?? {})) {
      if (ref) refs.push([`points[${i}].triggers.${key}`, ref]);
    }
  });
  for (const [key, ref] of Object.entries(spec.triggers ?? {})) {
    if (ref) refs.push([`triggers.${key}`, ref]);
  }
  return refs;
}

function checkTriggerTargets(spec: RouteSpec, errors: Issue[]): void {
  for (const [path, ref] of triggerRefs(spec)) {
    if (!(ref in spec.actions)) {
      errors.push({
        path,
        code: 'unknown_action',
        message: `Trigger points to action "${ref}", which is not defined in actions`,
      });
    }
  }
}

function checkZones(spec: RouteSpec, defaultRadius: number, warnings: Issue[]): void {
  if (defaultRadius < SMALL_RADIUS_M) {
    warnings.push({
      path: 'settings.defaultRadius',
      code: 'small_radius',
      message: `A ${defaultRadius} m radius is below ${SMALL_RADIUS_M} m; GPS error can miss arrivals`,
    });
  }
  const radius = (i: number) => spec.points[i]?.radius ?? defaultRadius;
  spec.points.forEach((point, i) => {
    if (point.radius !== undefined && point.radius < SMALL_RADIUS_M) {
      warnings.push({
        path: `points[${i}].radius`,
        code: 'small_radius',
        message: `A ${point.radius} m radius is below ${SMALL_RADIUS_M} m; GPS error can miss arrivals`,
      });
    }
    for (let j = i + 1; j < spec.points.length; j++) {
      const other = spec.points[j];
      if (!other) continue;
      const gap = distance(point.position, other.position);
      if (gap < radius(i) + radius(j)) {
        warnings.push({
          path: `points[${j}]`,
          code: 'overlapping_zones',
          message: `Zones of "${point.id}" and "${other.id}" overlap: ${Math.round(gap)} m apart, radii ${radius(i)} + ${radius(j)} m`,
        });
      }
    }
  });
}

function checkActions(spec: RouteSpec, options: ValidateOptions, warnings: Issue[]): void {
  const used = new Set(triggerRefs(spec).map(([, ref]) => ref));
  for (const [id, action] of Object.entries(spec.actions)) {
    if (!used.has(id)) {
      warnings.push({
        path: `actions.${id}`,
        code: 'unused_action',
        message: `Action "${id}" is never triggered`,
      });
    }
    if (options.knownActionTypes && !options.knownActionTypes.includes(action.type)) {
      warnings.push({
        path: `actions.${id}.type`,
        code: 'unknown_action_type',
        message: `No handler is registered for action type "${action.type}"`,
      });
    }
  }
}

/**
 * Finds the LocalizedText objects inside free-form action params: any object
 * whose keys are all language codes and whose values are all strings.
 */
export function findLocalizedTexts(
  value: unknown,
  path: string,
): Array<{ path: string; text: LocalizedText }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findLocalizedTexts(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== 'object') return [];
  const entries = Object.entries(value);
  const isLocalized =
    entries.length > 0 &&
    entries.every(
      ([key, text]) => (LOCALES as readonly string[]).includes(key) && typeof text === 'string',
    );
  if (isLocalized) return [{ path, text: value as LocalizedText }];
  return entries.flatMap(([key, child]) => findLocalizedTexts(child, `${path}.${key}`));
}

function checkTranslations(
  spec: RouteSpec,
  options: ValidateOptions,
  errors: Issue[],
  warnings: Issue[],
): void {
  const wanted = options.requireLocales ?? LOCALES;
  const sink = options.requireLocales ? errors : warnings;
  const check = (text: LocalizedText | undefined, path: string) => {
    if (text === undefined) return;
    const available = localesOf(text);
    const missing = wanted.filter((locale) => !available.includes(locale));
    if (missing.length > 0) {
      sink.push({ path, code: 'missing_translation', message: `Missing ${missing.join(', ')}` });
    }
  };

  check(spec.name, 'name');
  check(spec.summary, 'summary');
  check(spec.description, 'description');
  check(spec.coverImage?.alt, 'coverImage.alt');
  spec.points.forEach((point, i) => check(point.name, `points[${i}].name`));
  for (const [id, action] of Object.entries(spec.actions)) {
    for (const found of findLocalizedTexts(action.params, `actions.${id}.params`)) {
      check(found.text, found.path);
    }
  }
}
