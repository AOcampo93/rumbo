import { hashRouteSpec, type NormalizedRouteSpec } from '@rumbo/route-spec';
import { challengeStates } from './challenge.ts';
import { EngineRestoreError } from './engine.ts';
import type { EngineSnapshot, PointState } from './types.ts';

/**
 * Carries the snapshot of a run over to the edited version of its route, so
 * `restoreGeoEngine(spec, migrateSnapshot(snapshot, spec), …)` works where the
 * original snapshot would throw ROUTE_CHANGED. Point ids are stable when a
 * route is edited, so a point still in `spec` keeps everything the run knows
 * about it. Pure: neither argument is modified.
 *
 * - A point that left the route is dropped, but the score it earned stays in
 *   the total (`carriedScore`).
 * - A point that is new starts pending, as if the run had always had it.
 * - What depends on the order or the mode is worked out again from the new
 *   route: a challenge's locks (`challengeStates`), the free mode's absence of
 *   them, and a chosen target that is gone or no longer reachable.
 * - A timeout that the elapsed time no longer justifies (the limit was raised
 *   or removed) un-fires.
 * - Time, track, distance and the rest of the run carry over untouched.
 *
 * The run stays in the status it had. A route left with nothing to visit
 * finishes when the engine is resumed (see `resume`).
 */
export function migrateSnapshot(
  snapshot: EngineSnapshot,
  spec: NormalizedRouteSpec,
): EngineSnapshot {
  if (snapshot.version !== 1) {
    throw new EngineRestoreError(
      'UNSUPPORTED_SNAPSHOT',
      `Unknown snapshot version ${String(snapshot.version)}`,
    );
  }
  if (snapshot.routeId !== spec.id) {
    throw new EngineRestoreError('ROUTE_CHANGED', 'The snapshot belongs to another route');
  }

  const challenge = spec.mode === 'challenge';
  const saved = new Map(snapshot.points.map((point) => [point.id, point]));
  const merged = spec.points.map((def) => {
    const known = saved.get(def.id);
    const point: EngineSnapshot['points'][number] = known
      ? { ...known }
      : {
          id: def.id,
          state: 'active',
          reachedAt: null,
          completedAt: null,
          score: 0,
          approached: false,
        };
    return { def, point };
  });

  // Free mode locks nothing; a challenge works its window out from the whole list.
  const states: PointState[] = challenge
    ? challengeStates(
        merged.map(({ def, point }) => ({
          order: def.order,
          required: def.required,
          state: point.state,
        })),
      )
    : merged.map(({ point }) => (point.state === 'locked' ? 'active' : point.state));
  const points = merged.map(({ point }, i) => ({ ...point, state: states[i] as PointState }));

  // The score of the places that left stays: finishing the rest must not lower it.
  const staying = new Set(points.map((point) => point.id));
  const carriedScore = snapshot.points
    .filter((point) => !staying.has(point.id))
    .reduce((sum, point) => sum + point.score, snapshot.carriedScore ?? 0);

  // A chosen target counts while it can still be walked to (free mode only).
  const target = points.find((point) => point.id === snapshot.selectedTargetId);
  const selectedTargetId =
    !challenge && target && (target.state === 'active' || target.state === 'reached')
      ? target.id
      : null;

  const limit = spec.settings.timeLimit;
  const overtime = snapshot.timeoutFired && limit !== null && snapshot.elapsedMs >= limit * 1000;

  return {
    ...snapshot,
    routeId: spec.id,
    specHash: hashRouteSpec(spec),
    points,
    selectedTargetId,
    ...(carriedScore > 0 ? { carriedScore } : {}),
    flags: { ...snapshot.flags, overtime: snapshot.flags.overtime && overtime },
    timeoutFired: overtime,
    startPosition: snapshot.startPosition ? { ...snapshot.startPosition } : null,
    track: snapshot.track.map((point) => ({ ...point })),
    stats: { ...snapshot.stats },
  };
}
