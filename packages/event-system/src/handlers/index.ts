import { formatPath, type Issue, type RouteSpec } from '@rumbo/route-spec';
import type { AnyActionHandler } from '../types.ts';
import { aiTemplateHandler, infoSheetHandler } from './cards.ts';
import { quizHandler, redirectHandler, threeSceneHandler, videoHandler } from './media.ts';
import { decisionHandler, toastHandler } from './notices.ts';

export { aiTemplateHandler, infoSheetHandler } from './cards.ts';
export { quizHandler, redirectHandler, threeSceneHandler, videoHandler } from './media.ts';
export { decisionHandler, toastHandler } from './notices.ts';

/**
 * The v1 handlers of docs/PROJECT_PLAN.md §9.5. They hold the logic and the
 * params schemas; the app only renders the views they name.
 */
export const builtinHandlers: readonly AnyActionHandler[] = [
  infoSheetHandler,
  aiTemplateHandler,
  videoHandler,
  quizHandler,
  redirectHandler,
  toastHandler,
  decisionHandler,
  threeSceneHandler,
];

export const BUILTIN_ACTION_TYPES: readonly string[] = builtinHandlers.map((h) => h.type);

/**
 * Checks every action's params against its handler's schema, so a curated
 * route with a broken quiz fails in CI instead of on the street.
 */
export function validateActionParams(
  route: Pick<RouteSpec, 'actions'>,
  handlers: readonly AnyActionHandler[] = builtinHandlers,
): Issue[] {
  const byType = new Map(handlers.map((h) => [h.type, h]));
  const issues: Issue[] = [];
  for (const [id, action] of Object.entries(route.actions)) {
    const schema = byType.get(action.type)?.paramsSchema;
    if (!schema) continue;
    const parsed = schema.safeParse(action.params ?? {});
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      issues.push({
        path: formatPath(['actions', id, 'params', ...issue.path]),
        code: 'schema',
        message: issue.message,
      });
    }
  }
  return issues;
}
