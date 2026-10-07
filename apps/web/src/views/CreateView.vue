<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import EmptyState from '../components/EmptyState.vue';

// Placeholder for the route creator (C1–C5), built in phase 6.
const { t } = useI18n();
</script>

<template>
  <main class="create">
    <h1 class="t-h1">{{ t('create.title') }}</h1>
    <EmptyState :title="t('create.soon.title')" :body="t('create.soon.body')" />
  </main>
</template>

<style scoped>
.create {
  max-width: 640px;
  margin: 0 auto;
  padding: calc(24px + var(--safe-top)) var(--gutter) 32px;
}
</style>
