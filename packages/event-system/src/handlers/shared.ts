import type { HandlerContext, HandlerResult, ViewOutcome } from '../types.ts';

/** What every view gets about the point it belongs to. */
export function pointProps(context: HandlerContext): Record<string, unknown> {
  const point = context.point;
  return {
    pointId: point?.id ?? null,
    name: point?.name ?? null,
    order: point?.order ?? null,
    category: point?.category ?? null,
    total: context.route.points.length,
    locale: context.route.locale,
  };
}

/** A closed view becomes a handler result; closing without an answer is 'dismissed'. */
export function fromOutcome(outcome: ViewOutcome | undefined): HandlerResult {
  if (!outcome) return { status: 'dismissed' };
  return {
    status: outcome.status ?? 'done',
    ...(outcome.decision ? { decision: outcome.decision } : {}),
    ...(outcome.data !== undefined ? { data: outcome.data } : {}),
  };
}
