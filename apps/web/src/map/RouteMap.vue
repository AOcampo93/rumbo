<script setup lang="ts">
import '@arcgis/map-components/components/arcgis-map';
import Graphic from '@arcgis/core/Graphic.js';
import Map from '@arcgis/core/Map.js';
import PopupTemplate from '@arcgis/core/PopupTemplate.js';
import Circle from '@arcgis/core/geometry/Circle.js';
import Extent from '@arcgis/core/geometry/Extent.js';
import Point from '@arcgis/core/geometry/Point.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import SpatialReference from '@arcgis/core/geometry/SpatialReference.js';
import TileInfo from '@arcgis/core/layers/support/TileInfo.js';
import * as intl from '@arcgis/core/intl.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol.js';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import TextSymbol from '@arcgis/core/symbols/TextSymbol.js';
import type { ClickEvent, HoldEvent } from '@arcgis/core/views/input/types.js';
import type { LatLng } from '@rumbo/geo-utils';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { currentLocale, LOCALE_TAGS, onLocaleChange } from '../i18n/index.ts';
import { createBasemap } from './basemap.ts';
import './map.css';
import { popupContent } from './popup.ts';
import {
  LINE_HIT_WIDTH,
  lineLook,
  MAP_COLORS,
  markerImage,
  rgba,
  userImage,
  ZONE_LOOKS,
} from './symbols.ts';
import type {
  BasemapKind,
  MapLine,
  MapMarker,
  MapPadding,
  MapTheme,
  MapUser,
  MapZone,
  MapZoneItem,
  MapZoneTone,
  RouteMapApi,
} from './types.ts';

// The only component that talks to the ArcGIS SDK (PROJECT_PLAN §10.3). It
// wraps the <arcgis-map> component (the recommended way in SDK 5.x) and keeps
// one graphic per marker, updating only what changed. (Named RouteMap, not
// ArcgisMap: Vue would read <arcgis-map> as this component calling itself.)

const props = withDefaults(
  defineProps<{
    markers: MapMarker[];
    path?: LatLng[] | null;
    track?: LatLng[] | null;
    /** Routes drawn as lines under the markers (Explore's routes view), kept in sync by id. */
    lines?: MapLine[];
    /** Name of the keyboard list of `lines`. */
    linesLabel?: string;
    /** Whether a marker opens its popup when tapped (and is on the keyboard list). The routes view turns it off. */
    popups?: boolean;
    user?: MapUser | null;
    zone?: MapZone | null;
    /** Radius circles of many points (creator), kept in sync by id. */
    zones?: MapZoneItem[];
    /** Positions to show when the map opens (and on fitTo()). */
    fit?: LatLng[] | null;
    /** Zoom for a `fit` that has no area (one position): by default a close-up (17; 15 while opening). */
    fitZoom?: number;
    padding?: MapPadding;
    /** Keep the user centred (run screen). */
    follow?: boolean;
    basemap?: BasemapKind;
    theme?: MapTheme;
    /** "Sol" high contrast: bigger markers. */
    large?: boolean;
    label: string;
  }>(),
  {
    path: null,
    track: null,
    lines: () => [],
    linesLabel: undefined,
    popups: true,
    user: null,
    zone: null,
    zones: () => [],
    fit: null,
    fitZoom: undefined,
    padding: () => ({}),
    follow: false,
    basemap: 'streets',
    theme: 'light',
    large: false,
  },
);

const emit = defineEmits<{
  ready: [];
  /** The view could not start (no WebGL, the SDK failed): the screen shows its fallback. */
  failed: [];
  action: [payload: { markerId: string; action: string }];
  /** A marker was tapped (its popup opens by itself while `popups` is on). */
  markerTap: [markerId: string];
  /** A route's line was tapped, or picked from the keyboard list. */
  lineTap: [lineId: string];
  /** A tap off the markers and the lines. */
  mapClick: [position: LatLng];
  /** Long press off the markers (creator: add a point there). */
  mapHold: [position: LatLng];
  userPan: [];
}>();

const { t } = useI18n();
const mapEl = ref<HTMLArcgisMapElement | null>(null);
const ready = ref(false);
const failed = ref(false);
/** Data providers of the current basemap, shown in our own attribution strip. */
const attribution = ref('');

// Bottom to top. 'zones' holds the creator's circles, 'zone' the run's target
// and 'lines' Explore's routes (under the markers, which stay on top).
const zonesLayer = new GraphicsLayer({ title: 'zones' });
const zoneLayer = new GraphicsLayer({ title: 'zone' });
const pathLayer = new GraphicsLayer({ title: 'path' });
const trackLayer = new GraphicsLayer({ title: 'track' });
const linesLayer = new GraphicsLayer({ title: 'lines' });
const pointsLayer = new GraphicsLayer({ title: 'points' });
const labelsLayer = new GraphicsLayer({ title: 'labels', minScale: 6000 });
const userLayer = new GraphicsLayer({ title: 'user' });
const map = new Map({
  basemap: createBasemap(props.basemap, props.theme),
  layers: [
    zonesLayer,
    zoneLayer,
    pathLayer,
    trackLayer,
    linesLayer,
    pointsLayer,
    labelsLayer,
    userLayer,
  ],
});

const markerGraphics = new globalThis.Map<
  string,
  { graphic: Graphic; look: string; label: Graphic | null }
>();
const latest = new globalThis.Map<string, MapMarker>();
/**
 * A route's line is three graphics sharing its id: an invisible strip a finger
 * can hit, a white casing and the coloured stroke on top. `shape` is what the
 * geometry was built from, `look` what the symbols were.
 */
const lineGraphics = new globalThis.Map<
  string,
  { hit: Graphic; casing: Graphic; stroke: Graphic; shape: string; look: string; strong: boolean }
>();
/** The creator's circles by zone id; `shape` is what their geometry was built from. */
const zoneGraphics = new globalThis.Map<
  string,
  { graphic: Graphic; shape: string; tone: MapZoneTone }
>();
const userGraphics = shallowRef<{ dot: Graphic; accuracy: Graphic } | null>(null);
let offLocale: (() => void) | null = null;
const handles: Array<{ remove(): void }> = [];
/** Set on unmount: the view may still be loading then. */
let disposed = false;

const point = (p: LatLng) => new Point({ latitude: p.lat, longitude: p.lng });

/** False for a point-like extent: the SDK rejects one as a view (mapview:invalid-extent). */
const hasArea = (extent: Extent) => extent.width > 0 && extent.height > 0;

function extentOf(points: readonly LatLng[]): Extent | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return new Extent({
    xmin: Math.min(...lngs),
    ymin: Math.min(...lats),
    xmax: Math.max(...lngs),
    ymax: Math.max(...lats),
    spatialReference: { wkid: 4326 },
  });
}

// ---------------------------------------------------------------- markers

function markerSymbol(marker: MapMarker): { symbol: PictureMarkerSymbol; key: string } {
  const look = {
    category: marker.category,
    state: marker.state,
    color: marker.color,
    order: marker.order ?? null,
    optional: marker.optional ?? false,
    warning: marker.warning ?? false,
    dwell: marker.dwell !== undefined ? Math.round(marker.dwell * 20) / 20 : undefined,
    large: props.large,
    // Only a faded marker has the key, so the others keep the look they always had.
    ...(marker.dim ? { dim: true } : {}),
  };
  const image = markerImage(look);
  return {
    key: image.url,
    symbol: new PictureMarkerSymbol({
      url: image.url,
      width: `${image.size}px`,
      height: `${image.size}px`,
    }),
  };
}

function labelGraphic(marker: MapMarker): Graphic | null {
  if (!marker.label) return null;
  return new Graphic({
    geometry: point(marker.position),
    symbol: new TextSymbol({
      text: marker.label,
      color: MAP_COLORS.ink,
      haloColor: MAP_COLORS.white,
      haloSize: 1.5,
      yoffset: -34,
      font: { family: 'Arial', size: 10, weight: 'bold' },
    }),
  });
}

function syncMarkers(markers: readonly MapMarker[]): void {
  const seen = new Set<string>();
  for (const marker of markers) {
    seen.add(marker.id);
    latest.set(marker.id, marker);
    const { symbol, key } = markerSymbol(marker);
    const entry = markerGraphics.get(marker.id);
    if (!entry) {
      const graphic = new Graphic({
        geometry: point(marker.position),
        symbol,
        attributes: { id: marker.id },
        popupTemplate: new PopupTemplate({
          title: '',
          outFields: ['*'],
          // Built on open from the freshest data (distance, state, language).
          content: () => {
            const current = latest.get(marker.id);
            if (!current) return '';
            return popupContent(current.popup, (action) =>
              emit('action', { markerId: marker.id, action }),
            );
          },
        }),
      });
      const label = labelGraphic(marker);
      pointsLayer.add(graphic);
      if (label) labelsLayer.add(label);
      markerGraphics.set(marker.id, { graphic, look: key, label });
      continue;
    }
    const geometry = entry.graphic.geometry as Point;
    if (geometry.latitude !== marker.position.lat || geometry.longitude !== marker.position.lng) {
      entry.graphic.geometry = point(marker.position);
    }
    if (entry.look !== key) {
      entry.graphic.symbol = symbol;
      entry.look = key;
    }
    const labelText = (entry.label?.symbol as TextSymbol | undefined)?.text;
    if (labelText !== marker.label) {
      if (entry.label) labelsLayer.remove(entry.label);
      entry.label = labelGraphic(marker);
      if (entry.label) labelsLayer.add(entry.label);
    }
  }
  for (const [id, entry] of markerGraphics) {
    if (seen.has(id)) continue;
    pointsLayer.remove(entry.graphic);
    if (entry.label) labelsLayer.remove(entry.label);
    markerGraphics.delete(id);
    latest.delete(id);
  }
}

// ---------------------------------------------------------------- lines and zones

function syncLine(
  layer: GraphicsLayer,
  points: readonly LatLng[] | null,
  symbol: SimpleLineSymbol,
): void {
  layer.removeAll();
  if (!points || points.length < 2) return;
  layer.add(
    new Graphic({
      geometry: new Polyline({
        paths: [points.map((p) => [p.lng, p.lat])],
        spatialReference: { wkid: 4326 },
      }),
      symbol,
    }),
  );
}

const pathSymbol = new SimpleLineSymbol({
  color: [11, 122, 117, 0.8],
  width: '4px',
  style: 'dash',
  cap: 'round',
});
const trackSymbol = new SimpleLineSymbol({
  color: MAP_COLORS.primary,
  width: '5px',
  cap: 'round',
  join: 'round',
});

const zoneCircle = (zone: MapZone) =>
  new Circle({
    center: point(zone.center),
    radius: zone.radius,
    radiusUnit: 'meters',
    geodesic: true,
  });

function zoneSymbol(tone: MapZoneTone): SimpleFillSymbol {
  const look = ZONE_LOOKS[tone];
  return new SimpleFillSymbol({
    color: look.fill,
    outline: { color: look.outline, width: `${look.width}px` },
  });
}

/** The run's target zone. */
function syncZone(zone: MapZone | null): void {
  zoneLayer.removeAll();
  if (!zone) return;
  zoneLayer.add(new Graphic({ geometry: zoneCircle(zone), symbol: zoneSymbol('default') }));
}

/**
 * The creator's zones, one circle per id. A changed circle gets a new
 * geometry or symbol in place, so a radius slider doesn't redraw them all.
 */
function syncZones(zones: readonly MapZoneItem[]): void {
  const seen = new Set<string>();
  for (const zone of zones) {
    seen.add(zone.id);
    const shape = `${zone.center.lat},${zone.center.lng},${zone.radius}`;
    const tone = zone.tone ?? 'default';
    const entry = zoneGraphics.get(zone.id);
    if (!entry) {
      const graphic = new Graphic({ geometry: zoneCircle(zone), symbol: zoneSymbol(tone) });
      zonesLayer.add(graphic);
      zoneGraphics.set(zone.id, { graphic, shape, tone });
      continue;
    }
    if (entry.shape !== shape) {
      entry.graphic.geometry = zoneCircle(zone);
      entry.shape = shape;
    }
    if (entry.tone !== tone) {
      entry.graphic.symbol = zoneSymbol(tone);
      entry.tone = tone;
    }
  }
  for (const [id, entry] of zoneGraphics) {
    if (seen.has(id)) continue;
    zonesLayer.remove(entry.graphic);
    zoneGraphics.delete(id);
  }
}

// ---------------------------------------------------------------- routes' lines

/** The strip along a line that taps land on: invisible, but the SDK still hits it. */
const hitSymbol = new SimpleLineSymbol({ color: [0, 0, 0, 0], width: `${LINE_HIT_WIDTH}px` });

function lineSymbols(line: MapLine): {
  key: string;
  casing: SimpleLineSymbol;
  stroke: SimpleLineSymbol;
} {
  const emphasis = line.emphasis ?? 'normal';
  const look = lineLook(emphasis, props.large);
  return {
    key: [line.color, line.style, emphasis, props.large].join('|'),
    // The white edge keeps a line apart from roads, parks and the dark basemap.
    casing: new SimpleLineSymbol({
      color: rgba(MAP_COLORS.white, look.casingAlpha),
      width: `${look.casing}px`,
      cap: 'round',
      join: 'round',
    }),
    stroke: new SimpleLineSymbol({
      color: rgba(line.color, look.alpha),
      width: `${look.width}px`,
      style: line.style,
      // Flat ends keep every dash as long as its pattern says; round ones would run them together.
      cap: line.style === 'solid' ? 'round' : 'butt',
      join: 'round',
    }),
  };
}

function removeLine(id: string): void {
  const entry = lineGraphics.get(id);
  if (!entry) return;
  for (const graphic of [entry.hit, entry.casing, entry.stroke]) linesLayer.remove(graphic);
  lineGraphics.delete(id);
}

/**
 * The routes' lines, three graphics per id (see lineGraphics). A changed
 * emphasis only swaps symbols and a changed path only the geometry, so
 * highlighting a route doesn't redraw the others. The highlighted one goes on
 * top of the rest.
 */
function syncLines(lines: readonly MapLine[]): void {
  const seen = new Set<string>();
  const raised: string[] = [];
  for (const line of lines) {
    seen.add(line.id);
    if (line.points.length < 2) {
      removeLine(line.id);
      continue;
    }
    const geometry = () =>
      new Polyline({
        paths: [line.points.map((p) => [p.lng, p.lat])],
        spatialReference: { wkid: 4326 },
      });
    const shape = line.points.map((p) => `${p.lat},${p.lng}`).join(' ');
    const { key, casing, stroke } = lineSymbols(line);
    const strong = line.emphasis === 'strong';
    const entry = lineGraphics.get(line.id);
    if (!entry) {
      // A tap on the strip alone is only a near miss: one on a stroke wins over it (see tappedOn).
      const hit = new Graphic({
        geometry: geometry(),
        symbol: hitSymbol,
        attributes: { line: line.id, hit: true },
      });
      const casingGraphic = new Graphic({
        geometry: geometry(),
        symbol: casing,
        attributes: { line: line.id },
      });
      const strokeGraphic = new Graphic({
        geometry: geometry(),
        symbol: stroke,
        attributes: { line: line.id },
      });
      linesLayer.addMany([hit, casingGraphic, strokeGraphic]);
      lineGraphics.set(line.id, {
        hit,
        casing: casingGraphic,
        stroke: strokeGraphic,
        shape,
        look: key,
        strong,
      });
      if (strong) raised.push(line.id);
      continue;
    }
    if (entry.shape !== shape) {
      for (const graphic of [entry.hit, entry.casing, entry.stroke]) graphic.geometry = geometry();
      entry.shape = shape;
    }
    if (entry.look !== key) {
      entry.casing.symbol = casing;
      entry.stroke.symbol = stroke;
      entry.look = key;
    }
    if (strong && !entry.strong) raised.push(line.id);
    entry.strong = strong;
  }
  for (const id of [...lineGraphics.keys()]) if (!seen.has(id)) removeLine(id);
  // A layer draws in the order its graphics were added: add the highlighted route's again.
  for (const id of raised) {
    const entry = lineGraphics.get(id);
    if (!entry) continue;
    const parts = [entry.hit, entry.casing, entry.stroke];
    for (const graphic of parts) linesLayer.remove(graphic);
    linesLayer.addMany(parts);
  }
}

// ---------------------------------------------------------------- user

function syncUser(user: MapUser | null): void {
  if (!user) {
    userLayer.removeAll();
    userGraphics.value = null;
    return;
  }
  const color = user.simulated ? [124, 58, 237] : [47, 128, 237];
  const image = userImage(user.simulated, user.heading !== null);
  const dotSymbol = new PictureMarkerSymbol({
    url: image.url,
    width: `${image.size}px`,
    height: `${image.size}px`,
    angle: user.heading ?? 0,
  });
  const accuracyGeometry = new Circle({
    center: point(user.position),
    radius: Math.max(5, user.accuracy),
    radiusUnit: 'meters',
    geodesic: true,
  });
  if (!userGraphics.value) {
    const accuracy = new Graphic({
      geometry: accuracyGeometry,
      symbol: new SimpleFillSymbol({
        color: [...color, 0.15],
        outline: { color: [...color, 0.35], width: '1px' },
      }),
    });
    const dot = new Graphic({ geometry: point(user.position), symbol: dotSymbol });
    userLayer.addMany([accuracy, dot]);
    if (user.simulated) {
      userLayer.add(
        new Graphic({
          geometry: point(user.position),
          attributes: { sim: true },
          symbol: new TextSymbol({
            text: 'SIM',
            color: MAP_COLORS.white,
            backgroundColor: MAP_COLORS.sim,
            yoffset: -22,
            font: { family: 'Arial', size: 8, weight: 'bold' },
          }),
        }),
      );
    }
    userGraphics.value = { dot, accuracy };
    return;
  }
  userGraphics.value.accuracy.geometry = accuracyGeometry;
  userGraphics.value.dot.geometry = point(user.position);
  userGraphics.value.dot.symbol = dotSymbol;
  for (const graphic of userLayer.graphics) {
    if (graphic.attributes?.sim) graphic.geometry = point(user.position);
  }
}

// ---------------------------------------------------------------- camera

const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

async function fitTo(points: readonly LatLng[] | null = props.fit): Promise<void> {
  const view = mapEl.value?.view;
  const extent = points ? extentOf(points) : null;
  if (!view || !extent) return;
  try {
    // Positions without an area (one, or all in the same place): their centre, close up.
    await view.goTo(
      hasArea(extent) ? extent.expand(1.25) : { target: extent.center, zoom: props.fitZoom ?? 17 },
      { animate: !reduceMotion },
    );
  } catch {
    // An interrupted animation is fine.
  }
}

async function recenter(): Promise<void> {
  const view = mapEl.value?.view;
  if (!view) return;
  if (props.user) {
    try {
      await view.goTo(
        { target: point(props.user.position), zoom: Math.max(view.zoom, 17) },
        { animate: !reduceMotion },
      );
    } catch {
      // Interrupted.
    }
  } else {
    await fitTo();
  }
}

let followFrame = 0;
function followUser(): void {
  if (!props.follow || !props.user || followFrame) return;
  // At most one camera move per frame (PROJECT_PLAN §10.3).
  followFrame = requestAnimationFrame(() => {
    followFrame = 0;
    const view = mapEl.value?.view;
    if (!view || !props.user || view.interacting) return;
    view
      .goTo(
        { center: [props.user.position.lng, props.user.position.lat] },
        { animate: !reduceMotion, duration: 500 },
      )
      .catch(() => {});
  });
}

function openPopup(markerId: string): void {
  const view = mapEl.value?.view;
  const graphic = markerGraphics.get(markerId)?.graphic;
  if (!view || !graphic) return;
  void view.openPopup({ features: [graphic], location: graphic.geometry as Point });
}

function closePopup(): void {
  mapEl.value?.view?.closePopup();
}

/** The view, once it's ready to move (camera calls before that do nothing). */
function readyView() {
  const view = mapEl.value?.view;
  return ready.value && view?.ready ? view : null;
}

async function goTo(center: LatLng, zoom?: number): Promise<void> {
  const view = readyView();
  if (!view) return;
  try {
    await view.goTo(
      { target: point(center), zoom: zoom ?? Math.max(view.zoom, 16) },
      { animate: !reduceMotion },
    );
  } catch {
    // Interrupted.
  }
}

function centerOfView(): LatLng | null {
  const center = readyView()?.center;
  if (center?.latitude == null || center.longitude == null) return null;
  return { lat: center.latitude, lng: center.longitude };
}

const api: RouteMapApi = {
  openPopup,
  closePopup,
  recenter,
  fitTo,
  goTo,
  center: centerOfView,
};
defineExpose(api);

// ---------------------------------------------------------------- lifecycle

onMounted(async () => {
  const element = mapEl.value;
  if (!element) return;
  intl.setLocale(LOCALE_TAGS[currentLocale()]);
  offLocale = onLocaleChange((locale) => intl.setLocale(LOCALE_TAGS[locale]));

  element.map = map;
  element.attributionMode = props.theme;
  // Esri's attribution is always shown, but by us: the SDK's own strip sits at
  // the very bottom, where sheets overlap it. Ours rises above them
  // (--attribution-offset) with the same text and "Powered by Esri".
  element.hideAttribution = true;
  // Web Mercator and Esri's standard zoom levels up front: without network
  // the basemap fails to load, and the points and the trace must still show
  // on a neutral background (PROJECT_PLAN §10.6).
  element.spatialReference = SpatialReference.WebMercator;
  element.constraints = {
    lods: TileInfo.create().lods,
    minZoom: 3,
    maxZoom: 19,
    rotationEnabled: false,
    snapToZoom: false,
  } as typeof element.constraints;
  const initial = extentOf(props.fit ?? props.markers.map((m) => m.position));
  if (initial && hasArea(initial)) element.extent = initial.expand(1.25);
  else {
    // One position (the creator's area) has no size: an extent would be an
    // invalid view (mapview:invalid-extent), so centre on it instead.
    const centre = initial?.center;
    element.center =
      centre?.longitude != null && centre.latitude != null
        ? [centre.longitude, centre.latitude]
        : [-8.807, 39.744];
    element.zoom = props.fitZoom ?? 15;
  }

  try {
    await element.viewOnReady();
  } catch {
    failed.value = true;
    if (!disposed) emit('failed');
    return;
  }
  // Unmounted while the view was loading (quick step changes in the creator):
  // wire nothing up, the element destroys its view on its own.
  if (disposed) return;
  const view = element.view;
  view.padding = { top: 0, bottom: 0, left: 0, right: 0, ...props.padding };
  // A compact card popup: no dock, no action bar, no feature paging (DESIGN §6.3).
  view.popup = {
    dockEnabled: false,
    // Never dock on small screens: a popup by its marker (DESIGN §6.3).
    dockOptions: { breakpoint: false, buttonEnabled: false },
    alignment: 'top-center',
    highlightEnabled: false,
    visibleElements: {
      actionBar: false,
      collapseButton: false,
      featureNavigation: false,
      heading: false,
      closeButton: true,
    },
  };
  view.popupEnabled = props.popups;
  syncMarkers(props.markers);
  syncLine(pathLayer, props.path, pathSymbol);
  syncLine(trackLayer, props.track, trackSymbol);
  syncLines(props.lines);
  syncZone(props.zone);
  syncZones(props.zones);
  syncUser(props.user);
  if (props.fit?.length) void fitTo(props.fit);

  /** Where a tap or a long press landed, or null when it was on a marker. */
  const offMarkers = async (event: ClickEvent | HoldEvent): Promise<LatLng | null> => {
    const hit = await view.hitTest(event, { include: [pointsLayer] });
    if (hit.results.length > 0 || !event.mapPoint) return null;
    return { lat: event.mapPoint.latitude ?? 0, lng: event.mapPoint.longitude ?? 0 };
  };

  /**
   * What a tap landed on: a marker (they are on top, so they win), a route's
   * line or nothing. Of the lines under a finger, one whose stroke was hit
   * beats one whose invisible strip was.
   */
  const tappedOn = async (
    event: ClickEvent,
  ): Promise<{ marker: string | null } | { line: string } | null> => {
    const { results } = await view.hitTest(event, { include: [pointsLayer, linesLayer] });
    const hits = results.flatMap((result) =>
      'graphic' in result ? [(result.graphic.attributes ?? {}) as Record<string, unknown>] : [],
    );
    const marker = hits.find((attributes) => attributes['line'] === undefined);
    if (marker) return { marker: typeof marker['id'] === 'string' ? marker['id'] : null };
    const line = hits.find((attributes) => !attributes['hit']) ?? hits[0];
    return line ? { line: String(line['line']) } : null;
  };

  handles.push(
    reactiveUtils.watch(
      () => view.attributionItems.map((item) => item.text).join(' | '),
      (text) => {
        attribution.value = text;
      },
      { initial: true },
    ),
    // Room for the popup: the marker moves to the lower part of the map and
    // the card opens above it, never off screen.
    reactiveUtils.watch(
      () => view.popup?.selectedFeature,
      (feature) => {
        const geometry = feature?.geometry;
        if (!geometry || geometry.type !== 'point') return;
        const screen = view.toScreen(geometry as Point);
        if (!screen) return;
        const lift = view.height * 0.25;
        const center = view.toMap({ x: screen.x, y: screen.y - lift });
        if (center)
          view.goTo({ center }, { animate: !reduceMotion, duration: 350 }).catch(() => {});
      },
    ),
    view.on('drag', (event) => {
      if (event.action === 'start') emit('userPan');
    }),
    view.on('click', async (event) => {
      const tapped = await tappedOn(event);
      if (tapped && 'marker' in tapped) {
        if (tapped.marker !== null) emit('markerTap', tapped.marker);
      } else if (tapped) {
        emit('lineTap', tapped.line);
      } else if (event.mapPoint) {
        emit('mapClick', { lat: event.mapPoint.latitude ?? 0, lng: event.mapPoint.longitude ?? 0 });
      }
    }),
    // Long press (DESIGN C2: hold the map to add a point): 500 ms without
    // dragging, and the SDK sends no click after it. No check on `button`:
    // after a little finger jitter the SDK passes the last pointermove (-1).
    view.on('hold', async (event) => {
      const position = await offMarkers(event);
      if (position) emit('mapHold', position);
    }),
  );
  ready.value = true;
  emit('ready');
});

onBeforeUnmount(() => {
  disposed = true;
  offLocale?.();
  if (followFrame) cancelAnimationFrame(followFrame);
  for (const handle of handles) handle.remove();
});

watch(
  () => props.markers,
  (markers) => {
    if (ready.value) syncMarkers(markers);
  },
);
watch(
  () => props.large,
  () => {
    if (!ready.value) return;
    for (const entry of markerGraphics.values()) entry.look = '';
    syncMarkers(props.markers);
    syncLines(props.lines);
  },
);
watch(
  () => props.lines,
  (lines) => ready.value && syncLines(lines),
);
watch(
  () => props.popups,
  (popups) => {
    const view = mapEl.value?.view;
    if (!ready.value || !view) return;
    view.popupEnabled = popups;
    if (!popups) view.closePopup();
  },
);
watch(
  () => props.path,
  (path) => ready.value && syncLine(pathLayer, path, pathSymbol),
);
watch(
  () => props.track,
  (track) => ready.value && syncLine(trackLayer, track, trackSymbol),
);
watch(
  () => props.zone,
  (zone) => ready.value && syncZone(zone),
);
watch(
  () => props.zones,
  (zones) => ready.value && syncZones(zones),
);
watch(
  () => props.user,
  (user) => {
    if (!ready.value) return;
    syncUser(user);
    followUser();
  },
);
watch(
  () => props.follow,
  (follow) => {
    if (follow) void recenter();
  },
);
watch(
  () => props.padding,
  (padding) => {
    const view = mapEl.value?.view;
    if (view) view.padding = { top: 0, bottom: 0, left: 0, right: 0, ...padding };
  },
  { deep: true },
);
watch(
  () => [props.theme, props.basemap] as const,
  ([theme, basemap]) => {
    map.basemap = createBasemap(basemap, theme) as Map['basemap'];
    if (mapEl.value) mapEl.value.attributionMode = theme;
  },
);
</script>

<template>
  <div class="arcgis" role="region" :aria-label="label" :data-ready="ready || undefined">
    <arcgis-map ref="mapEl" class="arcgis__map" />
    <!-- The markers as a list: keyboard and screen-reader users reach every
         popup (DESIGN §12). Hidden until it gets focus. -->
    <ul v-if="popups" class="arcgis__list" :aria-label="t('map.markers')">
      <li v-for="marker in markers" :key="marker.id">
        <button type="button" @click="openPopup(marker.id)">{{ marker.popup.title }}</button>
      </li>
    </ul>
    <!-- The same for the routes drawn as lines: picking one is a tap on it. -->
    <ul v-if="lines.length > 0" class="arcgis__list" :aria-label="linesLabel">
      <li v-for="line in lines" :key="line.id">
        <button type="button" @click="emit('lineTap', line.id)">{{ line.label }}</button>
      </li>
    </ul>
    <slot />
    <p class="arcgis__attribution">
      <span class="arcgis__sources">{{ attribution }}</span>
      <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Powered by Esri</a>
    </p>
  </div>
</template>

<style scoped>
.arcgis {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-surface-2);
}
.arcgis__map {
  display: block;
  width: 100%;
  height: 100%;
}
.arcgis__list {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  list-style: none;
}
.arcgis__list:focus-within {
  width: auto;
  max-width: calc(100% - 16px);
  height: auto;
  max-height: 50%;
  padding: 8px;
  overflow-y: auto;
  clip-path: none;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.arcgis__list button {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: 600 15px var(--font-ui);
  text-align: left;
}
.arcgis__attribution {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--attribution-offset, 0px);
  z-index: 1;
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--color-surface) 75%, transparent);
  color: var(--color-text-muted);
  font: 500 10px/16px var(--font-ui);
  pointer-events: none;
}
.arcgis__sources {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arcgis__attribution a {
  flex: none;
  color: inherit;
  font-weight: 600;
  pointer-events: auto;
}
</style>
