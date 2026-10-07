<script setup lang="ts">
import { Bookmark, Compass, Plus, Settings } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

// Bottom navigation (DESIGN §8.2): Explore · My routes · Create (highlighted) · Settings.
const { t } = useI18n();
</script>

<template>
  <nav class="nav" :aria-label="t('nav.label')">
    <RouterLink to="/" class="nav__item" exact-active-class="is-active">
      <Compass :size="24" aria-hidden="true" />
      <span>{{ t('nav.explore') }}</span>
    </RouterLink>
    <RouterLink to="/my-routes" class="nav__item" active-class="is-active">
      <Bookmark :size="24" aria-hidden="true" />
      <span>{{ t('nav.myRoutes') }}</span>
    </RouterLink>
    <RouterLink to="/create" class="nav__item nav__item--create" active-class="is-active">
      <span class="nav__plus"><Plus :size="22" :stroke-width="2.5" aria-hidden="true" /></span>
      <span>{{ t('nav.create') }}</span>
    </RouterLink>
    <RouterLink to="/settings" class="nav__item" active-class="is-active">
      <Settings :size="24" aria-hidden="true" />
      <span>{{ t('nav.settings') }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.nav {
  position: fixed;
  inset: auto 0 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(var(--nav-height) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}
.nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  color: var(--color-text-muted);
  font: 500 12px/16px var(--font-ui);
  text-decoration: none;
}
.nav__item span:last-child {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav__item.is-active {
  color: var(--color-primary);
  font-weight: 600;
}
.nav__plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: var(--color-on-accent);
}
.nav__item--create {
  color: var(--color-text);
  font-weight: 600;
}
</style>
