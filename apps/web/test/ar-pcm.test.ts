import { describe, expect, it } from 'vitest';
import {
  Downsampler,
  floatToPcm16,
  generateSpeechLikePcm16,
  pcm16ToFloat,
  rms,
} from '../src/ar/pcm.ts';

describe('PCM16 conversion', () => {
  it('round-trips samples within one quantisation step', () => {
    const input = [0, 0.5, -0.5, 1, -1, 0.123];
    const back = pcm16ToFloat(floatToPcm16(input));
    input.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 3));
  });

  it('writes little-endian and clips out-of-range values', () => {
    const view = new DataView(floatToPcm16([1, -1, 2, -3]));
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
    expect(view.getInt16(4, true)).toBe(0x7fff);
    expect(view.getInt16(6, true)).toBe(-0x8000);
    expect(new Uint8Array(floatToPcm16([1]))[0]).toBe(0xff);
  });

  it('ignores a trailing odd byte', () => {
    expect(pcm16ToFloat(new ArrayBuffer(5)).length).toBe(2);
  });
});

describe('Downsampler', () => {
  it('48 kHz to 16 kHz averages groups of three', () => {
    const out = new Downsampler(48_000).process([3, 3, 3, 0, 0, 0, 3, 6, 9]);
    expect(Array.from(out)).toEqual([3, 0, 6]);
  });

  it('44.1 kHz to 16 kHz yields the right count and keeps a constant signal', () => {
    const out = new Downsampler(44_100).process(new Float32Array(44_100).fill(0.25));
    expect(out.length).toBeGreaterThanOrEqual(15_999);
    expect(out.length).toBeLessThanOrEqual(16_000);
    out.forEach((v) => expect(v).toBeCloseTo(0.25, 5));
  });

  it('gives the same result when the input arrives in small chunks', () => {
    const signal = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
    const whole = new Downsampler(44_100).process(signal);
    const chunked = new Downsampler(44_100);
    const parts: number[] = [];
    for (let i = 0; i < signal.length; i += 37)
      parts.push(...chunked.process(signal.slice(i, i + 37)));
    expect(parts.length).toBe(whole.length);
    parts.forEach((v, i) => expect(v).toBeCloseTo(whole[i]!, 6));
  });

  it('refuses to upsample', () => {
    expect(() => new Downsampler(8000)).toThrow();
  });
});

describe('speech-like test audio', () => {
  const pcm = generateSpeechLikePcm16(4);
  const samples = pcm16ToFloat(pcm);

  it('lasts about 4 s at 24 kHz and is not harsh', () => {
    expect(samples.length).toBe(4 * 24_000);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.9);
  });

  it('has bursts and pauses (its level varies)', () => {
    const levels: number[] = [];
    for (let i = 0; i + 1200 <= samples.length; i += 1200)
      levels.push(rms(samples.slice(i, i + 1200)));
    expect(Math.max(...levels)).toBeGreaterThan(0.05);
    expect(Math.min(...levels)).toBeLessThan(0.02);
  });

  it('is deterministic', () => {
    expect(new Uint8Array(generateSpeechLikePcm16(1))).toEqual(
      new Uint8Array(generateSpeechLikePcm16(1)),
    );
  });
});
