<script setup lang="ts">
import { CircleAlert, LoaderCircle, MapPinned, Search, WifiOff, X } from '@lucide/vue';
import type { GeoKind, GeoSuggestion } from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '../i18n/useFormat.ts';
import { GeoError, type GeoErrorCode, suggestPlaces } from '../services/geo.ts';
import { useOnline } from '../services/network.ts';
import { CATEGORY_ICONS } from './PlaceListItem.vue';

// PlaceSearch (DESIGN §7; design ux-3): a WAI-ARIA 1.2 combobox with a listbox
// popup. It searches 250 ms after the last keystroke, from 2 characters, and
// a newer query cancels the one in flight. The popup lives in <body> (fixed),
// so scrolling columns never clip it; it opens upward over the map when asked
// (`placement="up"`), or when the keyboard leaves no room below, and is never
// taller than 40 % of the screen. Focus stays in the input the whole time.
const props = withDefaults(
  defineProps<{
    kind?: GeoKind;
    label: string;
    /** The label is still there for assistive tech, just not on screen. */
    hideLabel?: boolean;
    hint?: string;
    placeholder?: string;
    /** Results near this position first; read when each search starts. */
    near?: () => LatLng | null;
    placement?: 'up' | 'down';
    disabled?: boolean;
    /** The suggestion being added: its option says `busyText` and the others wait. */
    busyKey?: string | null;
    busyText?: string;
    /** What to say offline (e.g. that the map still works). */
    offlineText?: string;
  }>(),
  {
    kind: 'place',
    hideLabel: false,
    hint: undefined,
    placeholder: undefined,
    near: undefined,
    placement: 'down',
    disabled: false,
    busyKey: null,
    busyText: undefined,
    offlineText: undefined,
  },
);
const emit = defineEmits<{ select: [suggestion: GeoSuggestion]; focus: []; blur: [] }>();

const { t } = useI18n();
const format = useFormat();
const online = useOnline();

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
/** Gap between the field and the popup, and the margin kept from the screen's edges. */
const GAP = 4;
const MARGIN = 8;

type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'offline';

const id = useId();
const inputId = `${id}-input`;
const labelId = `${id}-label`;
const listId = `${id}-list`;
const hintId = `${id}-hint`;

const field = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const query = ref('');
const status = ref<Status>('idle');
const results = shallowRef<GeoSuggestion[]>([]);
/** The query the current results answer (for "No encontramos «…»"). */
const answered = ref('');
const errorCode = ref<GeoErrorCode | null>(null);
const focused = ref(false);
const open = ref(false);
const active = ref(-1);
const panelStyle = ref<Record<string, string>>({});
const placedUp = ref(false);
/** What the polite live region says (result counts, errors). */
const announcement = ref('');

let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let frame = 0;

const trimmed = computed(() => query.value.trim());
const busy = computed(() => props.busyKey !== null);
const expanded = computed(() => open.value && results.value.length > 0);
const panelVisible = computed(() => open.value && status.value !== 'idle');
const activeId = computed(() =>
  expanded.value && active.value >= 0 ? optionId(active.value) : undefined,
);

const emptyText = computed(() =>
  t(props.kind === 'area' ? 'create.search.noAreas' : 'create.search.noResults', {
    q: answered.value,
  }),
);
const errorText = computed(() =>
  errorCode.value === 'rate_limited' ? t('errors.rateLimited') : t('create.search.error'),
);
const offlineMessage = computed(() => props.offlineText ?? t('create.search.offline'));

function optionId(index: number): string {
  return `${id}-option-${index}`;
}

function iconFor(suggestion: GeoSuggestion) {
  if (props.kind === 'area') return MapPinned;
  return CATEGORY_ICONS[suggestion.category ?? 'other'];
}

function say(text: string): void {
  // Emptied first, so the same words are announced again.
  announcement.value = '';
  void nextTick(() => {
    announcement.value = text;
  });
}

// ---------------------------------------------------------------- searching

function cancel(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  controller?.abort();
  controller = null;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  active.value = -1;
  if (trimmed.value.length < MIN_CHARS) {
    cancel();
    status.value = 'idle';
    results.value = [];
    open.value = false;
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    void search(trimmed.value);
  }, DEBOUNCE_MS);
}

async function search(q: string): Promise<void> {
  controller?.abort();
  open.value = focused.value;
  if (globalThis.navigator?.onLine === false) {
    controller = null;
    results.value = [];
    status.value = 'offline';
    say(offlineMessage.value);
    return;
  }
  const current = new AbortController();
  controller = current;
  status.value = 'loading';
  try {
    const found = await suggestPlaces(
      { q, kind: props.kind, near: props.near?.() ?? null },
      current.signal,
    );
    if (controller !== current) return;
    results.value = found;
    answered.value = q;
    active.value = -1;
    status.value = found.length > 0 ? 'results' : 'empty';
    say(
      found.length > 0
        ? t('create.search.results', { n: found.length }, found.length)
        : emptyText.value,
    );
  } catch (error) {
    // A newer query replaced this one: its AbortError is no news.
    if (current.signal.aborted || controller !== current) return;
    results.value = [];
    const code = error instanceof GeoError ? error.code : 'failed';
    errorCode.value = code;
    status.value = code === 'offline' ? 'offline' : 'error';
    say(code === 'offline' ? offlineMessage.value : errorText.value);
  } finally {
    if (controller === current) controller = null;
  }
}

// Back online with a query waiting: search it again.
watch(online, (isOnline) => {
  if (isOnline && status.value === 'offline' && trimmed.value.length >= MIN_CHARS) {
    void search(trimmed.value);
  }
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) clear();
  },
);

// ---------------------------------------------------------------- choosing

function choose(index: number): void {
  const suggestion = results.value[index];
  if (!suggestion || busy.value) return;
  active.value = index;
  emit('select', suggestion);
}

function close(): void {
  open.value = false;
  active.value = -1;
}

/** Empties the field and closes the popup (focus stays where it is). */
function clear(): void {
  cancel();
  query.value = '';
  results.value = [];
  status.value = 'idle';
  errorCode.value = null;
  close();
}

function focus(): void {
  input.value?.focus();
}

function onClearClick(): void {
  clear();
  focus();
}

function move(step: 1 | -1): void {
  const count = results.value.length;
  if (count === 0) return;
  if (!open.value) open.value = true;
  if (active.value < 0) active.value = step === 1 ? 0 : count - 1;
  else active.value = (active.value + step + count) % count;
  void nextTick(() => {
    document.getElementById(optionId(active.value))?.scrollIntoView({ block: 'nearest' });
  });
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (event.altKey) open.value = results.value.length > 0 || status.value !== 'idle';
      else move(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      move(-1);
      break;
    case 'Enter':
      if (expanded.value && active.value >= 0) {
        event.preventDefault();
        choose(active.value);
      } else if (trimmed.value.length >= MIN_CHARS) {
        // "Search" on the keyboard: no need to wait for the pause.
        event.preventDefault();
        if (timer) clearTimeout(timer);
        timer = null;
        void search(trimmed.value);
      }
      break;
    case 'Escape':
      if (panelVisible.value) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (query.value) {
        event.preventDefault();
        event.stopPropagation();
        clear();
      }
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Home':
    case 'End':
      // Back to editing the text.
      active.value = -1;
      break;
    case 'Tab':
      close();
      break;
  }
}

function onFocus(): void {
  focused.value = true;
  emit('focus');
  if (status.value !== 'idle' && trimmed.value.length >= MIN_CHARS) open.value = true;
}

function onBlur(): void {
  focused.value = false;
  close();
  emit('blur');
}

function onOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (!target || field.value?.contains(target) || panel.value?.contains(target)) return;
  close();
}

// ---------------------------------------------------------------- the popup's place

/** Fixed next to the field: below it, or above it ("up", or no room below with the keyboard up). */
function place(): void {
  const box = field.value;
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const below = bottom - rect.bottom - GAP - MARGIN;
  const above = rect.top - top - GAP - MARGIN;
  const preferUp = props.placement === 'up';
  const up = preferUp ? above >= 160 || above >= below : below < 160 && above > below;
  const cap = Math.round((viewport?.height ?? window.innerHeight) * 0.4);
  const room = Math.max(96, Math.min(cap, up ? above : below));
  placedUp.value = up;
  panelStyle.value = {
    left: `${Math.round(rect.left)}px`,
    width: `${Math.round(rect.width)}px`,
    maxHeight: `${Math.floor(room)}px`,
    top: `${Math.round(up ? rect.top - GAP : rect.bottom + GAP)}px`,
  };
}

/** While the popup is open, it follows the field (scrolling, the map shrinking, the keyboard). */
function follow(): void {
  place();
  frame = requestAnimationFrame(follow);
}

watch(panelVisible, (visible) => {
  if (visible) {
    place();
    if (!frame) frame = requestAnimationFrame(follow);
    document.addEventListener('pointerdown', onOutsidePointer, true);
  } else {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.removeEventListener('pointerdown', onOutsidePointer, true);
  }
});

onBeforeUnmount(() => {
  cancel();
  if (frame) cancelAnimationFrame(frame);
  document.removeEventListener('pointerdown', onOutsidePointer, true);
});

defineExpose({ focus, clear });
</script>

<template>
  <div class="search" :class="{ 'is-disabled': disabled }">
    <label
      :id="labelId"
      :for="inputId"
      class="search__label"
      :class="{ 'visually-hidden': hideLabel }"
      >{{ label }}</label
    >
    <div ref="field" class="search__field">
      <Search class="search__icon" :size="20" aria-hidden="true" />
      <input
        :id="inputId"
        ref="input"
        v-model="query"
        class="search__input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="expanded"
        :aria-controls="listId"
        :aria-activedescendant="activeId"
        :aria-describedby="hint ? hintId : undefined"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="search"
        maxlength="80"
        @input="schedule"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />
      <LoaderCircle
        v-if="status === 'loading'"
        class="search__spinner"
        :size="20"
        aria-hidden="true"
      />
      <button
        v-if="query && !disabled"
        type="button"
        class="search__clear"
        :aria-label="t('create.search.clear')"
        @mousedown.prevent
        @click="onClearClick"
      >
        <X :size="20" aria-hidden="true" />
      </button>
    </div>
    <p v-if="hint" :id="hintId" class="search__hint">{{ hint }}</p>
    <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>

    <Teleport to="body">
      <div
        v-show="panelVisible"
        ref="panel"
        class="search__panel"
        :class="{ 'search__panel--up': placedUp }"
        :style="panelStyle"
        @mousedown.prevent
      >
        <p v-if="status === 'loading'" class="search__status">
          <LoaderCircle class="search__spin" :size="18" aria-hidden="true" />{{
            t('create.search.searching')
          }}
        </p>
        <p v-else-if="status === 'empty'" class="search__status">{{ emptyText }}</p>
        <p v-else-if="status === 'offline'" class="search__status search__status--warning">
          <WifiOff :size="18" aria-hidden="true" />{{ offlineMessage }}
        </p>
        <p v-else-if="status === 'error'" class="search__status search__status--error">
          <CircleAlert :size="18" aria-hidden="true" />{{ errorText }}
        </p>
        <ul
          v-show="results.length > 0"
          :id="listId"
          class="search__list"
          role="listbox"
          :aria-labelledby="labelId"
          :aria-busy="status === 'loading' || busy || undefined"
        >
          <li
            v-for="(suggestion, index) in results"
            :id="optionId(index)"
            :key="suggestion.key"
            class="search__option"
            :class="{
              'is-active': index === active,
              'is-busy': suggestion.key === busyKey,
            }"
            role="option"
            :aria-selected="index === active"
            :aria-disabled="(busy && suggestion.key !== busyKey) || undefined"
            @click="choose(index)"
          >
            <span class="search__optionicon" aria-hidden="true">
              <LoaderCircle v-if="suggestion.key === busyKey" class="search__spin" :size="20" />
              <component :is="iconFor(suggestion)" v-else :size="20" />
            </span>
            <span class="search__text">
              <span class="search__name">{{
                suggestion.key === busyKey && busyText ? busyText : suggestion.name
              }}</span>
              <span
                v-if="suggestion.description || suggestion.distanceMeters !== undefined"
                class="search__desc"
              >
                <span v-if="suggestion.distanceMeters !== undefined" class="tabular">{{
                  t('create.search.distance', {
                    distance: format.distance(suggestion.distanceMeters),
                  })
                }}</span>
                <template v-if="suggestion.description && suggestion.distanceMeters !== undefined">
                  ·
                </template>
                {{ suggestion.description }}
              </span>
            </span>
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.search__label {
  font: 600 15px/20px var(--font-ui);
}
.search__field {
  position: relative;
  display: flex;
  align-items: center;
}
.search__icon {
  position: absolute;
  left: 14px;
  color: var(--color-text-muted);
  pointer-events: none;
}
.search__input {
  width: 100%;
  min-height: 52px;
  padding: 12px 52px 12px 46px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: 400 16px/24px var(--font-ui);
  text-overflow: ellipsis;
  transition: border-color var(--motion-fast);
}
.search__input::placeholder {
  color: var(--color-text-muted);
  opacity: 1;
}
.search__input:focus {
  border-color: var(--color-primary);
}
.search__input:disabled {
  background: var(--color-surface-2);
  cursor: not-allowed;
}
.search__spinner {
  position: absolute;
  right: 52px;
  color: var(--color-text-muted);
  animation: spin 0.8s linear infinite;
}
.search__clear {
  position: absolute;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
}
.search__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.search__panel {
  position: fixed;
  z-index: 64;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-e3);
}
/* Above the field: the popup's bottom edge sits on `top`. */
.search__panel--up {
  transform: translateY(-100%);
}
.search__status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  color: var(--color-text-muted);
  font: 500 14px/20px var(--font-ui);
}
.search__status svg {
  flex: none;
  margin-top: 1px;
}
.search__status--warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}
.search__status--error {
  color: var(--color-danger);
}
.search__list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}
.search__option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 56px;
  padding: 10px 14px;
  cursor: pointer;
}
.search__option:hover,
.search__option.is-active {
  background: var(--color-surface-2);
}
.search__option.is-active {
  box-shadow: inset 3px 0 0 var(--color-primary);
}
.search__option[aria-disabled='true'] {
  opacity: 0.5;
  cursor: default;
}
.search__optionicon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--color-text);
}
.search__option.is-active .search__optionicon,
.search__option:hover .search__optionicon {
  background: var(--color-surface);
}
.search__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.search__name {
  font: 600 16px/22px var(--font-ui);
  overflow-wrap: anywhere;
}
.search__desc {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.search__spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
