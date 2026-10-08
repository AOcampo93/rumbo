import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';
import RouteDetailView from '../src/views/RouteDetailView.vue';

// S03 · Route detail, actions of the user's own routes (design §4.6): "Editar
// ruta" and "Eliminar ruta" where the route is looked at before starting it,
// doing exactly what My routes does, and never on the curated routes.

// The map SDK isn't needed here (RouteMap has its own test).
vi.mock('../src/map/RouteMap.vue', async () => {
  const { defineComponent: define, h } = await import('vue');
  return {
    __esModule: true,
    default: define({
      name: 'RouteMap',
      setup(_, { expose }) {
        expose({ openPopup: () => undefined });
        return () => h('div', { class: 'map-stub' });
      },
    }),
  };
});

const Empty = defineComponent({ render: () => null });
const TOKEN = 'a'.repeat(43);
const NOT_FOUND = 'No encontramos esta ruta.';

/** A stored record of a two-place route, as the creator saves it. */
function record(id: string, patch: Partial<MyRouteRecord> = {}): MyRouteRecord {
  const built = buildRouteSpec(
    {
      name: `Ruta ${id}`,
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
    },
    { source: 'user', id },
  );
  return {
    id,
    editToken: TOKEN,
    bundle: { spec: built.spec, contents: {} },
    rev: 1,
    sync: 'synced',
    remote: 'yes',
    failures: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...patch,
  };
}

async function seed(...records: MyRouteRecord[]): Promise<void> {
  await db.set(KEYS.myRoutes, { v: 1, records: Object.fromEntries(records.map((r) => [r.id, r])) });
}

let wrapper: VueWrapper | null = null;

/**
 * Mounts the detail of `routeId`. `from` is the screen it was opened from:
 * it goes in the history before it, and in its state (`back`), like the
 * browser history does.
 */
async function setup(routeId: string, { from }: { from?: string } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/create/details', name: 'create-details', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/run', name: 'run', component: Empty },
    ],
  });
  if (from) await router.push(from);
  await router.push({ path: `/routes/${routeId}`, state: from ? { back: from } : {} });
  wrapper = mount(RouteDetailView, {
    props: { routeId },
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await vi.waitFor(() =>
    expect(wrapper?.find('.detail__sheet').exists() || wrapper?.text().includes(NOT_FOUND)).toBe(
      true,
    ),
  );
  await flushPromises();
  return {
    view: wrapper,
    router,
    ui: useUiStore(),
    creator: useCreatorStore(),
    run: useRunStore(),
    settings: useSettingsStore(),
  };
}

const actionButtons = (view: VueWrapper) => view.findAll('.detail__action');
const button = (view: VueWrapper, label: string) =>
  view.findAll('button').find((candidate) => candidate.text() === label);

beforeEach(async () => {
  applyLocale('es');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await db.clear();
});

afterEach(async () => {
  useRunStore().reset();
  wrapper?.unmount();
  wrapper = null;
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the route detail of a route made by the user', () => {
  it('offers "Editar ruta" and "Eliminar ruta" next to the facts, in the three languages', async () => {
    await seed(record('own-00000000001'));
    const { view } = await setup('own-00000000001');
    expect(view.get('h1').text()).toBe('Ruta own-00000000001');
    expect(actionButtons(view).map((action) => action.text())).toEqual([
      'Editar ruta',
      'Eliminar ruta',
    ]);
    // Between the stats and the list of points, and not inside the fixed footer with "Iniciar ruta".
    const actions = view.get('.detail__actions');
    expect(actions.element.previousElementSibling?.classList.contains('detail__stats')).toBe(true);
    expect(actions.element.closest('.detail__cta')).toBeNull();
    expect(view.get('.detail__cta').text()).toContain('Iniciar ruta');

    applyLocale('en');
    await view.vm.$nextTick();
    expect(actionButtons(view).map((action) => action.text())).toEqual([
      'Edit route',
      'Delete route',
    ]);
    applyLocale('pt');
    await view.vm.$nextTick();
    expect(actionButtons(view).map((action) => action.text())).toEqual([
      'Editar rota',
      'Eliminar rota',
    ]);
  });

  it('has no such buttons on the curated routes, nor when the route does not exist', async () => {
    await seed(record('own-00000000002'));
    const curated = await setup('leiria-historica');
    expect(curated.view.get('h1').text()).toBe('Leiria histórica');
    expect(curated.view.find('.detail__actions').exists()).toBe(false);
    expect(button(curated.view, 'Editar ruta')).toBeUndefined();
    curated.view.unmount();

    const missing = await setup('does-not-exist');
    expect(missing.view.text()).toContain(NOT_FOUND);
    expect(missing.view.find('.detail__actions').exists()).toBe(false);
  });

  it('edits the route: the creator opens on it, with the same asks and warnings as My routes', async () => {
    await seed(record('edit-00000000001'));
    const { view, ui, creator, router, run, settings } = await setup('edit-00000000001');

    // Another draft with content: replacing it is confirmed first, and both buttons wait.
    await creator.startNew();
    await creator.update({ name: 'Otro borrador' });
    await actionButtons(view)[0]?.trigger('click');
    await flushPromises();
    expect(ui.confirms[0]).toMatchObject({
      title: { key: 'create.draft.replaceTitle' },
      confirmLabel: { key: 'create.draft.replace' },
      destructive: true,
    });
    expect(actionButtons(view).map((action) => action.attributes('disabled'))).toEqual(['', '']);
    ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('route');
    expect(creator.draft?.name).toBe('Otro borrador');
    expect(actionButtons(view).map((action) => action.attributes('disabled'))).toEqual([
      undefined,
      undefined,
    ]);

    // A run of this route in progress: the editor opens and says the run keeps the old version.
    settings.simulation = true;
    expect(await run.start('edit-00000000001')).toBe(true);
    await actionButtons(view)[0]?.trigger('click');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-details'));
    expect(creator.draft).toMatchObject({
      editingId: 'edit-00000000001',
      name: 'Ruta edit-00000000001',
    });
    expect(ui.toasts[0]).toMatchObject({
      message: { key: 'myRoutes.activeRunEdit' },
      tone: 'warning',
    });
    expect(run.active).toBe(true);
  });

  it('edits the draft it already has for the route without asking', async () => {
    await seed(record('same-00000000001'));
    const { view, ui, creator, router } = await setup('same-00000000001');
    await creator.loadForEdit('same-00000000001');
    await creator.update({ name: 'Cambiada' });
    await actionButtons(view)[0]?.trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-details'));
    expect(ui.confirms).toHaveLength(0);
    expect(creator.draft?.name).toBe('Cambiada');
  });

  it('deletes the route after the destructive confirmation, and goes to My routes', async () => {
    await seed(
      record('keep-00000000001', { createdAt: '2026-10-02T10:00:00.000Z' }),
      record('gone-00000000001', { remote: 'no' }),
    );
    const { view, ui, creator, router } = await setup('gone-00000000001');
    // The draft that edits this route goes with it.
    await creator.loadForEdit('gone-00000000001');
    const replace = vi.spyOn(router, 'replace');

    await actionButtons(view)[1]?.trigger('click');
    await flushPromises();
    expect(ui.confirms).toHaveLength(1);
    expect(ui.confirms[0]).toMatchObject({
      title: { key: 'myRoutes.deleteTitle', params: { name: 'Ruta gone-00000000001' } },
      body: { key: 'myRoutes.deleteBody' },
      confirmLabel: { key: 'myRoutes.delete' },
      destructive: true,
      sourceLocale: 'es',
    });
    // Cancelled: nothing changes.
    ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('route');
    expect(await getMyRoute('gone-00000000001')).toBeDefined();
    expect(view.get('h1').text()).toBe('Ruta gone-00000000001');

    // Confirmed: the route is gone, with its draft, and this screen never says "not found".
    const seen: string[] = [];
    const watcher = new MutationObserver(() => seen.push(document.body.textContent ?? ''));
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    await actionButtons(view)[1]?.trigger('click');
    await flushPromises();
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('my-routes'));
    watcher.disconnect();
    expect(await getMyRoute('gone-00000000001')).toBeUndefined();
    expect(await getMyRoute('keep-00000000001')).toBeDefined();
    expect(creator.draft).toBeNull();
    expect(ui.toasts[0]?.message).toEqual({ key: 'myRoutes.deleted' });
    expect(ui.toasts[0]?.tone).toBe('success');
    expect(seen.some((text) => text.includes(NOT_FOUND))).toBe(false);
    // Opened from nowhere in particular: it replaces the detail in the history.
    expect(replace).toHaveBeenCalledWith('/my-routes');
  });

  it('goes back to My routes, instead of stacking another copy of it, when it came from there', async () => {
    await seed(record('back-00000000001', { remote: 'no' }));
    const { view, ui, router } = await setup('back-00000000001', { from: '/my-routes' });
    const replace = vi.spyOn(router, 'replace');
    const back = vi.spyOn(router, 'back');
    await actionButtons(view)[1]?.trigger('click');
    await flushPromises();
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('my-routes'));
    expect(back).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    // The history's second entry, My routes, is where it is now: nothing was added after it.
    expect(router.options.history.location).toBe('/my-routes');
  });

  it('ends the run of the route before deleting it, saying so in the dialog', async () => {
    await seed(record('running-00000001', { remote: 'no' }));
    const { view, ui, run, settings, router } = await setup('running-00000001');
    settings.simulation = true;
    expect(await run.start('running-00000001')).toBe(true);

    await actionButtons(view)[1]?.trigger('click');
    await flushPromises();
    const body = ui.confirms[0]?.body as Record<string, string>;
    expect(body.es).toBe(
      'Tienes un recorrido en curso de esta ruta. Al eliminarla, terminará.\n\n' +
        'Se borrará de este dispositivo y del servidor. No se puede deshacer.',
    );
    expect(body.en).toContain('Deleting it will end it.');
    expect(body.pt).toContain('vai terminar');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('my-routes'));
    expect(run.active).toBe(false);
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
  });

  it('says so, and stays on the route, when it could not be deleted', async () => {
    await seed(record('stuck-00000000001', { remote: 'no' }));
    const { view, ui, router } = await setup('stuck-00000000001');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db, 'update').mockRejectedValueOnce(new Error('storage is full'));
    await actionButtons(view)[1]?.trigger('click');
    await flushPromises();
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(ui.toasts).toHaveLength(1));
    expect(ui.toasts[0]).toMatchObject({ message: { key: 'errors.generic' }, tone: 'warning' });
    expect(router.currentRoute.value.name).toBe('route');
    expect(view.get('h1').text()).toBe('Ruta stuck-00000000001');
    expect(view.text()).not.toContain(NOT_FOUND);
    expect(actionButtons(view).map((action) => action.attributes('disabled'))).toEqual([
      undefined,
      undefined,
    ]);
    expect(await getMyRoute('stuck-00000000001')).toBeDefined();
  });
});
