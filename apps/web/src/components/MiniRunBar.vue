<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import { useRunStore } from '../stores/run.ts';

// MiniRunBar (DESIGN §7): the run keeps going while the user browses; this
// bar above the navigation brings them back.
const { t } = useI18n();
const run = useRunStore();
const texts = useTexts();
const format = useFormat();

const label = computed(() => {
  const spec = run.spec;
  if (!spec) return '';
  const name = texts.text(spec.name, spec.locale);
  const target = run.targetPoint;
  const distance = run.state?.target?.distance;
  if (!target) return name;
  const where = texts.text(target.name, spec.locale);
  return distance !== null && distance !== undefined
    ? `${name} · ${where} ${format.distance(distance)}`
    : `${name} · ${where}`;
});
</script>

<template>
  <RouterLink to="/run" class="mini" :aria-label="t('run.openRun')">
    <span
      class="mini__dot"
      :class="{ 'is-paused': run.state?.status === 'paused' }"
      aria-hidden="true"
    />
    <span class="mini__label tabular">{{ label }}</span>
    <ChevronRight :size="20" aria-hidden="true" />
  </RouterLink>
</template>

<style scoped>
.mini {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(var(--nav-height) + var(--safe-bottom) + 8px);
  z-index: 31;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--color-text);
  color: var(--color-bg);
  box-shadow: var(--shadow-e2);
  font: 600 15px/20px var(--font-ui);
  text-decoration: none;
}
.mini__dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: blink 2s ease-in-out infinite;
}
.mini__dot.is-paused {
  background: var(--color-locked);
  animation: none;
}
.mini__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
</style>
