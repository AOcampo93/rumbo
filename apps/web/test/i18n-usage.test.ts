import { describe, expect, it } from 'vitest';
import es from '../src/i18n/es.json';

// The catalogs agree with each other (i18n.test.ts); this checks the code
// against them: a key used in a screen but missing from the catalogs would
// show up as "create.places.xxx" (vue-i18n only warns in development).

/** Every source file of the app, as text (Vite reads them for the test). */
const SOURCES = import.meta.glob<string>('../src/**/*.{ts,vue}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
/** What an i18n key looks like: dotted segments. */
const KEY = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;
/** `t('…')` (also `$t` and `i18n.global.t`) and `{ key: '…' }` (UiText), quoted or as a template. */
const USES = [/\bt\(\s*(['`])((?:(?!\1).)+)\1/g, /\bkey:\s*(['`])((?:(?!\1).)+)\1/g];
/** Groups whose keys are built at run time (`category.${c}`…). */
const DYNAMIC_GROUPS = ['category.', 'activity.', 'mode.', 'pointState.', 'errors.'];

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

const known = flatten(es as Tree);
const knownSet = new Set(known);

describe('i18n keys in the code', () => {
  it('exist in the catalogs, and every dynamic one has a group to come from', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const pattern of USES) {
        for (const match of text.matchAll(pattern)) {
          const [, quote, value = ''] = match;
          const dynamic = quote === '`' && value.includes('${');
          const where = `${file}: ${value}`;
          if (dynamic) {
            // `run.hud.eta.${activity}`: its static part must open a group of keys.
            const prefix = value.slice(0, value.indexOf('${'));
            if (!prefix.includes('.')) continue;
            checked += 1;
            if (!known.some((key) => key.startsWith(prefix))) missing.push(where);
            continue;
          }
          if (!KEY.test(value)) continue;
          checked += 1;
          if (!knownSet.has(value)) missing.push(where);
        }
      }
    }
    expect(missing).toEqual([]);
    // The scan itself works: it found the hundreds of keys the screens use.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(checked).toBeGreaterThan(200);
  });

  it('keep the groups that dynamic keys come from', () => {
    for (const group of DYNAMIC_GROUPS) {
      expect(
        known.some((key) => key.startsWith(group)),
        group,
      ).toBe(true);
    }
  });
});
