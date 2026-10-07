import { createApp } from 'vue';
// Self-hosted fonts: they work offline (PWA) and no visitor IP reaches Google (GDPR).
import '@fontsource/fraunces/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './styles/base.css';
import App from './App.vue';

createApp(App).mount('#app');
