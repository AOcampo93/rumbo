import { bearing, destination, distance, type LatLng } from '@rumbo/geo-utils';
import { intervalScheduler, systemClock } from '../runtime.ts';
import type { Clock, PositionSample, PositionSource, Scheduler } from '../types.ts';

/** Accuracy reported while faking a weak GPS: worse than any default minAccuracy. */
export const WEAK_GPS_ACCURACY_M = 80;

export interface SimulatedSourceOptions {
  /** Where the simulated user stands until they move. */
  start?: LatLng;
  clock?: Clock;
  scheduler?: Scheduler;
  /** Ms between readings, like a GPS fix rate. Default 1000. */
  intervalMs?: number;
  /** Accuracy reported while the GPS is good, in metres. Default 5. */
  accuracy?: number;
}

/**
 * Fake GPS for the demo mode, the route creator's "Try route" and the tests
 * (docs/PROJECT_PLAN.md §10.7). It reports a reading every interval, moving
 * along any pending waypoints at `speed × timeScale`.
 */
export interface SimulatedSource extends PositionSource {
  readonly kind: 'simulated';
  readonly position: LatLng | null;
  readonly moving: boolean;
  /** Jumps to a point (e.g. where the map was tapped) and reports it at once. */
  teleport(to: LatLng): void;
  /** Walks in a straight line at `speed` m/s (default 1.3). */
  walkTo(to: LatLng, speed?: number): void;
  /** Walks through every point in order. */
  followPath(points: readonly LatLng[], speed?: number, timeScale?: number): void;
  /** Speeds the walk up (1×, 5×, 20×). Arrival confirmation still takes real time. */
  setTimeScale(timeScale: number): void;
  setAccuracy(meters: number): void;
  /**
   * Fakes a weak GPS: readings report 80 m accuracy and the source turns
   * untrusted, so the engine applies its real filters.
   */
  setWeakGps(weak: boolean): void;
  /** Stops walking; readings keep coming from where the user stands. */
  pause(): void;
}

export function createSimulatedSource(options: SimulatedSourceOptions = {}): SimulatedSource {
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? intervalScheduler;
  const intervalMs = options.intervalMs ?? 1000;
  let accuracy = options.accuracy ?? 5;
  let weak = false;
  let position: LatLng | null = options.start ?? null;
  let waypoints: LatLng[] = [];
  let speed = 1.3;
  let timeScale = 1;
  let heading: number | null = null;
  let onSample: ((sample: PositionSample) => void) | null = null;
  let cancel: (() => void) | null = null;
  let lastTimestamp = 0;

  function report(): void {
    if (!onSample || !position) return;
    // Strictly increasing, even if two readings fall in the same millisecond.
    const timestamp = Math.max(clock.now(), lastTimestamp + 1);
    lastTimestamp = timestamp;
    onSample({
      lat: position.lat,
      lng: position.lng,
      accuracy: weak ? WEAK_GPS_ACCURACY_M : accuracy,
      timestamp,
      heading,
      speed: waypoints.length > 0 ? speed * timeScale : 0,
    });
  }

  function step(): void {
    let budget = speed * timeScale * (intervalMs / 1000);
    while (position && budget > 0 && waypoints.length > 0) {
      const next = waypoints[0] as LatLng;
      const remaining = distance(position, next);
      if (remaining > 0) heading = bearing(position, next);
      // Snap within a micrometre: rounding must not cost an extra tick to arrive.
      if (remaining <= budget + 1e-6) {
        position = next;
        budget -= remaining;
        waypoints.shift();
      } else {
        position = destination(position, heading ?? 0, budget);
        budget = 0;
      }
    }
    report();
  }

  const source: SimulatedSource = {
    kind: 'simulated',
    get trusted() {
      return !weak;
    },
    get position() {
      return position;
    },
    get moving() {
      return waypoints.length > 0;
    },
    start(sample) {
      onSample = sample;
      cancel ??= scheduler.every(intervalMs, step);
      report();
    },
    stop() {
      cancel?.();
      cancel = null;
      onSample = null;
    },
    teleport(to) {
      position = to;
      waypoints = [];
      heading = null;
      report();
    },
    walkTo(to, walkSpeed) {
      source.followPath([to], walkSpeed);
    },
    followPath(points, walkSpeed = 1.3, scale) {
      waypoints = [...points];
      speed = walkSpeed;
      if (scale !== undefined) timeScale = scale;
    },
    setTimeScale(scale) {
      timeScale = scale;
    },
    setAccuracy(meters) {
      accuracy = meters;
    },
    setWeakGps(on) {
      weak = on;
    },
    pause() {
      waypoints = [];
    },
  };
  return source;
}
