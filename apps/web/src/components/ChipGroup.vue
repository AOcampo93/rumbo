<script setup lang="ts" generic="T extends string">
// Filter chips (DESIGN §7 Inputs): a single choice, scrollable sideways.
const model = defineModel<T>({ required: true });
defineProps<{ options: ReadonlyArray<{ value: T; label: string }>; label: string }>();
</script>

<template>
  <div class="chips" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="chip"
      :class="{ 'is-on': model === option.value }"
      :aria-checked="model === option.value"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: none;
  height: 36px;
  padding: 0 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 14px var(--font-ui);
}
.chip.is-on {
  border-color: var(--color-text);
  background: var(--color-text);
  color: var(--color-bg);
}
</style>
