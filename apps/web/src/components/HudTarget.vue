<script setup lang="ts">
import { ChevronDown, Navigation2, TriangleAlert } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// HudTarget (DESIGN §7, S05): where to go, how far, and the arrival being
// confirmed. Readable in two seconds: label, name, ETA and a big distance.
// The map is always north-up, so the arrow is simply the bearing.
const props = defineProps<{
  label: string;
  counter: string;
  name: string;
  sub: string;
  distance: { value: string; unit: string } | null;
  /** Degrees from north; null without a position. */
  bearing: number | null;
  /** 0..1 while confirming an arrival. */
  dwell: number;
  inZone: boolean;
  approaching: boolean;
  weakGps: boolean;
  paused: boolean;
  /** Free mode: the HUD opens the list to pick another target. */
  choosable: boolean;
}>();
defineEmits<{ choose: [] }>();
const { t } = useI18n();

// Ring around the arrow while the arrival is being confirmed.
const ring = computed(() => {
  const circumference = 2 * Math.PI * 26;
  return `${Math.min(1, props.dwell) * circumference} ${circumference}`;
});
</script>

<template>
  <component
    :is="choosable ? 'button' : 'div'"
    :type="choosable ? 'button' : undefined"
    class="hud"
    :class="{ 'is-approaching': approaching && !inZone, 'is-zone': inZone, 'is-paused': paused }"
    :aria-label="choosable ? t('run.hud.choose') : undefined"
    @click="choosable && $emit('choose')"
  >
    <div class="hud__row">
      <div class="hud__arrow" aria-hidden="true">
        <Navigation2
          v-if="bearing !== null"
          :size="36"
          :stroke-width="1.75"
          class="hud__needle"
          :style="{ transform: `rotate(${bearing}deg)` }"
        />
        <span v-else class="hud__cardinal">·</span>
        <svg v-if="dwell > 0" class="hud__ring" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="26" :stroke-dasharray="ring" />
        </svg>
      </div>
      <div class="hud__text">
        <p class="hud__label">
          <span class="hud__labeltext">{{ label }}</span>
          <span class="tabular">· {{ counter }}</span>
          <ChevronDown v-if="choosable" :size="14" :stroke-width="2.5" aria-hidden="true" />
        </p>
        <p class="hud__name">{{ name }}</p>
        <p class="hud__sub tabular">{{ sub }}</p>
      </div>
      <p v-if="distance" class="hud__distance tabular" aria-live="off">
        <span class="hud__value">{{ distance.value }}</span
        ><span class="hud__unit">{{ distance.unit }}</span>
      </p>
    </div>
    <p v-if="weakGps" class="hud__weak">
      <TriangleAlert :size="16" aria-hidden="true" />{{ t('run.gps.weak') }}
    </p>
  </component>
</template>

<style scoped>
.hud {
  display: block;
  width: 100%;
  overflow: hidden;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e2);
  text-align: left;
  transition: opacity var(--motion-slow);
}
:root[data-contrast='sol'] .hud {
  border-color: var(--color-text);
}
.hud.is-approaching {
  border-color: var(--color-accent);
  animation: pulse 2s ease-in-out infinite;
}
.hud.is-zone {
  border-color: var(--color-accent);
}
.hud.is-paused {
  opacity: 0.55;
}
.hud__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}
.hud__arrow {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.hud__needle {
  fill: currentColor;
  transition: transform var(--motion-base);
}
.hud__cardinal {
  font: 700 20px var(--font-ui);
}
.hud__ring {
  position: absolute;
  inset: 0;
  transform: rotate(-90deg);
}
.hud__ring circle {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dasharray var(--motion-base);
}
.hud__text {
  flex: 1;
  min-width: 0;
}
.hud__label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-accent);
  font: 600 13px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
/* Long labels ("MAIS PRÓXIMO") get an ellipsis; the counter stays (DESIGN §13). */
.hud__labeltext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hud__name {
  overflow: hidden;
  font: 600 17px/22px var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hud__sub {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.hud__distance {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 2px;
}
.hud__value {
  font: 700 34px/38px var(--font-ui);
  letter-spacing: -0.02em;
}
:root[data-contrast='sol'] .hud__value {
  font-size: 42px;
  line-height: 46px;
}
.hud__unit {
  font: 700 18px var(--font-ui);
}
.hud__weak {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font: 600 14px/18px var(--font-ui);
}
@keyframes pulse {
  50% {
    box-shadow:
      0 0 0 6px color-mix(in srgb, var(--color-accent) 25%, transparent),
      var(--shadow-e2);
  }
}
</style>
