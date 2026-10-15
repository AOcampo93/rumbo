import { PLAYBACK_RATE, pcm16ToFloat, rms } from './pcm.ts';

// Gapless playback of streamed PCM16 chunks plus a level meter for the character's jaw.
// A new answer starts with a cushion (the first chunks come unevenly, and a busy phone
// handles them late); when a chunk is late anyway the cushion grows; every start fades in
// and an interruption fades out, so neither clicks.

/** The slice of the Web Audio API we use (a fake implements it in tests). */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
  createAnalyser(): AnalyserLike;
  createGain(): GainLike;
}
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface GainLike {
  readonly gain: AudioParamLike;
  connect(node: unknown): unknown;
}
export interface AudioBufferLike {
  readonly duration: number;
  copyToChannel(data: Float32Array, channel: number): void;
}
export interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  connect(node: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface AnalyserLike {
  fftSize: number;
  connect(node: unknown): unknown;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

export type SpeakingState = 'speaking' | 'idle';

/** Seconds of audio queued before a new answer starts. */
export const START_LEAD = 0.2;
/** Seconds ahead of the clock to restart after a late chunk, at first; it grows from there. */
export const LEAD = 0.08;
export const MAX_LEAD = 0.3;
const LEAD_STEP = 0.04;
/** Fade-in at every start and fade-out on interrupt (seconds): no clicks. */
export const FADE_IN = 0.008;
export const FADE_OUT = 0.015;

export interface PcmPlayerOptions {
  /** Seconds ahead of the clock to restart after an underrun (grows up to MAX_LEAD). */
  lead?: number;
  /** Seconds queued before the first chunk of an answer. */
  startLead?: number;
  rate?: number;
  onState?: (state: SpeakingState) => void;
}

export class PcmPlayer {
  private lead: number;
  private readonly startLead: number;
  private readonly rate: number;
  private readonly analyser: AnalyserLike;
  private readonly output: GainLike;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly sources = new Set<AudioSourceLike>();
  private nextTime = 0;
  private speaking = false;
  /** Bumped by interrupt(): sources of an older turn ending late must not flip the state. */
  private generation = 0;
  onState: ((state: SpeakingState) => void) | undefined;

  constructor(
    private readonly ctx: AudioContextLike,
    options: PcmPlayerOptions = {},
  ) {
    this.lead = options.lead ?? LEAD;
    this.startLead = options.startLead ?? START_LEAD;
    this.rate = options.rate ?? PLAYBACK_RATE;
    this.onState = options.onState;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(ctx.destination);
    // Sources -> output gain (for the fade-out) -> analyser (the jaw) -> speakers.
    this.output = ctx.createGain();
    this.output.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Call from a user gesture (iOS keeps the context suspended until then). */
  unlock(): Promise<void> {
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
  }

  /** Queue a PCM16 LE mono chunk right after the previous one. */
  enqueue(chunk: ArrayBuffer): void {
    const data = pcm16ToFloat(chunk);
    if (data.length === 0) return;
    const now = this.ctx.currentTime;
    let when = this.nextTime;
    let fresh = false;
    if (this.sources.size === 0) {
      // A new answer: start with a cushion.
      when = now + this.startLead;
      fresh = true;
    } else if (this.nextTime <= now) {
      // A chunk came late and the queue ran dry: restart ahead of the clock, with more room.
      when = now + this.lead;
      this.lead = Math.min(MAX_LEAD, this.lead + LEAD_STEP);
      fresh = true;
    }
    if (fresh) fadeIn(data, Math.round(this.rate * FADE_IN));
    const buffer = this.ctx.createBuffer(1, data.length, this.rate);
    buffer.copyToChannel(data, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    this.nextTime = when + buffer.duration;
    const generation = this.generation;
    source.onended = () => {
      this.sources.delete(source);
      if (generation === this.generation && this.sources.size === 0) this.setSpeaking(false);
    };
    this.sources.add(source);
    source.start(when);
    this.setSpeaking(true);
  }

  /** Stop everything now (the model was interrupted). */
  interrupt(): void {
    this.generation++;
    const now = this.ctx.currentTime;
    const gain = this.output.gain;
    if (this.sources.size > 0) {
      // A quick fade instead of a cut, then full volume again for the next answer.
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + FADE_OUT);
      gain.setValueAtTime(1, now + FADE_OUT + 0.005);
    }
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop(now + FADE_OUT);
      } catch {
        // Already ended.
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.setSpeaking(false);
  }

  /** RMS of what is playing right now, roughly 0..0.5 for speech. */
  level(): number {
    if (!this.speaking) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return rms(this.samples);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    this.onState?.(value ? 'speaking' : 'idle');
  }
}

/** Ramps the first samples up from silence, in place. */
function fadeIn(data: Float32Array, samples: number): void {
  const n = Math.min(samples, data.length);
  for (let i = 0; i < n; i++) data[i] = (data[i] as number) * (i / n);
}
