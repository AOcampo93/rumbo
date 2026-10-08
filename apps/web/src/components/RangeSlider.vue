<script setup lang="ts">
import { computed, useId } from 'vue';

// Slider (DESIGN §7 Inputs): a native range with its label, the value as text
// ("60 m", also what screen readers hear) and an optional hint.
const model = defineModel<number>({ required: true });
const props = withDefaults(
  defineProps<{
    label: string;
    min: number;
    max: number;
    step?: number;
    valueText: string;
    hint?: string;
  }>(),
  { step: 1, hint: undefined },
);

const id = useId();
const fill = computed(() => {
  const span = props.max - props.min;
  const ratio = span > 0 ? (model.value - props.min) / span : 0;
  return `${Math.min(100, Math.max(0, ratio * 100))}%`;
});
</script>

<template>
  <div class="range">
    <div class="range__head">
      <label :for="id" class="range__label">{{ label }}</label>
      <output :for="id" class="range__value tabular" aria-hidden="true">{{ valueText }}</output>
    </div>
    <input
      :id="id"
      v-model.number="model"
      class="range__input"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :aria-valuetext="valueText"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      :style="{ '--fill': fill }"
    />
    <p v-if="hint" :id="`${id}-hint`" class="range__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.range {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.range__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
}
.range__label {
  font: 600 15px/20px var(--font-ui);
}
.range__value {
  color: var(--color-primary);
  font: 700 17px/22px var(--font-ui);
}
.range__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.range__input {
  width: 100%;
  height: 48px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
.range__input::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    var(--color-primary) var(--fill),
    var(--color-surface-2) var(--fill)
  );
  box-shadow: inset 0 0 0 var(--control-border) var(--color-border);
}
.range__input::-webkit-slider-thumb {
  width: 28px;
  height: 28px;
  margin-top: -11px;
  border: 3px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: var(--shadow-e2);
  -webkit-appearance: none;
  appearance: none;
}
.range__input::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--color-surface-2);
}
.range__input::-moz-range-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--color-primary);
}
.range__input::-moz-range-thumb {
  width: 22px;
  height: 22px;
  border: 3px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: var(--shadow-e2);
}
</style>
