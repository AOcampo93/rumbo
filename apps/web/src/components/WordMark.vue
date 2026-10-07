<script setup lang="ts">
// Provisional wordmark (DESIGN §4.4): "rumbo" in Fraunces, the final "o" is a
// compass with a Terracota needle.
withDefaults(defineProps<{ size?: number }>(), { size: 30 });
</script>

<template>
  <span class="wordmark" role="img" aria-label="rumbo" :style="{ fontSize: `${size}px` }">
    <span aria-hidden="true">rumb</span>
    <span class="wordmark__o" aria-hidden="true"><span class="wordmark__needle" /></span>
  </span>
</template>

<style scoped>
.wordmark {
  display: inline-flex;
  align-items: flex-end;
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--color-text);
}
.wordmark__o {
  position: relative;
  display: inline-block;
  width: 0.58em;
  height: 0.58em;
  margin: 0 0 0.11em 0.03em;
  border: 0.11em solid currentColor;
  border-radius: 50%;
}
.wordmark__needle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0.083em;
  height: 0.36em;
  margin: -0.18em 0 0 -0.042em;
  background: var(--color-accent);
  border-radius: 0.04em;
  transform: rotate(40deg);
}
</style>
