<script setup lang="ts">
import { Activity as RunIcon, Bike, Footprints } from '@lucide/vue';
import type { Activity } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';

// ActivityBadge (DESIGN §7): Walk · Run · Bike.
withDefaults(defineProps<{ activity: Activity; plain?: boolean }>(), { plain: false });
const { t } = useI18n();
const ICONS = { walk: Footprints, run: RunIcon, bike: Bike } as const;
</script>

<template>
  <span class="activity" :class="{ 'activity--plain': plain }">
    <component :is="ICONS[activity]" :size="15" aria-hidden="true" />
    {{ t(`activity.${activity}`) }}
  </span>
</template>

<style scoped>
.activity {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-xs);
  background: var(--color-surface-2);
  color: var(--color-text);
  font: 600 13px var(--font-ui);
}
.activity--plain {
  height: auto;
  padding: 0;
  background: none;
  color: var(--color-text-muted);
}
</style>
