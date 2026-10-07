<script setup lang="ts">
import '@arcgis/map-components/components/arcgis-map';
import Graphic from '@arcgis/core/Graphic.js';
import Map from '@arcgis/core/Map.js';
import PopupTemplate from '@arcgis/core/PopupTemplate.js';
import Circle from '@arcgis/core/geometry/Circle.js';
import Extent from '@arcgis/core/geometry/Extent.js';
import Point from '@arcgis/core/geometry/Point.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import * as intl from '@arcgis/core/intl.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol.js';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import TextSymbol from '@arcgis/core/symbols/TextSymbol.js';
import type { LatLng } from '@rumbo/geo-utils';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { currentLocale, LOCALE_TAGS, onLocaleChange } from '../i18n/index.ts';
import { createBasemap } from './basemap.ts';
import './map.css';
import { popupContent } from './popup.ts';
import { MAP_COLORS, markerImage, userImage } from './symbols.ts';
import type { BasemapKind, MapMarker, MapPadding, MapTheme, MapUser, MapZone } from './types.ts';

// The only component that talks to the ArcGIS SDK (PROJECT_PLAN §10.3). It
// wraps the <arcgis-map> component (the recommended way in SDK 5.x) and keeps
// one graphic per marker, updating only what changed. (Named RouteMap, not
// ArcgisMap: Vue would read <arcgis-map> as this component calling itself.)

const props = withDefaults(
  defineProps<{
    markers: MapMarker[];
    path?: LatLng[] | null;
    track?: LatLng[] | null;
    user?: MapUser | null;
    zone?: MapZone | null;
    /** Positions to show when the map opens (and on fitTo()). */
    fit?: LatLng[] | null;
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
    user: null,
    zone: null,
    fit: null,
    padding: () => ({}),
    follow: false,
    basemap: 'streets',
    theme: 'light',
    large: false,
  },
);

const emit = defineEmits<{
  ready: [];
  action: [payload: { markerId: string; action: string }];
  mapClick: [position: LatLng];
  userPan: [];
}>();

const mapEl = ref<HTMLArcgisMapElement | null>(null);
const ready = ref(false);
const failed = ref(false);
/** Data providers of the current basemap, shown in our own attribution strip. */
const attribution = ref('');

const zoneLayer = new GraphicsLayer({ title: 'zone' });
const pathLayer = new GraphicsLayer({ title: 'path' });
const trackLayer = new GraphicsLayer({ title: 'track' });
const pointsLayer = new GraphicsLayer({ title: 'points' });
const labelsLayer = new GraphicsLayer({ title: 'labels', minScale: 6000 });
const userLayer = new GraphicsLayer({ title: 'user' });
const map = new Map({
  basemap: createBasemap(props.basemap, props.theme),
  layers: [zoneLayer, pathLayer, trackLayer, pointsLayer, labelsLayer, userLayer],
});

const markerGraphics = new globalThis.Map<
  string,
  { graphic: Graphic; look: string; label: Graphic | null }
>();
const latest = new globalThis.Map<string, MapMarker>();
const userGraphics = shallowRef<{ dot: Graphic; accuracy: Graphic } | null>(null);
let offLocale: (() => void) | null = null;
const handles: Array<{ remove(): void }> = [];

const point = (p: LatLng) => new Point({ latitude: p.lat, longitude: p.lng });

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
    dwell: marker.dwell !== undefined ? Math.round(marker.dwell * 20) / 20 : undefined,
    large: props.large,
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

// ---------------------------------------------------------------- lines and zone

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

function syncZone(zone: MapZone | null): void {
  zoneLayer.removeAll();
  if (!zone) return;
  zoneLayer.add(
    new Graphic({
      geometry: new Circle({
        center: point(zone.center),
        radius: zone.radius,
        radiusUnit: 'meters',
        geodesic: true,
      }),
      symbol: new SimpleFillSymbol({
        color: [196, 73, 31, 0.1],
        outline: { color: [196, 73, 31, 0.4], width: '1.5px' },
      }),
    }),
  );
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
    await view.goTo(
      points?.length === 1 ? { target: point(points[0] as LatLng), zoom: 17 } : extent.expand(1.25),
      {
        animate: !reduceMotion,
      },
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

defineExpose({ openPopup, closePopup, recenter, fitTo });

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
  element.constraints = {
    minZoom: 3,
    maxZoom: 19,
    rotationEnabled: false,
    snapToZoom: false,
  } as typeof element.constraints;
  const initial = extentOf(props.fit ?? props.markers.map((m) => m.position));
  if (initial) element.extent = initial.expand(1.25);
  else {
    element.center = [-8.807, 39.744];
    element.zoom = 15;
  }

  try {
    await element.viewOnReady();
  } catch {
    failed.value = true;
    return;
  }
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
  syncMarkers(props.markers);
  syncLine(pathLayer, props.path, pathSymbol);
  syncLine(trackLayer, props.track, trackSymbol);
  syncZone(props.zone);
  syncUser(props.user);
  if (props.fit?.length) void fitTo(props.fit);

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
      const hit = await view.hitTest(event, { include: [pointsLayer] });
      if (hit.results.length === 0 && event.mapPoint) {
        emit('mapClick', { lat: event.mapPoint.latitude ?? 0, lng: event.mapPoint.longitude ?? 0 });
      }
    }),
  );
  ready.value = true;
  emit('ready');
});

onBeforeUnmount(() => {
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
  <div class="arcgis" role="region" :aria-label="label">
    <arcgis-map ref="mapEl" class="arcgis__map" />
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
