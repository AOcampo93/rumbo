<script setup lang="ts">
import { Languages, Settings } from '@lucide/vue';
import { LOCALES, type Locale } from '@rumbo/route-spec';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import LanguageOptions from '../components/LanguageOptions.vue';
import { applyLocale, currentLocale } from '../i18n/index.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S00 · Language, shown once on the first launch (ADR 0001). Picking a card
// switches the whole screen at once: the first taste of the live switch.
const { t } = useI18n();
const router = useRouter();
const settings = useSettingsStore();
const selected = ref<Locale>(currentLocale());

watch(selected, (locale) => applyLocale(locale));

/** The same title in the two other languages, so anyone can read it. */
const others = computed(() =>
  LOCALES.filter((locale) => locale !== selected.value)
    .map((locale) => t('lang.title', {}, { locale }))
    .join(' · '),
);

function confirm(): void {
  settings.locale = selected.value;
  void router.replace({ name: 'onboarding' });
}
</script>

<template>
  <main class="welcome">
    <div class="welcome__hero azulejo">
      <div class="welcome__badge"><Languages :size="28" aria-hidden="true" /></div>
    </div>
    <div class="welcome__body">
      <div class="welcome__titles">
        <h1 class="t-display">{{ t('lang.title') }}</h1>
        <p class="t-body t-muted">{{ others }}</p>
      </div>
      <LanguageOptions v-model="selected" />
      <p class="welcome__hint t-small t-muted">
        <Settings :size="16" aria-hidden="true" />{{ t('lang.hint') }}
      </p>
    </div>
    <footer class="welcome__cta">
      <AppButton block @click="confirm">{{ t('lang.continue') }}</AppButton>
    </footer>
  </main>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 560px;
  margin: 0 auto;
}
.welcome__hero {
  position: relative;
  flex: none;
  height: calc(180px + var(--safe-top));
}
.welcome__badge {
  position: absolute;
  left: 16px;
  bottom: -28px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: 0 6px 18px rgba(22, 25, 29, 0.16);
}
.welcome__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  padding: 48px var(--gutter) 24px;
}
.welcome__titles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.welcome__hint {
  display: flex;
  align-items: center;
  gap: 8px;
}
.welcome__cta {
  position: sticky;
  bottom: 0;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}
</style>
