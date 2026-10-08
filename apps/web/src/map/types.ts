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
  /** Needs attention (the creator's overlapping zones): an amber ring and a "!" badge. */
  warning?: boolean;
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

/** 'warning': the zone overlaps another one (creator). */
export type MapZoneTone = 'default' | 'warning';

/** One radius circle among many (the creator's places), kept in sync by `id`. */
export interface MapZoneItem extends MapZone {
  id: string;
  tone?: MapZoneTone;
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

/** What RouteMap exposes to its parent (type the template ref with it). */
export interface RouteMapApi {
  openPopup(markerId: string): void;
  closePopup(): void;
  /** Back to the user (when there is one) or to `fit`. */
  recenter(): Promise<void>;
  /** Frames these positions (default: the `fit` prop); a single one at zoom 17. */
  fitTo(points?: readonly LatLng[] | null): Promise<void>;
  /** Centres the map on `center`, at `zoom` or at least 16. Does nothing until the map is ready. */
  goTo(center: LatLng, zoom?: number): Promise<void>;
  /** Centre of the visible area (inside the padding); null until the map is ready. */
  center(): LatLng | null;
}
