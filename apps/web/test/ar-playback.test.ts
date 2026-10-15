import { describe, expect, it } from 'vitest';
import { floatToPcm16 } from '../src/ar/pcm.ts';
import {
  FADE_OUT,
  MAX_LEAD,
  PcmPlayer,
  START_LEAD,
  type AnalyserLike,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioSourceLike,
  type SpeakingState,
} from '../src/ar/playback.ts';

class FakeSource implements AudioSourceLike {
  buffer: AudioBufferLike | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  stoppedAt: number | undefined;
  connect() {}
  start(when = 0) {
    this.startedAt = when;
  }
  stop(when?: number) {
    this.stopped = true;
    this.stoppedAt = when;
  }
}
class FakeParam {
  value = 1;
  calls: string[] = [];
  setValueAtTime(v: number, t: number) {
    this.calls.push(`set ${v}@${t.toFixed(3)}`);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(`ramp ${v}@${t.toFixed(3)}`);
  }
  cancelScheduledValues(t: number) {
    this.calls.push(`cancel@${t.toFixed(3)}`);
  }
}
class FakeCtx implements AudioContextLike {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  sources: FakeSource[] = [];
  analyser: AnalyserLike & { fill: number } = {
    fftSize: 0,
    fill: 0.3,
    connect() {},
    getFloatTimeDomainData(a) {
      a.fill(this.fill);
    },
  };
  async resume() {
    this.state = 'running';
  }
  /** What each buffer was filled with. */
  data: Float32Array[] = [];
  gain = new FakeParam();
  createBuffer(_c: number, length: number, rate: number): AudioBufferLike {
    return {
      duration: length / rate,
      copyToChannel: (data: Float32Array) => {
        this.data.push(Float32Array.from(data));
      },
    };
  }
  createGain() {
    return { gain: this.gain, connect() {} };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createAnalyser() {
    return this.analyser;
  }
}

// 2400 samples at 24 kHz = 100 ms.
const chunk = () => floatToPcm16(new Float32Array(2400).fill(0.1));

function setup() {
  const ctx = new FakeCtx();
  const events: SpeakingState[] = [];
  const player = new PcmPlayer(ctx, { lead: 0.05, onState: (s) => events.push(s) });
  return { ctx, player, events };
}

describe('PcmPlayer', () => {
  it('unlocks a suspended context', async () => {
    const { ctx, player } = setup();
    await player.unlock();
    expect(ctx.state).toBe('running');
  });

  it('starts an answer with a cushion, then queues the chunks back to back', () => {
    const { ctx, player } = setup();
    ctx.currentTime = 10;
    player.enqueue(chunk());
    player.enqueue(chunk());
    player.enqueue(chunk());
    const starts = ctx.sources.map((s) => s.startedAt!);
    expect(starts[0]).toBeCloseTo(10 + START_LEAD);
    expect(starts[1]).toBeCloseTo(10.1 + START_LEAD);
    expect(starts[2]).toBeCloseTo(10.2 + START_LEAD);
  });

  it('restarts ahead of the clock after an underrun, with more room each time', () => {
    const { ctx, player } = setup();
    player.enqueue(chunk());
    ctx.currentTime = 5;
    player.enqueue(chunk());
    expect(ctx.sources[1]!.startedAt).toBeCloseTo(5.05);
    ctx.currentTime = 9;
    player.enqueue(chunk());
    expect(ctx.sources[2]!.startedAt).toBeCloseTo(9.09);
    for (let t = 20; t < 40; t += 2) {
      ctx.currentTime = t;
      player.enqueue(chunk());
    }
    expect(ctx.sources.at(-1)!.startedAt! - 38).toBeCloseTo(MAX_LEAD);
  });

  it('fades in at every start, never in the middle of an answer', () => {
    const { ctx, player } = setup();
    player.enqueue(chunk());
    player.enqueue(chunk());
    const [first, second] = ctx.data;
    expect(first![0]).toBe(0);
    expect(first![1]!).toBeLessThan(0.1);
    expect(first![1000]).toBeCloseTo(0.1);
    expect(second![0]).toBeCloseTo(0.1);
  });

  it('emits speaking once per turn and idle when the last source ends', () => {
    const { ctx, player, events } = setup();
    player.enqueue(chunk());
    player.enqueue(chunk());
    expect(events).toEqual(['speaking']);
    ctx.sources[0]!.onended!();
    expect(events).toEqual(['speaking']);
    ctx.sources[1]!.onended!();
    expect(events).toEqual(['speaking', 'idle']);
    player.enqueue(chunk());
    expect(events).toEqual(['speaking', 'idle', 'speaking']);
  });

  it('stops everything and goes idle on interrupt, ignoring late end events', () => {
    const { ctx, player, events } = setup();
    ctx.currentTime = 1;
    player.enqueue(chunk());
    player.enqueue(chunk());
    const [a, b] = ctx.sources;
    const lateEnd = a!.onended!;
    player.interrupt();
    expect(a!.stopped && b!.stopped).toBe(true);
    // A short fade, not a cut, and back to full volume for the next answer.
    expect(a!.stoppedAt).toBeCloseTo(1 + FADE_OUT);
    expect(ctx.gain.calls).toEqual([
      'cancel@1.000',
      'set 1@1.000',
      `ramp 0@${(1 + FADE_OUT).toFixed(3)}`,
      `set 1@${(1 + FADE_OUT + 0.005).toFixed(3)}`,
    ]);
    expect(events).toEqual(['speaking', 'idle']);
    player.enqueue(chunk());
    lateEnd(); // the old source ending must not cancel the new turn
    expect(events).toEqual(['speaking', 'idle', 'speaking']);
    expect(ctx.sources[2]!.startedAt).toBeCloseTo(1 + START_LEAD);
  });

  it('reports the RMS level only while speaking', () => {
    const { ctx, player } = setup();
    expect(player.level()).toBe(0);
    player.enqueue(chunk());
    expect(player.level()).toBeCloseTo(0.3);
    ctx.sources[0]!.onended!();
    expect(player.level()).toBe(0);
  });

  it('ignores empty chunks', () => {
    const { ctx, player, events } = setup();
    player.enqueue(new ArrayBuffer(0));
    expect(ctx.sources.length).toBe(0);
    expect(events).toEqual([]);
  });
});
