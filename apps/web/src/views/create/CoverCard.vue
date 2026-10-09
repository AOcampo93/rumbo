<script setup lang="ts">
import { CircleX, ImageOff, ImagePlus, Images } from '@lucide/vue';
import type { MediaRef } from '@rumbo/route-spec';
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from '../../components/AppButton.vue';
import CoverPhotosSheet from '../../components/CoverPhotosSheet.vue';
import RouteCover, { coverInterest } from '../../components/RouteCover.vue';
import { MediaError, scalePhoto, uploadPhoto } from '../../services/media.ts';
import { useCreatorStore } from '../../stores/creator.ts';

// The "Portada" card of C4 · Revisar (DESIGN C4, phase 7.3, ADR 0005): a 16:9
// preview of the cover the route will have (the user's photo, one of its
// places' photos, or the illustration that stands in when there is none) and
// the ways to change it. "Subir una foto" opens the phone's camera or library;
// the photo is scaled on the device and uploaded at once, and only then does it
// become the cover (the address goes in the draft; the route is saved later).
// "Elegir de tus lugares" offers the photos of the ready AI cards. A failure of
// any kind says what happened and leaves the draft as it was.

type UploadError = 'offline' | 'unsupported' | 'failed';

const { t } = useI18n();
const creator = useCreatorStore();
const titleId = useId();
const hintId = useId();

/** A photo is on its way: the screen keeps the route from being saved or tested until it is in. */
const busy = defineModel<boolean>('busy', { default: false });

const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const error = ref<UploadError | null>(null);
const choosing = ref(false);
/** What a screen reader hears after a change (the cover changed, it was removed). */
const announcement = ref('');
let upload: AbortController | null = null;

/** The preview's photo did not load (it is gone, or there is no connection): the stand-in shows. */
const photoFailed = ref(false);

const cover = computed(() => creator.coverImage);
watch(
  () => cover.value?.url,
  () => {
    photoFailed.value = false;
  },
);
const interest = computed(() => coverInterest(creator.draft?.interests));
const choices = computed(() => creator.coverChoices);
const locale = computed(() => creator.draft?.locale ?? 'es');

/** Under the preview: the credit of a place's photo, or why there is an illustration. */
const note = computed(() => {
  const current = cover.value;
  if (current && photoFailed.value) return t('create.review.cover.photoFailed');
  if (!current) {
    return interest.value
      ? t('create.review.cover.fallback')
      : t('create.review.cover.fallbackPattern');
  }
  const credit = [current.credit, current.license].filter(Boolean).join(' / ');
  return credit ? t('arrival.credit', { credit }) : '';
});

/** Offline there is no point in asking for a photo: say so before the picker opens. */
function pickFile(): void {
  if (uploading.value) return;
  announcement.value = '';
  if (globalThis.navigator?.onLine === false) {
    error.value = 'offline';
    return;
  }
  error.value = null;
  input.value?.click();
}

async function onFile(event: Event): Promise<void> {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  // Empty again, so picking the same photo a second time still fires `change`.
  field.value = '';
  if (file) await send(file);
}

function errorOf(failure: unknown): UploadError {
  if (!(failure instanceof MediaError)) {
    console.warn('create: the cover photo could not be sent', failure);
    return 'failed';
  }
  if (failure.code === 'offline' || failure.code === 'unsupported') return failure.code;
  // Too large, rate limited, unavailable… nothing the user can fix with this photo.
  return 'failed';
}

async function send(file: File): Promise<void> {
  upload?.abort();
  const current = new AbortController();
  upload = current;
  uploading.value = true;
  busy.value = true;
  error.value = null;
  announcement.value = '';
  try {
    if (globalThis.navigator?.onLine === false) throw new MediaError('offline');
    const photo = await scalePhoto(file);
    const stored = await uploadPhoto(photo, { signal: current.signal });
    if (current.signal.aborted) return;
    if (await creator.setCover({ type: 'own', url: stored.url })) {
      announcement.value = t('create.review.cover.updated');
    } else {
      error.value = 'failed';
    }
  } catch (failure) {
    if (current.signal.aborted) return;
    error.value = errorOf(failure);
  } finally {
    if (upload === current) {
      upload = null;
      uploading.value = false;
      busy.value = false;
    }
  }
}

async function choose(image: MediaRef): Promise<void> {
  choosing.value = false;
  error.value = null;
  if (await creator.setCover({ type: 'card', image })) {
    announcement.value = t('create.review.cover.updated');
  }
}

async function remove(): Promise<void> {
  error.value = null;
  await creator.setCover(null);
  announcement.value = t('create.review.cover.removed');
}

// Leaving the screen gives up an upload on its way (the server drops a photo no route uses).
onBeforeUnmount(() => upload?.abort());
</script>

<template>
  <section v-if="creator.draft" class="cover-card" :aria-labelledby="titleId">
    <h2 :id="titleId" class="cover-card__title">{{ t('create.review.cover.title') }}</h2>
    <RouteCover
      class="cover-card__preview"
      :cover="cover"
      :interest="interest"
      :locale="locale"
      @photo-error="photoFailed = true"
    />
    <p v-if="note" class="cover-card__note">{{ note }}</p>

    <div class="cover-card__actions">
      <AppButton variant="secondary" size="m" :loading="uploading" @click="pickFile">
        <template #icon><ImagePlus :size="20" aria-hidden="true" /></template>
        {{ uploading ? t('create.review.cover.uploading') : t('create.review.cover.upload') }}
      </AppButton>
      <AppButton
        variant="secondary"
        size="m"
        :disabled="uploading || choices.length === 0"
        :aria-describedby="choices.length === 0 ? hintId : undefined"
        @click="choosing = true"
      >
        <template #icon><Images :size="20" aria-hidden="true" /></template>
        {{ t('create.review.cover.choose') }}
      </AppButton>
      <AppButton
        v-if="cover"
        variant="danger"
        size="m"
        class="cover-card__remove"
        :disabled="uploading"
        @click="remove"
      >
        <template #icon><ImageOff :size="20" aria-hidden="true" /></template>
        {{ t('create.review.cover.remove') }}
      </AppButton>
    </div>
    <p v-if="choices.length === 0" :id="hintId" class="cover-card__hint">
      {{ t('create.review.cover.noPhotos') }}
    </p>

    <input
      ref="input"
      class="visually-hidden"
      type="file"
      accept="image/*"
      tabindex="-1"
      aria-hidden="true"
      @change="onFile"
    />
    <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    <p v-if="error" class="cover-card__error" role="alert">
      <CircleX :size="18" aria-hidden="true" />{{ t(`create.review.cover.errors.${error}`) }}
    </p>

    <CoverPhotosSheet
      v-if="choosing"
      :choices="choices"
      :current="cover?.url ?? null"
      :locale="locale"
      @close="choosing = false"
      @pick="choose"
    />
  </section>
</template>

<style scoped>
/* A card like the checklist and the publish switch: the cover of the route, and how to change it. */
.cover-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: var(--control-border) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.cover-card__title {
  font: 600 16px/22px var(--font-ui);
}
.cover-card__preview {
  width: 100%;
  max-width: 420px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.cover-card__note,
.cover-card__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.cover-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* The two ways to set a cover share a row when there is room, and stack on a phone. */
.cover-card__actions > * {
  flex: 1 1 14em;
}
/* Taking it away is quieter: just its width, under the others. */
.cover-card__actions > .cover-card__remove {
  flex: 0 0 auto;
}
.cover-card__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font: 600 14px/20px var(--font-ui);
}
.cover-card__error svg {
  flex: none;
  margin-top: 1px;
}
</style>
