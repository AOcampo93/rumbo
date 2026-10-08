import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useMyRouteActions } from '../src/composables/useMyRouteActions.ts';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { getMyRoute, type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import { useCreatorStore } from '../src/stores/creator.ts';
import { useUiStore } from '../src/stores/ui.ts';

// useMyRouteActions: what Edit, Delete and Retry resolve to, and the one-at-a-time
// rule, on their own (My routes and the route detail each have their own test).

const Empty = { render: () => null };
const Harness = defineComponent({ setup: () => useMyRouteActions(), render: () => null });
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
      { path: '/create/details', name: 'create-details', component: Empty },
    ],
  });
  await router.push('/');
  const mounted = mount(Harness, { global: { plugins: [pinia, router, i18n] } });
  wrapper = mounted;
  // Edit and Delete work from what the catalog and the creator know.
  await useCatalogStore().loadMine();
  await flushPromises();
  return {
    actions: mounted.vm,
    router,
    ui: useUiStore(),
    creator: useCreatorStore(),
  };
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useMyRouteActions', () => {
  it('edit opens the creator on the route, and says false when there is nothing to edit', async () => {
    await seed(record('known-0000000001'));
    const { actions, router, creator, ui } = await setup();
    // loadForEdit explains an unknown route with a toast and starts a new draft.
    expect(await actions.edit('unknown-000000001')).toBe(false);
    expect(router.currentRoute.value.name).toBe('home');
    expect(ui.toasts[0]).toMatchObject({ message: { key: 'route.notFound' }, tone: 'warning' });
    expect(actions.busy).toBeNull();

    expect(await actions.edit('known-0000000001')).toBe(true);
    expect(router.currentRoute.value.name).toBe('create-details');
    expect(creator.draft?.editingId).toBe('known-0000000001');
    expect(actions.busy).toBeNull();
  });

  it('edit asks before replacing a draft, and false is a declined replacement', async () => {
    await seed(record('known-0000000001'));
    const { actions, router, creator, ui } = await setup();
    await creator.startNew();
    await creator.update({ name: 'Otro borrador' });
    const declined = actions.edit('known-0000000001');
    await flushPromises();
    expect(ui.confirms).toHaveLength(1);
    ui.confirms[0]?.answer(false);
    expect(await declined).toBe(false);
    expect(router.currentRoute.value.name).toBe('home');
    expect(creator.draft?.name).toBe('Otro borrador');

    const accepted = actions.edit('known-0000000001');
    await flushPromises();
    ui.confirms[0]?.answer(true);
    expect(await accepted).toBe(true);
    expect(creator.draft?.editingId).toBe('known-0000000001');
  });

  it('does one thing at a time: a second action meanwhile does nothing', async () => {
    await seed(record('first-0000000001'), record('other-0000000001'));
    const { actions, creator, ui } = await setup();
    await creator.startNew();
    await creator.update({ name: 'Otro borrador' });
    const first = actions.edit('first-0000000001');
    await flushPromises();
    expect(actions.busy).toBe('first-0000000001');

    expect(await actions.edit('other-0000000001')).toBe(false);
    expect(await actions.remove({ id: 'other-0000000001', name: 'Otra', sourceLocale: 'es' })).toBe(
      false,
    );
    await actions.retry('other-0000000001');
    // Only the first action's dialog is open, and nothing was touched.
    expect(ui.confirms).toHaveLength(1);
    expect(await getMyRoute('other-0000000001')).toMatchObject({ rev: 1 });

    ui.confirms[0]?.answer(false);
    expect(await first).toBe(false);
    expect(actions.busy).toBeNull();
  });

  it('remove resolves true once the route is gone, with the name in its dialog', async () => {
    await seed(record('gone-00000000001', { remote: 'no' }), record('stay-0000000001'));
    const { actions, ui } = await setup();
    const name = { es: 'Mi ruta', en: 'My route' };
    const removing = actions.remove({ id: 'gone-00000000001', name, sourceLocale: 'es' });
    await flushPromises();
    expect(ui.confirms[0]).toMatchObject({
      title: { key: 'myRoutes.deleteTitle', params: { name } },
      body: { key: 'myRoutes.deleteBody' },
      destructive: true,
      sourceLocale: 'es',
    });
    // Busy only starts once the user has confirmed: the dialog itself is the wait.
    expect(actions.busy).toBeNull();
    ui.confirms[0]?.answer(true);
    expect(await removing).toBe(true);
    expect(await getMyRoute('gone-00000000001')).toBeUndefined();
    expect(await getMyRoute('stay-0000000001')).toBeDefined();
    expect(ui.toasts[0]?.message).toEqual({ key: 'myRoutes.deleted' });
    expect(actions.busy).toBeNull();
  });

  it('remove resolves false when declined, and names a route it cannot read as "this route"', async () => {
    await seed(record('keep-00000000001'));
    const { actions, ui } = await setup();
    const removing = actions.remove({ id: 'keep-00000000001', name: null, sourceLocale: 'pt' });
    await flushPromises();
    expect(ui.confirms[0]?.title).toEqual({ key: 'myRoutes.deleteThisTitle' });
    expect(ui.confirms[0]?.sourceLocale).toBe('pt');
    ui.confirms[0]?.answer(false);
    expect(await removing).toBe(false);
    expect(await getMyRoute('keep-00000000001')).toBeDefined();
    expect(ui.toasts).toHaveLength(0);
  });

  it('remove resolves false, with a warning toast, when the storage fails', async () => {
    await seed(record('stuck-00000000001', { remote: 'no' }));
    const { actions, ui } = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db, 'update').mockRejectedValueOnce(new Error('storage is full'));
    const removing = actions.remove({ id: 'stuck-00000000001', name: 'Ruta', sourceLocale: 'es' });
    await flushPromises();
    ui.confirms[0]?.answer(true);
    expect(await removing).toBe(false);
    expect(ui.toasts[0]).toMatchObject({ message: { key: 'errors.generic' }, tone: 'warning' });
    expect(actions.busy).toBeNull();
    expect(await getMyRoute('stuck-00000000001')).toBeDefined();
  });

  it('retry puts a failed upload back in the queue', async () => {
    await seed(record('retry-0000000001', { sync: 'error', error: 'unavailable', remote: 'no' }));
    const { actions } = await setup();
    await actions.retry('retry-0000000001');
    expect(actions.busy).toBeNull();
    expect((await getMyRoute('retry-0000000001'))?.rev).toBeGreaterThan(1);
  });
});
