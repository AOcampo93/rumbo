<script setup lang="ts">
import { ArrowLeft, FlaskConical, LocateFixed, MapPinCheck, Pause, Play } from '@lucide/vue';
import type { PointState } from '@rumbo/geo-engine';
import type { LatLng } from '@rumbo/geo-utils';
import {
  type ComponentPublicInstance,
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import GpsIndicator from '../components/GpsIndicator.vue';
import HudTarget from '../components/HudTarget.vue';
import MapFab from '../components/MapFab.vue';
import PointListItem from '../components/PointListItem.vue';
import ProgressBar from '../components/ProgressBar.vue';
import SimControls from '../components/SimControls.vue';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import type { MapMarker, MarkerState } from '../map/types.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { useRunStore } from '../stores/run.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useUiStore } from '../stores/ui.ts';

// S05 · The run, the central screen (DESIGN §9): the map follows the user, the
// HUD says where to go, the panel shows progress and Pause. Arrival cards and
// interruptions arrive on the overlay stack from the event system. A trial of
// the creator ("Probar ruta") is always simulated: its purple banner carries
// the "Prueba" chip and "Volver al editor", and its simulation panel starts open.
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const { t } = useI18n();
const router = useRouter();
const run = useRunStore();
const ui = useUiStore();
const settings = useSettingsStore();
const texts = useTexts();
const format = useFormat();

const follow = ref(true);
const panelOpen = ref(false);
// A trial is there to be walked in simulation: its controls start open.
const simOpen = ref(run.trial);

const spec = computed(() => run.spec);
const state = computed(() => run.state);
const isFree = computed(() => spec.value?.mode === 'free');
const paused = computed(() => state.value?.status === 'paused');
const name = (text: Parameters<typeof texts.text>[0]) =>
  spec.value ? texts.text(text, spec.value.locale) : '';

// ---------------------------------------------------------------- map

const markers = computed<MapMarker[]>(() => {
  const route = spec.value;
  const current = state.value;
  if (!route || !current) return [];
  const targetId = current.target?.pointId;
  return route.points.map((point) => {
    const runtime = current.points.find((p) => p.id === point.id);
    const pointState: PointState = runtime?.state ?? 'active';
    const isTarget = point.id === targetId;
    const look: MarkerState = isTarget && pointState === 'active' ? 'next' : pointState;
    const pointName = name(point.name);
    const actions =
      isFree.value && pointState === 'active' && !isTarget
        ? [{ id: 'goHere', label: t('popup.goHere'), primary: true }]
        : [];
    return {
      id: point.id,
      position: point.position,
      category: point.category ?? 'other',
      state: look,
      order: point.order,
      optional: !point.required,
      ...(isTarget && current.target?.inZone ? { dwell: current.target.dwellProgress } : {}),
      ...(isTarget ? { label: pointName } : {}),
      popup: {
        kicker: t('popup.orderOf', { n: point.order }),
        title: pointName,
        chips: [
          { label: t(`category.${point.category ?? 'other'}`) },
          { label: t(`pointState.${isTarget && pointState === 'active' ? 'next' : pointState}`) },
        ],
        ...(runtime?.distance !== null && runtime?.distance !== undefined
          ? { distance: t('popup.distance', { distance: format.distance(runtime.distance) }) }
          : {}),
        actions,
      },
    };
  });
});

const user = computed(() => {
  const current = state.value?.user;
  if (!current) return null;
  return {
    position: current.position,
    accuracy: current.accuracy,
    heading: current.heading,
    simulated: run.simulated,
  };
});
const track = computed<LatLng[]>(
  () => state.value?.track.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [],
);
const zone = computed(() => {
  const target = state.value?.target;
  const point = run.targetPoint;
  if (!target || !point || target.distance === null || target.distance > 150) return null;
  return { center: point.position, radius: point.radius };
});
const fit = computed(() => spec.value?.points.map((p) => p.position) ?? null);

function onMarkerAction({ markerId, action }: { markerId: string; action: string }): void {
  if (action === 'goHere') run.setTarget(markerId);
}

function onMapClick(position: LatLng): void {
  // Teleporting is a simulation tool: only while its panel is open.
  if (run.simulated && simOpen.value) run.teleport(position);
}

// ---------------------------------------------------------------- HUD

const hud = computed(() => {
  const route = spec.value;
  const target = state.value?.target;
  const point = run.targetPoint;
  if (!route || !target || !point) return null;
  const label = target.inZone
    ? t('run.hud.inZone')
    : isFree.value
      ? t('run.hud.nearest')
      : t('run.hud.next');
  let sub = t('run.hud.waiting');
  if (target.inZone) sub = target.dwellProgress < 1 ? t('run.confirming') : t('pointState.reached');
  else if (target.etaSeconds !== null)
    sub = t(`run.hud.eta.${route.activity}`, { time: format.eta(target.etaSeconds) });
  return {
    label,
    counter: t('run.hud.counter', { n: point.order, total: route.points.length }),
    name: name(point.name),
    sub,
    distance: target.distance === null ? null : format.distanceParts(target.distance),
    bearing: target.bearing,
    dwell: target.inZone ? target.dwellProgress : 0,
    inZone: target.inZone,
    approaching: target.distance !== null && target.distance <= route.settings.approachDistance,
  };
});

// ---------------------------------------------------------------- panel

const segments = computed(() => {
  const current = state.value;
  if (!current) return [];
  return current.points.map((p) =>
    p.id === current.target?.pointId && p.state === 'active' ? 'next' : p.state,
  );
});
const progressText = computed(() =>
  state.value
    ? t('run.progress', {
        completed: state.value.progress.completed,
        total: state.value.progress.total,
      })
    : '',
);
const progressMeta = computed(() => {
  const current = state.value;
  const route = spec.value;
  if (!current || !route) return '';
  const limit = route.settings.timeLimit;
  const elapsed = format.elapsed(current.elapsedMs);
  const time = limit
    ? t('run.elapsedOf', { elapsed, limit: format.elapsed(limit * 1000) })
    : elapsed;
  const showScore = route.mode === 'challenge' || current.progress.score > 0;
  return showScore ? `${time} · ${t('stats.score', { n: current.progress.score })}` : time;
});

const listItems = computed(() => {
  const route = spec.value;
  const current = state.value;
  if (!route || !current) return [];
  return route.points.map((point) => {
    const runtime = current.points.find((p) => p.id === point.id);
    const isTarget = point.id === current.target?.pointId;
    const pointState = runtime?.state ?? 'active';
    const shown = isTarget && pointState === 'active' ? ('next' as const) : pointState;
    let sub = t(`pointState.${shown}`);
    if (pointState === 'completed' && runtime?.completedAt)
      sub = t('run.visitedAt', { time: format.clock(runtime.completedAt) });
    else if (runtime?.distance !== null && runtime?.distance !== undefined)
      sub = `${sub} · ${format.distance(runtime.distance)}`;
    return { point, state: shown, sub, selectable: isFree.value && pointState === 'active' };
  });
});

function choose(pointId: string): void {
  run.setTarget(pointId);
  panelOpen.value = false;
}

// "I'm here" (free mode, weak GPS, close to the target): DESIGN S05.
const checkInId = computed(() => {
  const target = run.targetPoint;
  const gps = state.value?.gps;
  if (!target || !isFree.value || (gps !== 'weak' && gps !== 'lost')) return null;
  return run.canManualCheckIn(target.id) ? target.id : null;
});

// ---------------------------------------------------------------- accessibility

/** Announces arrivals and the distance every 50 m, never every update (DESIGN §12). */
const announcement = ref('');
let lastBucket = -1;
watch(
  () => [state.value?.target?.pointId, state.value?.target?.distance] as const,
  ([pointId, distance]) => {
    if (!pointId || distance === null || distance === undefined || !run.targetPoint) return;
    const bucket = Math.floor(distance / 50);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    announcement.value = t('run.distanceTo', {
      distance: format.distance(distance),
      name: name(run.targetPoint.name),
    });
  },
);
watch(
  () =>
    state.value?.points
      .filter((p) => p.state === 'reached')
      .map((p) => p.id)
      .join(','),
  (reached, before) => {
    const added = (reached ?? '')
      .split(',')
      .filter((id) => id && !(before ?? '').split(',').includes(id));
    const point = spec.value?.points.find((p) => p.id === added[0]);
    if (point) announcement.value = t('run.arrivedAt', { name: name(point.name) });
  },
);

// ---------------------------------------------------------------- layout

// What covers the map, measured: the banner and the HUD on top, the
// simulation panel and the panel's peek below. Their heights change with the
// language, a trial's two-row banner and text enlarged up to 200 %, so the
// map's padding, the toasts and the panels follow them instead of guessing.
const HANDLE_HEIGHT = 22;
const overlay = ref<HTMLElement | null>(null);
const peek = ref<HTMLElement | null>(null);
const simPanel = ref<ComponentPublicInstance | null>(null);
const sizes = reactive({ overlay: 0, peek: 0, sim: 0 });

function measure(): void {
  sizes.overlay = overlay.value?.offsetHeight ?? 0;
  sizes.peek = peek.value?.offsetHeight ?? 0;
  sizes.sim = (simPanel.value?.$el as HTMLElement | undefined)?.offsetHeight ?? 0;
}
const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
watch(
  () => [overlay.value, peek.value, simPanel.value?.$el as Element | undefined],
  (elements, previous) => {
    for (const element of previous ?? []) if (element) resizes?.unobserve(element);
    for (const element of elements) if (element) resizes?.observe(element);
    measure();
  },
);

const layoutStyle = computed(() => ({
  ...(sizes.peek ? { '--panel-peek': `${sizes.peek + HANDLE_HEIGHT}px` } : {}),
  ...(sizes.overlay ? { '--overlay-height': `${sizes.overlay}px` } : {}),
}));
// The map centres the user in what stays visible: under the HUD, above the simulation panel.
const mapPadding = computed(() => ({
  top: sizes.overlay ? sizes.overlay + 8 : 120,
  bottom: simOpen.value && sizes.sim ? sizes.sim + 24 : 0,
}));

/** Toasts go under the banner and the HUD (they add the safe area themselves). */
function placeToasts(): void {
  document.documentElement.style.setProperty(
    '--toast-top',
    sizes.overlay ? `calc(${sizes.overlay + 8}px - var(--safe-top))` : '124px',
  );
}
watch(() => sizes.overlay, placeToasts);

// ---------------------------------------------------------------- leaving

/** "Volver al editor": ends the trial and goes back to the review step (safe to tap twice). */
function backToEditor(): void {
  void run.endTrial();
}

onBeforeRouteLeave(async (to) => {
  // The back gesture closes the top sheet first (DESIGN §8.2).
  if (ui.dismissTop()) return false;
  // Leaving ends a trial, without asking (finishTrial ignores repeated calls).
  if (run.trial) {
    void run.finishTrial('left', { navigate: false });
    return true;
  }
  if (!run.active || to.name === 'summary') return true;
  return ui.confirm({
    title: { key: 'run.exit.title' },
    body: { key: 'run.exit.body' },
    confirmLabel: { key: 'run.exit.yes' },
    cancelLabel: { key: 'run.exit.no' },
  });
});

// Toasts sit under the HUD on this screen.
onMounted(placeToasts);
onBeforeUnmount(() => {
  resizes?.disconnect();
  document.documentElement.style.removeProperty('--toast-top');
  // Backstop: a trial never outlives its screen.
  if (run.trial) void run.finishTrial('left', { navigate: false });
});
</script>

<template>
  <main
    class="run"
    :class="{ 'run--paused': paused, 'run--sim': run.simulated }"
    :style="layoutStyle"
  >
    <template
      v-if="
        spec && state && (run.active || state.status === 'finished' || state.status === 'cancelled')
      "
    >
      <section class="run__map">
        <RouteMap
          :markers="markers"
          :path="spec.path ?? null"
          :track="track"
          :user="user"
          :zone="zone"
          :fit="fit"
          :follow="follow && !paused"
          :theme="theme"
          :large="settings.sol"
          :basemap="spec.activity === 'walk' ? 'streets' : 'topo'"
          :padding="mapPadding"
          :label="name(spec.name)"
          @action="onMarkerAction"
          @map-click="onMapClick"
          @user-pan="follow = false"
        />
        <!-- Outside the map: simulation must work even if the map can't load. -->
        <div class="run__fabs">
          <MapFab
            v-if="run.simulated"
            :icon="FlaskConical"
            :label="t('run.simulation')"
            tone="sim"
            :active="simOpen"
            @click="simOpen = !simOpen"
          />
          <MapFab
            :icon="LocateFixed"
            tone="primary"
            :label="t('run.recenter')"
            :active="follow"
            @click="follow = true"
          />
        </div>
      </section>

      <!-- The banner and the HUD flow in one column, so the HUD is never under the banner. -->
      <div ref="overlay" class="run__overlay">
        <div v-if="run.simulated" class="run__simbanner" :class="{ 'is-trial': run.trial }">
          <p class="run__simtext" role="status">
            <FlaskConical :size="16" aria-hidden="true" />{{ t('sim.banner') }}
          </p>
          <template v-if="run.trial">
            <span class="run__trialchip">{{ t('create.trial.badge') }}</span>
            <button type="button" class="run__trialback" @click="backToEditor">
              <ArrowLeft :size="18" aria-hidden="true" />{{ t('create.trial.back') }}
            </button>
          </template>
        </div>
        <div class="run__top">
          <HudTarget
            v-if="hud"
            v-bind="hud"
            :weak-gps="state.gps === 'weak'"
            :paused="paused"
            :choosable="isFree"
            @choose="panelOpen = true"
          />
          <div v-else class="run__done t-title">{{ t('run.hud.allDone') }}</div>
          <GpsIndicator v-if="state.gps !== 'weak'" :state="state.gps" class="run__gps" />
        </div>
      </div>

      <AppButton
        v-if="checkInId"
        variant="accent"
        class="run__checkin"
        @click="run.manualCheckIn(checkInId)"
      >
        <template #icon><MapPinCheck :size="22" aria-hidden="true" /></template>
        {{ t('run.manualCheckIn') }}
      </AppButton>

      <SimControls
        v-if="run.simulated && simOpen"
        ref="simPanel"
        class="run__sim"
        :speed="run.simSpeed"
        :weak-gps="run.weakGps"
        :can-walk="Boolean(run.targetPoint) && !paused"
        @walk="run.walkToTarget()"
        @speed="run.setSimSpeed($event)"
        @weak-gps="run.setWeakGps($event)"
        @close="simOpen = false"
      />

      <section class="run__panel" :class="{ 'is-open': panelOpen }">
        <button
          type="button"
          class="run__handle"
          :aria-expanded="panelOpen"
          :aria-label="t('run.pointsList')"
          @click="panelOpen = !panelOpen"
        >
          <span />
        </button>
        <div ref="peek" class="run__peek">
          <ProgressBar
            :segments="segments"
            :percent="state.progress.percent"
            :label="progressText"
          />
          <div class="run__progress">
            <div class="run__numbers">
              <p class="run__count tabular">{{ progressText }}</p>
              <p class="run__meta tabular">{{ progressMeta }}</p>
            </div>
            <AppButton v-if="!paused" variant="ghost" class="run__pause" @click="run.pause()">
              <template #icon><Pause :size="20" aria-hidden="true" /></template>
              {{ t('run.pause') }}
            </AppButton>
            <AppButton v-else class="run__pause" @click="run.resume()">
              <template #icon><Play :size="20" aria-hidden="true" /></template>
              {{ t('pause.resume') }}
            </AppButton>
          </div>
        </div>
        <div v-if="panelOpen" class="run__list">
          <h2 class="t-caption t-muted">{{ t('route.pointsTitle') }}</h2>
          <PointListItem
            v-for="item in listItems"
            :key="item.point.id"
            :order="item.point.order"
            :name="name(item.point.name)"
            :sub="item.sub"
            :state="item.state"
            :interactive="item.selectable"
            @select="choose(item.point.id)"
          />
        </div>
      </section>

      <div
        v-if="paused && ui.sheets.length === 0"
        class="run__pausecard"
        role="dialog"
        aria-modal="false"
        :aria-label="t('pause.title')"
      >
        <span class="run__pauseicon" aria-hidden="true"><Pause :size="28" /></span>
        <h2 class="t-display">{{ t('pause.title') }}</h2>
        <p class="t-body-strong tabular t-muted">
          {{ format.elapsed(state.elapsedMs) }} · {{ progressText }}
        </p>
        <p class="t-small t-muted">{{ t('pause.body') }}</p>
        <AppButton block @click="run.resume()">
          <template #icon><Play :size="20" aria-hidden="true" /></template>
          {{ t('pause.resume') }}
        </AppButton>
        <AppButton variant="danger" block @click="run.end()">{{ t('pause.end') }}</AppButton>
      </div>

      <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    </template>

    <EmptyState v-else :title="t('run.noRun')">
      <AppButton size="m" @click="router.replace('/')">{{ t('notFound.cta') }}</AppButton>
    </EmptyState>
  </main>
</template>

<style scoped>
.run {
  --panel-peek: calc(118px + var(--safe-bottom));
  position: relative;
  height: 100dvh;
  overflow: hidden;
  background: var(--color-surface-2);
}
/* Banner and HUD: one column over the map; only their contents take taps. */
.run__overlay {
  position: absolute;
  inset: 0 0 auto;
  z-index: 5;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.run__simbanner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 12px;
  padding: calc(6px + var(--safe-top)) 16px 6px;
  background: var(--color-sim);
  /* White on the light theme's purple, ink on the dark theme's lighter one. */
  color: var(--color-on-primary);
  font: 600 14px/20px var(--font-ui);
  pointer-events: auto;
}
.run__simtext {
  min-width: 0;
  text-align: center;
}
/* Inline, so it stays next to the first word when the notice wraps. */
.run__simtext svg {
  display: inline-block;
  margin-right: 8px;
  vertical-align: -3px;
}
/* A trial: the notice on its own row, then the "Prueba" chip and the way back. */
.run__simbanner.is-trial {
  justify-content: space-between;
  padding-bottom: 8px;
}
.is-trial .run__simtext {
  flex: 1 0 100%;
}
.run__trialchip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1.5px solid currentColor;
  border-radius: var(--radius-xs);
  font: 700 12px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.run__trialback {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  margin-left: auto;
  padding: 0 16px 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-on-primary);
  color: var(--color-sim);
  font: 700 15px/20px var(--font-ui);
  text-align: start;
}
/* 48 px to tap, without making the banner taller. */
.run__trialback::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.run__trialback svg {
  flex: none;
}
@media (min-width: 720px) {
  .run__simbanner.is-trial {
    flex-wrap: nowrap;
  }
  .is-trial .run__simtext {
    flex: 1 1 auto;
    order: 1;
  }
  .run__trialchip {
    order: 0;
  }
  .run__trialback {
    order: 2;
  }
}
.run__map {
  position: absolute;
  inset: 0 0 var(--panel-peek);
  transition: filter var(--motion-slow);
}
.run--paused .run__map {
  filter: grayscale(0.8) opacity(0.45);
}
.run__fabs {
  position: absolute;
  right: 16px;
  bottom: 32px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.run__top {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  width: calc(100% - 32px);
  max-width: 560px;
  margin: calc(12px + var(--safe-top)) auto 0;
}
.run__top > * {
  pointer-events: auto;
}
.run--sim .run__top {
  margin-top: 12px;
}
.run__done {
  width: 100%;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.run__checkin {
  position: absolute;
  left: 16px;
  bottom: calc(var(--panel-peek) + 24px);
  z-index: 4;
}
.run__sim {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(var(--panel-peek) + 16px);
  /* Never over the HUD: with large text it scrolls instead. */
  max-height: calc(100% - var(--panel-peek) - var(--overlay-height, 160px) - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  z-index: 6;
  max-width: 440px;
}
.run__panel {
  position: absolute;
  inset: auto 0 0;
  z-index: 7;
  display: flex;
  flex-direction: column;
  max-height: var(--panel-peek);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface);
  box-shadow: 0 -6px 18px rgba(22, 25, 29, 0.12);
  transition: max-height var(--motion-sheet) var(--ease-sheet);
}
.run__panel.is-open {
  max-height: 75dvh;
}
.run__handle {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 22px;
  border: 0;
  background: transparent;
}
.run__handle span {
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: var(--color-border);
}
.run__peek {
  flex: none;
  padding: 0 var(--gutter) calc(14px + var(--safe-bottom));
}
.run__progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
}
.run__numbers {
  flex: 1;
  min-width: 0;
}
.run__count {
  font: 700 20px/26px var(--font-ui);
}
.run__meta {
  color: var(--color-text-muted);
  font: 500 15px/20px var(--font-ui);
}
.run__pause {
  flex: none;
}
.run__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--gutter) calc(24px + var(--safe-bottom));
}
.run__pausecard {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: min(100% - 32px, 380px);
  padding: 28px 20px 20px;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-e3);
  text-align: center;
  transform: translate(-50%, -60%);
}
.run__pauseicon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--color-surface-2);
}
.run__pausecard .btn {
  margin-top: 8px;
}
</style>
