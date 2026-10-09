<script setup lang="ts">
import { Check, X } from '@lucide/vue';
import type { Locale, MediaRef } from '@rumbo/route-spec';
import { useI18n } from 'vue-i18n';
import { localizedIn } from '../i18n/text.ts';
import type { CoverChoice } from '../stores/creator.ts';
import SheetFrame from './SheetFrame.vue';

// "Elegir de tus lugares" (DESIGN C4, phase 7.3): the photos of the route's
// ready cards, each with the place it belongs to and its credit (Wikimedia's
// licences ask for it). Choosing one makes it the route's cover, exactly as the
// card has it; the screen sets it and closes the sheet. `current` is the
// address of the photo that is the cover now, if any.
const props = defineProps<{
  choices: CoverChoice[];
  current: string | null;
  /** The route's language: the one the photos' alt texts are written in. */
  locale: Locale;
}>();
const emit = defineEmits<{ close: []; pick: [image: MediaRef] }>();
const { t, locale: active } = useI18n();

const altOf = (image: MediaRef): string =>
  localizedIn(image.alt, active.value as Locale, props.locale);
const creditOf = (image: MediaRef): string =>
  [image.credit, image.license].filter(Boolean).join(' / ');
</script>

<template>
  <SheetFrame :label="t('create.review.cover.sheet.title')" @dismiss="emit('close')">
    <div class="photos">
      <header class="photos__head">
        <h2 class="t-h2 photos__title" data-autofocus>
          {{ t('create.review.cover.sheet.title') }}
        </h2>
        <button
          type="button"
          class="photos__close"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="22" aria-hidden="true" />
        </button>
      </header>
      <div class="photos__body">
        <p class="photos__intro">{{ t('create.review.cover.sheet.intro') }}</p>
        <ul class="photos__list" :aria-label="t('create.review.cover.sheet.title')">
          <li v-for="choice in choices" :key="choice.image.url">
            <button
              type="button"
              class="photo"
              :class="{ 'is-on': choice.image.url === current }"
              :aria-pressed="choice.image.url === current"
              @click="emit('pick', choice.image)"
            >
              <span class="photo__frame">
                <img :src="choice.image.url" :alt="altOf(choice.image)" loading="lazy" />
                <span v-if="choice.image.url === current" class="photo__check" aria-hidden="true">
                  <Check :size="16" :stroke-width="3" />
                </span>
              </span>
              <span class="photo__place">{{ choice.place }}</span>
              <span v-if="creditOf(choice.image)" class="photo__credit">{{
                t('arrival.credit', { credit: creditOf(choice.image) })
              }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </SheetFrame>
</template>

<style scoped>
.photos {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.photos__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 4px var(--gutter);
}
.photos__close {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
}
.photos__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  padding: 8px var(--gutter) calc(20px + var(--safe-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.photos__intro {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.photos__list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.photo {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text);
  text-align: left;
}
.photo__frame {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}
.photo.is-on .photo__frame {
  border-color: var(--color-primary);
}
.photo__frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo__check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.photo__place {
  font: 600 15px/20px var(--font-ui);
  overflow-wrap: anywhere;
}
.photo__credit {
  color: var(--color-text-muted);
  font: 400 13px/18px var(--font-ui);
  overflow-wrap: anywhere;
}
@media (min-width: 480px) {
  .photos__list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
