<script setup lang="ts">
import { Loader, LocateOff, MapPinOff, SignalLow } from '@lucide/vue';
import type { GpsState } from '@rumbo/geo-engine';
import { useI18n } from 'vue-i18n';

// GpsIndicator (DESIGN §7): hidden while the signal is good.
defineProps<{ state: GpsState }>();
const { t } = useI18n();
const ICONS = { waiting: Loader, weak: SignalLow, lost: LocateOff, denied: MapPinOff } as const;
</script>

<template>
  <p v-if="state !== 'good'" class="gps" :class="`gps--${state}`" role="status">
    <component :is="ICONS[state]" :size="16" aria-hidden="true" />
    {{ t(`run.gps.${state === 'weak' ? 'weakShort' : state}`) }}
  </p>
</template>

<style scoped>
.gps {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  box-shadow: var(--shadow-e1);
  font: 600 13px var(--font-ui);
}
.gps--weak {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.gps--lost,
.gps--denied {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
</style>
