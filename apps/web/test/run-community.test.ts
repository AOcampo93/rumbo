import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import leiria from '../../../data/routes/leiria-historica.json';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { type RunSummaryRecord, useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import PrepareView from '../src/views/PrepareView.vue';
import SummaryView from '../src/views/SummaryView.vue';
import { json } from './create-fixtures.ts';

// Walking a route the community published (phase 7.2, ADR 0004) works as
// walking a curated one: the preparation, the run and the summary load its
// bundle from the API by id, a run in progress comes back after a reload
// (even without a connection, from the copy the user downloaded), and the
// saved run is dropped only when the API itself says the route is gone.

// The map SDK isn't needed here (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});

const Empty = { render: () => null };
const ID = 'paseo-aaaa';

function bundleOf(id = ID) {
  const built = buildRouteSpec(
    {
      name: 'Paseo de la comunidad',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
      settingsOverrides: { dwellTime: 0 },
    },
    { source: 'user', id },
  );
  return { spec: built.spec, contents: {} };
}

/** How the API answers for the community route. */
let community: 'up' | 'gone' | 'down' = 'up';
let curatedList: 'api' | 'down' = 'api';

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/routes') {
        return curatedList === 'api'
          ? json([{ id: 'leiria-historica' }])
          : new Response(null, { status: 503 });
      }
      if (url === '/api/v1/routes/leiria-historica') return json(leiria);
      if (url === `/api/v1/routes/${ID}`) {
        if (community === 'up') return json(bundleOf());
        if (community === 'gone') return json({ code: 'route_not_found' }, 404);
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 503 });
    }),
  );
}

/** The app as a fresh page load builds it: new stores, a memory router. */
function startApp() {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/routes/:routeId/prepare', name: 'prepare', component: PrepareView, props: true },
      { path: '/run', name: 'run', component: Empty },
      { path: '/run/summary', name: 'summary', component: SummaryView },
    ],
  });
  createApp(Empty).use(pinia).use(router);
  setActivePinia(pinia);
  const settings = useSettingsStore();
  settings.simulation = true;
  return { pinia, router, run: useRunStore(), catalog: useCatalogStore(), settings };
}

let wrapper: VueWrapper | null = null;
let run: ReturnType<typeof useRunStore> | null = null;

beforeEach(async () => {
  applyLocale('es');
  community = 'up';
  curatedList = 'api';
  stubApi();
  await Promise.all([db.del(KEYS.activeRun), db.del(KEYS.lastSummary), db.del(KEYS.bundle(ID))]);
});

afterEach(() => {
  run?.reset();
  run = null;
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('starting a community route', () => {
  it('loads its bundle by id, like any route', async () => {
    const app = startApp();
    run = app.run;
    expect(await app.run.start(ID)).toBe(true);
    expect(app.run).toMatchObject({ routeId: ID, active: true });
    expect(app.run.spec?.points).toHaveLength(2);
    // Not a route of the lists, nor the user's own.
    expect(app.catalog.routes.map((route) => route.id)).toEqual(['leiria-historica']);
    expect(app.run.editable).toBe(false);
  });

  it('does not start a route nobody has', async () => {
    community = 'gone';
    const app = startApp();
    run = app.run;
    expect(await app.run.start(ID)).toBe(false);
    expect(app.run.active).toBe(false);
  });
});

describe('the preparation of a community route', () => {
  async function prepare() {
    const app = startApp();
    run = app.run;
    await app.router.push(`/routes/${ID}/prepare`);
    wrapper = mount(PrepareView, {
      props: { routeId: ID },
      global: { plugins: [app.pinia, app.router, i18n] },
      attachTo: document.body,
    });
    return { ...app, view: wrapper };
  }

  it('opens from its address, downloads the bundle as for a curated route, and starts', async () => {
    const { view, catalog, router } = await prepare();
    await vi.waitFor(() => expect(view.text()).toContain('Paseo de la comunidad'));
    await vi.waitFor(() => expect(catalog.downloaded.has(ID)).toBe(true));
    // Only now, because the user asked for it, is the bundle kept on the device.
    expect(await db.get(KEYS.bundle(ID))).toMatchObject({ spec: { id: ID } });
    await flushPromises();
    const start = view.findAll('button').find((button) => button.text() === 'Empezar');
    await vi.waitFor(() => expect(start?.attributes('disabled')).toBeUndefined());
    await start?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('run'));
    expect(run?.routeId).toBe(ID);
  });

  it('says the route is not found when the API says there is none', async () => {
    community = 'gone';
    const { view } = await prepare();
    await vi.waitFor(() => expect(view.text()).toContain('No encontramos esta ruta.'));
  });
});

describe('a run of a community route after a reload', () => {
  /** A run in progress with its snapshot stored, and the page "reloaded": everything new but the storage. */
  async function reload() {
    const first = startApp();
    expect(await first.run.start(ID)).toBe(true);
    await vi.waitFor(async () => expect(await db.get(KEYS.activeRun)).toBeTruthy());
    first.run.reset();
    return startApp();
  }

  it('is offered again, the route asked for by id', async () => {
    const app = await reload();
    run = app.run;
    await app.run.checkRecoverable();
    expect(app.run.recoverable?.record.routeId).toBe(ID);
    expect(app.run.recoverable?.changed).toBe(false);
    expect(app.run.continueRecovered()).toBe(true);
    expect(app.run).toMatchObject({ routeId: ID });
  });

  it('is offered again without a connection when the user downloaded the route to walk it', async () => {
    await db.set(KEYS.bundle(ID), bundleOf());
    const app = await reload();
    run = app.run;
    community = 'down';
    await app.run.checkRecoverable();
    expect(app.run.recoverable?.record.routeId).toBe(ID);
  });

  it('keeps the saved run for later when the route cannot be asked for', async () => {
    const app = await reload();
    run = app.run;
    community = 'down';
    await app.run.checkRecoverable();
    expect(app.run.recoverable).toBeNull();
    expect(await db.get(KEYS.activeRun)).toMatchObject({ routeId: ID });
  });

  it('drops it only when the API says the route is gone and the device has no copy', async () => {
    const app = await reload();
    run = app.run;
    community = 'gone';
    await app.run.checkRecoverable();
    expect(app.run.recoverable).toBeNull();
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
  });

  it("keeps it, though, when the lists are not the API's (nothing proves the route is gone)", async () => {
    const app = await reload();
    run = app.run;
    curatedList = 'down';
    community = 'gone';
    await app.run.checkRecoverable();
    expect(await db.get(KEYS.activeRun)).toMatchObject({ routeId: ID });
  });
});

describe('the summary of a community run', () => {
  it('names the route after a reload, asking the API for it', async () => {
    const summary: RunSummaryRecord = {
      routeId: ID,
      mode: 'free',
      status: 'finished',
      endedAt: Date.parse('2026-10-09T12:00:00Z'),
      elapsedMs: 1_800_000,
      distanceMeters: 800,
      completed: 2,
      total: 2,
      score: 100,
      avgSpeed: 1.2,
      track: [],
      points: [
        {
          id: 'castelo',
          state: 'completed',
          completedAt: Date.parse('2026-10-09T11:40:00Z'),
          score: 50,
        },
        {
          id: 'se',
          state: 'completed',
          completedAt: Date.parse('2026-10-09T11:55:00Z'),
          score: 50,
        },
      ],
    };
    await db.set(KEYS.lastSummary, summary);
    const app = startApp();
    run = app.run;
    await app.router.push('/run/summary');
    wrapper = mount(SummaryView, {
      global: { plugins: [app.pinia, app.router, i18n] },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(wrapper?.text()).toContain('Paseo de la comunidad'));
    expect(wrapper?.text()).not.toContain('Aún no has terminado ningún recorrido.');
  });
});
