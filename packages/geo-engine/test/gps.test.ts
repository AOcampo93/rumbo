import { describe, expect, it, vi } from 'vitest';
import { createManualSource, east, freeRoute, ORIGIN, P1, setup } from './harness.ts';

describe('accuracy filter', () => {
  it('lets weak readings move the user but never decide zones', () => {
    const { engine, stay, ofType } = setup(freeRoute());
    engine.start();
    stay(P1, 9, 50); // 50 m accuracy > minAccuracy 30
    expect(engine.getState().user?.quality).toBe('weak');
    expect(engine.getState().gps).toBe('waiting');
    expect(ofType('gps_weak')).toEqual([]);
    stay(P1, 3, 50); // 10 s weak: now it counts as a weak GPS
    expect(engine.getState().gps).toBe('weak');
    expect(ofType('gps_weak').map((e) => e.data)).toEqual([{ reason: 'accuracy', accuracy: 50 }]);
    expect(ofType('enter')).toEqual([]);

    stay(P1, 1); // a good reading
    expect(ofType('gps_recovered').map((e) => e.data)).toEqual([{ accuracy: 5 }]);
    expect(engine.getState().gps).toBe('good');
    stay(P1, 5);
    expect(ofType('enter')).toHaveLength(1);
  });

  it('accepts everything from a trusted source', () => {
    const { engine, stay, ofType } = setup(freeRoute(), { trusted: true });
    engine.start();
    stay(P1, 6, 80);
    expect(ofType('enter')).toHaveLength(1);
    expect(engine.getState().user?.quality).toBe('good');
  });
});

describe('jump filter', () => {
  it('ignores an impossible jump', () => {
    const logger = { warn: vi.fn() };
    const { engine, at, time } = setup(freeRoute(), { logger });
    engine.start();
    at(P1);
    time.advance(1000);
    at(east(P1, 5000)); // 5 km in a second
    expect(engine.getState().user?.position).toEqual(P1);
    expect(logger.warn).toHaveBeenCalled();
    time.advance(1000);
    at(east(P1, 2));
    expect(engine.getState().user?.position).toEqual(east(P1, 2));
  });

  it('accepts the new place after three jumps in a row (a bus ride)', () => {
    const { engine, at, time } = setup(freeRoute());
    engine.start();
    at(ORIGIN);
    const far = east(ORIGIN, 3000);
    for (let i = 0; i < 3; i++) {
      time.advance(1000);
      at(far);
    }
    expect(engine.getState().user?.position).toEqual(ORIGIN);
    time.advance(1000);
    at(far);
    expect(engine.getState().user?.position).toEqual(far);
  });

  it('drops duplicated and out-of-order readings, but survives a clock set back', () => {
    const { engine, source, time, events } = setup(freeRoute());
    engine.start();
    const t = time.clock.now();
    source.emit({ ...P1, accuracy: 5, timestamp: t });
    const seen = events.length;
    source.emit({ ...P1, accuracy: 5, timestamp: t }); // duplicate
    source.emit({ ...east(P1, 1), accuracy: 5, timestamp: t - 500 }); // late
    expect(events.length).toBe(seen);
    source.emit({ ...east(P1, 1), accuracy: 5, timestamp: t - 3_600_000 }); // clock set back 1 h
    expect(events.length).toBe(seen + 1);
  });

  it('normalizes unknown heading and speed to null', () => {
    const { engine, source, time } = setup(freeRoute());
    engine.start();
    source.emit({
      ...P1,
      accuracy: 5,
      timestamp: time.clock.now(),
      heading: Number.NaN,
      speed: 1.2,
    });
    expect(engine.getState().user).toMatchObject({ heading: null, speed: 1.2 });
  });
});

describe('signal loss', () => {
  it('reports a lost signal after 30 s without readings, and its recovery', () => {
    const { engine, at, time, ofType } = setup(freeRoute());
    engine.start();
    time.advance(1000);
    at(ORIGIN);
    time.advance(29_000);
    expect(engine.getState().gps).toBe('good');
    time.advance(2000);
    expect(engine.getState().gps).toBe('lost');
    expect(ofType('gps_weak').map((e) => e.data)).toEqual([{ reason: 'stale' }]);
    at(ORIGIN);
    expect(engine.getState().gps).toBe('good');
    expect(ofType('gps_recovered')).toHaveLength(1);
  });

  it('goes from waiting to lost when no reading ever arrives', () => {
    const { engine, time } = setup(freeRoute());
    engine.start();
    time.advance(31_000);
    expect(engine.getState().gps).toBe('lost');
  });

  it('notifies a weak, then lost, signal only once', () => {
    const { engine, stay, time, ofType } = setup(freeRoute());
    engine.start();
    stay(ORIGIN, 12, 60);
    time.advance(31_000);
    expect(engine.getState().gps).toBe('lost');
    expect(ofType('gps_weak')).toHaveLength(1);
    stay(ORIGIN, 1, 60); // a weak reading after a loss: some signal is back
    expect(engine.getState().gps).toBe('weak');
  });
});

describe('source errors', () => {
  it('pauses the run when location permission is denied, and retries on resume', () => {
    const { engine, source, ofType, types } = setup(freeRoute());
    engine.start();
    source.fail({ code: 'PERMISSION_DENIED', message: 'denied' });
    expect(types().slice(-2)).toEqual(['error', 'paused']);
    expect(ofType('paused')[0]?.data).toEqual({ reason: 'permission' });
    expect(engine.getState()).toMatchObject({ status: 'paused', gps: 'denied' });
    expect(source.started).toBe(false);

    expect(engine.resume()).toBe(true);
    expect(source.started).toBe(true);
    expect(source.startCount).toBe(2);
    expect(engine.getState()).toMatchObject({ status: 'running', gps: 'waiting' });
  });

  it('pauses when geolocation is unsupported', () => {
    const { engine, source } = setup(freeRoute());
    engine.start();
    source.fail({ code: 'UNSUPPORTED', message: 'no API' });
    expect(engine.getState()).toMatchObject({ status: 'paused', gps: 'lost' });
  });

  it('only reports passing errors such as a timeout', () => {
    const { engine, source, ofType } = setup(freeRoute());
    engine.start();
    source.fail({ code: 'TIMEOUT', message: 'slow' });
    expect(ofType('error')[0]?.data).toEqual({ code: 'TIMEOUT', message: 'slow' });
    expect(engine.getState().status).toBe('running');
  });

  it('recovers from a denied state when readings come back', () => {
    const { engine, source, at, ofType } = setup(freeRoute());
    engine.start();
    source.fail({ code: 'PERMISSION_DENIED', message: 'denied' });
    engine.resume();
    at(ORIGIN);
    expect(engine.getState().gps).toBe('good');
    expect(ofType('gps_recovered')).toHaveLength(0); // it was "waiting" after resume
  });
});

describe('setSource', () => {
  it('swaps sources on the fly and resets their references', () => {
    const { engine, source, at, time } = setup(freeRoute());
    engine.start();
    at(P1);
    const simulation = createManualSource(true);
    engine.setSource(simulation);
    expect(source.started).toBe(false);
    expect(simulation.started).toBe(true);
    expect(engine.getState().gps).toBe('waiting');
    // Its clock may lag behind the old source's: the reading still counts.
    simulation.emit({ ...ORIGIN, accuracy: 5, timestamp: time.clock.now() - 10_000 });
    expect(engine.getState().user?.position).toEqual(ORIGIN);
  });

  it('does not start a source before the run starts', () => {
    const { engine } = setup(freeRoute());
    const other = createManualSource();
    engine.setSource(other);
    expect(other.started).toBe(false);
  });
});
