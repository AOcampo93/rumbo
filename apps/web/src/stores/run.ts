import {
  builtinHandlers,
  createEventSystem,
  type EventSystem,
  type FeedbackAdapter,
  type UiAdapter,
} from '@rumbo/event-system';
import {
  createGeoEngine,
  createGeolocationSource,
  createSimulatedSource,
  type EngineSnapshot,
  type EngineState,
  type GeoEngine,
  type PointState,
  type PositionSource,
  restoreGeoEngine,
  type SimulatedSource,
} from '@rumbo/geo-engine';
import { destination, type LatLng, simplify } from '@rumbo/geo-utils';
import {
  hashRouteSpec,
  type NormalizedRouteSpec,
  type RouteBundle,
  type RouteMode,
} from '@rumbo/route-spec';
import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { currentLocale, i18n } from '../i18n/index.ts';
import { uiTextIn } from '../i18n/text.ts';
import { track } from '../services/analytics.ts';
import { showLocalNotification } from '../services/notifications.ts';
import { supports } from '../services/platform.ts';
import { playSound } from '../services/sound.ts';
import { db, KEYS } from '../services/storage.ts';
import { releaseScreen } from '../services/wakeLock.ts';
import { useCatalogStore } from './catalog.ts';
import { useSettingsStore } from './settings.ts';
import { useUiStore } from './ui.ts';

// The run in progress (PROJECT_PLAN §8 + §9 wired to the app): the engine with
// a GPS or simulated source, the event system talking to the overlay stack
// and the device, snapshots for "Continue route" after a reload, and the
// summary when it ends.

/** What survives a reload (IndexedDB), PROJECT_PLAN §8.7. */
interface ActiveRunRecord {
  routeId: string;
  simulated: boolean;
  snapshot: EngineSnapshot;
  savedAt: number;
}

export interface RunSummaryRecord {
  routeId: string;
  mode: RouteMode;
  status: 'finished' | 'cancelled';
  endedAt: number;
  elapsedMs: number;
  distanceMeters: number;
  completed: number;
  total: number;
  score: number;
  /** m/s while moving. */
  avgSpeed: number | null;
  track: LatLng[];
  points: Array<{ id: string; state: PointState; completedAt: number | null; score: number }>;
}

export interface Recoverable {
  record: ActiveRunRecord;
  bundle: RouteBundle;
  /** The route changed since the run was saved: it can only start again. */
  changed: boolean;
}

type Translate = (key: string, params?: Record<string, unknown>) => string;
const SAVE_EVERY_MS = 2000;
export const SIM_SPEEDS = [1, 5, 20] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

export const useRunStore = defineStore('run', () => {
  const router = useRouter();
  const ui = useUiStore();
  const settings = useSettingsStore();
  const catalog = useCatalogStore();

  const routeId = ref<string | null>(null);
  const bundle = shallowRef<RouteBundle | null>(null);
  const state = shallowRef<EngineState | null>(null);
  const simulated = ref(false);
  const simSpeed = ref<SimSpeed>(1);
  const weakGps = ref(false);
  const lastSummary = shallowRef<RunSummaryRecord | null>(null);
  const recoverable = shallowRef<Recoverable | null>(null);

  let engine: GeoEngine | null = null;
  let events: EventSystem | null = null;
  let sim: SimulatedSource | null = null;
  let cleanups: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const spec = computed<NormalizedRouteSpec | null>(() => bundle.value?.spec ?? null);
  const active = computed(() => {
    const status = state.value?.status;
    return status === 'running' || status === 'paused' || status === 'ready';
  });
  const targetPoint = computed(() => {
    const id = state.value?.target?.pointId;
    return id ? (spec.value?.points.find((p) => p.id === id) ?? null) : null;
  });

  // ------------------------------------------------------------ adapters

  function sourceLocale() {
    return spec.value?.locale ?? 'es';
  }

  const uiAdapter: UiAdapter = {
    present: (view, props, options) =>
      ui.present(view, props, { ...options, sourceLocale: sourceLocale() }),
    toast: (message, options) => ui.toast(message, { ...options, sourceLocale: sourceLocale() }),
    confirm: (options) => ui.confirm({ ...options, sourceLocale: sourceLocale() }),
    openExternal: (url) => {
      globalThis.open(url, '_blank', 'noopener,noreferrer');
    },
    navigate: (to) => {
      if (to === 'summary') void router.push({ name: 'summary' });
    },
  };

  const feedbackAdapter: FeedbackAdapter = {
    vibrate: (pattern) => {
      if (settings.vibration && supports.vibration()) navigator.vibrate(pattern);
    },
    play: (sound) => {
      if (settings.sound) playSound(sound);
    },
    notify: (notification) => {
      const t = i18n.global.t as unknown as Translate;
      const text = (value: typeof notification.title) =>
        uiTextIn(value, t, currentLocale(), sourceLocale(), settings.units);
      void showLocalNotification({
        title: text(notification.title),
        body: text(notification.body),
        tag: notification.tag,
        ...(notification.url ? { url: notification.url } : {}),
      });
    },
  };

  // ------------------------------------------------------------ wiring

  function createSource(
    route: NormalizedRouteSpec,
    simulate: boolean,
    from?: LatLng | null,
  ): PositionSource {
    if (!simulate) return createGeolocationSource();
    // The demo starts a short walk before the first point, outside its zone.
    const first = route.points[0]?.position;
    const start = from ?? (first ? destination(first, 225, 150) : null);
    sim = markRaw(createSimulatedSource(start ? { start } : {}));
    sim.setTimeScale(simSpeed.value);
    sim.setWeakGps(weakGps.value);
    return sim;
  }

  function wire(next: GeoEngine): void {
    engine = next;
    state.value = next.getState();
    // The UI gets at most one state per frame (PROJECT_PLAN §10.3).
    let frame = 0;
    let pending: EngineState | null = null;
    cleanups.push(
      next.subscribe((value) => {
        pending = value;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          state.value = pending;
        });
      }),
      () => cancelAnimationFrame(frame),
      next.on('*', (event) => {
        // The event's own state: the engine publishes the new one right after.
        if (event.type === 'finished' || event.type === 'cancelled')
          void onEnded(event.type, event.state);
        else scheduleSave();
      }),
    );
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    document.addEventListener('visibilitychange', onHidden);
    cleanups.push(() => document.removeEventListener('visibilitychange', onHidden));

    const route = spec.value as NormalizedRouteSpec;
    events = createEventSystem({
      engine: next,
      route,
      handlers: builtinHandlers,
      ui: uiAdapter,
      feedback: feedbackAdapter,
      content: async (ref) => bundle.value?.contents[ref] ?? null,
      analytics: (name, props) => track(name, props),
      logger: { warn: (message, data) => console.warn(message, data) },
    });
    events.start();
  }

  function teardown(): void {
    events?.stop();
    events = null;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    engine?.destroy();
    engine = null;
    sim = null;
    ui.clear();
  }

  // ------------------------------------------------------------ persistence

  function scheduleSave(): void {
    saveTimer ??= setTimeout(() => {
      saveTimer = null;
      void save();
    }, SAVE_EVERY_MS);
  }

  async function save(): Promise<void> {
    if (!engine || !routeId.value) return;
    const status = engine.getState().status;
    if (status === 'finished' || status === 'cancelled') return;
    const record: ActiveRunRecord = {
      routeId: routeId.value,
      simulated: simulated.value,
      snapshot: engine.serialize(),
      savedAt: Date.now(),
    };
    await db.set(KEYS.activeRun, record);
  }

  async function onEnded(status: 'finished' | 'cancelled', final: EngineState): Promise<void> {
    const route = spec.value;
    if (!route) return;
    const record: RunSummaryRecord = {
      routeId: route.id,
      mode: route.mode,
      status,
      endedAt: final.endedAt ?? Date.now(),
      elapsedMs: final.elapsedMs,
      distanceMeters: final.stats.distanceMeters,
      completed: final.progress.completed,
      total: final.progress.total,
      score: final.progress.score,
      avgSpeed: final.stats.avgSpeed,
      // A light trace for the summary map.
      track: simplify(
        final.track.map((p) => ({ lat: p.lat, lng: p.lng })),
        3,
      ),
      points: final.points.map((p) => ({
        id: p.id,
        state: p.state,
        completedAt: p.completedAt,
        score: p.score,
      })),
    };
    lastSummary.value = record;
    await db.set(KEYS.lastSummary, record);
    await db.del(KEYS.activeRun);
    void releaseScreen();
  }

  // ------------------------------------------------------------ lifecycle

  async function start(id: string): Promise<boolean> {
    await catalog.load();
    const route = catalog.byId(id);
    if (!route) return false;
    teardown();
    routeId.value = id;
    bundle.value = route.bundle;
    simulated.value = settings.simulation;
    weakGps.value = false;
    const next = markRaw(
      createGeoEngine(route.bundle.spec, {
        source: createSource(route.bundle.spec, simulated.value),
        logger: { warn: (message, data) => console.warn(message, data) },
      }),
    );
    wire(next);
    next.start();
    void save();
    return true;
  }

  /** On app start: is there a run to continue (S11)? */
  async function checkRecoverable(): Promise<void> {
    if (engine) return;
    const record = await db.get<ActiveRunRecord>(KEYS.activeRun);
    if (!record) return;
    await catalog.load();
    const route = catalog.byId(record.routeId);
    if (!route) {
      await db.del(KEYS.activeRun);
      return;
    }
    recoverable.value = {
      record,
      bundle: route.bundle,
      changed: hashRouteSpec(route.bundle.spec) !== record.snapshot.specHash,
    };
  }

  /** Brings the saved run back, paused until the user resumes (§8.7). */
  function continueRecovered(): boolean {
    const recovered = recoverable.value;
    if (!recovered || recovered.changed) return false;
    teardown();
    routeId.value = recovered.record.routeId;
    bundle.value = recovered.bundle;
    simulated.value = recovered.record.simulated;
    const lastSeen =
      recovered.record.snapshot.track.at(-1) ?? recovered.record.snapshot.startPosition;
    const source = createSource(recovered.bundle.spec, simulated.value, lastSeen ?? null);
    const next = markRaw(
      restoreGeoEngine(recovered.bundle.spec, recovered.record.snapshot, { source }),
    );
    wire(next);
    recoverable.value = null;
    return true;
  }

  async function discardRecovered(): Promise<void> {
    recoverable.value = null;
    await db.del(KEYS.activeRun);
  }

  async function loadLastSummary(): Promise<RunSummaryRecord | null> {
    lastSummary.value ??= (await db.get<RunSummaryRecord>(KEYS.lastSummary)) ?? null;
    return lastSummary.value;
  }

  // ------------------------------------------------------------ controls

  const pause = () => engine?.pause('user') ?? false;
  const resume = () => engine?.resume('user') ?? false;
  const setTarget = (pointId: string | null) => engine?.setTarget(pointId) ?? false;
  const canManualCheckIn = (pointId: string) => engine?.canManualCheckIn(pointId) ?? false;
  const manualCheckIn = (pointId: string) => engine?.manualCheckIn(pointId) ?? false;

  /** End the run: destructive, so always confirmed first (S09). */
  async function end(): Promise<boolean> {
    const confirmed = await ui.confirm({
      title: { key: 'end.confirm.title' },
      body: { key: 'end.confirm.body' },
      confirmLabel: { key: 'end.confirm.yes' },
      cancelLabel: { key: 'end.confirm.no' },
      destructive: true,
    });
    if (confirmed) engine?.cancel('user');
    return confirmed;
  }

  // ------------------------------------------------------------ simulation (§10.7)

  function teleport(position: LatLng): void {
    sim?.teleport(position);
  }

  function walkToTarget(): void {
    const target = targetPoint.value;
    if (!sim || !target || !spec.value) return;
    sim.walkTo(target.position, spec.value.settings.expectedSpeed);
  }

  function setSimSpeed(speed: SimSpeed): void {
    simSpeed.value = speed;
    sim?.setTimeScale(speed);
  }

  function setWeakGps(on: boolean): void {
    weakGps.value = on;
    sim?.setWeakGps(on);
  }

  /** Leaves the finished run behind (after the summary). */
  function reset(): void {
    teardown();
    state.value = null;
    bundle.value = null;
    routeId.value = null;
  }

  return {
    routeId,
    bundle,
    spec,
    state,
    simulated,
    simSpeed,
    weakGps,
    lastSummary,
    recoverable,
    active,
    targetPoint,
    start,
    checkRecoverable,
    continueRecovered,
    discardRecovered,
    loadLastSummary,
    pause,
    resume,
    end,
    setTarget,
    canManualCheckIn,
    manualCheckIn,
    teleport,
    walkToTarget,
    setSimSpeed,
    setWeakGps,
    reset,
  };
});
