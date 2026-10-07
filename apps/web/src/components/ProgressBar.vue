<script setup lang="ts">
// ProgressBar (DESIGN §7): one segment per point in its state's colour, or a
// continuous bar past 15 points.
const props = defineProps<{
  segments: ReadonlyArray<'locked' | 'active' | 'next' | 'reached' | 'completed'>;
  percent: number;
  label: string;
}>();
const continuous = props.segments.length > 15;
</script>

<template>
  <div
    class="bar"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(percent)"
  >
    <div v-if="continuous" class="bar__track">
      <div class="bar__fill" :style="{ width: `${percent}%` }" />
    </div>
    <template v-else>
      <span
        v-for="(segment, index) in segments"
        :key="index"
        class="bar__seg"
        :class="`bar__seg--${segment}`"
      />
    </template>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  gap: 3px;
}
.bar__seg {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-surface-2);
}
.bar__seg--completed {
  background: var(--color-success);
}
.bar__seg--next,
.bar__seg--reached {
  background: var(--color-accent);
}
.bar__track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-surface-2);
}
.bar__fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-success);
  transition: width var(--motion-slow);
}
</style>
