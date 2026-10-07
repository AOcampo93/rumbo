import type { Sound } from '@rumbo/event-system';

// Feedback sounds (PROJECT_PLAN §9.4), synthesised with Web Audio: no files to
// download or cache. Browsers only allow audio after a user gesture, so the
// "Test sound" and "Start" buttons call unlockAudio().

type Note = { freq: number; at: number; length: number };

const TUNES: Record<Sound, { notes: Note[]; type: OscillatorType; volume: number }> = {
  approach: { type: 'sine', volume: 0.18, notes: [{ freq: 880, at: 0, length: 0.14 }] },
  arrive: {
    type: 'triangle',
    volume: 0.25,
    notes: [
      { freq: 659, at: 0, length: 0.16 },
      { freq: 988, at: 0.15, length: 0.32 },
    ],
  },
  alert: {
    type: 'square',
    volume: 0.12,
    notes: [
      { freq: 440, at: 0, length: 0.12 },
      { freq: 440, at: 0.2, length: 0.12 },
    ],
  },
  finish: {
    type: 'triangle',
    volume: 0.25,
    notes: [
      { freq: 523, at: 0, length: 0.14 },
      { freq: 659, at: 0.13, length: 0.14 },
      { freq: 784, at: 0.26, length: 0.14 },
      { freq: 1047, at: 0.39, length: 0.4 },
    ],
  },
  soft: { type: 'sine', volume: 0.15, notes: [{ freq: 523, at: 0, length: 0.25 }] },
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Call from a click handler: browsers start audio muted until a gesture. */
export async function unlockAudio(): Promise<void> {
  try {
    await audioContext()?.resume();
  } catch {
    // No audio on this device.
  }
}

export function playSound(sound: Sound): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return;
  const tune = TUNES[sound];
  const start = ctx.currentTime + 0.02;
  for (const note of tune.notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = tune.type;
    oscillator.frequency.value = note.freq;
    // Short attack and release: a chime, not a click.
    gain.gain.setValueAtTime(0, start + note.at);
    gain.gain.linearRampToValueAtTime(tune.volume, start + note.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + note.at);
    oscillator.stop(start + note.at + note.length + 0.05);
  }
}
