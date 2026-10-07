<script setup lang="ts">
import {
  ArrowLeft,
  CircleCheck,
  Clock,
  Flag,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Route,
  Timer,
} from '@lucide/vue';
import { distance } from '@rumbo/geo-utils';
import { type Locale, resolveContent } from '@rumbo/route-spec';
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ActivityBadge from '../components/ActivityBadge.vue';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import MapFab from '../components/MapFab.vue';
import ModeBadge from '../components/ModeBadge.vue';
import PointListItem from '../components/PointListItem.vue';
import StatChip from '../components/StatChip.vue';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import type { MapMarker } from '../map/types.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S03 · Route detail: the map with the numbered points and the path, then
// the route's facts, its rules (challenge) and the ordered list of points.
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const props = defineProps<{ routeId: string }>();
const { t, locale } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const settings = useSettingsStore();
const texts = useTexts();
const format = useFormat();

const route = computed(() => catalog.byId(props.routeId));
const spec = computed(() => route.value?.bundle.spec);
const expanded = ref(false);
const fullMap = ref(false);
const mapRef = ref<{ openPopup(id: string): void } | null>(null);

const name = computed(() => (spec.value ? texts.text(spec.value.name, spec.value.locale) : ''));
const description = computed(() =>
  spec.value ? texts.text(spec.value.description ?? spec.value.summary, spec.value.locale) : '',
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

onMounted(() => void catalog.load());
</script>

<template>
  <main class="detail" :class="{ 'detail--full': fullMap }">
    <EmptyState v-if="catalog.status === 'ready' && !route" :title="t('route.notFound')">
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
            </div>
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
