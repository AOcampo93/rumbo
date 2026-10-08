import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useUiStore } from '../src/stores/ui.ts';
import MyRoutesView from '../src/views/MyRoutesView.vue';

// S02 · My routes: next to the ⋯ menu, each card has a visible "Editar" button
// (the owner could not find the menu). A route whose upload failed has its own
// button on its status line instead, and an unreadable one can only be deleted.

const Empty = defineComponent({ render: () => null });
const TOKEN = 'a'.repeat(43);

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

async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/my-routes', name: 'my-routes', component: Empty },
      { path: '/create', name: 'create', component: Empty },
      { path: '/create/details', name: 'create-details', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
    ],
  });
  await router.push('/my-routes');
  wrapper = mount(MyRoutesView, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await vi.waitFor(() => expect(wrapper?.find('[aria-busy="true"]').exists()).toBe(false));
  await flushPromises();
  return { view: wrapper, router, ui: useUiStore(), creator: useCreatorStore() };
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
  wrapper?.unmount();
  wrapper = null;
  await routeSyncIdle();
  vi.unstubAllGlobals();
});

describe('My routes, the visible "Editar" button', () => {
  it('is on the card of every route that uploaded or is waiting to, named after its route', async () => {
    await seed(
      record('synced-0000000001', { createdAt: '2026-10-05T10:00:00.000Z' }),
      record('pending-000000001', {
        sync: 'pending',
        remote: 'no',
        createdAt: '2026-10-04T10:00:00.000Z',
      }),
      record('invalid-000000001', {
        sync: 'error',
        error: 'invalid_route',
        createdAt: '2026-10-03T10:00:00.000Z',
      }),
      record('failed-0000000001', {
        sync: 'error',
        error: 'unavailable',
        createdAt: '2026-10-02T10:00:00.000Z',
      }),
    );
    const { view } = await setup();
    const edits = view.findAll('.item').map((item) => item.find('.item__edit'));
    expect(edits.map((edit) => edit.exists())).toEqual([true, true, false, false]);
    const [synced, pending] = edits;
    expect(synced?.text()).toBe('Editar');
    expect(synced?.attributes('aria-label')).toBe('Editar: Ruta synced-0000000001');
    expect(pending?.attributes('aria-label')).toBe('Editar: Ruta pending-000000001');
    // Outside the card's link (a link can't hold a button), under its status line.
    expect(synced?.element.closest('a')).toBeNull();
    const pendingItem = view.findAll('.item')[1];
    expect(pendingItem?.element.lastElementChild).toBe(pending?.element);
    expect(pendingItem?.element.querySelector('.item__status')).not.toBeNull();
    // The failed uploads keep their own action, named after their route too.
    expect(
      view.findAll('.item__statusaction').map((action) => action.attributes('aria-label')),
    ).toEqual(['Editar: Ruta invalid-000000001', 'Reintentar: Ruta failed-0000000001']);
    // And the ⋯ menu is still there on every card, with the same name.
    expect(
      view.findAll('[aria-haspopup="menu"]').map((menu) => menu.attributes('aria-label')),
    ).toEqual([
      'Opciones de Ruta synced-0000000001',
      'Opciones de Ruta pending-000000001',
      'Opciones de Ruta invalid-000000001',
      'Opciones de Ruta failed-0000000001',
    ]);
  });

  it('follows the language', async () => {
    await seed(record('lang-00000000001'));
    const { view } = await setup();
    applyLocale('en');
    await view.vm.$nextTick();
    expect(view.get('.item__edit').text()).toBe('Edit');
    expect(view.get('.item__edit').attributes('aria-label')).toBe('Edit: Ruta lang-00000000001');
    applyLocale('pt');
    await view.vm.$nextTick();
    expect(view.get('.item__edit').text()).toBe('Editar');
    expect(view.get('.item__edit').attributes('aria-label')).toBe('Editar: Ruta lang-00000000001');
  });

  it('opens the creator on that route, asking before it replaces another draft', async () => {
    await seed(
      record('first-00000000001', { createdAt: '2026-10-02T10:00:00.000Z' }),
      record('second-0000000001', { createdAt: '2026-10-01T10:00:00.000Z' }),
    );
    const { view, router, ui, creator } = await setup();
    await creator.startNew();
    await creator.update({ name: 'Otro borrador' });

    await view.findAll('.item__edit')[1]?.trigger('click');
    await flushPromises();
    expect(ui.confirms[0]).toMatchObject({ title: { key: 'create.draft.replaceTitle' } });
    // Nothing else can start while the question is open.
    expect(view.findAll('.item__edit').map((edit) => edit.attributes('disabled'))).toEqual([
      '',
      '',
    ]);
    ui.confirms[0]?.answer(false);
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('my-routes');
    expect(view.findAll('.item__edit').map((edit) => edit.attributes('disabled'))).toEqual([
      undefined,
      undefined,
    ]);

    await view.findAll('.item__edit')[1]?.trigger('click');
    ui.confirms[0]?.answer(true);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('create-details'));
    expect(creator.draft).toMatchObject({
      editingId: 'second-0000000001',
      name: 'Ruta second-0000000001',
    });
  });

  it('is not offered for a route that no longer validates', async () => {
    const broken = record('broken-000000001');
    (broken.bundle.spec as { points: unknown[] }).points = [];
    await seed(broken);
    const { view } = await setup();
    expect(view.find('.item__edit').exists()).toBe(false);
    expect(view.find('.item__brokendelete').exists()).toBe(true);
  });
});
