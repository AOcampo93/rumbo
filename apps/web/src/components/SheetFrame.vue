<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

// The frame of every sheet on the overlay stack (DESIGN §7 BottomSheet,
// §12 focus order): slides up, takes focus, gives it back on close, and can be
// dragged down from its handle to dismiss it. `modal: false` keeps what is
// behind it usable (the creator's place editor over a live map): no scrim, no
// aria-modal, pointer events only on the panel, and a shorter panel.
const props = withDefaults(
  defineProps<{
    variant?: 'sheet' | 'modal' | 'fullscreen';
    label?: string;
    dismissible?: boolean;
    modal?: boolean;
  }>(),
  { variant: 'sheet', label: undefined, dismissible: true, modal: true },
);
const emit = defineEmits<{ dismiss: [] }>();

const panel = ref<HTMLElement | null>(null);
const dragY = ref(0);
let startY: number | null = null;
let previousFocus: Element | null = null;

onMounted(async () => {
  previousFocus = document.activeElement;
  await nextTick();
  // Focus starts on the title when there is one (DESIGN §12).
  const target = panel.value?.querySelector<HTMLElement>('[data-autofocus], h1, h2') ?? panel.value;
  if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
});

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.dismissible) emit('dismiss');
}

function onPointerDown(event: PointerEvent): void {
  if (!props.dismissible || props.variant !== 'sheet') return;
  startY = event.clientY;
  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
}
function onPointerMove(event: PointerEvent): void {
  if (startY === null) return;
  dragY.value = Math.max(0, event.clientY - startY);
}
function onPointerUp(): void {
  if (startY === null) return;
  startY = null;
  if (dragY.value > 120) emit('dismiss');
  dragY.value = 0;
}
</script>

<template>
  <div class="frame" :class="[`frame--${variant}`, { 'frame--inline': !modal }]" @keydown="onKey">
    <div v-if="modal" class="frame__scrim" aria-hidden="true" />
    <div
      ref="panel"
      class="frame__panel"
      role="dialog"
      :aria-modal="modal ? 'true' : undefined"
      :aria-label="label"
      :style="dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined"
    >
      <div
        v-if="variant === 'sheet'"
        class="frame__handle"
        aria-hidden="true"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <span />
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.frame {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.frame__scrim {
  position: absolute;
  inset: 0;
  background: var(--color-scrim);
  animation: fade var(--motion-slow) ease-out;
}
.frame__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 92dvh;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e3);
  outline: none;
  animation: rise var(--motion-sheet) var(--ease-sheet);
  transition: transform var(--motion-base) var(--ease-sheet);
}
.frame--modal {
  align-items: center;
  padding: 24px;
}
.frame--modal .frame__panel {
  max-width: 400px;
  border-radius: var(--radius-lg);
  animation: pop var(--motion-slow) var(--ease-sheet);
}
.frame--fullscreen .frame__panel {
  max-width: none;
  height: 100dvh;
  max-height: none;
  border-radius: 0;
}
/* Non-modal: taps outside the panel reach the screen behind it. */
.frame--inline {
  pointer-events: none;
}
.frame--inline .frame__panel {
  max-height: 55dvh;
  pointer-events: auto;
}
.frame__handle {
  display: flex;
  flex: none;
  justify-content: center;
  padding: 10px 0 6px;
  touch-action: none;
  cursor: grab;
}
.frame__handle span {
  width: 40px;
  height: 5px;
  border-radius: 3px;
  background: var(--color-border);
}
@keyframes rise {
  from {
    transform: translateY(100%);
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
