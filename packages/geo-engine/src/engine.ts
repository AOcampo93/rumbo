import {
  bearing,
  distance,
  distanceToPolyline,
  distanceToSegment,
  type LatLng,
  simplify,
} from '@rumbo/geo-utils';
import {
  hashRouteSpec,
  type NormalizedRoutePoint,
  type NormalizedRouteSpec,
} from '@rumbo/route-spec';
import { intervalScheduler, systemClock } from './runtime.ts';
import type {
  AnyEngineEvent,
  Clock,
  CompletionResult,
  EngineEvent,
  EngineEventType,
  EngineSnapshot,
  EngineState,
  EngineStatus,
  EventDataMap,
  GpsState,
  Logger,
  PointState,
  PositionSample,
  PositionSource,
  PositionSourceError,
  Scheduler,
  TrackPoint,
} from './types.ts';

/** Fixed rules of docs/PROJECT_PLAN.md §8.4 and §8.8, in one place. */
export const ENGINE_LIMITS = {
  /** A weak GPS for this long fires gps_weak (reason: accuracy). */
  weakGpsMs: 10_000,
  /** No readings for this long while running: gps 'lost' and gps_weak (reason: stale). */
  staleGpsMs: 30_000,
  /** Ticks only confirm arrivals or deviations with a good reading at most this old. */
  freshSampleMs: 10_000,
  /** After this many rejected jumps in a row, the next reading is the new truth (a bus ride). */
  maxConsecutiveJumps: 3,
  /**
   * A reading this much older than the last one means the device clock was
   * set back; smaller steps back are just late or duplicated readings.
   */
  clockSetBackMs: 60_000,
  /** Back on track once below this fraction of deviation.maxDistance. */
  backOnTrackRatio: 0.8,
  trackMinDistanceM: 10,
  trackMinIntervalMs: 15_000,
  trackMaxPoints: 5_000,
  trackSimplifyToleranceM: 5,
  /** Slower stretches (m/s) don't count as moving time. */
  movingSpeed: 0.5,
  /** Below this average speed (m/s) ETAs use the activity's expected speed. */
  minEtaSpeed: 0.3,
  /** Manual check-in needs the last position within this many radii of the point. */
  manualCheckInRadii: 3,
} as const;

export interface EngineOptions {
  source: PositionSource;
  clock?: Clock;
  scheduler?: Scheduler;
  /** Periodic evaluation (dwell, idleness, time) even without new readings. */
  tickMs?: number;
  logger?: Logger;
}

type Listener<T extends EngineEventType> = (event: EngineEvent<T>) => void;

export interface GeoEngine {
  start(): void;
  pause(reason?: string): boolean;
  resume(reason?: string): boolean;
  cancel(reason?: string): boolean;
  /** Marks a reached point as done. False if the point isn't reached. */
  complete(pointId: string, result?: CompletionResult): boolean;
  /** Whether the "I'm here" button may show for this point right now. */
  canManualCheckIn(pointId: string): boolean;
  /** Arrival without GPS confirmation (e.g. inside a museum). */
  manualCheckIn(pointId: string): boolean;
  /** Free mode only: the point the HUD should guide to; null for the nearest. */
  setTarget(pointId: string | null): boolean;
  /** Swaps the position source on the fly (GPS ↔ simulation). */
  setSource(source: PositionSource): void;
  getState(): EngineState;
  serialize(): EngineSnapshot;
  on<T extends EngineEventType>(type: T, listener: Listener<T>): () => void;
  on(type: '*', listener: (event: AnyEngineEvent) => void): () => void;
  subscribe(listener: (state: EngineState) => void): () => void;
  destroy(): void;
}

export class EngineRestoreError extends Error {
  readonly code: 'ROUTE_CHANGED' | 'UNSUPPORTED_SNAPSHOT';

  constructor(code: 'ROUTE_CHANGED' | 'UNSUPPORTED_SNAPSHOT', message: string) {
    super(message);
    this.name = 'EngineRestoreError';
    this.code = code;
  }
}

interface PointRuntime {
  readonly def: NormalizedRoutePoint;
  state: PointState;
  reachedAt: number | null;
  completedAt: number | null;
  score: number;
  /** approach fires once per point. */
  approached: boolean;
  /** Inside the zone, with exit hysteresis. */
  inZone: boolean;
  /** Monotonic ms when the current stay started. */
  dwellStart: number | null;
  /** enter fired during this stay, so leaving fires exit. */
  entered: boolean;
  /** out_of_order fired during this stay. */
  outOfOrderNotified: boolean;
  /** From the latest good reading. */
  distance: number | null;
}

interface AcceptedSample {
  sample: PositionSample;
  /** Monotonic ms when it arrived. */
  at: number;
  quality: 'good' | 'weak';
}

/** Creates an engine for a normalized (validated) route. */
export function createGeoEngine(spec: NormalizedRouteSpec, options: EngineOptions): GeoEngine {
  return createEngine(spec, options, null);
}

/**
 * Rebuilds an engine from a snapshot. It always comes back paused, so the user
 * confirms before anything is measured again. Throws EngineRestoreError when
 * the route changed since the snapshot (different hash).
 */
export function restoreGeoEngine(
  spec: NormalizedRouteSpec,
  snapshot: EngineSnapshot,
  options: EngineOptions,
): GeoEngine {
  if (snapshot.version !== 1) {
    throw new EngineRestoreError(
      'UNSUPPORTED_SNAPSHOT',
      `Unknown snapshot version ${String(snapshot.version)}`,
    );
  }
  if (hashRouteSpec(spec) !== snapshot.specHash) {
    throw new EngineRestoreError('ROUTE_CHANGED', 'The route changed since this run was saved');
  }
  return createEngine(spec, options, snapshot);
}

function createEngine(
  spec: NormalizedRouteSpec,
  options: EngineOptions,
  snapshot: EngineSnapshot | null,
): GeoEngine {
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? intervalScheduler;
  const tickMs = options.tickMs ?? 1000;
  const logger = options.logger;
  const settings = spec.settings;
  const specHash = hashRouteSpec(spec);
  const isChallenge = spec.mode === 'challenge';

  const points: PointRuntime[] = spec.points.map((def) => ({
    def,
    state: isChallenge ? 'locked' : 'active',
    reachedAt: null,
    completedAt: null,
    score: 0,
    approached: false,
    inZone: false,
    dwellStart: null,
    entered: false,
    outOfOrderNotified: false,
    distance: null,
  }));
  const byId = new Map(points.map((p) => [p.def.id, p]));
  // The run ends when every required point is done; with none required, all of them.
  const finishSet = points.some((p) => p.def.required)
    ? points.filter((p) => p.def.required)
    : points;

  let source = options.source;
  let status: EngineStatus = 'ready';
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let accumulatedMs = 0;
  let runningSince: number | null = null;

  let gps: GpsState = 'waiting';
  let lastSample: AcceptedSample | null = null;
  let lastGood: AcceptedSample | null = null;
  let lastTimestamp: number | null = null;
  let jumpReference: PositionSample | null = null;
  let consecutiveJumps = 0;
  let silenceSince = 0;
  let weakSince: number | null = null;
  let degradedNotified = false;

  let startPosition: LatLng | null = null;
  let selectedTargetId: string | null = null;
  const flags = { offRoute: false, idle: false, overtime: false };
  let timeoutFired = false;
  let offRouteSince: number | null = null;
  let routeDistance: number | null = null;
  let idleAnchor: { position: LatLng; since: number } | null = null;
  let idleFired = false;

  let track: TrackPoint[] = [];
  let lastTrackAt: number | null = null;
  let distanceMeters = 0;
  let movingMs = 0;
  let statsAnchor: { position: LatLng; timestamp: number } | null = null;

  let eventSeq = 0;
  let sourceRunning = false;
  let cancelTicks: (() => void) | null = null;
  let destroyed = false;
  const eventListeners = new Map<string, Set<(event: AnyEngineEvent) => void>>();
  const stateListeners = new Set<(state: EngineState) => void>();
  const queue: AnyEngineEvent[] = [];
  let delivering = false;

  if (snapshot) applySnapshot(snapshot);
  else if (isChallenge) refreshChallengeWindow();
  // Built once every helper below exists (see the end of this function).
  let state: EngineState;

  // ---------------------------------------------------------------- time

  const now = () => clock.monotonic();
  const elapsed = () => accumulatedMs + (runningSince === null ? 0 : now() - runningSince);
  const anyInZone = () => points.some((p) => p.inZone);
  const isFresh = (sample: AcceptedSample | null, maxAge: number): sample is AcceptedSample =>
    sample !== null && now() - sample.at <= maxAge;

  // -------------------------------------------------------------- events

  function emit<T extends EngineEventType>(
    type: T,
    data: EventDataMap[T],
    extra: { trigger?: string | null | undefined; pointId?: string } = {},
  ): void {
    eventSeq += 1;
    queue.push({
      id: `${startedAt ?? 0}-${eventSeq}`,
      type,
      trigger: extra.trigger ?? null,
      pointId: extra.pointId ?? null,
      timestamp: clock.now(),
      data,
      state: buildState(),
    } as AnyEngineEvent);
  }

  /**
   * Delivers queued events, then publishes the state. Listeners may call
   * back into the engine (e.g. complete() on enter): their events join the
   * queue and are delivered here, so evaluation never runs reentrantly.
   */
  function settle(): void {
    if (delivering) return;
    delivering = true;
    try {
      let event = queue.shift();
      while (event && !destroyed) {
        for (const key of [event.type, '*']) {
          for (const listener of eventListeners.get(key) ?? []) {
            try {
              listener(event);
            } catch (error) {
              logger?.warn(`geo-engine: a "${key}" listener threw`, error);
            }
          }
        }
        event = queue.shift();
      }
    } finally {
      delivering = false;
    }
    if (destroyed) return;
    state = buildState();
    for (const listener of stateListeners) {
      try {
        listener(state);
      } catch (error) {
        logger?.warn('geo-engine: a state listener threw', error);
      }
    }
  }

  // -------------------------------------------------------------- source

  function startSource(): void {
    if (sourceRunning) return;
    sourceRunning = true;
    source.start(onSample, onError);
  }

  function stopSource(): void {
    if (!sourceRunning) return;
    sourceRunning = false;
    source.stop();
  }

  function startTicks(): void {
    cancelTicks ??= scheduler.every(tickMs, tick);
  }

  function stopTicks(): void {
    cancelTicks?.();
    cancelTicks = null;
  }

  /** Implied speed above the activity's maximum: a GPS jump, not a walk. */
  function isJump(reference: PositionSample, sample: PositionSample): boolean {
    const seconds = (sample.timestamp - reference.timestamp) / 1000;
    return seconds > 0 && distance(reference, sample) / seconds > settings.maxSpeed;
  }

  function onSample(sample: PositionSample): void {
    if (destroyed || (status !== 'running' && status !== 'paused')) return;
    // Duplicated or out-of-order readings never count. A big step back is a
    // clock change instead: accept it, or every reading would be dropped for that long.
    if (
      lastTimestamp !== null &&
      sample.timestamp <= lastTimestamp &&
      lastTimestamp - sample.timestamp < ENGINE_LIMITS.clockSetBackMs
    ) {
      return;
    }

    const trusted = source.trusted;
    if (!trusted && jumpReference && isJump(jumpReference, sample)) {
      consecutiveJumps += 1;
      if (consecutiveJumps <= ENGINE_LIMITS.maxConsecutiveJumps) {
        logger?.warn('geo-engine: ignored a GPS jump', { accuracy: sample.accuracy });
        return;
      }
    }
    consecutiveJumps = 0;

    const quality = trusted || sample.accuracy <= settings.minAccuracy ? 'good' : 'weak';
    const accepted: AcceptedSample = { sample: normalizeSample(sample), at: now(), quality };
    lastTimestamp = sample.timestamp;
    lastSample = accepted;
    emit('position', { sample: accepted.sample });

    if (quality === 'good') {
      lastGood = accepted;
      jumpReference = accepted.sample;
      weakSince = null;
      degradedNotified = false;
      if (gps === 'weak' || gps === 'lost' || gps === 'denied') {
        gps = 'good';
        emit('gps_recovered', { accuracy: sample.accuracy });
      } else {
        gps = 'good';
      }
    } else {
      weakSince ??= accepted.at;
      if (gps === 'lost') gps = 'weak';
    }

    if (status === 'running') {
      if (quality === 'good') {
        const position = { lat: sample.lat, lng: sample.lng };
        startPosition ??= position;
        record(position, sample.timestamp, accepted.at);
        updateZones(position, accepted.at);
        checkApproach();
        checkDwell();
        checkDeviation(position);
        checkIdle(position);
      } else {
        checkWeak();
      }
      checkTime();
    }
    settle();
  }

  function onError(error: PositionSourceError): void {
    if (destroyed) return;
    emit('error', { code: error.code, message: error.message });
    if (error.code === 'PERMISSION_DENIED' || error.code === 'UNSUPPORTED') {
      gps = error.code === 'PERMISSION_DENIED' ? 'denied' : 'lost';
      stopSource();
      if (status === 'running')
        pauseNow(error.code === 'PERMISSION_DENIED' ? 'permission' : 'unsupported');
    }
    settle();
  }

  // ---------------------------------------------------------- evaluation

  function record(position: LatLng, timestamp: number, at: number): void {
    // Distance grows in ≥10 m steps, so GPS jitter while standing still adds nothing.
    if (!statsAnchor) {
      statsAnchor = { position, timestamp };
    } else {
      const step = distance(statsAnchor.position, position);
      if (step >= ENGINE_LIMITS.trackMinDistanceM) {
        const ms = timestamp - statsAnchor.timestamp;
        distanceMeters += step;
        if (ms > 0 && step / (ms / 1000) >= ENGINE_LIMITS.movingSpeed) movingMs += ms;
        statsAnchor = { position, timestamp };
      }
    }

    const last = track.at(-1);
    const due =
      !last ||
      lastTrackAt === null ||
      distance(last, position) >= ENGINE_LIMITS.trackMinDistanceM ||
      at - lastTrackAt >= ENGINE_LIMITS.trackMinIntervalMs;
    if (!due) return;
    let next = [...track, { ...position, t: clock.now() }];
    if (next.length > ENGINE_LIMITS.trackMaxPoints) {
      next = simplify(next, ENGINE_LIMITS.trackSimplifyToleranceM);
    }
    track = next;
    lastTrackAt = at;
  }

  /** Points whose zone can start a stay: reachable ones, plus locked ones in a challenge (out of order). */
  const watchesStay = (p: PointRuntime) =>
    p.state === 'active' || (isChallenge && p.state === 'locked');

  function updateZones(position: LatLng, at: number): void {
    for (const p of points) {
      const d = distance(position, p.def.position);
      p.distance = d;
      if (d <= p.def.radius) {
        p.inZone = true;
      } else if (d > p.def.radius + settings.exitHysteresis) {
        if (p.inZone) {
          p.inZone = false;
          p.dwellStart = null;
          p.outOfOrderNotified = false;
          if (p.entered) {
            p.entered = false;
            emit('exit', { distance: d }, { trigger: p.def.triggers.onExit, pointId: p.def.id });
          }
        }
      }
      // Between radius and radius + hysteresis the previous state holds: no flicker.
      if (p.inZone && p.dwellStart === null && !p.entered && watchesStay(p)) p.dwellStart = at;
    }
  }

  function checkApproach(): void {
    if (settings.approachDistance <= 0) return;
    for (const p of byDistance(points)) {
      if (p.state !== 'active' || p.approached || p.distance === null) continue;
      // "Near" means outside the zone (hysteresis included): inside, the arrival takes over.
      if (p.distance <= settings.approachDistance && !p.inZone) {
        p.approached = true;
        emit(
          'approach',
          { distance: p.distance },
          { trigger: p.def.triggers.onApproach, pointId: p.def.id },
        );
      }
    }
  }

  /**
   * Confirms stays that lasted dwellTime. Durations come from timestamps, not
   * from counting ticks, so throttled background timers can't skew them; and a
   * stay is only confirmed with a recent good reading, never with stale data.
   */
  function checkDwell(): void {
    if (!isFresh(lastGood, ENGINE_LIMITS.freshSampleMs)) return;
    const at = now();
    const needed = settings.dwellTime * 1000;
    // With overlapping zones the closest point goes first.
    for (const p of byDistance(points)) {
      if (p.dwellStart === null || !p.inZone) continue;
      const dwellMs = at - p.dwellStart;
      if (dwellMs < needed) continue;
      p.dwellStart = null;
      if (p.state === 'active') {
        arrive(p, {
          distance: p.distance ?? 0,
          accuracy: lastGood.sample.accuracy,
          dwellMs,
          manual: false,
        });
      } else if (isChallenge && p.state === 'locked' && !p.outOfOrderNotified) {
        p.outOfOrderNotified = true;
        emit(
          'out_of_order',
          { expectedPointId: currentTarget()?.def.id ?? '', actualPointId: p.def.id },
          { trigger: spec.triggers.onOutOfOrder, pointId: p.def.id },
        );
      }
    }
  }

  function arrive(p: PointRuntime, data: EventDataMap['enter']): void {
    p.state = 'reached';
    p.reachedAt = clock.now();
    p.entered = true;
    p.dwellStart = null;
    if (isChallenge) refreshChallengeWindow();
    emit('enter', data, { trigger: p.def.triggers.onEnter, pointId: p.def.id });
    if (!p.def.triggers.onEnter && settings.autoCompleteWithoutAction) completePoint(p, {});
  }

  function completePoint(p: PointRuntime, result: CompletionResult): void {
    p.state = 'completed';
    p.completedAt = clock.now();
    p.score = result.score ?? 0;
    if (selectedTargetId === p.def.id) selectedTargetId = null;
    offRouteSince = null; // a new leg starts
    emit('completed', { result }, { pointId: p.def.id });
    if (isChallenge) refreshChallengeWindow();
    if (finishSet.every((q) => q.state === 'completed')) finish();
  }

  /**
   * Challenge order: the next unfinished point is reachable, plus any optional
   * points before the next required one. Optional points left behind lock.
   */
  function refreshChallengeWindow(): void {
    const lastDoneOrder = Math.max(
      0,
      ...points.filter((p) => p.state === 'completed').map((p) => p.def.order),
    );
    let open = true;
    for (const p of points) {
      if (p.state === 'completed') continue;
      if (p.state === 'reached') {
        if (p.def.required) open = false;
        continue;
      }
      if (p.def.order < lastDoneOrder) {
        p.state = 'locked';
        continue;
      }
      p.state = open ? 'active' : 'locked';
      if (open && p.def.required) open = false;
    }
  }

  function currentTarget(): PointRuntime | null {
    if (isChallenge)
      return points.find((p) => p.state === 'reached' || p.state === 'active') ?? null;
    const selected = selectedTargetId ? byId.get(selectedTargetId) : undefined;
    if (selected && (selected.state === 'active' || selected.state === 'reached')) return selected;
    const reached = points.find((p) => p.state === 'reached');
    if (reached) return reached;
    // Nearest active point; before any position, the first in order.
    return byDistance(points.filter((p) => p.state === 'active'))[0] ?? null;
  }

  /** The planned path, or else the corridor from the last completed point (or the start) to the target. */
  function distanceToRoute(position: LatLng): number | null {
    if (spec.path) return distanceToPolyline(position, spec.path);
    const target = currentTarget();
    const lastDone = points
      .filter((p) => p.completedAt !== null)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
    const from = lastDone?.def.position ?? startPosition;
    return target && from ? distanceToSegment(position, from, target.def.position) : null;
  }

  function checkDeviation(position: LatLng): void {
    if (!settings.deviation.enabled) return;
    // Visiting a point is never a deviation.
    if (anyInZone()) {
      offRouteSince = null;
      return;
    }
    routeDistance = distanceToRoute(position);
    if (routeDistance !== null) evaluateDeviation(routeDistance);
  }

  function evaluateDeviation(d: number): void {
    const { maxDistance, graceTime } = settings.deviation;
    const at = now();
    if (d > maxDistance) {
      offRouteSince ??= at;
      if (!flags.offRoute && at - offRouteSince >= graceTime * 1000) {
        flags.offRoute = true;
        emit(
          'deviation',
          { distanceToRoute: Math.round(d), sinceMs: at - offRouteSince },
          { trigger: spec.triggers.onDeviation },
        );
      }
      return;
    }
    offRouteSince = null;
    if (flags.offRoute && d <= maxDistance * ENGINE_LIMITS.backOnTrackRatio) {
      flags.offRoute = false;
      emit(
        'back_on_track',
        { distanceToRoute: Math.round(d) },
        { trigger: spec.triggers.onBackOnTrack },
      );
    }
  }

  function checkIdle(position: LatLng): void {
    if (!settings.idle.enabled) return;
    const at = now();
    // Time spent inside a zone is a visit, never idleness.
    if (anyInZone()) {
      idleAnchor = { position, since: at };
      idleFired = false;
      flags.idle = false;
      return;
    }
    if (!idleAnchor || distance(idleAnchor.position, position) > settings.idle.radius) {
      idleAnchor = { position, since: at };
      idleFired = false;
      flags.idle = false;
      return;
    }
    evaluateIdle();
  }

  function evaluateIdle(): void {
    if (!idleAnchor || idleFired) return;
    const stillMs = now() - idleAnchor.since;
    if (stillMs < settings.idle.time * 1000) return;
    idleFired = true;
    flags.idle = true;
    emit('idle', { idleSeconds: Math.round(stillMs / 1000) }, { trigger: spec.triggers.onIdle });
  }

  function checkTime(): void {
    const limit = settings.timeLimit;
    if (limit === null || timeoutFired) return;
    const ms = elapsed();
    if (ms < limit * 1000) return;
    timeoutFired = true;
    flags.overtime = true;
    // The run goes on: the UI offers to continue without an official time.
    emit('timeout', { elapsedMs: ms, timeLimit: limit }, { trigger: spec.triggers.onTimeout });
  }

  function checkWeak(): void {
    if (weakSince === null || gps === 'denied' || now() - weakSince < ENGINE_LIMITS.weakGpsMs)
      return;
    gps = 'weak';
    if (degradedNotified || !lastSample) return;
    degradedNotified = true;
    emit('gps_weak', { reason: 'accuracy', accuracy: lastSample.sample.accuracy });
  }

  function checkStale(): void {
    const lastAt = Math.max(lastSample?.at ?? 0, silenceSince);
    if (now() - lastAt < ENGINE_LIMITS.staleGpsMs || gps === 'lost' || gps === 'denied') return;
    gps = 'lost';
    for (const p of points) p.dwellStart = null;
    if (degradedNotified) return;
    degradedNotified = true;
    emit('gps_weak', { reason: 'stale' });
  }

  function tick(): void {
    if (destroyed || status !== 'running') return;
    checkWeak();
    checkStale();
    checkDwell();
    if (
      settings.deviation.enabled &&
      routeDistance !== null &&
      !anyInZone() &&
      isFresh(lastGood, ENGINE_LIMITS.freshSampleMs)
    ) {
      evaluateDeviation(routeDistance);
    }
    if (settings.idle.enabled && !anyInZone() && isFresh(lastGood, ENGINE_LIMITS.staleGpsMs)) {
      evaluateIdle();
    }
    checkTime();
    settle();
  }

  // ------------------------------------------------------------ lifecycle

  function pauseNow(reason?: string): void {
    accumulatedMs = elapsed();
    runningSince = null;
    status = 'paused';
    offRouteSince = null;
    for (const p of points) p.dwellStart = null;
    emit('paused', reason ? { reason } : {});
  }

  function finish(): void {
    accumulatedMs = elapsed();
    runningSince = null;
    status = 'finished';
    endedAt = clock.now();
    stopSource();
    stopTicks();
    emit(
      'finished',
      {
        summary: {
          elapsedMs: accumulatedMs,
          distanceMeters: Math.round(distanceMeters),
          completed: points.filter((p) => p.state === 'completed').length,
          total: points.length,
          score: totalScore(),
        },
      },
      { trigger: spec.triggers.onFinish },
    );
  }

  // --------------------------------------------------------------- state

  const totalScore = () => points.reduce((sum, p) => sum + p.score, 0);

  function buildState(): EngineState {
    const user = lastSample
      ? {
          position: { lat: lastSample.sample.lat, lng: lastSample.sample.lng },
          accuracy: lastSample.sample.accuracy,
          heading: lastSample.sample.heading ?? null,
          speed: lastSample.sample.speed ?? null,
          timestamp: lastSample.sample.timestamp,
          quality: lastSample.quality,
        }
      : null;
    const avgSpeed = movingMs > 0 ? distanceMeters / (movingMs / 1000) : null;
    const etaSpeed =
      avgSpeed !== null && avgSpeed >= ENGINE_LIMITS.minEtaSpeed
        ? avgSpeed
        : settings.expectedSpeed;

    const t = currentTarget();
    let target: EngineState['target'] = null;
    if (t) {
      const d = user ? distance(user.position, t.def.position) : null;
      const needed = settings.dwellTime * 1000;
      let dwellProgress = 0;
      if (t.state === 'reached') dwellProgress = 1;
      else if (t.dwellStart !== null)
        dwellProgress = needed === 0 ? 1 : Math.min(1, (now() - t.dwellStart) / needed);
      target = {
        pointId: t.def.id,
        order: t.def.order,
        distance: d,
        bearing: user ? bearing(user.position, t.def.position) : null,
        etaSeconds: d === null ? null : Math.round(d / etaSpeed),
        inZone: t.inZone,
        dwellProgress,
      };
    }

    const requiredDone = finishSet.filter((p) => p.state === 'completed').length;
    return {
      routeId: spec.id,
      specHash,
      mode: spec.mode,
      status,
      startedAt,
      endedAt,
      elapsedMs: elapsed(),
      gps,
      user,
      target,
      progress: {
        completed: points.filter((p) => p.state === 'completed').length,
        required: finishSet.length,
        total: points.length,
        percent: Math.round((requiredDone / finishSet.length) * 100),
        score: totalScore(),
      },
      points: points.map((p) => ({
        id: p.def.id,
        order: p.def.order,
        state: p.state,
        distance: p.distance,
        reachedAt: p.reachedAt,
        completedAt: p.completedAt,
        score: p.score,
      })),
      flags: { ...flags },
      track,
      stats: { distanceMeters: Math.round(distanceMeters), movingMs, avgSpeed },
    };
  }

  function applySnapshot(saved: EngineSnapshot): void {
    for (const s of saved.points) {
      const p = byId.get(s.id);
      if (!p) continue;
      p.state = s.state;
      p.reachedAt = s.reachedAt;
      p.completedAt = s.completedAt;
      p.score = s.score;
      p.approached = s.approached;
    }
    // An unfinished run never resumes on its own: the user confirms first.
    status = saved.status === 'running' || saved.status === 'paused' ? 'paused' : saved.status;
    startedAt = saved.startedAt;
    endedAt = saved.endedAt;
    accumulatedMs = saved.elapsedMs;
    selectedTargetId = saved.selectedTargetId;
    Object.assign(flags, saved.flags);
    timeoutFired = saved.timeoutFired;
    startPosition = saved.startPosition;
    track = [...saved.track];
    distanceMeters = saved.stats.distanceMeters;
    movingMs = saved.stats.movingMs;
    eventSeq = saved.eventSeq;
  }

  // ----------------------------------------------------------- public API

  state = buildState();

  const engine: GeoEngine = {
    start() {
      if (destroyed || status !== 'ready') {
        logger?.warn(`geo-engine: start() ignored while ${status}`);
        return;
      }
      status = 'running';
      startedAt = clock.now();
      runningSince = now();
      silenceSince = runningSince;
      gps = 'waiting';
      emit('started', {}, { trigger: spec.triggers.onStart });
      startSource();
      startTicks();
      settle();
    },

    pause(reason) {
      if (destroyed || status !== 'running') return false;
      pauseNow(reason);
      settle();
      return true;
    },

    resume(reason) {
      if (destroyed || status !== 'paused') return false;
      status = 'running';
      runningSince = now();
      silenceSince = runningSince;
      // A fresh start for every timer, so nothing fires the instant the run resumes.
      for (const p of points) p.dwellStart = null;
      idleAnchor = null;
      idleFired = false;
      flags.idle = false;
      offRouteSince = null;
      statsAnchor = null;
      weakSince = null;
      if (!sourceRunning) {
        if (gps === 'denied') gps = 'waiting';
        startSource();
      }
      startTicks();
      emit('resumed', reason ? { reason } : {});
      checkTime();
      settle();
      return true;
    },

    cancel(reason = 'user') {
      if (destroyed || status === 'finished' || status === 'cancelled') return false;
      accumulatedMs = elapsed();
      runningSince = null;
      status = 'cancelled';
      endedAt = clock.now();
      stopSource();
      stopTicks();
      emit('cancelled', { reason }, { trigger: spec.triggers.onCancel });
      settle();
      return true;
    },

    complete(pointId, result = {}) {
      const p = byId.get(pointId);
      if (destroyed || !p || p.state !== 'reached') return false;
      if (status !== 'running' && status !== 'paused') return false;
      completePoint(p, result);
      settle();
      return true;
    },

    canManualCheckIn(pointId) {
      const p = byId.get(pointId);
      if (destroyed || !settings.allowManualCheckIn || status !== 'running') return false;
      if (!p || p.state !== 'active' || !lastSample) return false;
      const d = distance(lastSample.sample, p.def.position);
      return d <= p.def.radius * ENGINE_LIMITS.manualCheckInRadii;
    },

    manualCheckIn(pointId) {
      if (!engine.canManualCheckIn(pointId) || !lastSample) return false;
      const p = byId.get(pointId) as PointRuntime;
      arrive(p, {
        distance: distance(lastSample.sample, p.def.position),
        accuracy: lastSample.sample.accuracy,
        dwellMs: 0,
        manual: true,
      });
      settle();
      return true;
    },

    setTarget(pointId) {
      if (destroyed || isChallenge) return false;
      if (pointId !== null) {
        const p = byId.get(pointId);
        if (!p || (p.state !== 'active' && p.state !== 'reached')) return false;
      }
      selectedTargetId = pointId;
      offRouteSince = null;
      settle();
      return true;
    },

    setSource(next) {
      if (destroyed) return;
      const wasRunning = sourceRunning;
      stopSource();
      source = next;
      // A new source has its own clock and position: reset the filters' references.
      lastTimestamp = null;
      jumpReference = null;
      consecutiveJumps = 0;
      weakSince = null;
      silenceSince = now();
      if (gps !== 'denied') gps = 'waiting';
      if (wasRunning || status === 'running') startSource();
      settle();
    },

    getState: () => state,

    serialize: () => ({
      version: 1,
      routeId: spec.id,
      specHash,
      status,
      startedAt,
      endedAt,
      elapsedMs: elapsed(),
      points: points.map((p) => ({
        id: p.def.id,
        state: p.state,
        reachedAt: p.reachedAt,
        completedAt: p.completedAt,
        score: p.score,
        approached: p.approached,
      })),
      selectedTargetId,
      flags: { ...flags },
      timeoutFired,
      startPosition,
      track: [...track],
      stats: { distanceMeters, movingMs },
      eventSeq,
      savedAt: clock.now(),
    }),

    on(type: EngineEventType | '*', listener: (event: never) => void) {
      const set = eventListeners.get(type) ?? new Set();
      eventListeners.set(type, set);
      const fn = listener as (event: AnyEngineEvent) => void;
      set.add(fn);
      return () => set.delete(fn);
    },

    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    destroy() {
      if (destroyed) return;
      stopSource();
      stopTicks();
      destroyed = true;
      queue.length = 0;
      eventListeners.clear();
      stateListeners.clear();
    },
  };
  return engine;
}

/** Sorted copy, nearest first; points without a distance yet keep their order at the end. */
function byDistance(list: readonly PointRuntime[]): PointRuntime[] {
  return [...list].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}

/** Some devices report NaN heading or speed when unknown. */
function normalizeSample(sample: PositionSample): PositionSample {
  const known = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { ...sample, heading: known(sample.heading), speed: known(sample.speed) };
}
