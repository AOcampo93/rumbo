import type { Issue } from './issues.ts';

/** Version this build reads and writes. A breaking change bumps it and adds a step below. */
export const CURRENT_SPEC_VERSION = 1;

export type MigrationResult = { ok: true; value: unknown } | { ok: false; issue: Issue };

/**
 * Upgrades an older route document to the current `specVersion`. Version 1 is
 * the first one, so today there is nothing to upgrade; future versions add
 * their steps here (v1 → v2 → …) and keep stored routes loading.
 */
export function migrateRouteSpec(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issue: { path: '', code: 'schema', message: 'A route must be a JSON object' },
    };
  }
  const version = (input as { specVersion?: unknown }).specVersion;
  if (version === CURRENT_SPEC_VERSION) return { ok: true, value: input };
  return {
    ok: false,
    issue: {
      path: 'specVersion',
      code: 'unsupported_version',
      message: `Unsupported specVersion ${JSON.stringify(version)}; this build reads version ${CURRENT_SPEC_VERSION}`,
    },
  };
}
