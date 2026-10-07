<script setup lang="ts">
import type { Component } from 'vue';

// PermissionRow (DESIGN §7): icon, title with its tag, description and the
// state or action on the right (or below on narrow screens).
defineProps<{ icon: Component; title: string; tag?: string; body: string; done?: boolean }>();
</script>

<template>
  <section class="row" :class="{ 'is-done': done }">
    <div class="row__main">
      <span class="row__icon" aria-hidden="true"><component :is="icon" :size="22" /></span>
      <div class="row__text">
        <h2 class="row__title">
          {{ title }}<span v-if="tag" class="row__tag">{{ tag }}</span>
        </h2>
        <p class="t-small t-muted">{{ body }}</p>
      </div>
      <div class="row__side"><slot name="side" /></div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.row__main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.row__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}
.is-done .row__icon {
  background: var(--color-success-soft);
  color: var(--color-success);
}
.row__text {
  flex: 1;
  min-width: 0;
}
.row__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  font: 600 17px/22px var(--font-ui);
}
.row__tag {
  color: var(--color-accent);
  font: 700 11px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.row__side {
  flex: none;
}
</style>
