import {
  AnimationClip,
  Bone,
  Group,
  LoopOnce,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  CharacterAnimator,
  CLIP_NAMES,
  CROSSFADE_SECONDS,
  findBone,
  heldPose,
  IDLE_CLOSE_DEG,
  JAW_AXIS,
  MAX_JAW_DEG,
  jawAngle,
  levelToMouthOpen,
  type ActionLike,
  type MixerLike,
} from '../src/ar/character.ts';

const DEG = Math.PI / 180;

class FakeAction implements ActionLike {
  calls: string[] = [];
  clampWhenFinished = false;
  constructor(readonly name: string) {}
  setLoop(mode: number, repetitions: number) {
    this.calls.push(`setLoop:${mode === LoopOnce ? 'once' : mode}:${repetitions}`);
    return this;
  }
  reset() {
    this.calls.push('reset');
    return this;
  }
  play() {
    this.calls.push('play');
    return this;
  }
  fadeIn(s: number) {
    this.calls.push(`fadeIn:${s}`);
    return this;
  }
  crossFadeFrom(from: ActionLike, s: number, warp: boolean) {
    this.calls.push(`crossFadeFrom:${(from as unknown as FakeAction).name}:${s}:${warp}`);
    return this;
  }
}
class FakeMixer implements MixerLike {
  actions = new Map<string, FakeAction>();
  updates: number[] = [];
  clipAction(clip: AnimationClip) {
    const a = new FakeAction(clip.name);
    this.actions.set(clip.name, a);
    return a;
  }
  update(dt: number) {
    this.updates.push(dt);
  }
}

const clips = [
  new AnimationClip(CLIP_NAMES.idle, 1, []),
  new AnimationClip(CLIP_NAMES.talking!, 1, []),
];

function setup() {
  const mixer = new FakeMixer();
  const jaw = { quaternion: new Quaternion().setFromAxisAngle(JAW_AXIS, 2) };
  const rest = jaw.quaternion.clone();
  return { mixer, jaw, rest, animator: new CharacterAnimator(mixer, clips, jaw) };
}

describe('jaw mapping', () => {
  it('maps the level to 0..1 monotonically and saturates', () => {
    expect(levelToMouthOpen(0)).toBe(0);
    expect(levelToMouthOpen(-1)).toBe(0);
    expect(levelToMouthOpen(0.05)).toBeLessThan(levelToMouthOpen(0.1));
    expect(levelToMouthOpen(10)).toBe(1);
  });

  it('opens up to the maximum while talking and clamps', () => {
    expect(jawAngle('talking', 0)).toBe(0);
    expect(jawAngle('talking', 1)).toBeCloseTo(MAX_JAW_DEG * DEG);
    expect(jawAngle('talking', 5)).toBeCloseTo(MAX_JAW_DEG * DEG);
    expect(jawAngle('talking', -1)).toBe(0);
  });

  it('keeps the mouth closed while idle, whatever the level', () => {
    expect(jawAngle('idle', 1)).toBe(0);
    expect(jawAngle('idle', 0)).toBe(0);
  });
});

describe('character state machine', () => {
  it('starts a clip without a crossfade the first time', () => {
    const { animator, mixer } = setup();
    animator.setState('idle');
    expect(mixer.actions.get(CLIP_NAMES.idle)!.calls).toEqual(['reset', 'play', 'fadeIn:0']);
    expect(animator.state).toBe('idle');
  });

  it('crossfades between clips in ~0.3 s and ignores repeats', () => {
    const { animator, mixer } = setup();
    animator.setState('idle');
    animator.setState('talking');
    animator.setState('talking');
    const talking = mixer.actions.get(CLIP_NAMES.talking!)!;
    expect(CROSSFADE_SECONDS).toBeCloseTo(0.3);
    expect(talking.calls).toEqual(['reset', 'play', `crossFadeFrom:${CLIP_NAMES.idle}:0.3:false`]);
    animator.setState('idle');
    expect(mixer.actions.get(CLIP_NAMES.idle)!.calls.at(-1)).toBe(
      `crossFadeFrom:${CLIP_NAMES.talking!}:0.3:false`,
    );
  });

  it('ignores a state with no clip', () => {
    const mixer = new FakeMixer();
    const animator = new CharacterAnimator(mixer, [clips[0]!], null);
    animator.setState('talking');
    expect(animator.state).toBeNull();
  });

  it('opens the mouth from the closed pose by the voice alone, whatever the talking clip does', () => {
    const { animator, mixer, jaw, rest } = setup();
    animator.setState('idle');
    animator.update(0.016);
    animator.setState('talking');
    // The talking clip opens the jaw on its own (the fake mixer leaves it where we put it).
    jaw.quaternion.copy(rest).multiply(new Quaternion().setFromAxisAngle(JAW_AXIS, 10 * DEG));
    animator.setMouthOpen(1);
    animator.update(0.016);
    expect(mixer.updates).toEqual([0.016, 0.016]);
    const expected = rest
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(JAW_AXIS, (MAX_JAW_DEG - IDLE_CLOSE_DEG) * DEG));
    expect(jaw.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    // Silence closes it again, even mid-sentence.
    jaw.quaternion.copy(rest).multiply(new Quaternion().setFromAxisAngle(JAW_AXIS, 10 * DEG));
    animator.setMouthOpen(0);
    animator.update(0.016);
    expect(jaw.quaternion.angleTo(rest)).toBeCloseTo(IDLE_CLOSE_DEG * DEG, 6);
  });

  it('leaves the jaw to the clip until it has seen the closed mouth', () => {
    const { animator, jaw, rest } = setup();
    animator.setState('talking');
    animator.setMouthOpen(1);
    animator.update(0.016);
    expect(jaw.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });

  it('holds the jaw closed while idle even if a mouth level is set', () => {
    const { animator, jaw, rest } = setup();
    animator.setState('idle');
    animator.setMouthOpen(1);
    animator.update(0.016);
    expect(jaw.quaternion.angleTo(rest)).toBeCloseTo(IDLE_CLOSE_DEG * DEG, 6);
  });
});

describe('the soldiers: fight, sheathe and draw', () => {
  const SOLDIER = {
    idle: 'Idle',
    talking: 'Hablando',
    fight: 'Luchando',
    draw: 'Desenvainar',
    sheathe: 'Envainar',
  };
  const soldierClips = [
    new AnimationClip('Idle', 10, []),
    new AnimationClip('Hablando', 4, []),
    new AnimationClip('Luchando', 2.2, []),
    new AnimationClip('Desenvainar', 1.2, []),
    new AnimationClip('Envainar', 1.2, []),
  ];

  it('plays the sword in and out once, holding the last frame, and reports when done', () => {
    const mixer = new FakeMixer();
    const animator = new CharacterAnimator(mixer, soldierClips, null, SOLDIER);
    expect(mixer.actions.get('Envainar')!.calls).toEqual(['setLoop:once:1']);
    expect(mixer.actions.get('Envainar')!.clampWhenFinished).toBe(true);
    expect(mixer.actions.get('Luchando')!.clampWhenFinished).toBe(false);
    animator.setState('fight');
    let done = 0;
    animator.setState('sheathe', () => (done += 1));
    animator.update(1);
    expect(done).toBe(0);
    animator.update(0.25);
    expect(done).toBe(1);
    animator.update(5);
    expect(done).toBe(1);
  });

  it('a new state drops the report of an unfinished one', () => {
    const animator = new CharacterAnimator(new FakeMixer(), soldierClips, null, SOLDIER);
    let sheathed = false;
    animator.setState('sheathe', () => (sheathed = true));
    animator.update(0.5);
    animator.setState('fight');
    animator.update(5);
    expect(sheathed).toBe(false);
    expect(animator.state).toBe('fight');
  });

  it("skips what the model lacks: the craftsman can't draw, but the sequence goes on", () => {
    const animator = new CharacterAnimator(new FakeMixer(), clips, null);
    let drawn = false;
    animator.setState('draw', () => (drawn = true));
    expect(drawn).toBe(true);
    expect(animator.has('fight')).toBe(false);
    expect(animator.has('idle')).toBe(true);
  });

  it('leaves the jaw to the clip while fighting', () => {
    const jaw = { quaternion: new Quaternion().setFromAxisAngle(JAW_AXIS, 2) };
    const animator = new CharacterAnimator(new FakeMixer(), soldierClips, jaw, SOLDIER);
    animator.setState('idle');
    animator.update(0.016);
    animator.setState('fight');
    const fromClip = new Quaternion().setFromAxisAngle(JAW_AXIS, 0.3);
    jaw.quaternion.copy(fromClip);
    animator.setMouthOpen(1);
    animator.update(0.016);
    expect(jaw.quaternion.angleTo(fromClip)).toBeLessThan(1e-6);
  });
});

describe('the sword held while fighting', () => {
  const draw = new AnimationClip('Desenvainar', 1, [
    new QuaternionKeyframeTrack('Espada.quaternion', [0, 1], [0, 0, 0, 1, 0.7071, 0, 0, 0.7071]),
    new VectorKeyframeTrack('Espada.scale', [0, 1], [0, 0, 0, 97, 97, 97]),
  ]);

  it('takes the pose the draw clip ends in, when the fight clip leaves the sword alone', () => {
    const fight = new AnimationClip('Luchando', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ]);
    const pose = heldPose([draw, fight], 'Espada', 'Desenvainar', 'Luchando');
    expect(pose?.scale.toArray()).toEqual([97, 97, 97]);
    expect(pose?.quaternion.x).toBeCloseTo(0.7071);
    expect(pose?.quaternion.w).toBeCloseTo(0.7071);
  });

  it('is none when the fight clip moves the sword itself, or a clip is missing', () => {
    const fight = new AnimationClip('Luchando', 2, [
      new VectorKeyframeTrack('Espada.scale', [0, 1], [97, 97, 97, 97, 97, 97]),
    ]);
    expect(heldPose([draw, fight], 'Espada', 'Desenvainar', 'Luchando')).toBeNull();
    expect(heldPose([draw], 'Espada', 'Desenvainar', 'Luchando')).toBeNull();
    expect(heldPose([draw, fight], 'Cimitarra', 'Desenvainar', 'Luchando')).toBeNull();
  });
});

describe('finding the jaw', () => {
  it('finds a Mixamo jaw under the name the loader gives it, and a plain one as is', () => {
    const root = new Group();
    const mixamo = new Bone();
    mixamo.name = 'mixamorig2Jaw'; // what GLTFLoader makes of "mixamorig2:Jaw"
    const plain = new Bone();
    plain.name = 'jaw';
    root.add(mixamo, plain);
    expect(findBone(root, 'mixamorig2:Jaw')).toBe(mixamo);
    expect(findBone(root, 'jaw')).toBe(plain);
    expect(findBone(root, 'mixamorig2:Head')).toBeNull();
  });
});
