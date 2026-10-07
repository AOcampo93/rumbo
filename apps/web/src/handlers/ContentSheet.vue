<script setup lang="ts">
import { ExternalLink, Languages, Lightbulb, Sparkles } from '@lucide/vue';
import type { ViewOutcome } from '@rumbo/event-system';
import {
  type Locale,
  type LocalizedContent,
  type LocalizedText,
  type MediaRef,
  resolveContent,
} from '@rumbo/route-spec';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTexts } from '../i18n/text.ts';
import ArrivalKicker from './ArrivalKicker.vue';
import SheetFooter from './SheetFooter.vue';
import VideoCard from './VideoCard.vue';

// S06 · The place's card (info_sheet and ai_template). The card comes in every
// language it has; the active one is picked here, so switching the language
// with the card open updates it in place (ADR 0001).
const props = defineProps<{
  sourceLocale: Locale;
  name?: LocalizedText | null;
  order?: number | null;
  total?: number;
  title?: LocalizedText | null;
  body?: LocalizedText | null;
  image?: MediaRef | null;
  content?: LocalizedContent | null;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const { t, locale } = useI18n();
const texts = useTexts();

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
</script>

<template>
  <article class="sheet">
    <div class="sheet__scroll">
      <figure v-if="image" class="sheet__hero">
        <img :src="image.url" :alt="image.alt" />
        <figcaption v-if="credit">{{ t('arrival.credit', { credit }) }}</figcaption>
      </figure>
      <div class="sheet__body">
        <ArrivalKicker :order="order ?? null" :total="total ?? 0" />
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
    <SheetFooter
      @continue="emit('close', { status: 'done' })"
      @pause="emit('close', { status: 'done', decision: 'pause' })"
      @end="emit('close', { status: 'done', decision: 'cancel' })"
    />
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
</style>
