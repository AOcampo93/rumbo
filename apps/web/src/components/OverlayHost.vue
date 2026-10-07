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
    <div class="dialog" role="alertdialog" aria-modal="true">
      <h2 class="t-h2">{{ texts.ui(entry.title, entry.sourceLocale ?? 'es') }}</h2>
      <p v-if="entry.body" class="t-body t-muted">
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
      <button
        v-for="toast in toasts"
        :key="toast.id"
        type="button"
        class="toast"
        :class="`toast--${toast.tone}`"
        @click="ui.dismissToast(toast.id)"
      >
        <component :is="TOAST_ICONS[toast.tone]" :size="20" aria-hidden="true" />
        <span>{{ texts.ui(toast.message, toast.sourceLocale) }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
}
.dialog__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
.dialog__actions :deep(.btn--danger) {
  background: var(--color-danger);
  color: #fff;
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
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 10px 16px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e2);
  font: 600 15px/20px var(--font-ui);
  text-align: left;
  pointer-events: auto;
}
.toast--success svg {
  color: var(--color-success);
}
.toast--warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.toast--info svg {
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
