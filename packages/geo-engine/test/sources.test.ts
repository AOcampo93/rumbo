import { destination, distance } from '@rumbo/geo-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGeolocationSource,
  createReplaySource,
  createSimulatedSource,
  createTrackRecorder,
  type GeolocationLike,
  intervalScheduler,
  type PositionSample,
  type PositionSourceError,
  systemClock,
  WEAK_GPS_ACCURACY_M,
} from '../src/index.ts';
import { createFakeTime, ORIGIN, P1 } from './harness.ts';

function collect() {
  const samples: PositionSample[] = [];
  const errors: PositionSourceError[] = [];
  return {
    samples,
    errors,
    onSample: (s: PositionSample) => samples.push(s),
    onError: (e: PositionSourceError) => errors.push(e),
  };
}

describe('simulated source', () => {
  it('reports where it stands every interval, with strictly increasing timestamps', () => {
    const time = createFakeTime();
    const source = createSimulatedSource({
      start: ORIGIN,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    source.teleport(ORIGIN); // same millisecond as the first reading
    time.advance(3000);
    expect(sink.samples).toHaveLength(5);
    expect(sink.samples[0]).toMatchObject({ ...ORIGIN, accuracy: 5, speed: 0 });
    const stamps = sink.samples.map((s) => s.timestamp);
    expect(stamps.every((t, i) => i === 0 || t > (stamps[i - 1] as number))).toBe(true);
    expect(source.kind).toBe('simulated');
    expect(source.trusted).toBe(true);
  });

  it('walks at the given speed, faster with a time scale, and stops at the target', () => {
    const time = createFakeTime();
    const source = createSimulatedSource({
      start: ORIGIN,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    source.walkTo(P1, 2);
    expect(source.moving).toBe(true);
    time.advance(10_000);
    expect(distance(ORIGIN, source.position!)).toBeCloseTo(20, 3);
    expect(sink.samples.at(-1)).toMatchObject({ speed: 2 });
    expect(sink.samples.at(-1)?.heading).toBeCloseTo(90, 3);

    source.setTimeScale(5);
    time.advance(10_000); // 2 m/s × 5 × 10 s = 100 m more
    expect(distance(ORIGIN, source.position!)).toBeCloseTo(120, 3);
    time.advance(60_000);
    expect(source.position).toEqual(P1);
    expect(source.moving).toBe(false);
  });

  it('follows a path through several points, and pauses on demand', () => {
    const time = createFakeTime();
    const source = createSimulatedSource({ clock: time.clock, scheduler: time.scheduler });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    expect(sink.samples).toHaveLength(0); // no position yet
    source.teleport(ORIGIN);
    const corner = destination(ORIGIN, 0, 10);
    const end = destination(corner, 90, 10);
    source.followPath([corner, end], 5, 1);
    time.advance(3000); // 15 m of the 20: halfway along the second leg
    expect(distance(source.position!, corner)).toBeCloseTo(5, 3);
    time.advance(1000);
    expect(source.position).toEqual(end);
    source.followPath([ORIGIN], 1);
    source.pause();
    time.advance(5000);
    expect(source.position).toEqual(end);
  });

  it('fakes a weak GPS: poor accuracy and untrusted', () => {
    const time = createFakeTime();
    const source = createSimulatedSource({
      start: ORIGIN,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    source.setWeakGps(true);
    time.advance(1000);
    expect(source.trusted).toBe(false);
    expect(sink.samples.at(-1)?.accuracy).toBe(WEAK_GPS_ACCURACY_M);
    source.setWeakGps(false);
    source.setAccuracy(12);
    time.advance(1000);
    expect(source.trusted).toBe(true);
    expect(sink.samples.at(-1)?.accuracy).toBe(12);
  });

  it('stops reporting when stopped', () => {
    const time = createFakeTime();
    const source = createSimulatedSource({
      start: ORIGIN,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    source.stop();
    source.teleport(P1);
    time.advance(5000);
    expect(sink.samples).toHaveLength(1);
    expect(time.timerCount()).toBe(0);
  });
});

describe('replay source', () => {
  const recorded: PositionSample[] = [
    { ...ORIGIN, accuracy: 5, timestamp: 1_000_000 },
    { ...P1, accuracy: 6, timestamp: 1_002_000 },
    { ...P1, accuracy: 6, timestamp: 1_001_000 }, // out of order on purpose
  ];

  it('plays the recording with its rhythm, shifted to now', () => {
    const time = createFakeTime();
    const onEnd = vi.fn();
    const source = createReplaySource(recorded, {
      clock: time.clock,
      scheduler: time.scheduler,
      onEnd,
    });
    const sink = collect();
    const start = time.clock.now();
    source.start(sink.onSample, sink.onError);
    expect(sink.samples.map((s) => s.timestamp)).toEqual([start]);
    time.advance(1000);
    expect(sink.samples).toHaveLength(2);
    time.advance(1000);
    expect(sink.samples.map((s) => s.timestamp - start)).toEqual([0, 1000, 2000]);
    expect(source.done).toBe(true);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(source.trusted).toBe(true);
    source.stop();
    expect(time.timerCount()).toBe(0);
  });

  it('plays faster with a time scale', () => {
    const time = createFakeTime();
    const source = createReplaySource(recorded, {
      clock: time.clock,
      scheduler: time.scheduler,
      timeScale: 2,
    });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    time.advance(1000);
    expect(sink.samples).toHaveLength(3);
  });

  it('is done at once with nothing to play', () => {
    const time = createFakeTime();
    const source = createReplaySource([], { clock: time.clock, scheduler: time.scheduler });
    source.start(
      () => {},
      () => {},
    );
    expect(source.done).toBe(true);
  });
});

describe('track recorder', () => {
  it('records what passes through and exports JSON', () => {
    const time = createFakeTime();
    const inner = createSimulatedSource({
      start: ORIGIN,
      clock: time.clock,
      scheduler: time.scheduler,
    });
    const recorder = createTrackRecorder(inner);
    const sink = collect();
    recorder.start(sink.onSample, sink.onError);
    time.advance(2000);
    expect(recorder.samples()).toEqual(sink.samples);
    expect(JSON.parse(recorder.exportJSON())).toHaveLength(3);
    expect(recorder.trusted).toBe(true);
    expect(recorder.kind).toBe('simulated');
    recorder.stop();
    recorder.clear();
    expect(recorder.samples()).toEqual([]);
  });
});

describe('browser geolocation source', () => {
  function fakeGeolocation() {
    let success: Parameters<GeolocationLike['watchPosition']>[0] | null = null;
    let failure: Parameters<GeolocationLike['watchPosition']>[1] | null = null;
    const geolocation = {
      watchPosition: vi.fn((ok, error) => {
        success = ok;
        failure = error;
        return 7;
      }) as unknown as GeolocationLike['watchPosition'] & ReturnType<typeof vi.fn>,
      clearWatch: vi.fn(),
    };
    return {
      geolocation,
      fix: (lat: number, lng: number) =>
        success?.({
          coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, speed: 1.1 },
          timestamp: 42,
        }),
      fail: (code: number) => failure?.({ code, message: `code ${code}` }),
    };
  }

  it('watches with high accuracy and maps readings', () => {
    const fake = fakeGeolocation();
    const source = createGeolocationSource({ geolocation: fake.geolocation });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    source.start(sink.onSample, sink.onError); // no second watch
    expect(fake.geolocation.watchPosition).toHaveBeenCalledOnce();
    expect(fake.geolocation.watchPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });
    fake.fix(39.74, -8.81);
    expect(sink.samples).toEqual([
      { lat: 39.74, lng: -8.81, accuracy: 8, timestamp: 42, heading: null, speed: 1.1 },
    ]);
    expect(source).toMatchObject({ kind: 'gps', trusted: false });
    source.stop();
    source.stop();
    expect(fake.geolocation.clearWatch).toHaveBeenCalledOnce();
  });

  it('maps browser error codes', () => {
    const fake = fakeGeolocation();
    const source = createGeolocationSource({ geolocation: fake.geolocation });
    const sink = collect();
    source.start(sink.onSample, sink.onError);
    for (const code of [1, 2, 3, 99]) fake.fail(code);
    expect(sink.errors.map((e) => e.code)).toEqual([
      'PERMISSION_DENIED',
      'POSITION_UNAVAILABLE',
      'TIMEOUT',
      'POSITION_UNAVAILABLE',
    ]);
  });

  it('reports UNSUPPORTED without a geolocation API', () => {
    const source = createGeolocationSource();
    const sink = collect();
    source.start(sink.onSample, sink.onError); // Node has no navigator.geolocation
    expect(sink.errors.map((e) => e.code)).toEqual(['UNSUPPORTED']);
    source.stop();
  });
});

describe('real time defaults', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the system clock', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1000);
    expect(systemClock.monotonic()).toBeGreaterThan(0);
  });

  it('schedules with setInterval and cancels', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const cancel = intervalScheduler.every(1000, fn);
    vi.advanceTimersByTime(3000);
    cancel();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
