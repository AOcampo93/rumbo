<script setup lang="ts">
import { CircleCheck, CircleX, ExternalLink, Languages, Lightbulb, Sparkles } from '@lucide/vue';
import { CARD_QUIZ_POINTS, type ViewOutcome } from '@rumbo/event-system';
import {
  type Locale,
  type LocalizedContent,
  type LocalizedText,
  type MediaRef,
  resolveContent,
} from '@rumbo/route-spec';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import { useTexts } from '../i18n/text.ts';
import ArrivalKicker from './ArrivalKicker.vue';
import SheetFooter from './SheetFooter.vue';
import VideoCard from './VideoCard.vue';

// S06 · The place's card (info_sheet and ai_template). The card comes in every
// language it has; the active one is picked here, so switching the language
// with the card open updates it in place (ADR 0001). A card with a trivia
// question asks it after the tip; closing reports the answer (the handler
// scores it). `preview` is the creator's "Ver ficha": no arrival kicker, one
// Close button, and nothing reported.
const props = defineProps<{
  sourceLocale: Locale;
  name?: LocalizedText | null;
  order?: number | null;
  total?: number;
  title?: LocalizedText | null;
  body?: LocalizedText | null;
  image?: MediaRef | null;
  content?: LocalizedContent | null;
  preview?: boolean;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t, locale } = useI18n();
const texts = useTexts();
const questionId = useId();

const card = computed(() =>
  props.content ? resolveContent(props.content, locale.value as Locale, props.sourceLocale) : null,
);
const title = computed(
  () =>
    card.value?.content.title ?? texts.text(props.title ?? props.name ?? '', props.sourceLocale),
);
const image = computed(() => {
  const fromCard = card.value?.content.images[0];
  if (fromCard) return { ...fromCard, alt: texts.text(fromCard.alt, props.sourceLocale) };
  if (props.image) return { ...props.image, alt: texts.text(props.image.alt, props.sourceLocale) };
  return null;
});
const credit = computed(() =>
  [image.value?.credit, image.value?.license].filter(Boolean).join(' / '),
);
/** Markdown is shown as plain paragraphs: never HTML (content is data). */
const paragraphs = computed(() => {
  const text = card.value
    ? [card.value.content.summary, card.value.content.body ?? ''].join('\n\n')
    : texts.text(props.body ?? '', props.sourceLocale);
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[*_#>`]/g, '').trim())
    .filter(Boolean);
});
const languageName = computed(() => (card.value ? t(`lang.names.${card.value.locale}`) : ''));
const sources = computed(() => card.value?.content.sources ?? []);
const generatedByAi = computed(() => card.value?.content.generated?.by === 'ai');

// Trivia: one answer, then the options lock and the verdict shows. The answer
// belongs to the question it was given for, so another card (the language
// switched to one with its own question) starts unanswered.
const quiz = computed(() => card.value?.content.quiz ?? null);
const answer = ref<number | null>(null);
const result = ref<HTMLElement | null>(null);
watch(quiz, () => {
  answer.value = null;
});
const correct = computed(() => quiz.value !== null && answer.value === quiz.value.correctIndex);
const rightOption = computed(() => quiz.value?.options[quiz.value.correctIndex] ?? '');

async function choose(index: number): Promise<void> {
  if (answer.value !== null) return;
  answer.value = index;
  // The verdict grows the card below the fold: bring it into view.
  await nextTick();
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  result.value?.scrollIntoView?.({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}

function optionState(index: number): 'idle' | 'right' | 'wrong' | 'dim' {
  if (answer.value === null || !quiz.value) return 'idle';
  if (index === quiz.value.correctIndex) return 'right';
  return index === answer.value ? 'wrong' : 'dim';
}

/** The sheet's way out: the decision of the ⋯ menu, and the trivia answer with the language it was asked in. */
function finish(decision?: 'pause' | 'cancel'): void {
  const outcome: ViewOutcome = { status: 'done' };
  if (decision) outcome.decision = decision;
  if (answer.value !== null && card.value) {
    outcome.data = { answerIndex: answer.value, locale: card.value.locale };
  }
  emit('close', outcome);
}
</script>

<template>
  <article class="sheet">
    <div class="sheet__scroll">
      <figure v-if="image" class="sheet__hero">
        <img :src="image.url" :alt="image.alt" />
        <figcaption v-if="credit">{{ t('arrival.credit', { credit }) }}</figcaption>
      </figure>
      <div class="sheet__body">
        <ArrivalKicker v-if="!preview" :order="order ?? null" :total="total ?? 0" />
        <h1 class="t-h1" data-autofocus>{{ title }}</h1>
        <p v-if="card?.content.subtitle" class="t-body t-muted">{{ card.content.subtitle }}</p>
        <p v-if="card?.isFallback" class="sheet__fallback">
          <Languages :size="16" aria-hidden="true" />{{
            t('content.fallbackLanguage', { language: languageName })
          }}
        </p>
        <p v-for="(paragraph, index) in paragraphs" :key="index" class="t-body">{{ paragraph }}</p>

        <section v-if="card?.content.facts.length" class="sheet__section">
          <h2 class="t-h2">{{ t('arrival.facts') }}</h2>
          <ul class="sheet__facts">
            <li v-for="fact in card.content.facts" :key="fact">{{ fact }}</li>
          </ul>
        </section>

        <VideoCard v-if="card?.content.video" :video="card.content.video" />

        <aside v-if="card?.content.tip" class="sheet__tip">
          <Lightbulb :size="20" aria-hidden="true" />
          <div>
            <p class="t-caption">{{ t('arrival.tip') }}</p>
            <p class="t-body">{{ card.content.tip }}</p>
          </div>
        </aside>

        <section v-if="quiz" class="trivia">
          <div class="trivia__ask">
            <h2 class="t-h2">{{ t('arrival.trivia.title') }}</h2>
            <p :id="questionId" class="trivia__question">{{ quiz.question }}</p>
            <div class="trivia__options" role="group" :aria-labelledby="questionId">
              <button
                v-for="(option, index) in quiz.options"
                :key="index"
                type="button"
                class="trivia__option"
                :class="`is-${optionState(index)}`"
                :disabled="answer !== null"
                @click="choose(index)"
              >
                <span>{{ option }}</span>
                <CircleCheck v-if="optionState(index) === 'right'" :size="22" aria-hidden="true" />
                <CircleX v-else-if="optionState(index) === 'wrong'" :size="22" aria-hidden="true" />
              </button>
            </div>
          </div>
          <!-- Always in the page, so the verdict that appears in it is announced. -->
          <div ref="result" class="trivia__result" role="status" aria-live="polite">
            <template v-if="answer !== null">
              <p class="trivia__verdict" :class="correct ? 'is-right' : 'is-wrong'">
                {{
                  correct
                    ? t('arrival.trivia.correct', { points: CARD_QUIZ_POINTS })
                    : t('arrival.trivia.wrong', { answer: rightOption })
                }}
              </p>
              <p v-if="quiz.explanation" class="t-body">{{ quiz.explanation }}</p>
            </template>
          </div>
        </section>

        <section v-if="sources.length" class="sheet__sources">
          <h2 class="t-caption t-muted">{{ t('arrival.sources') }}</h2>
          <a
            v-for="source in sources"
            :key="source.url"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ source.title }}<ExternalLink :size="14" aria-hidden="true" />
          </a>
        </section>

        <p v-if="generatedByAi" class="sheet__ai">
          <Sparkles :size="14" aria-hidden="true" />
          {{
            t('arrival.aiBadge', { sources: sources.map((s) => s.title).join(', ') || 'Wikipedia' })
          }}
        </p>
      </div>
    </div>
    <footer v-if="preview" class="sheet__footer">
      <AppButton block @click="emit('close')">{{ t('common.close') }}</AppButton>
    </footer>
    <SheetFooter v-else @continue="finish()" @pause="finish('pause')" @end="finish('cancel')" />
  </article>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: calc(92dvh - 24px);
}
.sheet__scroll {
  flex: 1;
  overflow-y: auto;
}
.sheet__hero {
  position: relative;
  margin: 0;
  aspect-ratio: 16 / 9;
  background: var(--color-surface-2);
}
.sheet__hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.sheet__hero figcaption {
  position: absolute;
  right: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(22, 25, 29, 0.72);
  color: #fff;
  font: 600 11px/16px var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px var(--gutter) 24px;
}
.sheet__fallback {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  font: 500 14px/20px var(--font-ui);
}
.sheet__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.sheet__facts {
  margin: 0;
  padding-left: 20px;
}
.sheet__facts li {
  padding: 2px 0;
}
.sheet__facts li::marker {
  color: var(--color-accent);
}
.sheet__tip {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
}
.sheet__tip svg,
.sheet__tip .t-caption {
  color: var(--color-accent);
}
.trivia {
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.trivia__ask {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trivia__question {
  font: 600 17px/24px var(--font-ui);
  overflow-wrap: anywhere;
}
.trivia__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.trivia__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--control-m);
  padding: 10px 14px;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: 600 16px/22px var(--font-ui);
  text-align: left;
}
.trivia__option span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.trivia__option svg {
  flex: none;
}
.trivia__option:hover:not(:disabled) {
  border-color: var(--color-primary);
}
.trivia__option.is-right {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}
.trivia__option.is-right svg {
  color: var(--color-success);
}
.trivia__option.is-wrong {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
}
.trivia__option.is-wrong svg {
  color: var(--color-danger);
}
.trivia__option.is-dim {
  opacity: 0.6;
}
/* Empty until answered: its spacing comes from what it holds, not from a gap. */
.trivia__result {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.trivia__result > :first-child {
  margin-top: 12px;
}
.trivia__verdict {
  font: 700 16px/22px var(--font-ui);
}
.trivia__verdict.is-right {
  color: var(--color-success);
}
.trivia__verdict.is-wrong {
  color: var(--color-danger);
}
.sheet__sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sheet__sources a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 500 14px/20px var(--font-ui);
}
.sheet__ai {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font: 500 13px/18px var(--font-ui);
}
.sheet__footer {
  flex: none;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
</style>
