import type { RunEndBody } from '@rumbo/api-contract';
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
  migrateSnapshot,
  type PointState,
  type PositionSource,
  restoreGeoEngine,
  type SimulatedSource,
} from '@rumbo/geo-engine';
import { destination, type LatLng, simplify } from '@rumbo/geo-utils';
import {
  hashRouteSpec,
  InfoSheetParamsSchema,
  type NormalizedRouteSpec,
  type RouteBundle,
  type RouteMode,
} from '@rumbo/route-spec';
import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { currentLocale, i18n } from '../i18n/index.ts';
import { uiTextIn } from '../i18n/text.ts';
import { track } from '../services/analytics.ts';
import { registerRunEnd, registerRunStart } from '../services/runs.ts';
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
// summary when it ends. A trial ("Probar ruta" in the creator) runs a route
// that may not be saved yet, always simulated and in isolation: no snapshot,
// no summary, no API and no analytics; it ends back in the creator.
// A run of one of the device's own routes follows the route when it is edited
// (applyRouteUpdate): the places visited stay visited, new ones start pending.

/** What survives a reload (IndexedDB), PROJECT_PLAN §8.7. */
interface ActiveRunRecord {
  routeId: string;
  simulated: boolean;
  snapshot: EngineSnapshot;
  savedAt: number;
  /** The run's id on the server (null when its start couldn't be sent). */
  runId?: string | null;
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

/** How the last trial went (the creator's toast); never mixed with real summaries. */
export interface TrialResult {
  /** Walked to the end, ended on the run screen, or left by navigating away. */
  kind: 'finished' | 'cancelled' | 'left';
  completed: number;
  total: number;
}

/** A point's card or info sheet, ready for the overlay stack (handlers/registry.ts names the view). */
export interface PointCard {
  view: 'info_sheet' | 'ai_template';
  props: Record<string, unknown>;
}

/** A card of the bundle, or null when it has none in any language. */
function cardContent(contents: RouteBundle['contents'], ref: string) {
  // Own keys only: "toString" is not a card.
  const entry = Object.hasOwn(contents, ref) ? contents[ref] : undefined;
  return entry && Object.keys(entry).length > 0 ? entry : null;
}

/**
 * What a point showed when the user arrived, to show it again from the list of
 * stops: its card (`ai_template`) or its info sheet. Built the way the
 * handlers build their views; null when the point has nothing worth opening
 * (another kind of action, a card the bundle lacks, an info sheet that is only
 * its name). The caller opens it in the preview, which scores nothing.
 */
export function pointCard(bundle: RouteBundle, pointId: string): PointCard | null {
  const { spec, contents } = bundle;
  const point = spec.points.find((candidate) => candidate.id === pointId);
  const trigger = point?.triggers.onEnter;
  const action =
    trigger && Object.hasOwn(spec.actions, trigger) ? spec.actions[trigger] : undefined;
  if (!point || !action) return null;
  const base = { name: point.name, order: point.order, total: spec.points.length };

  if (action.type === 'ai_template') {
    const ref = action.params?.['contentRef'];
    const content = typeof ref === 'string' ? cardContent(contents, ref) : null;
    return content ? { view: 'ai_template', props: { ...base, content } } : null;
  }
  if (action.type === 'info_sheet') {
    const parsed = InfoSheetParamsSchema.safeParse(action.params ?? {});
    if (!parsed.success) return null;
    const { title, body, image, contentRef } = parsed.data;
    const content = contentRef ? cardContent(contents, contentRef) : null;
    if (!content && !body && !image) return null;
    return {
      view: 'info_sheet',
      props: {
        ...base,
        title: title ?? point.name,
        body: body ?? null,
        image: image ?? null,
        content,
      },
    };
  }
  return null;
}

/** Two bundles with the same route and cards (a save that changed nothing, a retry). */
const sameBundle = (a: RouteBundle, b: RouteBundle): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

type Translate = (key: string, params?: Record<string, unknown>) => string;
const SAVE_EVERY_MS = 2000;
/** How long a trial waits for the navigation away from /run before tidying up anyway. */
const LEAVE_TIMEOUT_MS = 10_000;
/** RunEndBodySchema's ceiling. */
const MAX_RUN_MS = 7 * 24 * 3_600_000;
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
  /** The run is a trial of the creator. Set by every way a run starts, cleared by reset(). */
  const trial = ref(false);
  const trialResult = shallowRef<TrialResult | null>(null);
  /** The last route update left the run nothing to visit, so it finished (its summary is next). */
  const endedByEdit = ref(false);

  let engine: GeoEngine | null = null;
  /** The run's id on the server, for its end and for analytics. */
  let runId: string | null = null;
  let events: EventSystem | null = null;
  /** Where the engine's positions come from; a route update hands it to the new engine. */
  let positionSource: PositionSource | null = null;
  let sim: SimulatedSource | null = null;
  /** A route update resumes the engine it restored: that is not the user resuming, so no analytics. */
  let updating = false;
  let cleanups: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever a run starts: async steps of an older run stop there. */
  let generation = 0;
  /** finishTrial() is under way: further calls (the leave guard, the unmount backstop) do nothing. */
  let trialEnding = false;

  const spec = computed<NormalizedRouteSpec | null>(() => bundle.value?.spec ?? null);
  const active = computed(() => {
    const status = state.value?.status;
    return status === 'running' || status === 'paused' || status === 'ready';
  });
  const targetPoint = computed(() => {
    const id = state.value?.target?.pointId;
    return id ? (spec.value?.points.find((p) => p.id === id) ?? null) : null;
  });
  /** The run is of one of the device's own routes, which the creator can edit (never a trial). */
  const editable = computed(
    () =>
      !trial.value &&
      routeId.value !== null &&
      catalog.mine.some((route) => route.id === routeId.value),
  );

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
    if (!simulate) {
      positionSource = createGeolocationSource();
      return positionSource;
    }
    // The demo starts a short walk before the first point, outside its zone.
    const first = route.points[0]?.position;
    const start = from ?? (first ? destination(first, 225, 150) : null);
    sim = markRaw(createSimulatedSource(start ? { start } : {}));
    sim.setTimeScale(simSpeed.value);
    sim.setWeakGps(weakGps.value);
    positionSource = sim;
    return sim;
  }

  function wire(next: GeoEngine): void {
    const isTrial = trial.value;
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
      // A trial never goes to the summary: finishTrial() takes the user back to the creator.
      ui: isTrial ? { ...uiAdapter, navigate: () => {} } : uiAdapter,
      feedback: feedbackAdapter,
      content: async (ref) => bundle.value?.contents[ref] ?? null,
      // Analytics of a run carry its server id (never a position); a trial sends none.
      analytics: isTrial
        ? () => {}
        : (name, props) => {
            if (updating && name === 'run_resumed') return;
            track(name, { ...props, ...(runId ? { runId } : {}) });
          },
      logger: { warn: (message, data) => console.warn(message, data) },
    });
    events.start();
  }

  /** Stops listening to the engine (no more sheets, saves or state) but keeps it and its last state. */
  function detach(): void {
    events?.stop();
    events = null;
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  }

  function teardown(): void {
    detach();
    engine?.destroy();
    engine = null;
    positionSource = null;
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
    // A trial never writes run:active: a real run may be waiting there.
    if (!engine || !routeId.value || trial.value) return;
    const status = engine.getState().status;
    if (status === 'finished' || status === 'cancelled') return;
    const record: ActiveRunRecord = {
      routeId: routeId.value,
      simulated: simulated.value,
      snapshot: engine.serialize(),
      savedAt: Date.now(),
      runId,
    };
    await db.set(KEYS.activeRun, record);
  }

  async function onEnded(status: 'finished' | 'cancelled', final: EngineState): Promise<void> {
    if (trial.value) {
      // One tick later: the event system still gets this last event (its sound), not its summary.
      await Promise.resolve();
      await closeTrial(status, true, final);
      return;
    }
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
    if (runId) {
      void registerRunEnd(runId, {
        status,
        endedAt: new Date(record.endedAt).toISOString(),
        elapsedMs: Math.round(record.elapsedMs),
        completedPoints: record.completed,
        totalPoints: record.total,
        score: record.score,
      });
    }
    await db.set(KEYS.lastSummary, record);
    await db.del(KEYS.activeRun);
    void releaseScreen();
  }

  // ------------------------------------------------------------ lifecycle

  /** Every run starts here; `trial` is always set explicitly. */
  function begin(next: RouteBundle, options: { simulated: boolean; trial: boolean }): void {
    teardown();
    generation += 1;
    trialEnding = false;
    endedByEdit.value = false;
    trial.value = options.trial;
    if (options.trial) trialResult.value = null;
    routeId.value = next.spec.id;
    bundle.value = next;
    simulated.value = options.simulated;
    weakGps.value = false;
    const created = markRaw(
      createGeoEngine(next.spec, {
        source: createSource(next.spec, simulated.value),
        logger: { warn: (message, data) => console.warn(message, data) },
      }),
    );
    runId = null;
    wire(created);
    created.start();
    if (options.trial) return;
    void save();
    // Best effort: the run goes on whether or not the API answers.
    const startedAt = new Date().toISOString();
    const thisRun = generation;
    void registerRunStart({
      routeId: next.spec.id,
      specHash: created.getState().specHash,
      mode: next.spec.mode,
      simulated: simulated.value,
      locale: currentLocale(),
      startedAt,
    }).then((serverId) => {
      // The same run, even if a route update gave it a new engine meanwhile.
      if (generation !== thisRun || !engine) return;
      runId = serverId;
      void save();
    });
  }

  async function start(id: string): Promise<boolean> {
    await catalog.load();
    // A community route is not in the lists: its page asked for it, and the catalog has it by id.
    const route = catalog.byId(id) ?? (await catalog.resolve(id)).route;
    if (!route) return false;
    begin(route.bundle, { simulated: settings.simulation, trial: false });
    return true;
  }

  /**
   * "Probar ruta": runs the creator's route (normalized, maybe unsaved) in
   * simulation whatever the settings say. A real run in progress must have
   * been confirmed by the caller: its snapshot is saved first and stays in
   * run:active, so it is offered again (paused) when the trial ends.
   */
  async function startTrial(next: RouteBundle): Promise<boolean> {
    // save() skips a run that already ended.
    if (engine && !trial.value) await save();
    try {
      begin(next, { simulated: true, trial: true });
      return true;
    } catch (error) {
      console.warn('run: the trial could not start', error);
      reset();
      return false;
    }
  }

  /** Resolves once the navigation under way has finished (or after a while, if none comes). */
  function navigationSettled(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(done, LEAVE_TIMEOUT_MS);
      const stop = router.afterEach(done);
    });
  }

  /** Back to the review step: the history entry it came from when there is one, so Back isn't doubled. */
  async function leaveRun(): Promise<void> {
    if (router.currentRoute.value.name !== 'run') return;
    const review = router.resolve({ name: 'create-review' }).fullPath;
    if (router.options.history.state['back'] === review) {
      const settled = navigationSettled();
      router.back();
      await settled;
    } else {
      await router.replace({ name: 'create-review' });
    }
  }

  /**
   * Ends a trial; every way out goes through here, in this order: ignore the
   * engine, keep the result, leave /run (`navigate`) or let the navigation
   * under way finish, reset, then the toast (reset clears toasts) and the
   * check for a real run paused by the trial. Safe to call more than once.
   */
  function finishTrial(kind: TrialResult['kind'], options: { navigate: boolean }): Promise<void> {
    return closeTrial(kind, options.navigate, engine?.getState() ?? state.value);
  }

  async function closeTrial(
    kind: TrialResult['kind'],
    navigate: boolean,
    final: EngineState | null,
  ): Promise<void> {
    if (!trial.value || trialEnding) return;
    trialEnding = true;
    const current = generation;
    detach();
    const done = final?.progress.completed ?? 0;
    const total = final?.progress.total ?? spec.value?.points.length ?? 0;
    trialResult.value = { kind, completed: done, total };
    if (navigate) await leaveRun();
    else if (router.currentRoute.value.name === 'run') await navigationSettled();
    if (current !== generation) return;
    reset();
    ui.toast(
      kind === 'finished'
        ? { key: 'create.trial.finished', params: { done, total } }
        : { key: 'create.trial.ended' },
      { tone: kind === 'finished' ? 'success' : 'info' },
    );
    void releaseScreen();
    await checkRecoverable();
  }

  /** "Volver al editor". */
  function endTrial(): Promise<void> {
    return finishTrial('cancelled', { navigate: true });
  }

  /** On app start, and after a trial: is there a run to continue (S11)? */
  async function checkRecoverable(): Promise<void> {
    // Something runs, or started while this was reading: never offer a run over it.
    const busy = () => engine !== null || trial.value;
    if (busy()) return;
    const record = await db.get<ActiveRunRecord>(KEYS.activeRun);
    if (!record || busy()) return;
    await catalog.load();
    if (busy()) return;
    // Not in the lists: it may be the community route this run was walking.
    const resolved = catalog.byId(record.routeId) ? null : await catalog.resolve(record.routeId);
    if (busy()) return;
    const route = catalog.byId(record.routeId);
    if (!route) {
      // Only when the catalog knows every route and the API says this one is gone; otherwise (offline…) it waits for later.
      if (catalog.authoritative && resolved?.gone) await db.del(KEYS.activeRun);
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
    generation += 1;
    trialEnding = false;
    endedByEdit.value = false;
    trial.value = false;
    routeId.value = recovered.record.routeId;
    bundle.value = recovered.bundle;
    simulated.value = recovered.record.simulated;
    const lastSeen =
      recovered.record.snapshot.track.at(-1) ?? recovered.record.snapshot.startPosition;
    const source = createSource(recovered.bundle.spec, simulated.value, lastSeen ?? null);
    const next = markRaw(
      restoreGeoEngine(recovered.bundle.spec, recovered.record.snapshot, { source }),
    );
    runId = recovered.record.runId ?? null;
    wire(next);
    recoverable.value = null;
    return true;
  }

  /**
   * The run's route was edited and saved: the run goes on over the new
   * version. What was visited stays visited, the new places start pending, and
   * the time, the pause and the position source (a simulation keeps its
   * position) carry over. Only a real run in progress is touched, never a
   * trial, a finished run or another route's. True when the run was updated.
   * A paused run stays paused; if the edit left it nothing to visit, it
   * finishes when the user resumes.
   */
  function applyRouteUpdate(next: RouteBundle): boolean {
    const current = engine;
    const source = positionSource;
    if (!current || !source || trial.value || next.spec.id !== routeId.value) return false;
    // A save that changed nothing (or a retry of the upload) leaves the run alone.
    if (bundle.value && sameBundle(bundle.value, next)) return false;
    const before = current.getState().status;
    if (before !== 'running' && before !== 'paused') return false;

    // Everything that can fail comes first: the run is only swapped once the new engine exists.
    let restored: GeoEngine;
    try {
      restored = markRaw(
        restoreGeoEngine(next.spec, migrateSnapshot(current.serialize(), next.spec), {
          source,
          logger: { warn: (message, data) => console.warn(message, data) },
        }),
      );
    } catch (error) {
      console.warn('run: the route update could not be applied', error);
      return false;
    }

    updating = true;
    try {
      // Stops the old event system (its open sheets close, a reached place gets its card again) and the old engine.
      detach();
      current.destroy();
      bundle.value = next;
      wire(restored);
      // A restored engine comes back paused with its source stopped, which is how a paused run
      // stays (nothing is measured until the user resumes). A running one goes on.
      if (before === 'running') restored.resume('route-updated');
      state.value = restored.getState();
      // Nothing left to visit: resuming finished the run (its summary follows).
      endedByEdit.value = state.value.status === 'finished';
    } finally {
      updating = false;
    }
    void save();
    ui.toast({ key: 'run.routeUpdated' }, { tone: 'success' });
    return true;
  }

  async function discardRecovered(): Promise<void> {
    const record = recoverable.value?.record;
    recoverable.value = null;
    await db.del(KEYS.activeRun);
    // Otherwise its row on the server would stay "running" forever.
    if (record?.runId) void registerRunEnd(record.runId, abandonedEnd(record));
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

  /** Shows a visited point's card or info sheet again, in the preview: it scores and changes nothing. */
  function previewCard(pointId: string): boolean {
    const current = bundle.value;
    const card = current ? pointCard(current, pointId) : null;
    if (!current || !card) return false;
    void ui.present(
      card.view,
      { ...card.props, preview: true },
      { sourceLocale: current.spec.locale },
    );
    return true;
  }

  // The route of the run was saved again, wherever the edit started (the run's own
  // "Editar ruta", My routes, the route page): the run follows it. A route that was
  // deleted has no bundle any more, and its run goes on as it was.
  watch(
    () => {
      const id = routeId.value;
      if (!id || trial.value) return null;
      return catalog.mine.find((route) => route.id === id)?.bundle ?? null;
    },
    (next) => {
      if (next) applyRouteUpdate(next);
    },
  );

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
    trialEnding = false;
    endedByEdit.value = false;
    trial.value = false;
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
    trial,
    trialResult,
    endedByEdit,
    active,
    editable,
    targetPoint,
    start,
    startTrial,
    finishTrial,
    endTrial,
    checkRecoverable,
    continueRecovered,
    applyRouteUpdate,
    discardRecovered,
    loadLastSummary,
    pause,
    resume,
    end,
    previewCard,
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

/** The end of a saved run the user discarded: as far as it got when it was last saved. */
function abandonedEnd(record: ActiveRunRecord): RunEndBody {
  const { snapshot } = record;
  return {
    status: 'cancelled',
    endedAt: new Date(record.savedAt).toISOString(),
    elapsedMs: Math.min(Math.max(0, Math.round(snapshot.elapsedMs)), MAX_RUN_MS),
    completedPoints: snapshot.points.filter((point) => point.state === 'completed').length,
    totalPoints: snapshot.points.length,
    score: Math.round(
      snapshot.points.reduce((sum, point) => sum + point.score, snapshot.carriedScore ?? 0),
    ),
  };
}
