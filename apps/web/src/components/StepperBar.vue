<script setup lang="ts">
import { Check } from '@lucide/vue';
import type { RouteLocationRaw } from 'vue-router';

// Stepper (DESIGN §7): the creator's steps by name, done · current · pending.
// Done steps link back to themselves. When the row gets narrow (a phone, or
// bigger text) only the current step keeps its name on screen; screen readers
// still hear every name, and the current one as "current step".
export interface StepperStep {
  id: string;
  label: string;
  to?: RouteLocationRaw;
}
defineProps<{ steps: readonly StepperStep[]; current: number; label: string }>();
</script>

<template>
  <nav class="stepper" :aria-label="label">
    <ol class="stepper__list">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="stepper__step"
        :class="index < current ? 'is-done' : index === current ? 'is-current' : 'is-pending'"
        :aria-current="index === current ? 'step' : undefined"
      >
        <RouterLink v-if="index < current && step.to" :to="step.to" class="stepper__item">
          <span class="stepper__dot" aria-hidden="true"
            ><Check :size="14" :stroke-width="3"
          /></span>
          <span class="stepper__label">{{ step.label }}</span>
        </RouterLink>
        <span v-else class="stepper__item">
          <span class="stepper__dot tabular" aria-hidden="true">{{ index + 1 }}</span>
          <span class="stepper__label">{{ step.label }}</span>
        </span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.stepper {
  container: stepper / inline-size;
}
.stepper__list {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0;
  list-style: none;
}
.stepper__step {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
}
.stepper__step:last-child {
  flex: 0 1 auto;
}
/* The line to the next step. */
.stepper__step:not(:last-child)::after {
  content: '';
  flex: 1 1 16px;
  min-width: 12px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--color-border);
}
.stepper__step.is-done:not(:last-child)::after {
  background: var(--color-primary);
}
.stepper__item {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  color: var(--color-text-muted);
  font: 600 14px/18px var(--font-ui);
  text-decoration: none;
}
a.stepper__item {
  min-width: 48px;
  color: var(--color-primary);
}
a.stepper__item:hover .stepper__label {
  text-decoration: underline;
}
.is-current .stepper__item {
  color: var(--color-text);
  font-weight: 700;
}
.stepper__dot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 2em;
  height: 2em;
  border: var(--control-border) solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  font: 700 13px/1 var(--font-ui);
}
.is-done .stepper__dot,
.is-current .stepper__dot {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.is-current .stepper__dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
}
.stepper__label {
  white-space: nowrap;
}
/* Compact: the other steps keep only their number (their names stay for screen readers). */
@container stepper (max-width: 22em) {
  .stepper__step:not(.is-current) .stepper__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
</style>
