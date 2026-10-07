<script setup lang="ts">
import type { Component } from 'vue';

// Floating icon button over the map (DESIGN §7): 48 px, surface + e2.
withDefaults(
  defineProps<{
    icon: Component;
    label: string;
    tone?: 'default' | 'primary' | 'sim';
    active?: boolean;
  }>(),
  {
    tone: 'default',
    active: false,
  },
);
</script>

<template>
  <button
    type="button"
    class="fab"
    :class="[`fab--${tone}`, { 'is-active': active }]"
    :aria-label="label"
    :aria-pressed="active || undefined"
  >
    <component :is="icon" :size="22" aria-hidden="true" />
  </button>
</template>

<style scoped>
.fab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: var(--control-border) solid transparent;
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e2);
}
.fab--primary {
  color: var(--color-primary);
}
.fab--sim {
  background: var(--color-sim);
  color: #fff;
}
.fab.is-active {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
:root[data-contrast='sol'] .fab {
  border-color: var(--color-text);
}
</style>
