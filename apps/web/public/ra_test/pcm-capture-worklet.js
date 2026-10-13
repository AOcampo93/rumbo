/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Microphone capture for the AR lab: downsamples the input (usually 48 or 44.1 kHz) to 16 kHz
// mono and posts PCM16 LE frames of ~100 ms (1600 samples) to the main thread.
// Same box-filter algorithm as Downsampler in src/ar/pcm.ts (a worklet can't import it).

const OUT_RATE = 16000;
const FRAME = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / OUT_RATE;
    this.sum = 0;
    this.filled = 0;
    this.frame = new Int16Array(FRAME);
    this.count = 0;
  }

  push(value) {
    const s = Math.max(-1, Math.min(1, value));
    this.frame[this.count++] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
    if (this.count === FRAME) {
      const copy = this.frame.slice();
      this.port.postMessage(copy.buffer, [copy.buffer]);
      this.count = 0;
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.filled);
        this.sum += channel[i] * take;
        this.filled += take;
        remaining -= take;
        if (this.filled >= this.ratio - 1e-9) {
          this.push(this.sum / this.ratio);
          this.sum = 0;
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
