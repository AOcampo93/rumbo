import { LocaleSchema } from '@rumbo/route-spec';
import { defineStore } from 'pinia';
import { reactive, toRefs, watch } from 'vue';
import { z } from 'zod';
import { local } from '../services/storage.ts';

// User settings (DESIGN S12). Read synchronously from localStorage before the
// app mounts, so the first frame already has the right language and theme.

const SETTINGS_KEY = 'rumbo.settings';

const SettingsSchema = z.object({
  /** Null until the user picks one on the first launch (S00). */
  locale: LocaleSchema.nullable().catch(null),
  onboarded: z.boolean().catch(false),
  /** Null until asked in the onboarding; nothing is sent without a yes. */
  analyticsConsent: z.boolean().nullable().catch(null),
  theme: z.enum(['system', 'light', 'dark']).catch('system'),
  /** High contrast "Sol" for bright sunlight. */
  sol: z.boolean().catch(false),
  sound: z.boolean().catch(true),
  vibration: z.boolean().catch(true),
  units: z.enum(['metric', 'imperial']).catch('metric'),
  /** Demo mode: a simulated position instead of the GPS (PROJECT_PLAN §10.7). */
  simulation: z.boolean().catch(import.meta.env.DEV),
  /** Keep the screen on during a run (Screen Wake Lock). */
  keepAwake: z.boolean().catch(true),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type ThemeSetting = Settings['theme'];

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/** Stored settings; unknown or broken fields fall back to their defaults. */
export function readSettings(raw: string | null): Settings {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const result = SettingsSchema.safeParse(parsed);
  return result.success ? result.data : defaultSettings();
}

export const useSettingsStore = defineStore('settings', () => {
  const state = reactive<Settings>(readSettings(local.read(SETTINGS_KEY)));

  // `?sim=1` turns the demo mode on (handy for the course video), `?sim=0` off.
  const sim = new URLSearchParams(globalThis.location?.search ?? '').get('sim');
  if (sim === '1') state.simulation = true;
  if (sim === '0') state.simulation = false;

  watch(state, () => local.write(SETTINGS_KEY, JSON.stringify(state)), { deep: true });

  function reset(): void {
    Object.assign(state, defaultSettings());
    local.remove(SETTINGS_KEY);
  }

  return { ...toRefs(state), reset };
});
