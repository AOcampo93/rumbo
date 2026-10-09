<script setup lang="ts">
import { Check, Clock, Flag, Gauge, MapPin, RotateCcw, Route, Trophy } from '@lucide/vue';
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';
import PointListItem from '../components/PointListItem.vue';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import type { MapMarker } from '../map/types.ts';
import { resolvedTheme as theme } from '../services/theme.ts';
import { useCatalogStore } from '../stores/catalog.ts';
import { type RunSummaryRecord, useRunStore } from '../stores/run.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S10 · Summary of the last run: celebration (or a neutral "Route ended"),
// the trace on the map, four numbers and each point's arrival time.
const RouteMap = defineAsyncComponent(() => import('../map/RouteMap.vue'));

const { t } = useI18n();
const router = useRouter();
const run = useRunStore();
const catalog = useCatalogStore();
const settings = useSettingsStore();
const texts = useTexts();
const format = useFormat();

const summary = ref<RunSummaryRecord | null>(null);
const loaded = ref(false);
const route = computed(() => (summary.value ? catalog.byId(summary.value.routeId) : undefined));
const spec = computed(() => route.value?.bundle.spec);
const finished = computed(() => summary.value?.status === 'finished');

const markers = computed<MapMarker[]>(() => {
  const record = summary.value;
  if (!record || !spec.value) return [];
  return spec.value.points.map((point) => {
    const result = record.points.find((p) => p.id === point.id);
    const done = result?.state === 'completed';
    return {
      id: point.id,
      position: point.position,
      category: point.category ?? 'other',
      state: done ? 'completed' : 'locked',
      order: point.order,
      popup: {
        kicker: t('popup.orderOf', { n: point.order }),
        title: texts.text(point.name, spec.value?.locale ?? 'es'),
        chips: [{ label: t(`pointState.${done ? 'completed' : 'active'}`) }],
        actions: [],
      },
    };
  });
});
const fit = computed(() => [
  ...(summary.value?.track ?? []),
  ...(spec.value?.points.map((p) => p.position) ?? []),
]);

const items = computed(() => {
  const record = summary.value;
  if (!record || !spec.value) return [];
  return spec.value.points.map((point) => {
    const result = record.points.find((p) => p.id === point.id);
    const done = result?.state === 'completed' && result.completedAt;
    return {
      point,
      state: done ? ('completed' as const) : ('locked' as const),
      sub: done
        ? t('summary.visitedAt', { time: format.clock(result.completedAt as number) })
        : t('summary.notVisited'),
    };
  });
});

onMounted(async () => {
  await catalog.load();
  summary.value = await run.loadLastSummary();
  // The route of a community run isn't in the lists after a reload: ask for it by id.
  if (summary.value && !catalog.byId(summary.value.routeId)) {
    await catalog.resolve(summary.value.routeId);
  }
  loaded.value = true;
});

function repeat(): void {
  run.reset();
  if (route.value) void router.push({ name: 'prepare', params: { routeId: route.value.id } });
}
function otherRoutes(): void {
  run.reset();
  void router.push('/');
}
</script>

<template>
  <main class="summary">
    <EmptyState v-if="loaded && (!summary || !spec)" :title="t('summary.none')">
      <AppButton size="m" @click="router.replace('/')">{{ t('summary.otherRoutes') }}</AppButton>
    </EmptyState>
    <template v-else-if="summary && spec">
      <header class="summary__hero azulejo">
        <span class="summary__badge" :class="{ 'is-neutral': !finished }" aria-hidden="true">
          <Check v-if="finished" :size="34" :stroke-width="3" />
          <Flag v-else :size="30" />
        </span>
      </header>
      <div class="summary__body">
        <div class="summary__titles">
          <h1 class="t-display" data-autofocus>
            {{ finished ? t('summary.finished') : t('summary.cancelled') }}
          </h1>
          <p class="t-body t-muted">
            {{
              t('summary.subtitle', {
                route: texts.text(spec.name, spec.locale),
                when: format.when(summary.endedAt),
              })
            }}
          </p>
        </div>

        <div class="summary__map">
          <RouteMap
            :markers="markers"
            :track="summary.track"
            :fit="fit"
            :theme="theme"
            :large="settings.sol"
            :label="texts.text(spec.name, spec.locale)"
          />
        </div>

        <dl class="summary__stats">
          <div class="stat">
            <dt><Clock :size="14" aria-hidden="true" />{{ t('summary.time') }}</dt>
            <dd class="tabular">{{ format.elapsed(summary.elapsedMs) }}</dd>
          </div>
          <div class="stat">
            <dt><Route :size="14" aria-hidden="true" />{{ t('summary.distance') }}</dt>
            <dd class="tabular">{{ format.distance(summary.distanceMeters) }}</dd>
          </div>
          <div class="stat">
            <dt><MapPin :size="14" aria-hidden="true" />{{ t('summary.points') }}</dt>
            <dd class="tabular">{{ summary.completed }}/{{ summary.total }}</dd>
          </div>
          <div v-if="summary.mode === 'challenge' || summary.score > 0" class="stat">
            <dt><Trophy :size="14" aria-hidden="true" />{{ t('summary.score') }}</dt>
            <dd class="tabular">{{ t('stats.score', { n: summary.score }) }}</dd>
          </div>
          <div v-else class="stat">
            <dt><Gauge :size="14" aria-hidden="true" />{{ t('summary.speed') }}</dt>
            <dd class="tabular">{{ summary.avgSpeed ? format.speed(summary.avgSpeed) : '—' }}</dd>
          </div>
        </dl>

        <ol class="summary__points">
          <li v-for="item in items" :key="item.point.id">
            <PointListItem
              :order="item.point.order"
              :name="texts.text(item.point.name, spec.locale)"
              :sub="item.sub"
              :state="item.state"
            />
          </li>
        </ol>
      </div>
      <footer class="summary__cta">
        <AppButton variant="secondary" @click="repeat">
          <template #icon><RotateCcw :size="18" aria-hidden="true" /></template>
          {{ t('summary.repeat') }}
        </AppButton>
        <AppButton class="summary__primary" @click="otherRoutes">{{
          t('summary.otherRoutes')
        }}</AppButton>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 640px;
  margin: 0 auto;
}
.summary__hero {
  position: relative;
  flex: none;
  height: calc(150px + var(--safe-top));
}
.summary__badge {
  position: absolute;
  left: 50%;
  bottom: -36px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border: 4px solid var(--color-bg);
  border-radius: 50%;
  background: var(--color-accent);
  color: #fff;
  box-shadow: var(--shadow-e2);
  transform: translateX(-50%);
  animation: pop 700ms var(--ease-sheet);
}
.summary__badge.is-neutral {
  background: var(--color-text-muted);
}
.summary__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 48px var(--gutter) 24px;
}
.summary__titles {
  text-align: center;
}
.summary__map {
  height: 200px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.summary__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 0;
}
.stat {
  padding: 12px 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.stat dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font: 600 12px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.stat dd {
  margin: 4px 0 0;
  font: 700 26px/32px var(--font-ui);
}
.summary__points {
  margin: 0;
  padding: 0;
  list-style: none;
}
.summary__cta {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.summary__primary {
  flex: 1;
}
@keyframes pop {
  from {
    transform: translateX(-50%) scale(0.4);
  }
}
</style>
