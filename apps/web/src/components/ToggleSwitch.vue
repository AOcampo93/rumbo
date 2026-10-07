<script setup lang="ts">
// Toggle (DESIGN §7 Inputs). A real switch for assistive tech.
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; disabled?: boolean }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :class="{ 'is-on': model }"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="switch__knob" aria-hidden="true" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  padding: 0;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-surface-2);
  transition: background-color var(--motion-base);
}
.switch.is-on {
  border-color: var(--color-primary);
  background: var(--color-primary);
}
.switch:disabled {
  opacity: 0.5;
}
.switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-e1);
  transition: transform var(--motion-base) var(--ease-sheet);
}
.switch.is-on .switch__knob {
  transform: translateX(20px);
}
</style>
