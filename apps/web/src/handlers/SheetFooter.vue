<script setup lang="ts">
import { Ellipsis, Pause, Square } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from '../components/AppButton.vue';

// Fixed footer of arrival sheets: "Continue route" + ⋯ (Pause / End) (S06).
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ continue: []; pause: []; end: [] }>();
const { t } = useI18n();
const menu = ref(false);
</script>

<template>
  <footer class="footer">
    <div v-if="menu" class="footer__menu" role="menu">
      <button type="button" role="menuitem" @click="emit('pause')">
        <Pause :size="18" aria-hidden="true" />{{ t('arrival.pause') }}
      </button>
      <button type="button" role="menuitem" class="is-danger" @click="emit('end')">
        <Square :size="18" aria-hidden="true" />{{ t('arrival.end') }}
      </button>
    </div>
    <AppButton class="footer__main" :disabled="disabled" @click="emit('continue')">{{
      t('arrival.continue')
    }}</AppButton>
    <button
      type="button"
      class="footer__more"
      :aria-label="t('arrival.menu')"
      :aria-expanded="menu"
      @click="menu = !menu"
    >
      <Ellipsis :size="22" aria-hidden="true" />
    </button>
  </footer>
</template>

<style scoped>
.footer {
  position: relative;
  display: flex;
  flex: none;
  gap: 10px;
  padding: 12px var(--gutter) calc(16px + var(--safe-bottom));
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}
.footer__main {
  flex: 1;
}
.footer__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-l);
  height: var(--control-l);
  border: var(--control-border) solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
}
.footer__menu {
  position: absolute;
  right: var(--gutter);
  bottom: calc(100% + 8px);
  min-width: 240px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-e3);
}
.footer__menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: 0;
  background: transparent;
  font: 600 16px var(--font-ui);
  text-align: left;
}
.footer__menu .is-danger {
  border-top: 1px solid var(--color-border);
  color: var(--color-danger);
}
</style>
