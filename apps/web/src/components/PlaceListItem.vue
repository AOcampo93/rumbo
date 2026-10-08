<script lang="ts">
import {
  Binoculars,
  Castle,
  Church,
  CirclePlay,
  Drama,
  Flag,
  Landmark,
  MapPin,
  Trees,
  Utensils,
} from '@lucide/vue';
import type { PointCategory } from '@rumbo/route-spec';
import type { Component } from 'vue';

/** Category icons of DESIGN §5.3, as in the map markers. */
export const CATEGORY_ICONS: Record<PointCategory, Component> = {
  monument: Castle,
  museum: Landmark,
  church: Church,
  viewpoint: Binoculars,
  nature: Trees,
  food: Utensils,
  culture: Drama,
  checkpoint: Flag,
  start: CirclePlay,
  finish: Flag,
  other: MapPin,
};

export type PlaceAction = 'edit' | 'up' | 'down' | 'remove';
</script>

<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  CircleDashed,
  GripVertical,
  Pencil,
  TriangleAlert,
  Trash2,
} from '@lucide/vue';
import type { DraftPlace } from '@rumbo/route-builder';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import OverflowMenu, { type OverflowMenuItem } from './OverflowMenu.vue';

// A place of the creator's list (DESIGN §7 PointListItem, draggable variant;
// design ux-7). Line 1: drag handle · order · name (two lines at most) · menu.
// Line 2: the address, then chips (radius, optional, overlapping zone) that
// wrap, so the row survives 360 px and 200 % text. The handle is for pointers
// only: keyboard and screen-reader users move places with Subir / Bajar.
const props = defineProps<{
  place: DraftPlace;
  order: number;
  total: number;
  /** The radius in use (the place's own or the route's default), m. */
  radius: number;
  overlap: boolean;
}>();
const emit = defineEmits<{ action: [action: PlaceAction] }>();
const { t } = useI18n();

const menuWrap = ref<HTMLElement | null>(null);
const icon = computed(() => CATEGORY_ICONS[props.place.category ?? 'other']);
const items = computed<OverflowMenuItem[]>(() => [
  { id: 'edit', label: t('create.places.edit'), icon: Pencil },
  { id: 'up', label: t('create.places.moveUp'), icon: ArrowUp, disabled: props.order <= 1 },
  {
    id: 'down',
    label: t('create.places.moveDown'),
    icon: ArrowDown,
    disabled: props.order >= props.total,
  },
  { id: 'remove', label: t('create.places.remove'), icon: Trash2, danger: true },
]);

function onSelect(id: string): void {
  if (id === 'edit' || id === 'up' || id === 'down' || id === 'remove') emit('action', id);
}

/** Back to this row's menu button (after a move, the row's node was moved and lost focus). */
function focusMenu(): void {
  menuWrap.value?.querySelector<HTMLElement>('button')?.focus();
}

defineExpose({ focusMenu });
</script>

<template>
  <div class="place" :class="{ 'is-overlap': overlap }">
    <span class="place__handle" aria-hidden="true" :title="t('create.places.drag')">
      <GripVertical :size="20" />
    </span>
    <span class="place__badge tabular" aria-hidden="true">{{ order }}</span>
    <div class="place__body" @click="emit('action', 'edit')">
      <p class="place__title">
        <component :is="icon" class="place__category" :size="18" aria-hidden="true" />
        <span class="place__name">{{ place.name || '—' }}</span>
      </p>
      <p v-if="place.address" class="place__address">{{ place.address }}</p>
      <p class="place__chips">
        <span class="place__chip tabular">
          <CircleDashed :size="14" aria-hidden="true" />
          <span class="visually-hidden">{{ t('create.places.radius') }}:</span>
          {{ t('create.places.radiusValue', { m: radius }) }}
        </span>
        <span v-if="place.required === false" class="place__chip place__chip--optional">{{
          t('create.places.optional')
        }}</span>
        <span v-if="overlap" class="place__chip place__chip--warning">
          <TriangleAlert :size="14" aria-hidden="true" />{{ t('create.places.overlapRow') }}
        </span>
      </p>
    </div>
    <span ref="menuWrap" class="place__menu">
      <OverflowMenu
        :items="items"
        :label="t('create.places.menu', { name: place.name })"
        @select="onSelect"
      />
    </span>
  </div>
</template>

<style scoped>
.place {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 8px;
  padding: 6px 0;
  background: var(--color-surface);
}
.place__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  /* The hit area reaches into the gutter; the grip lines up with the text above. */
  margin-left: -14px;
  margin-right: -6px;
  color: var(--color-text-muted);
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.place__handle:active {
  cursor: grabbing;
}
.place__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2.15em;
  height: 2.15em;
  margin-top: 10px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: 700 13px/1 var(--font-ui);
}
.is-overlap .place__badge {
  box-shadow:
    0 0 0 2px var(--color-surface),
    0 0 0 4px var(--color-warning);
}
.place__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 13px 0 6px;
  cursor: pointer;
}
.place__title {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.place__category {
  flex: none;
  margin-top: 2px;
  color: var(--color-text-muted);
}
.place__name {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  font: 600 17px/22px var(--font-ui);
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.place__address {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.place__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.place__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 2px 8px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 13px/18px var(--font-ui);
}
.place__chip svg {
  flex: none;
  color: var(--color-text-muted);
}
.place__chip--optional {
  border-style: dashed;
  color: var(--color-text-muted);
}
.place__chip--warning {
  border-color: transparent;
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.place__chip--warning svg {
  color: currentColor;
}
.place__menu {
  display: flex;
  margin-right: -8px;
}
@media (max-width: 399px) {
  .place__category {
    display: none;
  }
}
</style>
