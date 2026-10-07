<script setup lang="ts">
import { MapPin } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

// "📍 YOU'VE ARRIVED · STOP 3 OF 12" (S06).
defineProps<{ order: number | null; total: number }>();
const { t } = useI18n();
</script>

<template>
  <p class="kicker">
    <MapPin :size="16" aria-hidden="true" />
    {{ order ? t('arrival.label', { n: order, total }) : t('run.arrivedAt', { name: '' }).trim() }}
  </p>
</template>

<style scoped>
.kicker {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-accent);
  font: 700 13px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
