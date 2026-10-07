import type {
  ActionDef,
  Activity,
  Issue,
  LatLng,
  Locale,
  PointCategory,
  RouteMode,
  RoutePoint,
  RouteSettingsInput,
  RouteSpec,
  RouteTriggers,
} from '@rumbo/route-spec';
import { validateRouteSpec } from '@rumbo/route-spec';
import { slugify, uniqueIds } from './slug.ts';

/** A place picked in step 2 of the planner. */
export interface DraftPlace {
  /** Client-side id while editing; the final spec doesn't keep it. */
  tempId: string;
  name: string;
  position: LatLng;
  address?: string;
  /** Wikidata QID or geocoder id, kept for the AI pipeline. */
  externalId?: string;
  category?: PointCategory;
  radius?: number;
  required?: boolean;
  /** Card generated in step 3, if any. */
  contentRef?: string;
}

/** Everything the planner collects before building the route. */
export interface RouteDraft {
  name: string;
  /** The app's language when the route was created; it is not asked (ADR 0001). */
  locale: Locale;
  mode: RouteMode;
  activity: Activity;
  /** Hints for the AI: 'history', 'art', 'food'… */
  interests?: string[];
  /** Seconds; only used by challenges. */
  timeLimit?: number | null;
  /** The array order is the route order. */
  places: DraftPlace[];
  settingsOverrides?: RouteSettingsInput;
}

export interface BuildOptions {
  source: 'user';
  /** Generates the route id's suffix; inject it for deterministic tests. */
  idFactory?: () => string;
}

/** Thrown when a draft can't become a valid route; `issues` says why. */
export class RouteBuildError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(
      `The draft is not a valid route: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
    );
    this.name = 'RouteBuildError';
    this.issues = issues;
  }
}

/** Interruptions get the decision sheet (Continue · Pause · End) by default. */
const DECISION_PRESETS = {
  onDeviation: 'deviation',
  onIdle: 'idle',
  onOutOfOrder: 'out_of_order',
  onTimeout: 'timeout',
} as const satisfies Partial<Record<keyof RouteTriggers, string>>;

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/**
 * Builds a RouteSpec from the planner's draft (docs/PROJECT_PLAN.md §7):
 * stable ids from names, order from array position, a card action on arrival
 * at every point, and the default decision for every interruption. The result
 * always passes validateRouteSpec; otherwise this throws RouteBuildError.
 */
export function buildRouteSpec(
  draft: RouteDraft,
  options: BuildOptions,
): { spec: RouteSpec; warnings: Issue[] } {
  const suffix = (options.idFactory ?? randomSuffix)();
  const base = slugify(draft.name, 63 - suffix.length) || 'route';
  const pointIds = uniqueIds(draft.places.map((place) => slugify(place.name) || 'point'));

  const actions: Record<string, ActionDef> = {};
  const points: RoutePoint[] = draft.places.map((place, i) => {
    const id = pointIds[i] as string;
    const actionId = `content_${id}`.slice(0, 64);
    // A generated card when there is one; otherwise a basic sheet with name and address.
    actions[actionId] = place.contentRef
      ? { type: 'ai_template', params: { contentRef: place.contentRef } }
      : {
          type: 'info_sheet',
          params: { title: place.name, ...(place.address ? { body: place.address } : {}) },
        };
    const meta = {
      ...(place.address ? { address: place.address } : {}),
      ...(place.externalId ? { externalId: place.externalId } : {}),
    };
    return {
      id,
      name: place.name.trim(),
      position: place.position,
      order: i + 1,
      ...(place.radius !== undefined ? { radius: place.radius } : {}),
      ...(place.required !== undefined ? { required: place.required } : {}),
      ...(place.category ? { category: place.category } : {}),
      ...(place.contentRef ? { contentRef: place.contentRef } : {}),
      triggers: { onEnter: actionId },
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  });

  const triggers: RouteTriggers = {};
  for (const [trigger, preset] of Object.entries(DECISION_PRESETS)) {
    const actionId = `decision_${preset}`;
    actions[actionId] = { type: 'decision', params: { preset } };
    triggers[trigger as keyof RouteTriggers] = actionId;
  }

  const settings: RouteSettingsInput = {
    ...draft.settingsOverrides,
    ...(draft.mode === 'challenge' && draft.timeLimit ? { timeLimit: draft.timeLimit } : {}),
  };

  const spec: RouteSpec = {
    specVersion: 1,
    id: `${base}-${suffix}`,
    name: draft.name.trim(),
    locale: draft.locale,
    mode: draft.mode,
    activity: draft.activity,
    source: options.source,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    points,
    actions,
    triggers,
    ...(draft.interests?.length ? { meta: { interests: draft.interests } } : {}),
  };

  const result = validateRouteSpec(spec);
  if (!result.ok) throw new RouteBuildError(result.errors);
  return { spec, warnings: result.warnings };
}
