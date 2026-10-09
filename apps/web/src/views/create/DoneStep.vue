<script setup lang="ts">
import { CloudCheck, CloudUpload, Globe, Navigation, PartyPopper } from '@lucide/vue';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../../components/AppButton.vue';
import RouteCard from '../../components/RouteCard.vue';
import { useCatalogStore } from '../../stores/catalog.ts';
import { useCreatorStore } from '../../stores/creator.ts';
import { useRunStore } from '../../stores/run.ts';

// C5 · Lista (DESIGN C5): the saved route's card, whether it is already on
// the server (it updates by itself when the upload finishes), whether it is
// published for the community (or will be, once it is uploaded), "Iniciar
// ahora" (to its preparation) and "Ver mis rutas". When the route saved is the
// one a run is walking (the user edited it from the run), that run has already
// taken the changes: the main button takes the user back to it instead of
// starting another.

const { t } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const creator = useCreatorStore();
const run = useRunStore();

const route = computed(() => (creator.savedId ? catalog.byId(creator.savedId) : undefined));
const synced = computed(() => route.value?.mine?.sync === 'synced');
/** Saved for the community (phase 7.2). It only is public once the API has it. */
const published = computed(() => route.value?.mine?.published === true);
/** The run in progress is of this very route (a trial belongs to the draft, not to the route). */
const inRun = computed(
  () => creator.savedId !== null && run.active && !run.trial && run.routeId === creator.savedId,
);

// Saving left that run nothing to visit, so it finished: its summary is the next thing to see.
onMounted(() => {
  if (run.endedByEdit && run.routeId === creator.savedId) void router.replace({ name: 'summary' });
});

function start(): void {
  if (creator.savedId) void router.push({ name: 'prepare', params: { routeId: creator.savedId } });
}

function backToRun(): void {
  void router.push({ name: 'run' });
}
</script>

<template>
  <section class="done">
    <div class="done__body">
      <div class="done__hero">
        <span class="done__badge" aria-hidden="true"><PartyPopper :size="28" /></span>
        <h1 class="t-display">{{ t('create.done.title') }}</h1>
        <p class="done__status" :class="{ 'is-synced': synced }" role="status">
          <component :is="synced ? CloudCheck : CloudUpload" :size="18" aria-hidden="true" />
          <span>{{ synced ? t('create.done.synced') : t('create.done.local') }}</span>
        </p>
        <p v-if="published" class="done__status" :class="{ 'is-synced': synced }" role="status">
          <Globe :size="18" aria-hidden="true" />
          <span>{{ synced ? t('create.done.published') : t('create.done.publishPending') }}</span>
        </p>
        <p v-if="inRun" class="done__status">
          <Navigation :size="18" aria-hidden="true" />
          <span>{{ t('create.done.runUpdated') }}</span>
        </p>
      </div>
      <RouteCard
        v-if="route"
        :route="route"
        :downloaded="catalog.downloaded.has(route.id)"
        class="done__card"
      />
    </div>

    <footer class="done__footer">
      <div class="done__actions">
        <AppButton v-if="inRun" @click="backToRun">
          <template #icon><Navigation :size="20" aria-hidden="true" /></template>
          {{ t('create.done.backToRun') }}
        </AppButton>
        <AppButton v-else :disabled="!creator.savedId" @click="start">
          <template #icon><Navigation :size="20" aria-hidden="true" /></template>
          {{ t('create.done.start') }}
        </AppButton>
        <AppButton variant="secondary" @click="router.push({ name: 'my-routes' })">
          {{ t('create.done.myRoutes') }}
        </AppButton>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.done {
  display: flex;
  flex: 1;
  flex-direction: column;
}
.done__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 24px var(--gutter) 32px;
}
.done__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.done__badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-success-soft);
  color: var(--color-success);
}
.done__hero h1 {
  overflow-wrap: anywhere;
}
.done__status {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 36ch;
  color: var(--color-text-muted);
  font: 500 15px/22px var(--font-ui);
  text-align: left;
}
.done__status svg {
  flex: none;
  margin-top: 2px;
}
.done__status.is-synced {
  color: var(--color-success);
}
.done__footer {
  position: sticky;
  bottom: 0;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.done__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 560px;
  margin: 0 auto;
}
</style>
