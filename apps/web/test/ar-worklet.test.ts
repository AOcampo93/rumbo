import { describe, expect, it } from 'vitest';
import { Downsampler } from '../src/ar/pcm.ts';
import source from '../public/ra_test/pcm-capture-worklet.js?raw';

// The capture worklet is a static file (no imports possible), so it is run here with a fake
// AudioWorkletGlobalScope and checked against the TypeScript Downsampler.

function loadProcessor(rate: number) {
  let Ctor:
    | (new () => {
        port: { postMessage: (m: ArrayBuffer) => void };
        process(i: Float32Array[][]): boolean;
      })
    | undefined;
  class AudioWorkletProcessor {
    port: { postMessage: (message: ArrayBuffer) => void } = { postMessage: () => undefined };
  }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
    AudioWorkletProcessor,
    (_name: string, c: typeof Ctor) => (Ctor = c),
    rate,
  );
  return new Ctor!();
}

describe('pcm-capture worklet', () => {
  it('posts 1600-sample PCM16 frames at 16 kHz and matches the Downsampler', () => {
    const proc = loadProcessor(48_000);
    const frames: Int16Array[] = [];
    proc.port.postMessage = (m) => frames.push(new Int16Array(m));
    const signal = Float32Array.from({ length: 48_000 / 5 }, (_, i) => 0.5 * Math.sin(i / 20));
    for (let i = 0; i < signal.length; i += 128) proc.process([[signal.slice(i, i + 128)]]);

    expect(frames.length).toBe(2); // 200 ms -> two 100 ms frames
    expect(frames[0]!.length).toBe(1600);
    const expected = new Downsampler(48_000).process(signal);
    frames[0]!.forEach((v, i) => expect(v / 0x7fff).toBeCloseTo(expected[i]!, 3));
  });

  it('keeps running without input', () => {
    expect(loadProcessor(44_100).process([[]])).toBe(true);
  });
});
