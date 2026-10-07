<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

// Top bar of secondary screens: back arrow and an optional title.
// `to`: where the back arrow goes (default: history back); `noBack` hides it.
const props = defineProps<{ title?: string; to?: string; noBack?: boolean }>();
const router = useRouter();
const { t } = useI18n();

function goBack(): void {
  if (props.to) void router.push(props.to);
  else if (window.history.length > 1) router.back();
  else void router.push('/');
}
</script>

<template>
  <header class="header">
    <button
      v-if="!noBack"
      type="button"
      class="header__back"
      :aria-label="t('common.back')"
      @click="goBack"
    >
      <ArrowLeft :size="24" aria-hidden="true" />
    </button>
    <span v-if="title" class="header__title">{{ title }}</span>
    <slot />
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: calc(8px + var(--safe-top)) var(--gutter) 8px;
}
.header__back {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-left: -4px;
  border: var(--control-border) solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-text);
}
.header__title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font: 600 16px/22px var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
