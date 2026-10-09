<script setup lang="ts" generic="T extends string">
// Chips of the Explore filter sheet (DESIGN §7 Inputs, Chip): any number can
// be on, and none on means "everything". Each is a pressed / not pressed button.
defineProps<{
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: ReadonlySet<T>;
  /** Id of the heading that names the group. */
  labelledby: string;
}>();
defineEmits<{ toggle: [value: T] }>();
</script>

<template>
  <div class="chips" role="group" :aria-labelledby="labelledby">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="chip"
      :class="{ 'is-on': selected.has(option.value) }"
      :aria-pressed="selected.has(option.value)"
      @click="$emit('toggle', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  height: 36px;
  padding: 0 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font: 600 14px var(--font-ui);
}
.chip.is-on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
</style>
