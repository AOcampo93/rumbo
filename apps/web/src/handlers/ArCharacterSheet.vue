<script setup lang="ts">
import { Camera, Hand, Mic, PersonStanding, Undo2 } from '@lucide/vue';
import type { ViewOutcome } from '@rumbo/event-system';
import type { Locale, LocalizedText } from '@rumbo/route-spec';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import { appClipUrl, arPageUrl, isIos, readArCode } from '../ar/access.ts';
import { useTexts } from '../i18n/text.ts';
import ArrivalKicker from './ArrivalKicker.vue';
import SheetFooter from './SheetFooter.vue';

// Version 2 prototype · The AR guide: how the activity works, then the AR page (/ra_test/)
// in another window, so the run keeps going here. Back from it, the usual footer.
const props = defineProps<{
  sourceLocale: Locale;
  name?: LocalizedText | null;
  order?: number | null;
  total?: number;
  scene: string;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t, locale } = useI18n();
const texts = useTexts();

/** Safari on iPhone has no WebXR: Needle's App Clip brings it. */
const viaAppClip = isIos(navigator) && !('xr' in navigator);
const STEPS = [
  { key: 'camera', icon: Camera },
  { key: 'place', icon: Hand },
  { key: 'talk', icon: Mic },
  { key: 'back', icon: Undo2 },
] as const;

const started = ref(false);
const target = computed(() => {
  const page = arPageUrl(location.origin, {
    scene: props.scene,
    lang: locale.value,
    fromRoute: true,
    ...(viaAppClip ? { code: readArCode() } : {}),
  });
  return viaAppClip ? appClipUrl(page) : page;
});

function start(): void {
  // Another window: this page (and the run) stays alive underneath.
  window.open(target.value, '_blank', 'noopener');
  started.value = true;
}
</script>

<template>
  <article class="ar-sheet">
    <div class="ar-sheet__scroll">
      <ArrivalKicker :order="order ?? null" :total="total ?? 0" />
      <h1 class="t-h1" data-autofocus>{{ texts.text(name ?? '', sourceLocale) }}</h1>

      <section class="ar-sheet__hero">
        <span class="ar-sheet__badge" aria-hidden="true"><PersonStanding :size="28" /></span>
        <div>
          <h2 class="t-h2">{{ t(`arCharacter.scenes.${scene}.title`) }}</h2>
          <p class="t-body t-muted">{{ t(`arCharacter.scenes.${scene}.lead`) }}</p>
        </div>
      </section>

      <template v-if="!started">
        <h3 class="t-title">{{ t('arCharacter.how') }}</h3>
        <ol class="ar-sheet__steps">
          <li v-for="(step, i) in STEPS" :key="step.key">
            <span class="ar-sheet__num" aria-hidden="true">{{ i + 1 }}</span>
            <component :is="step.icon" class="ar-sheet__icon" :size="20" aria-hidden="true" />
            <span>
              <span class="t-body-strong">{{
                t(`arCharacter.scenes.${scene}.steps.${step.key}.title`)
              }}</span>
              <span class="t-small t-muted ar-sheet__help">{{
                t(`arCharacter.scenes.${scene}.steps.${step.key}.text`)
              }}</span>
            </span>
          </li>
        </ol>
        <p v-if="viaAppClip" class="ar-sheet__note t-small">{{ t('arCharacter.iphone') }}</p>
        <p class="ar-sheet__note t-small">{{ t('arCharacter.tips') }}</p>
      </template>

      <section v-else class="ar-sheet__opened" role="status">
        <h3 class="t-title">{{ t(`arCharacter.scenes.${scene}.opened`) }}</h3>
        <p class="t-body t-muted">
          {{ t(viaAppClip ? 'arCharacter.openedAppClip' : 'arCharacter.openedText') }}
        </p>
        <AppButton variant="secondary" size="m" @click="start">{{
          t('arCharacter.reopen')
        }}</AppButton>
      </section>
    </div>

    <footer v-if="!started" class="ar-sheet__actions">
      <AppButton variant="ghost" @click="emit('close', { status: 'dismissed' })">{{
        t('arCharacter.later')
      }}</AppButton>
      <AppButton class="ar-sheet__start" @click="start">{{ t('arCharacter.start') }}</AppButton>
    </footer>
    <SheetFooter
      v-else
      @continue="emit('close', { status: 'done' })"
      @pause="emit('close', { status: 'done', decision: 'pause' })"
      @end="emit('close', { status: 'done', decision: 'cancel' })"
    />
  </article>
</template>

<style scoped>
.ar-sheet {
  display: flex;
  flex-direction: column;
  max-height: calc(92dvh - 24px);
}
.ar-sheet__scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Without it the list would push the buttons below the screen instead of scrolling. */
  min-height: 0;
  padding: 8px var(--gutter) 24px;
  overflow-y: auto;
}
.ar-sheet__hero {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--color-accent-soft);
}
.ar-sheet__hero h2 {
  margin: 0 0 4px;
}
.ar-sheet__hero p {
  margin: 0;
}
.ar-sheet__badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.ar-sheet__steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ar-sheet__steps li {
  display: grid;
  grid-template-columns: 26px 22px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 0;
  border-top: 1px solid var(--color-border);
}
.ar-sheet__steps li:first-child {
  border-top: 0;
}
.ar-sheet__num {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-surface-2);
  font-weight: 700;
  font-size: 13px;
}
.ar-sheet__icon {
  margin-top: 3px;
  color: var(--color-accent);
}
.ar-sheet__help {
  display: block;
  margin-top: 2px;
}
.ar-sheet__note {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.ar-sheet__opened {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.ar-sheet__opened h3,
.ar-sheet__opened p {
  margin: 0;
}
.ar-sheet__actions {
  display: flex;
  flex: none;
  gap: 10px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.ar-sheet__start {
  flex: 1;
}
</style>
