import type { CharacterState } from './character.ts';

// The script of an encounter scene (two soldiers, for now). They fight in a loop; when the
// visitor talks to one, both sheathe their swords and wait while he answers; when the talk
// ends, both draw again and go back to the fight. Pure logic: the animators do the rest, and
// the stage reads `facing()` to turn each one towards his opponent or the visitor.

export type EncounterPhase = 'fighting' | 'stopping' | 'talking' | 'resuming';

export interface EncounterActor {
  id: string;
  animator: { setState(state: CharacterState, done?: () => void): void };
}

export class Encounter {
  private current: EncounterPhase = 'fighting';
  private talker: string | null = null;

  constructor(
    private readonly actors: readonly EncounterActor[],
    private readonly onChange: (phase: EncounterPhase, speaker: string | null) => void = () => {},
  ) {}

  get phase(): EncounterPhase {
    return this.current;
  }

  /** Who the visitor talks to (while they stop or talk). */
  get speaker(): string | null {
    return this.talker;
  }

  start(): void {
    for (const actor of this.actors) actor.animator.setState('fight');
    this.set('fighting', null);
  }

  /** Stops the fight to talk to one of them; talking to the other one just changes who. */
  talkTo(id: string): boolean {
    if (!this.actors.some((actor) => actor.id === id)) return false;
    if (this.current === 'stopping' || this.current === 'talking') {
      if (this.talker !== id) {
        this.speakerActor()?.animator.setState('idle');
        this.set(this.current, id);
      }
      return true;
    }
    this.set('stopping', id);
    let left = this.actors.length;
    for (const actor of this.actors) {
      actor.animator.setState('sheathe', () => {
        actor.animator.setState('idle');
        left -= 1;
        if (left === 0 && this.current === 'stopping') this.set('talking', this.talker);
      });
    }
    return true;
  }

  /** The speaker's voice starts or stops: he talks or waits. */
  speaking(on: boolean): void {
    if (this.current !== 'talking') return;
    this.speakerActor()?.animator.setState(on ? 'talking' : 'idle');
  }

  /** The talk is over: both draw again and fight. */
  finish(): void {
    if (this.current === 'fighting' || this.current === 'resuming') return;
    this.set('resuming', null);
    let left = this.actors.length;
    for (const actor of this.actors) {
      actor.animator.setState('draw', () => {
        actor.animator.setState('fight');
        left -= 1;
        if (left === 0 && this.current === 'resuming') this.set('fighting', null);
      });
    }
  }

  /** Where one of them looks: at the visitor while he is the one talking, else at his opponent. */
  facing(id: string): 'opponent' | 'visitor' {
    return id === this.talker && (this.current === 'stopping' || this.current === 'talking')
      ? 'visitor'
      : 'opponent';
  }

  private speakerActor(): EncounterActor | undefined {
    return this.actors.find((actor) => actor.id === this.talker);
  }

  private set(phase: EncounterPhase, speaker: string | null): void {
    this.current = phase;
    this.talker = speaker;
    this.onChange(phase, speaker);
  }
}
