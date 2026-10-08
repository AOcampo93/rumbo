<script setup lang="ts">
import { TriangleAlert, Trash2 } from '@lucide/vue';
import { DRAFT_LIMITS } from '@rumbo/route-builder';
import type { PointCategory } from '@rumbo/route-spec';
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import ChipGroup from './ChipGroup.vue';
import { CATEGORY_ICONS } from './PlaceListItem.vue';
import RangeSlider from './RangeSlider.vue';
import SheetFrame from './SheetFrame.vue';
import TextField from './TextField.vue';
import ToggleSwitch from './ToggleSwitch.vue';

// The creator's place editor (DESIGN C2; design ux-2): a non-modal sheet, so
// the map above stays visible and live while the radius slider redraws the
// place's circle. Nothing reaches the draft until Guardar / Añadir; Cancelar,
// Escape or swiping it down leave the place as it was.

export interface PlaceEditorValue {
  name: string;
  category: PointCategory;
  /** m. */
  radius: number;
  required: boolean;
}

/** Where the sheet's panel sits on screen, without its opening animation (CSS px). */
export interface SheetCover {
  top: number;
  left: number;
  right: number;
}

const model = defineModel<PlaceEditorValue>({ required: true });
const props = defineProps<{
  mode: 'new' | 'edit';
  /** Custom points pick their type; a place found in the search keeps its own. */
  categoryEditable: boolean;
  categories: readonly PointCategory[];
  /** Its zone overlaps another one (with the radius chosen right now). */
  overlap: boolean;
}>();
const emit = defineEmits<{ save: []; cancel: []; remove: []; cover: [cover: SheetCover] }>();
const { t } = useI18n();

const id = useId();
const form = ref<HTMLFormElement | null>(null);
const nameField = ref<InstanceType<typeof TextField> | null>(null);
const tried = ref(false);
let observer: ResizeObserver | null = null;

const title = computed(() =>
  t(props.mode === 'edit' ? 'create.places.editTitle' : 'create.places.newTitle'),
);
const nameError = computed(() =>
  tried.value && model.value.name.trim() === '' ? t('create.places.nameRequired') : null,
);
const categoryOptions = computed(() =>
  props.categories.map((value) => ({ value, label: t(`category.${value}`) })),
);

function patch(change: Partial<PlaceEditorValue>): void {
  model.value = { ...model.value, ...change };
}
const name = computed({
  get: () => model.value.name,
  set: (value: string) => patch({ name: value }),
});
const category = computed({
  get: () => model.value.category,
  set: (value: PointCategory) => patch({ category: value }),
});
const radius = computed({
  get: () => model.value.radius,
  set: (value: number) => patch({ radius: value }),
});
const required = computed({
  get: () => model.value.required,
  set: (value: boolean) => patch({ required: value }),
});

function submit(): void {
  tried.value = true;
  if (model.value.name.trim() === '') {
    nameField.value?.focus();
    return;
  }
  emit('save');
}

onMounted(() => {
  const panel = form.value?.closest<HTMLElement>('[role="dialog"]');
  if (!panel) return;
  // offsetTop ignores the rise animation's transform: where the panel ends up.
  const report = () => {
    const frame = panel.offsetParent?.getBoundingClientRect();
    const left = (frame?.left ?? 0) + panel.offsetLeft;
    emit('cover', {
      top: (frame?.top ?? 0) + panel.offsetTop,
      left,
      right: left + panel.offsetWidth,
    });
  };
  report();
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(report);
    observer.observe(panel);
  }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <SheetFrame :modal="false" :label="title" class="editor-sheet" @dismiss="emit('cancel')">
    <form ref="form" class="editor" novalidate @submit.prevent="submit">
      <div class="editor__scroll">
        <h2 class="t-h2">{{ title }}</h2>
        <TextField
          ref="nameField"
          v-model="name"
          :label="t('create.places.name')"
          :maxlength="DRAFT_LIMITS.nameMax"
          :error="nameError"
          required
          enterkeyhint="done"
        />
        <div v-if="categoryEditable" class="editor__group">
          <p class="editor__label" aria-hidden="true">{{ t('create.places.category') }}</p>
          <ChipGroup
            v-model="category"
            :options="categoryOptions"
            :label="t('create.places.category')"
          />
        </div>
        <div v-else class="editor__group">
          <p class="editor__label">{{ t('create.places.category') }}</p>
          <p class="editor__category">
            <component :is="CATEGORY_ICONS[category]" :size="18" aria-hidden="true" />
            {{ t(`category.${category}`) }}
          </p>
        </div>
        <RangeSlider
          v-model="radius"
          :label="t('create.places.radius')"
          :min="DRAFT_LIMITS.radius.min"
          :max="DRAFT_LIMITS.radius.max"
          :step="DRAFT_LIMITS.radius.step"
          :value-text="t('create.places.radiusValue', { m: radius })"
          :hint="t('create.places.radiusHint')"
        />
        <p v-if="overlap" class="editor__warning" role="status">
          <TriangleAlert :size="18" aria-hidden="true" />
          <span
            ><strong>{{ t('create.places.overlapRow') }}.</strong>
            {{ t('create.places.overlapHint') }}</span
          >
        </p>
        <div class="editor__toggle">
          <div class="editor__toggletext">
            <p class="editor__label">{{ t('create.places.required') }}</p>
            <p :id="`${id}-required`" class="editor__hint">{{ t('create.places.requiredHint') }}</p>
          </div>
          <ToggleSwitch
            v-model="required"
            :label="t('create.places.required')"
            :aria-describedby="`${id}-required`"
          />
        </div>
      </div>
      <footer class="editor__actions">
        <AppButton
          v-if="mode === 'edit'"
          variant="danger"
          size="m"
          class="editor__remove"
          @click="emit('remove')"
        >
          <template #icon><Trash2 :size="18" aria-hidden="true" /></template>
          {{ t('create.places.remove') }}
        </AppButton>
        <div class="editor__main">
          <AppButton variant="secondary" size="m" @click="emit('cancel')">{{
            t('common.cancel')
          }}</AppButton>
          <AppButton type="submit" size="m">{{
            mode === 'edit' ? t('create.places.save') : t('create.places.add')
          }}</AppButton>
        </div>
      </footer>
    </form>
  </SheetFrame>
</template>

<style scoped>
.editor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.editor__scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  padding: 4px var(--gutter) 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.editor__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.editor__label {
  font: 600 15px/20px var(--font-ui);
}
.editor__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.editor__category {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px 0 10px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  font: 600 14px/20px var(--font-ui);
}
.editor__warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
  font: 500 14px/20px var(--font-ui);
}
.editor__warning svg {
  flex: none;
  margin-top: 1px;
}
.editor__toggle {
  display: flex;
  align-items: center;
  gap: 16px;
}
.editor__toggletext {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.editor__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px var(--gutter) calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
}
.editor__remove {
  margin-left: -12px;
  padding: 0 12px;
}
.editor__main {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.editor__main > * {
  flex: 1 1 auto;
}
</style>
