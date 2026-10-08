<script lang="ts">
import type { Component } from 'vue';

/** One entry of an {@link OverflowMenu}. Disabled items stay focusable (WAI-ARIA menu pattern). */
export interface OverflowMenuItem {
  id: string;
  label: string;
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
import { Ellipsis } from '@lucide/vue';
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';

// "⋯" menu button (WAI-ARIA menu button pattern): a 48 × 48 trigger and a
// role=menu list teleported to <body> so scrolling lists and sheets never clip
// it. It opens below the trigger, or above when the viewport has no room.
// Roving focus with the arrows, Home/End and type-ahead; Enter/Space select;
// Escape, an outside click or a selection close it and focus the trigger.
// Attributes (class, data-testid…) go to the trigger, not the fragment.
defineOptions({ inheritAttrs: false });
const props = defineProps<{ items: ReadonlyArray<OverflowMenuItem>; label: string }>();
const emit = defineEmits<{ select: [id: string] }>();

const GAP = 4;
const MARGIN = 8;

const uid = useId();
const triggerId = `${uid}-trigger`;
const menuId = `${uid}-menu`;
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const placed = ref(false);
const placement = ref<'down' | 'up'>('down');
const position = ref<Record<string, string>>({});
const active = ref(0);

function itemButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

function focusItem(index: number): void {
  const count = props.items.length;
  if (count === 0) return;
  active.value = ((index % count) + count) % count;
  itemButtons()[active.value]?.focus();
}

/** Places the fixed menu next to the trigger: right edges aligned, flipped upward near the bottom. */
function place(): void {
  const button = trigger.value;
  const list = menu.value;
  if (!button || !list) return;
  const rect = button.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = list.offsetWidth;
  const height = list.scrollHeight;
  const below = viewportHeight - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;
  const up = height > below && above > below;
  let left = rect.right - width;
  if (left < MARGIN) left = Math.min(rect.left, viewportWidth - width - MARGIN);
  left = Math.max(MARGIN, left);
  placement.value = up ? 'up' : 'down';
  position.value = {
    left: `${Math.round(left)}px`,
    maxHeight: `${Math.max(120, Math.floor(up ? above : below))}px`,
    ...(up
      ? { bottom: `${Math.round(viewportHeight - rect.top + GAP)}px` }
      : { top: `${Math.round(rect.bottom + GAP)}px` }),
  };
}

async function show(focus: 'first' | 'last'): Promise<void> {
  if (props.items.length === 0) return;
  placed.value = false;
  open.value = true;
  await nextTick();
  place();
  placed.value = true;
  await nextTick();
  focusItem(focus === 'first' ? 0 : props.items.length - 1);
}

function close(returnFocus: boolean): void {
  if (!open.value) return;
  open.value = false;
  placed.value = false;
  if (returnFocus) trigger.value?.focus({ preventScroll: true });
}

function onTriggerClick(): void {
  if (open.value) close(true);
  else void show('first');
}

function onTriggerKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    void show(event.key === 'ArrowDown' ? 'first' : 'last');
  }
}

function choose(item: OverflowMenuItem): void {
  if (item.disabled) return;
  // Focus goes back to the trigger first, so a dialog opened by the handler
  // returns focus there when it closes.
  close(true);
  emit('select', item.id);
}

function typeAhead(key: string): void {
  const needle = key.toLocaleLowerCase();
  const count = props.items.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (active.value + step) % count;
    if (props.items[index]?.label.trim().toLocaleLowerCase().startsWith(needle)) {
      focusItem(index);
      return;
    }
  }
}

function onMenuKey(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusItem(active.value + 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusItem(active.value - 1);
      break;
    case 'Home':
    case 'PageUp':
      event.preventDefault();
      focusItem(0);
      break;
    case 'End':
    case 'PageDown':
      event.preventDefault();
      focusItem(props.items.length - 1);
      break;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      close(true);
      break;
    case 'Tab':
      // Focus moves to the trigger before the browser's default action, so
      // Tab / Shift+Tab continue from there in the page's tab order.
      close(true);
      break;
    default:
      if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey) {
        typeAhead(event.key);
      }
  }
}

function onOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (menu.value?.contains(target) || trigger.value?.contains(target)) return;
  close(true);
}

function onViewportChange(event?: Event): void {
  // Scrolling inside the menu itself never moves it.
  if (event?.target instanceof Node && menu.value?.contains(event.target)) return;
  place();
}

function listen(on: boolean): void {
  if (on) {
    document.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
  } else {
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
  }
}

watch(open, (isOpen) => listen(isOpen));
// An item list that empties while open (for example the row was removed) closes the menu.
watch(
  () => props.items.length,
  (count) => {
    if (count === 0) close(false);
    else if (active.value >= count) active.value = count - 1;
  },
);
onBeforeUnmount(() => listen(false));
</script>

<template>
  <button
    v-bind="$attrs"
    :id="triggerId"
    ref="trigger"
    type="button"
    class="overflow__trigger"
    :class="{ 'is-open': open }"
    :aria-label="label"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    @click="onTriggerClick"
    @keydown="onTriggerKey"
  >
    <Ellipsis :size="22" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <ul
      v-if="open"
      :id="menuId"
      ref="menu"
      class="overflow__menu"
      :class="[`overflow__menu--${placement}`, { 'is-placed': placed }]"
      role="menu"
      :aria-labelledby="triggerId"
      :style="position"
      @keydown="onMenuKey"
    >
      <li
        v-for="(item, index) in items"
        :key="item.id"
        role="none"
        :class="{ overflow__sep: item.danger && index > 0 && !items[index - 1]?.danger }"
      >
        <button
          type="button"
          role="menuitem"
          class="overflow__item"
          :class="{ 'is-danger': item.danger }"
          :tabindex="index === active ? 0 : -1"
          :aria-disabled="item.disabled || undefined"
          @click="choose(item)"
          @focus="active = index"
        >
          <component :is="item.icon" v-if="item.icon" :size="20" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
.overflow__trigger {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-m);
  height: var(--control-m);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text);
  transition: background-color var(--motion-fast);
}
.overflow__trigger:hover,
.overflow__trigger.is-open {
  background: var(--color-surface-2);
}
.overflow__menu {
  position: fixed;
  z-index: 65;
  min-width: 200px;
  max-width: min(320px, calc(100vw - 2 * 8px));
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e3);
  visibility: hidden;
}
.overflow__menu.is-placed {
  visibility: visible;
  animation: menu-in var(--motion-fast) ease-out;
}
.overflow__menu--down {
  transform-origin: top right;
}
.overflow__menu--up {
  transform-origin: bottom right;
}
.overflow__sep {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}
.overflow__item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--control-m);
  padding: 12px 16px;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: 600 16px/22px var(--font-ui);
  text-align: start;
  overflow-wrap: anywhere;
}
.overflow__item svg {
  flex: none;
  color: var(--color-text-muted);
}
.overflow__item:hover,
.overflow__item:focus-visible {
  background: var(--color-surface-2);
}
.overflow__item:focus-visible {
  outline-offset: -3px;
}
.overflow__item.is-danger,
.overflow__item.is-danger svg {
  color: var(--color-danger);
}
.overflow__item[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
</style>
