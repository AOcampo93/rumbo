import {
  type AnyEngineEvent,
  type Clock,
  createGeoEngine,
  type EngineEventType,
  type EngineOptions,
  type EngineState,
  type EventDataMap,
  type GeoEngine,
  type PositionSample,
  type PositionSource,
  type PositionSourceError,
  type Scheduler,
} from '@rumbo/geo-engine';
import { destination, type LatLng } from '@rumbo/geo-utils';
import {
  type LocalizedContent,
  type NormalizedRouteSpec,
  type RouteSpecInput,
  validateRouteSpec,
} from '@rumbo/route-spec';
import { vi } from 'vitest';
import {
  type AbortSignalLike,
  type AnyActionHandler,
  builtinHandlers,
  createEventSystem,
  type EngineControls,
  type UiAdapter,
  type UiText,
  type ViewOutcome,
} from '../src/index.ts';

export const ORIGIN: LatLng = { lat: 39.74, lng: -8.81 };
export const P1 = destination(ORIGIN, 90, 300);
export const P2 = destination(ORIGIN, 90, 700);
/** `meters` north (positive) or south (negative) of a point. */
export const north = (p: LatLng, meters: number): LatLng =>
  destination(p, meters >= 0 ? 0 : 180, Math.abs(meters));
/** `meters` east (positive) or west (negative) of a point. */
export const east = (p: LatLng, meters: number): LatLng =>
  destination(p, meters >= 0 ? 90 : 270, Math.abs(meters));

// Typed by hand: the package has no DOM or Node types.
const { setTimeout } = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
};

/** Lets every pending promise settle (a macrotask runs after all microtasks). */
export async function flush(rounds = 2): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function abortController(): { signal: AbortSignalLike; abort(): void } {
  const { AbortController } = globalThis as unknown as {
    AbortController: new () => { signal: AbortSignalLike; abort(): void };
  };
  return new AbortController();
}

/** Closes every view as it opens, with the same outcome, until none is left. */
export async function answerAll(
  ui: { current(): OpenView | undefined },
  outcome: ViewOutcome = {},
): Promise<void> {
  await flush();
  for (let i = 0; i < 20 && ui.current(); i++) {
    ui.current()?.answer(outcome);
    await flush();
  }
}

/** Data of an automatic arrival. */
export const ARRIVAL = { distance: 5, accuracy: 5, dwellMs: 5000, manual: false };

/** Free route with two points; tests add actions and triggers. */
export function route(overrides: Partial<RouteSpecInput> = {}): NormalizedRouteSpec {
  const result = validateRouteSpec({
    specVersion: 1,
    id: 'events-test',
    name: 'Events',
    locale: 'es',
    mode: 'free',
    source: 'curated',
    points: [
      { id: 'p1', name: 'P1', position: P1, order: 1, triggers: { onEnter: 'card' } },
      { id: 'p2', name: 'P2', position: P2, order: 2, triggers: { onEnter: 'card' } },
    ],
    actions: { card: { type: 'info_sheet', params: { title: 'Castelo' } } },
    ...overrides,
  });
  if (!result.spec) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

export interface OpenView {
  view: string;
  props: Record<string, unknown>;
  variant: string | undefined;
  signal: AbortSignalLike | undefined;
  answer(outcome?: ViewOutcome): void;
}

/** A UI whose views stay open until the test answers them (or `autoAnswer` does). */
export function createFakeUi(
  autoAnswer?: (view: string, props: Record<string, unknown>) => ViewOutcome | undefined,
) {
  const opened: OpenView[] = [];
  const open: OpenView[] = [];
  const toasts: UiText[] = [];
  const confirms: Array<Parameters<UiAdapter['confirm']>[0]> = [];
  const external: string[] = [];
  const navigations: string[] = [];
  let confirmAnswer = true;

  const ui: UiAdapter = {
    present<R>(
      view: string,
      props: Record<string, unknown>,
      options?: Parameters<UiAdapter['present']>[2],
    ) {
      return new Promise<R | undefined>((resolve) => {
        // As the app's overlay stack: a signal that already aborted opens nothing.
        if (options?.signal?.aborted) {
          resolve(undefined);
          return;
        }
        let done = false;
        const entry: OpenView = {
          view,
          props,
          variant: options?.variant,
          signal: options?.signal,
          answer(outcome) {
            if (done) return;
            done = true;
            open.splice(open.indexOf(entry), 1);
            resolve(outcome as R | undefined);
          },
        };
        opened.push(entry);
        open.push(entry);
        options?.signal?.addEventListener('abort', () => entry.answer(undefined));
        if (autoAnswer) void Promise.resolve().then(() => entry.answer(autoAnswer(view, props)));
      });
    },
    toast: (message) => {
      toasts.push(message);
    },
    confirm: async (options) => {
      confirms.push(options);
      return confirmAnswer;
    },
    openExternal: (url) => {
      external.push(url);
    },
    navigate: (to) => {
      navigations.push(to);
    },
  };
  return {
    ui,
    opened,
    open,
    toasts,
    confirms,
    external,
    navigations,
    setConfirm(answer: boolean) {
      confirmAnswer = answer;
    },
    /** The view on top, waiting for an answer. */
    current: () => open[0],
  };
}

export function createFakeFeedback() {
  return { vibrate: vi.fn(), play: vi.fn(), notify: vi.fn() };
}

/** Deterministic time for the real engine (see geo-engine's test harness). */
export function createFakeTime() {
  let epoch = Date.UTC(2026, 9, 7, 9, 0, 0);
  let mono = 0;
  const timers = new Set<{ every: number; next: number; fn: () => void }>();
  const clock: Clock = { now: () => epoch, monotonic: () => mono };
  const scheduler: Scheduler = {
    every(ms, fn) {
      const timer = { every: ms, next: mono + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  function advance(ms: number): void {
    const end = mono + ms;
    for (;;) {
      let due: { every: number; next: number; fn: () => void } | null = null;
      for (const t of timers) if (t.next <= end && (!due || t.next < due.next)) due = t;
      if (!due) break;
      epoch += due.next - mono;
      mono = due.next;
      due.next += due.every;
      due.fn();
    }
    epoch += end - mono;
    mono = end;
  }
  return { clock, scheduler, advance };
}

export function createManualSource(): PositionSource & {
  emit(sample: PositionSample): void;
  fail(error: PositionSourceError): void;
} {
  let onSample: ((s: PositionSample) => void) | null = null;
  let onError: ((e: PositionSourceError) => void) | null = null;
  return {
    kind: 'gps',
    trusted: true,
    start(sample, error) {
      onSample = sample;
      onError = error;
    },
    stop() {
      onSample = null;
    },
    emit: (sample) => onSample?.(sample),
    fail: (error) => onError?.(error),
  };
}

export type FakeTime = ReturnType<typeof createFakeTime>;

export interface RealOptions {
  handlers?: readonly AnyActionHandler[];
  /** Builds the engine; a reload passes restoreGeoEngine here. */
  engine?: (options: EngineOptions) => GeoEngine;
  /** Default: a manual source the test drives with at() and stay(). */
  source?: PositionSource;
  /** Shared with an earlier run, for a reload. */
  time?: FakeTime;
  autoAnswer?: (view: string, props: Record<string, unknown>) => ViewOutcome | undefined;
}

/** The real engine and the event system wired together, on fake time. */
export function setupReal(spec: NormalizedRouteSpec, options: RealOptions = {}) {
  const time = options.time ?? createFakeTime();
  const manual = createManualSource();
  const build = options.engine ?? ((engineOptions) => createGeoEngine(spec, engineOptions));
  const engine = build({
    source: options.source ?? manual,
    clock: time.clock,
    scheduler: time.scheduler,
  });
  const fake = createFakeUi(options.autoAnswer);
  const feedback = createFakeFeedback();
  const analytics = vi.fn();
  const logger = { warn: vi.fn() };
  const events = createEventSystem({
    engine,
    route: spec,
    handlers: options.handlers ?? builtinHandlers,
    ui: fake.ui,
    feedback,
    analytics,
    logger,
    now: () => time.clock.now(),
  });
  events.start();

  /** One reading at `p`, stamped now. */
  const at = (p: LatLng) => manual.emit({ ...p, accuracy: 5, timestamp: time.clock.now() });
  /** Stays at `p` for `seconds`, one reading per second, letting the event system react. */
  const stay = async (p: LatLng, seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      time.advance(1000);
      at(p);
      await flush(1);
    }
  };
  const point = (id: string) => engine.getState().points.find((p) => p.id === id);
  return { engine, events, time, feedback, analytics, logger, at, stay, point, ...fake };
}

// ------------------------------------------------------------ fake engine

/** Default state for the fake engine: running, two points, nothing special. */
export function baseState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    routeId: 'events-test',
    specHash: 'x',
    mode: 'free',
    status: 'running',
    startedAt: 0,
    endedAt: null,
    elapsedMs: 0,
    gps: 'good',
    user: null,
    target: null,
    progress: { completed: 0, required: 2, total: 2, percent: 0, score: 0 },
    points: [
      {
        id: 'p1',
        order: 1,
        state: 'active',
        distance: null,
        reachedAt: null,
        completedAt: null,
        score: 0,
      },
      {
        id: 'p2',
        order: 2,
        state: 'active',
        distance: null,
        reachedAt: null,
        completedAt: null,
        score: 0,
      },
    ],
    flags: { offRoute: false, idle: false, overtime: false },
    track: [],
    stats: { distanceMeters: 0, movingMs: 0, avgSpeed: null },
    ...overrides,
  };
}

type PointPatch = Partial<EngineState['points'][number]>;

/**
 * An engine stand-in the test drives event by event. Its controls behave
 * like the real engine's: complete() needs a reached point and a live run,
 * and pause, resume and cancel emit their events.
 */
export function createFakeEngine(initial: EngineState = baseState()) {
  let state = initial;
  let seq = 0;
  const listeners = new Set<(event: AnyEngineEvent) => void>();
  const live = () => state.status === 'running' || state.status === 'paused';

  function setState(patch: Partial<EngineState>): void {
    state = { ...state, ...patch };
  }
  function setPoint(id: string, patch: PointPatch): void {
    setState({ points: state.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }
  function emit<T extends EngineEventType>(
    type: T,
    data: EventDataMap[T],
    extra: { pointId?: string; trigger?: string } = {},
  ): void {
    seq += 1;
    const event = {
      id: `e${seq}`,
      type,
      trigger: extra.trigger ?? null,
      pointId: extra.pointId ?? null,
      timestamp: 0,
      data,
      state,
    } as AnyEngineEvent;
    for (const listener of [...listeners]) listener(event);
  }

  const engine = {
    on: vi.fn((_type: string, listener: (event: AnyEngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    getState: () => state,
    complete: vi.fn((pointId: string) => {
      const point = state.points.find((p) => p.id === pointId);
      if (!live() || point?.state !== 'reached') return false;
      setPoint(pointId, { state: 'completed' });
      return true;
    }),
    pause: vi.fn((reason?: string) => {
      if (state.status !== 'running') return false;
      setState({ status: 'paused' });
      emit('paused', { reason });
      return true;
    }),
    resume: vi.fn((reason?: string) => {
      if (state.status !== 'paused') return false;
      setState({ status: 'running' });
      emit('resumed', { reason });
      return true;
    }),
    cancel: vi.fn((reason = 'user') => {
      if (!live()) return false;
      setState({ status: 'cancelled' });
      emit('cancelled', { reason });
      return true;
    }),
  };
  return {
    engine: engine as EngineControls & typeof engine,
    listenerCount: () => listeners.size,
    state: () => state,
    setState,
    setPoint,
    emit,
    /** The user is inside these points and the engine marked them reached. */
    reach(...ids: string[]) {
      for (const id of ids) setPoint(id, { state: 'reached', distance: 5 });
    },
  };
}

/** Event system on top of the fake engine. */
export function setupFake(
  spec: NormalizedRouteSpec = route(),
  handlers: readonly AnyActionHandler[] = builtinHandlers,
  initial?: EngineState,
) {
  const fakeEngine = createFakeEngine(initial);
  const fake = createFakeUi();
  const feedback = createFakeFeedback();
  const analytics = vi.fn();
  const logger = { warn: vi.fn() };
  const contents = new Map<string, LocalizedContent>();
  const events = createEventSystem({
    engine: fakeEngine.engine,
    route: spec,
    handlers,
    ui: fake.ui,
    feedback,
    analytics,
    logger,
    content: async (ref) => contents.get(ref) ?? null,
  });
  events.start();
  return { ...fakeEngine, events, feedback, analytics, logger, contents, ...fake };
}
