<script setup lang="ts">
import { Check, Lock } from '@lucide/vue';

// PointListItem (DESIGN §7): order bubble in the state's colour, thumbnail,
// name and a secondary line. "Next" gets a Terracota bar on the left.
withDefaults(
  defineProps<{
    order: number;
    name: string;
    sub?: string;
    state?: 'active' | 'next' | 'locked' | 'reached' | 'completed';
    image?: string | null;
    interactive?: boolean;
  }>(),
  { sub: '', state: 'active', image: null, interactive: false },
);
defineEmits<{ select: [] }>();
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    class="item"
    :class="`item--${state}`"
    @click="interactive && $emit('select')"
  >
    <span class="item__bubble tabular" aria-hidden="true">
      <Lock v-if="state === 'locked'" :size="14" :stroke-width="2.5" />
      <Check v-else-if="state === 'completed'" :size="16" :stroke-width="3" />
      <template v-else>{{ order }}</template>
    </span>
    <span class="item__thumb" :class="{ azulejo: !image }">
      <img v-if="image" :src="image" alt="" loading="lazy" />
    </span>
    <span class="item__text">
      <span class="item__name">{{ name }}</span>
      <span v-if="sub" class="item__sub tabular">{{ sub }}</span>
    </span>
    <slot />
  </component>
</template>

<style scoped>
.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: none;
  color: var(--color-text);
  text-align: left;
}
.item--next::before {
  content: '';
  position: absolute;
  left: -16px;
  top: 8px;
  bottom: 8px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: var(--color-accent);
}
.item__bubble {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: 700 13px var(--font-ui);
}
.item--next .item__bubble,
.item--reached .item__bubble {
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.item--completed .item__bubble {
  background: var(--color-success);
  color: #fff;
}
.item--locked .item__bubble {
  background: var(--color-locked);
  color: #fff;
}
.item--locked .item__text {
  opacity: 0.6;
}
.item__thumb {
  flex: none;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background-size: 20px 20px;
}
.item__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.item__name {
  overflow: hidden;
  font: 600 17px/22px var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item__sub {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
</style>
