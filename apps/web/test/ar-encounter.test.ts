import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/ar/character.ts';
import { Encounter, type EncounterPhase } from '../src/ar/encounter.ts';
import { SCENES, sceneFromParams } from '../src/ar/scenes.ts';

// The encounter scene's script: two soldiers fight; the visitor stops them to talk to one;
// they go back to the fight when the talk ends.

class FakeAnimator {
  states: CharacterState[] = [];
  private pending: (() => void) | undefined;
  setState(state: CharacterState, done?: () => void) {
    this.states.push(state);
    this.pending = done;
  }
  /** The one-shot clip in progress ends. */
  finishClip() {
    const done = this.pending;
    this.pending = undefined;
    done?.();
  }
  get state() {
    return this.states.at(-1);
  }
}

function setup() {
  const pt = new FakeAnimator();
  const al = new FakeAnimator();
  const phases: Array<[EncounterPhase, string | null]> = [];
  const encounter = new Encounter(
    [
      { id: 'soldado_portugues', animator: pt },
      { id: 'soldado_almoravide', animator: al },
    ],
    (phase, speaker) => phases.push([phase, speaker]),
  );
  encounter.start();
  return { encounter, pt, al, phases };
}

describe('the encounter', () => {
  it('starts with both fighting, facing each other', () => {
    const { encounter, pt, al } = setup();
    expect([pt.state, al.state]).toEqual(['fight', 'fight']);
    expect(encounter.phase).toBe('fighting');
    expect(encounter.facing('soldado_portugues')).toBe('opponent');
  });

  it('stops both when the visitor talks to one: they sheathe, wait, and he answers', () => {
    const { encounter, pt, al, phases } = setup();
    expect(encounter.talkTo('soldado_almoravide')).toBe(true);
    expect(encounter.phase).toBe('stopping');
    expect([pt.state, al.state]).toEqual(['sheathe', 'sheathe']);
    // The chosen one turns to the visitor at once; the other keeps an eye on his opponent.
    expect(encounter.facing('soldado_almoravide')).toBe('visitor');
    expect(encounter.facing('soldado_portugues')).toBe('opponent');
    pt.finishClip();
    expect(encounter.phase).toBe('stopping');
    al.finishClip();
    expect(encounter.phase).toBe('talking');
    expect([pt.state, al.state]).toEqual(['idle', 'idle']);
    expect(phases.at(-1)).toEqual(['talking', 'soldado_almoravide']);

    encounter.speaking(true);
    expect([pt.state, al.state]).toEqual(['idle', 'talking']);
    encounter.speaking(false);
    expect(al.state).toBe('idle');
  });

  it('goes back to the fight when the talk ends: both draw, then fight', () => {
    const { encounter, pt, al, phases } = setup();
    encounter.talkTo('soldado_portugues');
    pt.finishClip();
    al.finishClip();
    encounter.finish();
    expect(encounter.phase).toBe('resuming');
    expect(encounter.speaker).toBeNull();
    expect([pt.state, al.state]).toEqual(['draw', 'draw']);
    pt.finishClip();
    al.finishClip();
    expect([pt.state, al.state]).toEqual(['fight', 'fight']);
    expect(phases.at(-1)).toEqual(['fighting', null]);
    // Speaking does nothing outside a talk.
    encounter.speaking(true);
    expect(pt.state).toBe('fight');
  });

  it('switches who answers without starting over, and ignores strangers', () => {
    const { encounter, pt, al } = setup();
    encounter.talkTo('soldado_portugues');
    pt.finishClip();
    al.finishClip();
    encounter.speaking(true);
    expect(encounter.talkTo('soldado_almoravide')).toBe(true);
    expect(encounter.phase).toBe('talking');
    expect(encounter.speaker).toBe('soldado_almoravide');
    expect(pt.state).toBe('idle');
    expect(encounter.talkTo('pirata')).toBe(false);
  });

  it('can be stopped again while drawing, and finished while stopping', () => {
    const { encounter, pt, al } = setup();
    encounter.talkTo('soldado_portugues');
    encounter.finish();
    expect(encounter.phase).toBe('resuming');
    encounter.talkTo('soldado_almoravide');
    expect(encounter.phase).toBe('stopping');
    pt.finishClip();
    al.finishClip();
    expect(encounter.phase).toBe('talking');
  });
});

describe('the scenes', () => {
  it('reads the scene from the link, the first version included', () => {
    expect(sceneFromParams(new URLSearchParams('scene=asalto_1140')).kind).toBe('encounter');
    expect(sceneFromParams(new URLSearchParams('character=artesano')).id).toBe('artesano');
    expect(sceneFromParams(new URLSearchParams('scene=nope')).id).toBe('artesano');
    expect(sceneFromParams(new URLSearchParams('')).id).toBe('artesano');
  });

  it('names its characters in the three languages, with the API ids', () => {
    const ids = Object.values(SCENES).flatMap((scene) => scene.actors.map((actor) => actor.id));
    expect(ids).toEqual([
      'artesano',
      'soldado_portugues',
      'soldado_almoravide',
      'afonso_henriques',
    ]);
    for (const scene of Object.values(SCENES)) {
      for (const actor of scene.actors) {
        expect(Object.keys(actor.name)).toEqual(['es', 'en', 'pt']);
        expect(actor.model).toMatch(/^\/ra_test\/models\/[a-z_]+\.glb$/);
      }
    }
    // The encounter's soldiers can do the whole script.
    for (const actor of SCENES.asalto_1140!.actors) {
      expect(Object.keys(actor.clips).sort()).toEqual(
        ['draw', 'fight', 'idle', 'sheathe', 'talking'].sort(),
      );
    }
  });
});

describe('the king', () => {
  it('is a guide of his own, with his Mixamo jaw (already shut when idle)', () => {
    const king = SCENES.afonso_henriques!;
    expect(king.kind).toBe('guide');
    expect(king.actors[0]?.jaw).toEqual({ bone: 'mixamorig2:Jaw', closeDeg: 0 });
    expect(sceneFromParams(new URLSearchParams('scene=afonso_henriques')).id).toBe(
      'afonso_henriques',
    );
  });
});
