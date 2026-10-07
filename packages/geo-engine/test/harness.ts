import { bearing, destination, distance, type LatLng } from '@rumbo/geo-utils';
import {
  type NormalizedRouteSpec,
  type RouteSpecInput,
  validateRouteSpec,
} from '@rumbo/route-spec';
import {
  type AnyEngineEvent,
  type Clock,
  createGeoEngine,
  type EngineEventType,
  type GeoEngine,
  type Logger,
  type PositionSample,
  type PositionSource,
  type PositionSourceError,
  type Scheduler,
} from '../src/index.ts';

/**
 * Deterministic time. advance() moves both clocks and runs due timers in
 * order; with `timers: false` it skips them, like a throttled background tab.
 */
export function createFakeTime(startEpoch = Date.UTC(2026, 9, 7, 9, 0, 0)) {
  let epoch = startEpoch;
  let mono = 0;
  interface Timer {
    every: number;
    next: number;
    fn: () => void;
  }
  const timers = new Set<Timer>();
  const clock: Clock = { now: () => epoch, monotonic: () => mono };
  const scheduler: Scheduler = {
    every(ms, fn) {
      const timer = { every: ms, next: mono + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  function advance(ms: number, options: { timers?: boolean } = {}): void {
    const end = mono + ms;
    if (options.timers === false) {
      for (const timer of timers) while (timer.next <= end) timer.next += timer.every;
    }
    for (;;) {
      let due: Timer | null = null;
      for (const timer of timers)
        if (timer.next <= end && (!due || timer.next < due.next)) due = timer;
      if (!due) break;
      epoch += due.next - mono;
      mono = due.next;
      due.next += due.every;
      due.fn();
    }
    epoch += end - mono;
    mono = end;
  }
  return {
    clock,
    scheduler,
    advance,
    /** The system clock jumps (e.g. a manual time change); monotonic time doesn't. */
    jumpWallClock: (ms: number) => {
      epoch += ms;
    },
    timerCount: () => timers.size,
  };
}

export type FakeTime = ReturnType<typeof createFakeTime>;

/** A source the test drives reading by reading. */
export interface ManualSource extends PositionSource {
  readonly started: boolean;
  readonly startCount: number;
  emit(sample: PositionSample): void;
  fail(error: PositionSourceError): void;
}

export function createManualSource(trusted = false): ManualSource {
  let onSample: ((sample: PositionSample) => void) | null = null;
  let onError: ((error: PositionSourceError) => void) | null = null;
  let started = false;
  let startCount = 0;
  return {
    kind: 'gps',
    trusted,
    get started() {
      return started;
    },
    get startCount() {
      return startCount;
    },
    start(sample, error) {
      onSample = sample;
      onError = error;
      started = true;
      startCount += 1;
    },
    stop() {
      started = false;
    },
    emit(sample) {
      if (started) onSample?.(sample);
    },
    fail(error) {
      onError?.(error);
    },
  };
}

/** Somewhere in Leiria; the test points line up east of it. */
export const ORIGIN: LatLng = { lat: 39.74, lng: -8.81 };
export const P1 = destination(ORIGIN, 90, 300);
export const P2 = destination(ORIGIN, 90, 700);
export const P3 = destination(ORIGIN, 90, 1100);

/** `meters` north (positive) or south (negative) of a point. */
export const north = (p: LatLng, meters: number): LatLng =>
  destination(p, meters >= 0 ? 0 : 180, Math.abs(meters));
/** `meters` east (positive) or west (negative) of a point. */
export const east = (p: LatLng, meters: number): LatLng =>
  destination(p, meters >= 0 ? 90 : 270, Math.abs(meters));

export function normalize(input: RouteSpecInput): NormalizedRouteSpec {
  const result = validateRouteSpec(input);
  if (!result.spec) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

/** Three points 400 m apart, no actions: arrivals complete on their own. */
export function freeRoute(overrides: Partial<RouteSpecInput> = {}): NormalizedRouteSpec {
  return normalize({
    specVersion: 1,
    id: 'engine-free',
    name: 'Free',
    locale: 'es',
    mode: 'free',
    source: 'curated',
    points: [
      { id: 'p1', name: 'P1', position: P1, order: 1 },
      { id: 'p2', name: 'P2', position: P2, order: 2 },
      { id: 'p3', name: 'P3', position: P3, order: 3 },
    ],
    actions: {},
    ...overrides,
  });
}

/** The same points as a challenge, with a straight path from the origin through them. */
export function challengeRoute(overrides: Partial<RouteSpecInput> = {}): NormalizedRouteSpec {
  return freeRoute({
    id: 'engine-challenge',
    mode: 'challenge',
    path: [ORIGIN, P1, P2, P3],
    ...overrides,
  });
}

/** Free route whose points open a card on arrival, so the test completes them. */
export function freeRouteWithCards(overrides: Partial<RouteSpecInput> = {}): NormalizedRouteSpec {
  return freeRoute({
    points: [
      { id: 'p1', name: 'P1', position: P1, order: 1, triggers: { onEnter: 'card' } },
      { id: 'p2', name: 'P2', position: P2, order: 2, triggers: { onEnter: 'card' } },
      { id: 'p3', name: 'P3', position: P3, order: 3, triggers: { onEnter: 'card' } },
    ],
    actions: { card: { type: 'info_sheet' } },
    ...overrides,
  });
}

export interface SetupOptions {
  trusted?: boolean;
  logger?: Logger;
}

export function setup(spec: NormalizedRouteSpec, options: SetupOptions = {}) {
  const time = createFakeTime();
  const source = createManualSource(options.trusted ?? false);
  const engine: GeoEngine = createGeoEngine(spec, {
    source,
    clock: time.clock,
    scheduler: time.scheduler,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const events: AnyEngineEvent[] = [];
  engine.on('*', (event) => events.push(event));

  /** One reading at `position`, stamped now. */
  const at = (position: LatLng, accuracy = 5) =>
    source.emit({ ...position, accuracy, timestamp: time.clock.now() });

  /** Stays put for `seconds`, one reading per second. */
  const stay = (position: LatLng, seconds: number, accuracy = 5) => {
    for (let i = 0; i < seconds; i++) {
      time.advance(1000);
      at(position, accuracy);
    }
  };

  /** Walks in a straight line at `speed` m/s, one reading per second. */
  const walk = (from: LatLng, to: LatLng, speed = 1.3) => {
    const total = distance(from, to);
    const heading = bearing(from, to);
    for (let walked = speed; walked < total + speed; walked += speed) {
      time.advance(1000);
      at(destination(from, heading, Math.min(walked, total)));
    }
  };

  /** Event types in order, without the noisy position updates. */
  const types = () => events.filter((e) => e.type !== 'position').map((e) => e.type);
  const ofType = <T extends EngineEventType>(type: T) =>
    events.filter((e): e is Extract<AnyEngineEvent, { type: T }> => e.type === type);
  const point = (id: string) => engine.getState().points.find((p) => p.id === id);

  return { time, source, engine, events, at, stay, walk, types, ofType, point };
}
