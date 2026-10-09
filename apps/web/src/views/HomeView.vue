<script setup lang="ts">
import { List, ListFilter, LocateFixed, Map as MapIcon, Plus, WifiOff } from '@lucide/vue';
import { COMMUNITY_ROUTES } from '@rumbo/api-contract';
import { distance, type LatLng } from '@rumbo/geo-utils';
import type { Locale, PointCategory } from '@rumbo/route-spec';
import { computed, defineAsyncComponent, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import ChipGroup from '../components/ChipGroup.vue';
import EmptyState from '../components/EmptyState.vue';
import MapFab from '../components/MapFab.vue';
import RouteCard from '../components/RouteCard.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import SheetFrame from '../components/SheetFrame.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import WordMark from '../components/WordMark.vue';
import { useTexts } from '../i18n/text.ts';
import { filterMarkers, poiMarkers, routeMarkers } from '../map/explore.ts';
import type { MapUser, RouteMapApi } from '../map/types.ts';
import type { CatalogRoute } from '../services/catalog.ts';
import { useOnline } from '../services/network.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { local } from '../services/storage.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';

// S01 · Explore: routes as a list or on a map with every curated point and
// the points of interest (the course's 20+ markers, popups and filter). Where
// the user is known (phase 7.2), the routes the community published around
// them come after the curated ones, in the list and on the map.
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const { t, locale } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const settings = useSettingsStore();
const ui = useUiStore();
const texts = useTexts();
const online = useOnline();

type View = 'list' | 'map';
type Filter = 'all' | 'free' | 'challenge' | 'walk' | 'bike';
const VIEW_KEY = 'rumbo.explore.view';
const view = ref<View>(local.read(VIEW_KEY) === 'map' ? 'map' : 'list');
watch(view, (value) => local.write(VIEW_KEY, value));
const filter = ref<Filter>('all');

const viewOptions = computed(() => [
  { value: 'list' as View, label: t('home.view.list'), icon: List },
  { value: 'map' as View, label: t('home.view.map'), icon: MapIcon },
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
/** Everything the map draws and its legend and filter panel list. */
const mapRoutes = computed(() => [...routes.value, ...communityRoutes.value]);
const communityId = useId();

// ---- map
const hiddenRoutes = ref<Set<string>>(new Set());
const showPois = ref(true);
const categories = ref<Set<PointCategory>>(new Set());
const filterOpen = ref(false);

const allMarkers = computed(() => {
  const lang = locale.value as Locale;
  const translate = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  return [
    ...routeMarkers(mapRoutes.value, lang, translate),
    ...poiMarkers(catalog.pois, lang, translate),
  ];
});
const markers = computed(() =>
  filterMarkers(allMarkers.value, {
    hiddenRoutes: hiddenRoutes.value,
    showPois: showPois.value,
    categories: categories.value,
  }),
);
const usedCategories = computed(() => [...new Set(allMarkers.value.map((m) => m.category))].sort());

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

function toggleRoute(id: string, on: boolean): void {
  const next = new Set(hiddenRoutes.value);
  if (on) next.delete(id);
  else next.add(id);
  hiddenRoutes.value = next;
}
function toggleCategory(category: PointCategory): void {
  const next = new Set(categories.value);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  categories.value = next;
}
function showAll(): void {
  hiddenRoutes.value = new Set();
  showPois.value = true;
  categories.value = new Set();
}

function onMarkerAction({ markerId, action }: { markerId: string; action: string }): void {
  if (action === 'viewRoute')
    void router.push({ name: 'route', params: { routeId: markerId.split('/')[0] } });
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
        :markers="markers"
        :fit="fit"
        :fit-zoom="fitZoom"
        :user="me"
        :theme="theme"
        :large="settings.sol"
        :label="t('home.view.map')"
        @action="onMarkerAction"
      >
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
        <div class="legend" :aria-label="t('filter.legend')">
          <span v-for="route in mapRoutes" :key="route.id" class="legend__item">
            <span
              class="legend__dot"
              :style="{ background: route.color, boxShadow: `0 0 0 1px ${route.color}` }"
            />
            {{ texts.text(route.bundle.spec.name, route.bundle.spec.locale) }}
          </span>
          <span v-if="catalog.pois.length" class="legend__item">
            <span class="legend__dot legend__dot--poi" />{{ t('filter.places') }}
          </span>
        </div>
      </RouteMap>
    </section>

    <SheetFrame v-if="filterOpen" @dismiss="filterOpen = false">
      <div class="panel">
        <h2 class="t-h2">{{ t('filter.title') }}</h2>
        <p class="t-small t-muted">
          {{ t('filter.count', { shown: markers.length, total: allMarkers.length }) }}
        </p>
        <h3 class="t-caption t-muted">{{ t('filter.routes') }}</h3>
        <div v-for="route in mapRoutes" :key="route.id" class="panel__row">
          <span class="legend__dot" :style="{ background: route.color }" />
          <span class="panel__label">{{
            texts.text(route.bundle.spec.name, route.bundle.spec.locale)
          }}</span>
          <ToggleSwitch
            :model-value="!hiddenRoutes.has(route.id)"
            :label="texts.text(route.bundle.spec.name, route.bundle.spec.locale)"
            @update:model-value="toggleRoute(route.id, $event)"
          />
        </div>
        <div class="panel__row">
          <span class="legend__dot legend__dot--poi" />
          <span class="panel__label">{{ t('filter.places') }}</span>
          <ToggleSwitch v-model="showPois" :label="t('filter.places')" />
        </div>
        <h3 class="t-caption t-muted">{{ t('filter.categories') }}</h3>
        <div class="panel__chips">
          <button
            v-for="category in usedCategories"
            :key="category"
            type="button"
            class="panel__chip"
            :class="{ 'is-on': categories.has(category) }"
            :aria-pressed="categories.has(category)"
            @click="toggleCategory(category)"
          >
            {{ t(`category.${category}`) }}
          </button>
        </div>
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
.legend {
  position: absolute;
  left: 12px;
  bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: calc(100% - 96px);
  /* Up to 20 community routes join the curated ones: the legend scrolls instead of leaving the map. */
  max-height: 40%;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.legend__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 600 13px/16px var(--font-ui);
}
.legend__dot {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
}
.legend__dot--poi {
  background: #fff;
  border-color: #16191d;
  border-width: 1.5px;
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
.panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.panel__chip {
  height: 36px;
  padding: 0 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font: 600 14px var(--font-ui);
}
.panel__chip.is-on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
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
