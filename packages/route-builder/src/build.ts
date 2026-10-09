import type {
  ActionDef,
  Activity,
  Interruption,
  Issue,
  LatLng,
  Locale,
  MediaRef,
  NormalizedRouteSpec,
  PointCategory,
  RouteMode,
  RoutePoint,
  RouteSettingsInput,
  RouteSpec,
  RouteTriggers,
} from '@rumbo/route-spec';
import { RoutePointSchema, validateRouteSpec } from '@rumbo/route-spec';
import { type ArrivalChoice, ownArrivalAction, validateArrival } from './arrival.ts';
import { newIdSuffix, slugify, uniqueIds } from './slug.ts';
import { cleanText } from './text.ts';

/** A place picked in step 2 of the planner. */
export interface DraftPlace {
  /** Client-side id while editing; the final spec doesn't keep it. */
  tempId: string;
  /**
   * The point's id in the saved route, when editing one (draftFromSpec sets
   * it). It is kept as is, so renaming or reordering places never changes
   * point ids, action ids or hashRouteSpec. New places leave it out and get
   * an id from their name.
   */
  pointId?: string;
  name: string;
  position: LatLng;
  address?: string;
  /** Wikidata QID or geocoder id, kept for the AI pipeline. */
  externalId?: string;
  category?: PointCategory;
  radius?: number;
  required?: boolean;
  /**
   * What happens on arrival; the AI card when ready, else the basic sheet
   * (`{ type: 'card' }`) when left out. Only a place that uses the card
   * keeps its `contentRef` in the route.
   */
  arrival?: ArrivalChoice;
  /** Card generated in step 3, if any. */
  contentRef?: string;
}

/** Everything the planner collects before building the route. */
export interface RouteDraft {
  name: string;
  /** A line about the route (the AI suggests one with its places); at most 280 characters. */
  summary?: string;
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
  /**
   * The route's cover (phase 7.3): the user's own photo, stored by the API,
   * or one of its cards' photos. Without one the app shows the illustration
   * of the route's first interest.
   */
  coverImage?: MediaRef;
}

export interface BuildOptions {
  source: 'user';
  /** The route's id when editing a saved route: kept as is. Otherwise a new one is made. */
  id?: string;
  /** Generates a new route id's suffix (default: newIdSuffix); inject it for deterministic tests. */
  idFactory?: () => string;
}

export interface BuiltRoute {
  /** The route as authored: what gets saved and sent to the API. */
  spec: RouteSpec;
  /** The same route with every default filled in: what the engine runs. */
  normalized: NormalizedRouteSpec;
  warnings: Issue[];
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
} as const satisfies Partial<Record<keyof RouteTriggers, Interruption>>;

const isPointId = (id: string) => RoutePointSchema.shape.id.safeParse(id).success;

/**
 * Builds a RouteSpec from the planner's draft (docs/PROJECT_PLAN.md §7):
 * stable ids, order from array position, the action each place picked for its
 * arrival (a card by default) and the default decision for every interruption.
 * Texts are cleaned (see cleanText) and nothing in the result is shared with
 * the draft. The result always passes validateRouteSpec; otherwise this throws
 * RouteBuildError.
 */
export function buildRouteSpec(draft: RouteDraft, options: BuildOptions): BuiltRoute {
  const name = cleanText(draft.name);
  const pointIds = pointIdsFor(draft.places);
  // content_<point id> cut to 64 characters can repeat: number the repeats.
  const actionIds = uniqueIds(pointIds.map((id) => `content_${id}`.slice(0, 64)));

  const invalid: Issue[] = [];
  const actions: Record<string, ActionDef> = {};
  const points: RoutePoint[] = draft.places.map((place, i) => {
    const pointName = cleanText(place.name);
    const address = cleanText(place.address ?? '');
    const actionId = actionIds[i] as string;
    for (const code of validateArrival(place.arrival)) {
      invalid.push({ path: `places[${i}].arrival`, code: 'schema', message: code });
    }
    // The place's own pick (a quiz, a video, a link, a notice); else the generated card when
    // it has one, or a basic sheet with name and address.
    const own = place.arrival ? ownArrivalAction(place.arrival) : null;
    const usesCard = (place.arrival?.type ?? 'card') === 'card';
    actions[actionId] =
      own ??
      (usesCard && place.contentRef
        ? { type: 'ai_template', params: { contentRef: place.contentRef } }
        : {
            type: 'info_sheet',
            params: { title: pointName, ...(address ? { body: address } : {}) },
          });
    const meta = {
      ...(address ? { address } : {}),
      ...(place.externalId ? { externalId: place.externalId } : {}),
    };
    return {
      id: pointIds[i] as string,
      name: pointName,
      position: { lat: place.position.lat, lng: place.position.lng },
      order: i + 1,
      ...(place.radius !== undefined ? { radius: place.radius } : {}),
      ...(place.required !== undefined ? { required: place.required } : {}),
      ...(place.category ? { category: place.category } : {}),
      ...(usesCard && place.contentRef ? { contentRef: place.contentRef } : {}),
      triggers: { onEnter: actionId },
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  });
  if (invalid.length > 0) throw new RouteBuildError(invalid);

  const triggers: RouteTriggers = {};
  for (const [trigger, preset] of Object.entries(DECISION_PRESETS)) {
    const actionId = `decision_${preset}`;
    actions[actionId] = { type: 'decision', params: { preset } };
    triggers[trigger as keyof RouteTriggers] = actionId;
  }

  const settings: RouteSettingsInput = {
    ...copySettings(draft.settingsOverrides),
    ...(draft.mode === 'challenge' && draft.timeLimit ? { timeLimit: draft.timeLimit } : {}),
  };

  const summary = cleanText(draft.summary ?? '');
  const spec: RouteSpec = {
    specVersion: 1,
    id: options.id ?? newRouteId(name, options.idFactory ?? newIdSuffix),
    name,
    ...(summary ? { summary } : {}),
    locale: draft.locale,
    mode: draft.mode,
    activity: draft.activity,
    source: options.source,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    points,
    actions,
    triggers,
    ...(draft.interests?.length ? { meta: { interests: [...draft.interests] } } : {}),
    ...(draft.coverImage ? { coverImage: copyMedia(draft.coverImage) } : {}),
  };

  const result = validateRouteSpec(spec);
  if (!result.spec) throw new RouteBuildError(result.errors);
  return { spec, normalized: result.spec, warnings: result.warnings };
}

/** A copy of a photo reference, so the spec shares nothing with the draft. */
export function copyMedia(media: MediaRef): MediaRef {
  return JSON.parse(JSON.stringify(media)) as MediaRef;
}

/** `<slug of the name>-<suffix>`, within the 64 characters an id may have. */
function newRouteId(name: string, idFactory: () => string): string {
  const suffix = idFactory();
  return `${slugify(name, 63 - suffix.length) || 'route'}-${suffix}`;
}

/**
 * A place keeps its pointId (the first one that claims it, if a broken draft
 * repeats one); every other place gets a slug of its name, unique among all
 * the ids. Editing a saved route therefore never renames its points.
 */
function pointIdsFor(places: readonly DraftPlace[]): string[] {
  const kept = new Set<string>();
  const keptIds = places.map((place) => {
    const id = place.pointId;
    if (id === undefined || kept.has(id) || !isPointId(id)) return undefined;
    kept.add(id);
    return id;
  });
  const fresh = uniqueIds(
    places
      .filter((_, i) => keptIds[i] === undefined)
      .map((place) => slugify(cleanText(place.name)) || 'point'),
    64,
    kept,
  );
  let next = 0;
  return keptIds.map((id) => id ?? (fresh[next++] as string));
}

/** A copy of the overrides that shares no object with the draft. */
export function copySettings(overrides: RouteSettingsInput | undefined): RouteSettingsInput {
  if (!overrides) return {};
  const { deviation, idle, ...flat } = overrides;
  return {
    ...flat,
    ...(deviation ? { deviation: { ...deviation } } : {}),
    ...(idle ? { idle: { ...idle } } : {}),
  };
}
