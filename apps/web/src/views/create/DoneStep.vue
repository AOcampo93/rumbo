<script setup lang="ts">
import { CloudCheck, CloudUpload, Navigation, PartyPopper } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppButton from '../../components/AppButton.vue';
import RouteCard from '../../components/RouteCard.vue';
import { useCatalogStore } from '../../stores/catalog.ts';
import { useCreatorStore } from '../../stores/creator.ts';

// C5 · Lista (DESIGN C5): the saved route's card, whether it is already on
// the server (it updates by itself when the upload finishes), "Iniciar ahora"
// (to its preparation) and "Ver mis rutas".

const { t } = useI18n();
const router = useRouter();
const catalog = useCatalogStore();
const creator = useCreatorStore();

const route = computed(() => (creator.savedId ? catalog.byId(creator.savedId) : undefined));
const synced = computed(() => route.value?.mine?.sync === 'synced');

function start(): void {
  if (creator.savedId) void router.push({ name: 'prepare', params: { routeId: creator.savedId } });
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
        <AppButton :disabled="!creator.savedId" @click="start">
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
