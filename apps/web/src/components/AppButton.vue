<script setup lang="ts">
// Button of DESIGN §7: primary (Azulejo), accent (Terracota, arrivals and
// challenges only), secondary (outline), ghost, danger (red text) and sim
// (purple, simulation only). L = 56 px for run screens, M = 48 px, S = 40 px.
withDefaults(
  defineProps<{
    variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'sim';
    size?: 'l' | 'm' | 's';
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', size: 'l', block: false, disabled: false, loading: false, type: 'button' },
);
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn--${variant}`, `btn--${size}`, { 'btn--block': block }]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span v-if="loading" class="btn__spinner" aria-hidden="true" />
    <slot name="icon" />
    <span class="btn__label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
  padding: 0 24px;
  border: var(--control-border) solid transparent;
  border-radius: var(--radius-pill);
  font: 600 17px/1.2 var(--font-ui);
  text-align: center;
  transition:
    background-color var(--motion-fast),
    transform var(--motion-fast);
}
.btn:active:not(:disabled) {
  transform: scale(0.98);
}
.btn:disabled {
  opacity: 0.55;
}
.btn--l {
  min-height: var(--control-l);
}
.btn--m {
  min-height: var(--control-m);
  font-size: 16px;
  padding: 0 20px;
}
.btn--s {
  min-height: 40px;
  font-size: 15px;
  padding: 0 16px;
}
.btn--block {
  display: flex;
  width: 100%;
}
.btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn--primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.btn--primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
.btn--accent {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.btn--secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border);
}
.btn--ghost {
  background: var(--color-surface-2);
  color: var(--color-text);
}
.btn--danger {
  background: transparent;
  color: var(--color-danger);
}
.btn--sim {
  background: var(--color-sim);
  color: #fff;
}
.btn__spinner {
  width: 18px;
  height: 18px;
  border: 2.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
