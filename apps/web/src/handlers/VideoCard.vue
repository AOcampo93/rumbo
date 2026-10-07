<script setup lang="ts">
import { CirclePlay, VideoOff } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

// VideoCard (DESIGN §7): a YouTube video (privacy-enhanced domain, loaded only
// when played) or a video file, with "Video not available" when it fails.
const props = defineProps<{
  video: { provider: 'youtube' | 'file'; id?: string; url?: string; title?: string };
  title?: string;
}>();
const { t } = useI18n();
const playing = ref(false);
const failed = ref(false);

const youtubeId = computed(() =>
  props.video.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(props.video.id ?? '')
    ? props.video.id
    : null,
);
const thumbnail = computed(() =>
  youtubeId.value ? `https://i.ytimg.com/vi/${youtubeId.value}/hqdefault.jpg` : null,
);
const label = computed(() => props.title ?? props.video.title ?? t('video.label'));
</script>

<template>
  <div class="video">
    <p v-if="failed || (!youtubeId && !video.url)" class="video__error">
      <VideoOff :size="22" aria-hidden="true" />{{ t('video.unavailable') }}
    </p>
    <template v-else-if="youtubeId">
      <iframe
        v-if="playing"
        class="video__frame"
        :src="`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&cc_load_policy=1`"
        :title="label"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      />
      <button
        v-else
        type="button"
        class="video__poster"
        :aria-label="`${t('video.play')}: ${label}`"
        @click="playing = true"
      >
        <img v-if="thumbnail" :src="thumbnail" alt="" loading="lazy" @error="failed = true" />
        <CirclePlay :size="56" aria-hidden="true" class="video__play" />
      </button>
    </template>
    <video
      v-else
      class="video__frame"
      :src="video.url"
      controls
      playsinline
      preload="metadata"
      @error="failed = true"
    />
    <p class="video__title">{{ label }}</p>
  </div>
</template>

<style scoped>
.video {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.video__frame,
.video__poster {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: var(--radius-md);
  background: #000;
}
.video__poster {
  position: relative;
  overflow: hidden;
  padding: 0;
}
.video__poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.video__play {
  position: absolute;
  top: 50%;
  left: 50%;
  color: #fff;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
  transform: translate(-50%, -50%);
}
.video__title {
  font: 600 15px/20px var(--font-ui);
}
.video__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-muted);
  font: 600 15px var(--font-ui);
}
</style>
