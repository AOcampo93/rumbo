import { describe, expect, it } from 'vitest';
import { east, freeRoute, freeRouteWithCards, ORIGIN, P1, P2, setup } from './harness.ts';

describe('zones', () => {
  // These tests are about zones, so the source is trusted: 10-60 m hops in one
  // second would otherwise be dropped as GPS jumps (gps.test.ts covers that).

  it('ignores noise at the zone edge: no exit flicker, no second arrival', () => {
    // radius 40 m, exit hysteresis 10 m: 35 m is inside, 45 m is in the dead band.
    const { engine, at, time, types } = setup(freeRoute(), { trusted: true });
    engine.start();
    for (let i = 0; i < 20; i++) {
      time.advance(1000);
      at(east(P1, i % 2 === 0 ? -35 : -45));
    }
    expect(types()).toEqual(['started', 'enter', 'completed']);
    time.advance(1000);
    at(east(P1, -60)); // beyond radius + hysteresis
    expect(types().at(-1)).toBe('exit');
  });

  it('needs dwellTime inside the zone, and leaving midway starts over', () => {
    const { engine, stay, ofType } = setup(freeRoute(), { trusted: true });
    engine.start();
    stay(P1, 4);
    expect(engine.getState().target).toMatchObject({ pointId: 'p1', inZone: true });
    expect(engine.getState().target?.dwellProgress).toBeCloseTo(0.6, 5);
    stay(east(P1, -60), 1); // out
    stay(P1, 5);
    expect(ofType('enter')).toEqual([]);
    stay(P1, 1);
    expect(ofType('enter')).toHaveLength(1);
    expect(ofType('enter')[0]?.data).toMatchObject({ manual: false, dwellMs: 5000 });
  });

  it('confirms immediately when dwellTime is 0', () => {
    const { engine, stay, ofType } = setup(freeRoute({ settings: { dwellTime: 0 } }));
    engine.start();
    stay(P1, 1);
    expect(ofType('enter')).toHaveLength(1);
  });

  it('shows full progress while an arrival waits for its card', () => {
    const { engine, stay } = setup(freeRouteWithCards());
    engine.start();
    stay(P1, 6);
    expect(engine.getState().target).toMatchObject({ pointId: 'p1', dwellProgress: 1 });
  });

  it('fires approach once per point, only from outside the zone', () => {
    const { engine, walk, stay, ofType } = setup(freeRouteWithCards());
    engine.start();
    walk(ORIGIN, east(P1, -60));
    const approach = ofType('approach');
    expect(approach).toHaveLength(1);
    expect(approach[0]?.pointId).toBe('p1');
    expect(approach[0]?.data.distance).toBeLessThanOrEqual(100);
    expect(approach[0]?.data.distance).toBeGreaterThan(40);
    walk(east(P1, -60), ORIGIN);
    walk(ORIGIN, east(P1, -60));
    expect(ofType('approach')).toHaveLength(1);
    stay(P2, 1); // no approach when the first reading is already inside
    expect(ofType('approach')).toHaveLength(1);
  });

  it('enters overlapping zones nearest first', () => {
    const a = P1;
    const b = east(P1, 50);
    const spec = freeRoute({
      points: [
        { id: 'far', name: 'B', position: b, order: 1 },
        { id: 'near', name: 'A', position: a, order: 2 },
      ],
    });
    const { engine, stay, ofType } = setup(spec);
    engine.start();
    stay(east(P1, 20), 6); // 20 m from A, 30 m from B
    expect(ofType('enter').map((e) => e.pointId)).toEqual(['near', 'far']);
  });

  it('measures the stay with timestamps when a background tab skips ticks', () => {
    const { engine, at, time, ofType } = setup(freeRoute());
    engine.start();
    time.advance(1000);
    at(P1);
    time.advance(6000, { timers: false }); // throttled: no ticks at all
    at(P1);
    expect(ofType('enter')).toHaveLength(1);
  });

  it('never confirms an arrival with stale data after the screen was locked', () => {
    const { engine, at, stay, time, ofType } = setup(freeRoute());
    engine.start();
    time.advance(1000);
    at(P1);
    time.advance(60_000, { timers: false }); // locked screen: no readings, no ticks
    time.advance(1000); // ticks come back before any reading
    expect(ofType('enter')).toEqual([]);
    expect(engine.getState().gps).toBe('lost');
    stay(P1, 5); // the stay starts over with the fresh readings
    expect(ofType('enter')).toEqual([]);
    stay(P1, 1);
    expect(ofType('enter')).toHaveLength(1);
  });

  it('is immune to the system clock being changed mid-stay', () => {
    const { engine, at, stay, time, ofType } = setup(freeRoute());
    engine.start();
    time.advance(1000);
    at(P1);
    time.jumpWallClock(-3_600_000); // someone sets the clock back an hour
    stay(P1, 5);
    expect(ofType('enter')).toHaveLength(1);
    expect(engine.getState().elapsedMs).toBe(6000);
  });
});
