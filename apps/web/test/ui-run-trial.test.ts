import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import type { RouteBundle } from '@rumbo/route-spec';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';
import RunView from '../src/views/RunView.vue';

// The run screen during a trial of the creator ("Probar ruta", design §4.4):
// the purple banner carries the "Prueba" chip and "Volver al editor", and the
// simulation controls start open. A real run shows neither.

// The map SDK isn't needed here (RouteMap has its own test). `__esModule` lets
// defineAsyncComponent take the default export, as it does with the real module.
vi.mock('../src/map/RouteMap.vue', async () => {
  const { h } = await import('vue');
  return { __esModule: true, default: { name: 'RouteMap', render: () => h('div') } };
});

/** The other screens of these flows: nothing to show. */
const Empty = { render: () => null };

function trialBundle(): RouteBundle {
  const built = buildRouteSpec(
    {
      name: 'Prueba de Leiria',
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', idFactory: () => 'trial00002' },
  );
  return { spec: built.normalized, contents: {} };
}

let wrapper: VueWrapper | null = null;
let fetchMock = vi.fn();

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
      { path: '/run', name: 'run', component: RunView },
      { path: '/run/summary', name: 'summary', component: Empty },
    ],
  });
  await router.push('/create/review');
  wrapper = mount(RouterView, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  return {
    view: wrapper,
    router,
    run: useRunStore(),
    ui: useUiStore(),
    settings: useSettingsStore(),
  };
}

const button = (view: VueWrapper, name: string) =>
  view.findAll('button').find((candidate) => candidate.text() === name);

beforeEach(async () => {
  applyLocale('es');
  fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  await db.del(KEYS.activeRun);
});

afterEach(() => {
  useRunStore().reset();
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe('RunView during a trial', () => {
  it('shows the "Prueba" chip and "Volver al editor" in the sim banner, with the controls open', async () => {
    const { view, router, run, ui, settings } = await setup();
    settings.simulation = false;
    expect(await run.startTrial(trialBundle())).toBe(true);
    await router.push({ name: 'run' });
    await flushPromises();

    const banner = view.get('.run__simbanner');
    expect(banner.classes()).toContain('is-trial');
    expect(banner.text()).toContain('Modo simulación: tu ubicación es simulada');
    expect(banner.get('.run__trialchip').text()).toBe('Prueba');
    expect(button(view, 'Volver al editor')?.exists()).toBe(true);
    // The simulation panel is open from the start.
    expect(view.find('section[aria-label="Simulación"]').exists()).toBe(true);

    await button(view, 'Volver al editor')?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-review'));
    await vi.waitFor(() => expect(ui.toasts[0]?.message).toEqual({ key: 'create.trial.ended' }));
    expect(run.trial).toBe(false);
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
  });

  it('leaving with Back ends the trial without asking', async () => {
    const { router, run, ui } = await setup();
    await run.startTrial(trialBundle());
    await router.push({ name: 'run' });
    await flushPromises();
    await router.push('/');
    await vi.waitFor(() => expect(run.trial).toBe(false));
    expect(router.currentRoute.value.name).toBe('home');
    expect(ui.confirms).toHaveLength(0);
    expect(run.trialResult?.kind).toBe('left');
  });
});

describe('RunView during a real simulated run', () => {
  it('has neither the chip nor the way back, and the controls start closed', async () => {
    const { view, router, run, settings } = await setup();
    settings.simulation = true;
    expect(await run.start('leiria-historica')).toBe(true);
    // Its start goes to the API (a trial's never does): wait for it while fetch is stubbed.
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/runs'))).toBe(true),
    );
    await router.push({ name: 'run' });
    await flushPromises();
    const banner = view.get('.run__simbanner');
    expect(banner.classes()).not.toContain('is-trial');
    expect(banner.find('.run__trialchip').exists()).toBe(false);
    expect(button(view, 'Volver al editor')).toBeUndefined();
    expect(view.find('section[aria-label="Simulación"]').exists()).toBe(false);
  });
});
