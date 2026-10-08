<script setup lang="ts">
import { Check } from '@lucide/vue';
import { INTERESTS, type Interest } from '@rumbo/api-contract';
import { useI18n } from 'vue-i18n';

// The interests the AI adapts suggestions and cards to (DESIGN C1): any
// number of the seven, as toggle chips that wrap (the answer is a set, so
// each chip is a pressed / not pressed button, not one radio of a group).
// The value keeps INTERESTS order, whatever order the user tapped them in.
const model = defineModel<Interest[]>({ required: true });
defineProps<{ label: string }>();
const { t } = useI18n();

function toggle(interest: Interest): void {
  const chosen = new Set(model.value);
  if (chosen.has(interest)) chosen.delete(interest);
  else chosen.add(interest);
  model.value = INTERESTS.filter((item) => chosen.has(item));
}
</script>

<template>
  <div class="interests" role="group" :aria-label="label">
    <button
      v-for="interest in INTERESTS"
      :key="interest"
      type="button"
      class="interest"
      :class="{ 'is-on': model.includes(interest) }"
      :aria-pressed="model.includes(interest)"
      @click="toggle(interest)"
    >
      <Check v-if="model.includes(interest)" :size="16" :stroke-width="3" aria-hidden="true" />
      {{ t(`create.interests.${interest}`) }}
    </button>
  </div>
</template>

<style scoped>
.interests {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.interest {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 14px/20px var(--font-ui);
}
.interest.is-on {
  border-color: var(--color-text);
  background: var(--color-text);
  color: var(--color-bg);
}
</style>
