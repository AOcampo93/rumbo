import type { PositionSample, PositionSource } from '../types.ts';

export interface TrackRecorder extends PositionSource {
  /** Copy of every reading seen so far. */
  samples(): PositionSample[];
  /** The readings as JSON, ready to save as a test fixture. */
  exportJSON(): string;
  clear(): void;
}

/**
 * Wraps a source and keeps every reading that passes through it. Record a
 * real walk once, then replay it in tests with createReplaySource.
 */
export function createTrackRecorder(source: PositionSource): TrackRecorder {
  const recorded: PositionSample[] = [];
  return {
    kind: source.kind,
    get trusted() {
      return source.trusted;
    },
    start(onSample, onError) {
      source.start((sample) => {
        recorded.push({ ...sample });
        onSample(sample);
      }, onError);
    },
    stop() {
      source.stop();
    },
    samples: () => [...recorded],
    exportJSON: () => JSON.stringify(recorded),
    clear() {
      recorded.length = 0;
    },
  };
}
