<script setup lang="ts">
import { CircleCheck, CircleX } from '@lucide/vue';
import type { ViewOutcome } from '@rumbo/event-system';
import type { Locale, LocalizedText } from '@rumbo/route-spec';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTexts } from '../i18n/text.ts';
import ArrivalKicker from './ArrivalKicker.vue';
import SheetFooter from './SheetFooter.vue';

// S06b · Quiz: big options, then right/wrong with the explanation and points.
// The handler scores it from `data.answerIndex` (event-system quizHandler).
const props = defineProps<{
  sourceLocale: Locale;
  name?: LocalizedText | null;
  order?: number | null;
  total?: number;
  question: LocalizedText;
  options: LocalizedText[];
  correctIndex: number;
  points: number;
  explanation?: LocalizedText;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t } = useI18n();
const texts = useTexts();
const answer = ref<number | null>(null);

const correct = computed(() => answer.value === props.correctIndex);
const rightAnswer = computed(() =>
  texts.text(props.options[props.correctIndex] ?? '', props.sourceLocale),
);

function stateOf(index: number): 'idle' | 'right' | 'wrong' | 'dim' {
  if (answer.value === null) return 'idle';
  if (index === props.correctIndex) return 'right';
  return index === answer.value ? 'wrong' : 'dim';
}

function done(decision?: 'pause' | 'cancel'): void {
  const outcome: ViewOutcome =
    answer.value === null
      ? { status: 'dismissed' }
      : { status: 'done', data: { answerIndex: answer.value } };
  emit('close', decision ? { ...outcome, decision } : outcome);
}
</script>

<template>
  <article class="quiz">
    <div class="quiz__scroll">
      <ArrivalKicker :order="order ?? null" :total="total ?? 0" />
      <h1 class="t-h1" data-autofocus>{{ texts.text(name ?? '', sourceLocale) }}</h1>
      <p class="t-caption t-muted">{{ t('quiz.label', { points }) }}</p>
      <p class="quiz__question">{{ texts.text(question, sourceLocale) }}</p>
      <div class="quiz__options" role="radiogroup" :aria-label="texts.text(question, sourceLocale)">
        <button
          v-for="(option, index) in options"
          :key="index"
          type="button"
          role="radio"
          class="quiz__option"
          :class="`is-${stateOf(index)}`"
          :aria-checked="answer === index"
          :disabled="answer !== null"
          @click="answer = index"
        >
          <span>{{ texts.text(option, sourceLocale) }}</span>
          <CircleCheck v-if="stateOf(index) === 'right'" :size="22" aria-hidden="true" />
          <CircleX v-else-if="stateOf(index) === 'wrong'" :size="22" aria-hidden="true" />
        </button>
      </div>
      <div
        v-if="answer !== null"
        class="quiz__feedback"
        :class="correct ? 'is-right' : 'is-wrong'"
        role="status"
      >
        <p class="quiz__verdict">
          <strong>{{
            correct ? t('quiz.correct') : t('quiz.wrong', { answer: rightAnswer })
          }}</strong>
          <span v-if="correct" class="quiz__points">{{ t('quiz.points', { points }) }}</span>
        </p>
        <p v-if="explanation" class="t-body">{{ texts.text(explanation, sourceLocale) }}</p>
      </div>
    </div>
    <SheetFooter
      :disabled="answer === null"
      @continue="done()"
      @pause="done('pause')"
      @end="done('cancel')"
    />
  </article>
</template>

<style scoped>
.quiz {
  display: flex;
  flex-direction: column;
  max-height: calc(92dvh - 24px);
}
.quiz__scroll {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px var(--gutter) 24px;
  overflow-y: auto;
}
.quiz__question {
  font: 700 20px/26px var(--font-ui);
}
.quiz__options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}
.quiz__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 0 16px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 17px/22px var(--font-ui);
  text-align: left;
}
.quiz__option:disabled {
  cursor: default;
}
.quiz__option.is-right {
  border-color: var(--color-success);
  background: var(--color-success-soft);
  color: var(--color-text);
}
.quiz__option.is-right svg {
  color: var(--color-success);
}
.quiz__option.is-wrong {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
}
.quiz__option.is-wrong svg {
  color: var(--color-danger);
}
.quiz__option.is-dim {
  opacity: 0.6;
}
.quiz__feedback {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.quiz__verdict {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font: 700 17px/22px var(--font-ui);
}
.is-right .quiz__verdict strong {
  color: var(--color-success);
}
.is-wrong .quiz__verdict strong {
  color: var(--color-danger);
}
.quiz__points {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-success);
  color: #fff;
  font: 700 13px/20px var(--font-ui);
}
</style>
