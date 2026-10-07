import { describe, expect, it } from 'vitest';
import {
  challengeRoute,
  east,
  freeRoute,
  freeRouteWithCards,
  north,
  ORIGIN,
  P1,
  P2,
  setup,
} from './harness.ts';

// Trusted sources: these tests jump between places to check route rules,
// which the GPS jump filter would otherwise (rightly) drop.

describe('deviation from the path', () => {
  it('fires after the grace time and clears once back with a margin', () => {
    const { engine, stay, ofType } = setup(challengeRoute(), { trusted: true });
    engine.start();
    stay(ORIGIN, 1);
    const off = north(east(ORIGIN, 150), 200);
    stay(off, 30);
    expect(ofType('deviation')).toEqual([]);
    stay(off, 1);
    const deviation = ofType('deviation');
    expect(deviation).toHaveLength(1);
    expect(deviation[0]?.data.distanceToRoute).toBeCloseTo(200, -1);
    expect(deviation[0]?.data.sinceMs).toBeGreaterThanOrEqual(30_000);
    expect(engine.getState().flags.offRoute).toBe(true);

    stay(north(east(ORIGIN, 150), 130), 5); // closer, but not under 0.8 × 150 m
    expect(ofType('back_on_track')).toEqual([]);
    stay(north(east(ORIGIN, 150), 100), 1);
    expect(ofType('back_on_track').map((e) => e.data)).toEqual([{ distanceToRoute: 100 }]);
    expect(engine.getState().flags.offRoute).toBe(false);
  });

  it('never fires while the user is inside a zone', () => {
    const farPoint = north(P1, 400);
    const spec = freeRoute({
      path: [ORIGIN, P1, P2],
      points: [
        { id: 'far', name: 'Far', position: farPoint, order: 1, triggers: { onEnter: 'card' } },
      ],
      actions: { card: { type: 'info_sheet' } },
    });
    const { engine, stay, ofType } = setup(spec, { trusted: true });
    engine.start();
    stay(farPoint, 60);
    expect(ofType('deviation')).toEqual([]);
  });

  it('uses the corridor to the next checkpoint when there is no path', () => {
    const { engine, stay, ofType } = setup(challengeRoute({ path: undefined }), { trusted: true });
    engine.start();
    stay(ORIGIN, 1); // the corridor starts where the run starts
    stay(north(east(ORIGIN, 150), 200), 31);
    expect(ofType('deviation')).toHaveLength(1);
    stay(north(east(ORIGIN, 150), 50), 1);
    expect(ofType('back_on_track')).toHaveLength(1);

    stay(P1, 6); // next leg: from P1 to P2
    stay(north(east(P1, 200), 60), 40);
    expect(ofType('deviation')).toHaveLength(1);
  });
});

describe('idleness', () => {
  it('fires once per episode outside the zones and re-arms on movement', () => {
    const { engine, stay, ofType } = setup(freeRoute(), { trusted: true });
    engine.start();
    // The first reading (t = 1 s) anchors the user; 600 s later is t = 601 s.
    stay(ORIGIN, 600);
    expect(ofType('idle')).toEqual([]);
    stay(ORIGIN, 1);
    expect(ofType('idle')).toHaveLength(1);
    expect(ofType('idle')[0]?.data.idleSeconds).toBe(600);
    expect(engine.getState().flags.idle).toBe(true);
    stay(ORIGIN, 60);
    expect(ofType('idle')).toHaveLength(1);

    stay(north(ORIGIN, 30), 1); // moved beyond idle.radius (25 m)
    expect(engine.getState().flags.idle).toBe(false);
    stay(north(ORIGIN, 30), 600);
    expect(ofType('idle')).toHaveLength(2);
  });

  it('never fires inside a zone', () => {
    const { engine, stay, ofType } = setup(freeRouteWithCards(), { trusted: true });
    engine.start();
    stay(P1, 700);
    expect(ofType('idle')).toEqual([]);
  });
});

describe('time limit', () => {
  it('fires timeout once without stopping the run', () => {
    const { engine, stay, ofType } = setup(challengeRoute({ settings: { timeLimit: 60 } }), {
      trusted: true,
    });
    engine.start();
    stay(ORIGIN, 59);
    expect(ofType('timeout')).toEqual([]);
    stay(ORIGIN, 1);
    expect(ofType('timeout').map((e) => e.data)).toEqual([{ elapsedMs: 60_000, timeLimit: 60 }]);
    expect(engine.getState()).toMatchObject({ status: 'running', flags: { overtime: true } });
    stay(ORIGIN, 30);
    expect(ofType('timeout')).toHaveLength(1);
    stay(P1, 6);
    expect(engine.getState().points[0]?.state).toBe('completed');
  });
});

describe('pause', () => {
  it('freezes time and arrivals but keeps the map moving, with no instant triggers on resume', () => {
    const { engine, stay, ofType } = setup(freeRoute(), { trusted: true });
    engine.start();
    stay(ORIGIN, 10);
    expect(engine.pause('coffee')).toBe(true);
    expect(engine.pause()).toBe(false);
    expect(ofType('paused')[0]?.data).toEqual({ reason: 'coffee' });

    stay(P1, 20);
    expect(engine.getState()).toMatchObject({ status: 'paused', elapsedMs: 10_000 });
    expect(engine.getState().user?.position).toEqual(P1);
    expect(ofType('enter')).toEqual([]);
    expect(ofType('approach')).toEqual([]);

    expect(engine.resume()).toBe(true);
    expect(engine.resume()).toBe(false);
    expect(ofType('resumed')).toHaveLength(1);
    stay(P1, 5);
    expect(ofType('enter')).toEqual([]);
    stay(P1, 1);
    expect(ofType('enter')).toHaveLength(1);
    expect(engine.getState().elapsedMs).toBe(16_000);
  });

  it('does not count paused time towards the time limit', () => {
    const { engine, stay, time, ofType } = setup(challengeRoute({ settings: { timeLimit: 30 } }), {
      trusted: true,
    });
    engine.start();
    stay(ORIGIN, 20);
    engine.pause();
    time.advance(60_000);
    expect(ofType('timeout')).toEqual([]);
    engine.resume();
    stay(ORIGIN, 10);
    expect(ofType('timeout')).toHaveLength(1);
  });

  it('completes a point while paused (the card was still open)', () => {
    const { engine, stay } = setup(freeRouteWithCards(), { trusted: true });
    engine.start();
    stay(P1, 6);
    engine.pause('menu');
    expect(engine.complete('p1')).toBe(true);
  });
});
