import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import {
  type AnalyticsEvent,
  clearAnalytics,
  initAnalytics,
  stopAnalytics,
} from '../src/services/analytics.ts';
import {
  getMyRoute,
  type MyRouteRecord,
  routeSyncIdle,
  syncMyRoutes,
} from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useUiStore } from '../src/stores/ui.ts';
import RouteDetailView from '../src/views/RouteDetailView.vue';
import { json } from './create-fixtures.ts';

// S03 · Route detail, publishing an own route (phase 7.2, ADR 0004): the line
// that says who sees it (private, published, hidden by reports, taken down),
// "Publicar" / "Dejar de publicar" beside Edit and Delete, the toasts, the
// analytics without anything that tells the route, and the moderation state
// the API reports for a published route.

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
const ID = 'own-00000000001';

/** A stored record of a two-place route, as the creator saves it. */
function record(patch: Partial<MyRouteRecord> = {}, id = ID): MyRouteRecord {
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

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { visibility?: string } | undefined;
}

/**
 * The API: what GET /routes/:id/status says (`status`, or a failure when
 * null), and a 200 for every route write. Everything else is a 503.
 */
function stubApi(status: { moderation: string } | null = { moderation: 'visible' }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? (JSON.parse(String(init.body)) as Call['body']) : undefined,
      };
      calls.push(call);
      if (call.method === 'GET' && url.endsWith('/status')) {
        return status
          ? json({ visibility: 'public', publishedAt: '2026-10-09T10:00:00.000Z', ...status })
          : json({ code: 'route_not_found' }, 404);
      }
      if (call.method === 'PUT' || call.method === 'POST') {
        return json({ id: ID, updatedAt: '2026-10-09T10:00:00.000Z' });
      }
      return new Response(null, { status: 503 });
    }),
  );
  return calls;
}

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

let wrapper: VueWrapper | null = null;

async function setup(routeId = ID) {
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
  await router.push(`/routes/${routeId}`);
  wrapper = mount(RouteDetailView, {
    props: { routeId },
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  await vi.waitFor(() => expect(wrapper?.find('.detail__sheet').exists()).toBe(true));
  await flushPromises();
  const ui = useUiStore();
  // "Publicar" asks first (the privacy warning); these tests accept unless they say otherwise.
  const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
  return { view: wrapper, ui, confirm };
}

const status = (view: VueWrapper) => view.get('.detail__status');
const button = (view: VueWrapper, label: string) =>
  view.findAll('button').find((candidate) => candidate.text() === label);
const statusCalls = (calls: Call[]) => calls.filter((call) => call.url.endsWith('/status'));
const analyticsEvents = async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return (await db.get<AnalyticsEvent[]>(KEYS.analyticsQueue)) ?? [];
};

beforeEach(async () => {
  applyLocale('es');
  stubApi();
  await db.clear();
  await initAnalytics(() => true);
  clearAnalytics();
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  stopAnalytics();
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('who sees an own route', () => {
  it('says a new route is private, and offers to publish it beside Edit and Delete', async () => {
    const calls = stubApi();
    await seed(record());
    const { view } = await setup();
    expect(status(view).text()).toBe('Privada: solo tú la ves.');
    // The same row, and the same style, as Edit and Delete (they stack on a narrow screen).
    const actions = view.get('.detail__actions');
    expect(actions.findAll('button').map((candidate) => candidate.text())).toEqual([
      'Publicar',
      'Editar ruta',
      'Eliminar ruta',
    ]);
    expect(actions.element.previousElementSibling?.classList.contains('detail__stats')).toBe(true);
    // Edit and Delete are still the two `detail__action` buttons; nothing is asked for a private route.
    expect(view.findAll('.detail__action').map((action) => action.text())).toEqual([
      'Editar ruta',
      'Eliminar ruta',
    ]);
    expect(statusCalls(calls)).toEqual([]);
  });

  it('publishes it: a toast, the new state at once, and a PUT with the visibility', async () => {
    const calls = stubApi();
    await seed(record());
    const { view, ui } = await setup();
    await button(view, 'Publicar')?.trigger('click');
    await vi.waitFor(() => expect(ui.toasts).toHaveLength(1));

    expect(ui.toasts[0]).toMatchObject({
      message: { key: 'route.publishedToast' },
      tone: 'success',
    });
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
    expect(button(view, 'Publicar')).toBeUndefined();
    expect(button(view, 'Dejar de publicar')).toBeDefined();
    expect(await getMyRoute(ID)).toMatchObject({ visibility: 'public', rev: 2 });

    await routeSyncIdle();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put).toMatchObject({ url: `/api/v1/routes/${ID}`, body: { visibility: 'public' } });
    expect(put?.headers['x-edit-token']).toBe(TOKEN);
    expect(await getMyRoute(ID)).toMatchObject({ sync: 'synced' });

    // Counted, without anything that tells which route it was.
    const events = (await analyticsEvents()).filter((event) => event.name.startsWith('route_'));
    expect(events.map((event) => [event.name, event.props])).toEqual([['route_published', {}]]);
  });

  it('asks before publishing, with the creator’s privacy warning, and does nothing if cancelled', async () => {
    const calls = stubApi();
    await seed(record());
    const { view, ui, confirm } = await setup();
    confirm.mockResolvedValueOnce(false);
    await button(view, 'Publicar')?.trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1);
    const [dialog] = confirm.mock.calls[0] ?? [];
    expect(dialog).toMatchObject({
      title: { key: 'route.publishConfirm' },
      confirmLabel: { key: 'route.publish' },
      cancelLabel: { key: 'common.cancel' },
    });
    expect(dialog?.destructive).toBeFalsy();
    expect((dialog?.body as Record<string, string> | undefined)?.es).toBe(
      'Quien use Rumbo cerca podrá verla y recorrerla, sin saber quién la creó.\n\n' +
        'Lo verán desconocidos: no incluyas tu casa ni datos personales.',
    );
    // Cancelled: still private, nothing stored, sent, said or counted.
    expect(status(view).text()).toBe('Privada: solo tú la ves.');
    expect(await getMyRoute(ID)).toMatchObject({ visibility: 'private', rev: 1 });
    expect(ui.toasts).toHaveLength(0);
    await routeSyncIdle();
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
    const events = (await analyticsEvents()).filter((event) => event.name.startsWith('route_'));
    expect(events).toEqual([]);
  });

  it('takes it back without asking: a toast and a PUT with the route private again', async () => {
    const calls = stubApi();
    await seed(record({ visibility: 'public' }));
    const { view, ui, confirm } = await setup();
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
    await button(view, 'Dejar de publicar')?.trigger('click');
    await vi.waitFor(() => expect(ui.toasts).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();

    expect(ui.toasts[0]).toMatchObject({
      message: { key: 'route.unpublishedToast' },
      tone: 'success',
    });
    expect(status(view).text()).toBe('Privada: solo tú la ves.');
    expect(button(view, 'Publicar')).toBeDefined();
    await routeSyncIdle();
    expect(calls.find((call) => call.method === 'PUT')?.body?.visibility).toBe('private');
    const events = (await analyticsEvents()).filter((event) => event.name.startsWith('route_'));
    expect(events.map((event) => [event.name, event.props])).toEqual([['route_unpublished', {}]]);
  });

  it('works without a connection: the route waits, and the line is honest about it', async () => {
    setOnline(false);
    stubApi();
    await seed(record());
    const { view } = await setup();
    await button(view, 'Publicar')?.trigger('click');
    await vi.waitFor(async () =>
      expect(await getMyRoute(ID)).toMatchObject({ visibility: 'public', sync: 'pending' }),
    );
    expect(status(view).text()).toBe('Se publicará cuando vuelva la conexión.');

    // Back online it uploads, and the line says it is published.
    setOnline(true);
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.'),
    );
  });

  it('says so when the visibility could not be saved on the device', async () => {
    await seed(record());
    const { view, ui } = await setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db, 'update').mockRejectedValueOnce(new Error('storage is full'));
    await button(view, 'Publicar')?.trigger('click');
    await vi.waitFor(() => expect(ui.toasts).toHaveLength(1));
    expect(ui.toasts[0]).toMatchObject({ message: { key: 'errors.generic' }, tone: 'warning' });
    expect(status(view).text()).toBe('Privada: solo tú la ves.');
    expect(button(view, 'Publicar')?.attributes('disabled')).toBeUndefined();
  });

  it('follows the language', async () => {
    await seed(record());
    const { view } = await setup();
    applyLocale('en');
    await flushPromises();
    expect(status(view).text()).toBe('Private: only you can see it.');
    expect(view.findAll('.detail__actions button').map((b) => b.text())).toEqual([
      'Publish',
      'Edit route',
      'Delete route',
    ]);
    await button(view, 'Publish')?.trigger('click');
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Published: anyone using Rumbo nearby can see it.'),
    );
    expect(button(view, 'Unpublish')).toBeDefined();
    applyLocale('pt');
    await flushPromises();
    expect(status(view).text()).toBe('Publicada: quem usar o Rumbo por perto pode vê-la.');
    expect(button(view, 'Deixar de publicar')).toBeDefined();
  });
});

describe('what the API says about a published route', () => {
  it('is asked on opening, with the route token, and a visible route says "Publicada"', async () => {
    const calls = stubApi({ moderation: 'visible' });
    await seed(record({ visibility: 'public' }));
    const { view } = await setup();
    await vi.waitFor(() => expect(statusCalls(calls)).toHaveLength(1));
    expect(statusCalls(calls)[0]).toMatchObject({
      method: 'GET',
      url: `/api/v1/routes/${ID}/status`,
    });
    expect(statusCalls(calls)[0]?.headers['x-edit-token']).toBe(TOKEN);
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
    expect(status(view).classes()).not.toContain('is-warning');
  });

  it('shows a route hidden by reports', async () => {
    stubApi({ moderation: 'hidden' });
    await seed(record({ visibility: 'public' }));
    const { view } = await setup();
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Oculta por reportes: la revisaremos.'),
    );
    expect(status(view).classes()).toContain('is-warning');
    // It can still be taken back.
    expect(button(view, 'Dejar de publicar')).toBeDefined();
  });

  it('shows a route taken down by moderation', async () => {
    stubApi({ moderation: 'blocked' });
    await seed(record({ visibility: 'public' }));
    const { view } = await setup();
    await vi.waitFor(() => expect(status(view).text()).toBe('Retirada por moderación.'));
    expect(status(view).classes()).toContain('is-warning');
  });

  it('is asked once per visit: not again when the route uploads, nor for a route published meanwhile', async () => {
    const calls = stubApi({ moderation: 'visible' });
    await seed(
      record({ visibility: 'public', sync: 'pending', rev: 2 }),
      record({}, 'own-00000000002'),
    );
    const { view } = await setup();
    await vi.waitFor(() => expect(statusCalls(calls)).toHaveLength(1));
    // The upload finishes, and the user takes the route back and publishes it again.
    await syncMyRoutes();
    await button(view, 'Dejar de publicar')?.trigger('click');
    await vi.waitFor(() => expect(status(view).text()).toBe('Privada: solo tú la ves.'));
    await button(view, 'Publicar')?.trigger('click');
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.'),
    );
    await routeSyncIdle();
    expect(statusCalls(calls)).toHaveLength(1);

    // A private route the user publishes while looking at it is not asked about either.
    view.unmount();
    wrapper = null;
    const other = await setup('own-00000000002');
    await button(other.view, 'Publicar')?.trigger('click');
    await vi.waitFor(() =>
      expect(status(other.view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.'),
    );
    await routeSyncIdle();
    expect(statusCalls(calls)).toHaveLength(1);
  });

  it('remembers what it learned while the user takes the route back and publishes it again', async () => {
    stubApi({ moderation: 'hidden' });
    await seed(record({ visibility: 'public' }));
    const { view } = await setup();
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Oculta por reportes: la revisaremos.'),
    );
    await button(view, 'Dejar de publicar')?.trigger('click');
    await vi.waitFor(() => expect(status(view).text()).toBe('Privada: solo tú la ves.'));
    // Publishing doesn't change the moderation: the route is still hidden.
    await button(view, 'Publicar')?.trigger('click');
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Oculta por reportes: la revisaremos.'),
    );
  });

  it("is not asked for a route the server doesn't have yet", async () => {
    const calls = stubApi({ moderation: 'hidden' });
    await seed(record({ visibility: 'public', remote: 'no', sync: 'pending' }));
    const { view } = await setup();
    await flushPromises();
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
    expect(statusCalls(calls)).toEqual([]);
  });

  it('keeps what the device knows when the API cannot tell', async () => {
    const calls = stubApi(null);
    await seed(record({ visibility: 'public' }));
    const { view } = await setup();
    await vi.waitFor(() => expect(statusCalls(calls)).toHaveLength(1));
    await flushPromises();
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
  });

  it('is not asked offline, nor for a private route', async () => {
    setOnline(false);
    const calls = stubApi({ moderation: 'hidden' });
    await seed(record({ visibility: 'public' }), record({}, 'own-00000000002'));
    const { view } = await setup();
    expect(status(view).text()).toBe('Publicada: la ven quienes usen Rumbo cerca.');
    view.unmount();
    wrapper = null;
    setOnline(true);
    await setup('own-00000000002');
    expect(statusCalls(calls)).toEqual([]);
  });

  it('is forgotten for the next route: a hidden one does not mark another', async () => {
    stubApi({ moderation: 'hidden' });
    await seed(
      record({ visibility: 'public' }),
      record({ visibility: 'public', createdAt: '2026-10-02T10:00:00.000Z' }, 'own-00000000003'),
    );
    const { view } = await setup();
    await vi.waitFor(() => expect(status(view).classes()).toContain('is-warning'));
    await view.setProps({ routeId: 'own-00000000003' });
    // The new route's own answer decides (hidden here too), never the previous one's.
    await vi.waitFor(() =>
      expect(status(view).text()).toBe('Oculta por reportes: la revisaremos.'),
    );
  });
});
