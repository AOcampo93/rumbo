import type { Pinia } from 'pinia';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useSettingsStore } from '../stores/settings.ts';

declare module 'vue-router' {
  interface RouteMeta {
    /** Shows the bottom navigation (DESIGN §8.2). */
    nav?: boolean;
  }
}

// Routes of PROJECT_PLAN §10.2 / DESIGN §8.2. Views load on demand, so the
// heavy map SDK only arrives with the screens that draw a map.
export const routes: RouteRecordRaw[] = [
  { path: '/welcome', name: 'welcome', component: () => import('../views/WelcomeView.vue') },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('../views/OnboardingView.vue'),
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { nav: true },
  },
  {
    path: '/my-routes',
    name: 'my-routes',
    component: () => import('../views/MyRoutesView.vue'),
    meta: { nav: true },
  },
  {
    path: '/routes/:routeId',
    name: 'route',
    component: () => import('../views/RouteDetailView.vue'),
    props: true,
  },
  {
    path: '/routes/:routeId/prepare',
    name: 'prepare',
    component: () => import('../views/PrepareView.vue'),
    props: true,
  },
  { path: '/run', name: 'run', component: () => import('../views/RunView.vue') },
  { path: '/run/summary', name: 'summary', component: () => import('../views/SummaryView.vue') },
  {
    path: '/create/:step?',
    name: 'create',
    component: () => import('../views/CreateView.vue'),
    meta: { nav: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { nav: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
];

export function createAppRouter(pinia: Pinia) {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  });

  // First launch: language (S00, only once) → onboarding → the app.
  router.beforeEach((to) => {
    const settings = useSettingsStore(pinia);
    if (settings.locale === null) return to.name === 'welcome' ? true : { name: 'welcome' };
    if (to.name === 'welcome')
      return settings.onboarded ? { name: 'home' } : { name: 'onboarding' };
    if (!settings.onboarded && to.name !== 'onboarding') return { name: 'onboarding' };
    return true;
  });

  return router;
}
