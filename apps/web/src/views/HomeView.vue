<script setup lang="ts">
import {
  List,
  ListFilter,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Plus,
  Route as RouteIcon,
  WifiOff,
  X,
} from '@lucide/vue';
import { COMMUNITY_ROUTES, type Interest } from '@rumbo/api-contract';
import { distance, type LatLng } from '@rumbo/geo-utils';
import type { Locale, PointCategory } from '@rumbo/route-spec';
import { computed, defineAsyncComponent, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ActivityBadge from '../components/ActivityBadge.vue';
import AppButton from '../components/AppButton.vue';
import ChipGroup from '../components/ChipGroup.vue';
import EmptyState from '../components/EmptyState.vue';
import FilterChips from '../components/FilterChips.vue';
import LineSwatch from '../components/LineSwatch.vue';
import MapFab from '../components/MapFab.vue';
import RouteCard from '../components/RouteCard.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import SheetFrame from '../components/SheetFrame.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import WordMark from '../components/WordMark.vue';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import {
  dimMarkers,
  filterMarkers,
  filterRoutes,
  legendEntries,
  type MapMode,
  markerRouteId,
  poiMarkers,
  presentInterests,
  presentOrigins,
  routeLines,
  routeMarkers,
  type RouteOrigin,
} from '../map/explore.ts';
import { ACTIVITY_LOOKS } from '../map/symbols.ts';
import type { MapMarker, MapUser, RouteMapApi } from '../map/types.ts';
import type { CatalogRoute } from '../services/catalog.ts';
import { useOnline } from '../services/network.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { local } from '../services/storage.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';

// S01 · Explore: routes as a list or on a map. The map has two views (ADR
// 0005): the points, with every route's pins coloured by activity and the
// points of interest (the course's 20+ markers, popups and filter), and the
// routes, each drawn as a line in its activity's colour and style. Where the
// user is known (phase 7.2), the routes the community published around them
// come after the curated ones, in the list and on the map.
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const { t, locale } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const settings = useSettingsStore();
const ui = useUiStore();
const texts = useTexts();
const format = useFormat();
const online = useOnline();

type View = 'list' | 'map';
type Filter = 'all' | 'free' | 'challenge' | 'walk' | 'bike';
const VIEW_KEY = 'rumbo.explore.view';
const MODE_KEY = 'rumbo.explore.mapMode';
const view = ref<View>(local.read(VIEW_KEY) === 'map' ? 'map' : 'list');
watch(view, (value) => local.write(VIEW_KEY, value));
const mapMode = ref<MapMode>(local.read(MODE_KEY) === 'routes' ? 'routes' : 'points');
const filter = ref<Filter>('all');

const viewOptions = computed(() => [
  { value: 'list' as View, label: t('home.view.list'), icon: List },
  { value: 'map' as View, label: t('home.view.map'), icon: MapIcon },
]);
const mapModeOptions = computed(() => [
  { value: 'points' as MapMode, label: t('explore.map.points'), icon: MapPin },
  { value: 'routes' as MapMode, label: t('explore.map.routes'), icon: RouteIcon },
]);
const filterOptions = computed(() => [
  { value: 'all' as Filter, label: t('home.filters.all') },
  { value: 'free' as Filter, label: t('mode.free') },
  { value: 'challenge' as Filter, label: t('mode.challenge') },
  { value: 'walk' as Filter, label: t('activity.walk') },
  { value: 'bike' as Filter, label: t('activity.bike') },
]);

const matchesFilter = ({ bundle: { spec } }: CatalogRoute): boolean => {
  if (filter.value === 'free' || filter.value === 'challenge') return spec.mode === filter.value;
  if (filter.value === 'walk' || filter.value === 'bike') return spec.activity === filter.value;
  return true;
};
const routes = computed(() => catalog.routes.filter(matchesFilter));
/** The community's routes around the user, under the same filter. */
const communityRoutes = computed(() => catalog.community.filter(matchesFilter));
/** The routes the map can draw: the ones under the chips above it, before the sheet's filter. */
const mapRoutes = computed(() => [...routes.value, ...communityRoutes.value]);
const communityId = useId();

// ---- map
// The sheet's filter: by origin and by interest (never by route name: the
// routes are content, not part of the app), the points of interest and the
// categories. Choosing none of a kind means all of that kind.
const origins = ref<Set<RouteOrigin>>(new Set());
const interests = ref<Set<Interest>>(new Set());
const showPois = ref(true);
const categories = ref<Set<PointCategory>>(new Set());
const filterOpen = ref(false);
/** The route highlighted in the routes view: its card is shown and the others fade. */
const selectedId = ref<string | null>(null);

watch(mapMode, (mode) => {
  local.write(MODE_KEY, mode);
  selectedId.value = null;
});

const lang = computed(() => locale.value as Locale);
/** The routes that pass the sheet's filter. */
const shownRoutes = computed(() =>
  filterRoutes(mapRoutes.value, { origins: origins.value, interests: interests.value }),
);
const hiddenRoutes = computed(() => {
  const shown = new Set(shownRoutes.value.map((route) => route.id));
  return new Set(mapRoutes.value.filter((route) => !shown.has(route.id)).map((route) => route.id));
});
/** The highlighted route, while it is still on the map. */
const selected = computed(() =>
  mapMode.value === 'routes'
    ? (shownRoutes.value.find((route) => route.id === selectedId.value) ?? null)
    : null,
);
watch(selected, (route) => {
  if (route === null) selectedId.value = null;
});

const allMarkers = computed(() => {
  const translate = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  return [
    ...routeMarkers(mapRoutes.value, lang.value, translate),
    ...poiMarkers(catalog.pois, lang.value, translate),
  ];
});
/** The routes view has no points of interest: only the route pins are in it. */
const inMode = (list: readonly MapMarker[]): MapMarker[] =>
  mapMode.value === 'routes' ? list.filter((marker) => marker.state === 'explore') : [...list];
/** The markers the filter lets through in the current view. */
const markers = computed(() =>
  inMode(
    filterMarkers(allMarkers.value, {
      hiddenRoutes: hiddenRoutes.value,
      showPois: showPois.value,
      categories: categories.value,
    }),
  ),
);
/** What the map is handed: in the routes view, the pins of the other routes fade while one is highlighted. */
const mapMarkers = computed(() =>
  mapMode.value === 'routes'
    ? dimMarkers(markers.value, selected.value?.id ?? null)
    : markers.value,
);
const lines = computed(() =>
  mapMode.value === 'routes'
    ? routeLines(shownRoutes.value, lang.value, selected.value?.id ?? null)
    : [],
);
const legend = computed(() => legendEntries(mapMode.value, shownRoutes.value, markers.value));
const markerTotal = computed(() => inMode(allMarkers.value).length);

const categoryOptions = computed(() =>
  [...new Set(inMode(allMarkers.value).map((marker) => marker.category))]
    .sort()
    .map((category) => ({ value: category, label: t(`category.${category}`) })),
);
const originOptions = computed(() =>
  presentOrigins(mapRoutes.value).map((origin) => ({
    value: origin,
    label: t(`filter.origins.${origin}`),
  })),
);
const interestOptions = computed(() =>
  presentInterests(mapRoutes.value).map((interest) => ({
    value: interest,
    label: t(`create.interests.${interest}`),
  })),
);
const originHeadingId = useId();
const interestHeadingId = useId();
const categoryHeadingId = useId();

const mapRef = ref<RouteMapApi | null>(null);

// "Mi ubicación": Rumbo works wherever the user is, so the map shows where
// that is. The position is read once per tap (nothing is asked before) and
// moves the map. It isn't stored; the only thing that leaves the device is
// the position rounded to about 110 m, to ask for the community's routes
// around it (GET /routes?near=).
const me = shallowRef<MapUser | null>(null);
const locating = ref(false);
/** Without a geolocation API (or in a context that forbids it) the button isn't offered. */
const canLocate = globalThis.navigator?.geolocation !== undefined;
/** Explore's silent look at the position (below) is over, whatever it found. */
const lookedAround = ref(false);

/** Where the map opens: on the routes around the user when the position is known, else on the curated ones. */
const NEAR_ZOOM = 14;
const nearby = computed(() => {
  const here = me.value?.position;
  if (!here) return [];
  return mapRoutes.value.filter(
    (route) => distance(here, route.summary.centroid) <= COMMUNITY_ROUTES.radiusMeters,
  );
});
const pointsOf = (list: readonly CatalogRoute[]): LatLng[] =>
  list.flatMap((route) => route.bundle.spec.points.map((p) => p.position));
// Opens on the routes; points of interest further out appear when zooming out.
// With the user's position known (a tap on "Mi ubicación" or the permission
// already granted), on the routes within reach of the user, or on the user
// when there are none.
const fit = computed(() => {
  const here = me.value?.position;
  if (!here) return pointsOf(routes.value);
  return nearby.value.length > 0 ? pointsOf(nearby.value) : [here];
});
const fitZoom = computed(() => (me.value && nearby.value.length === 0 ? NEAR_ZOOM : undefined));

/** Remembers where the user is: the blue dot on the map, and the community's routes around. */
function setPosition(coords: GeolocationCoordinates): LatLng {
  const position = { lat: coords.latitude, lng: coords.longitude };
  me.value = { position, accuracy: coords.accuracy, heading: null, simulated: false };
  void catalog.loadCommunity(position);
  return position;
}

function locateMe(): void {
  if (locating.value) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      locating.value = false;
      // Before the camera: in the list there is no map to move, but the position still counts.
      const position = setPosition(coords);
      void mapRef.value?.goTo(position, 16);
    },
    (error) => {
      locating.value = false;
      ui.toast(
        {
          key:
            error.code === error.PERMISSION_DENIED
              ? 'explore.locationDenied'
              : 'explore.locationFailed',
        },
        { tone: 'warning' },
      );
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

/**
 * On opening, Explore looks for the position by itself only when the browser
 * already has the user's yes (Permissions API): it asks nothing, reads it once
 * and loosely (the routes around need a neighbourhood, not a street). In any
 * other case it waits for a tap on "Mi ubicación".
 */
async function lookAround(): Promise<void> {
  try {
    const permissions = globalThis.navigator?.permissions as Permissions | undefined;
    if (!canLocate || !permissions) return;
    const { state } = await permissions.query({ name: 'geolocation' });
    if (state !== 'granted' || me.value) return;
    await new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (!me.value) setPosition(coords);
          resolve();
        },
        () => resolve(),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
      );
    });
  } catch {
    // A browser that can't tell (no Permissions API for geolocation): the button asks.
  } finally {
    lookedAround.value = true;
  }
}

// ---- the community's routes (list)
/** The invitation to tap "Mi ubicación": there is no position yet, and nothing to wait for. */
const showInvite = computed(
  () =>
    canLocate &&
    online.value &&
    lookedAround.value &&
    me.value === null &&
    catalog.communityStatus === 'idle',
);
/** The section "De la comunidad, cerca de ti": loading, failed, empty or with routes (filtered out: none). */
const showCommunity = computed(
  () =>
    online.value &&
    catalog.communityStatus !== 'idle' &&
    (catalog.communityStatus !== 'ready' ||
      catalog.community.length === 0 ||
      communityRoutes.value.length > 0),
);

function retryCommunity(): void {
  if (me.value) void catalog.loadCommunity(me.value.position);
}
// Back online: the routes around the user, if the position is known.
watch(online, (isOnline) => {
  if (isOnline && me.value) void catalog.loadCommunity(me.value.position);
});

/** A copy of the set with `value` in it if it wasn't, and out of it if it was. */
function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
function showAll(): void {
  origins.value = new Set();
  interests.value = new Set();
  showPois.value = true;
  categories.value = new Set();
}

function openRoute(routeId: string): void {
  void router.push({ name: 'route', params: { routeId } });
}
function onMarkerAction({ markerId, action }: { markerId: string; action: string }): void {
  if (action === 'viewRoute') openRoute(markerRouteId(markerId));
}

// The routes view: a tap on a route's line or on one of its pins (or its entry
// in the keyboard list) highlights it; a tap anywhere else lets it go.
function onLineTap(routeId: string): void {
  if (mapMode.value === 'routes') selectedId.value = routeId;
}
function onMarkerTap(markerId: string): void {
  if (mapMode.value === 'routes') selectedId.value = markerRouteId(markerId);
}

onMounted(() => {
  void catalog.load();
  void lookAround();
  // Warm the map SDK while the user reads the list (PROJECT_PLAN §10.3).
  const idle = globalThis.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => void import('../map/RouteMap.vue'));
});
</script>

<template>
  <main class="home" :class="{ 'home--map': view === 'map' }">
    <header class="home__top">
      <WordMark :size="30" />
    </header>
    <div class="home__controls">
      <SegmentedControl v-model="view" :options="viewOptions" :label="t('home.view.label')" />
      <ChipGroup v-model="filter" :options="filterOptions" :label="t('home.filters.label')" />
      <p v-if="!online" class="home__offline" role="status">
        <WifiOff :size="18" aria-hidden="true" />{{ t('explore.offline') }}
      </p>
    </div>

    <section v-if="view === 'list'" class="home__list" :aria-busy="catalog.status === 'loading'">
      <template v-if="catalog.status === 'loading' || catalog.status === 'idle'">
        <div v-for="n in 2" :key="n" class="skeleton" aria-hidden="true">
          <div class="skeleton__cover" />
          <div class="skeleton__line" />
          <div class="skeleton__line skeleton__line--short" />
        </div>
      </template>
      <EmptyState v-else-if="catalog.status === 'error'" :title="t('explore.error')">
        <AppButton size="m" @click="catalog.load()">{{ t('common.retry') }}</AppButton>
      </EmptyState>
      <template v-else>
        <EmptyState
          v-if="routes.length === 0 && communityRoutes.length === 0"
          :title="t('explore.empty.title')"
          :body="t('explore.empty.body')"
        >
          <AppButton size="m" @click="router.push('/create')">
            <template #icon><Plus :size="20" aria-hidden="true" /></template>
            {{ t('explore.empty.cta') }}
          </AppButton>
        </EmptyState>
        <RouteCard
          v-for="route in routes"
          :key="route.id"
          :route="route"
          :downloaded="catalog.downloaded.has(route.id)"
        />

        <div v-if="showInvite" class="invite">
          <p class="invite__text">{{ t('explore.community.invite') }}</p>
          <AppButton variant="secondary" size="m" :loading="locating" @click="locateMe">
            <template #icon><LocateFixed :size="20" aria-hidden="true" /></template>
            {{ t('explore.locate') }}
          </AppButton>
        </div>

        <section v-if="showCommunity" class="community" :aria-labelledby="communityId">
          <h2 :id="communityId" class="t-h2">{{ t('explore.community.title') }}</h2>
          <div v-if="catalog.communityStatus === 'loading'" class="skeleton" aria-hidden="true">
            <div class="skeleton__cover" />
            <div class="skeleton__line" />
            <div class="skeleton__line skeleton__line--short" />
          </div>
          <div
            v-else-if="catalog.communityStatus === 'error'"
            class="community__quiet"
            role="status"
          >
            <p>{{ t('explore.community.error') }}</p>
            <AppButton variant="secondary" size="s" @click="retryCommunity">{{
              t('common.retry')
            }}</AppButton>
          </div>
          <p v-else-if="catalog.community.length === 0" class="community__quiet">
            {{ t('explore.community.empty') }}
          </p>
          <RouteCard
            v-for="route in communityRoutes"
            :key="route.id"
            :route="route"
            :downloaded="catalog.downloaded.has(route.id)"
          />
        </section>
      </template>
    </section>

    <section v-else class="home__map">
      <RouteMap
        ref="mapRef"
        :markers="mapMarkers"
        :lines="lines"
        :lines-label="t('explore.map.routesList')"
        :popups="mapMode === 'points'"
        :fit="fit"
        :fit-zoom="fitZoom"
        :user="me"
        :theme="theme"
        :large="settings.sol"
        :label="t('home.view.map')"
        @action="onMarkerAction"
        @marker-tap="onMarkerTap"
        @line-tap="onLineTap"
        @map-click="selectedId = null"
      >
        <div class="home__mode">
          <SegmentedControl
            v-model="mapMode"
            :options="mapModeOptions"
            :label="t('explore.map.mode')"
          />
        </div>
        <div class="home__fabs">
          <MapFab :icon="ListFilter" :label="t('filter.open')" @click="filterOpen = true" />
          <MapFab
            v-if="canLocate"
            :icon="LocateFixed"
            tone="primary"
            :label="t('explore.locate')"
            :aria-busy="locating || undefined"
            @click="locateMe"
          />
        </div>
        <div class="dock">
          <!-- Always there, so a screen reader announces the route when it is picked. -->
          <div class="dock__live" role="status">
            <div v-if="selected" class="pick">
              <div class="pick__body">
                <p class="pick__name">
                  {{ texts.text(selected.bundle.spec.name, selected.bundle.spec.locale) }}
                </p>
                <p class="pick__meta">
                  <LineSwatch :activity="selected.bundle.spec.activity" />
                  <ActivityBadge :activity="selected.bundle.spec.activity" plain />
                  <span class="tabular">{{
                    format.distance(selected.summary.distanceMeters)
                  }}</span>
                </p>
              </div>
              <AppButton size="m" @click="openRoute(selected.id)">{{
                t('popup.viewRoute')
              }}</AppButton>
              <button
                type="button"
                class="pick__close"
                :aria-label="t('common.close')"
                @click="selectedId = null"
              >
                <X :size="20" aria-hidden="true" />
              </button>
            </div>
          </div>
          <ul
            v-if="legend.activities.length > 0 || legend.places"
            class="legend"
            :aria-label="t('filter.legend')"
          >
            <li v-for="activity in legend.activities" :key="activity" class="legend__item">
              <LineSwatch v-if="mapMode === 'routes'" :activity="activity" />
              <span
                v-else
                class="legend__dot"
                :style="{ background: ACTIVITY_LOOKS[activity].color }"
              />
              {{ t(`activity.${activity}`) }}
            </li>
            <li v-if="legend.places" class="legend__item">
              <span class="legend__dot legend__dot--poi" />{{ t('filter.places') }}
            </li>
          </ul>
        </div>
      </RouteMap>
    </section>

    <SheetFrame v-if="filterOpen" @dismiss="filterOpen = false">
      <div class="panel">
        <h2 class="t-h2">{{ t('filter.title') }}</h2>
        <p class="t-small t-muted">
          {{ t('filter.count', { shown: markers.length, total: markerTotal }) }}
        </p>
        <!-- With a single origin there is nothing to choose between. -->
        <template v-if="originOptions.length > 1">
          <h3 :id="originHeadingId" class="t-caption t-muted">{{ t('filter.origin') }}</h3>
          <FilterChips
            :options="originOptions"
            :selected="origins"
            :labelledby="originHeadingId"
            @toggle="origins = toggled(origins, $event)"
          />
        </template>
        <template v-if="interestOptions.length > 0">
          <h3 :id="interestHeadingId" class="t-caption t-muted">{{ t('filter.interests') }}</h3>
          <FilterChips
            :options="interestOptions"
            :selected="interests"
            :labelledby="interestHeadingId"
            @toggle="interests = toggled(interests, $event)"
          />
        </template>
        <!-- The routes view has no points of interest to switch. -->
        <div v-if="mapMode === 'points'" class="panel__row">
          <span class="legend__dot legend__dot--poi" />
          <span class="panel__label">{{ t('filter.places') }}</span>
          <ToggleSwitch v-model="showPois" :label="t('filter.places')" />
        </div>
        <template v-if="categoryOptions.length > 0">
          <h3 :id="categoryHeadingId" class="t-caption t-muted">{{ t('filter.categories') }}</h3>
          <FilterChips
            :options="categoryOptions"
            :selected="categories"
            :labelledby="categoryHeadingId"
            @toggle="categories = toggled(categories, $event)"
          />
        </template>
        <div class="panel__actions">
          <AppButton variant="secondary" size="m" @click="showAll">{{
            t('filter.showAll')
          }}</AppButton>
          <AppButton size="m" @click="filterOpen = false">{{ t('filter.done') }}</AppButton>
        </div>
      </div>
    </SheetFrame>
  </main>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  max-width: 720px;
  margin: 0 auto;
}
.home--map {
  max-width: none;
  height: calc(100dvh - var(--nav-height) - var(--safe-bottom));
}
.home__top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(16px + var(--safe-top)) var(--gutter) 12px;
}
.home__controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 var(--gutter) 12px;
}
.home__offline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font: 500 14px/20px var(--font-ui);
}
.home__list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 var(--gutter) 24px;
}
.home__map {
  position: relative;
  flex: 1;
  min-height: 0;
}
/* The invitation to tap "Mi ubicación": small, and quieter than a route. */
.invite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.invite__text {
  color: var(--color-text-muted);
  font: 500 15px/22px var(--font-ui);
}
.community {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 8px;
}
.community__quiet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  color: var(--color-text-muted);
  font: 500 15px/22px var(--font-ui);
}
.home__fabs {
  position: absolute;
  top: 12px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* The map's own switch: Puntos | Rutas, floating at the top left. */
.home__mode {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 208px;
  max-width: calc(100% - 96px);
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-e2);
}
/* The bottom strip: the highlighted route's card over the legend. It lets taps through where it is empty. */
.dock {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}
.dock__live,
.legend {
  pointer-events: auto;
}
.dock__live {
  width: 100%;
  max-width: 480px;
}
/* The name and the button share a row while they fit, else the button goes under the name; the close button stays at the right edge. */
.pick {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 52px 10px 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.pick__body {
  flex: 1 1 140px;
  min-width: 0;
}
.pick__name {
  font: 600 17px/22px var(--font-display);
  overflow-wrap: anywhere;
}
.pick__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  color: var(--color-text-muted);
  font: 500 13px/18px var(--font-ui);
}
.pick__close {
  position: absolute;
  top: 50%;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  transform: translateY(-50%);
}
.legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
  list-style: none;
}
.legend__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 600 13px/16px var(--font-ui);
}
/* A little pin, like the ones on the map: its colour, a white ring and a soft shadow. */
.legend__dot {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(22 25 29 / 45%);
}
.legend__dot--poi {
  background: #fff;
  border: 1.5px solid #16191d;
  box-shadow: none;
}
.skeleton {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.skeleton__cover {
  aspect-ratio: 16 / 9;
  background: var(--color-surface-2);
}
.skeleton__line {
  height: 14px;
  margin: 14px 16px;
  width: 70%;
  border-radius: 6px;
  background: var(--color-surface-2);
}
.skeleton__line--short {
  width: 40%;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px var(--gutter) calc(16px + var(--safe-bottom));
  overflow-y: auto;
}
.panel h3 {
  margin-top: 8px;
}
.panel__row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
}
.panel__label {
  flex: 1;
  font: 500 16px/22px var(--font-ui);
}
.panel__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.panel__actions > * {
  flex: 1;
}
</style>
