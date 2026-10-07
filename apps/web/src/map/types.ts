import type { LatLng } from '@rumbo/geo-utils';
import type { PointCategory } from '@rumbo/route-spec';

// What the map draws. Screens describe markers with plain data; RouteMap.vue
// turns them into graphics, so nothing outside src/map touches the SDK.

/** Visual state of a marker (DESIGN §6.1). */
export type MarkerState =
  | 'explore' // Explore map: filled with the route's colour
  | 'poi' // point of interest (Wikidata): white with a dark icon
  | 'active' // free route, still to visit
  | 'next' // the target
  | 'locked' // challenge, not reachable yet
  | 'reached' // the card is open
  | 'completed';

export interface MapMarker {
  /** Unique on the map, e.g. "leiria-historica/castelo" or "poi/Q10283294". */
  id: string;
  position: LatLng;
  category: PointCategory;
  state: MarkerState;
  /** Route colour for 'explore' markers. */
  color?: string;
  /** Order badge (route points). */
  order?: number | null;
  /** Optional points get a dashed ring. */
  optional?: boolean;
  /** 0..1 while an arrival is being confirmed (target only). */
  dwell?: number;
  /** Name shown under the target marker. */
  label?: string;
  /** Popup content (already in the active language). */
  popup: MarkerPopup;
}

export interface MarkerPopup {
  title: string;
  /** Small caps line above the title, e.g. the route name or "Point of interest". */
  kicker?: string;
  chips: Array<{ label: string; color?: string }>;
  distance?: string;
  image?: { url: string; alt: string; credit?: string };
  actions: Array<{ id: string; label: string; primary?: boolean; href?: string }>;
}

export interface MapUser {
  position: LatLng;
  accuracy: number;
  heading: number | null;
  simulated: boolean;
}

export interface MapZone {
  center: LatLng;
  radius: number;
}

export type MapTheme = 'light' | 'dark';
export type BasemapKind = 'streets' | 'topo';

/** Space taken by floating UI (HUD, sheets), so the map centres in what's visible. */
export interface MapPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}
