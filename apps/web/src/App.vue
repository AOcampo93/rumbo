<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import BottomNav from './components/BottomNav.vue';
import MiniRunBar from './components/MiniRunBar.vue';
import OverlayHost from './components/OverlayHost.vue';
import RecoverSheet from './components/RecoverSheet.vue';
import { applyLocale } from './i18n/index.ts';
import { clearAnalytics, initAnalytics, track } from './services/analytics.ts';
import { flushRunOutbox } from './services/runs.ts';
import { useThemeEffect } from './services/theme.ts';
import { useRunStore } from './stores/run.ts';
import { useSettingsStore } from './stores/settings.ts';

// App shell: the current screen, the bottom navigation on the main tabs, the
// mini bar of a run in progress, and the overlay stack above everything.
const settings = useSettingsStore();
const run = useRunStore();
const route = useRoute();

useThemeEffect(settings);
// Changing the language in Settings switches the whole UI live (ADR 0001).
watch(
  () => settings.locale,
  (locale) => {
    if (locale) applyLocale(locale);
  },
);
// Withdrawing consent drops whatever was waiting to be sent.
watch(
  () => settings.analyticsConsent,
  (consent) => {
    if (consent !== true) clearAnalytics();
  },
);

const showNav = computed(() => route.meta.nav === true);
const showMiniRun = computed(() => showNav.value && run.active);

onMounted(async () => {
  await initAnalytics(() => settings.analyticsConsent === true);
  track('app_open', {});
  // Run ends that couldn't reach the API last time (offline).
  void flushRunOutbox();
  // A run left half done (reload, closed tab): offer to continue (S11).
  if (settings.onboarded) await run.checkRecoverable();
});
</script>

<template>
  <div class="shell" :class="{ 'shell--nav': showNav, 'shell--mini': showMiniRun }">
    <RouterView />
  </div>
  <MiniRunBar v-if="showMiniRun" />
  <BottomNav v-if="showNav" />
  <RecoverSheet />
  <OverlayHost />
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}
.shell--nav {
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom));
}
.shell--mini {
  padding-bottom: calc(var(--nav-height) + var(--safe-bottom) + 64px);
}
</style>
