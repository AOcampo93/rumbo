import { describe, expect, it } from 'vitest';
import { floatToPcm16 } from '../src/ar/pcm.ts';
import {
  PcmPlayer,
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
  connect() {}
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
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
  createBuffer(_c: number, length: number, rate: number): AudioBufferLike {
    return { duration: length / rate, copyToChannel() {} };
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

  it('schedules chunks back to back after a small lead', () => {
    const { ctx, player } = setup();
    ctx.currentTime = 10;
    player.enqueue(chunk());
    player.enqueue(chunk());
    player.enqueue(chunk());
    const starts = ctx.sources.map((s) => s.startedAt!);
    expect(starts[0]).toBeCloseTo(10.05);
    expect(starts[1]).toBeCloseTo(10.15);
    expect(starts[2]).toBeCloseTo(10.25);
  });

  it('restarts ahead of the clock after an underrun', () => {
    const { ctx, player } = setup();
    player.enqueue(chunk());
    ctx.currentTime = 5;
    player.enqueue(chunk());
    expect(ctx.sources[1]!.startedAt).toBeCloseTo(5.05);
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
    expect(events).toEqual(['speaking', 'idle']);
    player.enqueue(chunk());
    lateEnd(); // the old source ending must not cancel the new turn
    expect(events).toEqual(['speaking', 'idle', 'speaking']);
    expect(ctx.sources[2]!.startedAt).toBeCloseTo(1.05);
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
