<script setup lang="ts">
import { Check } from '@lucide/vue';
import { LOCALES, type Locale } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';
import { LOCALE_TAGS, NATIVE_NAMES } from '../i18n/index.ts';

// The three language cards of S00, also used in Settings (DESIGN S00, S12).
// Each card: code bubble, native name (in its own language) and the name in
// the language currently shown.
const model = defineModel<Locale>({ required: true });
const { t } = useI18n();
</script>

<template>
  <div role="radiogroup" class="langs" :aria-label="t('lang.title')">
    <button
      v-for="locale in LOCALES"
      :key="locale"
      type="button"
      role="radio"
      class="lang"
      :class="{ 'is-on': model === locale }"
      :aria-checked="model === locale"
      @click="model = locale"
    >
      <span class="lang__code" aria-hidden="true">{{ locale.toUpperCase() }}</span>
      <span class="lang__names">
        <span class="lang__native" :lang="LOCALE_TAGS[locale]">{{ NATIVE_NAMES[locale] }}</span>
        <span class="lang__local">{{ t(`lang.names.${locale}`) }}</span>
      </span>
      <span class="lang__dot" aria-hidden="true">
        <Check v-if="model === locale" :size="14" :stroke-width="3" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.langs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lang {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 12px 16px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: left;
}
.lang.is-on {
  border-color: var(--color-primary);
}
.lang__code {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--color-text);
  font: 700 15px var(--font-ui);
  letter-spacing: 0.04em;
}
.lang.is-on .lang__code {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.lang__names {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.lang__native {
  font: 600 17px/22px var(--font-ui);
}
.lang__local {
  font: 400 14px/20px var(--font-ui);
  color: var(--color-text-muted);
}
.lang__dot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-on-primary);
}
.lang.is-on .lang__dot {
  border-color: var(--color-primary);
  background: var(--color-primary);
}
</style>
