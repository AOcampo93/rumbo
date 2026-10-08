import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useRunStore } from '../src/stores/run.ts';
import { useSettingsStore } from '../src/stores/settings.ts';
import { useUiStore } from '../src/stores/ui.ts';
import MyRoutesView from '../src/views/MyRoutesView.vue';

// S02 · My routes (design §4.6): loading, empty, one row per route with its
// upload state, unreadable records, and the Edit / Delete / Retry flows.

const Empty = defineComponent({ render: () => null });
const TOKEN = 'a'.repeat(43);

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

async function setup({ wait = true } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/create', name: 'create', component: Empty },
      { path: '/create/details', name: 'create-details', component: Empty },
      { path: '/create/review', name: 'create-review', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
      { path: '/run', name: 'run', component: Empty },
      { path: '/run/summary', name: 'summary', component: Empty },
    ],
  });
  await router.push('/my-routes');
  wrapper = mount(MyRoutesView, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  if (wait)
    await vi.waitFor(() => expect(wrapper?.find('[aria-busy="true"]').exists()).toBe(false));
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

/** The visible rows: each card's title, and its status line if any. */
function rows(view: VueWrapper) {
  return view.findAll('.item').map((item) => ({
    name: item.find('.card__title').exists() ? item.get('.card__title').text() : null,
    status: item.find('.item__status').exists() ? item.get('.item__status').text() : null,
  }));
}

/** Opens a row's ⋯ menu and picks an entry. */
async function pick(view: VueWrapper, rowIndex: number, label: string): Promise<void> {
  const triggers = view.findAll('[aria-haspopup="menu"]');
  await triggers[rowIndex]?.trigger('click');
  for (let i = 0; i < 4; i++) await nextTick();
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.trim() === label,
  );
  item?.click();
  await flushPromises();
}

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
  vi.unstubAllGlobals();
});

describe('My routes', () => {
  it('shows skeletons while the registry loads', async () => {
    await seed(record('uno-0000000001'));
    const { view } = await setup({ wait: false });
    expect(view.find('[aria-busy="true"]').exists()).toBe(true);
    expect(view.findAll('.skeleton')).toHaveLength(2);
    await vi.waitFor(() => expect(view.findAll('.item')).toHaveLength(1));
    expect(view.find('.skeleton').exists()).toBe(false);
  });

  it('shows the empty state with its call to action, and no header button', async () => {
    const { view, router } = await setup();
    expect(view.text()).toContain('Crea tu primera ruta');
    expect(view.findAll('.item')).toHaveLength(0);
    const buttons = view.findAll('button').map((button) => button.text());
    expect(buttons).toEqual(['Crear ruta']);
    await view.get('button').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('create');
  });

  it('lists the routes newest first, with their upload state', async () => {
    await seed(
      record('synced-0000000001', { createdAt: '2026-10-05T10:00:00.000Z' }),
      record('pending-000000001', {
        sync: 'pending',
        remote: 'no',
        createdAt: '2026-10-06T10:00:00.000Z',
      }),
      record('invalid-000000001', {
        sync: 'error',
        error: 'invalid_route',
        createdAt: '2026-10-04T10:00:00.000Z',
      }),
      record('quota-00000000001', {
        sync: 'error',
        error: 'quota_exceeded',
        createdAt: '2026-10-03T10:00:00.000Z',
      }),
      record('failed-0000000001', {
        sync: 'error',
        error: 'unavailable',
        createdAt: '2026-10-02T10:00:00.000Z',
      }),
    );
    const { view } = await setup();
    expect(rows(view)).toEqual([
      {
        name: 'Ruta pending-000000001',
        status: 'Solo en este dispositivo · se subirá al conectar',
      },
      { name: 'Ruta synced-0000000001', status: null },
      {
        name: 'Ruta invalid-000000001',
        status: 'El servidor rechazó la ruta. Edítala y guárdala de nuevo. Editar',
      },
      {
        name: 'Ruta quota-00000000001',
        status: 'Has llegado al máximo de rutas en el servidor. Reintentar',
      },
      { name: 'Ruta failed-0000000001', status: 'No se pudo subir Reintentar' },
    ]);
    // Every card says it is the user's, and its menu is outside the card's link.
    expect(view.findAll('.card__badge--mine').map((badge) => badge.text())).toEqual(
      Array(5).fill('Creada por ti'),
    );
    const menu = view.get('[aria-haspopup="menu"]');
    expect(menu.attributes('aria-label')).toBe('Opciones de Ruta pending-000000001');
    expect(menu.element.closest('a')).toBeNull();
    // The status buttons name their route.
    expect(view.get('.item__statusaction').attributes('aria-label')).toBe(
      'Editar: Ruta invalid-000000001',
    );
    expect(view.text()).toContain('Nueva ruta');
  });

  it('offers only Delete for a record that no longer validates', async () => {
    const broken = record('broken-000000001');
    (broken.bundle.spec as { points: unknown[] }).points = [];
    await seed(broken);
    const { view, ui } = await setup();
    const item = view.get('.item');
    expect(item.text()).toContain('Ruta broken-000000001');
    expect(item.text()).toContain('No podemos abrir esta ruta.');
    expect(item.find('[aria-haspopup="menu"]').exists()).toBe(false);
    await item.get('.item__brokendelete').trigger('click');
    await flushPromises();
    expect(ui.confirms[0]?.title).toEqual({
      key: 'myRoutes.deleteTitle',
      params: { name: 'Ruta broken-000000001' },
    });
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(view.findAll('.item')).toHaveLength(0));
  });

  it('deletes a route after the destructive confirmation', async () => {
    await seed(
      record('keep-00000000001', { createdAt: '2026-10-02T10:00:00.000Z' }),
      record('gone-00000000001', { remote: 'no', createdAt: '2026-10-01T10:00:00.000Z' }),
    );
    const { view, ui } = await setup();
    expect(rows(view).map((row) => row.name)).toEqual([
      'Ruta keep-00000000001',
      'Ruta gone-00000000001',
    ]);

    await pick(view, 1, 'Eliminar');
    expect(ui.confirms).toHaveLength(1);
    expect(ui.confirms[0]).toMatchObject({
      title: { key: 'myRoutes.deleteTitle' },
      body: { key: 'myRoutes.deleteBody' },
      confirmLabel: { key: 'myRoutes.delete' },
      destructive: true,
    });
    // Cancelled: nothing changes.
    ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(view.findAll('.item')).toHaveLength(2);

    await pick(view, 1, 'Eliminar');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(view.findAll('.item')).toHaveLength(1));
    expect(rows(view)[0]?.name).toBe('Ruta keep-00000000001');
    expect(await getMyRoute('gone-00000000001')).toBeUndefined();
    expect(ui.toasts[0]?.message).toEqual({ key: 'myRoutes.deleted' });
    // Focus goes back to the title, not to the body of the page.
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('ends the run of a route before deleting it, saying so in the dialog', async () => {
    await seed(record('running-00000001', { remote: 'no' }));
    const { view, ui, run, settings } = await setup();
    settings.simulation = true;
    expect(await run.start('running-00000001')).toBe(true);
    expect(run.active).toBe(true);

    await pick(view, 0, 'Eliminar');
    const body = ui.confirms[0]?.body as Record<string, string>;
    expect(body.es).toBe(
      'Tienes un recorrido en curso de esta ruta. Al eliminarla, terminará.\n\n' +
        'Se borrará de este dispositivo y del servidor. No se puede deshacer.',
    );
    expect(body.en).toContain('Deleting it will end it.');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(view.findAll('.item')).toHaveLength(0));
    expect(run.active).toBe(false);
    expect(await db.get(KEYS.activeRun)).toBeUndefined();
  });

  it('retries an upload that failed', async () => {
    await seed(record('retry-0000000001', { sync: 'error', error: 'unavailable', remote: 'no' }));
    const { view } = await setup();
    await view.get('.item__statusaction').trigger('click');
    await vi.waitFor(() =>
      expect(rows(view)[0]?.status).toBe('Solo en este dispositivo · se subirá al conectar'),
    );
    expect((await getMyRoute('retry-0000000001'))?.rev).toBeGreaterThan(1);
  });

  it('edits a route, asking before it replaces another draft', async () => {
    await seed(record('edit-00000000001'));
    const { view, ui, creator, router } = await setup();
    await creator.startNew();
    await creator.update({ name: 'Otro borrador' });

    await pick(view, 0, 'Editar');
    expect(ui.confirms[0]).toMatchObject({
      title: { key: 'create.draft.replaceTitle' },
      confirmLabel: { key: 'create.draft.replace' },
    });
    ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('my-routes');
    expect(creator.draft?.name).toBe('Otro borrador');

    await pick(view, 0, 'Editar');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-details'));
    expect(creator.draft).toMatchObject({
      editingId: 'edit-00000000001',
      name: 'Ruta edit-00000000001',
    });
  });

  it('edits the draft it already has for that route without asking', async () => {
    await seed(record('same-00000000001', { sync: 'error', error: 'invalid_route' }));
    const { view, ui, creator, router } = await setup();
    await creator.loadForEdit('same-00000000001');
    await creator.update({ name: 'Cambiada' });
    await view.get('.item__statusaction').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-details'));
    expect(ui.confirms).toHaveLength(0);
    expect(creator.draft?.name).toBe('Cambiada');
  });
});
