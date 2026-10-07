<script setup lang="ts">
import { MapPinOff, RotateCcw } from '@lucide/vue';
import type { ViewOutcome } from '@rumbo/event-system';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';

// Error sheet with instructions (PROJECT_PLAN §9.3): "Try again" resumes the
// run, which asks the GPS again.
const props = defineProps<{ code: string; message?: string }>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t, te } = useI18n();
const key = computed(() =>
  te(`errorSheet.${props.code}.title`) ? props.code : 'POSITION_UNAVAILABLE',
);
</script>

<template>
  <article class="error">
    <span class="error__icon" aria-hidden="true"><MapPinOff :size="30" /></span>
    <h1 class="t-h1" data-autofocus>{{ t(`errorSheet.${key}.title`) }}</h1>
    <p class="t-body t-muted">{{ t(`errorSheet.${key}.body`) }}</p>
    <AppButton
      block
      class="error__retry"
      @click="emit('close', { status: 'done', decision: 'continue' })"
    >
      <template #icon><RotateCcw :size="20" aria-hidden="true" /></template>
      {{ t('errorSheet.retry') }}
    </AppButton>
  </article>
</template>

<style scoped>
.error {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
}
.error__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-md);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.error__retry {
  margin-top: 12px;
}
</style>
