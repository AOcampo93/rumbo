import {
  AnimationMixer,
  Box3,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// A character of the AR scenes: a skinned glTF with its clips (idle, talking and, for the
// soldiers, fighting and drawing or sheathing the sword) and, when it has one, a "jaw" bone
// that the voice level drives instead of the clips. No DOM here beyond what three needs to load.

export type CharacterState = 'idle' | 'talking' | 'fight' | 'draw' | 'sheathe';

/** State -> clip name in the model. Every character has an idle; the rest are optional. */
export type ClipNames = { idle: string } & Partial<Record<CharacterState, string>>;

/** The craftsman's clips (the first model). */
export const CLIP_NAMES: ClipNames = {
  idle: 'Idle_BocaCerrada',
  talking: 'Hablando',
};

/** States that play once and then report back; the rest loop. */
export const ONE_SHOT_STATES: readonly CharacterState[] = ['draw', 'sheathe'];

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

/** Where three's Draco decoder is served (compressed models). */
export const DRACO_DECODER_PATH = '/ra_test/draco/';

const DEG = Math.PI / 180;

/** Voice level (RMS, 0..~0.4) to a mouth opening in 0..1, with a little gain and a soft knee. */
export function levelToMouthOpen(level: number, gain = 4): number {
  const v = Math.max(0, level) * gain;
  return Math.min(1, v / (1 + 0.5 * v));
}

/** Jaw angle in radians from the closed mouth: an opening 0..1 (clamped) while talking, else 0. */
export function jawAngle(state: CharacterState, mouthOpen: number): number {
  if (state !== 'talking') return 0;
  return Math.max(0, Math.min(1, mouthOpen)) * MAX_JAW_DEG * DEG;
}

/** The slice of AnimationAction that the state machine needs (a fake implements it in tests). */
export interface ActionLike {
  reset(): ActionLike;
  play(): ActionLike;
  fadeIn(seconds: number): ActionLike;
  crossFadeFrom(from: ActionLike, seconds: number, warp: boolean): ActionLike;
  setLoop(mode: typeof LoopOnce | typeof LoopRepeat, repetitions: number): ActionLike;
  clampWhenFinished: boolean;
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
  private readonly durations = new Map<CharacterState, number>();
  private readonly offset = new Quaternion();
  /** A one-shot clip in progress: how long it still runs and who to tell. */
  private oneShot: { left: number; done: (() => void) | undefined } | null = null;

  constructor(
    private readonly mixer: MixerLike,
    clips: readonly AnimationClip[],
    private readonly jaw: JawLike | null,
    names: ClipNames = CLIP_NAMES,
  ) {
    for (const [state, name] of Object.entries(names) as [CharacterState, string][]) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT_STATES.includes(state)) {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
      this.durations.set(state, clip.duration);
    }
  }

  get state(): CharacterState | null {
    return this.current;
  }

  has(state: CharacterState): boolean {
    return this.actions.has(state);
  }

  /**
   * Crossfades to a state. A one-shot state calls `done` once it has played; a state the
   * model lacks is skipped (a one-shot one reports done at once, so a sequence goes on).
   */
  setState(state: CharacterState, done?: () => void): void {
    const next = this.actions.get(state);
    if (!next) {
      if (ONE_SHOT_STATES.includes(state)) done?.();
      return;
    }
    if (state === this.current && !ONE_SHOT_STATES.includes(state)) return;
    this.oneShot = ONE_SHOT_STATES.includes(state)
      ? { left: this.durations.get(state) ?? 0, done }
      : null;
    next.reset().play();
    if (this.currentAction && this.currentAction !== next) {
      next.crossFadeFrom(this.currentAction, CROSSFADE_SECONDS, false);
    } else next.fadeIn(0);
    this.currentAction = next;
    this.current = state;
  }

  /** 0..1, applied on the next update() while talking. */
  setMouthOpen(value: number): void {
    this.mouthOpen = Math.max(0, Math.min(1, value));
  }

  update(dt: number): void {
    this.mixer.update(dt);
    if (this.oneShot) {
      this.oneShot.left -= dt;
      if (this.oneShot.left <= 0) {
        const { done } = this.oneShot;
        this.oneShot = null;
        done?.();
      }
    }
    // After the mixer, which has just posed the jaw from the clip of this frame.
    if (!this.jaw || !this.current) return;
    if (!this.closed && this.current === 'idle') {
      this.offset.setFromAxisAngle(JAW_AXIS, -IDLE_CLOSE_DEG * DEG);
      this.closed = this.jaw.quaternion.clone().multiply(this.offset);
    }
    // Only the voice moves the mouth: closed while idle or talking, the clip's own otherwise.
    if (!this.closed || (this.current !== 'idle' && this.current !== 'talking')) return;
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

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH));
  }
  return loader;
}

/** Loads a character; it starts in `initial` (idle unless told otherwise). */
export async function loadCharacter(
  url: string,
  names: ClipNames = CLIP_NAMES,
  initial: CharacterState = 'idle',
): Promise<Character> {
  const gltf = await gltfLoader().loadAsync(url);
  const root = gltf.scene;
  const jaw = root.getObjectByName(JAW_BONE) ?? null;
  const mixer = new AnimationMixer(root);
  const animator = new CharacterAnimator(mixer, gltf.animations, jaw, names);
  root.traverse((o) => {
    o.frustumCulled = false; // skinned bounds don't follow the animation
  });
  animator.setState(animator.has(initial) ? initial : 'idle');
  const size = new Vector3();
  new Box3().setFromObject(root).getSize(size);
  return { root, animator, height: size.y };
}
