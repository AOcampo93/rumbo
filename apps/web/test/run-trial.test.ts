import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { RouteBundle } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flush, initAnalytics, stopAnalytics } from '../src/services/analytics.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';

// "Probar ruta" (design §4.4): a trial runs in simulation, isolated from the
// real runs (no snapshot, summary, API or analytics), and always ends back on
// the creator's review step with a toast.

const Empty = defineComponent({ render: () => null });
const CASTLE = { lat: 39.7473, lng: -8.8077 };

/** A one-point route that arrives as soon as the user is inside its zone. */
function trialBundle(): RouteBundle {
  const built = buildRouteSpec(
    {
      name: 'Prueba de Leiria',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [{ tempId: 'a', name: 'Castelo', position: CASTLE }],
      settingsOverrides: { dwellTime: 0 },
    },
    { source: 'user', idFactory: () => 'trial00001' },
  );
  return { spec: built.normalized, contents: {} };
}

let fetchMock = vi.fn();
let run: ReturnType<typeof useRunStore> | null = null;

/** The run store inside an app with a memory router, as on the device. */
function setup() {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
      { path: '/run', name: 'run', component: Empty },
      { path: '/run/summary', name: 'summary', component: Empty },
    ],
  });
  createApp(Empty).use(pinia).use(router);
  setActivePinia(pinia);
  run = useRunStore();
  return { router, run, ui: useUiStore(), settings: useSettingsStore() };
}

const requestsTo = (pattern: RegExp) =>
  fetchMock.mock.calls.filter(([url]) => pattern.test(String(url)));

beforeEach(async () => {
  fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  await initAnalytics(() => true);
  await Promise.all([
    db.del(KEYS.activeRun),
    db.del(KEYS.analyticsQueue),
    db.set(KEYS.lastSummary, { routeId: 'leiria-historica', status: 'finished' }),
  ]);
});

afterEach(() => {
  run?.reset();
  run = null;
  stopAnalytics();
  vi.unstubAllGlobals();
});

describe('a trial run', () => {
  it('walks to the end and lands back on the review step, with nothing saved or sent', async () => {
    const { router, run, ui, settings } = setup();
    settings.simulation = false;
    await router.push('/create/review');
    expect(await run.startTrial(trialBundle())).toBe(true);
    await router.push({ name: 'run' });
    expect(run).toMatchObject({ trial: true, simulated: true, active: true });

    run.teleport(CASTLE);
    await vi.waitFor(() => expect(ui.sheets).toHaveLength(1));
    ui.sheets[0]?.close({ status: 'done' });

    await vi.waitFor(() =>
      expect(ui.toasts[0]?.message).toEqual({
        key: 'create.trial.finished',
        params: { done: 1, total: 1 },
      }),
    );
    expect(router.currentRoute.value.name).toBe('create-review');
    expect(run).toMatchObject({ trial: false, active: false, lastSummary: null });
    expect(run.trialResult).toEqual({ kind: 'finished', completed: 1, total: 1 });
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
    expect(await db.get(KEYS.lastSummary)).toEqual({
      routeId: 'leiria-historica',
      status: 'finished',
    });
    await flush();
    expect(requestsTo(/\/runs|\/analytics/)).toEqual([]);
    expect((await db.get(KEYS.analyticsQueue)) ?? []).toEqual([]);
  });

  it('ends from "Volver al editor" or from "Terminar recorrido"', async () => {
    const { router, run, ui } = setup();
    await router.push('/create/review');
    await run.startTrial(trialBundle());
    await router.push({ name: 'run' });
    await run.endTrial();
    expect(router.currentRoute.value.name).toBe('create-review');
    expect(ui.toasts[0]?.message).toEqual({ key: 'create.trial.ended' });
    expect(run.trialResult).toEqual({ kind: 'cancelled', completed: 0, total: 1 });

    await run.startTrial(trialBundle());
    await router.push({ name: 'run' });
    const ending = run.end();
    await vi.waitFor(() => expect(ui.confirms).toHaveLength(1));
    ui.confirms[0]?.answer(true);
    expect(await ending).toBe(true);
    await vi.waitFor(() => expect(ui.toasts[0]?.message).toEqual({ key: 'create.trial.ended' }));
    expect(router.currentRoute.value.name).toBe('create-review');
    expect(run.trial).toBe(false);
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
    expect(requestsTo(/\/runs|\/analytics/)).toEqual([]);
  });

  it('leaves without asking when the user navigates away (RunView calls finishTrial)', async () => {
    const { router, run, ui } = setup();
    await router.push('/create/review');
    await run.startTrial(trialBundle());
    await router.push({ name: 'run' });
    const leaving = run.finishTrial('left', { navigate: false });
    await router.push('/');
    await leaving;
    expect(router.currentRoute.value.name).toBe('home');
    expect(run.trial).toBe(false);
    expect(run.trialResult?.kind).toBe('left');
    expect(ui.toasts[0]?.message).toEqual({ key: 'create.trial.ended' });
  });

  it('pauses a real run for the trial and offers it again afterwards', async () => {
    const { router, run, settings } = setup();
    settings.simulation = true;
    await router.push('/run');
    expect(await run.start('leiria-historica')).toBe(true);
    expect(run.trial).toBe(false);
    await vi.waitFor(() => expect(requestsTo(/\/runs/)).toHaveLength(1));
    await router.push('/create/review');

    await run.startTrial(trialBundle());
    expect(await db.get(KEYS.activeRun)).toMatchObject({ routeId: 'leiria-historica' });
    // A recover sheet never shows up over a trial, nor takes its flag.
    await run.checkRecoverable();
    expect(run.recoverable).toBeNull();
    expect(run.trial).toBe(true);

    await router.push({ name: 'run' });
    await run.endTrial();
    expect(router.currentRoute.value.name).toBe('create-review');
    expect(run.trial).toBe(false);
    expect(run.recoverable?.record.routeId).toBe('leiria-historica');
    expect(run.recoverable?.changed).toBe(false);
    expect(requestsTo(/\/runs/)).toHaveLength(1);

    // Continuing it is a real run again.
    expect(run.continueRecovered()).toBe(true);
    expect(run).toMatchObject({ trial: false, routeId: 'leiria-historica' });
  });
});

describe('a discarded run', () => {
  it('closes its row on the server', async () => {
    const RUN_ID = '3c8f0a52-7d1e-4b6a-9f2c-5e4d3c2b1a09';
    const { run, settings } = setup();
    settings.simulation = true;
    await run.start('leiria-historica');
    await vi.waitFor(async () => expect(await db.get(KEYS.activeRun)).toBeTruthy());
    // As after a reload: no run in memory, its snapshot (with its server id) in storage.
    run.reset();
    await db.set(KEYS.activeRun, {
      ...(await db.get<Record<string, unknown>>(KEYS.activeRun)),
      runId: RUN_ID,
    });
    await run.checkRecoverable();
    await run.discardRecovered();
    await vi.waitFor(() => expect(requestsTo(new RegExp(`/runs/${RUN_ID}`))).toHaveLength(1));
    const [, init] = requestsTo(new RegExp(`/runs/${RUN_ID}`))[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({
      status: 'cancelled',
      completedPoints: 0,
      totalPoints: 12,
    });
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
  });
});
