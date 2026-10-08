import { z } from 'zod';
import { type LocalizedContent, PointContentSchema } from './content.ts';
import type { Issue } from './issues.ts';
import { LOCALES } from './locale.ts';
import type { NormalizedRouteSpec } from './normalize.ts';
import { LocaleSchema } from './schema.ts';
import { fromZodIssue, type ValidateOptions, validateRouteSpec } from './validate.ts';

/** What travels between the API, the offline cache and the app. */
export interface RouteBundle {
  spec: NormalizedRouteSpec;
  /** contents[contentRef][locale]. */
  contents: Record<string, LocalizedContent>;
}

export interface RouteBundleValidation {
  ok: boolean;
  bundle?: RouteBundle;
  errors: Issue[];
  warnings: Issue[];
}

const RouteBundleInputSchema = z.strictObject({
  // Validated separately so its issues keep the spec's own codes.
  spec: z.unknown(),
  contents: z
    .record(z.string().min(1).max(64), z.partialRecord(LocaleSchema, PointContentSchema))
    .default({}),
});

/**
 * Validates a whole bundle: the spec, every card, and the links between them.
 * Each referenced card must exist, and its id and language must match where it
 * is stored. With `requireLocales`, every referenced card needs those languages.
 */
export function validateRouteBundle(
  input: unknown,
  options: ValidateOptions = {},
): RouteBundleValidation {
  const outer = RouteBundleInputSchema.safeParse(input);
  if (!outer.success) {
    return { ok: false, errors: outer.error.issues.map((i) => fromZodIssue(i)), warnings: [] };
  }

  const specResult = validateRouteSpec(outer.data.spec, options);
  const prefix = (issue: Issue): Issue => ({
    ...issue,
    path: issue.path ? `spec.${issue.path}` : 'spec',
  });
  const errors = specResult.errors.map(prefix);
  const warnings = specResult.warnings.map(prefix);
  if (!specResult.spec) return { ok: false, errors, warnings };

  const spec = specResult.spec;
  const contents = outer.data.contents;

  for (const [ref, byLocale] of Object.entries(contents)) {
    for (const locale of LOCALES) {
      const card = byLocale[locale];
      if (card && (card.id !== ref || card.locale !== locale)) {
        errors.push({
          path: `contents.${ref}.${locale}`,
          code: 'content_locale_mismatch',
          message: `Card stored at contents.${ref}.${locale} says id "${card.id}" and locale "${card.locale}"`,
        });
      }
    }
  }

  const referenced = new Map<string, string>(); // ref -> where it is referenced
  spec.points.forEach((point, i) => {
    if (point.contentRef) referenced.set(point.contentRef, `spec.points[${i}].contentRef`);
  });
  for (const [id, action] of Object.entries(spec.actions)) {
    const ref = action.params?.['contentRef'];
    if (typeof ref === 'string') referenced.set(ref, `spec.actions.${id}.params.contentRef`);
  }

  for (const [ref, path] of referenced) {
    // Own keys only, as for trigger targets: "toString" is not a card.
    const entry = Object.hasOwn(contents, ref) ? contents[ref] : undefined;
    if (!entry || Object.keys(entry).length === 0) {
      errors.push({ path, code: 'missing_content', message: `No card "${ref}" in contents` });
      continue;
    }
    const missing = (options.requireLocales ?? []).filter((locale) => !entry[locale]);
    if (missing.length > 0) {
      errors.push({
        path: `contents.${ref}`,
        code: 'missing_translation',
        message: `Card "${ref}" is missing ${missing.join(', ')}`,
      });
    }
  }
  for (const ref of Object.keys(contents)) {
    if (!referenced.has(ref)) {
      warnings.push({
        path: `contents.${ref}`,
        code: 'unused_content',
        message: `Card "${ref}" is not referenced by any point or action`,
      });
    }
  }

  return errors.length > 0
    ? { ok: false, errors, warnings }
    : { ok: true, bundle: { spec, contents }, errors, warnings };
}
