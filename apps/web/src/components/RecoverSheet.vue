<script setup lang="ts">
import { History } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useFormat } from '../i18n/useFormat.ts';
import { useTexts } from '../i18n/text.ts';
import { useRunStore } from '../stores/run.ts';
import AppButton from './AppButton.vue';
import SheetFrame from './SheetFrame.vue';

// S11 · On opening the app with a run half done: continue (paused, ready to
// resume) or discard. If the route changed meanwhile, it can only restart.
const { t } = useI18n();
const router = useRouter();
const run = useRunStore();
const texts = useTexts();
const format = useFormat();

const info = computed(() => {
  const recovered = run.recoverable;
  if (!recovered) return null;
  const { spec } = recovered.bundle;
  const snapshot = recovered.record.snapshot;
  return {
    route: texts.text(spec.name, spec.locale),
    completed: snapshot.points.filter((p) => p.state === 'completed').length,
    total: snapshot.points.length,
    time: format.elapsed(snapshot.elapsedMs),
  };
});

function resume(): void {
  if (run.continueRecovered()) void router.push({ name: 'run' });
}

async function restart(): Promise<void> {
  const routeId = run.recoverable?.record.routeId;
  await run.discardRecovered();
  if (routeId) void router.push({ name: 'prepare', params: { routeId } });
}
</script>

<template>
  <SheetFrame v-if="run.recoverable && info" :dismissible="false">
    <div class="recover">
      <span class="recover__icon" aria-hidden="true"><History :size="28" /></span>
      <h2 class="t-h2" data-autofocus>{{ t('recover.title') }}</h2>
      <p class="t-body t-muted tabular">{{ t('recover.body', info) }}</p>
      <p v-if="run.recoverable.changed" class="recover__changed">{{ t('recover.changed') }}</p>
      <div class="recover__actions">
        <AppButton v-if="!run.recoverable.changed" block @click="resume">{{
          t('recover.continue')
        }}</AppButton>
        <AppButton v-else block @click="restart">{{ t('summary.repeat') }}</AppButton>
        <AppButton variant="secondary" block @click="run.discardRecovered()">{{
          t('recover.discard')
        }}</AppButton>
      </div>
    </div>
  </SheetFrame>
</template>

<style scoped>
.recover {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px var(--gutter) calc(16px + var(--safe-bottom));
}
.recover__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.recover__changed {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font: 500 14px/20px var(--font-ui);
}
.recover__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
</style>
