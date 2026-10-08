<script setup lang="ts">
import { CircleCheck, Info, TriangleAlert } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { sheetComponent } from '../handlers/registry.ts';
import { useTexts } from '../i18n/text.ts';
import { useUiStore } from '../stores/ui.ts';
import AppButton from './AppButton.vue';
import SheetFrame from './SheetFrame.vue';

// Renders the overlay stack: sheets (each view by name), confirmation
// dialogs and toasts. Toasts live in an aria-live region (DESIGN §12).
const ui = useUiStore();
const { sheets, confirms, toasts } = storeToRefs(ui);
const texts = useTexts();
const TOAST_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert } as const;
</script>

<template>
  <SheetFrame
    v-for="sheet in sheets"
    :key="sheet.id"
    :variant="sheet.variant"
    @dismiss="sheet.close({ status: 'dismissed' })"
  >
    <component
      :is="sheetComponent(sheet.view)"
      v-bind="sheet.props"
      :source-locale="sheet.sourceLocale"
      @close="sheet.close($event)"
    />
  </SheetFrame>

  <SheetFrame
    v-for="entry in confirms"
    :key="entry.id"
    variant="modal"
    @dismiss="entry.answer(false)"
  >
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="`confirm-${entry.id}-title`"
      :aria-describedby="entry.body ? `confirm-${entry.id}-body` : undefined"
    >
      <h2 :id="`confirm-${entry.id}-title`" class="t-h2">
        {{ texts.ui(entry.title, entry.sourceLocale ?? 'es') }}
      </h2>
      <p v-if="entry.body" :id="`confirm-${entry.id}-body`" class="dialog__body t-body t-muted">
        {{ texts.ui(entry.body, entry.sourceLocale ?? 'es') }}
      </p>
      <div class="dialog__actions">
        <AppButton
          :variant="entry.destructive ? 'danger' : 'primary'"
          size="m"
          block
          @click="entry.answer(true)"
        >
          {{ texts.ui(entry.confirmLabel, entry.sourceLocale ?? 'es') }}
        </AppButton>
        <AppButton variant="secondary" size="m" block @click="entry.answer(false)">
          {{ texts.ui(entry.cancelLabel, entry.sourceLocale ?? 'es') }}
        </AppButton>
      </div>
    </div>
  </SheetFrame>

  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.tone}`">
        <!-- Tapping the message dismisses it; the action ("Deshacer") is its own button. -->
        <button type="button" class="toast__body" @click="ui.dismissToast(toast.id)">
          <component :is="TOAST_ICONS[toast.tone]" :size="20" aria-hidden="true" />
          <span>{{ texts.ui(toast.message, toast.sourceLocale) }}</span>
        </button>
        <button
          v-if="toast.action"
          type="button"
          class="toast__action"
          @click="ui.runToastAction(toast.id)"
        >
          {{ texts.ui(toast.action.label, toast.sourceLocale) }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Long texts (or text at 200 %) scroll inside the frame's maximum height. */
  min-height: 0;
  padding: 24px;
  overflow-y: auto;
}
.dialog__body {
  /* A body made of several paragraphs (joined with blank lines) keeps them apart. */
  white-space: pre-line;
}
.dialog__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
.dialog__actions :deep(.btn--danger) {
  background: var(--color-danger);
  /* White on the light theme's red, ink on the dark theme's lighter red. */
  color: var(--color-on-accent);
}
.toasts {
  position: fixed;
  top: calc(var(--safe-top) + var(--toast-top, 16px));
  left: 50%;
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(100% - 32px, 480px);
  transform: translateX(-50%);
  pointer-events: none;
}
.toast {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-height: 48px;
  overflow: hidden;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e2);
  pointer-events: auto;
}
/* The action shares the message's row while the message has about 12 words'
   room (em: it scales with the text size), and goes under it otherwise. */
.toast__body {
  display: flex;
  flex: 1 1 12em;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 48px;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: 600 15px/20px var(--font-ui);
  text-align: start;
  overflow-wrap: break-word;
}
.toast__body svg {
  flex: none;
}
.toast__body:focus-visible,
.toast__action:focus-visible {
  outline-offset: -3px;
}
.toast__action {
  flex: none;
  min-width: 48px;
  min-height: 48px;
  margin: 0 4px 0 auto;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-primary);
  font: 700 15px/20px var(--font-ui);
  text-align: center;
}
.toast__action:hover {
  background: var(--color-surface-2);
}
.toast--success .toast__body svg {
  color: var(--color-success);
}
.toast--warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.toast--info .toast__body svg {
  color: var(--color-accent);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--motion-base),
    transform var(--motion-base);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
