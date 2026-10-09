import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LOOKS,
  LINE_HIT_WIDTH,
  LINE_SWATCH_DASH,
  lineLook,
  MAP_COLORS,
  markerImage,
  markerSvg,
  rgba,
  ROUTE_COLORS,
  ZONE_LOOKS,
} from '../src/map/symbols.ts';

// DESIGN §6.1: state is never shown by colour alone.

describe('marker artwork', () => {
  it('sizes the target bigger and locked points smaller', () => {
    const base = markerSvg({ category: 'church', state: 'active', order: 3 });
    const next = markerSvg({ category: 'church', state: 'next', order: 3 });
    const locked = markerSvg({ category: 'church', state: 'locked', order: 3 });
    expect(next.size).toBeGreaterThan(base.size);
    expect(locked.size).toBeLessThan(base.size);
  });

  it('marks state with shape too: badge, lock, check, dashed ring, progress ring', () => {
    expect(markerSvg({ category: 'museum', state: 'active', order: 7 }).svg).toContain('>7</text>');
    expect(markerSvg({ category: 'museum', state: 'locked', order: 7 }).svg).not.toContain('<text');
    expect(markerSvg({ category: 'museum', state: 'active', optional: true }).svg).toContain(
      'stroke-dasharray',
    );
    expect(markerSvg({ category: 'museum', state: 'next', dwell: 0.5 }).svg).toContain(
      'rotate(-90',
    );
  });

  it('flags a warning with shape too: an amber ring and a "!" badge', () => {
    expect(MAP_COLORS.warning).toMatch(/^#[0-9A-F]{6}$/);
    const plain = markerSvg({ category: 'museum', state: 'active', order: 2 });
    const warning = markerSvg({ category: 'museum', state: 'active', order: 2, warning: true });
    expect(plain.svg).not.toContain(MAP_COLORS.warning);
    expect(warning.svg).toContain(`stroke="${MAP_COLORS.warning}"`);
    expect(warning.svg).toContain('>!</text>');
    // Keeps the order badge and the size (same anchor on the map).
    expect(warning.svg).toContain('>2</text>');
    expect(warning.size).toBe(plain.size);
    expect(markerSvg({ category: 'museum', state: 'active', order: 2, warning: false }).svg).toBe(
      plain.svg,
    );
  });

  it('paints Explore markers with their route colour and POIs differently', () => {
    expect(
      markerSvg({ category: 'church', state: 'explore', color: ROUTE_COLORS[2] }).svg,
    ).toContain(ROUTE_COLORS[2]);
    expect(markerSvg({ category: 'church', state: 'poi' }).svg).toContain('fill="#FFFFFF"');
  });

  it('caches each look as a data URL', () => {
    const a = markerImage({ category: 'nature', state: 'completed', order: 1 });
    const b = markerImage({ category: 'nature', state: 'completed', order: 1 });
    expect(a).toBe(b);
    expect(a.url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('caches the warning look under its own key', () => {
    const plain = markerImage({ category: 'food', state: 'active', order: 4 });
    const warning = markerImage({ category: 'food', state: 'active', order: 4, warning: true });
    expect(warning).not.toBe(plain);
    expect(warning.url).not.toBe(plain.url);
    expect(markerImage({ category: 'food', state: 'active', order: 4, warning: true })).toBe(
      warning,
    );
  });
});

describe('zone circles', () => {
  it('turns a fixed colour into the SDK [r, g, b, a]', () => {
    expect(rgba('#C4491F', 0.1)).toEqual([196, 73, 31, 0.1]);
  });

  it('keeps the run zone look and draws overlapping zones in amber, stronger', () => {
    // The run's target zone, as before: accent at 10 % with a 40 % outline.
    expect(ZONE_LOOKS.default).toEqual({
      fill: [196, 73, 31, 0.1],
      outline: [196, 73, 31, 0.4],
      width: 1.5,
    });
    const amber = rgba(MAP_COLORS.warning, 1).slice(0, 3);
    expect(ZONE_LOOKS.warning.fill.slice(0, 3)).toEqual(amber);
    expect(ZONE_LOOKS.warning.outline.slice(0, 3)).toEqual(amber);
    expect(ZONE_LOOKS.warning.width).toBeGreaterThan(ZONE_LOOKS.default.width);
  });
});

/** WCAG relative luminance of a "#RRGGBB" colour. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = rgba(hex, 1)
    .slice(0, 3)
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe('the activities on the Explore map', () => {
  const activities = ['walk', 'run', 'bike'] as const;

  it('are palette colours that read against the white ring of a pin and the casing of a line', () => {
    for (const activity of activities) {
      const { color } = ACTIVITY_LOOKS[activity];
      expect(color, activity).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrast(color, MAP_COLORS.white), activity).toBeGreaterThanOrEqual(4.5);
    }
    // Azulejo, Terracota and Atlántico (DESIGN §5.1), each its own.
    expect(activities.map((activity) => ACTIVITY_LOOKS[activity].color)).toEqual([
      '#1E4FA3',
      '#C4491F',
      '#0B7A75',
    ]);
  });

  it('paint a pin with the activity colour and keep its category icon', () => {
    const { svg } = markerSvg({
      category: 'church',
      state: 'explore',
      color: ACTIVITY_LOOKS.bike.color,
    });
    expect(svg).toContain(`fill="${ACTIVITY_LOOKS.bike.color}"`);
    // The icon is drawn in white over it.
    expect(svg).toContain('stroke="#FFFFFF"');
  });

  it('draw the legend sample of a style with the dashes of the line', () => {
    expect(LINE_SWATCH_DASH.solid).toBeUndefined();
    expect(LINE_SWATCH_DASH['long-dash']).toBeDefined();
    expect(LINE_SWATCH_DASH.dash).toBeDefined();
    expect(LINE_SWATCH_DASH['long-dash']).not.toBe(LINE_SWATCH_DASH.dash);
  });
});

describe('route lines', () => {
  it('are thicker when highlighted and thinner and fainter when another one is', () => {
    const normal = lineLook('normal');
    const strong = lineLook('strong');
    const dim = lineLook('dim');
    expect(lineLook()).toEqual(normal);
    expect(strong.width).toBeGreaterThan(normal.width);
    expect(normal.width).toBeGreaterThan(dim.width);
    expect(normal.alpha).toBe(1);
    expect(strong.alpha).toBe(1);
    expect(dim.alpha).toBeLessThan(0.5);
    expect(dim.casingAlpha).toBeLessThan(normal.casingAlpha);
  });

  it('keep a casing wider than the stroke, on every emphasis', () => {
    for (const emphasis of ['normal', 'strong', 'dim'] as const) {
      const look = lineLook(emphasis);
      expect(look.casing, emphasis).toBeGreaterThan(look.width);
    }
  });

  it('are 25 % thicker in "Sol", casing included', () => {
    for (const emphasis of ['normal', 'strong', 'dim'] as const) {
      const small = lineLook(emphasis);
      const large = lineLook(emphasis, true);
      expect(large.width).toBeCloseTo(small.width * 1.25);
      expect(large.casing).toBeCloseTo(small.casing * 1.25);
      expect(large.alpha).toBe(small.alpha);
    }
  });

  it('get a strip to tap that is wider than any stroke, even a highlighted one in "Sol"', () => {
    expect(LINE_HIT_WIDTH).toBeGreaterThan(lineLook('strong', true).casing * 2);
  });
});

describe('faded markers', () => {
  it('keep their shape and size but let the map show through', () => {
    const plain = markerSvg({ category: 'museum', state: 'explore', color: '#1E4FA3' });
    const faded = markerSvg({ category: 'museum', state: 'explore', color: '#1E4FA3', dim: true });
    expect(faded.size).toBe(plain.size);
    expect(plain.svg).not.toContain('<g opacity=');
    expect(faded.svg).toMatch(/<g opacity="0\.\d+">/);
    expect(faded.svg).toContain('fill="#1E4FA3"');
    expect(
      markerSvg({ category: 'museum', state: 'explore', color: '#1E4FA3', dim: false }).svg,
    ).toBe(plain.svg);
  });

  it('are cached under their own look', () => {
    const look = { category: 'museum', state: 'explore', color: '#1E4FA3' } as const;
    expect(markerImage({ ...look, dim: true })).not.toBe(markerImage(look));
    expect(markerImage({ ...look, dim: true })).toBe(markerImage({ ...look, dim: true }));
  });
});
