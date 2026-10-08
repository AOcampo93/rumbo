<script setup lang="ts">
import { CloudOff, History, X } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '../../components/PageHeader.vue';
import StepperBar, { type StepperStep } from '../../components/StepperBar.vue';
import { CREATOR_STEPS, type CreatorStep, useCreatorStore } from '../../stores/creator.ts';
import { useUiStore } from '../../stores/ui.ts';

// The creator's frame (C1-C5, DESIGN §8.2): back arrow and stepper instead of
// the bottom navigation, the banners every step shares (a recovered draft,
// storage that doesn't work) and the current step. On every step change it
// moves focus to the step's heading, names the page and announces
// "Paso n de 4 · …" (design ux-9). Toasts open below the stepper.

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const creator = useCreatorStore();
const ui = useUiStore();

const top = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const topHeight = ref(0);
const progress = ref('');
const bannerClosed = ref(false);
let observer: ResizeObserver | null = null;
let announceTimer: ReturnType<typeof setTimeout> | null = null;

const step = computed<CreatorStep | 'done' | null>(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  if (name === 'create-done') return 'done';
  const id = name.replace(/^create-/, '');
  return (CREATOR_STEPS as readonly string[]).includes(id) ? (id as CreatorStep) : null;
});
const stepIndex = computed(() =>
  step.value === 'done' ? CREATOR_STEPS.length : CREATOR_STEPS.indexOf(step.value ?? 'details'),
);

/** Editing a saved route (kept on "done", where the draft is gone). */
const editing = ref(creator.draft?.editingId != null);
watch(
  () => creator.draft?.editingId,
  (id) => {
    if (creator.draft) editing.value = id != null;
  },
);
const title = computed(() => t(editing.value ? 'create.editTitle' : 'create.title'));

/** Leaving from the first step goes back to where the creator was opened from. */
const exitTo = (() => {
  const back = router.options.history.state['back'];
  const creatorPath = router.resolve({ name: 'create-details' }).path.replace(/\/details$/, '');
  if (typeof back === 'string' && !back.startsWith(creatorPath)) return back;
  return router.resolve({ name: editing.value ? 'my-routes' : 'home' }).fullPath;
})();
const backTo = computed(() => {
  if (step.value === 'places') return router.resolve({ name: 'create-details' }).fullPath;
  if (step.value === 'content') return router.resolve({ name: 'create-places' }).fullPath;
  if (step.value === 'review') return router.resolve({ name: 'create-content' }).fullPath;
  if (step.value === 'done') return router.resolve({ name: 'my-routes' }).fullPath;
  return exitTo;
});

const steps = computed<StepperStep[]>(() =>
  CREATOR_STEPS.map((id) => ({
    id,
    label: t(`create.steps.${id}`),
    to: { name: `create-${id}` },
  })),
);

const showRecovered = computed(
  () => creator.recovered && !bannerClosed.value && step.value !== 'done' && !!creator.draft,
);
const recoveredText = computed(() => {
  const draft = creator.draft;
  if (draft?.editingId) return t('create.draft.recoveredEdit', { name: draft.name.trim() });
  return t('create.draft.recovered');
});

const pageTitle = computed(() => {
  if (step.value === 'done') return `${t('create.done.title')} · Rumbo`;
  const name = step.value ? t(`create.steps.${step.value}`) : '';
  return `${name} · ${title.value} · Rumbo`;
});
watchEffect(() => {
  document.title = pageTitle.value;
});

/** The step's single h1 gets focus (without a ring: base.css), and the step is announced. */
async function onStep(): Promise<void> {
  await nextTick();
  const heading = body.value?.querySelector<HTMLElement>('h1');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  if (announceTimer) clearTimeout(announceTimer);
  progress.value = '';
  if (step.value === null || step.value === 'done') return;
  const text = t('create.steps.progress', {
    n: stepIndex.value + 1,
    total: CREATOR_STEPS.length,
    step: t(`create.steps.${step.value}`),
  });
  // A moment after the region was emptied, so the same words are read again.
  announceTimer = setTimeout(() => {
    progress.value = text;
  }, 120);
}
watch(() => route.name, onStep, { flush: 'post' });

async function startOver(): Promise<void> {
  const confirmed = await ui.confirm({
    title: { key: 'create.draft.discardTitle' },
    body: { key: 'create.draft.discardBody' },
    confirmLabel: { key: 'create.draft.discard' },
    cancelLabel: { key: 'common.cancel' },
    destructive: true,
  });
  if (!confirmed) return;
  await creator.discard();
  await creator.startNew();
  bannerClosed.value = false;
  if (route.name === 'create-details') await onStep();
  else await router.replace({ name: 'create-details' });
}

function setToastTop(height: number): void {
  topHeight.value = height;
  // OverlayHost adds the safe area itself; the header's height already has it.
  document.documentElement.style.setProperty(
    '--toast-top',
    `calc(${Math.round(height) + 8}px - var(--safe-top))`,
  );
}

onMounted(() => {
  void onStep();
  const element = top.value;
  if (!element) return;
  setToastTop(element.offsetHeight);
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => setToastTop(element.offsetHeight));
    observer.observe(element);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (announceTimer) clearTimeout(announceTimer);
  document.documentElement.style.removeProperty('--toast-top');
  document.title = 'Rumbo';
});
</script>

<template>
  <main
    class="create"
    :class="{ 'create--fit': step === 'places' }"
    :style="{ '--create-top': `${topHeight}px` }"
  >
    <div ref="top" class="create__top">
      <PageHeader :title="title" :to="backTo" />
      <div v-if="step !== 'done'" class="create__stepper">
        <StepperBar :steps="steps" :current="stepIndex" :label="t('create.steps.label')" />
      </div>
    </div>

    <div v-if="showRecovered" class="create__banner">
      <History :size="20" aria-hidden="true" class="create__bannericon" />
      <div class="create__bannertext">
        <p>{{ recoveredText }}</p>
        <button type="button" class="create__link" @click="startOver">
          {{ t('create.draft.startOver') }}
        </button>
      </div>
      <button
        type="button"
        class="create__close"
        :aria-label="t('common.close')"
        @click="bannerClosed = true"
      >
        <X :size="20" aria-hidden="true" />
      </button>
    </div>
    <p
      v-if="creator.storageOff && step !== 'done'"
      class="create__banner create__banner--warning"
      role="status"
    >
      <CloudOff :size="20" aria-hidden="true" class="create__bannericon" />
      <span class="create__bannertext">{{ t('create.draft.storageOff') }}</span>
    </p>

    <p class="visually-hidden" aria-live="polite">{{ progress }}</p>

    <div ref="body" class="create__body">
      <RouterView />
    </div>
  </main>
</template>

<style scoped>
.create {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
/* "Lugares": one screen high, the step scrolls inside (map pinned on top). */
.create--fit {
  height: 100dvh;
  overflow: hidden;
}
.create__top {
  position: sticky;
  top: 0;
  z-index: 20;
  flex: none;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}
.create__stepper {
  max-width: 640px;
  margin: -4px auto 0;
  padding: 0 var(--gutter) 4px;
}
.create__banner {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: 10px;
  width: calc(100% - 2 * var(--gutter));
  max-width: 640px;
  margin: 12px auto 0;
  padding: 10px 4px 10px 12px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font: 500 14px/20px var(--font-ui);
}
.create__banner--warning {
  padding-right: 12px;
  border-color: transparent;
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.create__bannericon {
  flex: none;
  margin-top: 2px;
  color: var(--color-primary);
}
.create__banner--warning .create__bannericon {
  color: currentColor;
}
.create__bannertext {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding-top: 1px;
}
.create__link {
  min-height: 40px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: 600 15px/20px var(--font-ui);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.create__close {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -8px 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
}
.create__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
</style>
