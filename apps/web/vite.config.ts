import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    // Same origin everywhere: in production Traefik routes /api to the API,
    // in development Vite proxies it to the local Fastify server.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
