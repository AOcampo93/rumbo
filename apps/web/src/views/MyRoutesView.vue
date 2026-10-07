<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';

// S02 · My routes. Routes made with the creator arrive in phase 6; until then
// this is the empty state with its call to action.
const { t } = useI18n();
</script>

<template>
  <main class="mine">
    <h1 class="t-h1">{{ t('myRoutes.title') }}</h1>
    <EmptyState :title="t('myRoutes.empty.title')" :body="t('myRoutes.empty.body')">
      <AppButton size="m" @click="$router.push('/create')">{{ t('myRoutes.empty.cta') }}</AppButton>
    </EmptyState>
  </main>
</template>

<style scoped>
.mine {
  max-width: 640px;
  margin: 0 auto;
  padding: calc(24px + var(--safe-top)) var(--gutter) 32px;
}
</style>
