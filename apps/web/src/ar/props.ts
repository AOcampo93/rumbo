import {
  AdditiveBlending,
  CanvasTexture,
  type Object3D,
  PointLight,
  Sprite,
  SpriteMaterial,
} from 'three';

// Props that keep a character company (a lantern post, a flag), and the light some of them
// give: a warm point light, a soft halo and a flame's flicker. No DOM here beyond the canvas
// three needs for the halo's texture.

/** A light where a prop glows, in the prop model's own space (metres). */
export interface PropLightDef {
  x: number;
  y: number;
  z: number;
  /** 0xRRGGBB. */
  color: number;
  /** Candela, as three's physically based lights take it. */
  intensity: number;
  /** How far it reaches (metres). */
  distance: number;
  /** Width of the halo (metres). */
  halo: number;
}

export interface PropLight {
  light: PointLight;
  halo: Sprite;
  intensity: number;
  haloOpacity: number;
}

/**
 * A flame's flicker, 1 on average: a few unrelated waves, so it never looks like a pulse.
 * Stays within 0.8..1.15.
 */
export function flicker(seconds: number): number {
  const wave =
    0.07 * Math.sin(seconds * 7.3) +
    0.05 * Math.sin(seconds * 13.1 + 1.7) +
    0.03 * Math.sin(seconds * 23.7 + 0.4);
  return Math.max(0.8, Math.min(1.15, 1 + wave));
}

let haloTexture: CanvasTexture | null = null;
/** A round soft glow, white in the middle (tinted by the sprite's colour). */
function haloMap(): CanvasTexture | null {
  if (haloTexture) return haloTexture;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new CanvasTexture(canvas);
  return haloTexture;
}

/** Lights a prop: a point light and a halo where it glows, children of the prop. */
export function addPropLight(prop: Object3D, def: PropLightDef): PropLight {
  const light = new PointLight(def.color, def.intensity, def.distance, 2);
  light.position.set(def.x, def.y, def.z);
  const halo = new Sprite(
    new SpriteMaterial({
      map: haloMap(),
      color: def.color,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.position.copy(light.position);
  halo.scale.setScalar(def.halo);
  prop.add(light, halo);
  return { light, halo, intensity: def.intensity, haloOpacity: 0.85 };
}

/** Flickers every light a little, like a flame. */
export function flickerLights(lights: readonly PropLight[], seconds: number): void {
  lights.forEach((item, i) => {
    const f = flicker(seconds + i * 3.1);
    item.light.intensity = item.intensity * f;
    item.halo.material.opacity = item.haloOpacity * (0.85 + 0.15 * f);
  });
}
