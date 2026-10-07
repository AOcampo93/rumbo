<script setup lang="ts">
import type { ViewOutcome } from '@rumbo/event-system';
import type { Locale, LocalizedText } from '@rumbo/route-spec';
import { useTexts } from '../i18n/text.ts';
import ArrivalKicker from './ArrivalKicker.vue';
import SheetFooter from './SheetFooter.vue';
import VideoCard from './VideoCard.vue';

// S06c · A video of the place.
const props = defineProps<{
  sourceLocale: Locale;
  name?: LocalizedText | null;
  order?: number | null;
  total?: number;
  provider: 'youtube' | 'file';
  id?: string;
  url?: string;
  title?: LocalizedText;
}>();
const emit = defineEmits<{ close: [outcome?: ViewOutcome] }>();
const texts = useTexts();
const video = {
  provider: props.provider,
  ...(props.id ? { id: props.id } : {}),
  ...(props.url ? { url: props.url } : {}),
};
</script>

<template>
  <article class="video-sheet">
    <div class="video-sheet__scroll">
      <ArrivalKicker :order="order ?? null" :total="total ?? 0" />
      <h1 class="t-h1" data-autofocus>{{ texts.text(name ?? '', sourceLocale) }}</h1>
      <VideoCard :video="video" :title="title ? texts.text(title, sourceLocale) : undefined" />
    </div>
    <SheetFooter
      @continue="emit('close', { status: 'done' })"
      @pause="emit('close', { status: 'done', decision: 'pause' })"
      @end="emit('close', { status: 'done', decision: 'cancel' })"
    />
  </article>
</template>

<style scoped>
.video-sheet {
  display: flex;
  flex-direction: column;
  max-height: calc(92dvh - 24px);
}
.video-sheet__scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px var(--gutter) 24px;
  overflow-y: auto;
}
</style>
