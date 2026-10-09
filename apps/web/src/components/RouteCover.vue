<script lang="ts">
import {
  Building2,
  Church,
  Landmark,
  Palette,
  Sparkles,
  Trees,
  UtensilsCrossed,
} from '@lucide/vue';
import { INTERESTS, type Interest } from '@rumbo/api-contract';
import type { Component } from 'vue';

/** The icon of each interest's illustration: the theme a route without a photo wears. */
export const INTEREST_ICONS: Record<Interest, Component> = {
  history: Landmark,
  art: Palette,
  architecture: Building2,
  food: UtensilsCrossed,
  nature: Trees,
  religion: Church,
  curiosities: Sparkles,
};

/**
 * The interest whose illustration a route shows when it has no photo: the first
 * one in its list that the app has an illustration for. Whatever else a route's
 * `meta.interests` holds (a community route may carry any text) is ignored.
 */
export function coverInterest(interests: unknown): Interest | null {
  if (!Array.isArray(interests)) return null;
  const found = interests.find((value) => INTERESTS.includes(value as Interest));
  return (found as Interest | undefined) ?? null;
}
</script>

<script setup lang="ts">
import type { Locale, MediaRef } from '@rumbo/route-spec';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { localizedIn } from '../i18n/text.ts';

// RouteCover (DESIGN §7 RouteCard, phase 7.3, ADR 0005): the 16:9 face of a route. Its photo, if
// it has one (the user's own or one of its places'); else the illustration of its first interest
// (azulejo tiles with the theme's icon in a medallion, in the brand's colours: an image, the same
// in every theme); else the brand pattern. A photo that fails to load falls back the same way.
// The box is 16:9 whatever is in it, so nothing moves when a photo arrives. The illustration is
// decorative (aria-hidden): the text of the card stays its accessible name. Whatever goes in the
// slot (the card's badges) lies over the cover. `photoError` tells the screen that cares (the
// creator's preview) that the photo did not load and the stand-in is showing.
const props = defineProps<{
  /** The route's cover photo. Its alt text is in the route's language. */
  cover?: MediaRef | null | undefined;
  /** The route's first interest (coverInterest): its illustration shows when there is no photo. */
  interest?: Interest | null | undefined;
  /** The route's own language: the one its texts (the photo's alt) are written in. */
  locale: Locale;
}>();
const emit = defineEmits<{ photoError: [] }>();
const { locale: active } = useI18n();
const tileId = useId();

/** A photo that did not load is not shown again until the cover changes. */
const failed = ref(false);
watch(
  () => props.cover?.url,
  () => {
    failed.value = false;
  },
);
function onPhotoError(): void {
  failed.value = true;
  emit('photoError');
}

const photo = computed(() => (props.cover && !failed.value ? props.cover : null));
const illustrated = computed(() => (photo.value ? null : (props.interest ?? null)));
const kind = computed(() =>
  photo.value ? 'photo' : illustrated.value ? 'illustration' : 'pattern',
);
const alt = computed(() => localizedIn(photo.value?.alt, active.value as Locale, props.locale));
const icon = computed(() => (illustrated.value ? INTEREST_ICONS[illustrated.value] : null));
</script>

<template>
  <div
    class="cover"
    :class="[{ azulejo: kind === 'pattern' }, illustrated ? `cover--${illustrated}` : null]"
    :data-cover="kind"
    :data-interest="illustrated ?? undefined"
  >
    <img
      v-if="photo"
      class="cover__photo"
      :src="photo.url"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @error="onPhotoError"
    />
    <svg
      v-else-if="illustrated && icon"
      class="cover__art"
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <!-- One azulejo tile, repeated: a four-petal flower on a tinted tile, with a darker grout line. -->
        <pattern :id="`${tileId}-tile`" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" class="art-deep" />
          <rect x="1" y="1" width="38" height="38" rx="2" class="art-tint" />
          <g class="art-paper art-soft">
            <ellipse cx="20" cy="11.5" rx="3.6" ry="6.5" />
            <ellipse cx="20" cy="28.5" rx="3.6" ry="6.5" />
            <ellipse cx="11.5" cy="20" rx="6.5" ry="3.6" />
            <ellipse cx="28.5" cy="20" rx="6.5" ry="3.6" />
          </g>
          <circle cx="20" cy="20" r="2.6" class="art-deep" />
          <g class="art-paper art-soft">
            <circle cx="1" cy="1" r="2.6" />
            <circle cx="39" cy="1" r="2.6" />
            <circle cx="1" cy="39" r="2.6" />
            <circle cx="39" cy="39" r="2.6" />
          </g>
        </pattern>
      </defs>
      <rect width="320" height="180" :fill="`url(#${tileId}-tile)`" />
      <circle cx="160" cy="90" r="60" class="art-paper art-medal" />
      <circle cx="160" cy="90" r="54" class="art-ring" />
      <g transform="translate(124 54)" class="art-icon">
        <component :is="icon" :size="72" :stroke-width="1.6" aria-hidden="true" />
      </g>
    </svg>
    <slot />
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background-color: var(--color-surface-2);
}
.cover__photo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover__art {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
/* An illustration keeps its colours in every theme, like the azulejo pattern: each interest wears a
   colour of the palette (DESIGN §5.1) and a darker shade of it. */
.cover {
  --paper: #f7f3ec;
}
.cover--history {
  --tint: var(--route-3);
  --deep: #a33a12;
}
.cover--art {
  --tint: var(--route-4);
  --deep: #573a8a;
}
.cover--architecture {
  --tint: var(--route-1);
  --deep: #183f82;
}
.cover--food {
  --tint: #b07400;
  --deep: #8a5a00;
}
.cover--nature {
  --tint: var(--route-5);
  --deep: #136236;
}
.cover--religion {
  --tint: var(--route-2);
  --deep: #0b6b66;
}
.cover--curiosities {
  --tint: #3b4556;
  --deep: #262d3a;
}
.art-tint {
  fill: var(--tint);
}
.art-deep {
  fill: var(--deep);
}
.art-paper {
  fill: var(--paper);
}
.art-soft {
  fill-opacity: 0.62;
}
.art-medal {
  fill-opacity: 0.96;
}
.art-ring {
  fill: none;
  stroke: var(--tint);
  stroke-opacity: 0.55;
  stroke-width: 2;
}
.art-icon {
  color: var(--deep);
}
</style>
