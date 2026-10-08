<script setup lang="ts">
import { Check, CircleAlert, LoaderCircle, Sparkles, WifiOff, X } from '@lucide/vue';
import type { Interest, SuggestedPlace, SuggestPlacesResponse } from '@rumbo/api-contract';
import type { LatLng } from '@rumbo/geo-utils';
import type { Activity, Locale } from '@rumbo/route-spec';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from '../i18n/useFormat.ts';
import { AI_ERROR_MESSAGES, AiError, type AiErrorCode } from '../services/ai.ts';
import { suggestPlaces } from '../services/suggest.ts';
import AppButton from './AppButton.vue';
import ChipGroup from './ChipGroup.vue';
import InterestChips from './InterestChips.vue';
import { CATEGORY_ICONS } from './PlaceListItem.vue';
import SheetFrame from './SheetFrame.vue';

// "Sugerir lugares" (DESIGN C2, phase 7): the user says how long they have and
// what interests them, the AI picks real places around `near` (Wikipedia finds
// them, the model only chooses and says why to go), and the user keeps the
// ones they like. Teasers say why to go, never what you will learn: the cards
// keep that for the arrival. "Usar el título sugerido" is optional and asks
// the screen to rename the route. Nothing reaches the draft from here: the
// screen adds the places it is handed.

const props = defineProps<{
  near: LatLng;
  /** The route's language: teasers, title and summary are written in it. */
  locale: Locale;
  activity: Activity;
  /** The route's interests, which prefill the chips. */
  interests: Interest[];
  /** Wikidata ids of the places already in the route. */
  exclude: string[];
  /** How many more places fit in the route. */
  room: number;
}>();
const emit = defineEmits<{
  close: [];
  /** The interests the user asked with. */
  interests: [list: Interest[]];
  add: [places: SuggestedPlace[]];
  useTitle: [suggestion: { title: string; summary: string }];
}>();

type Phase = 'form' | 'loading' | 'results' | 'error';

/** The times offered, in minutes. */
const MINUTES = [30, 60, 120, 180, 240] as const;

const { t } = useI18n();
const format = useFormat();
const uid = useId();

const body = ref<HTMLElement | null>(null);
const phase = ref<Phase>('form');
const minutes = ref('120');
const picked = ref<Interest[]>([...props.interests]);
const result = shallowRef<SuggestPlacesResponse | null>(null);
const selected = ref<Set<string>>(new Set());
const errorCode = ref<AiErrorCode>('failed');
const titleApplied = ref(false);
let controller: AbortController | null = null;

const minuteOptions = computed(() =>
  MINUTES.map((value) => ({ value: String(value), label: format.limit(value) })),
);
const places = computed(() => result.value?.places ?? []);
const chosen = computed(() => places.value.filter((place) => selected.value.has(place.externalId)));
const full = computed(() => selected.value.size >= props.room);
const errorText = computed(() => t(AI_ERROR_MESSAGES[errorCode.value]));

async function submit(): Promise<void> {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  result.value = null;
  emit('interests', [...picked.value]);
  if (globalThis.navigator?.onLine === false) {
    errorCode.value = 'offline';
    phase.value = 'error';
    return;
  }
  phase.value = 'loading';
  try {
    const answer = await suggestPlaces(
      {
        near: props.near,
        locale: props.locale,
        interests: picked.value,
        minutes: Number(minutes.value),
        activity: props.activity,
        exclude: props.exclude.slice(0, 30),
      },
      current.signal,
    );
    if (controller !== current) return;
    result.value = answer;
    // All on, in the suggested order, as many as the route has room for.
    selected.value = new Set(answer.places.slice(0, props.room).map((place) => place.externalId));
    titleApplied.value = false;
    phase.value = 'results';
  } catch (error) {
    if (current.signal.aborted || controller !== current) return;
    errorCode.value = error instanceof AiError ? error.code : 'failed';
    phase.value = 'error';
  } finally {
    if (controller === current) controller = null;
  }
}

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else if (next.size < props.room) next.add(id);
  selected.value = next;
}

function applyTitle(): void {
  const suggestion = result.value;
  if (!suggestion || titleApplied.value) return;
  titleApplied.value = true;
  emit('useTitle', { title: suggestion.title, summary: suggestion.summary });
}

function add(): void {
  if (chosen.value.length > 0) emit('add', chosen.value);
}

// Each phase takes focus where its news is, so screen readers hear it.
watch(phase, async () => {
  await nextTick();
  body.value?.querySelector<HTMLElement>('[data-phase]')?.focus({ preventScroll: true });
});

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <SheetFrame :label="t('create.suggest.title')" @dismiss="emit('close')">
    <div class="suggest">
      <header class="suggest__head">
        <h2 class="t-h2 suggest__title" data-autofocus>
          <Sparkles :size="22" aria-hidden="true" />{{ t('create.suggest.title') }}
        </h2>
        <button
          type="button"
          class="suggest__close"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="22" aria-hidden="true" />
        </button>
      </header>

      <div ref="body" class="suggest__body">
        <template v-if="phase === 'form'">
          <p class="suggest__intro" tabindex="-1" data-phase>{{ t('create.suggest.intro') }}</p>
          <div class="suggest__group">
            <p class="suggest__label" aria-hidden="true">{{ t('create.suggest.time') }}</p>
            <ChipGroup
              v-model="minutes"
              :options="minuteOptions"
              :label="t('create.suggest.time')"
            />
          </div>
          <div class="suggest__group">
            <p class="suggest__label" aria-hidden="true">{{ t('create.suggest.interests') }}</p>
            <InterestChips v-model="picked" :label="t('create.suggest.interests')" />
          </div>
        </template>

        <div
          v-else-if="phase === 'loading'"
          class="suggest__state"
          role="status"
          tabindex="-1"
          data-phase
        >
          <LoaderCircle :size="28" class="suggest__spin" aria-hidden="true" />
          <p class="t-body-strong">{{ t('create.suggest.searching') }}</p>
          <p class="suggest__muted">{{ t('create.suggest.searchingHint') }}</p>
        </div>

        <div
          v-else-if="phase === 'error'"
          class="suggest__state suggest__state--error"
          role="alert"
          tabindex="-1"
          data-phase
        >
          <component
            :is="errorCode === 'offline' ? WifiOff : CircleAlert"
            :size="28"
            aria-hidden="true"
          />
          <p class="t-body-strong">{{ errorText }}</p>
        </div>

        <template v-else-if="result">
          <div v-if="places.length === 0" class="suggest__state" tabindex="-1" data-phase>
            <p class="t-body-strong">{{ t('create.suggest.empty') }}</p>
          </div>
          <template v-else>
            <section class="suggest__idea" :aria-label="t('create.suggest.ideaLabel')">
              <p class="suggest__kicker" tabindex="-1" data-phase>
                {{ t('create.suggest.ideaLabel') }}
              </p>
              <p class="t-title">{{ result.title }}</p>
              <p class="suggest__muted">{{ result.summary }}</p>
              <AppButton
                variant="secondary"
                size="s"
                class="suggest__use"
                :disabled="titleApplied"
                @click="applyTitle"
              >
                <template #icon
                  ><Check v-if="titleApplied" :size="18" aria-hidden="true"
                /></template>
                {{ titleApplied ? t('create.suggest.titleApplied') : t('create.suggest.useTitle') }}
              </AppButton>
              <p v-if="titleApplied" class="visually-hidden" role="status">
                {{ t('create.suggest.titleAppliedHint') }}
              </p>
            </section>

            <ul class="suggest__list" :aria-label="t('create.suggest.list')">
              <li v-for="(place, index) in places" :key="place.externalId">
                <label class="pick" :class="{ 'is-on': selected.has(place.externalId) }">
                  <input
                    class="pick__input"
                    type="checkbox"
                    :checked="selected.has(place.externalId)"
                    :disabled="!selected.has(place.externalId) && full"
                    :aria-labelledby="`${uid}-name-${index}`"
                    :aria-describedby="`${uid}-teaser-${index}`"
                    @change="toggle(place.externalId)"
                  />
                  <span class="pick__box" aria-hidden="true">
                    <Check :size="16" :stroke-width="3" />
                  </span>
                  <span class="pick__text">
                    <span :id="`${uid}-name-${index}`" class="pick__name">
                      <component
                        :is="CATEGORY_ICONS[place.category ?? 'other']"
                        :size="18"
                        aria-hidden="true"
                      />
                      <span>{{ place.name }}</span>
                    </span>
                    <span :id="`${uid}-teaser-${index}`" class="pick__teaser">{{
                      place.teaser
                    }}</span>
                    <span v-if="place.distanceMeters !== undefined" class="pick__distance tabular">
                      {{
                        t('create.search.distance', {
                          distance: format.distance(place.distanceMeters),
                        })
                      }}
                    </span>
                  </span>
                </label>
              </li>
            </ul>
            <p v-if="full && places.length > selected.size" class="suggest__muted">
              {{ t('create.suggest.full', { n: props.room }) }}
            </p>
          </template>
        </template>
      </div>

      <footer v-if="phase !== 'loading'" class="suggest__footer">
        <template v-if="phase === 'form'">
          <AppButton block @click="submit">{{ t('create.suggest.submit') }}</AppButton>
        </template>
        <template v-else-if="phase === 'error'">
          <AppButton variant="secondary" @click="phase = 'form'">{{
            t('create.suggest.change')
          }}</AppButton>
          <AppButton @click="submit">{{ t('common.retry') }}</AppButton>
        </template>
        <template v-else-if="phase === 'results'">
          <AppButton variant="secondary" @click="phase = 'form'">{{
            t('create.suggest.change')
          }}</AppButton>
          <AppButton :disabled="chosen.length === 0" @click="add">{{
            t('create.suggest.add', { n: chosen.length }, chosen.length)
          }}</AppButton>
        </template>
      </footer>
    </div>
  </SheetFrame>
</template>

<style scoped>
.suggest {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.suggest__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 4px var(--gutter);
}
.suggest__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.suggest__title svg {
  flex: none;
  color: var(--color-accent);
}
.suggest__close {
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
.suggest__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  padding: 8px var(--gutter) 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.suggest__intro,
.suggest__muted {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.suggest__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.suggest__label {
  font: 600 15px/20px var(--font-ui);
}
.suggest__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 220px;
  padding: 32px 16px;
  text-align: center;
}
.suggest__state--error {
  color: var(--color-warning);
}
.suggest__spin {
  color: var(--color-primary);
  animation: spin 0.8s linear infinite;
}
.suggest__idea {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.suggest__kicker {
  color: var(--color-accent);
  font: 700 12px/16px var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.suggest__use {
  margin-top: 6px;
}
.suggest__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.suggest__list li + li {
  border-top: 1px solid var(--color-border);
}
.pick {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 56px;
  padding: 12px 0;
  cursor: pointer;
}
.pick__input {
  position: absolute;
  top: 6px;
  left: -8px;
  width: 48px;
  height: 48px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.pick__box {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border: 2px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: transparent;
}
.pick.is-on .pick__box {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.pick__input:focus-visible + .pick__box {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}
.pick__input:disabled ~ .pick__text {
  opacity: 0.55;
}
.pick__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.pick__name {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font: 600 16px/22px var(--font-ui);
  overflow-wrap: anywhere;
}
.pick__name svg {
  flex: none;
  margin-top: 2px;
  color: var(--color-text-muted);
}
.pick__teaser {
  color: var(--color-text);
  font: 400 14px/20px var(--font-ui);
}
.pick__distance {
  color: var(--color-text-muted);
  font: 500 13px/18px var(--font-ui);
}
.suggest__footer {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.suggest__footer > * {
  flex: 1 1 auto;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
