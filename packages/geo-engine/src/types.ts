import type { LatLng } from '@rumbo/geo-utils';
import type { RouteMode } from '@rumbo/route-spec';

// Contract of docs/PROJECT_PLAN.md §8. Distances are metres, durations are
// milliseconds unless a name says otherwise, and timestamps are epoch ms.

/** One position reading. */
export interface PositionSample {
  lat: number;
  lng: number;
  /** Metres: the radius the reading is probably within. */
  accuracy: number;
  /** Epoch ms when the reading was taken. */
  timestamp: number;
  /** Degrees 0-360, when the device knows it. */
  heading?: number | null;
  /** m/s, when the device knows it. */
  speed?: number | null;
}

export type PositionSourceErrorCode =
  'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED';

export interface PositionSourceError {
  code: PositionSourceErrorCode;
  message: string;
}

/** Where positions come from: real GPS, a simulation or a recorded track. Hot-swappable. */
export interface PositionSource {
  kind: 'gps' | 'simulated' | 'replay';
  /**
   * Trusted sources skip the accuracy and speed filters. Read on every
   * sample, so a simulation can turn itself untrusted to fake a weak GPS.
   */
  readonly trusted: boolean;
  start(
    onSample: (sample: PositionSample) => void,
    onError: (error: PositionSourceError) => void,
  ): void;
  stop(): void;
}

export interface Clock {
  /** Epoch ms: for timestamps shown or stored. */
  now(): number;
  /** Monotonic ms: for durations, immune to system clock changes. */
  monotonic(): number;
}

export interface Scheduler {
  /** Runs `fn` every `ms`; returns a function that cancels it. */
  every(ms: number, fn: () => void): () => void;
}

export interface Logger {
  warn(message: string, data?: unknown): void;
}

export type EngineStatus = 'ready' | 'running' | 'paused' | 'finished' | 'cancelled';
export type PointState = 'locked' | 'active' | 'reached' | 'completed';
export type GpsState = 'waiting' | 'good' | 'weak' | 'lost' | 'denied';

/** What a handler reports when the user finishes with a point. */
export interface CompletionResult {
  score?: number;
  data?: unknown;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  /** Epoch ms. */
  t: number;
}

export interface RunSummary {
  elapsedMs: number;
  distanceMeters: number;
  completed: number;
  total: number;
  score: number;
}

/**
 * Everything the UI draws. A new object is published after every change;
 * treat it as read-only.
 */
export interface EngineState {
  readonly routeId: string;
  readonly specHash: string;
  readonly mode: RouteMode;
  readonly status: EngineStatus;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** Excludes pauses. */
  readonly elapsedMs: number;
  readonly gps: GpsState;
  readonly user: {
    readonly position: LatLng;
    readonly accuracy: number;
    readonly heading: number | null;
    readonly speed: number | null;
    readonly timestamp: number;
    readonly quality: 'good' | 'weak';
  } | null;
  /** The point the HUD points at; its name is resolved from the spec by `pointId`. */
  readonly target: {
    readonly pointId: string;
    readonly order: number;
    /** Null until there is a position. */
    readonly distance: number | null;
    /** Degrees 0-360 from the user; null until there is a position. */
    readonly bearing: number | null;
    readonly etaSeconds: number | null;
    readonly inZone: boolean;
    /** 0..1 while an arrival is being confirmed; 1 once reached. */
    readonly dwellProgress: number;
  } | null;
  readonly progress: {
    readonly completed: number;
    readonly required: number;
    readonly total: number;
    /** Completed required points, as a percentage of the required ones. */
    readonly percent: number;
    readonly score: number;
  };
  readonly points: ReadonlyArray<{
    readonly id: string;
    readonly order: number;
    readonly state: PointState;
    readonly distance: number | null;
    readonly reachedAt: number | null;
    readonly completedAt: number | null;
    readonly score: number;
  }>;
  readonly flags: {
    readonly offRoute: boolean;
    readonly idle: boolean;
    readonly overtime: boolean;
  };
  readonly track: readonly TrackPoint[];
  readonly stats: {
    readonly distanceMeters: number;
    readonly movingMs: number;
    /** m/s while moving; null until the user has moved. */
    readonly avgSpeed: number | null;
  };
}

export interface EventDataMap {
  started: Record<string, never>;
  position: { sample: PositionSample };
  gps_weak: { reason: 'accuracy' | 'stale'; accuracy?: number };
  gps_recovered: { accuracy: number };
  approach: { distance: number };
  enter: { distance: number; accuracy: number; dwellMs: number; manual: boolean };
  exit: { distance: number };
  completed: { result: CompletionResult };
  out_of_order: { expectedPointId: string; actualPointId: string };
  deviation: { distanceToRoute: number; sinceMs: number };
  back_on_track: { distanceToRoute: number };
  idle: { idleSeconds: number };
  timeout: { elapsedMs: number; timeLimit: number };
  paused: { reason?: string };
  resumed: { reason?: string };
  cancelled: { reason: string };
  finished: { summary: RunSummary };
  error: PositionSourceError;
}

export type EngineEventType = keyof EventDataMap;

export interface EngineEvent<T extends EngineEventType = EngineEventType> {
  /** Unique within a run: for deduplication and analytics. */
  id: string;
  type: T;
  /** Id of the action to run (from RouteSpec triggers), or null. */
  trigger: string | null;
  pointId: string | null;
  timestamp: number;
  data: EventDataMap[T];
  /** State right after this event was applied. */
  state: EngineState;
}

/** Any event, discriminated by `type`. */
export type AnyEngineEvent = { [T in EngineEventType]: EngineEvent<T> }[EngineEventType];

/** JSON the app persists to resume a run after a reload (§8.7). */
export interface EngineSnapshot {
  version: 1;
  routeId: string;
  specHash: string;
  status: EngineStatus;
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number;
  points: Array<{
    id: string;
    state: PointState;
    reachedAt: number | null;
    completedAt: number | null;
    score: number;
    approached: boolean;
  }>;
  selectedTargetId: string | null;
  /**
   * Score earned by places that were removed from the route after the run
   * began (see `migrateSnapshot`): it stays in the total. Absent means 0, so
   * snapshots saved before it existed read the same.
   */
  carriedScore?: number;
  flags: { offRoute: boolean; idle: boolean; overtime: boolean };
  timeoutFired: boolean;
  startPosition: LatLng | null;
  track: TrackPoint[];
  stats: { distanceMeters: number; movingMs: number };
  eventSeq: number;
  savedAt: number;
}
