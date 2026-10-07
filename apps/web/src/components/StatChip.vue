<script setup lang="ts">
import type { Component } from 'vue';

// StatChip (DESIGN §7): icon + value ("3,4 km", "~2 h", "12 points").
defineProps<{ icon: Component; value: string; label?: string; bordered?: boolean }>();
</script>

<template>
  <span
    class="stat"
    :class="{ 'stat--bordered': bordered }"
    :aria-label="label ? `${label}: ${value}` : undefined"
  >
    <component :is="icon" :size="16" aria-hidden="true" class="stat__icon" />
    <span class="tabular">{{ value }}</span>
  </span>
</template>

<style scoped>
.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 600 14px/20px var(--font-ui);
}
.stat__icon {
  color: var(--color-text-muted);
}
.stat--bordered {
  height: 40px;
  padding: 0 12px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 15px;
}
</style>
