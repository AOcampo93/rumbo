import 'fake-indexeddb/auto';
import { buildRouteSpec, type DraftPlace } from '@rumbo/route-builder';
import type { LatLng } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import type { MapMarker } from '../src/map/types.ts';
import { clearAnalytics } from '../src/services/analytics.ts';
import { routeSyncIdle, saveMyRoute } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';
import DoneStep from '../src/views/create/DoneStep.vue';
import RunView from '../src/views/RunView.vue';
import { card } from './create-fixtures.ts';

// The mid-run work package on its screens: the list of stops of the run screen
// offers "Editar ruta" (own routes) and "Ver ficha" (visited stops with a
// card), and the creator's last screen brings the user back to the run.

// The map SDK isn't needed here (RouteMap has its own test). The stub keeps the
// markers it is given, and a test answers a popup button by emitting "action".
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return {
    __esModule: true,
    default: { name: 'RouteMap', props: ['markers'], emits: ['action'], render: () => h('div') },
  };
});

const Empty = { render: () => null };
const CASTLE: LatLng = { lat: 39.7473, lng: -8.8077 };
const CATHEDRAL: LatLng = { lat: 39.7436, lng: -8.8072 };
const REF = 'card-aaaaaaaaaa';

const place = (
  tempId: string,
  name: string,
  position: LatLng,
  extra: Partial<DraftPlace> = {},
) => ({
  tempId,
  name,
  position,
  ...extra,
});

/** Two places, the castle with an AI card and the cathedral with a basic sheet (name and address). */
function ownRoute(id = 'mid0000002') {
  const built = buildRouteSpec(
    {
      name: 'Ruta propia',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        place('a', 'Castelo', CASTLE, { contentRef: REF }),
        place('b', 'Sé', CATHEDRAL, { address: 'Largo da Sé, Leiria' }),
      ],
      settingsOverrides: { dwellTime: 0 },
    },
    { source: 'user', idFactory: () => id },
  );
  return { ...built, contents: { [REF]: { es: { ...card(), id: REF } } } };
}

let wrapper: VueWrapper | null = null;

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/routes/:routeId/prepare', name: 'prepare', component: Empty },
      { path: '/run', name: 'run', component: RunView },
      { path: '/run/summary', name: 'summary', component: Empty },
      { path: '/create/places', name: 'create-places', component: Empty },
      { path: '/create/done', name: 'create-done', component: DoneStep },
    ],
  });
  await router.push('/');
  wrapper = mount(RouterView, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  const settings = useSettingsStore();
  settings.simulation = true;
  return {
    view: wrapper,
    router,
    run: useRunStore(),
    ui: useUiStore(),
    creator: useCreatorStore(),
    catalog: useCatalogStore(),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function startOwnRun(env: Env) {
  const route = ownRoute();
  await saveMyRoute(route.spec, route.contents);
  await env.catalog.load();
  expect(await env.run.start(route.spec.id)).toBe(true);
  await env.router.push('/run');
  await flushPromises();
  return route;
}

async function visit(env: Env, position: LatLng, outcome: object = { status: 'done' }) {
  const before = env.ui.sheets.length;
  env.run.teleport(position);
  await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(before + 1));
  env.ui.sheets.at(-1)?.close(outcome);
  await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(before));
}

const button = (view: VueWrapper, name: string | RegExp) =>
  view
    .findAll('button')
    .find((candidate) =>
      typeof name === 'string'
        ? candidate.text() === name
        : name.test(candidate.text() + (candidate.attributes('aria-label') ?? '')),
    );
const openPoints = async (view: VueWrapper) => {
  await view.get('.run__handle').trigger('click');
  await flushPromises();
};

beforeEach(async () => {
  applyLocale('es');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  clearAnalytics();
  await Promise.all([db.del(KEYS.myRoutes), db.del(KEYS.activeRun), db.del(KEYS.lastSummary)]);
});

afterEach(async () => {
  useRunStore().reset();
  wrapper?.unmount();
  wrapper = null;
  await routeSyncIdle();
  vi.unstubAllGlobals();
});

describe('"Editar ruta" in the list of stops', () => {
  it('opens the creator on the places of the route, with the run still active and no question', async () => {
    const env = await setup();
    const route = await startOwnRun(env);
    expect(button(env.view, 'Editar ruta')).toBeUndefined();
    await openPoints(env.view);

    await button(env.view, 'Editar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-places'));
    // "¿Salir del mapa?" is for leaving; this is not.
    expect(env.ui.confirms).toHaveLength(0);
    expect(env.creator.draft?.editingId).toBe(route.spec.id);
    expect(env.creator.draft?.places.map((p) => p.name)).toEqual(['Castelo', 'Sé']);
    expect(env.run).toMatchObject({ active: true, routeId: route.spec.id });
  });

  it('is only offered for the device’s own routes', async () => {
    const env = await setup();
    await env.catalog.load();
    expect(await env.run.start('leiria-historica')).toBe(true);
    await env.router.push('/run');
    await flushPromises();
    await openPoints(env.view);
    expect(env.view.text()).toContain('Puntos de la ruta');
    expect(button(env.view, 'Editar ruta')).toBeUndefined();
  });

  it('is not offered during a trial of the creator', async () => {
    const env = await setup();
    const route = ownRoute('mid0000003');
    await saveMyRoute(route.spec, route.contents);
    await env.catalog.load();
    expect(await env.run.startTrial({ spec: route.normalized, contents: route.contents })).toBe(
      true,
    );
    await env.router.push('/run');
    await flushPromises();
    await openPoints(env.view);
    expect(button(env.view, 'Editar ruta')).toBeUndefined();
  });

  it('asks before it replaces another draft, and stays on the run when the answer is no', async () => {
    const env = await setup();
    const route = await startOwnRun(env);
    await env.creator.ensureDraft();
    await env.creator.update({ name: 'Otra ruta' });
    await openPoints(env.view);

    await button(env.view, 'Editar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.ui.confirms).toHaveLength(1));
    expect(env.ui.confirms[0]?.title).toEqual({ key: 'create.draft.replaceTitle' });
    env.ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(env.router.currentRoute.value.name).toBe('run');
    expect(env.creator.draft?.name).toBe('Otra ruta');

    // Once it is answered the button works again.
    await button(env.view, 'Editar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.ui.confirms).toHaveLength(1));
    env.ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-places'));
    expect(env.creator.draft?.editingId).toBe(route.spec.id);
  });

  it('keeps the draft of this same route that was already open', async () => {
    const env = await setup();
    const route = await startOwnRun(env);
    expect(await env.creator.loadForEdit(route.spec.id)).toBe(true);
    await env.creator.update({ name: 'Ruta propia, a medias' });
    await openPoints(env.view);
    await button(env.view, 'Editar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-places'));
    expect(env.ui.confirms).toHaveLength(0);
    expect(env.creator.draft?.name).toBe('Ruta propia, a medias');
  });

  it('does not stop the question that leaving the map still asks', async () => {
    const env = await setup();
    await startOwnRun(env);
    const leaving = env.router.push('/');
    await vi.waitFor(() => expect(env.ui.confirms).toHaveLength(1));
    expect(env.ui.confirms[0]?.title).toEqual({ key: 'run.exit.title' });
    env.ui.confirms[0]?.answer(false);
    await leaving;
    expect(env.router.currentRoute.value.name).toBe('run');
  });
});

describe('"Ver ficha" in the list of stops', () => {
  it('is on the visited stops that have a card, and shows it in the preview', async () => {
    const env = await setup();
    await startOwnRun(env);
    await openPoints(env.view);
    // Nothing visited yet: nothing to look at again.
    expect(button(env.view, /Ver ficha|Ver la ficha/)).toBeUndefined();

    await visit(env, CASTLE, { status: 'done', data: { answerIndex: 0, locale: 'es' } });
    await vi.waitFor(() => expect(env.run.state?.progress.score).toBe(10));
    await vi.waitFor(() =>
      expect(button(env.view, 'Ver ficha')?.attributes('aria-label')).toBe(
        'Ver la ficha de Castelo',
      ),
    );
    // The cathedral has the basic sheet, and it is not visited either.
    expect(env.view.findAll('button').filter((b) => b.text() === 'Ver ficha')).toHaveLength(1);

    await button(env.view, 'Ver ficha')?.trigger('click');
    await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(1));
    expect(env.ui.sheets[0]).toMatchObject({ view: 'ai_template', sourceLocale: 'es' });
    expect(env.ui.sheets[0]?.props).toMatchObject({ preview: true, name: 'Castelo' });
    // Nothing is scored by looking at it again.
    env.ui.sheets[0]?.close();
    await flushPromises();
    expect(env.run.state?.progress).toMatchObject({ score: 10, completed: 1 });
  });

  it('is on the basic sheets too, when they have an address to show', async () => {
    const env = await setup();
    await startOwnRun(env);
    await openPoints(env.view);
    await visit(env, CATHEDRAL);
    await vi.waitFor(() =>
      expect(button(env.view, 'Ver ficha')?.attributes('aria-label')).toBe('Ver la ficha de Sé'),
    );
    await button(env.view, 'Ver ficha')?.trigger('click');
    await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(1));
    expect(env.ui.sheets[0]).toMatchObject({ view: 'info_sheet' });
    expect(env.ui.sheets[0]?.props).toMatchObject({
      preview: true,
      title: 'Sé',
      body: 'Largo da Sé, Leiria',
    });
  });
});

describe('"Ver ficha" in the popup of a marker', () => {
  const map = (env: Env) => env.view.findComponent({ name: 'RouteMap' });
  const popupOf = (env: Env, id: string) =>
    (map(env).props('markers') as MapMarker[]).find((marker) => marker.id === id)?.popup;
  const actionIds = (env: Env, id: string) => popupOf(env, id)?.actions.map((a) => a.id);

  it('is offered once the stop is visited, and shows its card in the preview', async () => {
    const env = await setup();
    await startOwnRun(env);
    // Nothing visited yet: the popups offer where to go (or nothing, for the target), not a card.
    expect(actionIds(env, 'castelo')).not.toContain('viewCard');
    expect(actionIds(env, 'se')).not.toContain('viewCard');

    await visit(env, CASTLE, { status: 'done', data: { answerIndex: 0, locale: 'es' } });
    await vi.waitFor(() => expect(actionIds(env, 'castelo')).toEqual(['viewCard']));
    expect(popupOf(env, 'castelo')?.actions[0]).toMatchObject({
      label: 'Ver ficha',
      primary: true,
    });
    // The cathedral isn't visited: no card yet.
    expect(actionIds(env, 'se')).not.toContain('viewCard');

    map(env).vm.$emit('action', { markerId: 'castelo', action: 'viewCard' });
    await vi.waitFor(() => expect(env.ui.sheets).toHaveLength(1));
    expect(env.ui.sheets[0]).toMatchObject({ view: 'ai_template' });
    expect(env.ui.sheets[0]?.props).toMatchObject({ preview: true, name: 'Castelo' });
    env.ui.sheets[0]?.close();
    await flushPromises();
    // Nothing is scored by looking at it again.
    expect(env.run.state?.progress).toMatchObject({ score: 10, completed: 1 });
  });

  it('is not offered for a stop without a card, nor over "Ir a este punto"', async () => {
    const env = await setup();
    // A route whose stops open nothing worth looking at again: only names.
    const bare = buildRouteSpec(
      {
        name: 'Ruta sin fichas',
        locale: 'es',
        mode: 'free',
        activity: 'walk',
        places: [place('a', 'Castelo', CASTLE), place('b', 'Sé', CATHEDRAL)],
        settingsOverrides: { dwellTime: 0 },
      },
      { source: 'user', idFactory: () => 'mid0000006' },
    );
    await saveMyRoute(bare.spec, {});
    await env.catalog.load();
    expect(await env.run.start(bare.spec.id)).toBe(true);
    await env.router.push('/run');
    await flushPromises();
    // The basic sheet has no address here, so it has nothing to show again.
    await visit(env, CASTLE);
    await vi.waitFor(() => expect(env.run.state?.points[0]?.state).toBe('completed'));
    expect(actionIds(env, 'castelo')).toEqual([]);
    // A pending stop of a free route still offers "Ir a este punto" (or nothing when it is the target).
    expect((actionIds(env, 'se') ?? []).filter((id) => id !== 'goHere')).toEqual([]);
  });
});

describe('the last screen of the creator, with a run of the route in progress', () => {
  /** The run screen's "Editar ruta" takes the user into the creator, as in the app. */
  async function editFromRun(env: Env) {
    const route = await startOwnRun(env);
    await openPoints(env.view);
    await button(env.view, 'Editar ruta')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('create-places'));
    return route;
  }

  it('takes the user back to the run instead of starting another', async () => {
    const env = await setup();
    const route = await editFromRun(env);
    // The user saved: the creator moves on to its last screen with that route.
    env.creator.savedId = route.spec.id;
    await env.router.push('/create/done');
    await flushPromises();

    expect(button(env.view, 'Iniciar ahora')).toBeUndefined();
    expect(env.view.text()).toContain('Tu recorrido en curso ya usa estos cambios');
    await button(env.view, 'Volver al recorrido')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('run'));
    // Back on the run, asked nothing, and still the same run.
    expect(env.ui.confirms).toHaveLength(0);
    expect(env.run.active).toBe(true);
  });

  it('starts the route as usual when no run of it is in progress', async () => {
    const env = await setup();
    const route = ownRoute('mid0000004');
    await saveMyRoute(route.spec, route.contents);
    await env.catalog.load();
    env.creator.savedId = route.spec.id;
    await env.router.push('/create/done');
    await flushPromises();
    expect(button(env.view, 'Volver al recorrido')).toBeUndefined();
    expect(env.view.text()).not.toContain('ya usa estos cambios');
    await button(env.view, 'Iniciar ahora')?.trigger('click');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('prepare'));
  });

  it('starts it as usual when the run in progress is of another route', async () => {
    const env = await setup();
    await editFromRun(env);
    const other = ownRoute('mid0000005');
    await saveMyRoute(other.spec, other.contents);
    env.creator.savedId = other.spec.id;
    await env.router.push('/create/done');
    await flushPromises();
    expect(button(env.view, 'Volver al recorrido')).toBeUndefined();
    expect(button(env.view, 'Iniciar ahora')).toBeDefined();
  });

  it('goes to the summary when saving finished the run', async () => {
    const env = await setup();
    const route = await editFromRun(env);
    env.run.endedByEdit = true;
    env.creator.savedId = route.spec.id;
    await env.router.push('/create/done');
    await vi.waitFor(() => expect(env.router.currentRoute.value.name).toBe('summary'));
  });
});
