// PCM helpers shared by the voice client and its tests. Wire format: PCM16 little-endian mono.

export const CAPTURE_RATE = 16_000;
export const PLAYBACK_RATE = 24_000;

/** Float samples in [-1, 1] to PCM16 LE bytes (values outside the range are clipped). */
export function floatToPcm16(samples: ArrayLike<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return buffer;
}

/** PCM16 LE bytes to float samples in [-1, 1]. A trailing odd byte is ignored. */
export function pcm16ToFloat(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const out = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    const v = view.getInt16(i * 2, true);
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/**
 * Streaming box-filter downsampler (any ratio >= 1, e.g. 48000 or 44100 to 16000).
 * Keeps the partial output sample between calls, so chunks can be any size.
 * The AudioWorklet (public/ra_test/pcm-capture-worklet.js) runs the same algorithm.
 */
export class Downsampler {
  private readonly ratio: number;
  private sum = 0;
  private filled = 0;

  constructor(
    inRate: number,
    readonly outRate: number = CAPTURE_RATE,
  ) {
    if (inRate < outRate) throw new Error('Upsampling is not supported');
    this.ratio = inRate / outRate;
  }

  process(input: ArrayLike<number>): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const x = input[i] ?? 0;
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.filled);
        this.sum += x * take;
        this.filled += take;
        remaining -= take;
        if (this.filled >= this.ratio - 1e-9) {
          out.push(this.sum / this.ratio);
          this.sum = 0;
          this.filled = 0;
        }
      }
    }
    return Float32Array.from(out);
  }
}

/** Root mean square of a block of samples, 0..1 for normal audio. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < samples.length; i++) acc += (samples[i] ?? 0) ** 2;
  return Math.sqrt(acc / samples.length);
}

/**
 * About `seconds` of speech-like audio for the "try the animation" button: syllable-sized
 * bursts of a soft voiced tone (a few harmonics) with a little breath noise, separated
 * by short pauses, all with smooth envelopes. Deterministic (seeded noise). PCM16 at 24 kHz.
 */
export function generateSpeechLikePcm16(seconds = 4, rate = PLAYBACK_RATE): ArrayBuffer {
  const n = Math.floor(seconds * rate);
  const out = new Float32Array(n);
  let seed = 1234567;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  let t = 0.15;
  let phase = 0;
  while (t < seconds - 0.2) {
    const burst = 0.12 + (noise() + 1) * 0.12; // 0.12..0.36 s
    const pitch = 110 + (noise() + 1) * 50; // 110..210 Hz
    const peak = 0.25 + (noise() + 1) * 0.15;
    const start = Math.floor(t * rate);
    const len = Math.min(Math.floor(burst * rate), n - start);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((Math.PI * i) / len) ** 2;
      phase += (2 * Math.PI * pitch) / rate;
      const tone =
        Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.1 * noise();
      out[start + i] = (out[start + i] ?? 0) + (peak / 1.85) * env * tone;
    }
    t += burst + 0.04 + (noise() + 1) * 0.06; // a short pause
  }
  return floatToPcm16(out);
}
