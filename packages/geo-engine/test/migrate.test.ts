import { destination, type LatLng } from '@rumbo/geo-utils';
import { hashRouteSpec, type NormalizedRouteSpec, type RouteSpecInput } from '@rumbo/route-spec';
import { describe, expect, it } from 'vitest';
import {
  type AnyEngineEvent,
  EngineRestoreError,
  type EngineSnapshot,
  migrateSnapshot,
  restoreGeoEngine,
} from '../src/index.ts';
import {
  challengeRoute,
  createManualSource,
  east,
  freeRoute,
  freeRouteWithCards,
  ORIGIN,
  P1,
  P2,
  P3,
  setup,
} from './harness.ts';

// Editing a route while it is being walked (docs/PROJECT_PLAN.md §8.7): the
// snapshot of the run is carried over to the new version of the route, and
// the run goes on from there.

type Run = ReturnType<typeof setup>;
type Points = NonNullable<RouteSpecInput['points']>;

const P4 = east(P3, 400);
const place = (id: string, position: LatLng, order: number, extra: object = {}) => ({
  id,
  name: id.toUpperCase(),
  position,
  order,
  ...extra,
});
/** A place that opens a card on arrival: the test completes it. */
const withCard = (point: Points[number]) => ({ ...point, triggers: { onEnter: 'card' } });
const CARD = { actions: { card: { type: 'info_sheet' as const } } };

/** A free route whose places open a card on arrival. */
const cardRoute = (points: Points): NormalizedRouteSpec =>
  freeRouteWithCards({ points: points.map(withCard) });

/** A challenge over `points`, with the straight path from the origin through them. */
const challenge = (points: Points, overrides: Partial<RouteSpecInput> = {}): NormalizedRouteSpec =>
  challengeRoute({
    points,
    path: [ORIGIN, ...points.map((point) => point.position)],
    ...overrides,
  });

const json = (snapshot: EngineSnapshot) => JSON.parse(JSON.stringify(snapshot)) as EngineSnapshot;
const states = (snapshot: EngineSnapshot) => snapshot.points.map((p) => `${p.id}:${p.state}`);

/** The edited route's engine, on the old run's clock and a source of its own. */
function resumeOn(run: Run, spec: NormalizedRouteSpec, snapshot: EngineSnapshot) {
  const source = createManualSource(true);
  const engine = restoreGeoEngine(spec, snapshot, {
    source,
    clock: run.time.clock,
    scheduler: run.time.scheduler,
  });
  const events: AnyEngineEvent[] = [];
  engine.on('*', (event) => events.push(event));
  const stay = (position: LatLng, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      run.time.advance(1000);
      source.emit({ ...position, accuracy: 5, timestamp: run.time.clock.now() });
    }
  };
  return { engine, source, events, stay };
}

describe('migrateSnapshot: a free route', () => {
  it('keeps what the run knows about the stops that stay and adds a new one pending', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(ORIGIN, 2);
    run.stay(P1, 6);
    const snapshot = json(run.engine.serialize());
    const before = json(snapshot);

    const v2 = freeRoute({
      points: [place('p1', P1, 1), place('p2', P2, 2), place('p4', P4, 3)],
    });
    const migrated = migrateSnapshot(snapshot, v2);

    expect(snapshot).toEqual(before);
    expect(migrated.specHash).toBe(hashRouteSpec(v2));
    expect(states(migrated)).toEqual(['p1:completed', 'p2:active', 'p4:active']);
    expect(migrated.points[0]).toEqual(snapshot.points[0]);
    expect(migrated.points[2]).toEqual({
      id: 'p4',
      state: 'active',
      reachedAt: null,
      completedAt: null,
      score: 0,
      approached: false,
    });
    expect(migrated).toMatchObject({
      status: 'running',
      startedAt: snapshot.startedAt,
      elapsedMs: snapshot.elapsedMs,
      startPosition: snapshot.startPosition,
      track: snapshot.track,
      stats: snapshot.stats,
      eventSeq: snapshot.eventSeq,
    });

    // The old snapshot is refused by the new route; the migrated one is not.
    expect(() => restoreGeoEngine(v2, snapshot, { source: createManualSource() })).toThrow(
      EngineRestoreError,
    );
    const { engine } = resumeOn(run, v2, migrated);
    expect(engine.getState()).toMatchObject({
      status: 'paused',
      elapsedMs: snapshot.elapsedMs,
      progress: { completed: 1, required: 3, total: 3 },
    });
  });

  it('lets the new stop be visited, and the run needs it to finish', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    run.stay(P2, 6);
    expect(run.engine.getState().progress.completed).toBe(2);

    const v2 = freeRoute({
      points: [place('p1', P1, 1), place('p2', P2, 2), place('p3', P3, 3), place('p4', P4, 4)],
    });
    const { engine, source, stay } = resumeOn(run, v2, migrateSnapshot(run.engine.serialize(), v2));
    expect(engine.resume()).toBe(true);
    expect(source.started).toBe(true);
    stay(P3, 6);
    expect(engine.getState().status).toBe('running');
    stay(P4, 6);
    expect(engine.getState()).toMatchObject({
      status: 'finished',
      progress: { completed: 4, total: 4, percent: 100 },
    });
  });

  it('drops a pending stop and finishes with the ones that are left', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    const v2 = freeRoute({ points: [place('p1', P1, 1), place('p3', P3, 2)] });
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['p1:completed', 'p3:active']);

    const { engine, stay, events } = resumeOn(run, v2, migrated);
    engine.resume();
    stay(P3, 6);
    expect(engine.getState()).toMatchObject({
      status: 'finished',
      progress: { completed: 2, total: 2 },
    });
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(1);
  });

  it('keeps the score a removed stop had earned', () => {
    const v1 = cardRoute([place('p1', P1, 1), place('p2', P2, 2), place('p3', P3, 3)]);
    const run = setup(v1, { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    run.engine.complete('p1', { score: 10 });
    run.stay(P2, 6);
    run.engine.complete('p2', { score: 25 });
    expect(run.engine.getState().progress.score).toBe(35);

    // p1 leaves the route: its 10 points stay.
    const v2 = cardRoute([place('p2', P2, 1), place('p3', P3, 2)]);
    const migrated = migrateSnapshot(json(run.engine.serialize()), v2);
    expect(migrated.carriedScore).toBe(10);
    expect(states(migrated)).toEqual(['p2:completed', 'p3:active']);
    const second = resumeOn(run, v2, migrated);
    expect(second.engine.getState().progress).toMatchObject({ score: 35, completed: 1, total: 2 });

    // A second edit adds to what was carried: the engine writes it down again.
    const v3 = cardRoute([place('p3', P3, 1), place('p4', P4, 2)]);
    const again = migrateSnapshot(json(second.engine.serialize()), v3);
    expect(again.carriedScore).toBe(35);
    expect(states(again)).toEqual(['p3:active', 'p4:active']);

    // Finishing adds the new points on top, and the summary counts all of it.
    const last = resumeOn(run, v2, migrated);
    last.engine.resume();
    last.stay(P3, 6);
    last.engine.complete('p3', { score: 5 });
    expect(last.engine.getState()).toMatchObject({ status: 'finished', progress: { score: 40 } });
    const finished = last.events.find((e) => e.type === 'finished');
    expect(finished?.type === 'finished' && finished.data.summary).toMatchObject({
      completed: 2,
      total: 2,
      score: 40,
    });
  });

  it('writes carriedScore only when there is some', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    expect('carriedScore' in run.engine.serialize()).toBe(false);
    const v2 = freeRoute({ points: [place('p2', P2, 1), place('p3', P3, 2)] });
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect('carriedScore' in migrated).toBe(false);
    // Snapshots saved before the field existed (and ones that say 0) read as 0.
    const legacy = migrateSnapshot({ ...run.engine.serialize(), carriedScore: 0 }, v2);
    expect(resumeOn(run, v2, legacy).engine.getState().progress.score).toBe(0);
  });

  it('forgets a chosen target that is gone, and keeps one that still can be walked to', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.at(ORIGIN);
    expect(run.engine.setTarget('p3')).toBe(true);
    const snapshot = run.engine.serialize();
    expect(snapshot.selectedTargetId).toBe('p3');

    const gone = freeRoute({ points: [place('p1', P1, 1), place('p2', P2, 2)] });
    const withoutIt = migrateSnapshot(snapshot, gone);
    expect(withoutIt.selectedTargetId).toBeNull();
    // Until there is a position, the first stop in order.
    expect(resumeOn(run, gone, withoutIt).engine.getState().target?.pointId).toBe('p1');

    const kept = freeRoute({
      points: [place('p3', P3, 1), place('p1', P1, 2), place('p2', P2, 3)],
    });
    const withIt = migrateSnapshot(snapshot, kept);
    expect(withIt.selectedTargetId).toBe('p3');
    expect(resumeOn(run, kept, withIt).engine.getState().target).toMatchObject({
      pointId: 'p3',
      order: 1,
    });
  });

  it('keeps a chosen target the user has already arrived at', () => {
    const run = setup(cardRoute([place('p1', P1, 1), place('p2', P2, 2), place('p3', P3, 3)]), {
      trusted: true,
    });
    run.engine.start();
    run.at(ORIGIN);
    run.engine.setTarget('p2');
    run.stay(P2, 6);
    expect(run.point('p2')?.state).toBe('reached');
    const v2 = cardRoute([place('p2', P2, 1), place('p3', P3, 2)]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(migrated.selectedTargetId).toBe('p2');
    expect(resumeOn(run, v2, migrated).engine.getState().target?.pointId).toBe('p2');
  });

  it('keeps a stop the user already arrived at, with its card still to close', () => {
    const run = setup(cardRoute([place('p1', P1, 1), place('p2', P2, 2)]), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    expect(run.point('p1')?.state).toBe('reached');

    const v2 = cardRoute([place('p1', P1, 1), place('p2', P2, 2), place('p4', P4, 3)]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['p1:reached', 'p2:active', 'p4:active']);
    const { engine } = resumeOn(run, v2, migrated);
    engine.resume();
    expect(engine.complete('p1', { score: 10 })).toBe(true);
  });

  it('survives a JSON round trip and is idempotent', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    const v2 = freeRoute({ points: [place('p1', P1, 1), place('p4', P4, 2)] });
    const once = migrateSnapshot(json(run.engine.serialize()), v2);
    expect(json(once)).toEqual(once);
    expect(migrateSnapshot(once, v2)).toEqual(once);
  });

  it('shares no object with the snapshot it was given', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    const snapshot = run.engine.serialize();
    const migrated = migrateSnapshot(snapshot, freeRoute());
    expect(migrated).toEqual(snapshot);
    expect(migrated.track).not.toBe(snapshot.track);
    expect(migrated.track[0]).not.toBe(snapshot.track[0]);
    expect(migrated.points[0]).not.toBe(snapshot.points[0]);
    expect(migrated.stats).not.toBe(snapshot.stats);
    expect(migrated.flags).not.toBe(snapshot.flags);
    expect(migrated.startPosition).not.toBe(snapshot.startPosition);
  });

  it('keeps a start position that is not known yet as it is', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    const snapshot = run.engine.serialize();
    expect(snapshot.startPosition).toBeNull();
    expect(migrateSnapshot(snapshot, freeRoute()).startPosition).toBeNull();
  });
});

describe('migrateSnapshot: a challenge', () => {
  /** p1 done, p2 next, p3 behind it. */
  function underWay() {
    const v1 = challenge([place('p1', P1, 1), place('p2', P2, 2), place('p3', P3, 3)]);
    const run = setup(v1, { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    expect(states(run.engine.serialize())).toEqual(['p1:completed', 'p2:active', 'p3:locked']);
    return run;
  }

  it('makes a stop added before the next one the next one', () => {
    const run = underWay();
    const between = east(P1, 200);
    const v2 = challenge([
      place('p1', P1, 1),
      place('d', between, 2),
      place('p2', P2, 3),
      place('p3', P3, 4),
    ]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['p1:completed', 'd:active', 'p2:locked', 'p3:locked']);

    const { engine, stay } = resumeOn(run, v2, migrated);
    engine.resume();
    expect(engine.getState().target?.pointId).toBe('d');
    stay(between, 6);
    expect(states(engine.serialize())).toEqual([
      'p1:completed',
      'd:completed',
      'p2:active',
      'p3:locked',
    ]);
    stay(P2, 6);
    stay(P3, 6);
    expect(engine.getState().status).toBe('finished');
  });

  it('opens the next stop when the one that was next is removed', () => {
    const run = underWay();
    const v2 = challenge([place('p1', P1, 1), place('p3', P3, 2)]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['p1:completed', 'p3:active']);
    const { engine } = resumeOn(run, v2, migrated);
    expect(engine.getState().target).toMatchObject({ pointId: 'p3', order: 2 });
  });

  it('follows a new order', () => {
    const run = underWay();
    const v2 = challenge([place('p1', P1, 1), place('p3', P3, 2), place('p2', P2, 3)]);
    expect(states(migrateSnapshot(run.engine.serialize(), v2))).toEqual([
      'p1:completed',
      'p3:active',
      'p2:locked',
    ]);
  });

  it('keeps a stop added behind the last completed one reachable, so the run can finish', () => {
    const run = underWay();
    run.stay(P2, 6);
    expect(states(run.engine.serialize())).toEqual(['p1:completed', 'p2:completed', 'p3:active']);
    const start = destination(ORIGIN, 270, 150);
    const v2 = challenge([
      place('n0', start, 1),
      place('p1', P1, 2),
      place('p2', P2, 3),
      place('p3', P3, 4),
    ]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['n0:active', 'p1:completed', 'p2:completed', 'p3:locked']);

    const { engine, stay } = resumeOn(run, v2, migrated);
    engine.resume();
    stay(start, 6);
    expect(states(engine.serialize())).toEqual([
      'n0:completed',
      'p1:completed',
      'p2:completed',
      'p3:active',
    ]);
    stay(P3, 6);
    expect(engine.getState().status).toBe('finished');
  });

  it('locks an optional stop added behind the last completed one for good', () => {
    const run = underWay();
    const side = destination(ORIGIN, 270, 150);
    const v2 = challenge([
      place('o0', side, 1, { required: false }),
      place('p1', P1, 2),
      place('p2', P2, 3),
      place('p3', P3, 4),
    ]);
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(states(migrated)).toEqual(['o0:locked', 'p1:completed', 'p2:active', 'p3:locked']);
    const { engine, stay } = resumeOn(run, v2, migrated);
    engine.resume();
    stay(P2, 6);
    stay(P3, 6);
    expect(engine.getState().status).toBe('finished');
  });

  it('keeps a reached stop where it is, and the ones after it closed', () => {
    const v1 = challenge([withCard(place('p1', P1, 1)), withCard(place('p2', P2, 2))], CARD);
    const run = setup(v1, { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    expect(run.point('p1')?.state).toBe('reached');
    const v2 = challenge(
      [withCard(place('p1', P1, 1)), place('x', east(P1, 150), 2), place('p3', P3, 3)],
      CARD,
    );
    expect(states(migrateSnapshot(run.engine.serialize(), v2))).toEqual([
      'p1:reached',
      'x:locked',
      'p3:locked',
    ]);
  });

  it('leaves the stops after a reached optional one open', () => {
    const v1 = challenge(
      [withCard(place('o1', P1, 1, { required: false })), place('p2', P2, 2), place('p3', P3, 3)],
      CARD,
    );
    const run = setup(v1, { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    expect(states(run.engine.serialize())).toEqual(['o1:reached', 'p2:active', 'p3:locked']);
    const v2 = challenge(
      [
        withCard(place('o1', P1, 1, { required: false })),
        place('p2', P2, 2),
        place('p3', P3, 3),
        place('p4', P4, 4),
      ],
      CARD,
    );
    expect(states(migrateSnapshot(run.engine.serialize(), v2))).toEqual([
      'o1:reached',
      'p2:active',
      'p3:locked',
      'p4:locked',
    ]);
  });

  it('never locks anything in a free route that used to be a challenge, and the other way round', () => {
    const run = underWay();
    const points = [place('p1', P1, 1), place('p2', P2, 2), place('p3', P3, 3)];
    const asFree = freeRoute({ id: 'engine-challenge', points });
    expect(states(migrateSnapshot(run.engine.serialize(), asFree))).toEqual([
      'p1:completed',
      'p2:active',
      'p3:active',
    ]);

    const free = setup(freeRoute(), { trusted: true });
    free.engine.start();
    free.stay(P1, 6);
    const asChallenge = challengeRoute({ id: 'engine-free', points });
    expect(states(migrateSnapshot(free.engine.serialize(), asChallenge))).toEqual([
      'p1:completed',
      'p2:active',
      'p3:locked',
    ]);
  });

  it('drops a free-mode target when the route becomes a challenge', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.at(ORIGIN);
    run.engine.setTarget('p3');
    const asChallenge = challengeRoute({ id: 'engine-free' });
    expect(migrateSnapshot(run.engine.serialize(), asChallenge).selectedTargetId).toBeNull();
  });
});

describe('migrateSnapshot: the timeout', () => {
  const noIdle = { idle: { enabled: false } };
  /** A free route with a 10 minute limit that has already been exceeded. */
  function overtime() {
    const run = setup(freeRoute({ settings: { timeLimit: 600, ...noIdle } }), { trusted: true });
    run.engine.start();
    run.stay(ORIGIN, 1);
    run.time.advance(700_000);
    run.stay(ORIGIN, 1);
    expect(run.engine.getState().flags.overtime).toBe(true);
    return run;
  }

  it('stays fired while the limit is still exceeded', () => {
    const run = overtime();
    const snapshot = run.engine.serialize();
    expect(snapshot.timeoutFired).toBe(true);
    const same = freeRoute({ settings: { timeLimit: 600, ...noIdle } });
    expect(migrateSnapshot(snapshot, same)).toMatchObject({
      timeoutFired: true,
      flags: { overtime: true },
    });
  });

  it('is armed again after the limit is raised', () => {
    const run = overtime();
    const v2 = freeRoute({ settings: { timeLimit: 7200, ...noIdle } });
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(migrated).toMatchObject({ timeoutFired: false, flags: { overtime: false } });
    const { engine, events } = resumeOn(run, v2, migrated);
    engine.resume();
    expect(engine.getState().flags.overtime).toBe(false);
    expect(events.some((e) => e.type === 'timeout')).toBe(false);
  });

  it('is cleared when the limit is removed', () => {
    const run = overtime();
    const v2 = freeRoute({ settings: noIdle });
    expect(migrateSnapshot(run.engine.serialize(), v2)).toMatchObject({
      timeoutFired: false,
      flags: { overtime: false },
    });
  });

  it('fires on resume when the limit is lowered under the elapsed time', () => {
    const run = setup(freeRoute({ settings: { timeLimit: 7200, ...noIdle } }), { trusted: true });
    run.engine.start();
    run.stay(ORIGIN, 1);
    run.time.advance(700_000);
    run.stay(ORIGIN, 1);
    const v2 = freeRoute({ settings: { timeLimit: 600, ...noIdle } });
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    expect(migrated.timeoutFired).toBe(false);
    const { engine, events } = resumeOn(run, v2, migrated);
    engine.resume();
    expect(events.filter((e) => e.type === 'timeout')).toHaveLength(1);
  });
});

describe('migrateSnapshot: refusals', () => {
  it('refuses a snapshot of another version', () => {
    const run = setup(freeRoute(), { trusted: true });
    const future = { ...run.engine.serialize(), version: 2 } as unknown as EngineSnapshot;
    expect(() => migrateSnapshot(future, freeRoute())).toThrow(/snapshot version/);
    try {
      migrateSnapshot(future, freeRoute());
    } catch (error) {
      expect((error as EngineRestoreError).code).toBe('UNSUPPORTED_SNAPSHOT');
    }
  });

  it('refuses the snapshot of another route', () => {
    const run = setup(freeRoute(), { trusted: true });
    const snapshot = run.engine.serialize();
    expect(() => migrateSnapshot(snapshot, challengeRoute())).toThrow(EngineRestoreError);
    try {
      migrateSnapshot(snapshot, challengeRoute());
    } catch (error) {
      expect((error as EngineRestoreError).code).toBe('ROUTE_CHANGED');
    }
  });
});

describe('a run with nothing left to visit', () => {
  /** Two of three stops visited and the third still pending; the user deletes the third. */
  function nothingLeft(before: 'running' | 'paused') {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    run.stay(P2, 6);
    if (before === 'paused') run.engine.pause('user');
    const v2 = freeRoute({ points: [place('p1', P1, 1), place('p2', P2, 2)] });
    const migrated = migrateSnapshot(run.engine.serialize(), v2);
    run.engine.destroy();
    return { run, ...resumeOn(run, v2, migrated) };
  }

  it('finishes as soon as it is resumed, with the events of any finish', () => {
    const { engine, source, events, run } = nothingLeft('running');
    expect(engine.getState()).toMatchObject({ status: 'paused', progress: { percent: 100 } });
    expect(source.started).toBe(false);

    expect(engine.resume('route')).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['resumed', 'finished']);
    const finished = events.at(-1);
    expect(finished?.type === 'finished' && finished.data.summary).toMatchObject({
      completed: 2,
      total: 2,
    });
    expect(engine.getState()).toMatchObject({ status: 'finished', endedAt: expect.any(Number) });
    // The GPS never started and nothing is left running.
    expect(source.startCount).toBe(0);
    expect(run.time.timerCount()).toBe(0);
    expect(engine.resume()).toBe(false);
  });

  it('does so from a paused run as well', () => {
    const { engine, events } = nothingLeft('paused');
    expect(engine.getState().status).toBe('paused');
    engine.resume();
    expect(events.some((e) => e.type === 'finished')).toBe(true);
  });

  it('is not what resuming does to a run that still has stops', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.stay(P1, 6);
    run.engine.pause();
    expect(run.engine.resume()).toBe(true);
    expect(run.engine.getState().status).toBe('running');
    expect(run.types().filter((t) => t === 'finished')).toEqual([]);
  });
});

describe('a running snapshot', () => {
  it('comes back paused with its time, track and distance', () => {
    const run = setup(freeRoute(), { trusted: true });
    run.engine.start();
    run.walk(ORIGIN, P1);
    const before = run.engine.getState();
    expect(before.stats.distanceMeters).toBeGreaterThan(0);
    const v2 = freeRoute({ points: [place('p1', P1, 1), place('p4', P4, 2)] });
    const { engine } = resumeOn(run, v2, migrateSnapshot(run.engine.serialize(), v2));
    const after = engine.getState();
    expect(after.status).toBe('paused');
    expect(after.elapsedMs).toBe(before.elapsedMs);
    expect(after.stats.distanceMeters).toBe(before.stats.distanceMeters);
    expect(after.track).toEqual(before.track);
    expect(after.startedAt).toBe(before.startedAt);
  });
});
