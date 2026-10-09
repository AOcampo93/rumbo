<script setup lang="ts">
import { Check, X } from '@lucide/vue';
import { REPORT_REASONS, type ReportReason } from '@rumbo/api-contract';
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { track } from '../services/analytics.ts';
import { rememberReported, sendReport } from '../services/community.ts';
import { useUiStore } from '../stores/ui.ts';
import AppButton from './AppButton.vue';
import SheetFrame from './SheetFrame.vue';

// "Reportar ruta" (phase 7.2, ADR 0004): the sheet of a community route's
// detail. One reason from a closed list (no free text: there is nothing
// personal to keep or to moderate), one POST, and a thank-you that doesn't say
// what happens next. Once the API has it, the device remembers the route so
// the detail doesn't offer to report it again. The sheet stays while the
// report is on its way, so the thanks always have a screen to land on.

const props = defineProps<{ routeId: string }>();
const emit = defineEmits<{
  close: [];
  /** The report was received (or the route is already gone): the route is remembered as reported. */
  sent: [];
}>();

const { t } = useI18n();
const ui = useUiStore();
const uid = useId();

const picked = ref<ReportReason | null>(null);
const sending = ref(false);
const error = ref<string | null>(null);

async function send(): Promise<void> {
  const reason = picked.value;
  if (reason === null || sending.value) return;
  error.value = null;
  if (globalThis.navigator?.onLine === false) {
    error.value = t('errors.offline');
    return;
  }
  sending.value = true;
  const result = await sendReport(props.routeId, reason);
  sending.value = false;
  if (result === 'failed') {
    error.value = t('errors.generic');
    return;
  }
  // Also when the route is gone meanwhile (hidden, taken back): the user's wish is done.
  await rememberReported(props.routeId);
  track('route_reported', { reason });
  ui.toast({ key: 'route.report.thanks' }, { tone: 'success' });
  emit('sent');
}
</script>

<template>
  <SheetFrame :label="t('route.report.title')" :dismissible="!sending" @dismiss="emit('close')">
    <div class="report">
      <header class="report__head">
        <h2 class="t-h2" data-autofocus>{{ t('route.report.title') }}</h2>
        <button
          type="button"
          class="report__close"
          :aria-label="t('common.close')"
          :disabled="sending"
          @click="emit('close')"
        >
          <X :size="22" aria-hidden="true" />
        </button>
      </header>

      <div class="report__body">
        <fieldset class="report__reasons">
          <legend class="report__intro">{{ t('route.report.intro') }}</legend>
          <label
            v-for="reason in REPORT_REASONS"
            :key="reason"
            class="reason"
            :class="{ 'is-on': picked === reason }"
          >
            <input
              v-model="picked"
              class="reason__input"
              type="radio"
              :name="`${uid}-reason`"
              :value="reason"
            />
            <span class="reason__text">{{ t(`route.report.reasons.${reason}`) }}</span>
            <span class="reason__check" aria-hidden="true">
              <Check :size="16" :stroke-width="3" />
            </span>
          </label>
        </fieldset>
        <p v-if="error" class="report__error" role="alert">{{ error }}</p>
      </div>

      <footer class="report__footer">
        <AppButton variant="secondary" :disabled="sending" @click="emit('close')">{{
          t('common.cancel')
        }}</AppButton>
        <AppButton :disabled="picked === null" :loading="sending" @click="send">{{
          t('route.report.send')
        }}</AppButton>
      </footer>
    </div>
  </SheetFrame>
</template>

<style scoped>
.report {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.report__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 4px var(--gutter);
}
.report__close {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
}
.report__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  padding: 8px var(--gutter) 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.report__reasons {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.report__intro {
  margin-bottom: 8px;
  padding: 0;
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
/* One radio per reason, laid over its row (like the creator's choices): a tap anywhere picks it. */
.reason {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 56px;
  padding: 10px 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}
.reason__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.reason:has(.reason__input:focus-visible) {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
.reason__text {
  font: 600 15px/20px var(--font-ui);
  overflow-wrap: anywhere;
}
.reason__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  color: transparent;
}
.reason.is-on {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
.reason.is-on .reason__check {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.report__error {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font: 600 14px/20px var(--font-ui);
}
.report__footer {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.report__footer > * {
  flex: 1 1 auto;
}
</style>
