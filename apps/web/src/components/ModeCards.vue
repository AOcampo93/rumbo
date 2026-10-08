<script setup lang="ts">
import { Check, Compass, Flag } from '@lucide/vue';
import type { RouteMode } from '@rumbo/route-spec';
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

// The route's mode as two big cards (DESIGN C1): Free in Atlántico, Challenge
// in Terracota, like their badges. A native radio covers each card (invisible),
// so the arrow keys move between them and a tap anywhere picks one; the card's
// title names it and its line describes it.
const model = defineModel<RouteMode>({ required: true });
defineProps<{ label: string }>();
const { t } = useI18n();
const id = useId();
const MODES = [
  { value: 'free', icon: Compass },
  { value: 'challenge', icon: Flag },
] as const;
</script>

<template>
  <fieldset class="modes">
    <legend class="modes__legend">{{ label }}</legend>
    <div class="modes__grid">
      <label
        v-for="mode in MODES"
        :key="mode.value"
        class="mode"
        :class="[`mode--${mode.value}`, { 'is-on': model === mode.value }]"
      >
        <input
          v-model="model"
          class="mode__input"
          type="radio"
          :name="id"
          :value="mode.value"
          :aria-labelledby="`${id}-${mode.value}`"
          :aria-describedby="`${id}-${mode.value}-body`"
        />
        <span class="mode__top">
          <span class="mode__icon" aria-hidden="true">
            <component :is="mode.icon" :size="20" :stroke-width="2.25" />
          </span>
          <span class="mode__check" aria-hidden="true">
            <Check :size="16" :stroke-width="3" />
          </span>
        </span>
        <span :id="`${id}-${mode.value}`" class="mode__title">{{ t(`mode.${mode.value}`) }}</span>
        <span :id="`${id}-${mode.value}-body`" class="mode__body">{{
          t(`create.mode.${mode.value}`)
        }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.modes {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.modes__legend {
  margin-bottom: 8px;
  padding: 0;
  font: 600 15px/20px var(--font-ui);
}
.modes__grid {
  display: grid;
  /* Side by side while the text fits; stacked when it grows (200 % text). */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5em), 1fr));
  gap: 12px;
}
.mode {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}
.mode--free {
  --mode-ink: var(--color-free-text);
  --mode-soft: var(--color-free-soft);
}
.mode--challenge {
  --mode-ink: var(--color-challenge-text);
  --mode-soft: var(--color-challenge-soft);
}
.mode__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.mode:has(.mode__input:focus-visible) {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
.mode__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.mode__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--mode-soft);
  color: var(--mode-ink);
}
.mode__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  color: transparent;
}
.mode__title {
  font: 600 19px/24px var(--font-display);
}
.mode__body {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.mode.is-on {
  border-color: var(--mode-ink);
  background: var(--mode-soft);
  box-shadow: inset 0 0 0 1px var(--mode-ink);
}
.mode.is-on .mode__body {
  color: var(--color-text);
}
.mode.is-on .mode__icon {
  background: var(--color-surface);
}
.mode.is-on .mode__check {
  border-color: var(--mode-ink);
  background: var(--mode-ink);
  color: var(--color-surface);
}
</style>
