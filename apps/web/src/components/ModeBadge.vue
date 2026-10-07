<script setup lang="ts">
import { Compass, Flag } from '@lucide/vue';
import type { RouteMode } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';

// ModeBadge (DESIGN §7): Free (Atlántico, compass) · Challenge (Terracota, flag).
defineProps<{ mode: RouteMode }>();
const { t } = useI18n();
</script>

<template>
  <span class="mode" :class="`mode--${mode}`">
    <component
      :is="mode === 'free' ? Compass : Flag"
      :size="15"
      :stroke-width="2.25"
      aria-hidden="true"
    />
    {{ t(`mode.${mode}`) }}
  </span>
</template>

<style scoped>
.mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: var(--radius-xs);
  font: 700 13px var(--font-ui);
}
.mode--free {
  background: var(--color-free-soft);
  color: var(--color-free-text);
}
.mode--challenge {
  background: var(--color-challenge-soft);
  color: var(--color-challenge-text);
}
</style>
