import { describe, expect, it } from 'vitest';
import {
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
