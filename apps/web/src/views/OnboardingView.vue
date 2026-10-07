<script setup lang="ts">
import { BellRing, Footprints, MapPinned, Share, Sparkles } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import WordMark from '../components/WordMark.vue';
import { isIos, isStandalone } from '../services/platform.ts';
import { useSettingsStore } from '../stores/settings.ts';

// S00b · Onboarding, first launch only: three slides, then the anonymous
// statistics consent (GDPR). On iOS outside the PWA it also explains how to
// install the app, since that's the only way to get arrival alerts there.
const { t } = useI18n();
const router = useRouter();
const settings = useSettingsStore();

const SLIDES = [
  { key: 'slide1', icon: MapPinned },
  { key: 'slide2', icon: Footprints },
  { key: 'slide3', icon: Sparkles },
] as const;

const step = ref(0);
const onConsent = computed(() => step.value >= SLIDES.length);
const slide = computed(() => SLIDES[Math.min(step.value, SLIDES.length - 1)] ?? SLIDES[0]);
const showInstall = isIos() && !isStandalone();

function next(): void {
  step.value += 1;
}

function finish(consent: boolean): void {
  settings.analyticsConsent = consent;
  settings.onboarded = true;
  void router.replace({ name: 'home' });
}
</script>

<template>
  <main class="onboarding">
    <div class="onboarding__art azulejo">
      <WordMark :size="40" class="onboarding__mark" />
    </div>

    <section v-if="!onConsent" class="onboarding__slide" aria-live="polite">
      <div class="onboarding__icon">
        <component :is="slide.icon" :size="32" aria-hidden="true" />
      </div>
      <h1 class="t-display">{{ t(`onboarding.${slide.key}.title`) }}</h1>
      <p class="t-body t-muted">{{ t(`onboarding.${slide.key}.body`) }}</p>
      <div class="onboarding__dots" aria-hidden="true">
        <span v-for="(_, index) in SLIDES" :key="index" :class="{ 'is-on': index === step }" />
      </div>
    </section>

    <section v-else class="onboarding__slide">
      <div class="onboarding__icon"><BellRing :size="32" aria-hidden="true" /></div>
      <h1 class="t-display">{{ t('consent.title') }}</h1>
      <p class="t-body t-muted">{{ t('consent.body') }}</p>
      <div v-if="showInstall" class="onboarding__install">
        <Share :size="22" aria-hidden="true" />
        <div>
          <p class="t-body-strong">{{ t('ios.install') }}</p>
          <p class="t-small t-muted">{{ t('ios.steps') }}</p>
        </div>
      </div>
    </section>

    <footer class="onboarding__cta">
      <template v-if="!onConsent">
        <AppButton block @click="next">
          {{ step === SLIDES.length - 1 ? t('onboarding.start') : t('onboarding.next') }}
        </AppButton>
        <AppButton
          v-if="step < SLIDES.length - 1"
          variant="danger"
          size="m"
          block
          class="onboarding__skip"
          @click="step = SLIDES.length"
        >
          {{ t('onboarding.skip') }}
        </AppButton>
      </template>
      <template v-else>
        <AppButton block @click="finish(true)">{{ t('consent.accept') }}</AppButton>
        <AppButton variant="secondary" block @click="finish(false)">{{
          t('consent.decline')
        }}</AppButton>
      </template>
    </footer>
  </main>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 560px;
  margin: 0 auto;
}
.onboarding__art {
  display: flex;
  flex: none;
  align-items: flex-end;
  height: calc(220px + var(--safe-top));
  padding: 16px;
}
.onboarding__mark {
  padding: 10px 16px;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-e2);
}
.onboarding__slide {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 32px var(--gutter) 16px;
}
.onboarding__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.onboarding__dots {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.onboarding__dots span {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--color-border);
  transition: width var(--motion-base);
}
.onboarding__dots span.is-on {
  width: 24px;
  background: var(--color-primary);
}
.onboarding__install {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-primary);
}
.onboarding__install p {
  color: var(--color-text);
}
.onboarding__install .t-muted {
  color: var(--color-text-muted);
}
.onboarding__cta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
}
.onboarding__skip {
  color: var(--color-text-muted);
}
</style>
