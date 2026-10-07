import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/** Code and assets of the ArcGIS SDK (and its Calcite, chart and grid dependencies). */
const SDK =
  /[\\/]node_modules[\\/](\.pnpm[\\/])?(@arcgis|@esri|@amcharts|@vaadin|lit|@lit|lodash-es|luxon|marked|@zip\.js)/;
/** Our own code: the app and the workspace packages. */
const APP = /[\\/](apps[\\/]web[\\/]src|packages)[\\/]/;

/** A chunk belongs to the SDK when it has SDK code and none of ours (virtual modules don't count). */
const isSdkChunk = (ids: readonly string[]) =>
  ids.some((id) => SDK.test(id)) && !ids.some((id) => APP.test(id));

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
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Rumbo',
        short_name: 'Rumbo',
        description: 'Guided routes that come alive when you arrive.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#F7F3EC',
        background_color: '#F7F3EC',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      injectManifest: {
        // The app shell only: the SDK lives in assets/sdk/ and is cached when used.
        globPatterns: ['index.html', 'assets/*.{js,css,woff2}', 'favicon.svg', 'icons/*.png'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // The map SDK's core is one ~1.2 MB chunk, loaded only by screens with a map.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // The map SDK's hundreds of chunks go to their own folder, so the
        // service worker precaches the app and leaves the SDK for later.
        chunkFileNames: (chunk) =>
          isSdkChunk(chunk.moduleIds) ? 'assets/sdk/[name]-[hash].js' : 'assets/[name]-[hash].js',
        assetFileNames: (asset) =>
          (asset.originalFileNames ?? []).some((name) => SDK.test(name))
            ? 'assets/sdk/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    // Same origin everywhere: in production Traefik routes /api to the API,
    // in development Vite proxies it to the local Fastify server.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
