<script setup lang="ts">
import { Box } from '@lucide/vue';
import type { ViewOutcome } from '@rumbo/event-system';
import type { Locale, LocalizedText } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import { useTexts } from '../i18n/text.ts';

// S06f · 3D/AR placeholder (three_scene) until the scenes exist.
defineProps<{ sourceLocale: Locale; name?: LocalizedText | null }>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t } = useI18n();
const texts = useTexts();
</script>

<template>
  <article class="soon">
    <div class="soon__art azulejo" aria-hidden="true">
      <span><Box :size="40" /></span>
    </div>
    <div class="soon__body">
      <p class="t-caption t-muted">{{ texts.text(name ?? '', sourceLocale) }}</p>
      <h1 class="t-display" data-autofocus>{{ t('comingSoon.title') }}</h1>
      <p class="t-body t-muted">{{ t('comingSoon.body') }}</p>
    </div>
    <footer class="soon__cta">
      <AppButton block @click="emit('close', { status: 'done' })">{{
        t('comingSoon.back')
      }}</AppButton>
    </footer>
  </article>
</template>

<style scoped>
.soon {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.soon__art {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40%;
}
.soon__art span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 96px;
  border-radius: 28px;
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-e2);
}
.soon__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 32px var(--gutter);
}
.soon__cta {
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
}
</style>
