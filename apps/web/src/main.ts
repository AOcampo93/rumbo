import { createPinia } from 'pinia';
import { createApp } from 'vue';
// Self-hosted fonts: they work offline (PWA) and no visitor IP reaches Google (GDPR).
import '@fontsource/fraunces/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
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
app.use(createAppRouter(pinia));
app.mount('#app');
