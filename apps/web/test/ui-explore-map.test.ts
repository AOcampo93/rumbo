import 'fake-indexeddb/auto';
import { buildRouteSpec } from '@rumbo/route-builder';
import { type DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import leiria from '../../../data/routes/leiria-historica.json';
import { applyLocale, i18n } from '../src/i18n/index.ts';
import { ACTIVITY_LOOKS } from '../src/map/symbols.ts';
import { type MyRouteRecord, routeSyncIdle } from '../src/services/myRoutes.ts';
import { db, KEYS } from '../src/services/storage.ts';
import { useCatalogStore } from '../src/stores/catalog.ts';
import HomeView from '../src/views/HomeView.vue';
import { json } from './create-fixtures.ts';

// S01 · the Explore map's two views and its filter (phase 7.3, ADR 0005):
// Puntos (the pins and the points of interest) and Rutas (one line per route,
// by activity), the card of the route a tap highlights, a legend with no route
// names, and a filter by origin and by interest. The SDK side is in
// map-routemap.test.ts; here the map is a stand-in that keeps the props the
// screen hands it and lets a test send the events the real one would.

const map = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock('../src/map/RouteMap.vue', async () => {
  const { defineComponent: define, h } = await import('vue');
  return {
    __esModule: true,
    default: define({
      name: 'RouteMap',
      props: [
        'markers',
        'lines',
        'linesLabel',
        'popups',
        'fit',
        'fitZoom',
        'user',
        'theme',
        'large',
        'label',
      ],
      emits: ['action', 'markerTap', 'lineTap', 'mapClick'],
      setup(_, { expose, slots }) {
        expose({ goTo: map.goTo });
        return () => h('div', { class: 'map-stub' }, slots['default']?.());
      },
    }),
  };
});

const Empty = defineComponent({ render: () => null });
const LEIRIA = { latitude: 39.74362, longitude: -8.80711 };
const NEAR_LEIRIA = '/api/v1/routes?near=39.744,-8.807';
const CURATED = 'leiria-historica';
const MINE = 'mia-aaaa';
const RIVERSIDE = 'rio-aaaa';
const PARK = 'parque-aaaa';

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

/**
 * The routes of the area: Leiria's curated route (a walk), the user's own (a
 * run about history), a community bike route about nature and history, and a
 * community walk with no interests.
 */
function stubApi() {
  const table: Record<string, () => Response> = {
    '/api/v1/routes': () => json([{ id: CURATED }]),
    [`/api/v1/routes/${CURATED}`]: () => json(leiria),
    [NEAR_LEIRIA]: () => json([{ id: CURATED }, { id: RIVERSIDE }, { id: PARK }]),
    [`/api/v1/routes/${RIVERSIDE}`]: () =>
      json(
        bundleOf(RIVERSIDE, 'Junto al río', { activity: 'bike', interests: ['nature', 'history'] }),
      ),
    [`/api/v1/routes/${PARK}`]: () => json(bundleOf(PARK, 'Por el parque', { mode: 'challenge' })),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => table[url]?.() ?? json({ code: 'not_found' }, 404)),
  );
}

function stubGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>((ok) =>
        ok({ coords: { ...LEIRIA, accuracy: 30 } } as GeolocationPosition),
      ),
    },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: 'granted' }) as PermissionStatus) },
  });
}

function ownRoute(id: string, extra: Record<string, unknown>): MyRouteRecord {
  return {
    id,
    editToken: 'a'.repeat(43),
    bundle: bundleOf(id, 'Mi carrera', extra),
    rev: 1,
    sync: 'synced',
    remote: 'yes',
    failures: 0,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    visibility: 'private',
  };
}

let wrapper: VueWrapper | null = null;

interface OpenOptions {
  /** Without the community's routes or the user's own: just the curated one. */
  onlyCurated?: boolean;
}

async function open({ onlyCurated = false }: OpenOptions = {}) {
  if (onlyCurated) {
    // No position to ask the community's routes for.
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  } else {
    stubGeolocation();
    // The user's own route is on the device.
    await db.set(KEYS.myRoutes, {
      v: 1,
      records: { [MINE]: ownRoute(MINE, { activity: 'run', interests: ['history'] }) },
    });
  }
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
  const catalog = useCatalogStore();
  // Everything the map can draw has arrived: the curated route, the user's own and the community's.
  await vi.waitFor(() => expect(catalog.status).toBe('ready'));
  if (!onlyCurated) {
    await vi.waitFor(() => expect(catalog.community).toHaveLength(2));
    await vi.waitFor(() => expect(catalog.mine).toHaveLength(1));
  }
  await flushPromises();
  return { view: wrapper, router, catalog };
}

type Wrapper = VueWrapper;
/** The filter sheet, an element of the screen. */
type Panel = Omit<DOMWrapper<Element>, 'exists'>;
const radio = (view: Wrapper, name: string) =>
  view.findAll('[role="radio"]').find((item) => item.text() === name);
const showMap = async (view: Wrapper, mode?: 'Puntos' | 'Rutas') => {
  await radio(view, 'Mapa')?.trigger('click');
  await flushPromises();
  if (mode) await radio(view, mode)?.trigger('click');
  await flushPromises();
};
const mapComponent = (view: Wrapper) => view.getComponent({ name: 'RouteMap' });
const mapProps = (view: Wrapper) => mapComponent(view).props();

interface LineProp {
  id: string;
  color: string;
  style: string;
  emphasis: string;
  label: string;
  points: Array<{ lat: number; lng: number }>;
}
interface MarkerProp {
  id: string;
  state: string;
  category: string;
  color?: string;
  dim?: boolean;
}
const linesOf = (view: Wrapper) => mapProps(view)['lines'] as LineProp[];
const markersOf = (view: Wrapper) => mapProps(view)['markers'] as MarkerProp[];
const routeIds = (markers: MarkerProp[]) => [
  ...new Set(markers.filter((m) => m.state === 'explore').map((m) => m.id.split('/')[0])),
];
const emit = async (view: Wrapper, event: string, ...args: unknown[]) => {
  mapComponent(view).vm.$emit(event, ...args);
  await flushPromises();
};
const card = (view: Wrapper) => view.find('.pick');
const legendItems = (view: Wrapper) => view.findAll('.legend__item').map((item) => item.text());

/** Opens the filter sheet with the first of the map's floating buttons. */
async function openFilter(view: Wrapper) {
  await view.get('.home__fabs button').trigger('click');
  await flushPromises();
  return view.get('.panel');
}
/** The chips of a group of the sheet, by its heading. */
const chipsOf = (panel: Panel, heading: string) => {
  const title = panel.findAll('h3').find((h) => h.text() === heading);
  const group = title ? panel.find(`[aria-labelledby="${title.attributes('id')}"]`) : null;
  return group?.findAll('.chip') ?? [];
};
const chip = (panel: Panel, heading: string, name: string) =>
  chipsOf(panel, heading).find((item) => item.text() === name);
const count = (panel: Panel) => panel.get('p.t-small').text();
/** A button of the sheet's bottom row ("Mostrar todo", "Listo"). */
const action = (panel: Panel, name: string) => {
  const button = panel.findAll('.panel__actions button').find((item) => item.text() === name);
  if (!button) throw new Error(`No "${name}" button`);
  return button;
};

beforeEach(async () => {
  applyLocale('es');
  localStorage.clear();
  map.goTo.mockReset();
  stubApi();
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

describe('the map’s switch Puntos | Rutas', () => {
  it('opens on the points, the pins and the points of interest, with popups', async () => {
    const { view } = await open();
    await showMap(view);
    const group = view.get('[aria-label="Mostrar en el mapa"]');
    expect(group.findAll('[role="radio"]').map((item) => item.text())).toEqual(['Puntos', 'Rutas']);
    expect(radio(view, 'Puntos')?.attributes('aria-checked')).toBe('true');
    expect(radio(view, 'Rutas')?.attributes('aria-checked')).toBe('false');
    expect(linesOf(view)).toEqual([]);
    expect(mapProps(view)['popups']).toBe(true);
    expect(new Set(markersOf(view).map((m) => m.state))).toEqual(new Set(['explore', 'poi']));
  });

  it('has the routes view draw a line per route, with no points of interest and no popups', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    expect(radio(view, 'Rutas')?.attributes('aria-checked')).toBe('true');
    expect(linesOf(view).map((line) => line.id)).toEqual([CURATED, MINE, RIVERSIDE, PARK]);
    expect(mapProps(view)['popups']).toBe(false);
    expect(mapProps(view)['linesLabel']).toBe('Rutas del mapa');
    // The pins stay, with the routes; the points of interest go.
    expect(markersOf(view).every((marker) => marker.state === 'explore')).toBe(true);
    expect(routeIds(markersOf(view))).toEqual([CURATED, MINE, RIVERSIDE, PARK]);
  });

  it('draws each line in the colour and the style of its activity', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const by = Object.fromEntries(linesOf(view).map((line) => [line.id, line]));
    expect(by[CURATED]).toMatchObject({ ...pick('walk'), label: 'Leiria histórica' });
    expect(by[MINE]).toMatchObject({ ...pick('run'), label: 'Mi carrera' });
    expect(by[RIVERSIDE]).toMatchObject({ ...pick('bike'), label: 'Junto al río' });
    expect(by[PARK]).toMatchObject(pick('walk'));
    expect(new Set(linesOf(view).map((line) => line.emphasis))).toEqual(new Set(['normal']));
    // A line follows the points of its route in order (Leiria's has 12).
    expect(by[CURATED]?.points).toHaveLength(12);
    expect(by[MINE]?.points).toHaveLength(2);

    function pick(activity: 'walk' | 'run' | 'bike') {
      return { color: ACTIVITY_LOOKS[activity].color, style: ACTIVITY_LOOKS[activity].line };
    }
  });

  it('colours the pins by activity in both views, and keeps their category icon', async () => {
    const { view } = await open();
    await showMap(view);
    const colors = () =>
      Object.fromEntries(
        markersOf(view)
          .filter((marker) => marker.state === 'explore')
          .map((marker) => [marker.id.split('/')[0], marker.color]),
      );
    const expected = {
      [CURATED]: ACTIVITY_LOOKS.walk.color,
      [MINE]: ACTIVITY_LOOKS.run.color,
      [RIVERSIDE]: ACTIVITY_LOOKS.bike.color,
      [PARK]: ACTIVITY_LOOKS.walk.color,
    };
    expect(colors()).toEqual(expected);
    // Points of interest stay as they are: white, with no route colour.
    expect(markersOf(view).find((marker) => marker.state === 'poi')?.color).toBeUndefined();
    await radio(view, 'Rutas')?.trigger('click');
    await flushPromises();
    expect(colors()).toEqual(expected);
  });

  it('is remembered, like the choice of the list or the map', async () => {
    const first = await open();
    await showMap(first.view, 'Rutas');
    expect(localStorage.getItem('rumbo.explore.mapMode')).toBe('routes');
    first.view.unmount();
    wrapper = null;

    // The next visit opens on the map, in the routes view.
    const second = await open();
    expect(second.view.find('.map-stub').exists()).toBe(true);
    expect(radio(second.view, 'Rutas')?.attributes('aria-checked')).toBe('true');
    expect(linesOf(second.view)).toHaveLength(4);
    await radio(second.view, 'Puntos')?.trigger('click');
    expect(localStorage.getItem('rumbo.explore.mapMode')).toBe('points');
  });

  it('ignores a value it doesn’t know', async () => {
    localStorage.setItem('rumbo.explore.mapMode', 'satellite');
    const { view } = await open();
    await showMap(view);
    expect(radio(view, 'Puntos')?.attributes('aria-checked')).toBe('true');
  });
});

describe('a route highlighted on the map', () => {
  it('is picked by a tap on its line: it gets strong, the others and their pins fade, and a card names it', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    expect(card(view).exists()).toBe(false);
    await emit(view, 'lineTap', MINE);

    expect(linesOf(view).map((line) => [line.id, line.emphasis])).toEqual([
      [CURATED, 'dim'],
      [MINE, 'strong'],
      [RIVERSIDE, 'dim'],
      [PARK, 'dim'],
    ]);
    const faded = markersOf(view).filter((marker) => marker.dim);
    expect(routeIds(faded)).toEqual([CURATED, RIVERSIDE, PARK]);
    expect(
      markersOf(view)
        .filter((marker) => !marker.dim)
        .every((m) => m.id.startsWith(`${MINE}/`)),
    ).toBe(true);
    // The card: name, activity, distance and the way in.
    expect(card(view).text()).toContain('Mi carrera');
    expect(card(view).text()).toContain('Correr');
    expect(card(view).text()).toMatch(/\d(,\d)? km|\d+ m/);
    expect(card(view).find('.swatch').exists()).toBe(true);
    expect(
      card(view)
        .findAll('button')
        .map((button) => button.text() || button.attributes('aria-label')),
    ).toEqual(['Ver ruta', 'Cerrar']);
  });

  it('is picked by a tap on one of its pins as well', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const pin = markersOf(view).find((marker) => marker.id.startsWith(`${RIVERSIDE}/`));
    expect(pin).toBeDefined();
    await emit(view, 'markerTap', pin?.id);
    expect(linesOf(view).find((line) => line.emphasis === 'strong')?.id).toBe(RIVERSIDE);
    expect(card(view).text()).toContain('Junto al río');
    expect(card(view).text()).toContain('Bici');
  });

  it('opens the route from "Ver ruta"', async () => {
    const { view, router } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', RIVERSIDE);
    await card(view)
      .findAll('button')
      .find((button) => button.text() === 'Ver ruta')
      ?.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(`/routes/${RIVERSIDE}`);
  });

  it('lets go with a tap anywhere else on the map, or with the card’s close button', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', MINE);
    expect(card(view).exists()).toBe(true);
    await emit(view, 'mapClick', { lat: 39.75, lng: -8.81 });
    expect(card(view).exists()).toBe(false);
    expect(new Set(linesOf(view).map((line) => line.emphasis))).toEqual(new Set(['normal']));
    expect(markersOf(view).some((marker) => marker.dim)).toBe(false);

    await emit(view, 'lineTap', PARK);
    expect(card(view).exists()).toBe(true);
    await card(view).get('.pick__close').trigger('click');
    expect(card(view).exists()).toBe(false);
    expect(new Set(linesOf(view).map((line) => line.emphasis))).toEqual(new Set(['normal']));
  });

  it('changes with a tap on another route', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', MINE);
    await emit(view, 'lineTap', PARK);
    expect(linesOf(view).find((line) => line.emphasis === 'strong')?.id).toBe(PARK);
    expect(card(view).text()).toContain('Por el parque');
  });

  it('is announced to a screen reader, whose live region is always there', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const live = view.get('.dock__live');
    expect(live.attributes('role')).toBe('status');
    expect(live.text()).toBe('');
    await emit(view, 'lineTap', MINE);
    expect(live.text()).toContain('Mi carrera');
  });

  it('is let go of when the view changes to the points, and taps there highlight nothing', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', MINE);
    await radio(view, 'Puntos')?.trigger('click');
    await flushPromises();
    expect(card(view).exists()).toBe(false);
    expect(markersOf(view).some((marker) => marker.dim)).toBe(false);
    await emit(view, 'lineTap', MINE);
    await emit(view, 'markerTap', `${MINE}/anything`);
    expect(card(view).exists()).toBe(false);
    // Back in the routes view nothing is still highlighted.
    await radio(view, 'Rutas')?.trigger('click');
    await flushPromises();
    expect(new Set(linesOf(view).map((line) => line.emphasis))).toEqual(new Set(['normal']));
  });

  it('is let go of when its route leaves the map', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', MINE);
    // The chip "A pie" keeps only the walks: the user's run is gone.
    await radio(view, 'A pie')?.trigger('click');
    await flushPromises();
    expect(linesOf(view).map((line) => line.id)).toEqual([CURATED, PARK]);
    expect(card(view).exists()).toBe(false);
    // And it is not back when the run is.
    await radio(view, 'Todas')?.trigger('click');
    await flushPromises();
    expect(linesOf(view)).toHaveLength(4);
    expect(card(view).exists()).toBe(false);
    expect(new Set(linesOf(view).map((line) => line.emphasis))).toEqual(new Set(['normal']));
  });

  it('is named in the language shown', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    await emit(view, 'lineTap', CURATED);
    expect(card(view).text()).toContain('Leiria histórica');
    applyLocale('en');
    await flushPromises();
    expect(card(view).text()).toContain('Historic Leiria');
    expect(card(view).text()).toContain('Walk');
    expect(
      card(view)
        .findAll('button')
        .map((button) => button.text() || button.attributes('aria-label')),
    ).toEqual(['View route', 'Close']);
    expect(linesOf(view).find((line) => line.id === CURATED)?.label).toBe('Historic Leiria');
  });
});

describe('the legend', () => {
  it('has no route names: the activities present, and the points of interest, in the points view', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    expect(legendItems(view)).toEqual(['A pie', 'Correr', 'Bici', 'Lugares de interés']);
    for (const name of ['Leiria histórica', 'Mi carrera', 'Junto al río', 'Por el parque']) {
      expect(view.get('.legend').text()).not.toContain(name);
    }
    // Pins: a dot of the colour of each activity; the points of interest, white.
    const dots = view.findAll('.legend__dot').map((dot) => dot.attributes('style') ?? '');
    expect(dots).toHaveLength(4);
    expect(dots[0]).toContain('background');
    expect(view.find('.legend .swatch').exists()).toBe(false);
    expect(view.get('.legend').attributes('aria-label')).toBe('Leyenda');
  });

  it('has the activities with their line in the routes view, and no points of interest', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    expect(legendItems(view)).toEqual(['A pie', 'Correr', 'Bici']);
    expect(view.findAll('.legend .swatch')).toHaveLength(3);
    expect(view.find('.legend__dot').exists()).toBe(false);
    // Each sample draws its activity's colour, and the dashed ones have dashes.
    const strokes = view
      .findAll('.legend .swatch')
      .map((swatch) => swatch.findAll('line').at(-1)?.attributes());
    expect(strokes.map((attributes) => attributes?.['stroke'])).toEqual([
      ACTIVITY_LOOKS.walk.color,
      ACTIVITY_LOOKS.run.color,
      ACTIVITY_LOOKS.bike.color,
    ]);
    expect(strokes[0]?.['stroke-dasharray']).toBeUndefined();
    expect(strokes[1]?.['stroke-dasharray']).toBeDefined();
    expect(strokes[2]?.['stroke-dasharray']).toBeDefined();
    expect(strokes[1]?.['stroke-dasharray']).not.toBe(strokes[2]?.['stroke-dasharray']);
  });

  it('lists only the activities of the routes that are there', async () => {
    const { view } = await open({ onlyCurated: true });
    await showMap(view, 'Puntos');
    expect(legendItems(view)).toEqual(['A pie', 'Lugares de interés']);
    await radio(view, 'Rutas')?.trigger('click');
    await flushPromises();
    expect(legendItems(view)).toEqual(['A pie']);
  });

  it('follows the filter: a route filtered out takes its activity from the legend', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const panel = await openFilter(view);
    await chip(panel, 'Origen', 'Tuyas')?.trigger('click');
    await flushPromises();
    expect(legendItems(view)).toEqual(['Correr']);
  });

  it('has no box at all when nothing is on the map, and only the points of interest when only they are', async () => {
    const { view } = await open({ onlyCurated: true });
    await showMap(view, 'Rutas');
    // The curated route is free: the chip "Reto" leaves no route.
    await radio(view, 'Reto')?.trigger('click');
    await flushPromises();
    expect(linesOf(view)).toEqual([]);
    expect(view.find('.legend').exists()).toBe(false);
    await radio(view, 'Puntos')?.trigger('click');
    await flushPromises();
    expect(legendItems(view)).toEqual(['Lugares de interés']);
  });
});

describe('the filter sheet', () => {
  it('lists no routes by name, but an origin, the interests, the points of interest and the categories', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    expect(panel.findAll('h3').map((h) => h.text())).toEqual(['Origen', 'Intereses', 'Categorías']);
    expect(chipsOf(panel, 'Origen').map((c) => c.text())).toEqual([
      'Oficiales',
      'De la comunidad',
      'Tuyas',
    ]);
    expect(chipsOf(panel, 'Intereses').map((c) => c.text())).toEqual(['Historia', 'Naturaleza']);
    expect(chipsOf(panel, 'Categorías').length).toBeGreaterThan(3);
    // Only one switch, the points of interest: none per route.
    expect(panel.findAll('[role="switch"]').map((s) => s.attributes('aria-label'))).toEqual([
      'Lugares de interés',
    ]);
    for (const name of ['Leiria histórica', 'Mi carrera', 'Junto al río', 'Por el parque']) {
      expect(panel.text()).not.toContain(name);
    }
    expect(panel.text()).not.toContain('Rutas');
    // Everything is on to begin with.
    expect(panel.findAll('.chip[aria-pressed="true"]')).toHaveLength(0);
    expect(count(panel)).toMatch(/^(\d+) de \1 marcadores$/);
  });

  it('offers only the origins that are there, and none when there is a single one', async () => {
    const { view } = await open({ onlyCurated: true });
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    // The curated route is all there is: nothing to choose between.
    expect(panel.findAll('h3').map((h) => h.text())).toEqual(['Categorías']);
  });

  it('offers only the interests some route has, and none when no route has any', async () => {
    const { view } = await open({ onlyCurated: true });
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    expect(panel.text()).not.toContain('Intereses');
    expect(panel.text()).not.toContain('Historia');
  });

  it('narrows the routes to an origin', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const panel = await openFilter(view);
    const all = markersOf(view).length;

    await chip(panel, 'Origen', 'Tuyas')?.trigger('click');
    expect(chip(panel, 'Origen', 'Tuyas')?.attributes('aria-pressed')).toBe('true');
    expect(linesOf(view).map((line) => line.id)).toEqual([MINE]);
    expect(routeIds(markersOf(view))).toEqual([MINE]);
    expect(count(panel)).toBe(`2 de ${all} marcadores`);

    await chip(panel, 'Origen', 'De la comunidad')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([MINE, RIVERSIDE, PARK]);

    await chip(panel, 'Origen', 'Tuyas')?.trigger('click');
    await chip(panel, 'Origen', 'De la comunidad')?.trigger('click');
    // None chosen: all.
    expect(linesOf(view)).toHaveLength(4);
    expect(count(panel)).toBe(`${all} de ${all} marcadores`);
  });

  it('narrows the routes to the interests, any of them', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const panel = await openFilter(view);

    await chip(panel, 'Intereses', 'Naturaleza')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([RIVERSIDE]);
    await chip(panel, 'Intereses', 'Historia')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([MINE, RIVERSIDE]);
    await chip(panel, 'Intereses', 'Naturaleza')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([MINE, RIVERSIDE]);
    await chip(panel, 'Intereses', 'Historia')?.trigger('click');
    expect(linesOf(view)).toHaveLength(4);
  });

  it('asks for an origin and an interest together', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const panel = await openFilter(view);
    await chip(panel, 'Origen', 'De la comunidad')?.trigger('click');
    await chip(panel, 'Intereses', 'Historia')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([RIVERSIDE]);
  });

  it('filters the pins and the legend in the points view just the same', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    await chip(panel, 'Origen', 'Oficiales')?.trigger('click');
    expect(routeIds(markersOf(view))).toEqual([CURATED]);
    // The points of interest are not a route: they stay.
    expect(markersOf(view).some((marker) => marker.state === 'poi')).toBe(true);
    expect(legendItems(view)).toEqual(['A pie', 'Lugares de interés']);
    expect(linesOf(view)).toEqual([]);
  });

  it('switches the points of interest off in the points view, and offers no such switch in the routes view', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    const total = markersOf(view).length;
    await panel.get('[role="switch"]').trigger('click');
    expect(markersOf(view).every((marker) => marker.state === 'explore')).toBe(true);
    expect(count(panel)).toBe(`${markersOf(view).length} de ${total} marcadores`);
    expect(legendItems(view)).not.toContain('Lugares de interés');

    await action(panel, 'Mostrar todo').trigger('click');
    expect(markersOf(view)).toHaveLength(total);
    await action(panel, 'Listo').trigger('click');
    await flushPromises();
    expect(view.find('.panel').exists()).toBe(false);

    await radio(view, 'Rutas')?.trigger('click');
    await flushPromises();
    const again = await openFilter(view);
    expect(again.find('[role="switch"]').exists()).toBe(false);
    // In this view the total counts the route pins only.
    const pins = markersOf(view).length;
    expect(count(again)).toBe(`${pins} de ${pins} marcadores`);
  });

  it('narrows the pins to the categories chosen, in both views, and leaves the routes alone', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    const total = markersOf(view).length;
    await chip(panel, 'Categorías', 'Iglesia')?.trigger('click');
    expect(markersOf(view).length).toBeGreaterThan(0);
    expect(markersOf(view).length).toBeLessThan(total);
    expect(markersOf(view).every((marker) => marker.category === 'church')).toBe(true);

    await radio(view, 'Rutas')?.trigger('click');
    await flushPromises();
    expect(markersOf(view).length).toBeGreaterThan(0);
    expect(
      markersOf(view).every((marker) => marker.category === 'church' && marker.state === 'explore'),
    ).toBe(true);
    // A category narrows the pins, not the routes: all four lines are still there.
    expect(linesOf(view)).toHaveLength(4);
  });

  it('puts everything back with "Mostrar todo"', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    const panel = await openFilter(view);
    const total = markersOf(view).length;
    await chip(panel, 'Origen', 'Tuyas')?.trigger('click');
    await chip(panel, 'Intereses', 'Historia')?.trigger('click');
    await chip(panel, 'Categorías', 'Iglesia')?.trigger('click');
    await panel.get('[role="switch"]').trigger('click');
    expect(markersOf(view).length).toBeLessThan(total);

    await action(panel, 'Mostrar todo').trigger('click');
    expect(markersOf(view)).toHaveLength(total);
    expect(panel.findAll('.chip[aria-pressed="true"]')).toHaveLength(0);
    expect(panel.get('[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(count(panel)).toBe(`${total} de ${total} marcadores`);
  });

  it('does not hide everything behind a chip that is no longer offered', async () => {
    const { view } = await open();
    await showMap(view, 'Rutas');
    const panel = await openFilter(view);
    await chip(panel, 'Origen', 'Tuyas')?.trigger('click');
    expect(linesOf(view).map((line) => line.id)).toEqual([MINE]);
    // The chip "Bici" keeps only the bikes: the user has none, so "Tuyas" is not offered
    // any more and doesn't count: the bike route is there.
    await radio(view, 'Bici')?.trigger('click');
    await flushPromises();
    expect(linesOf(view).map((line) => line.id)).toEqual([RIVERSIDE]);
    expect(panel.findAll('h3').map((h) => h.text())).not.toContain('Origen');
  });

  it('is in the language shown', async () => {
    const { view } = await open();
    await showMap(view, 'Puntos');
    applyLocale('en');
    await flushPromises();
    const panel = await openFilter(view);
    expect(panel.findAll('h3').map((h) => h.text())).toEqual(['Origin', 'Interests', 'Categories']);
    expect(chipsOf(panel, 'Origin').map((c) => c.text())).toEqual([
      'Official',
      'From the community',
      'Yours',
    ]);
    expect(chipsOf(panel, 'Interests').map((c) => c.text())).toEqual(['History', 'Nature']);
    expect(legendItems(view)).toEqual(['Walk', 'Run', 'Bike', 'Points of interest']);
  });
});
