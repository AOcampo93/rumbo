import { createPinia } from 'pinia';
import { createApp } from 'vue';
// Self-hosted fonts: they work offline (PWA) and no visitor IP reaches Google (GDPR).
// Latin subsets only: they cover es, en and pt (ã, ç, ª…), and the rest of
// the scripts would only bloat the precache.
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.vue';
import { applyLocale, detectLocale, i18n } from './i18n/index.ts';
import { createAppRouter } from './router/index.ts';
import { useSettingsStore } from './stores/settings.ts';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// The language is known before the first render: no flash of the wrong one.
// On the first launch S00 starts in the browser's language until the user picks.
const settings = useSettingsStore(pinia);
applyLocale(settings.locale ?? detectLocale(navigator.languages ?? []));

app.use(i18n);
const router = createAppRouter(pinia);
app.use(router);
app.mount('#app');

// The PWA (production builds): offline shell and notifications. A tapped
// notification asks the page to open its URL without reloading the run.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  // Map files loaded before the worker took control: hand them over for offline use.
  const handOver = () =>
    navigator.serviceWorker.controller?.postMessage({
      type: 'cache-assets',
      urls: performance.getEntriesByType('resource').map((entry) => entry.name),
    });
  navigator.serviceWorker.addEventListener('controllerchange', handOver);
  if (navigator.serviceWorker.controller) handOver();
  navigator.serviceWorker.addEventListener(
    'message',
    (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type === 'navigate' && event.data.url) void router.push(event.data.url);
    },
  );
}
