import { PLAYBACK_RATE, pcm16ToFloat, rms } from './pcm.ts';

// Gapless playback of streamed PCM16 chunks plus a level meter for the character's jaw.

/** The slice of the Web Audio API we use (a fake implements it in tests). */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
  createAnalyser(): AnalyserLike;
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
  stop(): void;
}
export interface AnalyserLike {
  fftSize: number;
  connect(node: unknown): unknown;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

export type SpeakingState = 'speaking' | 'idle';

export interface PcmPlayerOptions {
  /** Seconds between "now" and the first chunk of a burst, to absorb scheduling jitter. */
  lead?: number;
  rate?: number;
  onState?: (state: SpeakingState) => void;
}

export class PcmPlayer {
  private readonly lead: number;
  private readonly rate: number;
  private readonly analyser: AnalyserLike;
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
    this.lead = options.lead ?? 0.06;
    this.rate = options.rate ?? PLAYBACK_RATE;
    this.onState = options.onState;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(ctx.destination);
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
    const buffer = this.ctx.createBuffer(1, data.length, this.rate);
    buffer.copyToChannel(data, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);

    // After an underrun the queue is behind the clock: restart a little ahead of it.
    const when = Math.max(this.nextTime, this.ctx.currentTime + this.lead);
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
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
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
