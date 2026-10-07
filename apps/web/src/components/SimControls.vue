<script setup lang="ts">
import { FlaskConical, Footprints, X } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { SIM_SPEEDS, type SimSpeed } from '../stores/run.ts';
import ToggleSwitch from './ToggleSwitch.vue';

// SimControls (DESIGN §7, §10.7): purple, so it is never mistaken for the
// real GPS. Tap the map to teleport; walk to the target at 1×, 5× or 20×.
defineProps<{ speed: SimSpeed; weakGps: boolean; canWalk: boolean }>();
defineEmits<{ walk: []; speed: [value: SimSpeed]; weakGps: [value: boolean]; close: [] }>();
const { t } = useI18n();
</script>

<template>
  <section class="sim" :aria-label="t('sim.title')">
    <header class="sim__head">
      <FlaskConical :size="18" aria-hidden="true" />
      <h2 class="sim__title">{{ t('sim.title') }}</h2>
      <button
        type="button"
        class="sim__close"
        :aria-label="t('common.close')"
        @click="$emit('close')"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </header>
    <p class="t-small t-muted">{{ t('sim.tapHint') }}</p>
    <button type="button" class="sim__walk" :disabled="!canWalk" @click="$emit('walk')">
      <Footprints :size="20" aria-hidden="true" />{{ t('sim.walkNext') }}
    </button>
    <div class="sim__row">
      <span>{{ t('sim.speed') }}</span>
      <div class="sim__speeds" role="radiogroup" :aria-label="t('sim.speed')">
        <button
          v-for="value in SIM_SPEEDS"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="speed === value"
          :class="{ 'is-on': speed === value }"
          @click="$emit('speed', value)"
        >
          {{ value }}×
        </button>
      </div>
    </div>
    <div class="sim__row">
      <span>{{ t('sim.weakGps') }}</span>
      <ToggleSwitch
        :model-value="weakGps"
        :label="t('sim.weakGps')"
        @update:model-value="$emit('weakGps', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.sim {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 16px;
  border: 2px solid var(--color-sim);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-e3);
}
.sim__head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-sim);
}
.sim__title {
  flex: 1;
  font: 700 12px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sim__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--color-text);
}
.sim__walk {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-sim);
  color: #fff;
  font: 600 17px var(--font-ui);
}
.sim__walk:disabled {
  opacity: 0.5;
}
.sim__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font: 600 15px var(--font-ui);
}
.sim__speeds {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}
.sim__speeds button {
  min-width: 52px;
  height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: 600 15px var(--font-ui);
}
.sim__speeds button.is-on {
  background: var(--color-surface);
  box-shadow: var(--shadow-e1);
}
</style>
