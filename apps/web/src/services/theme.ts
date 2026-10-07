import { watchEffect, ref, onScopeDispose } from 'vue';
import type { ThemeSetting } from '../stores/settings.ts';

// Applies the theme to <html>: our tokens read `data-theme` and `data-contrast`,
// and the ArcGIS components read Calcite's mode classes.

const DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_COLORS = { light: '#F7F3EC', dark: '#0F1318' } as const;

export type ResolvedTheme = 'light' | 'dark';

/** The theme in use right now; the map reads it to pick its basemap. */
export const resolvedTheme = ref<ResolvedTheme>('light');

/** The system preference, kept up to date. */
export function useSystemDark() {
  const media = globalThis.matchMedia?.(DARK_QUERY);
  const dark = ref(media?.matches ?? false);
  const update = (event: MediaQueryListEvent) => {
    dark.value = event.matches;
  };
  media?.addEventListener('change', update);
  onScopeDispose(() => media?.removeEventListener('change', update));
  return dark;
}

export function resolveTheme(
  setting: ThemeSetting,
  systemDark: boolean,
  sol: boolean,
): ResolvedTheme {
  if (sol) return 'light'; // "Sol" is a light, high-contrast theme.
  if (setting === 'system') return systemDark ? 'dark' : 'light';
  return setting;
}

export function applyTheme(theme: ResolvedTheme, sol: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (sol) root.dataset.contrast = 'sol';
  else delete root.dataset.contrast;
  root.classList.toggle('calcite-mode-dark', theme === 'dark');
  root.classList.toggle('calcite-mode-light', theme === 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

/** Keeps <html> in sync with the settings and the system preference. */
export function useThemeEffect(settings: { theme: ThemeSetting; sol: boolean }) {
  const systemDark = useSystemDark();
  watchEffect(() => {
    resolvedTheme.value = resolveTheme(settings.theme, systemDark.value, settings.sol);
    applyTheme(resolvedTheme.value, settings.sol);
  });
  return resolvedTheme;
}
