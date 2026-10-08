import type { Pinia } from 'pinia';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useCreatorStore } from '../stores/creator.ts';
import { useSettingsStore } from '../stores/settings.ts';

declare module 'vue-router' {
  interface RouteMeta {
    /** Shows the bottom navigation (DESIGN §8.2). */
    nav?: boolean;
  }
}

/** The creator's step components: /create renders one inside CreateLayout. */
const DetailsStep = () => import('../views/create/DetailsStep.vue');

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
  // The creator (C1-C5): no bottom navigation, a back arrow and the stepper
  // (DESIGN §8.2). Steps move with push (Back = previous step); review → done
  // replaces, so Back never saves twice. S02 edits a route with
  // `await creator.loadForEdit(id)` and then pushes `create-details`.
  {
    path: '/create',
    component: () => import('../views/create/CreateLayout.vue'),
    children: [
      {
        // Entering the creator: a new session that resumes the draft at its furthest step.
        path: '',
        name: 'create',
        component: DetailsStep,
        beforeEnter: async () => {
          const creator = useCreatorStore();
          await creator.ready;
          creator.savedId = null;
          await creator.ensureDraft();
          return { name: `create-${creator.resumeStep}` };
        },
      },
      { path: 'details', name: 'create-details', component: DetailsStep },
      {
        path: 'places',
        name: 'create-places',
        component: () => import('../views/create/PlacesStep.vue'),
      },
      {
        path: 'review',
        name: 'create-review',
        component: () => import('../views/create/ReviewStep.vue'),
      },
      // Step 3 "Contenido" arrives in phase 7.
      { path: 'content', redirect: { name: 'create-review' } },
      {
        path: 'done',
        name: 'create-done',
        component: () => import('../views/create/DoneStep.vue'),
      },
    ],
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

  router.beforeEach(async (to) => {
    // First launch: language (S00, only once) → onboarding → the app.
    const settings = useSettingsStore(pinia);
    if (settings.locale === null) return to.name === 'welcome' ? true : { name: 'welcome' };
    if (to.name === 'welcome')
      return settings.onboarded ? { name: 'home' } : { name: 'onboarding' };
    if (!settings.onboarded && to.name !== 'onboarding') return { name: 'onboarding' };

    // The creator's steps: each one needs what the previous ones collect.
    if (typeof to.name === 'string' && to.name.startsWith('create-')) {
      const creator = useCreatorStore(pinia);
      await creator.ready;
      if (to.name === 'create-done') return creator.savedId ? true : { name: 'create-review' };
      // Back from "done" into a route that is already saved: its list instead.
      if (creator.savedId && !creator.draft) return { name: 'my-routes' };
      await creator.ensureDraft();
      const details = creator.stepIssues('details').length > 0;
      if (to.name === 'create-places' && details) return { name: 'create-details' };
      if (to.name === 'create-review') {
        if (details) return { name: 'create-details' };
        if (creator.stepIssues('places').some((issue) => issue.code === 'too_few_places'))
          return { name: 'create-places' };
      }
    }
    return true;
  });

  return router;
}
