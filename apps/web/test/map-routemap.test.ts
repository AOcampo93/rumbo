import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/i18n/index.ts';
import RouteMap from '../src/map/RouteMap.vue';
import { LINE_HIT_WIDTH, lineLook, rgba, ZONE_LOOKS } from '../src/map/symbols.ts';
import type { LatLng } from '@rumbo/geo-utils';
import type { MapLine, MapMarker, MapZoneItem, RouteMapApi } from '../src/map/types.ts';

// RouteMap against a stand-in SDK: the creator's zones and Explore's route
// lines synced by id, the taps, the long press, the camera API and unmounting
// while the view loads. The real map runs in the e2e tests.

const sdk = vi.hoisted(() => {
  /** An SDK object that keeps what it was built with. */
  class Fake {
    constructor(props: object = {}) {
      Object.assign(this, props);
    }
  }
  class Layer extends Fake {
    declare title: string;
    graphics: Fake[] = [];
    add(graphic: Fake) {
      this.graphics.push(graphic);
    }
    addMany(list: Fake[]) {
      this.graphics.push(...list);
    }
    remove(graphic: Fake) {
      this.graphics = this.graphics.filter((g) => g !== graphic);
    }
    removeAll() {
      this.graphics = [];
    }
  }
  const maps: Array<{ layers: Layer[] }> = [];
  class WebMap extends Fake {
    declare layers: Layer[];
    constructor(props: object) {
      super(props);
      maps.push(this);
    }
  }
  return { Fake, Layer, WebMap, maps };
});

vi.mock('@arcgis/map-components/components/arcgis-map', () => ({}));
vi.mock('@arcgis/core/Graphic.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/Map.js', () => ({ default: sdk.WebMap }));
vi.mock('@arcgis/core/PopupTemplate.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/geometry/Circle.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/geometry/Extent.js', () => ({
  default: class extends sdk.Fake {
    declare xmin: number;
    declare xmax: number;
    declare ymin: number;
    declare ymax: number;
    get width() {
      return this.xmax - this.xmin;
    }
    get height() {
      return this.ymax - this.ymin;
    }
    get center() {
      return { longitude: (this.xmin + this.xmax) / 2, latitude: (this.ymin + this.ymax) / 2 };
    }
    expand() {
      return this;
    }
  },
}));
vi.mock('@arcgis/core/geometry/Point.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/geometry/Polyline.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/geometry/SpatialReference.js', () => ({
  default: { WebMercator: { wkid: 3857 } },
}));
vi.mock('@arcgis/core/layers/support/TileInfo.js', () => ({
  default: { create: () => ({ lods: [] }) },
}));
vi.mock('@arcgis/core/intl.js', () => ({ setLocale: () => {} }));
vi.mock('@arcgis/core/core/reactiveUtils.js', () => ({ watch: () => ({ remove() {} }) }));
vi.mock('@arcgis/core/layers/GraphicsLayer.js', () => ({ default: sdk.Layer }));
vi.mock('@arcgis/core/symbols/PictureMarkerSymbol.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/symbols/SimpleFillSymbol.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/symbols/SimpleLineSymbol.js', () => ({ default: sdk.Fake }));
vi.mock('@arcgis/core/symbols/TextSymbol.js', () => ({ default: sdk.Fake }));
vi.mock('../src/map/basemap.ts', () => ({ createBasemap: () => 'basemap' }));

type Handler = (event: unknown) => Promise<void> | void;

function createView() {
  const handlers = new Map<string, Handler>();
  /** What the next hitTest finds (a marker or nothing). */
  const state = { hits: [] as unknown[] };
  return {
    ready: true,
    zoom: 14,
    center: { latitude: 39.744, longitude: -8.807 },
    padding: {},
    popup: {},
    height: 600,
    interacting: false,
    popupEnabled: true,
    handlers,
    state,
    on: vi.fn((type: string, handler: Handler) => {
      handlers.set(type, handler);
      return { remove() {} };
    }),
    hitTest: vi.fn<(target: unknown, options: unknown) => Promise<{ results: unknown[] }>>(
      async () => ({ results: state.hits }),
    ),
    goTo: vi.fn<(target: unknown, options: unknown) => Promise<void>>(async () => {}),
    openPopup: vi.fn(async () => {}),
    closePopup: vi.fn(),
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
}

let view = createView();
/** viewOnReady() resolves when the test says so. */
let gate = deferred();

customElements.define(
  'arcgis-map',
  class extends HTMLElement {
    get view() {
      return view;
    }
    viewOnReady() {
      return gate.promise;
    }
  },
);

const mounted = new Set<VueWrapper>();

beforeEach(() => {
  view = createView();
  gate = deferred();
  sdk.maps.length = 0;
});

afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted.clear();
});

interface MapProps {
  markers?: MapMarker[];
  zones?: MapZoneItem[];
  lines?: MapLine[];
  linesLabel?: string;
  popups?: boolean;
  large?: boolean;
  fit?: LatLng[] | null;
  fitZoom?: number;
}

function mountMap(props: MapProps = {}) {
  const wrapper = mount(RouteMap, {
    props: { markers: [], label: 'Map', ...props },
    global: { plugins: [i18n] },
  });
  mounted.add(wrapper);
  return wrapper;
}

async function readyMap(props: MapProps = {}) {
  const wrapper = mountMap(props);
  gate.resolve();
  await flushPromises();
  return wrapper;
}

/** What the tests read from a graphic built by the stand-in SDK. */
interface Drawn {
  geometry: {
    center: { latitude: number; longitude: number };
    radius: number;
    paths: number[][][];
  };
  symbol: {
    color: number[];
    outline: { color: number[]; width: string };
    url: string;
    width: string;
    style?: string;
    cap?: string;
  };
  attributes?: { id?: string; line?: string; hit?: boolean };
}

function graphicsOf(title: string): Drawn[] {
  const layer = sdk.maps.at(-1)?.layers.find((l) => l.title === title);
  if (!layer) throw new Error(`No ${title} layer`);
  return layer.graphics as unknown as Drawn[];
}

const marker: MapMarker = {
  id: 'p1',
  position: { lat: 39.744, lng: -8.807 },
  category: 'church',
  state: 'active',
  order: 1,
  popup: { title: 'Sé', chips: [], actions: [] },
};
const zoneA: MapZoneItem = { id: 'a', center: { lat: 39.744, lng: -8.807 }, radius: 40 };
const zoneB: MapZoneItem = { id: 'b', center: { lat: 39.746, lng: -8.805 }, radius: 60 };
const lineA: MapLine = {
  id: 'a',
  label: 'Ruta A',
  color: '#1E4FA3',
  style: 'solid',
  points: [
    { lat: 39.744, lng: -8.807 },
    { lat: 39.746, lng: -8.805 },
  ],
};
const lineB: MapLine = {
  id: 'b',
  label: 'Ruta B',
  color: '#C4491F',
  style: 'long-dash',
  points: [
    { lat: 39.74, lng: -8.81 },
    { lat: 39.741, lng: -8.808 },
    { lat: 39.743, lng: -8.806 },
  ],
};

/** A layer of the last map built, by its title. */
function layerOf(title: string) {
  return sdk.maps.at(-1)?.layers.find((l) => l.title === title);
}

/** One route's three graphics in the lines layer: its strip, its casing and its stroke. */
function partsOf(id: string) {
  const [strip, casing, stroke] = graphicsOf('lines').filter((g) => g.attributes?.line === id);
  return { strip, casing, stroke };
}

const lineIds = () => graphicsOf('lines').map((g) => g.attributes?.line);

describe('RouteMap zones', () => {
  it('draws one geodesic circle per zone, under the route and the markers', async () => {
    const wrapper = await readyMap({ zones: [zoneA, zoneB] });
    expect(wrapper.emitted('ready')).toHaveLength(1);
    const titles = sdk.maps.at(-1)?.layers.map((l) => l.title) ?? [];
    expect(titles.indexOf('zones')).toBeLessThan(titles.indexOf('path'));
    expect(titles.indexOf('zones')).toBeLessThan(titles.indexOf('points'));
    const [first, second] = graphicsOf('zones');
    expect(first?.geometry).toMatchObject({
      center: { latitude: 39.744, longitude: -8.807 },
      radius: 40,
      radiusUnit: 'meters',
      geodesic: true,
    });
    expect(second?.geometry.radius).toBe(60);
    // Default tone: the same look as the run's target zone.
    await wrapper.setProps({ zone: { center: zoneA.center, radius: 40 } });
    expect(graphicsOf('zone')[0]?.symbol).toEqual(first?.symbol);
  });

  it('updates a changed circle in place and removes the missing ones', async () => {
    const wrapper = await readyMap({ zones: [zoneA, zoneB] });
    const [first, second] = graphicsOf('zones');
    const firstGeometry = first?.geometry;
    const secondGeometry = second?.geometry;
    const secondSymbol = second?.symbol;

    // A radius slider: only that circle gets a new geometry.
    await wrapper.setProps({ zones: [zoneA, { ...zoneB, radius: 80 }] });
    expect(graphicsOf('zones')).toHaveLength(2);
    expect(graphicsOf('zones')[0]).toBe(first);
    expect(graphicsOf('zones')[1]).toBe(second);
    expect(first?.geometry).toBe(firstGeometry);
    expect(second?.geometry).not.toBe(secondGeometry);
    expect(second?.geometry.radius).toBe(80);
    expect(second?.symbol).toBe(secondSymbol);

    // An overlap: new symbol, same geometry.
    const resized = second?.geometry;
    await wrapper.setProps({ zones: [zoneA, { ...zoneB, radius: 80, tone: 'warning' }] });
    expect(second?.geometry).toBe(resized);
    expect(second?.symbol.outline.color).toEqual(ZONE_LOOKS.warning.outline);

    // Removed and added by id.
    await wrapper.setProps({ zones: [{ id: 'c', center: zoneB.center, radius: 30 }, zoneA] });
    const after = graphicsOf('zones');
    expect(after).toHaveLength(2);
    expect(after).toContain(first);
    expect(after).not.toContain(second);
  });
});

describe('RouteMap markers', () => {
  it('swaps the symbol when the warning flag toggles', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    const [graphic] = graphicsOf('points');
    const plain = graphic?.symbol.url;
    await wrapper.setProps({ markers: [{ ...marker, warning: true }] });
    expect(graphicsOf('points')[0]).toBe(graphic);
    expect(graphic?.symbol.url).not.toBe(plain);
    expect(decodeURIComponent(graphic?.symbol.url ?? '')).toContain('>!</text>');
    await wrapper.setProps({ markers: [{ ...marker, warning: false }] });
    expect(graphic?.symbol.url).toBe(plain);
  });

  it('swaps the symbol when a marker fades because another route is highlighted', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    const [graphic] = graphicsOf('points');
    const plain = graphic?.symbol.url;
    await wrapper.setProps({ markers: [{ ...marker, dim: true }] });
    expect(graphicsOf('points')[0]).toBe(graphic);
    expect(decodeURIComponent(graphic?.symbol.url ?? '')).toContain('<g opacity=');
    await wrapper.setProps({ markers: [marker] });
    expect(graphic?.symbol.url).toBe(plain);
  });
});

describe('RouteMap lines', () => {
  it('draws a route as a strip to tap, a white casing and its coloured stroke, under the markers', async () => {
    await readyMap({ lines: [lineA, lineB] });
    const titles = sdk.maps.at(-1)?.layers.map((l) => l.title) ?? [];
    expect(titles.indexOf('lines')).toBeGreaterThan(titles.indexOf('path'));
    expect(titles.indexOf('lines')).toBeGreaterThan(titles.indexOf('track'));
    expect(titles.indexOf('lines')).toBeLessThan(titles.indexOf('points'));
    expect(graphicsOf('lines')).toHaveLength(6);

    const { strip, casing, stroke } = partsOf('a');
    const normal = lineLook('normal');
    expect(strip?.attributes).toEqual({ line: 'a', hit: true });
    expect(casing?.attributes).toEqual({ line: 'a' });
    expect(stroke?.attributes).toEqual({ line: 'a' });
    expect(stroke?.symbol).toMatchObject({
      color: rgba('#1E4FA3', 1),
      width: `${normal.width}px`,
      style: 'solid',
      cap: 'round',
    });
    expect(casing?.symbol).toMatchObject({
      color: rgba('#FFFFFF', normal.casingAlpha),
      width: `${normal.casing}px`,
    });
    expect(strip?.symbol).toMatchObject({ color: [0, 0, 0, 0], width: `${LINE_HIT_WIDTH}px` });
    // The three follow the same path (longitude first), and the strip is the widest.
    for (const part of [strip, casing, stroke]) {
      expect(part?.geometry.paths).toEqual([
        [
          [-8.807, 39.744],
          [-8.805, 39.746],
        ],
      ]);
    }
    // A dashed style keeps flat ends, so every dash is as long as the pattern says.
    expect(partsOf('b').stroke?.symbol).toMatchObject({
      color: rgba('#C4491F', 1),
      style: 'long-dash',
      cap: 'butt',
    });
  });

  it('draws the lines it was given before the view was ready, once it is', async () => {
    const wrapper = mountMap({ lines: [lineA] });
    expect(graphicsOf('lines')).toHaveLength(0);
    gate.resolve();
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(graphicsOf('lines')).toHaveLength(3);
  });

  it('highlights a route in place: thicker and on top, the others thinner and fainter', async () => {
    const wrapper = await readyMap({ lines: [lineA, lineB] });
    const before = { a: partsOf('a'), b: partsOf('b') };
    const geometry = before.a.stroke?.geometry;

    await wrapper.setProps({
      lines: [
        { ...lineA, emphasis: 'strong' },
        { ...lineB, emphasis: 'dim' },
      ],
    });
    const a = partsOf('a');
    const b = partsOf('b');
    // The same graphics with the same geometry: only the symbols changed.
    expect(graphicsOf('lines')).toHaveLength(6);
    expect(a.stroke).toBe(before.a.stroke);
    expect(a.casing).toBe(before.a.casing);
    expect(b.stroke).toBe(before.b.stroke);
    expect(a.stroke?.geometry).toBe(geometry);
    expect(a.stroke?.symbol.width).toBe(`${lineLook('strong').width}px`);
    expect(a.casing?.symbol.width).toBe(`${lineLook('strong').casing}px`);
    expect(b.stroke?.symbol.width).toBe(`${lineLook('dim').width}px`);
    expect(b.stroke?.symbol.color).toEqual(rgba('#C4491F', lineLook('dim').alpha));
    expect(b.casing?.symbol.color).toEqual(rgba('#FFFFFF', lineLook('dim').casingAlpha));
    // The highlighted route is drawn last, so it is on top of the others.
    expect(lineIds().slice(-3)).toEqual(['a', 'a', 'a']);
    expect(graphicsOf('lines').at(-1)).toBe(a.stroke);

    // Nothing highlighted any more: every line as it was.
    await wrapper.setProps({ lines: [lineA, lineB] });
    expect(partsOf('a').stroke?.symbol.width).toBe(`${lineLook('normal').width}px`);
    expect(partsOf('a').stroke?.symbol.color).toEqual(rgba('#1E4FA3', 1));
    expect(partsOf('b').stroke?.symbol.width).toBe(`${lineLook('normal').width}px`);
    expect(partsOf('b').casing?.symbol.color).toEqual(
      rgba('#FFFFFF', lineLook('normal').casingAlpha),
    );
  });

  it('only redraws a route that changes: a new path moves it, a missing one takes it away', async () => {
    const wrapper = await readyMap({ lines: [lineA, lineB] });
    const { stroke } = partsOf('a');
    const geometry = stroke?.geometry;
    const symbol = stroke?.symbol;

    const longer = { ...lineA, points: [...lineA.points, { lat: 39.748, lng: -8.8 }] };
    await wrapper.setProps({ lines: [longer, lineB] });
    expect(graphicsOf('lines')).toHaveLength(6);
    expect(partsOf('a').stroke).toBe(stroke);
    expect(stroke?.geometry).not.toBe(geometry);
    expect(stroke?.geometry.paths[0]).toHaveLength(3);
    expect(partsOf('a').strip?.geometry.paths[0]).toHaveLength(3);
    expect(stroke?.symbol).toBe(symbol);

    await wrapper.setProps({ lines: [lineB] });
    expect(lineIds()).toEqual(['b', 'b', 'b']);
    await wrapper.setProps({ lines: [lineB, { ...lineA, id: 'c' }] });
    expect(lineIds()).toEqual(['b', 'b', 'b', 'c', 'c', 'c']);
    await wrapper.setProps({ lines: [] });
    expect(graphicsOf('lines')).toEqual([]);
  });

  it('draws nothing for a route with fewer than two points', async () => {
    const lonely: MapLine = { ...lineA, id: 'solo', points: [{ lat: 39.744, lng: -8.807 }] };
    const wrapper = await readyMap({ lines: [lonely, lineB] });
    expect(lineIds()).toEqual(['b', 'b', 'b']);
    // It grows a second point: now it is drawn.
    await wrapper.setProps({ lines: [{ ...lonely, points: lineA.points }, lineB] });
    expect(lineIds()).toEqual(['b', 'b', 'b', 'solo', 'solo', 'solo']);
    // And back to one: gone again.
    await wrapper.setProps({ lines: [lonely, lineB] });
    expect(lineIds()).toEqual(['b', 'b', 'b']);
  });

  it('draws thicker lines in "Sol", and follows it when it changes', async () => {
    const wrapper = await readyMap({ lines: [lineA] });
    expect(partsOf('a').stroke?.symbol.width).toBe(`${lineLook('normal').width}px`);
    await wrapper.setProps({ large: true });
    expect(partsOf('a').stroke?.symbol.width).toBe(`${lineLook('normal', true).width}px`);
    expect(partsOf('a').casing?.symbol.width).toBe(`${lineLook('normal', true).casing}px`);
    await wrapper.setProps({ large: false });
    expect(partsOf('a').stroke?.symbol.width).toBe(`${lineLook('normal').width}px`);
  });

  it('draws no lines where none are given (the creator and the run)', async () => {
    await readyMap({ markers: [marker] });
    expect(graphicsOf('lines')).toEqual([]);
  });
});

describe('RouteMap taps on markers and routes', () => {
  const tap = { x: 120, y: 80, button: 0, mapPoint: { latitude: 39.75, longitude: -8.81 } };
  /** A graphic the SDK says is under the finger. */
  const under = (attributes: object) => ({ graphic: { attributes } });

  it('looks for both the markers and the lines under the finger', async () => {
    await readyMap({ markers: [marker], lines: [lineA] });
    await view.handlers.get('click')?.(tap);
    expect(view.hitTest).toHaveBeenCalledWith(tap, {
      include: [layerOf('points'), layerOf('lines')],
    });
  });

  it('emits markerTap, with the marker, for a tap on a marker, and nothing else', async () => {
    const wrapper = await readyMap({ markers: [marker], lines: [lineA] });
    view.state.hits = [under({ id: 'p1' })];
    await view.handlers.get('click')?.(tap);
    expect(wrapper.emitted('markerTap')).toEqual([['p1']]);
    expect(wrapper.emitted('lineTap')).toBeUndefined();
    expect(wrapper.emitted('mapClick')).toBeUndefined();
  });

  it('emits lineTap, with the route, for a tap on its stroke, its casing or the strip around it', async () => {
    const wrapper = await readyMap({ lines: [lineA, lineB] });
    const click = view.handlers.get('click');
    view.state.hits = [under({ line: 'a' })];
    await click?.(tap);
    view.state.hits = [under({ line: 'b', hit: true })];
    await click?.(tap);
    expect(wrapper.emitted('lineTap')).toEqual([['a'], ['b']]);
    expect(wrapper.emitted('markerTap')).toBeUndefined();
    expect(wrapper.emitted('mapClick')).toBeUndefined();
  });

  it('prefers the route whose stroke is under the finger to one whose strip only is, and a marker to any route', async () => {
    const wrapper = await readyMap({ markers: [marker], lines: [lineA, lineB] });
    const click = view.handlers.get('click');
    // B's strip lies above A's stroke in the layer (it is listed first): A is what was touched.
    view.state.hits = [under({ line: 'b', hit: true }), under({ line: 'a' })];
    await click?.(tap);
    expect(wrapper.emitted('lineTap')).toEqual([['a']]);
    // A marker sits over a route: the marker is what was touched.
    view.state.hits = [under({ line: 'a' }), under({ id: 'p1' })];
    await click?.(tap);
    expect(wrapper.emitted('markerTap')).toEqual([['p1']]);
    expect(wrapper.emitted('lineTap')).toHaveLength(1);
  });

  it('emits mapClick, as it always did, for a tap on neither', async () => {
    const wrapper = await readyMap({ markers: [marker], lines: [lineA] });
    await view.handlers.get('click')?.(tap);
    expect(wrapper.emitted('mapClick')).toEqual([[{ lat: 39.75, lng: -8.81 }]]);
    expect(wrapper.emitted('lineTap')).toBeUndefined();
    expect(wrapper.emitted('markerTap')).toBeUndefined();
  });

  it('still lets a long press land on a route: it adds a point there only off the markers', async () => {
    const wrapper = await readyMap({ markers: [marker], lines: [lineA] });
    view.state.hits = [under({ line: 'a' })];
    await view.handlers.get('hold')?.(tap);
    // The strips are not markers: the hold is asked about the markers alone.
    expect(view.hitTest).toHaveBeenCalledWith(tap, { include: [layerOf('points')] });
    expect(wrapper.emitted('lineTap')).toBeUndefined();
  });
});

describe('RouteMap lists for the keyboard', () => {
  it('lists the markers and the routes drawn as lines, each a button', async () => {
    const wrapper = await readyMap({
      markers: [marker],
      lines: [lineA, lineB],
      linesLabel: 'Rutas del mapa',
    });
    const lists = wrapper.findAll('ul.arcgis__list');
    expect(lists.map((list) => list.attributes('aria-label'))).toEqual([
      i18n.global.t('map.markers'),
      'Rutas del mapa',
    ]);
    expect(lists[0]?.findAll('button').map((button) => button.text())).toEqual(['Sé']);
    const routes = lists[1]?.findAll('button') ?? [];
    expect(routes.map((button) => button.text())).toEqual(['Ruta A', 'Ruta B']);
    // Picking one is the same as tapping on it.
    await routes[1]?.trigger('click');
    await routes[0]?.trigger('click');
    expect(wrapper.emitted('lineTap')).toEqual([['b'], ['a']]);
  });

  it('keeps a route with fewer than two points in the list, though it draws nothing', async () => {
    const lonely: MapLine = {
      ...lineA,
      id: 'solo',
      label: 'Ruta sola',
      points: [{ lat: 39.744, lng: -8.807 }],
    };
    const wrapper = await readyMap({ lines: [lonely, lineB], linesLabel: 'Rutas del mapa' });
    expect(wrapper.findAll('ul.arcgis__list button').map((button) => button.text())).toEqual([
      'Ruta sola',
      'Ruta B',
    ]);
    expect(lineIds()).toEqual(['b', 'b', 'b']);
  });

  it('has no list of routes where there are no lines', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    expect(wrapper.findAll('ul.arcgis__list')).toHaveLength(1);
  });

  it('opens a marker’s popup from its entry, as before', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    await wrapper.find('ul.arcgis__list button').trigger('click');
    expect(view.openPopup).toHaveBeenCalledTimes(1);
  });
});

describe('RouteMap popups', () => {
  it('open on a tap by default, as in the creator and the run', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    expect(view.popupEnabled).toBe(true);
    expect(wrapper.find('ul.arcgis__list').exists()).toBe(true);
  });

  it('can be turned off, which also takes the markers off the keyboard list', async () => {
    const wrapper = await readyMap({ markers: [marker], popups: false });
    expect(view.popupEnabled).toBe(false);
    expect(wrapper.find('ul.arcgis__list').exists()).toBe(false);
    // Markers still tell when they are tapped.
    view.state.hits = [{ graphic: { attributes: { id: 'p1' } } }];
    await view.handlers.get('click')?.({ x: 1, y: 1, mapPoint: { latitude: 1, longitude: 1 } });
    expect(wrapper.emitted('markerTap')).toEqual([['p1']]);
  });

  it('follow the prop while the map is open, closing the one that is showing when they go', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    await wrapper.setProps({ popups: false });
    expect(view.popupEnabled).toBe(false);
    expect(view.closePopup).toHaveBeenCalledTimes(1);
    expect(wrapper.find('ul.arcgis__list').exists()).toBe(false);
    await wrapper.setProps({ popups: true });
    expect(view.popupEnabled).toBe(true);
    expect(view.closePopup).toHaveBeenCalledTimes(1);
    expect(wrapper.find('ul.arcgis__list').exists()).toBe(true);
  });
});

describe('RouteMap gestures', () => {
  const press = (button = 0) => ({
    x: 120,
    y: 80,
    button,
    mapPoint: { latitude: 39.75, longitude: -8.81 },
  });

  it('emits mapHold for a long press off the markers', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    const hold = view.handlers.get('hold');
    await hold?.(press());
    expect(wrapper.emitted('mapHold')).toEqual([[{ lat: 39.75, lng: -8.81 }]]);
    expect(view.hitTest).toHaveBeenCalledWith(press(), {
      include: [sdk.maps.at(-1)?.layers.find((l) => l.title === 'points')],
    });
    // A finger that jittered a little: the SDK passes the last pointermove.
    await hold?.(press(-1));
    expect(wrapper.emitted('mapHold')).toHaveLength(2);

    view.state.hits = [{ graphic: {} }]; // on a marker
    await hold?.(press());
    expect(wrapper.emitted('mapHold')).toHaveLength(2);
  });

  it('keeps emitting mapClick for taps off the markers', async () => {
    const wrapper = await readyMap({ markers: [marker] });
    const click = view.handlers.get('click');
    await click?.(press());
    expect(wrapper.emitted('mapClick')).toEqual([[{ lat: 39.75, lng: -8.81 }]]);
    view.state.hits = [{ graphic: {} }];
    await click?.(press());
    expect(wrapper.emitted('mapClick')).toHaveLength(1);
    expect(wrapper.emitted('mapHold')).toBeUndefined();
  });
});

describe('RouteMap camera API', () => {
  const target = { lat: 39.75, lng: -8.81 };

  it('does nothing before the view is ready', async () => {
    const api = mountMap().vm as unknown as RouteMapApi;
    await api.goTo(target);
    expect(view.goTo).not.toHaveBeenCalled();
    expect(api.center()).toBeNull();
  });

  it('centres on a position at zoom 16 or more, and reads the centre back', async () => {
    const api = (await readyMap()).vm as unknown as RouteMapApi;
    await api.goTo(target);
    expect(view.goTo.mock.lastCall?.[0]).toEqual({
      target: { latitude: 39.75, longitude: -8.81 },
      zoom: 16,
    });
    view.zoom = 18;
    await api.goTo(target);
    expect(view.goTo.mock.lastCall?.[0]).toMatchObject({ zoom: 18 });
    await api.goTo(target, 12);
    expect(view.goTo.mock.lastCall?.[0]).toMatchObject({ zoom: 12 });
    view.goTo.mockRejectedValueOnce(new Error('interrupted'));
    await expect(api.goTo(target)).resolves.toBeUndefined();
    expect(api.center()).toEqual({ lat: 39.744, lng: -8.807 });
  });

  // A point-like extent is an invalid view for the SDK (mapview:invalid-extent).
  it('opens on a single position with a centre and a zoom, not an extent', async () => {
    const wrapper = mountMap({ fit: [target] });
    await flushPromises();
    const element = wrapper.find('arcgis-map').element as unknown as {
      extent?: unknown;
      center?: number[];
      zoom?: number;
    };
    expect(element.extent).toBeUndefined();
    expect(element.center).toEqual([-8.81, 39.75]);
    expect(element.zoom).toBe(15);
  });

  it('opens on several positions with their extent', async () => {
    const wrapper = mountMap({ fit: [target, { lat: 39.74, lng: -8.8 }] });
    await flushPromises();
    const element = wrapper.find('arcgis-map').element as unknown as { extent?: unknown };
    expect(element.extent).toMatchObject({ xmin: -8.81, ymin: 39.74, xmax: -8.8, ymax: 39.75 });
  });

  // Explore opens on the user when no route is around them (phase 7.2): a neighbourhood, not a close-up.
  it('opens on a single position at the zoom it is told, and goes there once ready', async () => {
    const wrapper = mountMap({ fit: [target], fitZoom: 14 });
    await flushPromises();
    const element = wrapper.find('arcgis-map').element as unknown as { zoom?: number };
    expect(element.zoom).toBe(14);
    gate.resolve();
    await flushPromises();
    expect(view.goTo.mock.lastCall?.[0]).toEqual({
      target: { latitude: 39.75, longitude: -8.81 },
      zoom: 14,
    });
  });

  it('frames positions that have an area by their extent, whatever zoom it is told', async () => {
    const wrapper = mountMap({ fit: [target, { lat: 39.74, lng: -8.8 }], fitZoom: 14 });
    gate.resolve();
    await flushPromises();
    expect(wrapper.emitted('ready')).toHaveLength(1);
    expect(view.goTo.mock.lastCall?.[0]).toMatchObject({ xmin: -8.81, xmax: -8.8 });
  });

  it('frames positions without an area by their centre, close up', async () => {
    const api = (await readyMap()).vm as unknown as RouteMapApi;
    await api.fitTo([target, target]);
    expect(view.goTo.mock.lastCall?.[0]).toEqual({
      target: { latitude: 39.75, longitude: -8.81 },
      zoom: 17,
    });
  });
});

describe('RouteMap lifecycle', () => {
  it('wires nothing up when unmounted while the view loads', async () => {
    const wrapper = mountMap({ markers: [marker], zones: [zoneA], lines: [lineA] });
    mounted.delete(wrapper);
    wrapper.unmount();
    gate.resolve();
    await flushPromises();
    expect(view.on).not.toHaveBeenCalled();
    expect(graphicsOf('points')).toHaveLength(0);
    expect(graphicsOf('zones')).toHaveLength(0);
    expect(graphicsOf('lines')).toHaveLength(0);
    expect(wrapper.emitted('ready')).toBeUndefined();
  });
});
