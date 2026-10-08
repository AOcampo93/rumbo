import type { PointState } from './types.ts';

/** A point as a challenge's order rules see it. */
export interface OrderedPoint {
  readonly order: number;
  readonly required: boolean;
  readonly state: PointState;
}

/**
 * Challenge order (docs/PROJECT_PLAN.md §8.3): the states every point should
 * have, for points listed in route order. Completed and reached points keep
 * theirs. Of the rest, the next unfinished one is reachable, plus any optional
 * points before the next required one; optional points left behind a
 * completed one lock for good. A required point behind a completed one can
 * only exist when places were added to a route already under way: it stays
 * reachable, or the run could never finish.
 *
 * Shared by the engine (after every arrival) and `migrateSnapshot` (after the
 * route changed), so both agree on what is open.
 */
export function challengeStates(points: readonly OrderedPoint[]): PointState[] {
  let lastDoneOrder = 0;
  for (const point of points) {
    if (point.state === 'completed') lastDoneOrder = Math.max(lastDoneOrder, point.order);
  }
  let open = true;
  return points.map((point) => {
    if (point.state === 'completed') return point.state;
    if (point.state === 'reached') {
      if (point.required) open = false;
      return point.state;
    }
    if (!point.required && point.order < lastDoneOrder) return 'locked';
    const state = open ? 'active' : 'locked';
    if (open && point.required) open = false;
    return state;
  });
}
