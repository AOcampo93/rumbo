<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();
</script>

<template>
  <main class="missing">
    <EmptyState :title="t('notFound.title')">
      <AppButton size="m" @click="$router.replace('/')">{{ t('notFound.cta') }}</AppButton>
    </EmptyState>
  </main>
</template>

<style scoped>
.missing {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
}
</style>
