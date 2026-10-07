import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { NormalizedRouteSpec } from './normalize.ts';

/** JSON with object keys sorted at every level, so equal data always hashes equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) sorted[key] = sortKeys(child);
  }
  return sorted;
}

/**
 * SHA-256 (hex) of what the engine depends on: points, positions, radii,
 * order, settings, path and triggers. Texts, images, categories and action
 * contents are left out on purpose, so fixing or translating a text never
 * invalidates a saved run (ADR 0001). A restored run whose hash differs means
 * the route itself changed.
 */
export function hashRouteSpec(spec: NormalizedRouteSpec): string {
  const engineView = {
    specVersion: spec.specVersion,
    id: spec.id,
    mode: spec.mode,
    activity: spec.activity,
    settings: spec.settings,
    points: spec.points.map((p) => ({
      id: p.id,
      order: p.order,
      position: p.position,
      radius: p.radius,
      required: p.required,
      triggers: p.triggers,
    })),
    path: spec.path ?? null,
    triggers: spec.triggers,
  };
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(engineView))));
}
