<script setup lang="ts">
import {
  Hourglass,
  ListOrdered,
  MessageCircleQuestion,
  Pause,
  RouteOff,
  TimerOff,
} from '@lucide/vue';
import type { UiText, ViewOutcome } from '@rumbo/event-system';
import type { Locale } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import { useTexts } from '../i18n/text.ts';

// S07 · Interruptions: icon, title, the concrete fact and three stacked
// actions — the primary one (continue), Pause and End (red text).
defineProps<{
  sourceLocale: Locale;
  icon?: string | null;
  title: UiText;
  body?: UiText | null;
  primary: UiText;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t } = useI18n();
const texts = useTexts();
const ICONS = {
  'route-off': RouteOff,
  hourglass: Hourglass,
  'list-ordered': ListOrdered,
  'timer-off': TimerOff,
} as const;
const iconOf = (name: string | null | undefined) =>
  name && name in ICONS ? ICONS[name as keyof typeof ICONS] : MessageCircleQuestion;
</script>

<template>
  <article class="decision">
    <span class="decision__icon" aria-hidden="true"
      ><component :is="iconOf(icon)" :size="30"
    /></span>
    <h1 class="t-h1" data-autofocus>{{ texts.ui(title, sourceLocale) }}</h1>
    <p v-if="body" class="t-body t-muted">{{ texts.ui(body, sourceLocale) }}</p>
    <div class="decision__actions">
      <AppButton block @click="emit('close', { status: 'done', decision: 'continue' })">
        {{ texts.ui(primary, sourceLocale) }}
      </AppButton>
      <AppButton
        variant="secondary"
        block
        @click="emit('close', { status: 'done', decision: 'pause' })"
      >
        <template #icon><Pause :size="18" aria-hidden="true" /></template>
        {{ t('decision.pause') }}
      </AppButton>
      <AppButton
        variant="danger"
        block
        @click="emit('close', { status: 'done', decision: 'cancel' })"
      >
        {{ t('decision.end') }}
      </AppButton>
    </div>
  </article>
</template>

<style scoped>
.decision {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
}
.decision__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: 4px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.decision__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
</style>
