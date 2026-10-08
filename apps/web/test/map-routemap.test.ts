import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/i18n/index.ts';
import RouteMap from '../src/map/RouteMap.vue';
import { ZONE_LOOKS } from '../src/map/symbols.ts';
import type { MapMarker, MapZoneItem, RouteMapApi } from '../src/map/types.ts';

// RouteMap against a stand-in SDK: the creator's zones synced by id, the long
// press, the camera API and unmounting while the view loads. The real map
// runs in the e2e tests.

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

function mountMap(props: { markers?: MapMarker[]; zones?: MapZoneItem[] } = {}) {
  const wrapper = mount(RouteMap, {
    props: { markers: [], label: 'Map', ...props },
    global: { plugins: [i18n] },
  });
  mounted.add(wrapper);
  return wrapper;
}

async function readyMap(props: { markers?: MapMarker[]; zones?: MapZoneItem[] } = {}) {
  const wrapper = mountMap(props);
  gate.resolve();
  await flushPromises();
  return wrapper;
}

/** What the tests read from a graphic built by the stand-in SDK. */
interface Drawn {
  geometry: { center: { latitude: number; longitude: number }; radius: number };
  symbol: { color: number[]; outline: { color: number[]; width: string }; url: string };
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
});

describe('RouteMap lifecycle', () => {
  it('wires nothing up when unmounted while the view loads', async () => {
    const wrapper = mountMap({ markers: [marker], zones: [zoneA] });
    mounted.delete(wrapper);
    wrapper.unmount();
    gate.resolve();
    await flushPromises();
    expect(view.on).not.toHaveBeenCalled();
    expect(graphicsOf('points')).toHaveLength(0);
    expect(graphicsOf('zones')).toHaveLength(0);
    expect(wrapper.emitted('ready')).toBeUndefined();
  });
});
