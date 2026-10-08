import 'fake-indexeddb/auto';
import { buildRouteSpec, type DraftPlace, draftFromSpec } from '@rumbo/route-builder';
import { hashRouteSpec, type LatLng, type RouteBundle, type RouteSpec } from '@rumbo/route-spec';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
  type AnalyticsEvent,
  clearAnalytics,
  initAnalytics,
  stopAnalytics,
} from '../src/services/analytics.ts';
import { deleteMyRoute, routeSyncIdle, saveMyRoute } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { pointCard, useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';
import { card } from './create-fixtures.ts';

// Editing a route while it is being walked (the mid-run work package): the run
// of one of the device's own routes follows the route when it is saved again.
// What was visited stays visited, new places start pending, and the pause, the
// time and the simulated position carry over. The real registry, catalog and
// overlay stack are used; only the network is stubbed.

// The migration is the one step of an update that can throw: a test makes it fail on demand.
const migration = vi.hoisted(() => ({ fails: false }));
vi.mock('@rumbo/geo-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rumbo/geo-engine')>();
  return {
    ...actual,
    migrateSnapshot: (...args: Parameters<typeof actual.migrateSnapshot>) => {
      if (migration.fails) throw new Error('The snapshot could not be migrated');
      return actual.migrateSnapshot(...args);
    },
  };
});

const Empty = defineComponent({ render: () => null });
const CASTLE: LatLng = { lat: 39.7473, lng: -8.8077 };
const CATHEDRAL: LatLng = { lat: 39.7436, lng: -8.8072 };
const RIVER: LatLng = { lat: 39.7408, lng: -8.8061 };
const SQUARE: LatLng = { lat: 39.7452, lng: -8.8069 };

const place = (
  tempId: string,
  name: string,
  position: LatLng,
  extra: Partial<DraftPlace> = {},
): DraftPlace => ({ tempId, name, position, ...extra });

/** A free route through the three places, where arriving is immediate (dwell time 0). */
function firstVersion(contents: RouteBundle['contents'] = {}, withCard = false) {
  const built = buildRouteSpec(
    {
      name: 'Ruta de prueba',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        place('a', 'Castelo', CASTLE, withCard ? { contentRef: 'card-aaaaaaaaaa' } : {}),
        place('b', 'Sé', CATHEDRAL),
        place('c', 'Rio Lis', RIVER),
      ],
      settingsOverrides: { dwellTime: 0 },
    },
    { source: 'user', idFactory: () => 'mid0000001' },
  );
  return { ...built, contents };
}

/** The same route after the user edited it in the creator (draftFromSpec keeps the point ids). */
function edited(spec: RouteSpec, change: (places: DraftPlace[]) => DraftPlace[]) {
  const draft = draftFromSpec(spec);
  return buildRouteSpec(
    { ...draft, places: change(draft.places) },
    { source: 'user', id: spec.id },
  );
}

/** A request on its way that the test answers when it wants to. */
function stubFetch(runs?: Promise<Response>) {
  const fetchMock = vi.fn(async (url: string) =>
    String(url).endsWith('/runs') && runs ? runs : new Response(null, { status: 503 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function setup() {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/run', name: 'run', component: Empty },
      { path: '/run/summary', name: 'summary', component: Empty },
    ],
  });
  createApp(Empty).use(pinia).use(router);
  setActivePinia(pinia);
  await router.push('/run');
  const settings = useSettingsStore();
  settings.simulation = true;
  return { router, run: useRunStore(), ui: useUiStore(), catalog: useCatalogStore(), settings };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Saves the first version in the registry and starts it (in simulation). */
async function startRun(
  { run, catalog }: Setup,
  version = firstVersion(),
): Promise<ReturnType<typeof firstVersion>> {
  await saveMyRoute(version.spec, version.contents);
  await catalog.load();
  expect(await run.start(version.spec.id)).toBe(true);
  return version;
}

/** Walks (teleports) to a place and closes its sheet, like the user would. */
async function visit({ run, ui }: Setup, position: LatLng, outcome: object = { status: 'done' }) {
  const before = ui.sheets.length;
  run.teleport(position);
  await vi.waitFor(() => expect(ui.sheets).toHaveLength(before + 1));
  ui.sheets.at(-1)?.close(outcome);
  await vi.waitFor(() => expect(ui.sheets).toHaveLength(before));
}

const states = (run: ReturnType<typeof useRunStore>) =>
  run.state?.points.map((p) => `${p.id}:${p.state}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const analyticsNames = async () =>
  ((await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? []).map((event) => event.name);

let run: ReturnType<typeof useRunStore> | null = null;

beforeEach(async () => {
  migration.fails = false;
  stubFetch();
  await initAnalytics(() => true);
  clearAnalytics();
  await Promise.all([db.del(KEYS.myRoutes), db.del(KEYS.activeRun), db.del(KEYS.lastSummary)]);
});

afterEach(async () => {
  run?.reset();
  run = null;
  stopAnalytics();
  await routeSyncIdle();
  vi.unstubAllGlobals();
});

describe('a run of one of the device’s own routes', () => {
  it('follows the route when it is saved again, keeping what was visited and where the user is', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    await vi.waitFor(() => expect(states(env.run)?.[0]).toBe('castelo:completed'));
    const startedAt = env.run.state?.startedAt;
    expect(states(env.run)).toEqual(['castelo:completed', 'se:active', 'rio-lis:active']);

    // The user drops the river and adds the square: saved from the creator.
    const second = edited(first.spec, (places) => [
      ...places.filter((p) => p.name !== 'Rio Lis'),
      place('d', 'Praça', SQUARE),
    ]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points.map((p) => p.name)).toContain('Praça'));

    expect(states(env.run)).toEqual(['castelo:completed', 'se:active', 'praca:active']);
    expect(env.run.state).toMatchObject({ status: 'running', startedAt });
    expect(env.run.state?.progress).toMatchObject({ completed: 1, total: 3 });
    // The simulated user is still where the user left them.
    expect(env.run.state?.user?.position).toEqual(CASTLE);
    expect(env.run).toMatchObject({ active: true, simulated: true, editable: true });
    expect(env.ui.toasts[0]?.message).toEqual({ key: 'run.routeUpdated' });
    expect(env.ui.toasts[0]?.tone).toBe('success');

    // The snapshot on the device is the new route's.
    await vi.waitFor(async () => {
      const saved = await db.get<{ snapshot: { specHash: string } }>(KEYS.activeRun);
      expect(saved?.snapshot.specHash).toBe(hashRouteSpec(second.normalized));
    });

    // The run goes on over the new route, all the way to the summary.
    await visit(env, CATHEDRAL);
    await visit(env, SQUARE);
    await vi.waitFor(() => expect(env.run.state?.status).toBe('finished'));
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('summary'));
    expect(env.run.lastSummary).toMatchObject({ completed: 3, total: 3, status: 'finished' });
  });

  it('can be handed the new route directly, and says whether the run took it', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    await vi.waitFor(() => expect(states(env.run)?.[0]).toBe('castelo:completed'));
    const second = edited(first.spec, (places) => places.slice(0, 2));
    const bundle = { spec: second.normalized, contents: {} };

    expect(env.run.applyRouteUpdate(bundle)).toBe(true);
    expect(env.run.bundle).toBe(bundle);
    expect(states(env.run)).toEqual(['castelo:completed', 'se:active']);
    expect(env.run.state?.status).toBe('running');
    // The same route again changes nothing.
    expect(env.run.applyRouteUpdate(bundle)).toBe(false);
  });

  it('keeps the pause, and the user can resume after the edit', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    expect(env.run.pause()).toBe(true);
    await vi.waitFor(() => expect(env.run.state?.status).toBe('paused'));
    const elapsed = env.run.state?.elapsedMs;

    const second = edited(first.spec, (places) => [...places, place('d', 'Praça', SQUARE)]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(4));

    // Nothing is measured while paused: not even the tenth of a millisecond.
    expect(env.run.state?.status).toBe('paused');
    expect(env.run.state?.elapsedMs).toBe(elapsed);
    expect(states(env.run)).toEqual([
      'castelo:completed',
      'se:active',
      'rio-lis:active',
      'praca:active',
    ]);
    expect(env.ui.toasts[0]?.message).toEqual({ key: 'run.routeUpdated' });

    // Resuming brings the simulated user back where they were.
    expect(env.run.resume()).toBe(true);
    await vi.waitFor(() => expect(env.run.state?.status).toBe('running'));
    expect(env.run.state?.user?.position).toEqual(CASTLE);
  });

  it('brings back the card of the stop the user is at, which is not lost', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    env.run.teleport(CASTLE);
    await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(1));
    const opened = env.ui.sheets[0];
    await vi.waitFor(() => expect(states(env.run)?.[0]).toBe('castelo:reached'));

    const second = edited(first.spec, (places) => [...places, place('d', 'Praça', SQUARE)]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(4));

    // The card went away with the old event system and the new one opened it again.
    await vi.waitFor(() => expect(env.ui.sheets[0]).toBeDefined());
    expect(env.ui.sheets).toHaveLength(1);
    expect(env.ui.sheets[0]).not.toBe(opened);
    expect(states(env.run)?.[0]).toBe('castelo:reached');
    env.ui.sheets[0]?.close({ status: 'done' });
    await vi.waitFor(() => expect(states(env.run)?.[0]).toBe('castelo:completed'));
    expect(states(env.run)).toEqual([
      'castelo:completed',
      'se:active',
      'rio-lis:active',
      'praca:active',
    ]);
  });

  it('does not count the resume of an update as the user’s', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    const second = edited(first.spec, (places) => [...places, place('d', 'Praça', SQUARE)]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(4));
    env.run.pause();
    await vi.waitFor(() => expect(env.run.state?.status).toBe('paused'));
    const third = edited(second.spec, (places) => places.slice(0, 3));
    await saveMyRoute(third.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(3));

    await settle();
    const names = await analyticsNames();
    expect(names.filter((name) => name === 'run_started')).toHaveLength(1);
    // One pause: the user's own. Nothing was resumed by the updates.
    expect(names.filter((name) => name === 'run_paused')).toHaveLength(1);
    expect(names).not.toContain('run_resumed');
    // The user resuming does count.
    env.run.resume();
    await settle();
    expect(await analyticsNames()).toContain('run_resumed');
  });

  it('keeps the score the removed places had earned', async () => {
    const env = await setup();
    run = env.run;
    const contents = { 'card-aaaaaaaaaa': { es: { ...card(), id: 'card-aaaaaaaaaa' } } };
    const first = await startRun(env, firstVersion(contents, true));
    // The trivia of the castle's card, answered right: 10 points.
    await visit(env, CASTLE, { status: 'done', data: { answerIndex: 0, locale: 'es' } });
    await vi.waitFor(() => expect(env.run.state?.progress.score).toBe(10));

    // The castle leaves the route; its card goes with it.
    const second = edited(first.spec, (places) => places.filter((p) => p.name !== 'Castelo'));
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(2));
    expect(env.run.state?.progress).toMatchObject({ score: 10, completed: 0, total: 2 });

    await visit(env, CATHEDRAL);
    await visit(env, RIVER);
    await vi.waitFor(() => expect(env.run.state?.status).toBe('finished'));
    expect(env.run.lastSummary).toMatchObject({ score: 10, completed: 2, total: 2 });
  });

  it('finishes when the edit leaves nothing to visit, and says so', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    await visit(env, CATHEDRAL);

    // Only the river was left: the user removes it.
    const second = edited(first.spec, (places) => places.filter((p) => p.name !== 'Rio Lis'));
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.state?.status).toBe('finished'));
    expect(env.run.endedByEdit).toBe(true);
    await vi.waitFor(() => expect(env.run.lastSummary).toMatchObject({ completed: 2, total: 2 }));
    await vi.waitFor(async () => expect(await db.get(KEYS.activeRun)).toBeUndefined());
    expect(await db.get(KEYS.lastSummary)).toMatchObject({ status: 'finished', completed: 2 });
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('summary'));

    env.run.reset();
    expect(env.run.endedByEdit).toBe(false);
  });

  it('still reports its end to the server when the start was answered after the update', async () => {
    const RUN_ID = '3c8f0a52-7d1e-4b6a-9f2c-5e4d3c2b1a09';
    let answer: (response: Response) => void = () => {};
    const fetchMock = stubFetch(new Promise((resolve) => (answer = resolve)));
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    const second = edited(first.spec, (places) => [...places, place('d', 'Praça', SQUARE)]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() => expect(env.run.spec?.points).toHaveLength(4));

    answer(
      new Response(JSON.stringify({ runId: RUN_ID }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await vi.waitFor(async () => {
      const saved = await db.get<{ runId?: string | null }>(KEYS.activeRun);
      expect(saved?.runId).toBe(RUN_ID);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/runs'))).toHaveLength(1);
  });
});

describe('the edits a run ignores', () => {
  it('a save that changed nothing (a retry of the upload) leaves the run alone', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    const before = env.run.bundle;
    await saveMyRoute(first.spec, first.contents, { editing: true });
    await settle();
    expect(env.run.bundle).toBe(before);
    expect(env.ui.toasts).toHaveLength(0);
    // Asked directly, with another object of the same route: still nothing to do.
    const same = { spec: structuredClone(first.normalized), contents: first.contents };
    expect(env.run.applyRouteUpdate(same)).toBe(false);
    expect(env.run.bundle).toBe(before);
  });

  it('a route that is deleted: the run goes on as it was', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    await deleteMyRoute(first.spec.id);
    await settle();
    expect(env.run).toMatchObject({ active: true, routeId: first.spec.id, editable: false });
    expect(env.run.spec?.points).toHaveLength(3);
    expect(env.ui.toasts).toHaveLength(0);
    expect(states(env.run)?.[0]).toBe('castelo:completed');
  });

  it('another route’s changes, and a run of a curated route', async () => {
    const env = await setup();
    run = env.run;
    await env.catalog.load();
    expect(await env.run.start('leiria-historica')).toBe(true);
    expect(env.run.editable).toBe(false);
    const other = firstVersion();
    await saveMyRoute(other.spec, other.contents);
    await settle();
    expect(env.run.routeId).toBe('leiria-historica');
    expect(env.run.applyRouteUpdate({ spec: other.normalized, contents: other.contents })).toBe(
      false,
    );
    expect(env.ui.toasts).toHaveLength(0);
  });

  it('a trial of the creator, which has its own route', async () => {
    const env = await setup();
    run = env.run;
    const first = firstVersion();
    const bundle = { spec: first.normalized, contents: first.contents };
    expect(await env.run.startTrial(bundle)).toBe(true);
    expect(env.run).toMatchObject({ trial: true, editable: false });
    const second = edited(first.spec, (places) => places.slice(0, 2));
    expect(env.run.applyRouteUpdate({ spec: second.normalized, contents: {} })).toBe(false);
    expect(env.run.spec?.points).toHaveLength(3);
    // Saved for real (the catalog hears it): the trial is the draft's, not the route's.
    await env.catalog.load();
    await saveMyRoute(first.spec, {});
    await saveMyRoute(second.spec, {}, { editing: true });
    await settle();
    expect(env.run.spec?.points).toHaveLength(3);
    expect(env.ui.toasts).toHaveLength(0);
  });

  it('an update that cannot be applied leaves the run exactly as it was', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    const before = env.run.bundle;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    migration.fails = true;
    const second = edited(first.spec, (places) => [...places, place('d', 'Praça', SQUARE)]);
    await saveMyRoute(second.spec, {}, { editing: true });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'run: the route update could not be applied',
        expect.any(Error),
      ),
    );

    // The route changed on the device; the run did not: same route, same state, no toast.
    expect(env.run.bundle).toBe(before);
    expect(env.run.state?.status).toBe('running');
    expect(states(env.run)).toEqual(['castelo:completed', 'se:active', 'rio-lis:active']);
    expect(env.ui.toasts).toHaveLength(0);

    // The engine it has still works: the walk goes on over the version it started with.
    await visit(env, CATHEDRAL);
    await vi.waitFor(() => expect(states(env.run)?.[1]).toBe('se:completed'));

    // And the next save is carried over from where the run is now.
    migration.fails = false;
    const third = edited(second.spec, (places) => places.filter((p) => p.name !== 'Rio Lis'));
    await saveMyRoute(third.spec, {}, { editing: true });
    await vi.waitFor(() =>
      expect(env.run.spec?.points.map((p) => p.name)).toEqual(['Castelo', 'Sé', 'Praça']),
    );
    expect(states(env.run)).toEqual(['castelo:completed', 'se:completed', 'praca:active']);
    expect(env.ui.toasts[0]?.message).toEqual({ key: 'run.routeUpdated' });
    warn.mockRestore();
  });

  it('a run that already ended', async () => {
    const env = await setup();
    run = env.run;
    const first = await startRun(env);
    await visit(env, CASTLE);
    await visit(env, CATHEDRAL);
    await visit(env, RIVER);
    await vi.waitFor(() => expect(env.run.state?.status).toBe('finished'));
    const second = edited(first.spec, (places) => places.slice(0, 2));
    expect(env.run.applyRouteUpdate({ spec: second.normalized, contents: {} })).toBe(false);
    expect(env.run.endedByEdit).toBe(false);
  });
});

describe('the card of a visited place', () => {
  const contents = { 'card-aaaaaaaaaa': { es: { ...card(), id: 'card-aaaaaaaaaa' } } };

  it('is the AI card when the place has one, built the way the arrival builds it', () => {
    const { spec, normalized } = firstVersion(contents, true);
    const bundle = { spec: normalized, contents };
    const castle = pointCard(bundle, 'castelo');
    expect(castle?.view).toBe('ai_template');
    expect(castle?.props).toMatchObject({ name: 'Castelo', order: 1, total: 3 });
    expect(castle?.props['content']).toBe(contents['card-aaaaaaaaaa']);
    // The others have the basic sheet (name only): nothing more to look at.
    expect(pointCard(bundle, 'se')).toBeNull();
    expect(pointCard(bundle, 'rio-lis')).toBeNull();
    expect(pointCard(bundle, 'nope')).toBeNull();
    expect(spec.points[0]?.contentRef).toBe('card-aaaaaaaaaa');
  });

  it('is nothing when the card is missing from the bundle', () => {
    const { normalized } = firstVersion(contents, true);
    expect(pointCard({ spec: normalized, contents: {} }, 'castelo')).toBeNull();
    // Own keys only: "toString" is not a card.
    const odd = structuredClone(normalized);
    odd.actions['content_castelo'] = { type: 'ai_template', params: { contentRef: 'toString' } };
    expect(pointCard({ spec: odd, contents: {} }, 'castelo')).toBeNull();
  });

  it('is the info sheet when it has a text, an image or a card of its own', () => {
    const { normalized } = firstVersion();
    const withAddress = structuredClone(normalized);
    withAddress.actions['content_castelo'] = {
      type: 'info_sheet',
      params: { title: 'Castelo', body: { es: 'Rua do Castelo' } },
    };
    const sheet = pointCard({ spec: withAddress, contents: {} }, 'castelo');
    expect(sheet?.view).toBe('info_sheet');
    expect(sheet?.props).toMatchObject({
      name: 'Castelo',
      title: 'Castelo',
      body: { es: 'Rua do Castelo' },
      image: null,
      content: null,
    });

    const withCard = structuredClone(normalized);
    withCard.actions['content_castelo'] = {
      type: 'info_sheet',
      params: { contentRef: 'card-aaaaaaaaaa' },
    };
    const fromCard = pointCard({ spec: withCard, contents }, 'castelo');
    expect(fromCard?.view).toBe('info_sheet');
    expect(fromCard?.props).toMatchObject({ title: 'Castelo', body: null });
    expect(fromCard?.props['content']).toBe(contents['card-aaaaaaaaaa']);

    // Only its name, or params the handler would refuse: nothing worth opening.
    const onlyName = structuredClone(normalized);
    onlyName.actions['content_castelo'] = { type: 'info_sheet', params: { title: 'Castelo' } };
    expect(pointCard({ spec: onlyName, contents: {} }, 'castelo')).toBeNull();
    const invalid = structuredClone(normalized);
    invalid.actions['content_castelo'] = { type: 'info_sheet', params: { body: 3 } };
    expect(pointCard({ spec: invalid, contents: {} }, 'castelo')).toBeNull();
  });

  it('is nothing for the other kinds of action, or a place without one', () => {
    const { normalized } = firstVersion();
    const quiz = structuredClone(normalized);
    quiz.actions['content_castelo'] = { type: 'quiz', params: {} };
    expect(pointCard({ spec: quiz, contents: {} }, 'castelo')).toBeNull();
    const none = structuredClone(normalized);
    none.points[0] = { ...none.points[0], triggers: {} } as (typeof none.points)[number];
    expect(pointCard({ spec: none, contents: {} }, 'castelo')).toBeNull();
    const lost = structuredClone(normalized);
    delete lost.actions['content_castelo'];
    expect(pointCard({ spec: lost, contents: {} }, 'castelo')).toBeNull();
  });

  it('opens in the preview from the run, scoring nothing', async () => {
    const env = await setup();
    run = env.run;
    await startRun(env, firstVersion(contents, true));
    await visit(env, CASTLE, { status: 'done', data: { answerIndex: 0, locale: 'es' } });
    await vi.waitFor(() => expect(env.run.state?.progress.score).toBe(10));

    expect(env.run.previewCard('rio-lis')).toBe(false);
    expect(env.run.previewCard('castelo')).toBe(true);
    expect(env.ui.sheets).toHaveLength(1);
    const sheet = env.ui.sheets[0];
    expect(sheet).toMatchObject({ view: 'ai_template', sourceLocale: 'es' });
    expect(sheet?.props).toMatchObject({ preview: true, name: 'Castelo', order: 1, total: 3 });

    // Closed as the preview closes it (no outcome): the run is as it was.
    sheet?.close();
    expect(env.ui.sheets).toHaveLength(0);
    expect(env.run.state?.progress).toMatchObject({ score: 10, completed: 1 });
    expect(states(env.run)?.[0]).toBe('castelo:completed');
  });
});
