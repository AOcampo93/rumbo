import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import leiria from '../../../data/routes/leiria-historica.json';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useUiStore } from '../src/stores/ui.ts';
import HomeView from '../src/views/HomeView.vue';
import { json } from './create-fixtures.ts';

// S01 · Explore with the community's routes (phase 7.2, ADR 0004): where the
// user is known, the routes published around them come after the curated
// ones, in the list and on the map. The position is read by itself only when
// the browser already has the user's yes; otherwise a small card invites them
// to tap "Mi ubicación". A failure never breaks Explore.

// The map SDK isn't needed here (RouteMap has its own test). The stub keeps
// the props the screen hands to the map, and answers goTo().
const map = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock('../src/map/RouteMap.vue', async () => {
  const { defineComponent: define, h } = await import('vue');
  return {
    __esModule: true,
    default: define({
      name: 'RouteMap',
      props: ['markers', 'fit', 'fitZoom', 'user', 'theme', 'large', 'label'],
      emits: ['action'],
      setup(_, { expose, slots }) {
        expose({ goTo: map.goTo });
        return () => h('div', { class: 'map-stub' }, slots['default']?.());
      },
    }),
  };
});

const Empty = defineComponent({ render: () => null });
const LEIRIA = { latitude: 39.74362, longitude: -8.80711 };
const PORTO = { latitude: 41.1496, longitude: -8.6109 };
const NEAR_LEIRIA = '/api/v1/routes?near=39.744,-8.807';
const NEAR_PORTO = '/api/v1/routes?near=41.150,-8.611';
const TITLE = 'De la comunidad, cerca de ti';

function bundleOf(id: string, name: string, extra: Record<string, unknown> = {}) {
  const built = buildRouteSpec(
    {
      name,
      locale: 'es',
      mode: 'free',
      activity: 'walk',
      places: [
        { tempId: 'a', name: 'Castelo', position: { lat: 39.7473, lng: -8.8077 } },
        { tempId: 'b', name: 'Sé', position: { lat: 39.7448, lng: -8.8079 } },
      ],
      ...extra,
    },
    { source: 'user', id },
  );
  return { spec: built.spec, contents: {} };
}

type Answer = Response | Promise<Response>;

/** The API: the curated route and, by URL, whatever a test adds. Everything else is a 404. */
function stubApi(routes: Record<string, () => Answer> = {}): string[] {
  const table: Record<string, () => Answer> = {
    '/api/v1/routes': () => json([{ id: 'leiria-historica' }]),
    '/api/v1/routes/leiria-historica': () => json(leiria),
    ...routes,
  };
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      return table[url]?.() ?? json({ code: 'not_found' }, 404);
    }),
  );
  return asked;
}

/** Two community routes near Leiria, as the API lists them. */
const around = () => ({
  [NEAR_LEIRIA]: () =>
    json([{ id: 'leiria-historica' }, { id: 'paseo-aaaa' }, { id: 'paseo-bbbb' }]),
  '/api/v1/routes/paseo-aaaa': () => json(bundleOf('paseo-aaaa', 'Paseo del río')),
  '/api/v1/routes/paseo-bbbb': () =>
    json(bundleOf('paseo-bbbb', 'Paseo del parque', { mode: 'challenge' })),
});

/** The browser's geolocation: `position` answers every request (null: the user refuses). */
function stubGeolocation(position: { latitude: number; longitude: number } | null = LEIRIA) {
  const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((ok, fail) => {
    if (position) {
      ok({ coords: { ...position, accuracy: 30 } } as GeolocationPosition);
    } else {
      fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    }
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

/** What the Permissions API says about geolocation (undefined: the browser has no such API). */
function stubPermission(state: PermissionState | 'throws' | undefined) {
  const query = vi.fn(async () => {
    if (state === 'throws') throw new TypeError('Unsupported permission name');
    return { state } as PermissionStatus;
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: state === undefined ? undefined : { query },
  });
  return query;
}

function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

function ownRoute(id: string, patch: Partial<MyRouteRecord> = {}): MyRouteRecord {
  return {
    id,
    editToken: 'a'.repeat(43),
    bundle: bundleOf(id, 'Mi ruta'),
    rev: 1,
    sync: 'synced',
    remote: 'yes',
    failures: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    visibility: 'public',
    ...patch,
  };
}

let wrapper: VueWrapper | null = null;

async function open({ settle = true } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Empty },
      { path: '/create', name: 'create', component: Empty },
      { path: '/routes/:routeId', name: 'route', component: Empty },
    ],
  });
  await router.push('/');
  wrapper = mount(HomeView, {
    global: { plugins: [pinia, router, i18n] },
    attachTo: document.body,
  });
  if (settle) await settled(wrapper);
  return { view: wrapper, ui: useUiStore(), router };
}

/** Waits until the list has the curated route and the first reading of the position is over. */
async function settled(view: VueWrapper) {
  await vi.waitFor(() => expect(view.text()).toContain('Leiria histórica'));
  await vi.waitFor(() =>
    expect(
      view.find('.community').exists() ||
        view.find('.invite').exists() ||
        view.find('.home__offline').exists(),
    ).toBe(true),
  );
  await flushPromises();
}

const cards = (view: VueWrapper) => view.findAll('.card__title').map((title) => title.text());
const communityCards = (view: VueWrapper) =>
  view.findAll('.community .card__title').map((title) => title.text());
const nearRequests = (asked: string[]) => asked.filter((url) => url.includes('near='));
const mapProps = (view: VueWrapper) => view.getComponent({ name: 'RouteMap' }).props();
const showMap = async (view: VueWrapper) => {
  await view
    .findAll('[role="radio"]')
    .find((radio) => radio.text() === 'Mapa')
    ?.trigger('click');
  await flushPromises();
};

beforeEach(async () => {
  applyLocale('es');
  localStorage.clear();
  map.goTo.mockReset();
  stubApi();
  stubGeolocation();
  stubPermission('prompt');
  await db.clear();
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'geolocation');
  Reflect.deleteProperty(navigator, 'permissions');
  await routeSyncIdle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Explore, with the permission already granted', () => {
  beforeEach(() => {
    stubPermission('granted');
  });

  it('reads the position by itself, once and loosely, and lists the community routes after the curated one', async () => {
    const getCurrentPosition = stubGeolocation(LEIRIA);
    const asked = stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: false });
    // The position goes out rounded to about 110 m.
    expect(nearRequests(asked)).toEqual([NEAR_LEIRIA]);
    expect(view.get('.community h2').text()).toBe(TITLE);
    expect(cards(view)).toEqual(['Leiria histórica', 'Paseo del río', 'Paseo del parque']);
    // The curated route first, outside the section; each community route labelled.
    expect(view.findAll('.community .card__badge--shared').map((badge) => badge.text())).toEqual([
      'De la comunidad',
      'De la comunidad',
    ]);
    expect(view.find('.card__badge--shared').exists()).toBe(true);
    expect(view.findAll('.home__list > .card')).toHaveLength(1);
    expect(view.find('.invite').exists()).toBe(false);
  });

  it('asks for the bundle of each community route, and not again for the curated one', async () => {
    const asked = stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    expect(asked).toContain('/api/v1/routes/paseo-aaaa');
    expect(asked).toContain('/api/v1/routes/paseo-bbbb');
    expect(asked.filter((url) => url === '/api/v1/routes/leiria-historica')).toHaveLength(1);
  });

  it('leaves out the routes the user made, which already say "Creada por ti"', async () => {
    await db.set(KEYS.myRoutes, { v: 1, records: { 'paseo-aaaa': ownRoute('paseo-aaaa') } });
    const asked = stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toEqual(['Paseo del parque']));
    // It shows once, as theirs, among the first routes.
    expect(cards(view)).toEqual(['Leiria histórica', 'Mi ruta', 'Paseo del parque']);
    expect(view.get('.card__badge--mine').text()).toBe('Creada por ti');
    expect(asked).not.toContain('/api/v1/routes/paseo-aaaa');
  });

  it('follows the filters of the list', async () => {
    stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    await view
      .findAll('[role="radio"]')
      .find((radio) => radio.text() === 'Reto')
      ?.trigger('click');
    await flushPromises();
    expect(communityCards(view)).toEqual(['Paseo del parque']);
    // A filter that leaves no community route takes the whole section away.
    await view
      .findAll('[role="radio"]')
      .find((radio) => radio.text() === 'Bici')
      ?.trigger('click');
    await flushPromises();
    expect(view.find('.community').exists()).toBe(false);
  });

  it('shows a skeleton while the routes load', async () => {
    let release: (response: Response) => void = () => {};
    stubApi({
      ...around(),
      [NEAR_LEIRIA]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    const { view } = await open({ settle: false });
    await vi.waitFor(() => expect(view.find('.community .skeleton').exists()).toBe(true));
    expect(view.get('.community h2').text()).toBe(TITLE);
    release(json([{ id: 'paseo-aaaa' }]));
    await vi.waitFor(() => expect(view.find('.community .skeleton').exists()).toBe(false));
  });

  it('says quietly that the area has none, instead of a section of nothing', async () => {
    stubApi({ [NEAR_LEIRIA]: () => json([{ id: 'leiria-historica' }]) });
    const { view } = await open();
    await vi.waitFor(() =>
      expect(view.get('.community').text()).toContain(
        'Aún no hay rutas de la comunidad cerca de ti.',
      ),
    );
    expect(communityCards(view)).toEqual([]);
    expect(cards(view)).toEqual(['Leiria histórica']);
  });

  it('is not broken by a failure: the curated routes stay, a quiet message and a way to try again', async () => {
    let healthy = false;
    stubApi({
      ...around(),
      [NEAR_LEIRIA]: () =>
        healthy ? json([{ id: 'paseo-aaaa' }]) : (json({ code: 'internal' }, 500) as Response),
    });
    const { view } = await open();
    await vi.waitFor(() =>
      expect(view.get('.community').text()).toContain(
        'No pudimos cargar las rutas de la comunidad.',
      ),
    );
    expect(cards(view)).toEqual(['Leiria histórica']);
    expect(view.find('.home__list [role="alert"]').exists()).toBe(false);

    healthy = true;
    await view
      .findAll('.community button')
      .find((b) => b.text() === 'Reintentar')
      ?.trigger('click');
    await vi.waitFor(() => expect(communityCards(view)).toEqual(['Paseo del río']));
    expect(view.get('.community').text()).not.toContain('No pudimos');
  });

  it('is not broken by a request that never comes back as a list', async () => {
    stubApi({ [NEAR_LEIRIA]: () => Promise.reject(new TypeError('Failed to fetch')) });
    const { view } = await open();
    await vi.waitFor(() => expect(view.find('.community__quiet').exists()).toBe(true));
    expect(cards(view)).toEqual(['Leiria histórica']);
  });

  it('shows nothing of the community offline, and finds them again when the connection is back', async () => {
    const asked = stubApi(around());
    setOnline(false);
    const { view } = await open();
    await vi.waitFor(() => expect(view.find('.home__offline').exists()).toBe(true));
    expect(view.find('.community').exists()).toBe(false);
    expect(view.find('.invite').exists()).toBe(false);
    expect(nearRequests(asked)).toEqual([]);

    setOnline(true);
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    expect(nearRequests(asked)).toEqual([NEAR_LEIRIA]);
  });

  it('does not ask again for the same place when Explore opens again', async () => {
    const asked = stubApi(around());
    const first = await open();
    await vi.waitFor(() => expect(communityCards(first.view)).toHaveLength(2));
    first.view.unmount();
    wrapper = null;

    // The same app session (the same pinia): the routes are there at once.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: Empty },
        { path: '/create', name: 'create', component: Empty },
        { path: '/routes/:routeId', name: 'route', component: Empty },
      ],
    });
    await router.push('/');
    wrapper = mount(HomeView, {
      global: { plugins: [first.view.vm.$pinia, router, i18n] },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(communityCards(wrapper as VueWrapper)).toHaveLength(2));
    expect(nearRequests(asked)).toEqual([NEAR_LEIRIA]);
  });
});

describe('Explore, without a position', () => {
  it('asks nothing until the user taps, and invites them to tap "Mi ubicación"', async () => {
    const getCurrentPosition = stubGeolocation(LEIRIA);
    const query = stubPermission('prompt');
    const asked = stubApi(around());
    const { view } = await open();
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(nearRequests(asked)).toEqual([]);
    expect(view.find('.community').exists()).toBe(false);
    const invite = view.get('.invite');
    expect(invite.text()).toContain('Toca «Mi ubicación» para ver las rutas de la comunidad');
    expect(invite.get('button').text()).toBe('Mi ubicación');
  });

  it('shows the community routes once the tap finds the position', async () => {
    const getCurrentPosition = stubGeolocation(LEIRIA);
    const asked = stubApi(around());
    const { view } = await open();
    await view.get('.invite button').trigger('click');
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: true });
    expect(nearRequests(asked)).toEqual([NEAR_LEIRIA]);
    expect(view.find('.invite').exists()).toBe(false);
  });

  it('explains a refusal and keeps the invitation', async () => {
    stubGeolocation(null);
    stubPermission('denied');
    const asked = stubApi(around());
    const { view, ui } = await open();
    await view.get('.invite button').trigger('click');
    await flushPromises();
    expect(ui.toasts[0]).toMatchObject({
      message: { key: 'explore.locationDenied' },
      tone: 'warning',
    });
    expect(view.find('.invite').exists()).toBe(true);
    expect(nearRequests(asked)).toEqual([]);
  });

  it.each([
    ['a browser with no Permissions API', undefined],
    ['a browser that does not know geolocation as a permission', 'throws' as const],
  ])('does not read anything by itself in %s, and still invites', async (_name, state) => {
    const getCurrentPosition = stubGeolocation(LEIRIA);
    stubPermission(state);
    const { view } = await open();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(view.find('.invite').exists()).toBe(true);
  });

  it('has no invitation where there is no geolocation at all', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    const { view } = await open({ settle: false });
    await vi.waitFor(() => expect(view.text()).toContain('Leiria histórica'));
    await flushPromises();
    expect(view.find('.invite').exists()).toBe(false);
    expect(view.find('.community').exists()).toBe(false);
  });

  it('does not invite while the granted position is still being read, nor when it cannot be read it asks again later', async () => {
    stubPermission('granted');
    // The position takes its time.
    let answer: PositionCallback = () => undefined;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((ok: PositionCallback) => {
          answer = ok;
        }),
      },
    });
    stubApi(around());
    const { view } = await open({ settle: false });
    await vi.waitFor(() => expect(view.text()).toContain('Leiria histórica'));
    await flushPromises();
    expect(view.find('.invite').exists()).toBe(false);
    answer({ coords: { ...LEIRIA, accuracy: 30 } } as GeolocationPosition);
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
  });

  it('falls back to the invitation when a granted position cannot be read', async () => {
    stubPermission('granted');
    stubGeolocation(null);
    const { view } = await open();
    expect(view.find('.invite').exists()).toBe(true);
  });
});

describe('the Explore map with the community routes', () => {
  beforeEach(() => {
    stubPermission('granted');
  });

  it('draws their points, and lists them in the legend and in the filter', async () => {
    stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    await showMap(view);
    const markerIds = (mapProps(view)['markers'] as Array<{ id: string }>).map((m) => m.id);
    expect(markerIds.filter((id) => id.startsWith('paseo-aaaa/'))).toHaveLength(2);
    expect(markerIds.filter((id) => id.startsWith('paseo-bbbb/'))).toHaveLength(2);
    expect(markerIds.filter((id) => id.startsWith('leiria-historica/'))).toHaveLength(12);
    expect(view.findAll('.legend__item').map((item) => item.text())).toEqual(
      expect.arrayContaining(['Leiria histórica', 'Paseo del río', 'Paseo del parque']),
    );
  });

  it('opens on the routes around the user when the position is known', async () => {
    stubApi(around());
    const { view } = await open();
    await vi.waitFor(() => expect(communityCards(view)).toHaveLength(2));
    await showMap(view);
    const fit = mapProps(view)['fit'] as Array<{ lat: number; lng: number }>;
    // The 12 points of Leiria's route and the 4 of the community's: all within 30 km.
    expect(fit).toHaveLength(12 + 2 + 2);
    expect(mapProps(view)['fitZoom']).toBeUndefined();
    expect(mapProps(view)['user']).toMatchObject({
      position: { lat: LEIRIA.latitude, lng: LEIRIA.longitude },
    });
  });

  it('opens on the user, at zoom 14, when no route is within 30 km', async () => {
    stubGeolocation(PORTO);
    stubApi({ [NEAR_PORTO]: () => json([{ id: 'leiria-historica' }]) });
    const { view } = await open();
    await showMap(view);
    expect(mapProps(view)['fit']).toEqual([{ lat: PORTO.latitude, lng: PORTO.longitude }]);
    expect(mapProps(view)['fitZoom']).toBe(14);
  });

  it('opens on the curated routes as before when the position is not known', async () => {
    stubPermission('prompt');
    stubApi(around());
    const { view } = await open();
    await showMap(view);
    expect(mapProps(view)['fit']).toHaveLength(12);
    expect(mapProps(view)['fitZoom']).toBeUndefined();
    expect(mapProps(view)['user']).toBeNull();
  });

  it('"Mi ubicación" centres the map as it always did, and finds the community routes around', async () => {
    stubPermission('prompt');
    stubGeolocation(PORTO);
    const asked = stubApi({
      [NEAR_PORTO]: () => json([{ id: 'paseo-aaaa' }]),
      '/api/v1/routes/paseo-aaaa': () => json(bundleOf('paseo-aaaa', 'Paseo del río')),
    });
    const { view } = await open();
    await showMap(view);
    await view
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Mi ubicación')
      ?.trigger('click');
    await vi.waitFor(() =>
      expect(map.goTo).toHaveBeenCalledWith({ lat: PORTO.latitude, lng: PORTO.longitude }, 16),
    );
    await vi.waitFor(() => expect(nearRequests(asked)).toEqual([NEAR_PORTO]));
    await vi.waitFor(() =>
      expect(
        (mapProps(view)['markers'] as Array<{ id: string }>).some((m) =>
          m.id.startsWith('paseo-aaaa/'),
        ),
      ).toBe(true),
    );
  });
});
