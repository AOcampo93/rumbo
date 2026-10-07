// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/**'] },

  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },

  { files: ['apps/web/src/**'], languageOptions: { globals: globals.browser } },
  {
    files: ['apps/api/**', 'scripts/**', '**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Architecture rule (docs/PROJECT_PLAN.md §5.3): the engine and the event system
  // are pure TypeScript, so they run in tests and in any UI. Only the browser
  // position source may touch browser APIs.
  {
    files: ['packages/geo-engine/**/*.ts', 'packages/event-system/**/*.ts'],
    ignores: ['packages/geo-engine/src/sources/browser.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vue', 'vue/*', '@vue/*', 'pinia'],
              message: 'Keep this package free of Vue.',
            },
            { group: ['@arcgis/*'], message: 'Keep this package free of ArcGIS.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage'],
    },
  },

  // Must stay last: turns off the stylistic rules that Prettier owns.
  prettier,
);
