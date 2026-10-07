import type {
  Activity,
  PointTriggers,
  RoutePoint,
  RouteMode,
  RouteSpec,
  RouteTriggers,
} from './schema.ts';

/** Every setting resolved. The engine only ever sees this shape. */
export interface RouteSettings {
  /** m. Zone radius when a point doesn't set its own. */
  defaultRadius: number;
  /** m. Leaving a zone needs distance > radius + exitHysteresis (no flicker). */
  exitHysteresis: number;
  /** s. Time inside a zone needed to confirm an arrival. */
  dwellTime: number;
  /** m. Readings with worse accuracy never decide zones. */
  minAccuracy: number;
  /** m. Distance that triggers `approach`; 0 disables it. */
  approachDistance: number;
  deviation: { enabled: boolean; maxDistance: number; graceTime: number };
  idle: { enabled: boolean; time: number; radius: number };
  /** s, or null for no limit. */
  timeLimit: number | null;
  /** m/s. Faster implied speeds are GPS jumps and get ignored. */
  maxSpeed: number;
  /** m/s. Used for ETAs. */
  expectedSpeed: number;
  autoCompleteWithoutAction: boolean;
  allowManualCheckIn: boolean;
}

const SPEEDS: Record<Activity, { max: number; expected: number }> = {
  walk: { max: 7, expected: 1.3 },
  run: { max: 10, expected: 2.8 },
  bike: { max: 25, expected: 5 },
};

/** Defaults from docs/PROJECT_PLAN.md §6.1, which depend on mode, activity and path. */
export function defaultSettings(
  mode: RouteMode,
  activity: Activity,
  hasPath: boolean,
): RouteSettings {
  return {
    defaultRadius: 40,
    exitHysteresis: 10,
    dwellTime: 5,
    minAccuracy: 30,
    approachDistance: 100,
    deviation: { enabled: mode === 'challenge' || hasPath, maxDistance: 150, graceTime: 30 },
    idle: { enabled: true, time: 600, radius: 25 },
    timeLimit: null,
    maxSpeed: SPEEDS[activity].max,
    expectedSpeed: SPEEDS[activity].expected,
    autoCompleteWithoutAction: true,
    allowManualCheckIn: mode === 'free',
  };
}

export interface NormalizedRoutePoint extends RoutePoint {
  radius: number;
  required: boolean;
  triggers: PointTriggers;
}

export interface NormalizedRouteSpec extends Omit<RouteSpec, 'settings' | 'points' | 'triggers'> {
  settings: RouteSettings;
  /** Sorted by `order`. */
  points: NormalizedRoutePoint[];
  triggers: RouteTriggers;
}

/**
 * Fills in every default so the engine never has to guess. Expects a spec
 * that already passed the schema; validateRouteSpec calls it for you.
 */
export function normalizeRouteSpec(spec: RouteSpec): NormalizedRouteSpec {
  const base = defaultSettings(spec.mode, spec.activity, Boolean(spec.path));
  const input = spec.settings ?? {};
  const settings: RouteSettings = {
    ...base,
    ...input,
    deviation: { ...base.deviation, ...input.deviation },
    idle: { ...base.idle, ...input.idle },
  };
  const points = [...spec.points]
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      ...p,
      radius: p.radius ?? settings.defaultRadius,
      required: p.required ?? true,
      triggers: p.triggers ?? {},
    }));
  return { ...spec, settings, points, triggers: spec.triggers ?? {} };
}
