<script setup lang="ts">
import { CircleCheck, Clock, MapPin, Route } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import type { CatalogRoute } from '../services/catalog.ts';
import ActivityBadge from './ActivityBadge.vue';
import ModeBadge from './ModeBadge.vue';
import StatChip from './StatChip.vue';

// RouteCard (DESIGN §7): 16:9 cover (or the brand pattern), mode badge,
// Fraunces title, activity, summary and the stats row.
const props = defineProps<{ route: CatalogRoute; downloaded?: boolean }>();
const { t } = useI18n();
const texts = useTexts();
const format = useFormat();

const spec = computed(() => props.route.bundle.spec);
const name = computed(() => texts.text(spec.value.name, spec.value.locale));
const summary = computed(() => texts.text(spec.value.summary, spec.value.locale));
const cover = computed(() => spec.value.coverImage);
</script>

<template>
  <RouterLink :to="{ name: 'route', params: { routeId: route.id } }" class="card">
    <div class="card__cover" :class="{ azulejo: !cover }">
      <img v-if="cover" :src="cover.url" :alt="texts.text(cover.alt, spec.locale)" loading="lazy" />
      <ModeBadge :mode="spec.mode" class="card__mode" />
      <span v-if="downloaded" class="card__offline">
        <CircleCheck :size="15" aria-hidden="true" />{{ t('route.downloaded') }}
      </span>
    </div>
    <div class="card__body">
      <div class="card__titlerow">
        <h2 class="t-card-title card__title">{{ name }}</h2>
        <ActivityBadge :activity="spec.activity" plain />
      </div>
      <p v-if="summary" class="t-small t-muted">{{ summary }}</p>
      <div class="card__stats">
        <StatChip
          :icon="Route"
          :value="format.distance(route.summary.distanceMeters)"
          :label="t('summary.distance')"
        />
        <StatChip
          :icon="Clock"
          :value="format.approx(route.summary.estimatedMinutes)"
          :label="t('summary.time')"
        />
        <StatChip :icon="MapPin" :value="format.points(route.summary.pointCount)" />
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: block;
  overflow: hidden;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e1);
  text-decoration: none;
}
.card__cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-color: var(--color-surface-2);
}
.card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card__mode {
  position: absolute;
  left: 12px;
  top: 12px;
}
.card__offline {
  position: absolute;
  right: 12px;
  top: 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-xs);
  background: #fff;
  color: #1a7f45;
  font: 700 13px var(--font-ui);
}
.card__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
}
.card__titlerow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card__title {
  flex: 1;
  min-width: 0;
}
.card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 4px;
}
</style>
