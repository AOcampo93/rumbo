import { destination, distance, type LatLng } from '@rumbo/geo-utils';
import { describe, expect, it } from 'vitest';
import { EngineRestoreError, type EngineSnapshot, restoreGeoEngine } from '../src/index.ts';
import {
  createManualSource,
  east,
  freeRoute,
  freeRouteWithCards,
  ORIGIN,
  P1,
  P2,
  setup,
} from './harness.ts';

/** Starts a run, completes P1 with 10 points and returns everything needed to restore it. */
function halfDoneRun() {
  const spec = freeRouteWithCards();
  const run = setup(spec, { trusted: true });
  run.engine.start();
  run.stay(ORIGIN, 2);
  run.stay(P1, 6);
  run.engine.complete('p1', { score: 10 });
  run.stay(P1, 2);
  // Saved as JSON, like IndexedDB would.
  const snapshot = JSON.parse(JSON.stringify(run.engine.serialize())) as EngineSnapshot;
  return { spec, run, snapshot };
}

describe('serialize and restore', () => {
  it('comes back paused, with the same progress, time and track', () => {
    const { spec, run, snapshot } = halfDoneRun();
    const before = run.engine.getState();
    const source = createManualSource(true);
    const restored = restoreGeoEngine(spec, snapshot, {
      source,
      clock: run.time.clock,
      scheduler: run.time.scheduler,
    });
    const after = restored.getState();
    expect(after.status).toBe('paused');
    expect(after.elapsedMs).toBe(before.elapsedMs);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.track).toEqual(before.track);
    expect(after.points.find((p) => p.id === 'p1')).toMatchObject({
      state: 'completed',
      score: 10,
    });
    expect(after.progress.score).toBe(10);
    expect(source.started).toBe(false); // nothing is measured until the user confirms

    const ids = new Set(run.events.map((e) => e.id));
    const later: string[] = [];
    restored.on('*', (event) => later.push(event.id));
    expect(restored.resume()).toBe(true);
    expect(source.started).toBe(true);
    for (let i = 0; i < 6; i++) {
      run.time.advance(1000);
      source.emit({ ...P2, accuracy: 5, timestamp: run.time.clock.now() });
    }
    expect(restored.getState().points.find((p) => p.id === 'p2')?.state).toBe('reached');
    expect(later.some((id) => ids.has(id))).toBe(false);
  });

  it('refuses a snapshot of a route that changed', () => {
    const { snapshot } = halfDoneRun();
    const moved = freeRouteWithCards({
      points: [
        { id: 'p1', name: 'P1', position: east(P1, 30), order: 1, triggers: { onEnter: 'card' } },
      ],
    });
    expect(() => restoreGeoEngine(moved, snapshot, { source: createManualSource() })).toThrow(
      EngineRestoreError,
    );
    try {
      restoreGeoEngine(moved, snapshot, { source: createManualSource() });
    } catch (error) {
      expect((error as EngineRestoreError).code).toBe('ROUTE_CHANGED');
    }
  });

  it('accepts a route whose texts changed', () => {
    const { snapshot } = halfDoneRun();
    const retitled = freeRouteWithCards({ name: { es: 'Otro nombre', en: 'Another name' } });
    expect(() =>
      restoreGeoEngine(retitled, snapshot, { source: createManualSource() }),
    ).not.toThrow();
  });

  it('refuses unknown snapshot versions', () => {
    const { spec, snapshot } = halfDoneRun();
    const future = { ...snapshot, version: 2 } as unknown as EngineSnapshot;
    expect(() => restoreGeoEngine(spec, future, { source: createManualSource() })).toThrow(
      /snapshot version/,
    );
  });

  it('keeps finished and not-yet-started runs as they were', () => {
    const spec = freeRoute();
    const done = setup(spec, { trusted: true });
    done.engine.start();
    done.stay(P1, 6);
    done.stay(P2, 6);
    done.stay(east(P2, 400), 6);
    expect(done.engine.getState().status).toBe('finished');
    const finished = restoreGeoEngine(spec, done.engine.serialize(), {
      source: createManualSource(),
    });
    expect(finished.getState().status).toBe('finished');

    const fresh = setup(spec);
    const ready = restoreGeoEngine(spec, fresh.engine.serialize(), {
      source: createManualSource(),
      clock: fresh.time.clock,
      scheduler: fresh.time.scheduler,
    });
    expect(ready.getState().status).toBe('ready');
    ready.start();
    expect(ready.getState().status).toBe('running');
  });
});

describe('track and stats', () => {
  it('measures distance, moving time and average speed while walking', () => {
    const { engine, walk } = setup(
      freeRoute({ points: [{ id: 'p1', name: 'P1', position: P2, order: 1 }] }),
    );
    engine.start();
    walk(ORIGIN, P1);
    const { stats, track } = engine.getState();
    expect(stats.distanceMeters).toBeGreaterThan(285);
    expect(stats.distanceMeters).toBeLessThanOrEqual(300);
    expect(stats.movingMs).toBeGreaterThan(200_000);
    expect(stats.avgSpeed).toBeCloseTo(1.3, 1);
    for (let i = 1; i < track.length; i++) {
      expect(distance(track[i - 1] as LatLng, track[i] as LatLng)).toBeGreaterThanOrEqual(10);
    }
  });

  it('adds no distance while standing still, but keeps a point every 15 s', () => {
    const { engine, stay } = setup(freeRoute());
    engine.start();
    stay(ORIGIN, 1);
    stay(ORIGIN, 60);
    const { stats, track } = engine.getState();
    expect(stats.distanceMeters).toBe(0);
    expect(stats.avgSpeed).toBeNull();
    expect(track.length).toBe(5); // t = 1, 16, 31, 46, 61 s
  });

  it('leaves out what happens during a pause', () => {
    const { engine, stay, walk } = setup(
      freeRoute({ points: [{ id: 'p1', name: 'P1', position: P2, order: 1 }] }),
    );
    engine.start();
    stay(ORIGIN, 1);
    engine.pause();
    walk(ORIGIN, P1);
    engine.resume();
    stay(P1, 2);
    expect(engine.getState().stats.distanceMeters).toBe(0);
  });

  it('simplifies the track beyond 5 000 points', () => {
    const spec = freeRoute();
    const run = setup(spec, { trusted: true });
    const snapshot = run.engine.serialize();
    const t0 = run.time.clock.now();
    snapshot.track = Array.from({ length: 5_000 }, (_, i) => ({
      ...destination(ORIGIN, 0, i * 11),
      t: t0 + i * 1000,
    }));
    snapshot.status = 'paused';
    const source = createManualSource(true);
    const restored = restoreGeoEngine(spec, snapshot, {
      source,
      clock: run.time.clock,
      scheduler: run.time.scheduler,
    });
    restored.resume();
    const next = destination(ORIGIN, 0, 5_000 * 11 + 20);
    run.time.advance(1000);
    source.emit({ ...next, accuracy: 5, timestamp: run.time.clock.now() });
    const { track } = restored.getState();
    expect(track.length).toBeLessThan(5_000);
    expect(track.at(-1)).toMatchObject(next);
  });
});
