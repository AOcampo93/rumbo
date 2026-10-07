import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  plugins: [
    vue({
      template: {
        // ArcGIS and Calcite ship web components: Vue must leave their tags alone.
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('arcgis-') || tag.startsWith('calcite-'),
        },
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    // Same origin everywhere: in production Traefik routes /api to the API,
    // in development Vite proxies it to the local Fastify server.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
