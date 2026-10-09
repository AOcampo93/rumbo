<script setup lang="ts">
import type { Activity } from '@rumbo/route-spec';
import { computed } from 'vue';
import { ACTIVITY_LOOKS, LINE_SWATCH_DASH, lineLook } from '../map/symbols.ts';

// A sample of how the Explore map draws the routes of an activity (its legend
// and the route card): the white casing under the coloured line, with its
// dashes. Decorative: the activity's name always goes next to it.
const props = defineProps<{ activity: Activity }>();

const look = computed(() => ACTIVITY_LOOKS[props.activity]);
const normal = lineLook();
const dash = computed(() => LINE_SWATCH_DASH[look.value.line]);
</script>

<template>
  <svg class="swatch" width="32" height="12" viewBox="0 0 32 12" aria-hidden="true">
    <line
      x1="4"
      y1="6"
      x2="28"
      y2="6"
      stroke="#fff"
      :stroke-opacity="normal.casingAlpha"
      :stroke-width="normal.casing"
      stroke-linecap="round"
    />
    <line
      x1="4"
      y1="6"
      x2="28"
      y2="6"
      :stroke="look.color"
      :stroke-width="normal.width"
      :stroke-dasharray="dash"
      :stroke-linecap="dash ? 'butt' : 'round'"
    />
  </svg>
</template>

<style scoped>
.swatch {
  flex: none;
}
</style>
