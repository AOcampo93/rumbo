import type { PointCategory } from '@rumbo/route-spec';
import {
  Binoculars,
  Castle,
  Check,
  Church,
  CirclePlay,
  Drama,
  Flag,
  type IconNode,
  Landmark,
  Lock,
  MapPin,
  Trees,
  Utensils,
} from 'lucide';
import type { MarkerState } from './types.ts';

// Marker artwork of DESIGN §6.1, drawn as SVG so every state × category is
// exact (and cached): a 36 px circle with a white ring, a white category
// icon and the order badge; 44 px for the target, 30 px for locked points.

/** Fixed colours: symbols are images, they can't read CSS variables. */
export const MAP_COLORS = {
  primary: '#1E4FA3',
  secondary: '#0B7A75',
  accent: '#C4491F',
  success: '#1A7F45',
  locked: '#8A94A0',
  ink: '#16191D',
  user: '#2F80ED',
  sim: '#7C3AED',
  white: '#FFFFFF',
} as const;

/** Route colours on the Explore map (DESIGN §5.1), always shown with a legend. */
export const ROUTE_COLORS = ['#1E4FA3', '#0B7A75', '#C4491F', '#6D4AA8', '#1A7F45'] as const;

const CATEGORY_ICONS: Record<PointCategory, IconNode> = {
  monument: Castle,
  museum: Landmark,
  church: Church,
  viewpoint: Binoculars,
  nature: Trees,
  food: Utensils,
  culture: Drama,
  checkpoint: Flag,
  start: CirclePlay,
  finish: Flag,
  other: MapPin,
};

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** A Lucide icon as SVG markup, `size` px wide, centred at (cx, cy). */
export function iconSvg(
  icon: IconNode,
  cx: number,
  cy: number,
  size: number,
  color: string,
  stroke = 2.25,
): string {
  const scale = size / 24;
  const children = icon
    .map(([tag, attrs]) => {
      const list = Object.entries(attrs)
        .map(([name, value]) => `${name}="${escapeAttr(String(value))}"`)
        .join(' ');
      return `<${tag} ${list}/>`;
    })
    .join('');
  return (
    `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${scale})" fill="none" ` +
    `stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${children}</g>`
  );
}

export interface MarkerLook {
  category: PointCategory;
  state: MarkerState;
  color?: string;
  order?: number | null;
  optional?: boolean;
  dwell?: number;
  /** "Sol" high contrast: 20 % bigger markers with a thicker ring. */
  large?: boolean;
}

function diameterOf(look: MarkerLook): number {
  if (look.state === 'locked' || look.state === 'poi') return 30;
  if (look.state === 'next' || look.category === 'finish') return 44;
  return 36;
}

function fillOf(look: MarkerLook): string {
  switch (look.state) {
    case 'explore':
      return look.color ?? MAP_COLORS.primary;
    case 'poi':
      return MAP_COLORS.white;
    case 'locked':
      return MAP_COLORS.locked;
    case 'next':
    case 'reached':
      return MAP_COLORS.accent;
    case 'completed':
      return MAP_COLORS.success;
    default:
      return look.category === 'finish' ? MAP_COLORS.ink : MAP_COLORS.primary;
  }
}

/** The marker as an SVG document, plus its size in px (canvas, including halo and badge). */
export function markerSvg(look: MarkerLook): { svg: string; size: number } {
  const scale = look.large ? 1.2 : 1;
  const d = diameterOf(look) * scale;
  const pad = 12 * scale; // room for the halo, the progress ring and the badge
  const size = Math.round(d + pad * 2);
  const c = size / 2;
  const r = d / 2;
  const ring = (look.large ? 3.5 : 2.5) * scale;
  const parts: string[] = [];

  // Target halo (static: DESIGN asks for a still ring when motion is reduced).
  if (look.state === 'next') {
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r + 7 * scale}" fill="${MAP_COLORS.accent}" fill-opacity="0.22"/>`,
    );
  }
  // Arrival being confirmed: progress ring around the target.
  if (look.dwell !== undefined && look.dwell > 0) {
    const rr = r + 5 * scale;
    const circumference = 2 * Math.PI * rr;
    const progress = Math.min(1, look.dwell) * circumference;
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="${MAP_COLORS.accent}" stroke-width="${3.5 * scale}" ` +
        `stroke-dasharray="${progress} ${circumference}" stroke-linecap="round" transform="rotate(-90 ${c} ${c})"/>`,
    );
  }
  // Card open: an accent arc (the mockup spins it).
  if (look.state === 'reached') {
    const rr = r + 5 * scale;
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="${MAP_COLORS.accent}" stroke-width="${3 * scale}" ` +
        `stroke-dasharray="${rr * 2.2} ${rr * 4.1}" stroke-linecap="round"/>`,
    );
  }

  const shadow = `<circle cx="${c}" cy="${c + 1}" r="${r}" fill="#16191D" fill-opacity="0.18"/>`;
  const dash = look.optional ? ` stroke-dasharray="${4 * scale} ${3 * scale}"` : '';
  const ringColor = look.state === 'poi' ? MAP_COLORS.ink : MAP_COLORS.white;
  parts.push(
    shadow,
    `<circle cx="${c}" cy="${c}" r="${r - ring / 2}" fill="${fillOf(look)}" stroke="${ringColor}" stroke-width="${ring}"${dash}/>`,
  );

  const iconColor = look.state === 'poi' ? MAP_COLORS.ink : MAP_COLORS.white;
  if (look.state === 'locked') parts.push(iconSvg(Lock, c, c, 14 * scale, iconColor, 2.5));
  else if (look.state === 'completed') parts.push(iconSvg(Check, c, c, 20 * scale, iconColor, 3));
  else
    parts.push(
      iconSvg(
        CATEGORY_ICONS[look.category],
        c,
        c,
        (look.state === 'poi' ? 16 : 18) * scale,
        iconColor,
      ),
    );

  const showBadge =
    look.order !== undefined &&
    look.order !== null &&
    look.state !== 'locked' &&
    look.state !== 'explore' &&
    look.state !== 'poi';
  if (showBadge) {
    const br = 9 * scale;
    const bx = c + r * 0.72;
    const by = c - r * 0.72;
    parts.push(
      `<circle cx="${bx}" cy="${by}" r="${br}" fill="${MAP_COLORS.ink}" stroke="${MAP_COLORS.white}" stroke-width="${1.5 * scale}"/>`,
      `<text x="${bx}" y="${by + 3.8 * scale}" text-anchor="middle" font-family="Inter, Arial, sans-serif" ` +
        `font-weight="700" font-size="${11 * scale}" fill="${MAP_COLORS.white}">${look.order}</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
  return { svg, size };
}

const cache = new Map<string, { url: string; size: number }>();

/** Marker image as a data URL (cached per look). */
export function markerImage(look: MarkerLook): { url: string; size: number } {
  const key = JSON.stringify(look);
  let image = cache.get(key);
  if (!image) {
    const { svg, size } = markerSvg(look);
    image = { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size };
    cache.set(key, image);
  }
  return image;
}

/** The user's dot (DESIGN §6.2): 18 px with a white ring and an optional heading cone. */
export function userImage(simulated: boolean, withHeading: boolean): { url: string; size: number } {
  const key = `user:${simulated}:${withHeading}`;
  let image = cache.get(key);
  if (!image) {
    const color = simulated ? MAP_COLORS.sim : MAP_COLORS.user;
    const size = 64;
    const c = size / 2;
    const cone = withHeading
      ? `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0.45"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
        `<path d="M${c} ${c} L${c - 16} ${c - 28} A32 32 0 0 1 ${c + 16} ${c - 28} Z" fill="url(#g)"/>`
      : '';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${cone}` +
      `<circle cx="${c}" cy="${c}" r="10.5" fill="${color}" stroke="#FFFFFF" stroke-width="3"/></svg>`;
    image = { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size };
    cache.set(key, image);
  }
  return image;
}
