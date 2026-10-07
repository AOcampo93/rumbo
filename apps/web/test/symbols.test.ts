import { describe, expect, it } from 'vitest';
import { markerImage, markerSvg, ROUTE_COLORS } from '../src/map/symbols.ts';

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
});
