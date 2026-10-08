import { distance, type LatLng, polylineLength } from '@rumbo/geo-utils';
import {
  defaultSettings,
  type LocalizedText,
  resolveText,
  type RouteSpec,
} from '@rumbo/route-spec';
import {
  ARRIVAL_LIMITS,
  arrivalFromAction,
  type ArrivalIssueCode,
  validateArrival,
} from './arrival.ts';
import { copySettings, type DraftPlace, type RouteDraft } from './build.ts';
import { estimateMinutes } from './summary.ts';
import { cleanText } from './text.ts';

/** What the creator lets a route have. */
export const DRAFT_LIMITS = {
  minPlaces: 2,
  maxPlaces: 30,
  /** Route and place names, in code points (as the route schemas count). */
  nameMax: 80,
  addressMax: 200,
  /** Straight legs between the places, in order. The API refuses longer user routes. */
  maxRouteMeters: 500_000,
  /** m. The arrival radius slider; `default` is also the routes' default radius. */
  radius: { min: 20, max: 200, step: 5, default: 40 },
  /** The texts of a place's own arrival (a quiz, a video, a link), in code points. */
  arrival: ARRIVAL_LIMITS,
} as const;

/** Minutes offered as a challenge's time limit. */
export const TIME_LIMIT_PRESETS = [30, 60, 90, 120, 180] as const;

/**
 * The draft of a saved route, for editing it. Texts become plain strings in
 * the route's language and every point keeps its id (DraftPlace.pointId), so
 * `buildRouteSpec(draftFromSpec(spec), { source: 'user', id: spec.id }).spec`
 * gives back a spec equal to one buildRouteSpec made. Expects the authored
 * spec: a normalized one would freeze every default into the overrides. A
 * place that shows a quiz, a video, a link or a notice on arrival keeps it as
 * its `arrival`; one with a card or a basic sheet has none (the default).
 */
export function draftFromSpec(spec: RouteSpec): RouteDraft {
  const text = (value: LocalizedText) => resolveText(value, spec.locale, spec.locale).text;
  const { timeLimit, ...overrides } = spec.settings ?? {};
  const interests = spec.meta?.['interests'];
  const places = [...spec.points]
    .sort((a, b) => a.order - b.order)
    .map((point): DraftPlace => {
      const address = point.meta?.['address'];
      const externalId = point.meta?.['externalId'];
      const onEnter = point.triggers?.onEnter;
      const arrival = arrivalFromAction(onEnter ? spec.actions[onEnter] : undefined, spec.locale);
      return {
        tempId: point.id,
        pointId: point.id,
        name: text(point.name),
        position: { lat: point.position.lat, lng: point.position.lng },
        ...(typeof address === 'string' ? { address } : {}),
        ...(typeof externalId === 'string' ? { externalId } : {}),
        ...(point.category ? { category: point.category } : {}),
        ...(point.radius !== undefined ? { radius: point.radius } : {}),
        ...(point.required !== undefined ? { required: point.required } : {}),
        ...(arrival ? { arrival } : {}),
        ...(point.contentRef ? { contentRef: point.contentRef } : {}),
      };
    });
  return {
    name: text(spec.name),
    ...(spec.summary ? { summary: text(spec.summary) } : {}),
    locale: spec.locale,
    mode: spec.mode,
    activity: spec.activity ?? 'walk',
    ...(isStringArray(interests) ? { interests: [...interests] } : {}),
    timeLimit: timeLimit ?? null,
    places,
    ...(Object.keys(overrides).length > 0 ? { settingsOverrides: copySettings(overrides) } : {}),
  };
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export interface DraftSummary {
  placeCount: number;
  /** Straight legs between the places in list order, in whole metres. */
  distanceMeters: number;
  /** Same estimate as summarizeRoute; 0 without places. */
  estimatedMinutes: number;
  /** Whole metres: legs[i] goes from places[i] to places[i + 1]. */
  legs: number[];
}

/**
 * The creator's live numbers ("4 places · 3.1 km · ~1 h 50"). Unlike
 * summarizeRoute it takes any draft, even an empty or invalid one.
 */
export function summarizeDraft(
  draft: Pick<RouteDraft, 'mode' | 'activity' | 'places' | 'settingsOverrides'>,
): DraftSummary {
  const positions = draft.places.map((place) => place.position);
  const meters = polylineLength(positions);
  const speed =
    draft.settingsOverrides?.expectedSpeed ??
    defaultSettings(draft.mode, draft.activity, false).expectedSpeed;
  return {
    placeCount: positions.length,
    distanceMeters: Math.round(meters),
    estimatedMinutes:
      positions.length > 0 ? estimateMinutes(meters, positions.length, draft.mode, speed) : 0,
    legs: positions.slice(1).map((to, i) => Math.round(distance(positions[i] as LatLng, to))),
  };
}

export interface Overlap {
  /** tempIds of the two places, in list order. */
  a: string;
  b: string;
  /** m between their centres. */
  distance: number;
}

/**
 * Pairs of places whose arrival zones overlap: closer than the sum of their
 * radii, the rule of validateRouteSpec's `overlapping_zones` warning. Places
 * without a radius use `defaultRadius` (the route's settings.defaultRadius).
 */
export function findOverlaps(
  places: readonly DraftPlace[],
  defaultRadius: number = DRAFT_LIMITS.radius.default,
): Overlap[] {
  const overlaps: Overlap[] = [];
  places.forEach((a, i) => {
    for (const b of places.slice(i + 1)) {
      const gap = distance(a.position, b.position);
      if (gap < (a.radius ?? defaultRadius) + (b.radius ?? defaultRadius)) {
        overlaps.push({ a: a.tempId, b: b.tempId, distance: gap });
      }
    }
  });
  return overlaps;
}

export type DraftIssueCode =
  | 'name_required'
  | 'name_too_long'
  | 'too_few_places'
  | 'too_many_places'
  | 'place_name_required'
  | 'radius_out_of_range'
  | 'time_limit_invalid'
  | 'route_too_long'
  /** What is wrong with a place's own arrival (a quiz, a video, a link). */
  | ArrivalIssueCode;

export interface DraftIssue {
  code: DraftIssueCode;
  /** What to fix: the step and, for one place, its index in the list. */
  field: 'name' | 'places' | 'timeLimit' | `places.${number}`;
}

/** What still keeps the draft from being saved, step by step (details, then places). */
export function validateDraft(draft: RouteDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const name = cleanText(draft.name);
  if (!name) issues.push({ code: 'name_required', field: 'name' });
  else if ([...name].length > DRAFT_LIMITS.nameMax) {
    issues.push({ code: 'name_too_long', field: 'name' });
  }
  // Free routes ignore the time limit (buildRouteSpec leaves it out).
  const timeLimit = draft.timeLimit ?? null;
  if (draft.mode === 'challenge' && timeLimit !== null && !isPositiveInteger(timeLimit)) {
    issues.push({ code: 'time_limit_invalid', field: 'timeLimit' });
  }

  const { places } = draft;
  if (places.length < DRAFT_LIMITS.minPlaces) {
    issues.push({ code: 'too_few_places', field: 'places' });
  } else if (places.length > DRAFT_LIMITS.maxPlaces) {
    issues.push({ code: 'too_many_places', field: 'places' });
  }
  places.forEach((place, i) => {
    if (!cleanText(place.name)) issues.push({ code: 'place_name_required', field: `places.${i}` });
    const { radius } = place;
    if (
      radius !== undefined &&
      !(radius >= DRAFT_LIMITS.radius.min && radius <= DRAFT_LIMITS.radius.max)
    ) {
      issues.push({ code: 'radius_out_of_range', field: `places.${i}` });
    }
    for (const code of validateArrival(place.arrival)) issues.push({ code, field: `places.${i}` });
  });
  if (polylineLength(places.map((place) => place.position)) > DRAFT_LIMITS.maxRouteMeters) {
    issues.push({ code: 'route_too_long', field: 'places' });
  }
  return issues;
}

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0;
