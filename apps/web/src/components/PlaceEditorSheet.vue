<script setup lang="ts">
import {
  BellRing,
  Check,
  Circle,
  CircleCheck,
  CircleQuestionMark,
  ExternalLink,
  FileText,
  Plus,
  Sparkles,
  TriangleAlert,
  Trash2,
  Video,
  X,
} from '@lucide/vue';
import {
  ARRIVAL_TYPES,
  type ArrivalChoice,
  type ArrivalType,
  DRAFT_LIMITS,
  emptyArrival,
  parseYoutubeId,
  validateArrival,
} from '@rumbo/route-builder';
import { type PointCategory, USER_QUIZ_POINTS } from '@rumbo/route-spec';
import { type Component, computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
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
// Escape or swiping it down leave the place as it was. "Al llegar" picks what
// the place shows when the user arrives: its card, a plain sheet, a question
// of the user's own, a YouTube video, a link or just a notice; the fields of
// the chosen one follow the list, and a place with something missing there
// doesn't save (route-builder's validateArrival says what).

export interface PlaceEditorValue {
  name: string;
  category: PointCategory;
  /** m. */
  radius: number;
  required: boolean;
  /** What the place shows on arrival. */
  arrival: ArrivalChoice;
}

/** Where the sheet's panel sits on screen, without its opening animation (CSS px). */
export interface SheetCover {
  top: number;
  left: number;
  right: number;
}

type QuizChoice = Extract<ArrivalChoice, { type: 'quiz' }>;
type VideoChoice = Extract<ArrivalChoice, { type: 'video' }>;
type LinkChoice = Extract<ArrivalChoice, { type: 'link' }>;

const ARRIVAL_ICONS: Record<ArrivalType, Component> = {
  card: Sparkles,
  basic: FileText,
  quiz: CircleQuestionMark,
  video: Video,
  link: ExternalLink,
  check: BellRing,
};

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
const arrivalFields = ref<HTMLElement | null>(null);
const tried = ref(false);
/** The video and link fields complain once they have been left, not while the link is typed. */
const videoTouched = ref(false);
const linkTouched = ref(false);
let observer: ResizeObserver | null = null;

const limits = DRAFT_LIMITS.arrival;

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

// ---------------------------------------------------------------- Al llegar

const arrival = computed(() => model.value.arrival);
const quiz = computed<QuizChoice | null>(() =>
  arrival.value.type === 'quiz' ? arrival.value : null,
);
const video = computed<VideoChoice | null>(() =>
  arrival.value.type === 'video' ? arrival.value : null,
);
const link = computed<LinkChoice | null>(() =>
  arrival.value.type === 'link' ? arrival.value : null,
);

/** What was typed in each type before another was picked, so going back finds it again. */
const stash: Partial<Record<ArrivalType, ArrivalChoice>> = {};
/** The link or id as pasted: the arrival keeps only the id parsed from it. */
const videoText = ref(arrival.value.type === 'video' ? arrival.value.youtubeId : '');
const videoId = computed(() => parseYoutubeId(videoText.value));

function setArrival(next: ArrivalChoice): void {
  patch({ arrival: next });
}

async function chooseType(next: ArrivalType): Promise<void> {
  const current = arrival.value;
  if (current.type === next) return;
  stash[current.type] = current;
  const restored = stash[next] ?? emptyArrival(next);
  setArrival(
    restored.type === 'video' ? { ...restored, youtubeId: videoId.value ?? '' } : restored,
  );
  // The fields of the new choice appear below the list: bring them into view.
  await nextTick();
  arrivalFields.value?.scrollIntoView?.({ block: 'nearest' });
}

/** A copy of the quiz with a change; an empty explanation is no explanation. */
function patchQuiz(change: Partial<QuizChoice>): void {
  if (!quiz.value) return;
  const next: QuizChoice = { ...quiz.value, ...change };
  if (next.explanation === '') delete next.explanation;
  setArrival(next);
}
const question = computed({
  get: () => quiz.value?.question ?? '',
  set: (value: string) => patchQuiz({ question: value }),
});
const explanation = computed({
  get: () => quiz.value?.explanation ?? '',
  set: (value: string) => patchQuiz({ explanation: value }),
});

function setOption(index: number, text: string): void {
  if (!quiz.value) return;
  patchQuiz({ options: quiz.value.options.map((option, i) => (i === index ? text : option)) });
}

function setCorrect(index: number): void {
  patchQuiz({ correctIndex: index });
}

async function addOption(): Promise<void> {
  if (!quiz.value || quiz.value.options.length >= limits.options.max) return;
  patchQuiz({ options: [...quiz.value.options, ''] });
  await nextTick();
  const inputs = form.value?.querySelectorAll<HTMLInputElement>('.option input[type="text"]');
  inputs?.[inputs.length - 1]?.focus();
}

async function removeOption(index: number): Promise<void> {
  const current = quiz.value;
  if (!current || current.options.length <= limits.options.min) return;
  // The right answer stays right: it moves up with the ones after the removed one.
  const correctIndex =
    current.correctIndex === index
      ? 0
      : current.correctIndex > index
        ? current.correctIndex - 1
        : current.correctIndex;
  patchQuiz({ options: current.options.filter((_, i) => i !== index), correctIndex });
  await nextTick();
  const inputs = form.value?.querySelectorAll<HTMLInputElement>('.option input[type="text"]');
  inputs?.[Math.min(index, (inputs?.length ?? 1) - 1)]?.focus();
}

function patchVideo(change: Partial<VideoChoice>): void {
  if (!video.value) return;
  const next: VideoChoice = { ...video.value, ...change };
  if (next.title === '') delete next.title;
  setArrival(next);
}
const videoLink = computed({
  get: () => videoText.value,
  set: (text: string) => {
    videoText.value = text;
    patchVideo({ youtubeId: parseYoutubeId(text) ?? '' });
  },
});
const videoTitle = computed({
  get: () => video.value?.title ?? '',
  set: (value: string) => patchVideo({ title: value }),
});

function patchLink(change: Partial<LinkChoice>): void {
  if (link.value) setArrival({ ...link.value, ...change });
}
const linkUrl = computed({
  get: () => link.value?.url ?? '',
  set: (value: string) => patchLink({ url: value }),
});
const linkLabel = computed({
  get: () => link.value?.label ?? '',
  set: (value: string) => patchLink({ label: value }),
});

/** What is wrong with the choice, by route-builder's rules. */
const problems = computed(() => new Set(validateArrival(arrival.value)));
const questionError = computed(() => {
  if (!tried.value) return null;
  if (problems.value.has('arrival_question_required'))
    return t('create.arrival.quiz.questionRequired');
  return problems.value.has('arrival_question_too_long') ? t('create.arrival.tooLong') : null;
});
const optionErrors = computed(() =>
  (quiz.value?.options ?? []).map((option) =>
    tried.value && option.trim() === '' ? t('create.arrival.quiz.optionRequired') : null,
  ),
);
const videoError = computed(() => {
  if (!(tried.value || videoTouched.value) || !problems.value.has('arrival_video_invalid')) {
    return null;
  }
  return t(
    videoText.value.trim() === ''
      ? 'create.arrival.video.required'
      : 'create.arrival.video.invalid',
  );
});
const videoHint = computed(() =>
  videoId.value
    ? t('create.arrival.video.detected', { id: videoId.value })
    : t('create.arrival.video.linkHint'),
);
const linkUrlError = computed(() => {
  if (!(tried.value || linkTouched.value) || !problems.value.has('arrival_link_invalid')) {
    return null;
  }
  return t(
    linkUrl.value.trim() === ''
      ? 'create.arrival.link.urlRequired'
      : 'create.arrival.link.urlInvalid',
  );
});
const linkLabelError = computed(() => {
  if (!tried.value) return null;
  if (problems.value.has('arrival_link_label_required'))
    return t('create.arrival.link.labelRequired');
  return problems.value.has('arrival_link_label_too_long') ? t('create.arrival.tooLong') : null;
});
/** Something is wrong that no field above explains (it can't be typed, only loaded). */
const generalError = computed(() => {
  const shown = [
    questionError.value,
    videoError.value,
    linkUrlError.value,
    linkLabelError.value,
    ...optionErrors.value,
  ].some(Boolean);
  return tried.value && problems.value.size > 0 && !shown ? t('create.arrival.invalid') : null;
});

async function submit(): Promise<void> {
  tried.value = true;
  if (model.value.name.trim() === '') {
    nameField.value?.focus();
    return;
  }
  if (problems.value.size > 0) {
    await nextTick();
    form.value?.querySelector<HTMLElement>('.arrival [aria-invalid="true"]')?.focus();
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

        <fieldset class="arrival">
          <legend class="arrival__legend editor__label">{{ t('create.arrival.title') }}</legend>
          <div class="arrival__body">
            <div class="arrival__list">
              <label
                v-for="type in ARRIVAL_TYPES"
                :key="type"
                class="choice"
                :class="{ 'is-on': arrival.type === type }"
              >
                <input
                  class="choice__input"
                  type="radio"
                  :name="`${id}-arrival`"
                  :value="type"
                  :checked="arrival.type === type"
                  :aria-labelledby="`${id}-${type}-title`"
                  :aria-describedby="`${id}-${type}-help`"
                  @change="chooseType(type)"
                />
                <span class="choice__icon" aria-hidden="true">
                  <component :is="ARRIVAL_ICONS[type]" :size="20" />
                </span>
                <span class="choice__text">
                  <span :id="`${id}-${type}-title`" class="choice__title">{{
                    t(`create.arrival.types.${type}.title`)
                  }}</span>
                  <span :id="`${id}-${type}-help`" class="choice__help">{{
                    t(`create.arrival.types.${type}.help`)
                  }}</span>
                </span>
                <span class="choice__check" aria-hidden="true">
                  <Check :size="16" :stroke-width="3" />
                </span>
              </label>
            </div>

            <div v-if="quiz || video || link" ref="arrivalFields" class="arrival__fields">
              <template v-if="quiz">
                <p class="editor__hint">
                  {{ t('create.arrival.quiz.points', { points: USER_QUIZ_POINTS }) }}
                </p>
                <TextField
                  v-model="question"
                  :label="t('create.arrival.quiz.question')"
                  :placeholder="t('create.arrival.quiz.questionPlaceholder')"
                  :maxlength="limits.question"
                  :error="questionError"
                  required
                />
                <fieldset class="options">
                  <legend class="options__legend editor__label">
                    {{ t('create.arrival.quiz.options') }}
                  </legend>
                  <div class="options__body">
                    <p class="editor__hint">{{ t('create.arrival.quiz.optionsHint') }}</p>
                    <div v-for="(option, index) in quiz.options" :key="index" class="option">
                      <label class="option__correct">
                        <input
                          type="radio"
                          :name="`${id}-correct`"
                          :checked="quiz.correctIndex === index"
                          :aria-label="t('create.arrival.quiz.markCorrect', { n: index + 1 })"
                          @change="setCorrect(index)"
                        />
                        <CircleCheck
                          v-if="quiz.correctIndex === index"
                          :size="26"
                          aria-hidden="true"
                        />
                        <Circle v-else :size="26" aria-hidden="true" />
                      </label>
                      <TextField
                        :model-value="option"
                        :label="t('create.arrival.quiz.option', { n: index + 1 })"
                        :maxlength="limits.option"
                        :error="optionErrors[index] ?? null"
                        required
                        @update:model-value="(text: string) => setOption(index, text)"
                      />
                      <button
                        v-if="quiz.options.length > limits.options.min"
                        type="button"
                        class="option__remove"
                        :aria-label="t('create.arrival.quiz.removeOption', { n: index + 1 })"
                        @click="removeOption(index)"
                      >
                        <X :size="20" aria-hidden="true" />
                      </button>
                      <span v-else class="option__remove" aria-hidden="true" />
                    </div>
                    <AppButton
                      v-if="quiz.options.length < limits.options.max"
                      variant="secondary"
                      size="s"
                      class="options__add"
                      @click="addOption"
                    >
                      <template #icon><Plus :size="18" aria-hidden="true" /></template>
                      {{ t('create.arrival.quiz.addOption') }}
                    </AppButton>
                  </div>
                </fieldset>
                <TextField
                  v-model="explanation"
                  :label="t('create.arrival.quiz.explanation')"
                  :hint="t('create.arrival.quiz.explanationHint')"
                  :maxlength="limits.explanation"
                />
              </template>

              <template v-else-if="video">
                <TextField
                  v-model="videoLink"
                  :label="t('create.arrival.video.link')"
                  :placeholder="t('create.arrival.video.linkPlaceholder')"
                  :hint="videoHint"
                  :error="videoError"
                  required
                  @blur="videoTouched = true"
                />
                <TextField
                  v-model="videoTitle"
                  :label="t('create.arrival.video.title')"
                  :maxlength="limits.videoTitle"
                />
              </template>

              <template v-else-if="link">
                <TextField
                  v-model="linkUrl"
                  :label="t('create.arrival.link.url')"
                  placeholder="https://"
                  :hint="t('create.arrival.link.urlHint')"
                  :error="linkUrlError"
                  required
                  @blur="linkTouched = true"
                />
                <TextField
                  v-model="linkLabel"
                  :label="t('create.arrival.link.label')"
                  :placeholder="t('create.arrival.link.labelPlaceholder')"
                  :maxlength="limits.linkLabel"
                  :error="linkLabelError"
                  required
                />
              </template>
            </div>
            <p v-if="generalError" class="arrival__error" role="alert">{{ generalError }}</p>
          </div>
        </fieldset>
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
.arrival,
.options {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.arrival__legend,
.options__legend {
  margin-bottom: 8px;
  padding: 0;
}
.arrival__body,
.options__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.arrival__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* One radio per way to greet the user, laid over its row (like the mode cards):
   a tap anywhere picks it and the arrow keys move between them. */
.choice {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 56px;
  padding: 10px 12px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}
.choice__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.choice:has(.choice__input:focus-visible) {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
.choice__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--color-text-muted);
}
.choice__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.choice__title {
  font: 600 15px/20px var(--font-ui);
  overflow-wrap: anywhere;
}
.choice__help {
  color: var(--color-text-muted);
  font: 400 13px/18px var(--font-ui);
  overflow-wrap: anywhere;
}
.choice__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  color: transparent;
}
.choice.is-on {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  box-shadow: inset 0 0 0 1px var(--color-primary);
}
.choice.is-on .choice__icon {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.choice.is-on .choice__help {
  color: var(--color-text);
}
.choice.is-on .choice__check {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.arrival__fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 6px;
}
.option {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: end;
  gap: 4px;
}
/* The circle that marks the right answer: a native radio, unseen, over the icon. */
.option__correct {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  color: var(--color-text-muted);
  cursor: pointer;
}
.option__correct input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.option__correct:has(input:checked) {
  color: var(--color-success);
}
.option__correct:has(input:focus-visible) {
  outline: 3px solid var(--color-primary);
  outline-offset: -3px;
  border-radius: var(--radius-sm);
}
.option__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
}
.options__add {
  align-self: flex-start;
}
.arrival__error {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font: 600 14px/20px var(--font-ui);
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
