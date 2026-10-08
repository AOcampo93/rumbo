<script setup lang="ts">
import {
  Activity as RunIcon,
  Bike,
  CircleAlert,
  Footprints,
  Languages,
  LocateFixed,
  MapPinned,
  X,
} from '@lucide/vue';
import type { GeoSuggestion, Interest } from '@rumbo/api-contract';
import { DRAFT_LIMITS, TIME_LIMIT_PRESETS } from '@rumbo/route-builder';
import type { Activity, RouteMode } from '@rumbo/route-spec';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../../components/AppButton.vue';
import ChipGroup from '../../components/ChipGroup.vue';
import InterestChips from '../../components/InterestChips.vue';
import ModeCards from '../../components/ModeCards.vue';
import PlaceSearch from '../../components/PlaceSearch.vue';
import SegmentedControl from '../../components/SegmentedControl.vue';
import TextField from '../../components/TextField.vue';
import { useFormat } from '../../i18n/useFormat.ts';
import { track } from '../../services/analytics.ts';
import { useCreatorStore } from '../../stores/creator.ts';

// C1 · Datos: the route's name, its city or area (it centres the map and the
// place search of the next step; "Usar mi ubicación" takes it from the
// device), the mode, the activity and, for a challenge, the time limit, plus
// what the AI guide needs: the interests and the language its cards will be
// written in (the route's own, never asked). The name is checked when it
// loses focus and on "Siguiente".

const { t } = useI18n();
const router = useRouter();
const creator = useCreatorStore();
const format = useFormat();

type LocateState = 'idle' | 'locating' | 'denied' | 'failed';

const nameField = ref<InstanceType<typeof TextField> | null>(null);
const areaChip = ref<HTMLElement | null>(null);
const areaSearch = ref<InstanceType<typeof PlaceSearch> | null>(null);
const touched = ref(false);
const locateState = ref<LocateState>('idle');
/** Without a geolocation API (or in a context that forbids it) the button isn't offered. */
const canLocate = globalThis.navigator?.geolocation !== undefined;

const draft = computed(() => creator.draft);

const name = computed({
  get: () => draft.value?.name ?? '',
  set: (value: string) => void creator.update({ name: value }),
});
const mode = computed({
  get: (): RouteMode => draft.value?.mode ?? 'free',
  set: (value: RouteMode) => void creator.update({ mode: value }),
});
const activity = computed({
  get: (): Activity => draft.value?.activity ?? 'walk',
  set: (value: Activity) => void creator.update({ activity: value }),
});
const interests = computed({
  get: (): Interest[] => draft.value?.interests ?? [],
  set: (value: Interest[]) => void creator.update({ interests: value }),
});
/** The route's language, which is the one the cards are written in. */
const cardsLanguage = computed(() =>
  t('create.details.cardsLanguage', {
    language: t(`create.details.languageNames.${draft.value?.locale ?? 'es'}`),
  }),
);
const timeLimit = computed({
  get: () => {
    const minutes = draft.value?.timeLimitMinutes ?? null;
    return minutes === null ? 'none' : String(minutes);
  },
  set: (value: string) =>
    void creator.update({ timeLimitMinutes: value === 'none' ? null : Number(value) }),
});

const activityOptions = computed(() => [
  { value: 'walk' as Activity, label: t('activity.walk'), icon: Footprints },
  { value: 'run' as Activity, label: t('activity.run'), icon: RunIcon },
  { value: 'bike' as Activity, label: t('activity.bike'), icon: Bike },
]);
const limitOptions = computed(() => {
  const presets: number[] = [...TIME_LIMIT_PRESETS];
  // An edited route may have a limit of its own.
  const current = draft.value?.timeLimitMinutes;
  if (current && !presets.includes(current)) presets.push(current);
  presets.sort((a, b) => a - b);
  return [
    { value: 'none', label: t('create.details.noLimit') },
    ...presets.map((minutes) => ({ value: String(minutes), label: format.limit(minutes) })),
  ];
});

const nameError = computed(() => {
  if (!touched.value) return null;
  const issue = creator.stepIssues('details').find((item) => item.field === 'name');
  return issue?.code === 'name_required' ? t('create.details.nameRequired') : null;
});

async function chooseArea(suggestion: GeoSuggestion): Promise<void> {
  await creator.update({ area: { name: suggestion.name, position: suggestion.position } });
  await nextTick();
  areaChip.value?.focus();
}

/** About 110 m: the area only has to centre the map and the search. */
const round3 = (value: number): number => Math.round(value * 1000) / 1000 || 0;

/** "Usar mi ubicación": the device's position, once, as the area. Nothing is asked until the tap. */
function locateMe(): void {
  if (locateState.value === 'locating') return;
  locateState.value = 'locating';
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      locateState.value = 'idle';
      await creator.update({
        area: {
          name: t('create.details.locationName'),
          position: { lat: round3(coords.latitude), lng: round3(coords.longitude) },
        },
      });
      await nextTick();
      areaChip.value?.focus();
    },
    (error) => {
      locateState.value = error.code === error.PERMISSION_DENIED ? 'denied' : 'failed';
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
  );
}

async function clearArea(): Promise<void> {
  await creator.update({ area: null });
  await nextTick();
  areaSearch.value?.focus();
}

async function next(): Promise<void> {
  touched.value = true;
  if (creator.stepIssues('details').length > 0) {
    nameField.value?.focus();
    return;
  }
  track('creator_step_completed', { step: 'details' });
  await router.push({ name: 'create-places' });
}

onMounted(() => {
  // Warm the map for the next step while the user types (offline it would only fail).
  if (globalThis.navigator?.onLine === false) return;
  const idle = globalThis.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  idle(() => void import('../../map/RouteMap.vue').catch(() => {}));
});
</script>

<template>
  <section v-if="draft" class="details">
    <div class="details__body">
      <h1 class="t-h1">{{ t('create.steps.details') }}</h1>

      <TextField
        ref="nameField"
        v-model="name"
        :label="t('create.details.name')"
        :placeholder="t('create.details.namePlaceholder')"
        :maxlength="DRAFT_LIMITS.nameMax"
        :error="nameError"
        counter
        required
        enterkeyhint="next"
        @blur="touched = true"
      />

      <div class="details__group">
        <template v-if="draft.area">
          <p class="details__label">{{ t('create.details.area') }}</p>
          <div class="details__area">
            <span ref="areaChip" class="details__areaname" tabindex="-1">
              <MapPinned :size="18" aria-hidden="true" />{{ draft.area.name }}
            </span>
            <button
              type="button"
              class="details__areaclear"
              :aria-label="t('create.details.areaClear')"
              @click="clearArea"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </div>
          <p class="details__hint">{{ t('create.details.areaHint') }}</p>
        </template>
        <template v-else>
          <PlaceSearch
            ref="areaSearch"
            kind="area"
            :label="t('create.details.area')"
            :placeholder="t('create.details.areaPlaceholder')"
            :hint="t('create.details.areaHint')"
            @select="chooseArea"
          />
          <template v-if="canLocate">
            <AppButton
              variant="secondary"
              size="m"
              class="details__locate"
              :loading="locateState === 'locating'"
              @click="locateMe"
            >
              <template #icon><LocateFixed :size="20" aria-hidden="true" /></template>
              {{
                locateState === 'locating'
                  ? t('create.details.locating')
                  : t('create.details.myLocation')
              }}
            </AppButton>
            <p
              v-if="locateState === 'denied' || locateState === 'failed'"
              class="details__problem"
              role="status"
            >
              <CircleAlert :size="16" aria-hidden="true" />
              {{
                locateState === 'denied'
                  ? t('create.details.locationDenied')
                  : t('create.details.locationFailed')
              }}
            </p>
          </template>
        </template>
      </div>

      <ModeCards v-model="mode" :label="t('create.details.mode')" />

      <div class="details__group">
        <p class="details__label" aria-hidden="true">{{ t('create.details.activity') }}</p>
        <SegmentedControl
          v-model="activity"
          :options="activityOptions"
          :label="t('create.details.activity')"
        />
      </div>

      <div v-if="mode === 'challenge'" class="details__group">
        <p class="details__label" aria-hidden="true">{{ t('create.details.timeLimit') }}</p>
        <ChipGroup
          v-model="timeLimit"
          :options="limitOptions"
          :label="t('create.details.timeLimit')"
        />
      </div>

      <div class="details__group">
        <p class="details__label" aria-hidden="true">{{ t('create.details.interests') }}</p>
        <InterestChips v-model="interests" :label="t('create.details.interests')" />
        <p class="details__hint">{{ t('create.details.interestsHint') }}</p>
        <p class="details__language">
          <Languages :size="18" aria-hidden="true" />
          <span>{{ cardsLanguage }}</span>
        </p>
      </div>
    </div>

    <footer class="details__footer">
      <div class="details__footerin">
        <AppButton block @click="next">{{ t('create.next') }}</AppButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.details {
  display: flex;
  flex: 1;
  flex-direction: column;
}
.details__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 20px var(--gutter) 32px;
}
.details__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.details__label {
  font: 600 15px/20px var(--font-ui);
}
.details__hint {
  color: var(--color-text-muted);
  font: 400 14px/20px var(--font-ui);
}
.details__locate {
  align-self: flex-start;
}
.details__problem {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-warning);
  font: 500 14px/20px var(--font-ui);
}
.details__problem svg {
  flex: none;
  margin-top: 2px;
}
.details__language {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font: 500 14px/20px var(--font-ui);
}
.details__language svg {
  flex: none;
  margin-top: 1px;
  color: var(--color-primary);
}
.details__area {
  display: flex;
  align-items: center;
  align-self: flex-start;
  max-width: 100%;
  min-height: 48px;
  padding-left: 14px;
  border: var(--control-border) solid var(--color-primary);
  border-radius: var(--radius-pill);
  background: var(--color-surface);
}
.details__areaname {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font: 600 16px/22px var(--font-ui);
  overflow-wrap: anywhere;
}
.details__areaname svg {
  flex: none;
  color: var(--color-accent);
}
.details__areaclear {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 46px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
}
.details__footer {
  position: sticky;
  bottom: 0;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.details__footerin {
  max-width: 640px;
  margin: 0 auto;
}
</style>
