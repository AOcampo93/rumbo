import { Group, PointLight, Sprite } from 'three';
import { describe, expect, it } from 'vitest';
import { addPropLight, flicker, flickerLights } from '../src/ar/props.ts';
import { SCENES } from '../src/ar/scenes.ts';

// The props that keep the characters company, and the lantern's light.

describe('the props of the scenes', () => {
  it('put a lantern post by the sentinel, lit, and the banner by the king', () => {
    const sentinel = SCENES.centinela!.props!;
    expect(sentinel.map((prop) => prop.model)).toEqual(['/ra_test/models/poste_linterna.glb']);
    expect(sentinel[0]!.light).toMatchObject({ y: 1.05, color: 0xffb04a });
    const king = SCENES.afonso_henriques!.props!;
    expect(king.map((prop) => prop.model)).toEqual(['/ra_test/models/bandera_portuguesa.glb']);
    expect(king[0]!.light).toBeUndefined();
  });

  it('stand clear of the character', () => {
    for (const scene of Object.values(SCENES)) {
      for (const prop of scene.props ?? []) {
        for (const actor of scene.actors) {
          expect(Math.hypot(prop.x - actor.x, prop.z - actor.z), prop.id).toBeGreaterThan(0.7);
        }
      }
    }
  });
});

describe('the lantern light', () => {
  it('flickers around 1 without leaving 0.8..1.15', () => {
    const values = Array.from({ length: 2000 }, (_, i) => flicker(i * 0.013));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...values)).toBeLessThanOrEqual(1.15);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeCloseTo(1, 1);
    expect(new Set(values.map((v) => v.toFixed(3))).size).toBeGreaterThan(100);
  });

  it('puts a point light and a halo where the prop glows, and flickers them', () => {
    const post = new Group();
    const lit = addPropLight(post, {
      x: 0.2,
      y: 1,
      z: 0.1,
      color: 0xffb04a,
      intensity: 2,
      distance: 4,
      halo: 0.5,
    });
    expect(lit.light).toBeInstanceOf(PointLight);
    expect(lit.halo).toBeInstanceOf(Sprite);
    expect(post.children).toEqual([lit.light, lit.halo]);
    expect(lit.light.position.toArray()).toEqual([0.2, 1, 0.1]);
    expect(lit.halo.scale.x).toBe(0.5);
    flickerLights([lit], 1.234);
    expect(lit.light.intensity).toBeCloseTo(2 * flicker(1.234));
  });
});
