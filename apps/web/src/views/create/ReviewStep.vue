<script setup lang="ts">
import {
  CircleCheck,
  CircleX,
  Clock,
  FlaskConical,
  Info,
  LoaderCircle,
  MapPin,
  MapPinOff,
  RotateCcw,
  Route,
  Timer,
  TriangleAlert,
} from '@lucide/vue';
import { validateActionParams } from '@rumbo/event-system';
import { DRAFT_LIMITS } from '@rumbo/route-builder';
import type { LatLng } from '@rumbo/geo-utils';
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ActivityBadge from '../../components/ActivityBadge.vue';
import AppButton from '../../components/AppButton.vue';
import ModeBadge from '../../components/ModeBadge.vue';
import StatChip from '../../components/StatChip.vue';
import { useFormat } from '../../i18n/useFormat.ts';
import type { MapMarker, MapPadding, MapZoneItem } from '../../map/types.ts';
import { unlockAudio } from '../../services/sound.ts';
import { resolvedTheme as theme } from '../../services/theme.ts';
import { useCreatorStore } from '../../stores/creator.ts';
import { useRunStore } from '../../stores/run.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { useUiStore } from '../../stores/ui.ts';

// C4 · Revisar (DESIGN C4; design ux-8): the route on the map, its facts and
// a checklist (places, overlapping zones, how many places have an AI card,
// addresses of the ones that don't, a challenge's time limit and anything
// that keeps the route from being built). "Probar ruta" walks it
// in simulation without saving anything; "Guardar ruta" stores it on this
// device (the upload follows on its own) and moves on to C5.

type MapState = 'loading' | 'ready' | 'failed';
type CheckTone = 'ok' | 'warning' | 'info' | 'error';
interface Check {
  id: string;
  tone: CheckTone;
  text: string;
  /** The step a button takes the user back to: the places ("Corregir") or the cards ("Ver fichas"). */
  fix?: 'create-places' | 'create-content';
}
const MAP_PATIENCE_MS = 8000;
/** The route is framed inside this padding (markers off the edges, above the credits). */
const MAP_PADDING: MapPadding = { top: 28, right: 28, bottom: 48, left: 28 };
const CHECK_ICONS = {
  ok: CircleCheck,
  warning: TriangleAlert,
  info: Info,
  error: CircleX,
} as const;

const { t } = useI18n();
const router = useRouter();
const creator = useCreatorStore();
const run = useRunStore();
const settings = useSettingsStore();
const ui = useUiStore();
const format = useFormat();
const checksId = useId();

const mapState = ref<MapState>('loading');
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
const mapKey = ref(0);
let mapTimer: ReturnType<typeof setTimeout> | null = null;

const saveError = ref(false);
const draft = computed(() => creator.draft);

/** The route as it would be saved, checked by the event system too (ux-8). */
const built = computed(() => (draft.value ? creator.build() : null));
const actionIssues = computed(() =>
  built.value?.ok ? validateActionParams(built.value.spec) : [],
);
const blocked = computed(() => !built.value?.ok || actionIssues.value.length > 0);

const name = computed(() => draft.value?.name.trim() ?? '');
const estimate = computed(() => creator.summary?.estimatedMinutes ?? 0);
const limit = computed(() =>
  draft.value?.mode === 'challenge' ? (draft.value.timeLimitMinutes ?? null) : null,
);

const checks = computed<Check[]>(() => {
  const current = draft.value;
  if (!current) return [];
  const n = current.places.length;
  const list: Check[] = [
    {
      id: 'places',
      tone: 'ok',
      text: t(
        current.mode === 'challenge' ? 'create.review.placesChallenge' : 'create.review.placesFree',
        { n },
      ),
    },
  ];
  const overlapping = creator.overlapIds.size;
  list.push(
    overlapping > 0
      ? {
          id: 'overlaps',
          tone: 'warning',
          text: t('create.places.overlap', { n: overlapping }),
          fix: 'create-places',
        }
      : { id: 'overlaps', tone: 'ok', text: t('create.review.noOverlaps') },
  );
  // The cards: those that will ship, those that will use the basic sheet (chosen or failed) and
  // those still on their way (which use it too if the route is saved now).
  const stats = creator.cardStats;
  const basicCount = stats.basic + stats.error;
  const preparing = stats.pending + stats.generating;
  if (stats.ready > 0) {
    // "3 fichas con IA · 2 básicas".
    list.push({
      id: 'cards',
      tone: basicCount === 0 && preparing === 0 ? 'ok' : 'info',
      text: [
        t('create.review.cardsAi', { n: stats.ready }, stats.ready),
        ...(basicCount > 0 ? [t('create.review.cardsBasic', { n: basicCount }, basicCount)] : []),
      ].join(' · '),
      ...(basicCount > 0 ? { fix: 'create-content' as const } : {}),
    });
  } else if (preparing === 0) {
    list.push({
      id: 'cards',
      tone: 'info',
      text: t('create.review.cardsNone'),
      fix: 'create-content',
    });
  }
  if (preparing > 0) {
    list.push({
      id: 'preparing',
      tone: 'warning',
      text: t('create.review.cardsPreparing', { n: preparing }, preparing),
      fix: 'create-content',
    });
  }
  // The address is what the basic sheet shows; an AI card doesn't need it.
  const withoutCard = (creator.routeDraft?.places ?? []).filter((place) => !place.contentRef);
  const withoutAddress = withoutCard.filter((place) => !place.address?.trim()).length;
  if (withoutCard.length > 0) {
    list.push(
      withoutAddress > 0
        ? {
            id: 'addresses',
            tone: 'info',
            text: t('create.review.noAddress', { n: withoutAddress }, withoutAddress),
          }
        : { id: 'addresses', tone: 'ok', text: t('create.review.addressesOk') },
    );
  }
  if (limit.value !== null && limit.value < estimate.value) {
    list.push({
      id: 'limit',
      tone: 'warning',
      text: t('create.review.timeLimitShort', {
        limit: format.limit(limit.value),
        estimate: format.approx(estimate.value),
      }),
    });
  }
  if (blocked.value) list.push({ id: 'invalid', tone: 'error', text: t('create.review.invalid') });
  return list;
});

// ---------------------------------------------------------------- the map

const defaultRadius = computed(
  () => draft.value?.settingsOverrides?.defaultRadius ?? DRAFT_LIMITS.radius.default,
);
const markers = computed<MapMarker[]>(() =>
  (draft.value?.places ?? []).map((place, index): MapMarker => {
    const category = place.category ?? 'other';
    return {
      id: place.tempId,
      position: place.position,
      category,
      state: 'active',
      order: index + 1,
      optional: place.required === false,
      warning: creator.overlapIds.has(place.tempId),
      popup: {
        kicker: t('popup.orderOf', { n: index + 1 }),
        title: place.name,
        chips: [{ label: t(`category.${category}`) }],
        actions: [],
      },
    };
  }),
);
const zones = computed<MapZoneItem[]>(() =>
  (draft.value?.places ?? []).map((place) => ({
    id: place.tempId,
    center: place.position,
    radius: place.radius ?? defaultRadius.value,
    tone: creator.overlapIds.has(place.tempId) ? 'warning' : 'default',
  })),
);
const positions = computed<LatLng[]>(() => (draft.value?.places ?? []).map((p) => p.position));

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

// ---------------------------------------------------------------- actions

/** "Probar ruta": a trial in simulation; a real run in progress is paused first (if the user agrees). */
async function test(): Promise<void> {
  // Audio unlocks only inside the tap.
  void unlockAudio();
  const result = creator.build();
  if (!result.ok || validateActionParams(result.spec).length > 0) return;
  if (run.active && !run.trial) {
    const confirmed = await ui.confirm({
      title: { key: 'create.trial.activeTitle' },
      body: { key: 'create.trial.activeBody' },
      confirmLabel: { key: 'create.trial.activeConfirm' },
      cancelLabel: { key: 'common.cancel' },
    });
    if (!confirmed) return;
  }
  if (await run.startTrial({ spec: result.normalized, contents: result.contents })) {
    await router.push({ name: 'run' });
  }
}

async function save(): Promise<void> {
  saveError.value = false;
  try {
    await creator.save();
  } catch (error) {
    console.warn('create: the route could not be saved', error);
    saveError.value = true;
    return;
  }
  // Replace: Back from C5 never lands on a review of a route already saved.
  await router.replace({ name: 'create-done' });
}

onMounted(waitForMap);
onBeforeUnmount(() => {
  if (mapTimer) clearTimeout(mapTimer);
});
</script>

<template>
  <div v-if="draft" class="review">
    <div class="review__map">
      <component
        :is="RouteMap"
        v-if="!mapMissing"
        :key="mapKey"
        :markers="markers"
        :path="positions.length >= 2 ? positions : null"
        :zones="zones"
        :fit="positions"
        :padding="MAP_PADDING"
        :theme="theme"
        :large="settings.sol"
        :basemap="draft.activity === 'walk' ? 'streets' : 'topo'"
        :label="t('create.places.map')"
        @ready="onMapReady"
        @failed="onMapFailed"
      />
      <div v-if="mapState === 'loading'" class="review__mapstate" aria-hidden="true">
        <LoaderCircle :size="28" class="review__spin" />
      </div>
      <div v-else-if="mapState === 'failed'" class="review__mapstate review__nomap" role="status">
        <MapPinOff :size="24" aria-hidden="true" />
        <p>{{ t('create.places.mapUnavailable') }}</p>
        <AppButton variant="secondary" size="s" @click="retryMap">
          <template #icon><RotateCcw :size="18" aria-hidden="true" /></template>
          {{ t('common.retry') }}
        </AppButton>
      </div>
    </div>

    <div class="review__main">
      <div class="review__content">
        <div class="review__titles">
          <h1 class="t-h1">{{ name }}</h1>
          <div class="review__badges">
            <ModeBadge :mode="draft.mode" />
            <ActivityBadge :activity="draft.activity" />
          </div>
        </div>

        <div v-if="creator.summary" class="review__stats">
          <StatChip
            bordered
            :icon="Route"
            :value="format.distance(creator.summary.distanceMeters)"
            :label="t('summary.distance')"
          />
          <StatChip
            bordered
            :icon="Clock"
            :value="format.approx(estimate)"
            :label="t('summary.time')"
          />
          <StatChip bordered :icon="MapPin" :value="format.points(draft.places.length)" />
          <StatChip
            v-if="limit !== null"
            bordered
            :icon="Timer"
            :value="t('stats.timeLimit', { time: format.limit(limit) })"
          />
        </div>

        <section class="review__checks" :aria-labelledby="checksId">
          <h2 :id="checksId" class="t-h2">{{ t('create.review.checklist') }}</h2>
          <ul class="checks">
            <li
              v-for="check in checks"
              :key="check.id"
              class="check"
              :class="`check--${check.tone}`"
            >
              <component
                :is="CHECK_ICONS[check.tone]"
                :size="22"
                class="check__icon"
                aria-hidden="true"
              />
              <p class="check__text">{{ check.text }}</p>
              <AppButton
                v-if="check.fix"
                variant="secondary"
                size="m"
                class="check__fix"
                @click="router.push({ name: check.fix })"
              >
                {{
                  check.fix === 'create-content'
                    ? t('create.review.fixCards')
                    : t('create.review.fix')
                }}
              </AppButton>
            </li>
          </ul>
        </section>
      </div>

      <footer class="review__footer">
        <p v-if="saveError" class="review__error" role="alert">
          <CircleX :size="18" aria-hidden="true" />{{ t('create.review.saveError') }}
        </p>
        <div class="review__actions">
          <AppButton
            variant="secondary"
            class="review__test"
            :disabled="blocked || creator.saving"
            @click="test"
          >
            <template #icon><FlaskConical :size="20" aria-hidden="true" /></template>
            {{ t('create.review.test') }}
          </AppButton>
          <AppButton :disabled="blocked" :loading="creator.saving" @click="save">
            {{ creator.saving ? t('create.review.saving') : t('create.review.save') }}
          </AppButton>
        </div>
        <p class="review__hint">{{ t('create.review.testHint') }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.review {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 1fr;
}
.review__map {
  position: relative;
  width: calc(100% - 2 * var(--gutter));
  max-width: 608px;
  height: clamp(180px, 30dvh, 280px);
  margin: 16px auto 0;
  overflow: hidden;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.review__mapstate {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  color: var(--color-text-muted);
  text-align: center;
  pointer-events: none;
}
.review__nomap {
  z-index: 3;
  background: var(--color-surface-2);
  font: 500 15px/20px var(--font-ui);
  pointer-events: auto;
}
.review__spin {
  animation: spin 0.8s linear infinite;
}
.review__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.review__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 20px var(--gutter) 28px;
}
.review__titles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.review__titles h1 {
  overflow-wrap: anywhere;
}
.review__badges,
.review__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.review__checks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.checks {
  margin: 0;
  padding: 0;
  list-style: none;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.check {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px 12px;
  padding: 14px 16px;
}
.check + .check {
  border-top: 1px solid var(--color-border);
}
.check__icon {
  flex: none;
}
.check__text {
  flex: 1 1 12em;
  min-width: 0;
  font: 500 15px/22px var(--font-ui);
}
.check--ok .check__icon {
  color: var(--color-success);
}
.check--warning .check__icon {
  color: var(--color-warning);
}
.check--info .check__icon {
  color: var(--color-primary);
}
.check--error .check__icon,
.check--error .check__text {
  color: var(--color-danger);
}
.check__fix {
  margin-left: 34px;
}
.review__footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.review__footer > * {
  width: 100%;
  max-width: 608px;
  margin: 0 auto;
}
.review__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font: 600 14px/20px var(--font-ui);
}
.review__error svg {
  flex: none;
  margin-top: 1px;
}
.review__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.review__actions > * {
  flex: 1 1 9em;
}
/* Secondary, with the simulation's purple: it never saves anything. */
.review__test {
  border-color: color-mix(in srgb, var(--color-sim) 45%, var(--color-border));
}
.review__test svg {
  color: var(--color-sim);
}
.review__hint {
  color: var(--color-text-muted);
  font: 400 13px/18px var(--font-ui);
  text-align: center;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 1024px) {
  .review {
    grid-template-columns: minmax(0, 640px) minmax(0, 1fr);
    grid-template-rows: auto;
  }
  .review__map {
    position: sticky;
    top: var(--create-top, 0px);
    grid-area: 1 / 2;
    width: auto;
    max-width: none;
    height: calc(100dvh - var(--create-top, 0px));
    margin: 0;
    border-width: 0 0 0 1px;
    border-radius: 0;
  }
  .review__main {
    grid-area: 1 / 1;
  }
}
</style>
