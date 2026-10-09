<script setup lang="ts">
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  Clock,
  EyeOff,
  Flag,
  Globe,
  Languages,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Pencil,
  Route,
  Timer,
  Trash2,
  Users,
} from '@lucide/vue';
import type { ModerationState } from '@rumbo/api-contract';
import { distance } from '@rumbo/geo-utils';
import { type Locale, resolveContent } from '@rumbo/route-spec';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ActivityBadge from '../components/ActivityBadge.vue';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import MapFab from '../components/MapFab.vue';
import ModeBadge from '../components/ModeBadge.vue';
import PointListItem from '../components/PointListItem.vue';
import ReportSheet from '../components/ReportSheet.vue';
import StatChip from '../components/StatChip.vue';
import { useMyRouteActions } from '../composables/useMyRouteActions.ts';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import type { MapMarker } from '../map/types.ts';
import { isCommunityRoute } from '../services/catalog.ts';
import { fetchOwnerStatus, reportedRoutes } from '../services/community.ts';
import { useOnline } from '../services/network.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S03 · Route detail: the map with the numbered points and the path, then
// the route's facts, its rules (challenge) and the ordered list of points.
// The user's own routes also get "Editar ruta" and "Eliminar ruta" here, where
// the route is looked at before starting it (the same actions as My routes),
// plus who can see the route and "Publicar" / "Dejar de publicar" (phase 7.2).
// A route someone else published ("De la comunidad") says so, says it when it
// is in another language, and ends with a discreet "Reportar ruta".
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const props = defineProps<{ routeId: string }>();
const { t, locale } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const settings = useSettingsStore();
const texts = useTexts();
const format = useFormat();

const { busy, edit, remove, setPublished } = useMyRouteActions();
const online = useOnline();

const route = computed(() => catalog.byId(props.routeId));
const spec = computed(() => route.value?.bundle.spec);
const expanded = ref(false);
const fullMap = ref(false);
const mapRef = ref<{ openPopup(id: string): void } | null>(null);

/** Made with the creator on this device: the only routes that can be edited or deleted. */
const isMine = computed(() => route.value?.mine !== undefined);
/** Published by someone else: a user route that isn't in this device's registry. */
const isCommunity = computed(() => route.value !== undefined && isCommunityRoute(route.value));
const published = computed(() => route.value?.mine?.published === true);
const record = computed(() => catalog.myRecords.find((item) => item.id === props.routeId));
/** Looking for a route the catalog doesn't list (a community route opened by its address). */
const resolving = ref(true);
/**
 * The route on screen disappeared: it was deleted from here and My routes is
 * on its way, which is not "not found". Set the moment the catalog drops it
 * (sync), so no render in between says otherwise.
 */
const vanished = ref(false);
watch(
  route,
  (now, before) => {
    if (!now && before?.id === props.routeId) vanished.value = true;
  },
  { flush: 'sync' },
);
const notFound = computed(
  () => catalog.status === 'ready' && !route.value && !vanished.value && !resolving.value,
);

const name = computed(() => (spec.value ? texts.text(spec.value.name, spec.value.locale) : ''));
const description = computed(() =>
  spec.value ? texts.text(spec.value.description ?? spec.value.summary, spec.value.locale) : '',
);
/** A community route's texts stay in the language it was made in (ADR 0001): the user is told. */
const otherLanguage = computed(() =>
  isCommunity.value && spec.value && spec.value.locale !== locale.value
    ? t('route.otherLanguage', {
        language: t(`create.details.languageNames.${spec.value.locale}`),
      })
    : '',
);
const timeLimitMinutes = computed(() =>
  spec.value?.settings.timeLimit ? spec.value.settings.timeLimit / 60 : null,
);
const requiredCount = computed(() => spec.value?.points.filter((p) => p.required).length ?? 0);

function thumbnail(contentRef: string | undefined): string | null {
  if (!contentRef || !route.value || !spec.value) return null;
  const card = resolveContent(
    route.value.bundle.contents[contentRef],
    locale.value as Locale,
    spec.value.locale,
  );
  return card?.content.images[0]?.url ?? null;
}

const points = computed(() => {
  const current = spec.value;
  if (!current) return [];
  return current.points.map((point, index) => {
    const previous = index > 0 ? current.points[index - 1] : undefined;
    const category = t(`category.${point.category ?? 'other'}`);
    const sub = previous
      ? `${category} · ${t('route.fromPrevious', { distance: format.distance(distance(previous.position, point.position)) })}`
      : category;
    return {
      point,
      name: texts.text(point.name, current.locale),
      sub,
      image: thumbnail(point.contentRef),
    };
  });
});

const markers = computed<MapMarker[]>(() =>
  points.value.map(({ point, name: pointName }) => ({
    id: point.id,
    position: point.position,
    category: point.category ?? 'other',
    state: 'active',
    order: point.order,
    optional: !point.required,
    popup: {
      kicker: t('popup.orderOf', { n: point.order }),
      title: pointName,
      chips: [{ label: t(`category.${point.category ?? 'other'}`) }],
      actions: [],
    },
  })),
);
const fit = computed(() => [
  ...(spec.value?.points.map((p) => p.position) ?? []),
  ...(spec.value?.path ?? []),
]);

function showPoint(id: string): void {
  fullMap.value = false;
  mapRef.value?.openPopup(id);
}

async function onDelete(): Promise<void> {
  const current = spec.value;
  if (!current) return;
  const deleted = await remove({
    id: current.id,
    name: current.name,
    sourceLocale: current.locale,
  });
  if (!deleted) return;
  // The route is gone, and so is this screen: go to My routes without leaving it in the history.
  const list = router.resolve({ name: 'my-routes' }).fullPath;
  if (router.options.history.state['back'] === list) router.back();
  else await router.replace(list);
}

// ---- who sees an own route

/** What the API says about a published route of the user's; 'visible' until it says otherwise. */
const moderation = ref<{ id: string; state: ModerationState } | null>(null);
const moderationNow = computed<ModerationState>(() =>
  moderation.value?.id === props.routeId ? moderation.value.state : 'visible',
);
const status = computed(() => {
  if (!published.value) return { key: 'private', icon: Lock };
  if (moderationNow.value === 'blocked') return { key: 'blocked', icon: Ban };
  if (moderationNow.value === 'hidden') return { key: 'hidden', icon: EyeOff };
  // Published on the device, not on the server yet, and nowhere to upload it to.
  if (route.value?.mine?.sync !== 'synced' && !online.value) return { key: 'pending', icon: Globe };
  return { key: 'public', icon: Globe };
});
const needsAttention = computed(() => published.value && moderationNow.value !== 'visible');

// On opening a published route, ask the API whether it is hidden or taken
// down: once per visit, and only if the route is on the server and public
// when the page opens (the call counts against the write budget of the
// device's address, so it is never repeated, nor made for a route the user
// publishes while looking at it). Offline, or when the API can't tell, the
// line keeps what the device knows.
const asked = new Set<string>();
let statusRequest: AbortController | null = null;
watch(
  () => record.value?.id ?? null,
  async (id) => {
    const current = record.value;
    if (id === null || !current || asked.has(id)) return;
    asked.add(id);
    if (!published.value || !online.value || current.remote === 'no') return;
    statusRequest?.abort();
    const request = new AbortController();
    statusRequest = request;
    const answer = await fetchOwnerStatus(id, current.editToken, request.signal);
    if (answer && !request.signal.aborted) moderation.value = { id, state: answer.moderation };
  },
  { immediate: true },
);

// ---- reporting a community route

const reportOpen = ref(false);
/** The community routes this device reported; null until it is read, so the button never flashes. */
const reported = ref<ReadonlySet<string> | null>(null);
const canReport = computed(
  () => isCommunity.value && reported.value !== null && !reported.value.has(props.routeId),
);

function onReported(): void {
  reportOpen.value = false;
  reported.value = new Set([...(reported.value ?? []), props.routeId]);
}

async function ensureRoute(): Promise<void> {
  resolving.value = true;
  await catalog.load();
  // Not in the lists: it may be a community route opened by its address.
  if (!route.value) await catalog.resolve(props.routeId);
  resolving.value = false;
}

onMounted(() => {
  void ensureRoute();
  void reportedRoutes().then((ids) => {
    reported.value = ids;
  });
});
watch(() => props.routeId, ensureRoute);
onBeforeUnmount(() => statusRequest?.abort());
</script>

<template>
  <main class="detail" :class="{ 'detail--full': fullMap }">
    <EmptyState v-if="notFound" :title="t('route.notFound')">
      <AppButton size="m" @click="router.replace('/')">{{ t('notFound.cta') }}</AppButton>
    </EmptyState>

    <template v-else-if="route && spec">
      <section class="detail__map">
        <RouteMap
          ref="mapRef"
          :markers="markers"
          :path="spec.path ?? null"
          :fit="fit"
          :theme="theme"
          :large="settings.sol"
          :basemap="spec.activity === 'walk' ? 'streets' : 'topo'"
          :label="name"
        />
        <MapFab
          :icon="ArrowLeft"
          :label="t('common.back')"
          class="detail__back"
          @click="router.back()"
        />
        <MapFab
          :icon="fullMap ? Minimize2 : Maximize2"
          :label="fullMap ? t('route.exitFullscreen') : t('route.fullscreen')"
          class="detail__expand"
          @click="fullMap = !fullMap"
        />
      </section>

      <section v-show="!fullMap" class="detail__sheet">
        <div class="detail__handle" aria-hidden="true"><span /></div>
        <div class="detail__content">
          <div class="detail__titles">
            <h1 class="t-h1">{{ name }}</h1>
            <div class="detail__badges">
              <ModeBadge :mode="spec.mode" />
              <ActivityBadge :activity="spec.activity" />
              <span v-if="isCommunity" class="detail__shared">
                <Users :size="15" aria-hidden="true" />{{ t('route.community') }}
              </span>
            </div>
            <p v-if="otherLanguage" class="detail__language">
              <Languages :size="16" aria-hidden="true" />{{ otherLanguage }}
            </p>
          </div>

          <div class="detail__stats">
            <StatChip
              bordered
              :icon="Route"
              :value="format.distance(route.summary.distanceMeters)"
              :label="t('summary.distance')"
            />
            <StatChip
              bordered
              :icon="Clock"
              :value="format.approx(route.summary.estimatedMinutes)"
              :label="t('summary.time')"
            />
            <StatChip bordered :icon="MapPin" :value="format.points(route.summary.pointCount)" />
            <StatChip
              v-if="timeLimitMinutes"
              bordered
              :icon="Timer"
              :value="t('stats.timeLimit', { time: format.limit(timeLimitMinutes) })"
            />
          </div>

          <div v-if="isMine" class="detail__actions">
            <p class="detail__status" :class="{ 'is-warning': needsAttention }" role="status">
              <component :is="status.icon" :size="18" aria-hidden="true" />
              <span>{{ t(`route.status.${status.key}`) }}</span>
            </p>
            <AppButton
              variant="secondary"
              size="m"
              :disabled="busy !== null"
              class="detail__publish"
              @click="setPublished(route.id, !published)"
            >
              <template #icon>
                <component :is="published ? EyeOff : Globe" :size="20" aria-hidden="true" />
              </template>
              {{ published ? t('route.unpublish') : t('route.publish') }}
            </AppButton>
            <AppButton
              variant="secondary"
              size="m"
              :disabled="busy !== null"
              class="detail__action"
              @click="edit(route.id)"
            >
              <template #icon><Pencil :size="20" aria-hidden="true" /></template>
              {{ t('route.edit') }}
            </AppButton>
            <AppButton
              variant="danger"
              size="m"
              :disabled="busy !== null"
              class="detail__action"
              @click="onDelete"
            >
              <template #icon><Trash2 :size="20" aria-hidden="true" /></template>
              {{ t('route.delete') }}
            </AppButton>
          </div>

          <div v-if="spec.mode === 'challenge'" class="detail__rules">
            <Flag :size="22" aria-hidden="true" />
            <div>
              <p class="t-caption">{{ t('route.rulesTitle') }}</p>
              <p class="t-body-strong">
                {{
                  timeLimitMinutes
                    ? t('route.rules.challenge', {
                        time: format.limit(timeLimitMinutes),
                        n: requiredCount,
                      })
                    : t('route.rules.challengeNoLimit', { n: requiredCount })
                }}
              </p>
            </div>
          </div>

          <div v-if="description" class="detail__description">
            <p class="t-body" :class="{ clamp: !expanded }">{{ description }}</p>
            <button
              type="button"
              class="detail__more"
              :aria-expanded="expanded"
              @click="expanded = !expanded"
            >
              {{ expanded ? t('common.readLess') : t('common.readMore') }}
            </button>
          </div>

          <div class="detail__listhead">
            <h2 class="t-h2">{{ t('route.pointsTitle') }}</h2>
            <span class="t-small t-muted">
              {{
                spec.mode === 'free'
                  ? t('route.anyOrder', { n: spec.points.length })
                  : t('route.inOrder', { n: spec.points.length })
              }}
            </span>
          </div>
          <ol class="detail__points">
            <li v-for="item in points" :key="item.point.id">
              <PointListItem
                :order="item.point.order"
                :name="item.name"
                :sub="item.sub"
                :image="item.image"
                interactive
                @select="showPoint(item.point.id)"
              />
            </li>
          </ol>

          <div v-if="canReport" class="detail__report">
            <button type="button" class="detail__reportbutton" @click="reportOpen = true">
              <Flag :size="16" aria-hidden="true" />{{ t('route.report.button') }}
            </button>
          </div>
        </div>
      </section>

      <footer class="detail__cta">
        <AppButton block @click="router.push({ name: 'prepare', params: { routeId: route.id } })">
          <template #icon><Navigation :size="20" aria-hidden="true" /></template>
          {{ t('route.start') }}
        </AppButton>
        <p v-if="route.bundled || catalog.downloaded.has(route.id)" class="detail__offline">
          <CircleCheck :size="15" aria-hidden="true" />{{ t('route.offlineReady') }}
        </p>
      </footer>

      <ReportSheet
        v-if="reportOpen"
        :route-id="route.id"
        @close="reportOpen = false"
        @sent="onReported"
      />
    </template>
  </main>
</template>

<style scoped>
.detail {
  position: relative;
  height: 100dvh;
  overflow: hidden;
  background: var(--color-surface);
}
.detail__map {
  position: absolute;
  inset: 0 0 auto;
  height: 47%;
  /* The sheet overlaps the map by 20 px: lift Esri's attribution above it. */
  --attribution-offset: 20px;
}
.detail--full .detail__map {
  height: calc(100% - 104px - var(--safe-bottom));
  --attribution-offset: 0px;
}
.detail__back {
  position: absolute;
  left: 16px;
  top: calc(16px + var(--safe-top));
}
.detail__expand {
  position: absolute;
  right: 16px;
  top: calc(16px + var(--safe-top));
}
.detail__sheet {
  position: absolute;
  inset: calc(47% - 20px) 0 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface);
  box-shadow: 0 -4px 16px rgba(22, 25, 29, 0.08);
}
.detail__handle {
  display: flex;
  flex: none;
  justify-content: center;
  padding: 8px 0 4px;
}
.detail__handle span {
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: var(--color-border);
}
.detail__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 8px var(--gutter) calc(140px + var(--safe-bottom));
  overflow-y: auto;
}
.detail__titles {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.detail__badges,
.detail__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* "De la comunidad": an outlined badge (the mode and the activity are filled) for a route someone else published. */
.detail__shared {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 13px var(--font-ui);
}
.detail__language {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.detail__language svg {
  flex: none;
  margin-top: 2px;
}
/* Who sees the route, then the outlined buttons that share the row and stack when the text needs the room. */
.detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.detail__status {
  display: flex;
  flex: 1 1 100%;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-muted);
  font: 500 14px/20px var(--font-ui);
}
.detail__status svg {
  flex: none;
  margin-top: 1px;
}
.detail__status.is-warning {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font-weight: 600;
}
.detail__action {
  flex: 1 1 160px;
}
/* Wider than the other two: its label ("Dejar de publicar") stays on one line, it takes the row to itself on a phone
   (the other two share the one below) and shares it with them where there is room. */
.detail__publish {
  flex: 1 1 200px;
}
.detail__action.btn--danger {
  border-color: var(--color-border);
}
.detail__rules {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-challenge-soft);
}
.detail__rules svg,
.detail__rules .t-caption {
  color: var(--color-challenge-text);
}
.detail__description .clamp {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}
.detail__more {
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: 600 16px/24px var(--font-ui);
}
.detail__listhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
.detail__points {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Reporting is there when needed, never in the way: plain muted text with a flag. */
.detail__report {
  display: flex;
  margin-top: 4px;
}
.detail__reportbutton {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: 600 14px/20px var(--font-ui);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.detail__cta {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.detail__offline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--color-success);
  font: 600 13px var(--font-ui);
}
@media (min-width: 900px) {
  .detail__map {
    inset: 0 auto 0 0;
    width: 55%;
    height: 100%;
  }
  .detail__sheet {
    inset: 0 0 0 55%;
    border-radius: 0;
  }
  .detail__cta {
    left: 55%;
  }
}
</style>
