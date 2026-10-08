<script setup lang="ts">
import { Crosshair, LoaderCircle, MapPinOff, RotateCcw, TriangleAlert } from '@lucide/vue';
import type { GeoSuggestion, ResolvedPlace } from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import { DRAFT_LIMITS, type DraftPlace, findOverlaps } from '@rumbo/route-builder';
import type { PointCategory } from '@rumbo/route-spec';
import { VueDraggable } from 'vue-draggable-plus';
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import AppButton from '../../components/AppButton.vue';
import PlaceEditorSheet, {
  type PlaceEditorValue,
  type SheetCover,
} from '../../components/PlaceEditorSheet.vue';
import PlaceListItem, { type PlaceAction } from '../../components/PlaceListItem.vue';
import PlaceSearch from '../../components/PlaceSearch.vue';
import { useFormat } from '../../i18n/useFormat.ts';
import type { MapMarker, MapPadding, MapZoneItem, RouteMapApi } from '../../map/types.ts';
import { track } from '../../services/analytics.ts';
import { resolvePlace } from '../../services/geo.ts';
import { resolvedTheme as theme } from '../../services/theme.ts';
import { type PlacePatch, useCreatorStore } from '../../stores/creator.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { useUiStore } from '../../stores/ui.ts';

// C2 · Lugares (DESIGN C2; design ux-2, ux-3, ux-7, ux-12): the map pinned on
// top with the places numbered in list order, their path and their zones
// (amber where they overlap); below it one scrolling column with the place
// search, the totals and the list, which reorders by dragging a handle or
// with Subir / Bajar. Holding the map, or "Añadir el centro del mapa", adds a
// point of one's own in a non-modal editor. Without the map (offline, no
// WebGL) search and list keep working. Desktop: list | map side by side.

type MapState = 'loading' | 'ready' | 'failed';
/** Without a map after this long, the screen says so (it may still turn up). */
const MAP_PATIENCE_MS = 8000;
/** Close enough to see a place's circle while editing it. */
const EDITOR_ZOOM = 16;
/** Room around what the map frames, px (a marker is 36 to 44 px wide). */
const MAP_MARGIN = 28;
/** The id of the point being added, on the map until it is saved or cancelled. */
const PREVIEW_ID = 'creator-new-place';
/** What a point of one's own can be (a found place keeps the type it came with). */
const OWN_CATEGORIES: readonly PointCategory[] = [
  'other',
  'monument',
  'museum',
  'church',
  'viewpoint',
  'nature',
  'food',
  'culture',
];

interface Editing {
  kind: 'new' | 'edit';
  /** The place being edited (null for a new point). */
  tempId: string | null;
  position: LatLng;
  /** Found in the search: its type stays as it came. */
  fromSearch: boolean;
  fields: PlaceEditorValue;
  /** What the place had: an untouched default stays unset in the route. */
  before: { radius?: number; required?: boolean };
}

const { t } = useI18n();
const router = useRouter();
const creator = useCreatorStore();
const settings = useSettingsStore();
const ui = useUiStore();
const format = useFormat();
const hintId = useId();

const mapState = ref<MapState>('loading');
/** The map's code didn't load, or its view couldn't start: nothing under the notice. */
const mapMissing = ref(false);
/** The map loads on its own (heavy SDK): never import it statically. */
const loadRouteMap = () =>
  defineAsyncComponent({
    loader: () => import('../../map/RouteMap.vue'),
    onError: (_error, _retry, fail) => {
      mapMissing.value = true;
      mapState.value = 'failed';
      fail();
    },
  });
const RouteMap = shallowRef(loadRouteMap());
const mapRef = ref<RouteMapApi | null>(null);
const mapBox = ref<HTMLElement | null>(null);
const mapKey = ref(0);
let mapTimer: ReturnType<typeof setTimeout> | null = null;

const search = ref<InstanceType<typeof PlaceSearch> | null>(null);
const heading = ref<HTMLElement | null>(null);
const searchFocused = ref(false);
const resolvingKey = ref<string | null>(null);
const resolvingName = ref('');
let resolving: AbortController | null = null;

const editor = ref<Editing | null>(null);
/** Space the editor sheet takes from the bottom of the map, px. */
const editorCover = ref(0);
let editorFramed = false;

const liveText = ref('');
const rows = new Map<string, InstanceType<typeof PlaceListItem>>();

const wideQuery = globalThis.matchMedia?.('(min-width: 1024px)');
const wide = ref(wideQuery?.matches ?? false);
const onWide = (event: MediaQueryListEvent) => {
  wide.value = event.matches;
};
const motion = !(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

// ---------------------------------------------------------------- the places

const places = computed(() => creator.draft?.places ?? []);
const count = computed(() => places.value.length);
const atMax = computed(() => count.value >= DRAFT_LIMITS.maxPlaces);
const defaultRadius = computed(
  () => creator.draft?.settingsOverrides?.defaultRadius ?? DRAFT_LIMITS.radius.default,
);
const categories = computed<readonly PointCategory[]>(() =>
  creator.draft?.mode === 'challenge' ? [...OWN_CATEGORIES, 'checkpoint'] : OWN_CATEGORIES,
);

/** The places as the map shows them: the editor's choices live, plus the point being added. */
const livePlaces = computed<DraftPlace[]>(() => {
  const current = editor.value;
  const list = places.value.map((place) =>
    current?.kind === 'edit' && current.tempId === place.tempId
      ? {
          ...place,
          name: current.fields.name.trim() || place.name,
          category: current.fields.category,
          radius: current.fields.radius,
          required: current.fields.required,
        }
      : place,
  );
  if (current?.kind === 'new') {
    list.push({
      tempId: PREVIEW_ID,
      name: current.fields.name,
      position: current.position,
      category: current.fields.category,
      radius: current.fields.radius,
      required: current.fields.required,
    });
  }
  return list;
});
const liveOverlaps = computed(
  () =>
    new Set(
      findOverlaps(livePlaces.value, defaultRadius.value).flatMap((pair) => [pair.a, pair.b]),
    ),
);
const editorOverlap = computed(() => {
  const current = editor.value;
  if (!current) return false;
  return liveOverlaps.value.has(current.kind === 'new' ? PREVIEW_ID : (current.tempId ?? ''));
});

const summaryText = computed(() => {
  const summary = creator.summary;
  const n = count.value;
  const parts = [t('create.places.count', { n }, n)];
  if (summary && n >= 2) parts.push(format.distance(summary.distanceMeters));
  if (summary && n >= 1) parts.push(format.approx(summary.estimatedMinutes));
  return parts.join(' · ');
});
/** Places whose zone overlaps another one's. */
const overlapCount = computed(() => creator.overlapIds.size);

// ---------------------------------------------------------------- the map

const isEdited = (tempId: string) =>
  tempId === PREVIEW_ID || (editor.value?.kind === 'edit' && editor.value.tempId === tempId);

const markers = computed<MapMarker[]>(() =>
  livePlaces.value.map((place, index): MapMarker => {
    const category = place.category ?? 'other';
    return {
      id: place.tempId,
      position: place.position,
      category,
      // The place in the editor stands out (Terracota, bigger).
      state: isEdited(place.tempId) ? 'next' : 'active',
      order: index + 1,
      optional: place.required === false,
      warning: liveOverlaps.value.has(place.tempId),
      popup: {
        kicker: t('popup.orderOf', { n: index + 1 }),
        title: place.name,
        chips: [{ label: t(`category.${category}`) }],
        actions:
          place.tempId === PREVIEW_ID
            ? []
            : [{ id: 'edit', label: t('create.places.edit'), primary: true }],
      },
    };
  }),
);
const zones = computed<MapZoneItem[]>(() =>
  livePlaces.value.map((place) => ({
    id: place.tempId,
    center: place.position,
    radius: place.radius ?? defaultRadius.value,
    tone: liveOverlaps.value.has(place.tempId) ? 'warning' : 'default',
  })),
);
const path = computed(() =>
  livePlaces.value.length >= 2 ? livePlaces.value.map((place) => place.position) : null,
);
/** Always something to open on: the places, else the area of step 1. */
const fit = computed<LatLng[] | null>(() => {
  if (places.value.length > 0) return places.value.map((place) => place.position);
  const area = creator.draft?.area;
  return area ? [area.position] : null;
});
/** Map hidden at the bottom: the list's sheet overlaps it by 20 px on phones, the editor by more. */
const mapHidden = computed(() => Math.max(wide.value ? 0 : 20, editorCover.value));
/** The places are framed inside this padding, so no marker sits on an edge. */
const mapPadding = computed<MapPadding>(() => ({
  top: MAP_MARGIN,
  right: MAP_MARGIN,
  bottom: mapHidden.value + MAP_MARGIN,
  left: MAP_MARGIN,
}));

function waitForMap(): void {
  if (mapTimer) clearTimeout(mapTimer);
  mapTimer = setTimeout(() => {
    mapTimer = null;
    if (mapState.value === 'loading') mapState.value = 'failed';
  }, MAP_PATIENCE_MS);
}

function onMapReady(): void {
  if (mapTimer) clearTimeout(mapTimer);
  mapTimer = null;
  mapState.value = 'ready';
  const area = creator.draft?.area;
  if (places.value.length === 0 && area) void mapRef.value?.goTo(area.position, 13);
}

function onMapFailed(): void {
  if (mapTimer) clearTimeout(mapTimer);
  mapTimer = null;
  mapMissing.value = true;
  mapState.value = 'failed';
}

function retryMap(): void {
  mapMissing.value = false;
  mapState.value = 'loading';
  RouteMap.value = loadRouteMap();
  mapKey.value += 1;
  waitForMap();
}

function onMarkerAction({ markerId, action }: { markerId: string; action: string }): void {
  if (action === 'edit') editPlace(markerId);
}

/** Results near what the user is looking at: the map, else the area, else the places. */
function near(): LatLng | null {
  const centre = mapRef.value?.center();
  if (centre) return centre;
  const area = creator.draft?.area;
  if (area) return area.position;
  const list = places.value;
  if (list.length === 0) return null;
  return {
    lat: list.reduce((sum, place) => sum + place.position.lat, 0) / list.length,
    lng: list.reduce((sum, place) => sum + place.position.lng, 0) / list.length,
  };
}

// ---------------------------------------------------------------- announcing and focus

/** Polite news for screen readers (adding and moving places): never a toast. */
function say(text: string): void {
  liveText.value = '';
  void nextTick(() => {
    liveText.value = text;
  });
}

function setRow(tempId: string, row: unknown): void {
  if (row) rows.set(tempId, row as InstanceType<typeof PlaceListItem>);
  else rows.delete(tempId);
}

function focusMenu(tempId: string): void {
  rows.get(tempId)?.focusMenu();
}

// ---------------------------------------------------------------- adding from the search

async function onSuggestion(suggestion: GeoSuggestion): Promise<void> {
  if (resolvingKey.value || atMax.value) return;
  // Not storable: it may only move the map.
  if (!suggestion.storable) {
    void mapRef.value?.goTo(suggestion.position);
    return;
  }
  const { externalId } = suggestion;
  if (externalId && places.value.some((place) => place.externalId === externalId)) {
    ui.toast(
      { key: 'create.places.duplicate', params: { name: suggestion.name } },
      { tone: 'warning' },
    );
    return;
  }
  const controller = new AbortController();
  resolving = controller;
  resolvingKey.value = suggestion.key;
  resolvingName.value = suggestion.name;
  let resolved: ResolvedPlace | null = null;
  try {
    resolved = await resolvePlace(suggestion.key, controller.signal);
  } catch {
    // No address then: the place still goes in with what the search said.
  }
  // The screen closed meanwhile.
  if (controller.signal.aborted) return;
  resolving = null;
  resolvingKey.value = null;
  const added = await creator.addPlace({
    name: suggestion.name,
    position: resolved?.position ?? suggestion.position,
    category: resolved?.category ?? suggestion.category ?? 'other',
    ...(resolved?.address ? { address: resolved.address } : {}),
    ...(externalId ? { externalId } : {}),
  });
  if (!added) return;
  say(
    t('create.places.added', {
      name: suggestion.name,
      n: count.value,
      max: DRAFT_LIMITS.maxPlaces,
    }),
  );
  // Ready for the next one: empty field, focus kept.
  search.value?.clear();
  await nextTick();
  void mapRef.value?.fitTo(places.value.map((place) => place.position));
}

// ---------------------------------------------------------------- the editor

function editPlace(tempId: string): void {
  const place = places.value.find((item) => item.tempId === tempId);
  if (!place) return;
  mapRef.value?.closePopup();
  editorFramed = false;
  editor.value = {
    kind: 'edit',
    tempId,
    position: { ...place.position },
    fromSearch: place.externalId !== undefined,
    fields: {
      name: place.name,
      category: place.category ?? 'other',
      radius: place.radius ?? defaultRadius.value,
      required: place.required !== false,
    },
    before: {
      ...(place.radius !== undefined ? { radius: place.radius } : {}),
      ...(place.required !== undefined ? { required: place.required } : {}),
    },
  };
}

/** "Punto personalizado n", a number no other place uses. */
function ownPointName(): string {
  const taken = new Set(places.value.map((place) => place.name));
  let n = places.value.filter((place) => !place.externalId).length + 1;
  while (taken.has(t('create.places.custom', { n }))) n += 1;
  return t('create.places.custom', { n });
}

/** A point of one's own (holding the map, or its centre). */
function addPoint(position: LatLng): void {
  if (atMax.value) {
    say(t('create.places.max', { max: DRAFT_LIMITS.maxPlaces }));
    return;
  }
  const current = editor.value;
  // Holding again while adding moves the new point; an existing place stays where it is.
  if (current?.kind === 'new') {
    current.position = position;
    return;
  }
  if (current) return;
  editorFramed = false;
  editor.value = {
    kind: 'new',
    tempId: null,
    position,
    fromSearch: false,
    fields: {
      name: ownPointName(),
      category: 'other',
      radius: defaultRadius.value,
      required: true,
    },
    before: {},
  };
}

function addCentre(): void {
  const centre = mapRef.value?.center();
  if (centre) addPoint(centre);
}

function closeEditor(): void {
  editor.value = null;
  editorCover.value = 0;
  editorFramed = false;
}

/** The sheet's place on screen: the map keeps the place in sight above it. */
async function onEditorCover(cover: SheetCover): Promise<void> {
  const box = mapBox.value?.getBoundingClientRect();
  const current = editor.value;
  if (!box || !current) return;
  const across = cover.left < box.right && cover.right > box.left;
  const hidden = across ? Math.max(0, box.bottom - cover.top) : 0;
  // Never most of the map: the place must still fit above the sheet.
  editorCover.value = Math.round(Math.min(hidden, box.height * 0.6));
  if (editorFramed) return;
  editorFramed = true;
  await nextTick();
  void mapRef.value?.goTo(current.position, EDITOR_ZOOM);
}

async function saveEditor(): Promise<void> {
  const current = editor.value;
  if (!current) return;
  const { fields } = current;
  const name = fields.name.trim();
  if (current.kind === 'new') {
    const added = await creator.addPlace({
      name,
      position: current.position,
      category: fields.category,
      ...(fields.radius !== defaultRadius.value ? { radius: fields.radius } : {}),
      ...(fields.required ? {} : { required: false }),
    });
    closeEditor();
    say(
      added
        ? t('create.places.added', { name, n: count.value, max: DRAFT_LIMITS.maxPlaces })
        : t('create.places.max', { max: DRAFT_LIMITS.maxPlaces }),
    );
    return;
  }
  if (current.tempId === null) return;
  const patch: PlacePatch = { name };
  if (!current.fromSearch) patch.category = fields.category;
  if (current.before.radius !== undefined || fields.radius !== defaultRadius.value) {
    patch.radius = fields.radius;
  }
  if (current.before.required !== undefined || !fields.required) {
    patch.required = fields.required;
  }
  await creator.updatePlace(current.tempId, patch);
  closeEditor();
}

function removeEdited(): void {
  const tempId = editor.value?.tempId;
  if (tempId) void removePlace(tempId);
}

// ---------------------------------------------------------------- the list

async function removePlace(tempId: string): Promise<void> {
  const removed = await creator.removePlace(tempId);
  if (!removed) return;
  if (editor.value?.tempId === tempId) closeEditor();
  mapRef.value?.closePopup();
  const { place, index } = removed;
  ui.toast(
    { key: 'create.places.removed', params: { name: place.name } },
    {
      action: {
        label: { key: 'create.places.undo' },
        run: () => void restorePlace(place, index),
      },
    },
  );
  // Focus goes on to the next place (or the one before), never to the page.
  await nextTick();
  const next = places.value[Math.min(index, places.value.length - 1)];
  if (next) focusMenu(next.tempId);
  else heading.value?.focus();
}

async function restorePlace(place: DraftPlace, index: number): Promise<void> {
  if (!(await creator.restorePlace(place, index))) return;
  say(t('create.places.added', { name: place.name, n: count.value, max: DRAFT_LIMITS.maxPlaces }));
  await nextTick();
  focusMenu(place.tempId);
}

async function movePlace(tempId: string, step: -1 | 1): Promise<void> {
  const from = places.value.findIndex((place) => place.tempId === tempId);
  const to = from + step;
  if (from < 0 || !(await creator.movePlace(from, to))) return;
  // Moving the row's node took focus away from its menu button.
  await nextTick();
  focusMenu(tempId);
  const place = places.value[to];
  if (place) {
    say(t('create.places.moved', { name: place.name, n: to + 1, total: count.value }));
  }
}

function onRowAction(tempId: string, action: PlaceAction): void {
  if (action === 'edit') editPlace(tempId);
  else if (action === 'up') void movePlace(tempId, -1);
  else if (action === 'down') void movePlace(tempId, 1);
  else void removePlace(tempId);
}

/** A row dropped somewhere else (the drag handle). */
async function onDragUpdate(event: {
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
}): Promise<void> {
  const from = event.oldDraggableIndex;
  const to = event.newDraggableIndex;
  if (from === undefined || to === undefined) return;
  const place = places.value[from];
  if (!place || !(await creator.movePlace(from, to))) return;
  say(t('create.places.moved', { name: place.name, n: to + 1, total: count.value }));
}

/** Overlap chip: straight to the first place involved, where its radius can shrink. */
function fixOverlap(): void {
  const first = places.value.find((place) => creator.overlapIds.has(place.tempId));
  if (first) editPlace(first.tempId);
}

async function next(): Promise<void> {
  track('creator_step_completed', { step: 'places' });
  await router.push({ name: 'create-review' });
}

// Back (the arrow, the stepper, the browser) closes the editor first (DESIGN §8.2).
onBeforeRouteLeave(() => {
  if (!editor.value) return true;
  closeEditor();
  return false;
});

onMounted(() => {
  waitForMap();
  wideQuery?.addEventListener('change', onWide);
});

onBeforeUnmount(() => {
  if (mapTimer) clearTimeout(mapTimer);
  resolving?.abort();
  wideQuery?.removeEventListener('change', onWide);
});
</script>

<template>
  <div v-if="creator.draft" class="places" :class="{ 'places--searching': searchFocused }">
    <div ref="mapBox" class="places__map" :style="{ '--attribution-offset': `${mapHidden}px` }">
      <component
        :is="RouteMap"
        v-if="!mapMissing"
        :key="mapKey"
        ref="mapRef"
        :markers="markers"
        :path="path"
        :zones="zones"
        :fit="fit"
        :padding="mapPadding"
        :theme="theme"
        :large="settings.sol"
        :basemap="creator.draft.activity === 'walk' ? 'streets' : 'topo'"
        :label="t('create.places.map')"
        @ready="onMapReady"
        @failed="onMapFailed"
        @map-hold="addPoint"
        @action="onMarkerAction"
      >
        <!-- Not while searching: the map is shrunk for the keyboard then. -->
        <template v-if="mapState === 'ready' && !editor && !searchFocused">
          <span class="places__crosshair" aria-hidden="true" />
          <button type="button" class="places__centre" :disabled="atMax" @click="addCentre">
            <Crosshair :size="18" aria-hidden="true" />
            <span>{{ t('create.places.addCenter') }}</span>
          </button>
        </template>
      </component>
      <div v-if="mapState === 'loading'" class="places__maploading" aria-hidden="true">
        <LoaderCircle :size="28" class="places__spin" />
      </div>
      <div v-else-if="mapState === 'failed'" class="places__nomap" role="status">
        <MapPinOff :size="24" aria-hidden="true" />
        <p>{{ t('create.places.mapUnavailable') }}</p>
        <AppButton variant="secondary" size="s" @click="retryMap">
          <template #icon><RotateCcw :size="18" aria-hidden="true" /></template>
          {{ t('common.retry') }}
        </AppButton>
      </div>
    </div>

    <section class="places__panel">
      <h1 ref="heading" class="visually-hidden" tabindex="-1">{{ t('create.steps.places') }}</h1>
      <div class="places__search">
        <PlaceSearch
          ref="search"
          :label="t('create.places.search')"
          hide-label
          :placeholder="t('create.places.searchPlaceholder')"
          :near="near"
          :placement="wide ? 'down' : 'up'"
          :disabled="atMax"
          :hint="atMax ? t('create.places.max', { max: DRAFT_LIMITS.maxPlaces }) : undefined"
          :busy-key="resolvingKey"
          :busy-text="t('create.places.resolving', { name: resolvingName })"
          :offline-text="mapState === 'ready' ? t('create.search.offlineMap') : undefined"
          @select="onSuggestion"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        />
      </div>

      <template v-if="count > 0">
        <div class="places__summary">
          <p class="places__totals tabular">{{ summaryText }}</p>
          <button v-if="overlapCount > 0" type="button" class="places__overlap" @click="fixOverlap">
            <TriangleAlert :size="16" aria-hidden="true" />
            {{ t('create.places.overlap', { n: overlapCount }) }}
          </button>
        </div>
        <VueDraggable
          tag="ol"
          class="places__list"
          :aria-label="t('create.places.list')"
          :model-value="places"
          handle=".place__handle"
          :animation="motion ? 150 : 0"
          :scroll="true"
          :scroll-sensitivity="96"
          :scroll-speed="16"
          ghost-class="is-ghost"
          chosen-class="is-chosen"
          @update="onDragUpdate"
        >
          <li v-for="(place, index) in places" :key="place.tempId" class="places__item">
            <PlaceListItem
              :ref="(row) => setRow(place.tempId, row)"
              :place="place"
              :order="index + 1"
              :total="count"
              :radius="place.radius ?? defaultRadius"
              :overlap="creator.overlapIds.has(place.tempId)"
              @action="(action) => onRowAction(place.tempId, action)"
            />
          </li>
        </VueDraggable>
      </template>
      <div v-else class="places__empty">
        <span class="places__emptyart azulejo" aria-hidden="true" />
        <p class="t-body-strong">
          {{ mapState === 'failed' ? t('create.places.emptyNoMap') : t('create.places.empty') }}
        </p>
      </div>

      <footer class="places__footer">
        <p v-if="count < DRAFT_LIMITS.minPlaces" :id="hintId" class="places__hint">
          {{ t('create.places.min', { n: DRAFT_LIMITS.minPlaces }) }}
        </p>
        <AppButton
          block
          :disabled="count < DRAFT_LIMITS.minPlaces"
          :aria-describedby="count < DRAFT_LIMITS.minPlaces ? hintId : undefined"
          @click="next"
        >
          {{ t('create.next') }}
        </AppButton>
      </footer>
    </section>

    <PlaceEditorSheet
      v-if="editor"
      :key="editor.tempId ?? PREVIEW_ID"
      v-model="editor.fields"
      class="places__editor"
      :mode="editor.kind"
      :category-editable="!editor.fromSearch"
      :categories="categories"
      :overlap="editorOverlap"
      @save="saveEditor"
      @cancel="closeEditor"
      @remove="removeEdited"
      @cover="onEditorCover"
    />

    <p class="visually-hidden" aria-live="polite">{{ liveText }}</p>
  </div>
</template>

<style scoped>
.places {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.places__map {
  position: relative;
  flex: none;
  height: max(220px, 38dvh);
  background: var(--color-surface-2);
  transition: height var(--motion-base) var(--ease-sheet);
}
/* Typing: the map steps back so the field, the suggestions and the list fit over the keyboard. */
.places--searching .places__map {
  height: 140px;
}
.places__crosshair {
  position: absolute;
  left: 50%;
  top: calc((100% - var(--attribution-offset, 0px)) / 2);
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  background:
    linear-gradient(var(--color-text), var(--color-text)) center / 2px 100% no-repeat,
    linear-gradient(var(--color-text), var(--color-text)) center / 100% 2px no-repeat;
  filter: drop-shadow(0 0 1px var(--color-surface)) drop-shadow(0 0 1px var(--color-surface));
  pointer-events: none;
}
.places__centre {
  position: absolute;
  right: 12px;
  bottom: calc(var(--attribution-offset, 0px) + 24px);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  min-height: 44px;
  padding: 0 16px 0 12px;
  border: var(--control-border) solid transparent;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e2);
  font: 600 14px/18px var(--font-ui);
  text-align: left;
}
.places__centre svg {
  flex: none;
  color: var(--color-primary);
}
.places__centre:disabled {
  opacity: 0.55;
}
:root[data-contrast='sol'] .places__centre {
  border-color: var(--color-text);
}
.places__maploading,
.places__nomap {
  position: absolute;
  inset: 0 0 var(--attribution-offset, 0px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
}
.places__maploading {
  color: var(--color-text-muted);
  pointer-events: none;
}
.places__nomap {
  z-index: 3;
  background: var(--color-surface-2);
  color: var(--color-text-muted);
  font: 500 15px/20px var(--font-ui);
}
.places__spin {
  animation: spin 0.8s linear infinite;
}
.places__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  margin-top: -20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface);
  box-shadow: 0 -4px 16px rgba(22, 25, 29, 0.08);
}
.places__search {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 16px var(--gutter) 10px;
  background: var(--color-surface);
}
.places__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 4px var(--gutter) 8px;
}
.places__totals {
  font: 600 15px/20px var(--font-ui);
}
.places__overlap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border: var(--control-border) solid transparent;
  border-radius: var(--radius-pill);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font: 600 14px/18px var(--font-ui);
}
:root[data-contrast='sol'] .places__overlap {
  border-color: currentColor;
}
.places__list {
  margin: 0;
  padding: 0 var(--gutter);
  list-style: none;
}
.places__item {
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.places__item:last-child {
  border-bottom: 0;
}
.places__item.is-chosen {
  box-shadow: var(--shadow-e2);
}
.places__item.is-ghost {
  opacity: 0.4;
}
.places__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 24px 24px;
  color: var(--color-text-muted);
  text-align: center;
}
.places__empty p {
  max-width: 30ch;
}
.places__emptyart {
  width: 64px;
  height: 64px;
  border-radius: 18px;
}
.places__footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.places__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
  text-align: center;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1024px) {
  .places {
    display: grid;
    grid-template-columns: 420px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .places__map,
  .places--searching .places__map {
    grid-area: 1 / 2;
    height: 100%;
    transition: none;
  }
  .places__panel {
    grid-area: 1 / 1;
    margin-top: 0;
    border-right: 1px solid var(--color-border);
    border-radius: 0;
    box-shadow: none;
  }
  /* The editor sits over the list, so the whole map stays in sight. */
  .places__editor {
    justify-content: flex-start;
  }
  .places__editor :deep(.frame__panel) {
    max-width: 420px;
    border-radius: 0 var(--radius-lg) 0 0;
  }
}
</style>
