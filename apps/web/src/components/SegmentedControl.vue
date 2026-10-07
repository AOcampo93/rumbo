<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue';

// SegmentedControl (DESIGN §7): one choice among a few, e.g. List | Map.
const model = defineModel<T>({ required: true });
defineProps<{
  options: ReadonlyArray<{ value: T; label: string; icon?: Component }>;
  label: string;
}>();
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segmented__item"
      :class="{ 'is-on': model === option.value }"
      :aria-checked="model === option.value"
      @click="model = option.value"
    >
      <component :is="option.icon" v-if="option.icon" :size="18" aria-hidden="true" />
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.segmented__item {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: var(--control-border) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: 500 16px/20px var(--font-ui);
}
.segmented__item.is-on {
  background: var(--color-surface);
  box-shadow: var(--shadow-e1);
  font-weight: 600;
}
:root[data-contrast='sol'] .segmented__item.is-on {
  border-color: var(--color-text);
}
</style>
