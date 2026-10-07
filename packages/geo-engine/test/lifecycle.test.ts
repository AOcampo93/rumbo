import { describe, expect, it, vi } from 'vitest';
import {
  challengeRoute,
  east,
  freeRoute,
  freeRouteWithCards,
  normalize,
  ORIGIN,
  P1,
  P2,
  P3,
  setup,
} from './harness.ts';

describe('lifecycle', () => {
  it('starts running, waiting for GPS, aiming at the first point', () => {
    const { engine, source, types } = setup(freeRoute());
    expect(engine.getState().status).toBe('ready');
    engine.start();
    const state = engine.getState();
    expect(state).toMatchObject({ status: 'running', gps: 'waiting', user: null, elapsedMs: 0 });
    expect(state.target).toMatchObject({
      pointId: 'p1',
      distance: null,
      bearing: null,
      etaSeconds: null,
    });
    expect(source.started).toBe(true);
    expect(types()).toEqual(['started']);
  });

  it('finishes a free route visited in any order', () => {
    const { engine, stay, types, ofType } = setup(freeRoute(), { trusted: true });
    engine.start();
    stay(P3, 6);
    stay(P1, 6);
    stay(P2, 6);
    const state = engine.getState();
    expect(state.status).toBe('finished');
    expect(state.endedAt).not.toBeNull();
    expect(ofType('enter').map((e) => e.pointId)).toEqual(['p3', 'p1', 'p2']);
    expect(ofType('completed').map((e) => e.pointId)).toEqual(['p3', 'p1', 'p2']);
    expect(types().at(-1)).toBe('finished');
    expect(ofType('finished')[0]?.data.summary).toMatchObject({ completed: 3, total: 3, score: 0 });
    expect(state.progress).toMatchObject({ completed: 3, required: 3, total: 3, percent: 100 });
  });

  it('waits for complete() when a point opens a card, and adds its score', () => {
    const { engine, stay, ofType, point } = setup(freeRouteWithCards(), { trusted: true });
    engine.start();
    stay(P1, 6);
    expect(point('p1')?.state).toBe('reached');
    expect(ofType('enter')[0]).toMatchObject({ pointId: 'p1', trigger: 'card' });
    expect(ofType('completed')).toEqual([]);

    expect(engine.complete('p2')).toBe(false); // not reached
    expect(engine.complete('nope')).toBe(false);
    expect(engine.complete('p1', { score: 50, data: { answer: 2 } })).toBe(true);
    expect(engine.complete('p1')).toBe(false); // already done
    expect(ofType('completed')[0]?.data.result).toEqual({ score: 50, data: { answer: 2 } });
    expect(engine.getState().progress.score).toBe(50);
  });

  it('attaches the state after each event and gives every event its own id', () => {
    const { engine, stay, events, ofType } = setup(freeRouteWithCards(), { trusted: true });
    engine.start();
    stay(P1, 6);
    expect(ofType('enter')[0]?.state.points[0]?.state).toBe('reached');
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });
});

describe('challenge order', () => {
  it('opens one point at a time and finishes in order', () => {
    const { engine, stay, point } = setup(challengeRoute(), { trusted: true });
    engine.start();
    expect([point('p1')?.state, point('p2')?.state, point('p3')?.state]).toEqual([
      'active',
      'locked',
      'locked',
    ]);
    stay(P1, 6);
    expect([point('p1')?.state, point('p2')?.state]).toEqual(['completed', 'active']);
    stay(P2, 6);
    stay(P3, 6);
    expect(engine.getState().status).toBe('finished');
  });

  it('reports a point out of order once per stay, without counting it', () => {
    const { engine, stay, ofType, point } = setup(challengeRoute(), { trusted: true });
    engine.start();
    stay(P2, 12);
    expect(ofType('out_of_order').map((e) => e.data)).toEqual([
      { expectedPointId: 'p1', actualPointId: 'p2' },
    ]);
    expect(point('p2')?.state).toBe('locked');
    expect(engine.getState().progress.completed).toBe(0);

    stay(ORIGIN, 2); // leave…
    stay(P2, 6); // …and come back: a new stay, a new warning
    expect(ofType('out_of_order')).toHaveLength(2);
  });

  it('lets optional points be skipped', () => {
    const spec = challengeRoute({
      points: [
        { id: 'p1', name: 'P1', position: P1, order: 1 },
        { id: 'p2', name: 'P2', position: P2, order: 2, required: false },
        { id: 'p3', name: 'P3', position: P3, order: 3 },
      ],
    });
    const { engine, stay, point } = setup(spec, { trusted: true });
    engine.start();
    stay(P1, 6);
    expect([point('p2')?.state, point('p3')?.state]).toEqual(['active', 'active']);
    stay(P3, 6);
    expect(point('p2')?.state).toBe('locked');
    expect(engine.getState().status).toBe('finished');
  });

  it('finishes when every point is done if none is required', () => {
    const spec = freeRoute({
      points: [
        { id: 'p1', name: 'P1', position: P1, order: 1, required: false },
        { id: 'p2', name: 'P2', position: P2, order: 2, required: false },
      ],
    });
    const { engine, stay } = setup(spec, { trusted: true });
    engine.start();
    stay(P1, 6);
    expect(engine.getState().progress).toMatchObject({ required: 2, percent: 50 });
    stay(P2, 6);
    expect(engine.getState().status).toBe('finished');
  });
});

describe('manual check-in', () => {
  it('is allowed in free mode near the point (within 3 radii)', () => {
    const { engine, at, ofType, time } = setup(freeRouteWithCards());
    expect(engine.canManualCheckIn('p1')).toBe(false); // not started
    engine.start();
    at(east(P1, -200));
    expect(engine.canManualCheckIn('p1')).toBe(false); // 200 m > 3 × 40 m
    expect(engine.manualCheckIn('p1')).toBe(false);
    time.advance(20_000); // walk 100 m closer
    at(east(P1, -100));
    expect(engine.canManualCheckIn('p1')).toBe(true);
    expect(engine.manualCheckIn('p1')).toBe(true);
    expect(ofType('enter')[0]?.data).toMatchObject({ manual: true, dwellMs: 0 });
    expect(engine.canManualCheckIn('p1')).toBe(false); // already reached
  });

  it('is off in challenges by default', () => {
    const { engine, at } = setup(challengeRoute());
    engine.start();
    at(east(P1, -10));
    expect(engine.canManualCheckIn('p1')).toBe(false);
  });
});

describe('setTarget', () => {
  it('lets a free route aim at a chosen point, then falls back to the nearest', () => {
    const { engine, at, stay } = setup(freeRoute(), { trusted: true });
    engine.start();
    at(ORIGIN);
    expect(engine.getState().target?.pointId).toBe('p1');
    expect(engine.setTarget('p3')).toBe(true);
    expect(engine.getState().target?.pointId).toBe('p3');
    expect(engine.setTarget('nope')).toBe(false);
    stay(P3, 6); // completing the chosen point clears the choice
    expect(engine.setTarget('p3')).toBe(false);
    expect(engine.getState().target?.pointId).toBe('p2'); // nearest from P3
    expect(engine.setTarget(null)).toBe(true);
  });

  it('is ignored in challenges', () => {
    const { engine } = setup(challengeRoute());
    engine.start();
    expect(engine.setTarget('p3')).toBe(false);
  });
});

describe('cancel and destroy', () => {
  it('cancels with a reason, stops the GPS and ignores later commands', () => {
    const logger = { warn: vi.fn() };
    const spec = normalize({
      specVersion: 1,
      id: 'cancel-test',
      name: 'Cancel',
      locale: 'es',
      mode: 'free',
      source: 'curated',
      points: [{ id: 'p1', name: 'P1', position: P1, order: 1 }],
      actions: { bye: { type: 'toast' } },
      triggers: { onCancel: 'bye' },
    });
    const { engine, source, ofType, time } = setup(spec, { logger });
    engine.start();
    time.advance(5000);
    expect(engine.cancel('tired')).toBe(true);
    expect(ofType('cancelled')[0]).toMatchObject({ trigger: 'bye', data: { reason: 'tired' } });
    expect(engine.getState()).toMatchObject({ status: 'cancelled', elapsedMs: 5000 });
    expect(source.started).toBe(false);
    expect(time.timerCount()).toBe(0);
    expect(engine.cancel()).toBe(false);
    expect(engine.pause()).toBe(false);
    engine.start();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cancels with the default reason "user"', () => {
    const { engine, ofType } = setup(freeRoute());
    engine.start();
    engine.cancel();
    expect(ofType('cancelled')[0]?.data.reason).toBe('user');
  });

  it('stops everything on destroy', () => {
    const { engine, source, time, at, events } = setup(freeRoute());
    const stateListener = vi.fn();
    engine.subscribe(stateListener);
    engine.start();
    engine.destroy();
    engine.destroy(); // twice is fine
    const seen = events.length;
    at(P1);
    time.advance(5000);
    expect(events.length).toBe(seen);
    expect(source.started).toBe(false);
    expect(time.timerCount()).toBe(0);
    expect(engine.pause()).toBe(false);
    expect(engine.resume()).toBe(false);
    expect(engine.complete('p1')).toBe(false);
    expect(engine.setTarget(null)).toBe(false);
    expect(engine.cancel()).toBe(false);
    engine.setSource(source);
    expect(source.started).toBe(false);
  });
});

describe('listeners', () => {
  it('lets a listener complete a point while the arrival is being delivered', () => {
    const { engine, stay, types } = setup(freeRouteWithCards(), { trusted: true });
    engine.on('enter', (event) => {
      if (event.pointId) engine.complete(event.pointId, { score: 10 });
    });
    engine.start();
    stay(P1, 6);
    expect(types()).toEqual(['started', 'enter', 'completed']);
  });

  it('survives listeners that throw, and logs them', () => {
    const logger = { warn: vi.fn() };
    const { engine, stay, ofType } = setup(freeRoute(), { trusted: true, logger });
    engine.on('enter', () => {
      throw new Error('boom');
    });
    engine.subscribe(() => {
      throw new Error('boom');
    });
    engine.start();
    stay(P1, 6);
    expect(ofType('completed')).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('unsubscribes event and state listeners', () => {
    const { engine, stay } = setup(freeRoute(), { trusted: true });
    const onEnter = vi.fn();
    const onState = vi.fn();
    const offEnter = engine.on('enter', onEnter);
    const offState = engine.subscribe(onState);
    offEnter();
    offState();
    engine.start();
    stay(P1, 6);
    expect(onEnter).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
  });
});
