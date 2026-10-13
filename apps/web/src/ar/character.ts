import {
  AnimationMixer,
  Box3,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The tour-guide character: a skinned glTF with two looping clips and a "jaw" bone that the
// voice level drives instead of the clips. No DOM here beyond what three needs to load.

export type CharacterState = 'idle' | 'talking';

/** State -> clip name. Extend with greeting / showing / disappear when those clips exist. */
export const CLIP_NAMES: Record<CharacterState, string> = {
  idle: 'Idle_BocaCerrada',
  talking: 'Hablando',
};

export const JAW_BONE = 'jaw';
/** The jaw opens by rotating +X in its own space (checked in both clips' keyframes). */
export const JAW_AXIS = new Vector3(1, 0, 0);
/**
 * Widest opening from the closed mouth while talking, in degrees. The voice alone opens it:
 * the talking clip's own jaw motion (~10 degrees) is replaced, not added to, or he'd shout.
 */
export const MAX_JAW_DEG = 10;
/** How far below the idle clip's jaw the closed mouth is, so it really looks shut. */
export const IDLE_CLOSE_DEG = 4;
export const CROSSFADE_SECONDS = 0.3;

const DEG = Math.PI / 180;

/** Voice level (RMS, 0..~0.4) to a mouth opening in 0..1, with a little gain and a soft knee. */
export function levelToMouthOpen(level: number, gain = 4): number {
  const v = Math.max(0, level) * gain;
  return Math.min(1, v / (1 + 0.5 * v));
}

/** Jaw angle in radians from the closed mouth: an opening 0..1 (clamped) while talking, 0 idle. */
export function jawAngle(state: CharacterState, mouthOpen: number): number {
  if (state === 'idle') return 0;
  return Math.max(0, Math.min(1, mouthOpen)) * MAX_JAW_DEG * DEG;
}

/** The slice of AnimationAction that the state machine needs (a fake implements it in tests). */
export interface ActionLike {
  reset(): ActionLike;
  play(): ActionLike;
  fadeIn(seconds: number): ActionLike;
  crossFadeFrom(from: ActionLike, seconds: number, warp: boolean): ActionLike;
}
export interface MixerLike {
  clipAction(clip: AnimationClip): ActionLike;
  update(dt: number): unknown;
}
/** Just the rotation of the jaw bone. */
export interface JawLike {
  quaternion: Quaternion;
}

export class CharacterAnimator {
  private current: CharacterState | null = null;
  private currentAction: ActionLike | null = null;
  private mouthOpen = 0;
  /** The closed mouth: the idle clip's jaw a little further shut, taken on the first idle frame. */
  private closed: Quaternion | null = null;
  private readonly actions = new Map<CharacterState, ActionLike>();
  private readonly offset = new Quaternion();

  constructor(
    private readonly mixer: MixerLike,
    clips: readonly AnimationClip[],
    private readonly jaw: JawLike | null,
  ) {
    for (const state of Object.keys(CLIP_NAMES) as CharacterState[]) {
      const clip = clips.find((c) => c.name === CLIP_NAMES[state]);
      if (clip) this.actions.set(state, this.mixer.clipAction(clip));
    }
  }

  get state(): CharacterState | null {
    return this.current;
  }

  setState(state: CharacterState): void {
    if (state === this.current) return;
    const next = this.actions.get(state);
    if (!next) return;
    next.reset().play();
    if (this.currentAction) next.crossFadeFrom(this.currentAction, CROSSFADE_SECONDS, false);
    else next.fadeIn(0);
    this.currentAction = next;
    this.current = state;
  }

  /** 0..1, applied on the next update() while talking. */
  setMouthOpen(value: number): void {
    this.mouthOpen = Math.max(0, Math.min(1, value));
  }

  update(dt: number): void {
    this.mixer.update(dt);
    // After the mixer, which has just posed the jaw from the clip of this frame.
    if (!this.jaw || !this.current) return;
    if (!this.closed && this.current === 'idle') {
      this.offset.setFromAxisAngle(JAW_AXIS, -IDLE_CLOSE_DEG * DEG);
      this.closed = this.jaw.quaternion.clone().multiply(this.offset);
    }
    if (!this.closed) return;
    this.offset.setFromAxisAngle(JAW_AXIS, jawAngle(this.current, this.mouthOpen));
    this.jaw.quaternion.copy(this.closed).multiply(this.offset);
  }
}

export interface Character {
  root: Object3D;
  animator: CharacterAnimator;
  /** Height in metres, measured from the loaded model. */
  height: number;
}

export async function loadCharacter(url: string): Promise<Character> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  const jaw = root.getObjectByName(JAW_BONE) ?? null;
  const mixer = new AnimationMixer(root);
  const animator = new CharacterAnimator(mixer, gltf.animations, jaw);
  root.traverse((o) => {
    o.frustumCulled = false; // skinned bounds don't follow the animation
  });
  animator.setState('idle');
  const size = new Vector3();
  new Box3().setFromObject(root).getSize(size);
  return { root, animator, height: size.y };
}
